import type { ScaleDefinition, AnswerRecord, TestResult, ScaleCutoff } from '@/types'

/**
 * 通用计分引擎
 * 支持 sum/average/weighted/formula 类型计分
 * 自动处理反向计分
 */
export function useScoring() {
  /**
   * 计算原始分
   * 根据量表 scoring 配置计算总分或维度分
   */
  function calculateRawScore(
    scale: ScaleDefinition,
    answers: Record<string | number, AnswerRecord>
  ): { total: number; dimensions: Record<string, number>; rawSum: number } {
    const questions = scale.questions
    const scoring = scale.scoring
    const dimensionScores: Record<string, number> = {}

    // 先计算每道题的实际得分（处理反向计分）
    const effectiveScores: Record<string | number, number> = {}
    for (const q of questions) {
      const ans = answers[q.id]
      if (!ans) continue

      let score = ans.score
      if (q.reverse) {
        // 反向计分：用该题最大选项分值 - 当前分值 + 最小分值
        const maxScore = Math.max(...q.options.map(o => o.score))
        const minScore = Math.min(...q.options.map(o => o.score))
        score = maxScore + minScore - score
      }
      effectiveScores[q.id] = score
    }

    // 计算维度分
    if (scoring.type === 'mmpi' && scoring.dimensions) {
      // MMPI 专用粗分计算
      for (const dim of scoring.dimensions) {
        let dimSum = 0
        // yesQuestions: 答"是"得分
        if (dim.yesQuestions) {
          for (const qid of dim.yesQuestions) {
            const ans = answers[qid]
            if (ans && (ans.value === 'Y' || ans.value === 'yes')) {
              dimSum++
            }
          }
        }
        // noQuestions: 答"否"得分
        if (dim.noQuestions) {
          for (const qid of dim.noQuestions) {
            const ans = answers[qid]
            if (ans && (ans.value === 'N' || ans.value === 'no')) {
              dimSum++
            }
          }
        }
        dimensionScores[dim.name] = dimSum
      }

      // K校正分 (K 是校正量表，它的粗分会加到其它部分临床量表上)
      const kRaw = dimensionScores['K'] || 0
      for (const dim of scoring.dimensions) {
        if (dim.kWeight && dim.kWeight > 0) {
          // 对临床量表加上权重对应的 K 值分数
          dimensionScores[dim.name] = (dimensionScores[dim.name] || 0) + (dim.kWeight * kRaw)
        }
      }
    } else if (scoring.dimensions) {
      for (const dim of scoring.dimensions) {
        let dimSum = 0
        let count = 0
        for (const qid of dim.questionIds) {
          if (effectiveScores[qid] !== undefined) {
            dimSum += effectiveScores[qid]
            count++
          }
        }
        // 若维度 formula 为 "sum / len(questionIds)" 或 scoring.type 为 "average"
        const isDimAverage = dim.formula === 'sum / len(questionIds)' || scoring.type === 'average'
        
        if (isDimAverage) {
          dimensionScores[dim.name] = count > 0 ? dimSum / count : 0
        } else if (dim.formula) {
          // 简单公式支持，如 "sum / count * 1.25"
          dimensionScores[dim.name] = evalFormula(dim.formula, dimSum, count, dim.questionIds.length)
        } else {
          dimensionScores[dim.name] = dimSum
        }
      }
    }

    // 计算总分与原始得分和
    const allScores = Object.values(effectiveScores)
    const rawSum = allScores.reduce((a, b) => a + b, 0)
    let total = 0
    if (scoring.type === 'mmpi') {
      total = 0
    } else {
      switch (scoring.type) {
        case 'sum':
          total = rawSum
          break
        case 'average':
          total = allScores.length > 0 ? rawSum / allScores.length : 0
          break
        case 'weighted':
          // weighted 需要 weights 配置，这里简化为 sum
          total = rawSum
          break
        case 'formula':
          total = scoring.formula ? evalFormula(scoring.formula, rawSum, allScores.length) : rawSum
          break
        default:
          total = rawSum
      }
    }

    return { total, dimensions: dimensionScores, rawSum }
  }

  /**
   * 简单公式求值
   * 支持变量: sum, count, len(questionIds)
   * 例如: "(sum - 20) * 1.25"
   */
  function evalFormula(formula: string, sum: number, count: number, lenQuestionIds?: number): number {
    // 输入安全性与合规性检查（防注入）
    const cleanFormula = formula.trim()
    const isSafe = /^[\d\+\-\*\/\(\)\s\.\,a-zA-Z_]+$/.test(cleanFormula) && 
                   !/(window|document|eval|Function|require|process|global|cookie|localStorage|sessionStorage|dbRun)/i.test(cleanFormula);
    
    if (!isSafe) {
      console.warn('Unsafe formula detected:', formula)
      return sum
    }

    let expr = formula
      .replace(/sum\(options\)/g, String(sum))
      .replace(/sum/g, String(sum))
      .replace(/count/g, String(count))
    
    if (lenQuestionIds !== undefined) {
      expr = expr.replace(/len\(questionIds\)/g, String(lenQuestionIds))
    }
    
    // 执行安全的纯前端数学解析与计算以支持 CSP (Content Security Policy)
    try {
      return safeEvaluate(expr)
    } catch (e) {
      console.error('Formula safeEvaluate error:', e)
      return sum
    }
  }

  /**
   * 纯前端安全数学公式解析器（防 CSP 限制且防代码注入）
   */
  function safeEvaluate(expr: string): number {
    // 去除所有空格
    let s = expr.replace(/\s+/g, '')

    // 解析所有的 round / Math.round
    s = resolveFunctions(s)

    // 解析括号
    let str = s
    while (true) {
      const start = str.lastIndexOf('(')
      if (start === -1) break
      const end = str.indexOf(')', start)
      if (end === -1) break
      const subExpr = str.slice(start + 1, end)
      const val = parseSimpleMath(subExpr)
      str = str.slice(0, start) + String(val) + str.slice(end + 1)
    }
    return parseSimpleMath(str)
  }

  /**
   * 解析所有的 round / Math.round 函数
   */
  function resolveFunctions(s: string): string {
    let str = s.replace(/Math\.round\(/g, 'round(')
    while (true) {
      let funcIndex = str.indexOf('round(')
      if (funcIndex === -1) break

      const openParenIndex = funcIndex + 5 // '('
      
      // 寻找匹配的 ')'
      let balance = 1
      let closeParenIndex = -1
      for (let i = openParenIndex + 1; i < str.length; i++) {
        if (str[i] === '(') balance++
        else if (str[i] === ')') balance--
        
        if (balance === 0) {
          closeParenIndex = i
          break
        }
      }
      
      if (closeParenIndex === -1) {
        break
      }
      
      const innerExpr = str.slice(openParenIndex + 1, closeParenIndex)
      const innerValue = safeEvaluate(innerExpr)
      const roundedValue = Math.round(innerValue)
      
      const startPart = str.slice(0, funcIndex)
      const endPart = str.slice(closeParenIndex + 1)
      str = startPart + String(roundedValue) + endPart
    }
    return str
  }

  /**
   * 解析不含括号的扁平数学表达式
   */
  function parseSimpleMath(s: string): number {
    const tokens: (number | string)[] = []
    let numBuffer = ''
    
    for (let i = 0; i < s.length; i++) {
      const char = s[i]
      if (/[0-9\.]/.test(char)) {
        numBuffer += char
      } else if (char === '-' && (i === 0 || /[\+\-\*\/]/.test(s[i - 1]))) {
        // 负数/负号处理
        numBuffer += char
      } else if (/[\+\-\*\/]/.test(char)) {
        if (numBuffer) {
          tokens.push(Number(numBuffer))
          numBuffer = ''
        }
        tokens.push(char)
      }
    }
    if (numBuffer) {
      tokens.push(Number(numBuffer))
    }

    // 先计算乘除
    const outputQueue: (number | string)[] = []
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      if (token === '*' || token === '/') {
        const left = outputQueue.pop() as number
        const right = tokens[++i] as number
        if (token === '*') {
          outputQueue.push(left * right)
        } else {
          outputQueue.push(right !== 0 ? left / right : 0)
        }
      } else {
        outputQueue.push(token)
      }
    }

    // 再计算加减
    if (outputQueue.length === 0) return 0
    let result = outputQueue[0] as number
    for (let i = 1; i < outputQueue.length; i += 2) {
      const op = outputQueue[i] as string
      const right = outputQueue[i + 1] as number
      if (op === '+') {
        result += right
      } else if (op === '-') {
        result -= right
      }
    }

    return result
  }

  /**
   * 查找对应的结果分级
   */
  function findInterpretation(scale: ScaleDefinition, stdScore: number): ScaleCutoff | undefined {
    const interp = scale.interpretation
    if (interp.type === 'cutoff' && interp.cutoffs) {
      for (const cutoff of interp.cutoffs) {
        const min = cutoff.min ?? -Infinity
        const max = cutoff.max ?? Infinity
        if (stdScore >= min && stdScore <= max) {
          return cutoff
        }
      }
    }
    return undefined
  }

  /**
   * 执行完整的计分流程
   */
  function scoreTest(
    scale: ScaleDefinition,
    answers: Record<string | number, AnswerRecord>,
    duration: number
  ): TestResult {
    const { total, dimensions, rawSum } = calculateRawScore(scale, answers)

    // 原始分：对于带有 formula 转换的量表（如 SAS/SDS），rawScore 应代表未乘以 1.25 的原始总分
    let rawScore = total
    let stdScore = total

    const idUpper = scale.id.toUpperCase()
    if (idUpper === 'SAS' || idUpper === 'SDS') {
      rawScore = rawSum
      stdScore = Math.round(rawSum * 1.25)
    } else if (scale.scoring.type === 'formula') {
      rawScore = rawSum
      stdScore = total
    } else if (scale.scoring.type === 'average') {
      rawScore = rawSum
      stdScore = total
    }

    // MMPI T-score 转换及标准分决定
    if (scale.scoring.type === 'mmpi' && scale.scoring.mmpiConfig) {
      // 默认假设男性常模以防未传性别，但此处通过 testStore 内部处理时我们仅算粗分/维度分
      // 标准分数可以用主要临床量表升高的最高T分数，这里主要在 ResultView 中展现剖面图
      rawScore = 0
      stdScore = 50 // 默认中位数
    }

    const interpretation = findInterpretation(scale, stdScore)
    const warnings: string[] = []

    // 效度检查：作答时间过短
    if (scale.settings.timeLimit && duration < scale.settings.timeLimit * 60 * 0.3) {
      warnings.push('作答时间过短，结果可能不可靠')
    }

    // 效度检查：未作答比例
    const answeredCount = Object.keys(answers).length
    const totalCount = scale.questions.length
    const answeredPercent = totalCount > 0 ? answeredCount / totalCount : 0
    if (answeredPercent < scale.settings.minAnsweredPercent) {
      warnings.push(`未作答题目比例过高（${Math.round((1 - answeredPercent) * 100)}%），结果无效`)
    }

    // 效度检查：连续相同选项
    const answerList = scale.questions.map(q => answers[q.id]).filter(Boolean)
    let consecutiveSame = 1
    for (let i = 1; i < answerList.length; i++) {
      if (answerList[i].value === answerList[i - 1].value) {
        consecutiveSame++
        if (consecutiveSame >= 10) {
          warnings.push('检测到连续多题选择相同选项，可能存在敷衍作答')
          break
        }
      } else {
        consecutiveSame = 1
      }
    }

    return {
      scaleId: scale.id,
      scaleName: scale.name,
      userId: null,
      rawScore,
      stdScore,
      dimensionScores: dimensions,
      answers: Object.values(answers),
      duration,
      interpretation,
      warnings
    }
  }

  return {
    calculateRawScore,
    findInterpretation,
    scoreTest
  }
}

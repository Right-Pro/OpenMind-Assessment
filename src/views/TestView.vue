<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, ElLoading } from 'element-plus'
import { useScaleStore } from '@/stores/scaleStore'
import { useTestStore } from '@/stores/testStore'
import { useUserStore } from '@/stores/userStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useScoring } from '@/composables/useScoring'
import type { ScaleQuestion, AnswerRecord } from '@/types'

const route = useRoute()
const router = useRouter()
const scaleStore = useScaleStore()
const testStore = useTestStore()
const userStore = useUserStore()
const settingsStore = useSettingsStore()
const { scoreTest } = useScoring()

const scaleIdParam = computed(() => route.params.scaleId as string)
const isBatch = computed(() => scaleIdParam.value.includes(','))
const scaleIds = computed(() => isBatch.value ? scaleIdParam.value.split(',') : [scaleIdParam.value])
const currentScaleIndex = ref(0)
const scaleId = computed(() => scaleIds.value[currentScaleIndex.value])
const scale = computed(() => scaleStore.getScaleById(scaleId.value))

const showGuide = ref(true)
const timerInterval = ref<number | null>(null)
const elapsedSeconds = ref(0)
const isPaused = ref(false)

// 语音朗读 (TTS) 相关状态
const isSpeechSupported = ref(typeof window !== 'undefined' && 'speechSynthesis' in window)
const ttsEnabled = ref(false)
const isTtsPaused = ref(false)
const isTtsSpeaking = ref(false)

// 计算用户年龄
const currentUserAge = computed(() => {
  if (!userStore.currentUser || !userStore.currentUser.birthdate) return 0
  try {
    const birth = new Date(userStore.currentUser.birthdate)
    const now = new Date()
    let calculatedAge = now.getFullYear() - birth.getFullYear()
    if (
      now.getMonth() < birth.getMonth() ||
      (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
    ) {
      calculatedAge--
    }
    return calculatedAge >= 0 ? calculatedAge : 0
  } catch (e) {
    return 0
  }
})

// 根据老年人规则初始化默认勾选
function initTtsToggle() {
  if (!isSpeechSupported.value) {
    ttsEnabled.value = false
    return
  }
  if (settingsStore.seniorTtsEnabled) {
    const threshold = settingsStore.seniorTtsThreshold
    if (currentUserAge.value >= threshold) {
      ttsEnabled.value = true
      return
    }
  }
  ttsEnabled.value = false
}

// 语音朗读核心方法
function stopSpeaking() {
  if (!isSpeechSupported.value) return
  try {
    window.speechSynthesis.cancel()
    isTtsSpeaking.value = false
    isTtsPaused.value = false
  } catch (e) {
    console.error('Speech synthesis cancel error:', e)
  }
}

function speakText(text: string, force = false) {
  if (!isSpeechSupported.value) return
  if (!ttsEnabled.value && !force) return

  stopSpeaking()

  if (!text) return

  try {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'zh-CN'
    utterance.rate = 1.0
    utterance.pitch = 1.0

    utterance.onstart = () => {
      isTtsSpeaking.value = true
      isTtsPaused.value = false
    }
    utterance.onend = () => {
      isTtsSpeaking.value = false
      isTtsPaused.value = false
    }
    utterance.onerror = () => {
      isTtsSpeaking.value = false
      isTtsPaused.value = false
    }

    window.speechSynthesis.speak(utterance)
  } catch (e) {
    console.error('Speech synthesis play error:', e)
  }
}

function pauseSpeaking() {
  if (!isSpeechSupported.value) return
  try {
    window.speechSynthesis.pause()
    isTtsPaused.value = true
  } catch (e) {
    console.error('Speech synthesis pause error:', e)
  }
}

function resumeSpeaking() {
  if (!isSpeechSupported.value) return
  try {
    window.speechSynthesis.resume()
    isTtsPaused.value = false
  } catch (e) {
    console.error('Speech synthesis resume error:', e)
  }
}

// 朗读当前题目 (题干 + 补充说明)
function speakCurrentQuestion() {
  if (!currentQuestion.value) return
  let text = currentQuestion.value.text
  if (currentQuestion.value.subText) {
    text += '。' + currentQuestion.value.subText
  }
  speakText(text)
}

const currentQuestion = computed<ScaleQuestion | undefined>(() => {
  if (!scale.value) return undefined
  return scale.value.questions[testStore.currentQuestionIndex]
})

const progressPercent = computed(() => {
  if (!scale.value || !currentQuestion.value) return 0
  return Math.round(((testStore.currentQuestionIndex + 1) / scale.value.questions.length) * 100)
})

const answeredCount = computed(() => Object.keys(testStore.answers).length)

const isFirstQuestion = computed(() => testStore.currentQuestionIndex === 0)
const isLastQuestion = computed(() => {
  if (!scale.value) return true
  return testStore.currentQuestionIndex === scale.value.questions.length - 1
})
const isLastQuestionAnswered = computed(() => {
  if (!scale.value || !currentQuestion.value) return false
  return testStore.answers[currentQuestion.value.id] !== undefined
})

const isClinicianScale = computed(() => {
  if (!scale.value) return false
  return scale.value.category === 'psychiatric' || scale.value.tags?.includes('他评')
})

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function startTimer() {
  timerInterval.value = window.setInterval(() => {
    if (!isPaused.value) {
      elapsedSeconds.value++
    }
  }, 1000)
}

function stopTimer() {
  if (timerInterval.value) {
    clearInterval(timerInterval.value)
    timerInterval.value = null
  }
}

function togglePause() {
  isPaused.value = !isPaused.value
  if (isPaused.value) {
    stopSpeaking()
    ElMessage.info('答题已暂停，计时与语音已暂停')
  } else {
    ElMessage.success('答题已恢复')
    if (ttsEnabled.value && !showGuide.value) {
      speakCurrentQuestion()
    }
  }
}

function confirmGuide() {
  showGuide.value = false
  startTimer()
  // 指导语弹窗确认后，如果是开启了自动朗读，自动朗读第一题
  if (ttsEnabled.value) {
    speakCurrentQuestion()
  }
}

// 计算并执行跳题逻辑
function evaluateSkipAndNext() {
  if (!scale.value || !currentQuestion.value) return
  
  // 检查当前题是否有 skipLogic
  const skipLogic = currentQuestion.value.skipLogic
  if (skipLogic) {
    try {
      // 构造 answers 上下文供条件表达式求值
      const answers = testStore.answers
      // 简单安全求值：利用 Function 执行 condition 表达式
      const evalCondition = new Function('answers', `return (${skipLogic.condition})`)
      const shouldSkip = evalCondition(answers)
      
      if (shouldSkip) {
        // 找到目标跳转题目的 id
        const targetId = skipLogic.target
        const targetIndex = scale.value.questions.findIndex(q => String(q.id) === String(targetId))
        
        if (targetIndex !== -1) {
          // 将跳过的所有题目分数设为 0 (或者视为不作答)，清空原有的选择
          for (let i = testStore.currentQuestionIndex + 1; i < targetIndex; i++) {
            const skippedQ = scale.value.questions[i]
            testStore.answerQuestion(skippedQ.id, 0, 0) // 自动答 0/否
          }
          
          testStore.goToQuestion(targetIndex)
          return
        }
      }
    } catch (err) {
      console.error('Skip logic evaluation failed:', err)
    }
  }
  
  // 默认正常进入下一题
  testStore.nextQuestion()
}

function selectOption(optionValue: number | string, score: number) {
  if (!currentQuestion.value || isPaused.value) return
  testStore.answerQuestion(currentQuestion.value.id, optionValue, score)

  if (!isLastQuestion.value) {
    setTimeout(() => evaluateSkipAndNext(), 200)
  }
}

function goToQuestion(index: number) {
  if (!scale.value) return
  if (!scale.value.settings.allowBacktrack && index < testStore.currentQuestionIndex) {
    ElMessage.warning('该量表不允许返回修改')
    return
  }
  testStore.goToQuestion(index)
}

function prevQuestion() {
  if (!scale.value?.settings.allowBacktrack) {
    ElMessage.warning('该量表不允许返回修改')
    return
  }
  
  // 检查是否需要倒退跳题 (如果当前是在第 6 题 Q6，且前两题都是否/0，应该退回到 Q2)
  if (scale.value.id === 'C-SSRS' && testStore.currentQuestionIndex === 5) {
    const q1Ans = testStore.answers['1']?.value
    const q2Ans = testStore.answers['2']?.value
    if (q1Ans === 0 && q2Ans === 0) {
      // 从 Q6 退回 Q2
      testStore.goToQuestion(1)
      return
    }
  }
  
  // BSS 自杀意念量表倒退跳题：如果当前是第 20 题且 Q4 和 Q5 均为 0，应退回到 Q5 (index 4)
  if (scale.value.id === 'BSS' && testStore.currentQuestionIndex === 19) {
    const q4Ans = testStore.answers['4']?.value
    const q5Ans = testStore.answers['5']?.value
    if (q4Ans === 0 && q5Ans === 0) {
      testStore.goToQuestion(4)
      return
    }
  }
  
  testStore.prevQuestion()
}

function submitTest() {
  if (!scale.value) return

  const answeredCount = Object.keys(testStore.answers).length
  const totalCount = scale.value.questions.length
  const minRequired = Math.ceil(totalCount * scale.value.settings.minAnsweredPercent)

  if (answeredCount < minRequired) {
    ElMessage.warning(`至少需要作答 ${minRequired} 题才能提交（当前 ${answeredCount} 题）`)
    return
  }

  ElMessageBox.confirm(
    `已作答 ${answeredCount}/${totalCount} 题，确认提交？`,
    '提交确认',
    { confirmButtonText: '确认提交', cancelButtonText: '继续答题' }
  ).then(() => {
    finishTest()
  }).catch(() => {})
}

// 缓存批量测评所有结果
const batchResults = ref<any[]>([])
const resumePackageSessionId = ref<number | null>(null)

async function finishTest() {
  stopTimer()
  testStore.finishTest()

  if (!scale.value) return
  const result = scoreTest(scale.value, testStore.answers, testStore.duration)
  
  // 自动保存逻辑：如果当前已选中用户，则默默执行自动保存
  if (userStore.currentUser) {
    try {
      // 检查是否有传入的未完成记录 ID 需要物理删除（或直接覆盖更新为 completed 状态）
      if (resumeTestId.value) {
        await window.electronAPI.deleteTest(resumeTestId.value)
      }
      const savedId = await testStore.saveTestResult(userStore.currentUser.id, result)
      batchResults.value.push({
        testId: savedId,
        scaleName: scale.value.name,
        result
      })
      console.log('Test result automatically saved.')
    } catch (e) {
      console.error('Failed to auto save test result:', e)
    }
  } else {
    batchResults.value.push({
      testId: Date.now(),
      scaleName: scale.value.name,
      result
    })
  }

  // 判断是否还有下一个量表需要测评
  if (currentScaleIndex.value < scaleIds.value.length - 1) {
    // 连续测评：如果已经有已登录用户，可以静默更新 package_sessions 的进度为下一个量表的第 0 题
    if (isBatch.value && userStore.currentUser) {
      try {
        const nextScaleIdx = currentScaleIndex.value + 1
        const answersObj = {
          answers: {},
          markedQuestions: [],
          elapsedSeconds: 0,
          batchResults: batchResults.value
        }
        const answersJson = JSON.stringify(answersObj)
        if (resumePackageSessionId.value) {
          await window.electronAPI.dbRun(
            `UPDATE package_sessions 
             SET currentScaleIndex = ?, currentQuestionIndex = 0, answers = ?, updatedAt = datetime('now', 'localtime') 
             WHERE id = ?`,
            [nextScaleIdx, 0, answersJson, resumePackageSessionId.value]
          )
        } else {
          const packageId = scaleIdParam.value
          const userId = userStore.currentUser.id
          await window.electronAPI.dbRun(
            `INSERT INTO package_sessions (packageId, userId, currentScaleIndex, currentQuestionIndex, answers, status)
             VALUES (?, ?, ?, 0, ?, 'incomplete')`,
            [packageId, userId, nextScaleIdx, answersJson]
          )
          const inserted = await window.electronAPI.dbQuery(
            `SELECT id FROM package_sessions WHERE userId = ? AND packageId = ? AND status = 'incomplete' ORDER BY id DESC LIMIT 1`,
            [userId, packageId]
          )
          if (inserted && inserted.length > 0) {
            resumePackageSessionId.value = inserted[0].id
          }
        }
      } catch (e) {
        console.error('自动保存套餐分段进度失败:', e)
      }
    }

    ElMessage.success(`【${scale.value.name}】作答完毕！即将进入下一个量表`)
    setTimeout(() => {
      currentScaleIndex.value++
      const nextScale = scaleStore.getScaleById(scaleId.value)
      if (nextScale) {
        testStore.initTest(nextScale)
        showGuide.value = true
        elapsedSeconds.value = 0
        isPaused.value = false
        initTtsToggle()
      } else {
        ElMessage.error('获取下一个量表失败')
        router.push('/')
      }
    }, 1500)
  } else {
    // 最后一项，完成整套测评
    const loadingInstance = ElLoading.service({
      lock: true,
      text: '正在处理并保存结果，请稍候...',
      background: 'rgba(0, 0, 0, 0.7)',
    })
    
    // 如果有未完成的 package session，需要将其标记为 completed 
    if (resumePackageSessionId.value) {
      try {
        await window.electronAPI.dbRun(
          `UPDATE package_sessions SET status = 'completed', updatedAt = datetime('now', 'localtime') WHERE id = ?`,
          [resumePackageSessionId.value]
        )
      } catch (e) {
        console.error('标记套餐进度为已完成失败:', e)
      }
    } else if (isBatch.value && userStore.currentUser) {
      try {
        await window.electronAPI.dbRun(
          `UPDATE package_sessions SET status = 'completed', updatedAt = datetime('now', 'localtime') WHERE packageId = ? AND userId = ? AND status = 'incomplete'`,
          [scaleIdParam.value, userStore.currentUser.id]
        )
      } catch (e) {}
    }

    // 把最后一个结果暂存渲染
    testStore.setResult(result)

    // 关闭加载提示并跳转
    setTimeout(() => {
      loadingInstance.close()
      if (isBatch.value) {
        // 传递批量测评的测试ID列表，跳转到专门的“套餐完成总结”页
        const testIdsStr = batchResults.value.map(r => r.testId).join(',')
        router.push({ path: '/package-summary', query: { testIds: testIdsStr } })
      } else {
        router.push('/result')
      }
    }, 600)
  }
}

async function saveProgressAndExit() {
  try {
    await ElMessageBox.confirm('保存当前进度并退出？下次可从本题继续', '退出确认', {
      confirmButtonText: '保存并退出',
      cancelButtonText: '继续答题'
    })
    
    // 如果有已登录用户，将当前未完成测试记录写入 SQLite 数据库，并将 status 标记为 'incomplete'
    if (userStore.currentUser && scale.value) {
      try {
        if (isBatch.value) {
          // 保存套餐的整体进度
          const answersObj = {
            answers: testStore.answers,
            markedQuestions: Array.from(testStore.markedQuestions),
            elapsedSeconds: elapsedSeconds.value,
            batchResults: batchResults.value
          }
          const answersJson = JSON.stringify(answersObj)
          const packageId = scaleIdParam.value
          const userId = userStore.currentUser.id
          const currentScaleIndexValue = currentScaleIndex.value
          const currentQuestionIndexValue = testStore.currentQuestionIndex

          if (resumePackageSessionId.value) {
            await window.electronAPI.dbRun(
              `UPDATE package_sessions 
               SET currentScaleIndex = ?, currentQuestionIndex = ?, answers = ?, updatedAt = datetime('now', 'localtime') 
               WHERE id = ?`,
              [currentScaleIndexValue, currentQuestionIndexValue, answersJson, resumePackageSessionId.value]
            )
          } else {
            await window.electronAPI.dbRun(
              `INSERT INTO package_sessions (packageId, userId, currentScaleIndex, currentQuestionIndex, answers, status)
               VALUES (?, ?, ?, ?, ?, 'incomplete')`,
              [packageId, userId, currentScaleIndexValue, currentQuestionIndexValue, answersJson]
            )
          }
          ElMessage.success('套餐测评进度已成功保存到本地！')
        } else {
          const progressJson = JSON.stringify({
            answers: testStore.answers,
            currentQuestionIndex: testStore.currentQuestionIndex,
            markedQuestions: Array.from(testStore.markedQuestions),
            elapsedSeconds: elapsedSeconds.value
          })
          
          // 如果是从已有未完成测评恢复进入的，我们需要更新已有的这一条 tests，避免重复新建进度
          if (resumeTestId.value) {
            await window.electronAPI.dbRun(
              `UPDATE tests 
               SET result_json = ?, duration_seconds = ?, created_at = datetime('now', 'localtime') 
               WHERE id = ?`,
              [progressJson, elapsedSeconds.value, resumeTestId.value]
            )
          } else {
            // 否则向 tests 写入 status = 'incomplete'
            await window.electronAPI.dbRun(
              `INSERT INTO tests (user_id, scale_id, scale_name, raw_score, std_score, result_json, duration_seconds, status)
               VALUES (?, ?, ?, 0, 0, ?, ?, 'incomplete')`,
              [userStore.currentUser.id, scale.value.id, scale.value.name, progressJson, elapsedSeconds.value]
            )
          }
          ElMessage.success('答题进度已成功保存到本地！')
        }
      } catch (dbErr: any) {
        console.error('保存进度数据库写入失败:', dbErr)
      }
    }
    
    testStore.clearTest()
    router.push('/')
  } catch {
    // 用户取消
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (!currentQuestion.value || showGuide.value) return
  const key = e.key
  const options = currentQuestion.value.options

  // 数字快捷键 1-9
  const num = parseInt(key)
  if (!isNaN(num) && num >= 1 && num <= options.length) {
    const opt = options[num - 1]
    selectOption(opt.value, opt.score)
    return
  }

  // 字母快捷键 A-D
  const letterMap: Record<string, number> = { a: 0, b: 1, c: 2, d: 3 }
  const lower = key.toLowerCase()
  if (letterMap[lower] !== undefined && letterMap[lower] < options.length) {
    const opt = options[letterMap[lower]]
    selectOption(opt.value, opt.score)
    return
  }

  // 方向键
  if (key === 'ArrowLeft') prevQuestion()
  if (key === 'ArrowRight') {
    if (isLastQuestion.value) {
      submitTest()
    } else {
      evaluateSkipAndNext()
    }
  }
}

const resumeTestId = ref<number | null>(null)
const hasCheckedPreviousProgress = ref(false)
const showRestoreAlert = ref(false)
const detectedIncompleteId = ref<number | null>(null)
const detectedAnsweredCount = ref(0)

// 套餐测评恢复进度相关 refs
const showPackageRestoreAlert = ref(false)
const detectedPackageSession = ref<any>(null)

async function handleRestorePackageSession(session: any) {
  try {
    resumePackageSessionId.value = session.id
    currentScaleIndex.value = session.currentScaleIndex
    
    let progress: any = {}
    try {
      progress = JSON.parse(session.answers || '{}')
    } catch (e) {}
    
    if (progress.batchResults) {
      batchResults.value = progress.batchResults
    }
    
    const activeScaleId = scaleIds.value[currentScaleIndex.value]
    const activeScale = scaleStore.getScaleById(activeScaleId)
    if (activeScale) {
      testStore.initTest(activeScale)
      
      if (progress.answers) {
        testStore.answers = progress.answers
      }
      if (progress.currentQuestionIndex !== undefined) {
        testStore.currentQuestionIndex = progress.currentQuestionIndex
      }
      if (progress.markedQuestions) {
        testStore.markedQuestions = new Set(progress.markedQuestions)
      }
      if (progress.elapsedSeconds !== undefined) {
        elapsedSeconds.value = progress.elapsedSeconds
      }
      
      showGuide.value = false
      startTimer()
      if (ttsEnabled.value) {
        speakCurrentQuestion()
      }
      
      ElMessage.success('已成功恢复套餐作答进度！')
    } else {
      ElMessage.error('无法加载对应的量表')
    }
  } catch (err) {
    console.error('恢复套餐进度失败:', err)
  } finally {
    showPackageRestoreAlert.value = false
  }
}

async function handleRestartPackageSession(session: any) {
  try {
    await window.electronAPI.dbRun(
      `DELETE FROM package_sessions WHERE id = ?`,
      [session.id]
    )
    ElMessage.success('已清除旧进度，重新开始答题')
  } catch (e) {
    console.error('清除旧进度失败:', e)
  } finally {
    showPackageRestoreAlert.value = false
  }
}

async function checkForIncompleteProgress() {
  if (!userStore.currentUser || !scale.value) return
  
  // 1. 如果是套餐（批量测评）
  if (isBatch.value) {
    try {
      const rows = await window.electronAPI.dbQuery(
        `SELECT id, currentScaleIndex, currentQuestionIndex, answers FROM package_sessions 
         WHERE userId = ? AND packageId = ? AND status = 'incomplete' 
         ORDER BY updatedAt DESC LIMIT 1`,
        [userStore.currentUser.id, scaleIdParam.value]
      )
      if (rows && rows.length > 0) {
        const session = rows[0]
        detectedPackageSession.value = session
        showPackageRestoreAlert.value = true
        
        ElMessageBox.confirm(
          `检测到您上次套餐测评未完成（量表 ${session.currentScaleIndex + 1}/${scaleIds.value.length}，第 ${session.currentQuestionIndex + 1} 题），是否继续？`,
          '继续测评提示',
          {
            confirmButtonText: '继续套餐',
            cancelButtonText: '重新开始',
            type: 'warning',
            closeOnClickModal: false,
            closeOnPressEscape: false,
            showClose: false
          }
        ).then(() => {
          handleRestorePackageSession(session)
        }).catch(() => {
          handleRestartPackageSession(session)
        })
      }
    } catch (err) {
      console.error('查询套餐未完成记录失败:', err)
    }
    hasCheckedPreviousProgress.value = true
    return
  }

  // 2. 否则，从 SQLite 异步检索当前被试此单个量表是否有 incomplete 记录
  const routeQuery = router.currentRoute.value.query
  if (routeQuery.resumeTestId) {
    resumeTestId.value = parseInt(routeQuery.resumeTestId as string)
    await restoreProgress(resumeTestId.value)
    hasCheckedPreviousProgress.value = true
    return
  }

  try {
    const rows = await window.electronAPI.dbQuery(
      `SELECT id, result_json FROM tests 
       WHERE user_id = ? AND scale_id = ? AND status = 'incomplete' 
       ORDER BY created_at DESC LIMIT 1`,
      [userStore.currentUser.id, scale.value.id]
    )
    if (rows && rows.length > 0) {
      detectedIncompleteId.value = rows[0].id
      let progress = { answers: {} }
      try {
        progress = JSON.parse(rows[0].result_json || '{}')
      } catch (err) {}
      detectedAnsweredCount.value = progress.answers ? Object.keys(progress.answers).length : 0
      showRestoreAlert.value = true
    }
  } catch (err) {
    console.error('查询历史未完成记录失败:', err)
  }
  hasCheckedPreviousProgress.value = true
}

async function restoreProgress(testId: number) {
  try {
    const rows = await window.electronAPI.dbQuery(
      'SELECT id, result_json FROM tests WHERE id = ?',
      [testId]
    )
    if (rows && rows.length > 0) {
      const progress = JSON.parse(rows[0].result_json || '{}')
      if (progress.answers) {
        testStore.answers = progress.answers
      }
      if (progress.currentQuestionIndex !== undefined) {
        testStore.currentQuestionIndex = progress.currentQuestionIndex
      }
      if (progress.markedQuestions) {
        testStore.markedQuestions = new Set(progress.markedQuestions)
      }
      if (progress.elapsedSeconds !== undefined) {
        elapsedSeconds.value = progress.elapsedSeconds
      }
      resumeTestId.value = testId
      ElMessage.success('已成功恢复上次作答进度！')
    }
  } catch (e) {
    console.error('恢复进度失败:', e)
    ElMessage.error('恢复进度失败')
  }
}

async function handleRestoreProgress() {
  if (detectedIncompleteId.value !== null) {
    await restoreProgress(detectedIncompleteId.value)
    showRestoreAlert.value = false
  }
}

async function handleRestartProgress() {
  if (detectedIncompleteId.value !== null) {
    try {
      await window.electronAPI.deleteTest(detectedIncompleteId.value)
      ElMessage.success('已清除旧进度，重新开始答题')
    } catch (e) {
      console.error('清除旧进度失败:', e)
    }
  }
  showRestoreAlert.value = false
}

onMounted(async () => {
  if (!scale.value) {
    ElMessage.error('量表不存在')
    router.push('/')
    return
  }
  
  // 进入答题界面，通过 IPC 禁用窗口控制按钮
  if (window.electronAPI && typeof window.electronAPI.windowDisableControls === 'function') {
    await window.electronAPI.windowDisableControls()
  }

  testStore.initTest(scale.value)
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('shortcut-save-submit', handleShortcutSaveSubmit)
  
  // 检查并自动设定自动朗读初始勾选状态
  initTtsToggle()

  // 检查是否有未完成的答题进度
  await checkForIncompleteProgress()
})

onBeforeUnmount(async () => {
  stopTimer()
  stopSpeaking()
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('shortcut-save-submit', handleShortcutSaveSubmit)
  
  // 退出答题界面，通过 IPC 恢复窗口控制按钮
  if (window.electronAPI && typeof window.electronAPI.windowEnableControls === 'function') {
    await window.electronAPI.windowEnableControls()
  }
})

function handleShortcutSaveSubmit() {
  submitTest()
}

// 监听题号变化，切题时自动停止朗读并朗读新题目
watch(() => testStore.currentQuestionIndex, () => {
  stopSpeaking()
  if (ttsEnabled.value && !showGuide.value) {
    speakCurrentQuestion()
  }
})

watch(scaleId, (newId) => {
  const s = scaleStore.getScaleById(newId)
  if (s) {
    testStore.initTest(s)
    showGuide.value = true
    elapsedSeconds.value = 0
    initTtsToggle()
  }
})
</script>

<template>
  <div
    class="test-view"
    :class="{
      'bg-eye': settingsStore.testPageBg === 'eye',
      'bg-contrast': settingsStore.testPageBg === 'contrast'
    }"
  >
    <!-- 指导语弹窗 -->
    <el-dialog
      v-model="showGuide"
      title="测评指导语"
      width="600px"
      :close-on-click-modal="false"
      :show-close="false"
      align-center
    >
      <div class="guide-content" v-if="scale">
        <h3>{{ scale.name }}</h3>
        <p>{{ scale.description }}</p>
        <el-divider />
        <p><strong>题目数量：</strong>{{ scale.questions.length }} 题</p>
        <p v-if="scale.settings.timeLimit"><strong>时间限制：</strong>{{ scale.settings.timeLimit }} 分钟</p>
        <p><strong>允许返回：</strong>{{ scale.settings.allowBacktrack ? '是' : '否' }}</p>
        <p><strong>允许跳过：</strong>{{ scale.settings.allowSkip ? '是' : '否' }}</p>
        <el-alert
          title="答题提示"
          type="info"
          :closable="false"
          style="margin-top: 16px"
        >
          <p>• 可使用键盘数字键 1-{{ Math.min(scale.questions[0]?.options.length || 4, 9) }} 快速选择</p>
          <p>• 方向键 ← → 切换题目</p>
          <p>• 点击底部题号网格可快速跳转</p>
        </el-alert>

        <!-- 启用语音朗读的勾选项，只有在支持语音朗读时才展示 -->
        <div v-if="isSpeechSupported" style="margin-top: 16px; display: flex; align-items: center; justify-content: flex-start;">
          <el-checkbox v-model="ttsEnabled" size="large">
            <span style="font-size: 15px; display: inline-flex; align-items: center; gap: 4px;">
              <span>🔊</span> 启用语音朗读
            </span>
          </el-checkbox>
        </div>
      </div>
      <template #footer>
        <el-button type="primary" size="large" @click="confirmGuide">
          我已了解，开始测评
        </el-button>
      </template>
    </el-dialog>

    <!-- 答题界面 -->
    <template v-if="!showGuide && scale && currentQuestion">
      <!-- 答题恢复进度提示条 (el-alert) -->
      <el-alert
        v-if="showRestoreAlert"
        type="warning"
        show-icon
        :closable="false"
        style="border-radius: 0; padding: 12px 24px;"
      >
        <template #title>
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; width: 100%; gap: 12px;">
            <span>检测到您上次测评未完成的进度（已答 {{ detectedAnsweredCount }}/{{ scale.questions.length }} 题），是否恢复？</span>
            <div style="display: flex; gap: 8px;">
              <el-button type="success" size="small" @click="handleRestoreProgress">恢复并继续</el-button>
              <el-button type="danger" size="small" plain @click="handleRestartProgress">重新开始</el-button>
            </div>
          </div>
        </template>
      </el-alert>

      <!-- 顶部信息栏 -->
      <div class="test-header no-print" style="position: relative;">
        <div class="header-left-area">
          <el-button @click="saveProgressAndExit" circle class="back-btn">
            <el-icon><ArrowLeft /></el-icon>
          </el-button>
          <div class="title-container">
            <div class="scale-name" :title="scale.name">{{ scale.name }}</div>
            <div v-if="isBatch" class="batch-indicator">
              (连续测评中: {{ currentScaleIndex + 1 }}/{{ scaleIds.length }})
            </div>
          </div>
        </div>
        <!-- 进度条移至屏幕正中间绝对定位 -->
        <div class="header-center-area" style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 12px; z-index: 10;">
          <el-progress
            :percentage="progressPercent"
            :show-text="false"
            style="width: 300px; margin: 0;"
          />
          <span class="progress-text" style="font-weight: 600;">{{ testStore.currentQuestionIndex + 1 }} / {{ scale.questions.length }}</span>
        </div>
        <div class="header-right-area">
          <div class="control-row" style="margin-top: 4px;">
            <el-button
              :type="isPaused ? 'success' : 'warning'"
              size="small"
              @click="togglePause"
            >
              {{ isPaused ? '恢复答题' : '暂停答题' }}
            </el-button>
            <el-tag type="info" class="timer-tag">
              <el-icon><Timer /></el-icon>
              {{ formatTime(elapsedSeconds) }}
            </el-tag>
          </div>
        </div>
      </div>

      <!-- 他评量表警示红色提示条 -->
      <el-alert
        v-if="isClinicianScale"
        title="【注意】本量表为临床他评量表，需由受过培训的医生或心理师评定，患者自评结果仅供参考。"
        type="error"
        :closable="false"
        show-icon
        style="border-radius: 0; text-align: center; font-weight: bold; justify-content: center;"
      />

      <!-- 题目区域 -->
      <div class="question-area" :class="settingsStore.fontSizeClass()">
        <!-- 暂停答题模糊遮罩 -->
        <transition name="fade">
          <div v-if="isPaused" class="pause-overlay">
            <div class="pause-container">
              <el-icon class="pause-icon" size="48"><VideoPlay /></el-icon>
              <h2 class="pause-title">答题已暂停</h2>
              <p class="pause-desc">当前计时与语音朗读已挂起，点击下方按钮恢复作答</p>
              <el-button type="primary" size="large" class="resume-btn" @click="togglePause">
                <el-icon style="margin-right: 6px;"><VideoPlay /></el-icon> 恢复答题
              </el-button>
            </div>
          </div>
        </transition>

        <el-card class="question-card" shadow="never">
          <div class="question-number" v-if="settingsStore.showQuestionNumber">
            第 {{ testStore.currentQuestionIndex + 1 }} 题
            <el-icon
              class="mark-icon"
              :class="{ marked: testStore.markedQuestions.has(currentQuestion.id) }"
              @click="testStore.toggleMark(currentQuestion.id)"
            >
              <Flag />
            </el-icon>
          </div>
          <h3 class="question-text">{{ currentQuestion.text }}</h3>
          <p v-if="currentQuestion.subText" class="question-subtext">{{ currentQuestion.subText }}</p>

          <div class="options-list">
            <div
              v-for="(opt, idx) in currentQuestion.options"
              :key="idx"
              class="option-item"
              :class="{ selected: testStore.answers[currentQuestion.id]?.value === opt.value }"
              @click="selectOption(opt.value, opt.score)"
            >
              <span class="option-key">{{ String.fromCharCode(65 + idx) }}</span>
              <span class="option-label">{{ opt.label }}</span>
              <!-- 朗读当前选项的小喇叭按钮 -->
              <el-button 
                v-if="isSpeechSupported"
                type="text" 
                size="small" 
                class="speak-option-btn" 
                @click.stop="speakText(opt.label, true)"
                style="padding: 4px; margin-right: 8px;"
              >
                🔊
              </el-button>
              <span class="option-hint">{{ idx + 1 }}</span>
            </div>
          </div>
        </el-card>
      </div>

      <!-- 底部浮动语音朗读控制栏 -->
      <div v-if="isSpeechSupported && ttsEnabled" class="tts-control-bar no-print">
        <div class="tts-control-content">
          <span class="tts-label">🔊 语音播报中</span>
          <div class="tts-btns">
            <!-- 播放/暂停控制 -->
            <el-button 
              v-if="!isTtsPaused && isTtsSpeaking" 
              type="warning" 
              size="small" 
              circle 
              @click="pauseSpeaking"
              title="暂停"
            >
              ⏸
            </el-button>
            <el-button 
              v-else 
              type="success" 
              size="small" 
              circle 
              @click="isTtsPaused ? resumeSpeaking() : speakCurrentQuestion()"
              title="播放"
            >
              ▶
            </el-button>
            <el-button 
              type="danger" 
              size="small" 
              circle 
              @click="stopSpeaking"
              title="停止"
            >
              ⏹
            </el-button>
          </div>
        </div>
      </div>

      <!-- 底部导航 -->
      <div class="test-footer no-print">
        <div class="footer-nav">
          <el-button
            :disabled="isFirstQuestion || !scale.settings.allowBacktrack"
            @click="prevQuestion"
          >
            <el-icon><ArrowLeft /></el-icon>
            上一题
          </el-button>

          <el-button
            v-if="!isLastQuestion || !isLastQuestionAnswered"
            type="primary"
            @click="testStore.nextQuestion()"
          >
            下一题
            <el-icon><ArrowRight /></el-icon>
          </el-button>

          <el-button
            v-else
            type="success"
            @click="submitTest"
          >
            <el-icon><Check /></el-icon>
            提交
          </el-button>
        </div>

        <!-- 题号网格 -->
        <div class="question-grid" :class="{ 'large-scale': scale.questions.length > 100 }">
          <div
            v-for="(q, idx) in scale.questions"
            :key="q.id"
            class="grid-cell"
            :class="{
              current: idx === testStore.currentQuestionIndex,
              answered: testStore.answers[q.id] !== undefined,
              marked: testStore.markedQuestions.has(q.id)
            }"
            @click="goToQuestion(idx)"
          >
            {{ idx + 1 }}
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.test-view {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--app-bg, #f5f7fa);
  overflow: hidden;
  position: relative;
}

/* 答题页面自定义背景支持 */

/* 1. 浅色模式 - 护眼绿色 */
.test-view.bg-eye {
  background-color: #f0f9eb !important;
  color: #2c3e50 !important;
}
.test-view.bg-eye .test-header,
.test-view.bg-eye .test-footer {
  background-color: #eaf6e1 !important;
  border-color: #d1ebd1 !important;
}
.test-view.bg-eye .question-card {
  background-color: #eaf6e1 !important;
  border-color: #c2e7b0 !important;
  color: #2c3e50 !important;
}
.test-view.bg-eye .question-text {
  color: #1d331d !important;
}
.test-view.bg-eye .option-item {
  background-color: #f2fbf0 !important;
  border-color: #d1ebd1 !important;
  color: #2c3e50 !important;
}
.test-view.bg-eye .option-item:hover, 
.test-view.bg-eye .option-item.selected {
  border-color: var(--el-color-success) !important;
  background-color: #e1f5e1 !important;
  color: var(--el-color-success) !important;
}
.test-view.bg-eye .option-key {
  background-color: #d1ebd1 !important;
  color: #1d331d !important;
}
.test-view.bg-eye .option-label {
  color: #2c3e50 !important;
}
.test-view.bg-eye .grid-cell {
  background-color: #f2fbf0 !important;
  border-color: #d1ebd1 !important;
  color: #2c3e50 !important;
}
.test-view.bg-eye .grid-cell:hover {
  border-color: var(--el-color-success) !important;
}
.test-view.bg-eye .grid-cell.current {
  background-color: var(--el-color-success) !important;
  border-color: var(--el-color-success) !important;
  color: #fff !important;
}
.test-view.bg-eye .grid-cell.answered {
  background-color: #e1f5e1 !important;
  border-color: #c2e7b0 !important;
}

/* 2. 深色模式 - 护眼绿色 (暗绿/墨绿，温和不刺眼) */
.dark .test-view.bg-eye {
  background-color: #0d1a0d !important;
  color: #a3c2a3 !important;
}
.dark .test-view.bg-eye .test-header,
.dark .test-view.bg-eye .test-footer {
  background-color: #142614 !important;
  border-color: #223c22 !important;
}
.dark .test-view.bg-eye .question-card {
  background-color: #142614 !important;
  border-color: #223c22 !important;
  color: #e0eee0 !important;
}
.dark .test-view.bg-eye .question-text {
  color: #ffffff !important;
}
.dark .test-view.bg-eye .option-item {
  background-color: #182e18 !important;
  border-color: #223c22 !important;
  color: #d0edd0 !important;
}
.dark .test-view.bg-eye .option-item:hover, 
.dark .test-view.bg-eye .option-item.selected {
  border-color: #4cd964 !important;
  background-color: #203f20 !important;
  color: #4cd964 !important;
}
.dark .test-view.bg-eye .option-key {
  background-color: #223c22 !important;
  color: #e0eee0 !important;
}
.dark .test-view.bg-eye .option-label {
  color: #d0edd0 !important;
}
.dark .test-view.bg-eye .grid-cell {
  background-color: #182e18 !important;
  border-color: #223c22 !important;
  color: #a3c2a3 !important;
}
.dark .test-view.bg-eye .grid-cell:hover {
  border-color: #4cd964 !important;
}
.dark .test-view.bg-eye .grid-cell.current {
  background-color: #4cd964 !important;
  border-color: #4cd964 !important;
  color: #0d1a0d !important;
}
.dark .test-view.bg-eye .grid-cell.answered {
  background-color: #203f20 !important;
  border-color: #2c542c !important;
}

/* 3. 浅色模式 - 高对比度 (白底黑字，纯色黑白反差) */
.test-view.bg-contrast {
  background-color: #ffffff !important;
  color: #000000 !important;
}
.test-view.bg-contrast .test-header,
.test-view.bg-contrast .test-footer {
  background-color: #ffffff !important;
  border-color: #000000 !important;
  color: #000000 !important;
}
.test-view.bg-contrast .question-card {
  background-color: #ffffff !important;
  border: 3px solid #000000 !important;
  color: #000000 !important;
}
.test-view.bg-contrast .question-text {
  color: #000000 !important;
  font-weight: 900 !important;
}
.test-view.bg-contrast .option-item {
  background-color: #ffffff !important;
  border: 2px solid #000000 !important;
  color: #000000 !important;
}
.test-view.bg-contrast .option-item:hover, 
.test-view.bg-contrast .option-item.selected {
  border-color: #000000 !important;
  background-color: #000000 !important;
  color: #ffffff !important;
}
.test-view.bg-contrast .option-item:hover .option-label,
.test-view.bg-contrast .option-item.selected .option-label {
  color: #ffffff !important;
}
.test-view.bg-contrast .option-item:hover .option-key,
.test-view.bg-contrast .option-item.selected .option-key {
  background-color: #ffffff !important;
  color: #000000 !important;
}
.test-view.bg-contrast .option-key {
  background-color: #000000 !important;
  color: #ffffff !important;
}
.test-view.bg-contrast .option-label {
  color: #000000 !important;
  font-weight: bold !important;
}
.test-view.bg-contrast .grid-cell {
  background-color: #ffffff !important;
  border: 1px solid #000000 !important;
  color: #000000 !important;
  font-weight: bold !important;
}
.test-view.bg-contrast .grid-cell:hover {
  background-color: #000000 !important;
  color: #ffffff !important;
}
.test-view.bg-contrast .grid-cell.current {
  background-color: #000000 !important;
  border-color: #000000 !important;
  color: #ffffff !important;
}
.test-view.bg-contrast .grid-cell.answered {
  background-color: #e0e0e0 !important;
  border-color: #000000 !important;
}

/* 4. 深色模式 - 高对比度 (黑底黄字，经典的极客高对比度) */
.dark .test-view.bg-contrast {
  background-color: #000000 !important;
  color: #ffff00 !important;
}
.dark .test-view.bg-contrast .test-header,
.dark .test-view.bg-contrast .test-footer {
  background-color: #000000 !important;
  border-color: #ffff00 !important;
  color: #ffff00 !important;
}
.dark .test-view.bg-contrast .question-card {
  background-color: #000000 !important;
  border: 3px solid #ffff00 !important;
  color: #ffffff !important;
}
.dark .test-view.bg-contrast .question-text {
  color: #ffff00 !important;
  font-weight: bold !important;
}
.dark .test-view.bg-contrast .option-item {
  background-color: #000000 !important;
  border: 2px solid #ffffff !important;
  color: #ffffff !important;
}
.dark .test-view.bg-contrast .option-item:hover, 
.dark .test-view.bg-contrast .option-item.selected {
  border-color: #ffff00 !important;
  background-color: #ffff00 !important;
  color: #000000 !important;
}
.dark .test-view.bg-contrast .option-item:hover .option-label,
.dark .test-view.bg-contrast .option-item.selected .option-label {
  color: #000000 !important;
}
.dark .test-view.bg-contrast .option-item:hover .option-key,
.dark .test-view.bg-contrast .option-item.selected .option-key {
  background-color: #000000 !important;
  color: #ffff00 !important;
}
.dark .test-view.bg-contrast .option-key {
  background-color: #444444 !important;
  color: #ffffff !important;
}
.dark .test-view.bg-contrast .option-label {
  color: #ffffff !important;
}
.dark .test-view.bg-contrast .grid-cell {
  background-color: #000000 !important;
  border: 1px solid #ffffff !important;
  color: #ffffff !important;
}
.dark .test-view.bg-contrast .grid-cell:hover {
  background-color: #ffff00 !important;
  color: #000000 !important;
}
.dark .test-view.bg-contrast .grid-cell.current {
  background-color: #ffff00 !important;
  border-color: #ffff00 !important;
  color: #000000 !important;
}
.dark .test-view.bg-contrast .grid-cell.answered {
  background-color: #333333 !important;
  border-color: #ffff00 !important;
}

.test-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: var(--app-card, #fff);
  border-bottom: 1px solid var(--el-border-color);
  /* 为 macOS titleBarStyle hiddenInset 流量控制灯预留左侧拖拽/安全空间，如果有隐藏侧边栏的全屏需求 */
  padding-left: 80px;
  flex-shrink: 0;
}

.header-left-area {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  margin-right: 24px;
}

.title-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.scale-name {
  font-weight: 600;
  font-size: 18px !important;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
  text-align: left;
}

.batch-indicator {
  font-size: 12px;
  color: var(--el-color-primary);
  line-height: 1.2;
  text-align: left;
}

.header-right-area {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-text {
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

.question-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 24px;
  position: relative; /* 必须加 relative 使得绝对定位的暂停遮罩层能精准遮蔽本区域 */
  overflow-y: auto;
}

/* 暂停答题模糊遮罩样式 */
.pause-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(245, 247, 250, 0.45);
  backdrop-filter: blur(16px) saturate(125%);
  -webkit-backdrop-filter: blur(16px) saturate(125%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  transition: all 0.3s ease;
  border-radius: 8px;
}

.dark .pause-overlay {
  background-color: rgba(20, 20, 20, 0.55);
}

/* 绿色护眼模式下的遮罩背景 */
.bg-eye .pause-overlay {
  background-color: rgba(240, 249, 235, 0.5);
}
.dark.bg-eye .pause-overlay {
  background-color: rgba(13, 26, 13, 0.6);
}

/* 高对比度模式下的遮罩背景 (高对比度通常不宜过度使用高斯模糊，所以降低模糊度并提供黑白纯色遮蔽) */
.bg-contrast .pause-overlay {
  background-color: rgba(255, 255, 255, 0.95);
  backdrop-filter: none;
}
.dark.bg-contrast .pause-overlay {
  background-color: rgba(0, 0, 0, 0.95);
  backdrop-filter: none;
}

.pause-container {
  text-align: center;
  padding: 40px;
  background: var(--fluent-card-bg, rgba(255, 255, 255, 0.8));
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--fluent-card-border, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
  max-width: 420px;
  width: 90%;
  box-sizing: border-box;
}

.dark .pause-container {
  background: rgba(45, 45, 45, 0.85);
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
}

.bg-contrast .pause-container {
  background: #ffffff;
  border: 3px solid #000000;
  box-shadow: none;
}

.dark.bg-contrast .pause-container {
  background: #000000;
  border: 3px solid #ffff00;
  box-shadow: none;
}

.pause-icon {
  color: var(--el-color-warning);
  margin-bottom: 16px;
  animation: pulse 2s infinite ease-in-out;
}

.bg-contrast .pause-icon {
  color: #000000;
}
.dark.bg-contrast .pause-icon {
  color: #ffff00;
}

.pause-title {
  margin: 0 0 8px 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--fluent-text-primary, #1c1c1c);
}

.bg-contrast .pause-title {
  color: #000000;
}
.dark.bg-contrast .pause-title {
  color: #ffff00;
}

.pause-desc {
  margin: 0 0 24px 0;
  font-size: 14px;
  color: var(--fluent-text-secondary, #5d5d5d);
  line-height: 1.5;
}

.bg-contrast .pause-desc {
  color: #000000;
  font-weight: bold;
}
.dark.bg-contrast .pause-desc {
  color: #ffffff;
}

.resume-btn {
  padding: 12px 28px !important;
  font-size: 15px !important;
  font-weight: 600 !important;
  height: 40px !important;
  border-radius: 6px !important;
}

.bg-contrast .resume-btn {
  background-color: #000000 !important;
  color: #ffffff !important;
  border: 2px solid #000000 !important;
}
.bg-contrast .resume-btn:hover {
  background-color: #ffffff !important;
  color: #000000 !important;
}

.dark.bg-contrast .resume-btn {
  background-color: #ffff00 !important;
  color: #000000 !important;
  border: 2px solid #ffff00 !important;
}
.dark.bg-contrast .resume-btn:hover {
  background-color: #000000 !important;
  color: #ffff00 !important;
}

/* 渐变过渡动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@keyframes pulse {
  0% { transform: scale(1); opacity: 0.95; }
  50% { transform: scale(1.05); opacity: 1; }
  100% { transform: scale(1); opacity: 0.95; }
}

.question-card {
  width: 100%;
  max-width: 700px;
  padding: 32px;
  margin: auto;
}

.question-number {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--el-text-color-secondary);
  margin-bottom: 16px;
}

.mark-icon {
  cursor: pointer;
  color: var(--el-text-color-secondary);
  transition: color 0.2s;
}

.mark-icon.marked {
  color: #e6a23c;
}

.question-text {
  font-size: 22px;
  line-height: 1.6;
  margin: 0 0 12px;
  font-weight: 500;
}

.question-subtext {
  font-size: 14px;
  color: var(--el-text-color-secondary);
  margin-bottom: 24px;
}

.options-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.option-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border: 2px solid var(--el-border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.option-item:hover {
  border-color: var(--el-color-primary);
  background: var(--el-fill-color-light);
}

.option-item.selected {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.option-key {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--el-fill-color);
  font-weight: 600;
  font-size: 14px;
}

.option-label {
  flex: 1;
  font-size: 16px;
}

.option-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.test-footer {
  background: var(--app-card, #fff);
  border-top: 1px solid var(--el-border-color);
  padding: 16px 24px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.footer-nav {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-bottom: 16px;
  flex-shrink: 0;
}

.question-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
  gap: 6px;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
  max-height: 35vh;
  overflow-y: auto;
  padding-right: 4px; /* offset for scrollbar */
}

/* 小屏适配：窗口高度较矮时，限制题号区域最大高度为 30vh */
@media (max-height: 768px) {
  .question-grid {
    max-height: 30vh;
  }
}

.question-grid.large-scale {
  grid-template-columns: repeat(auto-fill, minmax(28px, 1fr));
  gap: 4px;
}

.grid-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color);
  transition: all 0.2s;
}

.question-grid.large-scale .grid-cell {
  height: 28px;
  font-size: 12px;
}

.grid-cell:hover {
  border-color: var(--el-color-primary);
}

.grid-cell.current {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary);
  color: #fff;
}

.grid-cell.answered {
  background: var(--el-color-success-light-9);
  border-color: var(--el-color-success);
}

.grid-cell.marked {
  position: relative;
}

.grid-cell.marked::after {
  content: '';
  position: absolute;
  top: 2px;
  right: 2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #e6a23c;
}

.guide-content h3 {
  margin-top: 0;
}

/* 字体大小 */
.fs-small .question-text { font-size: 18px; }
.fs-small .option-label { font-size: 14px; }
.fs-medium .question-text { font-size: 22px; }
.fs-large .question-text { font-size: 26px; }
.fs-large .option-label { font-size: 18px; }
.fs-xlarge .question-text { font-size: 30px; }
.fs-xlarge .option-label { font-size: 20px; }

.dark .test-header,
.dark .question-card,
.dark .test-footer {
  background: var(--app-card, #16213e);
  color: var(--app-text, #e0e0e0);
}

.dark .option-item {
  border-color: #2a2a4a;
}

.dark .option-item:hover {
  border-color: var(--el-color-primary);
}

/* 语音朗读浮动控制栏样式 */
.tts-control-bar {
  position: fixed;
  bottom: 120px;
  right: 24px;
  z-index: 1000;
  background: var(--app-card, #fff);
  border: 1px solid var(--el-border-color);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  border-radius: 20px;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.tts-control-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.tts-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
  font-weight: 500;
}

.tts-btns {
  display: flex;
  gap: 6px;
}

.tts-btns .el-button {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  border: none;
}

.speak-option-btn {
  font-size: 16px;
  opacity: 0.6;
  transition: opacity 0.2s, transform 0.2s;
}

.speak-option-btn:hover {
  opacity: 1;
  transform: scale(1.15);
}

.dark .tts-control-bar {
  background: var(--app-card, #1e2a4a);
  border-color: #2a3a5a;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}

.dark .tts-label {
  color: var(--app-text, #e0e0e0);
}
</style>

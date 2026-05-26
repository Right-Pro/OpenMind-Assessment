import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ScaleDefinition, AnswerRecord, TestResult } from '@/types'
import { useAuthStore } from '@/stores/authStore'

export const useTestStore = defineStore('test', () => {
  const currentScale = ref<ScaleDefinition | null>(null)
  const answers = ref<Record<string | number, AnswerRecord>>({})
  const markedQuestions = ref<Set<string | number>>(new Set())
  const currentQuestionIndex = ref(0)
  const startTime = ref(0)
  const duration = ref(0)
  const result = ref<TestResult | null>(null)
  const warnings = ref<string[]>([])

  function initTest(scale: ScaleDefinition) {
    currentScale.value = scale
    answers.value = {}
    markedQuestions.value = new Set()
    currentQuestionIndex.value = 0
    startTime.value = Date.now()
    duration.value = 0
    result.value = null
    warnings.value = []
  }

  function answerQuestion(questionId: string | number, optionValue: number | string, score: number) {
    answers.value[questionId] = {
      questionId,
      value: optionValue,
      score
    }
  }

  // Set answers when restoring progress
  function setAnswers(savedAnswers: Record<string | number, AnswerRecord>) {
    answers.value = { ...savedAnswers }
  }

  function toggleMark(questionId: string | number) {
    if (markedQuestions.value.has(questionId)) {
      markedQuestions.value.delete(questionId)
    } else {
      markedQuestions.value.add(questionId)
    }
  }

  function goToQuestion(index: number) {
    if (currentScale.value && index >= 0 && index < currentScale.value.questions.length) {
      currentQuestionIndex.value = index
    }
  }

  function nextQuestion() {
    if (currentScale.value && currentQuestionIndex.value < currentScale.value.questions.length - 1) {
      currentQuestionIndex.value++
    }
  }

  function prevQuestion() {
    if (currentQuestionIndex.value > 0) {
      currentQuestionIndex.value--
    }
  }

  function finishTest() {
    duration.value = Math.floor((Date.now() - startTime.value) / 1000)
  }

  function setResult(res: TestResult) {
    result.value = res
  }

  function addWarning(w: string) {
    warnings.value.push(w)
  }

  function clearTest() {
    currentScale.value = null
    answers.value = {}
    markedQuestions.value = new Set()
    currentQuestionIndex.value = 0
    startTime.value = 0
    duration.value = 0
    result.value = null
    warnings.value = []
  }

  async function updateDoctorNote(testId: number, doctorNote: string, reportDoctor: string) {
    if (window.electronAPI) {
      await window.electronAPI.dbRun(
        "UPDATE tests SET doctorNote = ?, reportDoctor = ? WHERE id = ?",
        [doctorNote || null, reportDoctor || null, testId]
      )
    } else {
      const localTestsStr = localStorage.getItem('local_tests') || '[]'
      let localTests = JSON.parse(localTestsStr)
      localTests = localTests.map((t: any) => 
        t.id === testId ? { ...t, doctorNote, reportDoctor } : t
      )
      localStorage.setItem('local_tests', JSON.stringify(localTests))
    }
    return true
  }

  async function saveTestResult(userId: number, testResult: TestResult): Promise<number> {
    const scaleId = testResult.scaleId
    const scaleName = testResult.scaleName
    const rawScore = testResult.rawScore
    const stdScore = testResult.stdScore
    const durationSeconds = testResult.duration
    const resultJson = JSON.stringify(testResult)
    const createdAt = new Date().toISOString()
    
    // 获取当前登录的操作员 ID
    const authStore = useAuthStore()
    const operatorId = authStore.currentOperator?.id || null

    if (window.electronAPI) {
      // Save to SQLite including operator_id
      const dbResult = await window.electronAPI.dbRun(
        `INSERT INTO tests (user_id, scale_id, scale_name, raw_score, std_score, result_json, duration_seconds, operator_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
        [
          userId,
          scaleId,
          scaleName,
          rawScore,
          stdScore,
          resultJson,
          durationSeconds,
          operatorId
        ]
      ) as any

      const testId = dbResult.lastInsertRowid as number

      for (const ans of testResult.answers) {
        await window.electronAPI.dbRun(
          "INSERT INTO answers (test_id, question_id, option_value, score) VALUES (?, ?, ?, ?)",
          [testId, String(ans.questionId), String(ans.value), ans.score]
        )
      }

      return testId
    } else {
      // Save to localStorage
      const localTestsStr = localStorage.getItem('local_tests') || '[]'
      const localTests = JSON.parse(localTestsStr)
      const testId = Date.now()

      const newTest = {
        id: testId,
        user_id: userId,
        scale_id: scaleId,
        scale_name: scaleName,
        raw_score: rawScore,
        std_score: stdScore,
        result_json: resultJson,
        duration_seconds: durationSeconds,
        created_at: createdAt
      }

      localTests.unshift(newTest)
      localStorage.setItem('local_tests', JSON.stringify(localTests))

      // Also save answers
      const localAnswersStr = localStorage.getItem('local_answers') || '[]'
      const localAnswers = JSON.parse(localAnswersStr)
      for (const ans of testResult.answers) {
        localAnswers.push({
          test_id: testId,
          question_id: String(ans.questionId),
          option_value: String(ans.value),
          score: ans.score,
          created_at: createdAt
        })
      }
      localStorage.setItem('local_answers', JSON.stringify(localAnswers))

      return testId
    }
  }

  // Deprecated: legacy helper
  async function saveTestToDB(userId: number | null, testResult: TestResult): Promise<number> {
    if (userId === null) throw new Error('User ID is required to save test results.')
    return saveTestResult(userId, testResult)
  }

  return {
    currentScale,
    answers,
    markedQuestions,
    currentQuestionIndex,
    startTime,
    duration,
    result,
    warnings,
    initTest,
    answerQuestion,
    setAnswers,
    toggleMark,
    goToQuestion,
    nextQuestion,
    prevQuestion,
    finishTest,
    setResult,
    addWarning,
    clearTest,
    updateDoctorNote,
    saveTestResult,
    saveTestToDB
  }
})

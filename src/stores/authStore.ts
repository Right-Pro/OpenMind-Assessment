import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface Operator {
  id: number
  username: string
  name: string
  role: 'admin' | 'operator'
}

export const useAuthStore = defineStore('auth', () => {
  const currentOperator = ref<Operator | null>(null)

  // 从本地加载已登录操作员信息
  const loadSavedOperator = () => {
    // 使用 sessionStorage 存储，以保证每次关闭/重新打开软件都需要重新登录，
    // 但在同一个软件生命周期内刷新页面（例如切换被试时）可以保持登录状态。
    try {
      const saved = sessionStorage.getItem('current_operator')
      if (saved) {
        currentOperator.value = JSON.parse(saved)
      } else {
        currentOperator.value = null
      }
    } catch (e) {
      currentOperator.value = null
    }
  }

  const setOperator = (op: Operator | null) => {
    currentOperator.value = op
    if (op) {
      sessionStorage.setItem('current_operator', JSON.stringify(op))
    } else {
      sessionStorage.removeItem('current_operator')
    }
  }

  const logout = () => {
    setOperator(null)
  }

  return {
    currentOperator,
    loadSavedOperator,
    setOperator,
    logout
  }
})

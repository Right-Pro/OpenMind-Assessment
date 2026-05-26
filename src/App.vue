<script setup lang="ts">
import { onMounted, watch, ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useSettingsStore } from '@/stores/settingsStore'
import { useScaleStore } from '@/stores/scaleStore'
import { useUserStore } from '@/stores/userStore'
import { useAuthStore } from '@/stores/authStore'
import type { User } from '@/types'

const settingsStore = useSettingsStore()
const scaleStore = useScaleStore()
const userStore = useUserStore()
const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

// 窗口控制相关的状态
const isMaximized = ref(false)

const checkMaximizedState = async () => {
  if (window.electronAPI && typeof window.electronAPI.windowIsMaximized === 'function') {
    isMaximized.value = await window.electronAPI.windowIsMaximized()
  }
}

const handleMinimize = () => {
  if (window.electronAPI && typeof window.electronAPI.windowMinimize === 'function') {
    window.electronAPI.windowMinimize()
  }
}

const handleMaximize = async () => {
  if (window.electronAPI && typeof window.electronAPI.windowMaximize === 'function') {
    await window.electronAPI.windowMaximize()
    await checkMaximizedState()
  }
}

const handleClose = () => {
  if (window.electronAPI && typeof window.electronAPI.windowClose === 'function') {
    window.electronAPI.windowClose()
  }
}

const handleDoubleClick = () => {
  handleMaximize()
}

let resizeInterval: any = null

// 操作员登录注册状态
const showLogin = ref(false)
const showFirstRegister = ref(false)
const isFirstRunChecked = ref(false)
const loginForm = ref({
  username: '',
  password: ''
})
const firstRegisterForm = ref({
  username: '',
  name: '',
  password: '',
  confirmPassword: ''
})

const showPrivacy = ref(false)
const showUserSelect = ref(false)
const userSelectForm = ref<{
  selectedUserId: number | ''
  name: string
  gender: 'male' | 'female' | ''
  birthdate: string
  contact: string
  notes: string
}>({
  selectedUserId: '',
  name: '',
  gender: '',
  birthdate: '',
  contact: '',
  notes: ''
})

const isCreatingNew = ref(false)

const currentPath = computed(() => route.path)

let unsubscribeNavigate: (() => void) | null = null

onMounted(async () => {
  await settingsStore.init()
  await scaleStore.loadScales()
  await userStore.loadUsers()
  
  // 校验并加载操作员信息
  authStore.loadSavedOperator()
  
  // 检查是否没有操作员（首次启动）
  if (window.electronAPI) {
    const isEmpty = await window.electronAPI.checkOperatorsEmpty()
    if (isEmpty) {
      showFirstRegister.value = true
    } else if (!authStore.currentOperator) {
      showLogin.value = true
      // 记住用户名
      const savedUser = localStorage.getItem('last_operator_username')
      if (savedUser) {
        loginForm.value.username = savedUser
      }
    }

    // 注册导航事件监听，点击通知后跳转到对应的预约管理页面
    if (typeof window.electronAPI.onNavigate === 'function') {
      unsubscribeNavigate = window.electronAPI.onNavigate((path: string) => {
        router.push(path)
      })
    }
  }

  isFirstRunChecked.value = true

  // 1. 首次启动隐私声明
  if (!settingsStore.privacyAgreed) {
    showPrivacy.value = true
  } else {
    // 2. 如果隐私已同意，但无当前用户，显示选择/创建用户对话框
    checkUserSession()
  }

  // 监听窗口最大化状态
  checkMaximizedState()
  resizeInterval = setInterval(checkMaximizedState, 500)
  window.addEventListener('resize', checkMaximizedState)

  // 注册全局手动触发更新弹窗监听器
  window.addEventListener('open-update-dialog', handleOpenUpdateDialogEvent as EventListener)

  // 应用启动后延迟 15 秒执行自动检查更新
  setTimeout(() => {
    triggerAutoUpdateCheck()
  }, 15000)
})

// 自动更新检测逻辑
function isVersionGreater(v1: string, v2: string): boolean {
  const arr1 = v1.split('.').map(Number)
  const arr2 = v2.split('.').map(Number)
  const len = Math.max(arr1.length, arr2.length)
  for (let i = 0; i < len; i++) {
    const num1 = arr1[i] !== undefined ? arr1[i] : 0
    const num2 = arr2[i] !== undefined ? arr2[i] : 0
    if (num1 > num2) return true
    if (num1 < num2) return false
  }
  return false
}

const showUpdateDialog = ref(false)
const updateInfo = ref({
  latestVersion: '',
  currentVersion: '',
  body: '',
  htmlUrl: ''
})

function handleOpenUpdateDialogEvent(e: CustomEvent) {
  if (e.detail) {
    updateInfo.value = {
      latestVersion: e.detail.latestVersion || '',
      currentVersion: e.detail.currentVersion || '',
      body: e.detail.body || '',
      htmlUrl: e.detail.htmlUrl || 'https://github.com/Right-Pro/OpenMind-Assessment/releases/latest'
    }
    showUpdateDialog.value = true
  }
}

async function triggerAutoUpdateCheck() {
  // 1. 如果用户关闭了自动检查则直接跳过
  if (!settingsStore.autoCheckUpdate) {
    return
  }

  // 增加本地缓存校验（24小时内不再重复请求）
  try {
    const cachedUpdateStr = localStorage.getItem('settings_cached_update_check')
    if (cachedUpdateStr) {
      const cached = JSON.parse(cachedUpdateStr)
      const hours24 = 24 * 60 * 60 * 1000
      if (Date.now() - cached.lastCheck < hours24) {
        console.log('[AutoUpdate] Using cached update result:', cached.lastResult)
        const latestVersion = cached.lastResult
        const currentVersion = '1.0.1' // 与 package.json 保持一致
        
        // 检查是否已被用户忽略且在 3 天内
        try {
          const ignoredRecordStr = localStorage.getItem('settings_ignored_update_version')
          if (ignoredRecordStr) {
            const record = JSON.parse(ignoredRecordStr)
            if (record.ignoredVersion === latestVersion) {
              const threeDays = 3 * 24 * 60 * 60 * 1000
              if (Date.now() - record.ignoredAt < threeDays) {
                return
              }
            }
          }
        } catch (e) {
          console.warn('[AutoUpdate] Error parsing ignored update version from localStorage:', e)
        }

        if (isVersionGreater(latestVersion, currentVersion)) {
          updateInfo.value = {
            latestVersion,
            currentVersion,
            body: '',
            htmlUrl: 'https://github.com/Right-Pro/OpenMind-Assessment/releases.atom'
          }
          showUpdateDialog.value = true
        }
        return
      }
    }
  } catch (e) {
    console.warn('[AutoUpdate] Error reading cached update from localStorage:', e)
  }

  try {
    const res = await fetch('https://github.com/Right-Pro/OpenMind-Assessment/releases.atom', {
      headers: { 'Cache-Control': 'no-cache' }
    })
    if (!res.ok) {
      console.warn(`[AutoUpdate] GitHub RSS returned status ${res.status}`)
      return
    }
    const xmlText = await res.text()
    // 解析 RSS Atom XML
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml')
    const firstEntry = xmlDoc.querySelector('entry')
    if (!firstEntry) {
      console.warn('[AutoUpdate] No entry found in release feed')
      return
    }
    const titleNode = firstEntry.querySelector('title')
    if (!titleNode || !titleNode.textContent) {
      console.warn('[AutoUpdate] No title found in entry')
      return
    }
    const titleText = titleNode.textContent // 例如 "OpenMind Assessment v1.0.1"
    const match = titleText.match(/v([\d.]+)/)
    if (!match) {
      console.warn('[AutoUpdate] Could not extract version from title:', titleText)
      return
    }
    const latestVersion = match[1]
    const currentVersion = '1.0.1' // 与 package.json 保持一致

    // 缓存结果到 localStorage，记录 {lastCheck: timestamp, lastResult: version}
    try {
      localStorage.setItem('settings_cached_update_check', JSON.stringify({
        lastCheck: Date.now(),
        lastResult: latestVersion
      }))
    } catch (e) {
      console.warn('[AutoUpdate] Failed to write cache to localStorage:', e)
    }

    // 检查是否已被用户忽略且在 3 天内
    try {
      const ignoredRecordStr = localStorage.getItem('settings_ignored_update_version')
      if (ignoredRecordStr) {
        const record = JSON.parse(ignoredRecordStr)
        if (record.ignoredVersion === latestVersion) {
          const threeDays = 3 * 24 * 60 * 60 * 1000
          if (Date.now() - record.ignoredAt < threeDays) {
            return
          }
        }
      }
    } catch (e) {
      console.warn('[AutoUpdate] Error parsing ignored update version from localStorage:', e)
    }

    if (isVersionGreater(latestVersion, currentVersion)) {
      updateInfo.value = {
        latestVersion,
        currentVersion,
        body: '',
        htmlUrl: 'https://github.com/Right-Pro/OpenMind-Assessment/releases.atom'
      }
      showUpdateDialog.value = true
    }
  } catch (err) {
    console.warn('[AutoUpdate] Automatic update check failed:', err)
  }
}

function handleIgnoreUpdate() {
  try {
    localStorage.setItem('settings_ignored_update_version', JSON.stringify({
      ignoredVersion: updateInfo.value.latestVersion,
      ignoredAt: Date.now()
    }))
  } catch (e) {
    console.warn('[AutoUpdate] Failed to write ignored version to localStorage:', e)
  }
  showUpdateDialog.value = false
}

function handleDownloadUpdate() {
  if (window.electronAPI && typeof window.electronAPI.showOpenDialog === 'function') {
    // 使用 electron shell 打开浏览器
    // 在主进程中或直接通过 exposeInMainWorld
    // electron/preload.ts 里我们没有暴露 shell 模块，但是我们可以查看 window.electronAPI。
    // 如果没有，直接利用 window.open 或在 App.vue 直接 a 标签跳转，但 Electron 里 shell.openExternal 更优。
    // 我们可以直接让主进程去打开或用 window.open。在 Electron 渲染进程中，window.open() 会被自动拦截或直接打开系统默认浏览器。
    // 现代 Electron 中，在没有 nodeIntegration 的情况下，window.open(url) 可以直接用默认浏览器打开。
    // 我们还可以为了确保完美，先用 window.open。
    window.open(updateInfo.value.htmlUrl)
  } else {
    window.open(updateInfo.value.htmlUrl)
  }
  showUpdateDialog.value = false
}

import { onBeforeUnmount } from 'vue'
onBeforeUnmount(() => {
  if (unsubscribeNavigate) {
    unsubscribeNavigate()
  }
  if (resizeInterval) {
    clearInterval(resizeInterval)
  }
  window.removeEventListener('resize', checkMaximizedState)
  window.removeEventListener('open-update-dialog', handleOpenUpdateDialogEvent as EventListener)
})

function checkUserSession() {
  // 如果尚未登录，不要弹窗干扰登录流程
  if (!authStore.currentOperator) return

  if (!userStore.currentUser) {
    showUserSelect.value = true
    isCreatingNew.value = userStore.users.length === 0
  }
}

async function handleFirstRegister() {
  const { username, name, password, confirmPassword } = firstRegisterForm.value
  if (!username || !name || !password) {
    ElMessage.warning('请填写所有必填字段')
    return
  }
  if (password.length < 6) {
    ElMessage.warning('密码长度至少为 6 位')
    return
  }
  if (password !== confirmPassword) {
    ElMessage.warning('两次输入的密码不一致')
    return
  }

  try {
    const res = await window.electronAPI.registerOperator(username, password, 'admin', name)
    if (res.success) {
      ElMessage.success('管理员账户创建成功并已自动登录！')
      authStore.setOperator(res.operator)
      localStorage.setItem('last_operator_username', username)
      showFirstRegister.value = false
      checkUserSession()
    } else {
      ElMessage.error(res.error || '创建账户失败')
    }
  } catch (e: any) {
    ElMessage.error('注册失败: ' + e.message)
  }
}

async function handleLogin() {
  const { username, password } = loginForm.value
  if (!username || !password) {
    ElMessage.warning('请输入用户名和密码')
    return
  }

  try {
    const res = await window.electronAPI.loginOperator(username, password)
    if (res.success) {
      ElMessage.success('登录成功！')
      authStore.setOperator(res.operator)
      localStorage.setItem('last_operator_username', username)
      showLogin.value = false
      checkUserSession()
    } else {
      ElMessage.error(res.error || '用户名或密码错误')
    }
  } catch (e: any) {
    ElMessage.error('登录失败: ' + e.message)
  }
}

function handleLogout() {
  ElMessageBox.confirm('是否确定退出当前操作员登录？', '确认退出', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    authStore.logout()
    // 清除选中的被试
    userStore.setCurrentUser(null)
    router.push('/')
    loginForm.value.password = ''
    showLogin.value = true
  }).catch(() => {})
}

async function agreePrivacy() {
  await settingsStore.setPrivacyAgreed(true)
  showPrivacy.value = false
  checkUserSession()
}

async function disagreePrivacy() {
  await ElMessageBox.alert(
    '您需要同意隐私声明才能继续使用本软件。本软件所有数据仅存储在本地，不上传网络。',
    '提示',
    { confirmButtonText: '我知道了' }
  )
}

async function handleUserSubmit() {
  if (isCreatingNew.value) {
    // 创建新用户
    const { name, gender, birthdate, contact, notes } = userSelectForm.value
    if (!name || !gender || !birthdate) {
      ElMessage.warning('请填写姓名、性别及出生日期')
      return
    }

    try {
      const newId = await userStore.addUser({
        name,
        gender: gender || undefined,
        birthdate: birthdate || undefined,
        contact: contact || '',
        notes: notes || '自主创建'
      })

      // 加载用户并设置为当前用户
      await userStore.loadUsers()
      const createdUser = userStore.users.find(u => u.id === newId)
      if (createdUser) {
        userStore.setCurrentUser(createdUser)
        ElMessage.success(`创建并选中用户: ${createdUser.name}`)
        showUserSelect.value = false
        // 切换被试后刷新页面
        if (route.path.includes('/history')) {
          router.push(`/user/${createdUser.id}/history`).then(() => {
            window.location.reload()
          })
        } else {
          window.location.reload()
        }
      }
    } catch (e: any) {
      ElMessage.error('创建用户失败: ' + e.message)
    }
  } else {
    // 选择已有用户
    const selectedId = userSelectForm.value.selectedUserId
    if (!selectedId) {
      ElMessage.warning('请选择一个用户')
      return
    }

    const selectedUser = userStore.users.find(u => u.id === selectedId)
    if (selectedUser) {
      userStore.setCurrentUser(selectedUser)
      ElMessage.success(`已选择用户: ${selectedUser.name}`)
      showUserSelect.value = false
      // 切换被试后刷新页面
      if (route.path.includes('/history')) {
        router.push(`/user/${selectedUser.id}/history`).then(() => {
          window.location.reload()
        })
      } else {
        window.location.reload()
      }
    }
  }
}

// 暴露 showUserSelect 的触发入口
function triggerUserSelect() {
  userSelectForm.value = {
    selectedUserId: userStore.currentUser?.id || '',
    name: '',
    gender: '',
    birthdate: '',
    contact: '',
    notes: ''
  }
  isCreatingNew.value = userStore.users.length === 0
  showUserSelect.value = true
}

defineExpose({
  triggerUserSelect
})

watch(
  () => settingsStore.darkMode,
  (val) => {
    if (val) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  },
  { immediate: true }
)

// 全局监听按键来实现快捷键自定义功能
import { useSettingsStore as useSettingsStoreApp } from '@/stores/settingsStore'
import { useUserStore as useUserStoreApp } from '@/stores/userStore'
import { useAuthStore as useAuthStoreApp } from '@/stores/authStore'

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeyDown)
})

function handleGlobalKeyDown(e: KeyboardEvent) {
  // 如果当前在输入框、文本域、选择框等焦点内，不要触发全局快捷键 (除了Esc或其它特殊处理)
  const target = e.target as HTMLElement
  const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  
  // 允许捕获的事件格式化
  const keys: string[] = []
  if (e.ctrlKey || e.metaKey) keys.push('Ctrl')
  if (e.shiftKey) keys.push('Shift')
  if (e.altKey) keys.push('Alt')
  
  let keyName = e.key
  if (keyName === ' ') keyName = 'Space'
  // 排除修饰键自身
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(keyName)) {
    return
  }
  
  // 统一首字母大写，或者直接用 keyName
  if (keyName.length === 1) {
    keyName = keyName.toUpperCase()
  } else {
    // 比如 ArrowUp, Enter, Escape, F5 等
    if (keyName === 'Escape') keyName = 'Esc'
  }
  keys.push(keyName)
  const pressedStr = keys.join('+')

  // 获取启用的快捷键列表
  const shortcuts = settingsStore.keyboardShortcuts
  
  // 1. 返回上一页 (默认: Esc)
  if (shortcuts.goBack && shortcuts.goBack.enabled && pressedStr === shortcuts.goBack.key) {
    // 如果是输入框，按下 Esc 键可以退出输入，不一定非要阻止默认，但应满足返回上一页要求
    // 排除弹窗或 Dialog 开启时，通常 Element Plus 自己会用 Esc 关闭它，这里我们判断如果不处于 Dialog 等遮罩下，或者可以做路由返回
    // 确认满足本次返回上一页需求
    e.preventDefault()
    router.back()
    return
  }

  // 如果是在输入框中，不触发其它快捷键
  if (isInput) return

  // 2. 新建被试 (默认: Ctrl+N)
  if (shortcuts.createNewSubject && shortcuts.createNewSubject.enabled && pressedStr === shortcuts.createNewSubject.key) {
    e.preventDefault()
    // 触发 App.vue 中暴露的创建被试对话框
    triggerUserSelect()
    // 切换到创建被试 tab 页面
    isCreatingNew.value = true
    return
  }

  // 3. 保存/提交 (默认: Ctrl+S)
  if (shortcuts.saveSubmit && shortcuts.saveSubmit.enabled && pressedStr === shortcuts.saveSubmit.key) {
    e.preventDefault()
    // 在答题页：触发提交。需要通知 TestView
    window.dispatchEvent(new CustomEvent('shortcut-save-submit'))
    return
  }

  // 4. 打印报告 (默认: Ctrl+P)
  if (shortcuts.printReport && shortcuts.printReport.enabled && pressedStr === shortcuts.printReport.key) {
    e.preventDefault()
    window.print()
    return
  }

  // 5. 切换暗色模式 (默认: Ctrl+Shift+L)
  if (shortcuts.toggleDarkMode && shortcuts.toggleDarkMode.enabled && pressedStr === shortcuts.toggleDarkMode.key) {
    e.preventDefault()
    settingsStore.setDarkMode(!settingsStore.darkMode)
    return
  }

  // 6. 开始测评 (默认: F5)
  if (shortcuts.startAssessment && shortcuts.startAssessment.enabled && pressedStr === shortcuts.startAssessment.key) {
    e.preventDefault()
    // 开始测评：如果是量表浏览页/首页，且有选中用户且有选中的量表，或者直接跳转到首页
    // 我们最稳妥的做法是跳转到首页 "/"，如果已经在量表列表或者选中了量表则可以触发开始
    // 任务要求“开始测评”快捷键全局生效，所以我们跳转到量表浏览页或触发开始。
    // 如果当前已经在量表详情或有待测任务，我们可以直接进入，最简单直接是 push('/')，如果已经选了被试，用户可以立刻点选量表。
    // 如果已经在 TestView 页面，不需要再次触发。
    if (!route.path.startsWith('/test/')) {
      router.push('/')
    }
    return
  }
}
</script>

<template>
  <div class="app-wrapper" :class="[settingsStore.fontSizeClass(), { dark: settingsStore.darkMode }]">
    <!-- Fluent Design Sidebar Layout Shell -->
    <div class="fluent-layout" :class="{ 'full-screen-layout': currentPath.startsWith('/test/') }">
      
      <!-- 答题页面全屏下，顶部提供一个极其紧凑的窗口控制条，以免没有关闭/最小化按钮 -->
      <div v-if="currentPath.startsWith('/test/')" class="答题页控制条 no-print">
        <div class="drag-handle" @dblclick="handleDoubleClick"></div>
        <div class="window-control-buttons">
          <button class="win-btn" title="最小化" @click="handleMinimize">
            <svg viewBox="0 0 1024 1024" width="10" height="10">
              <path d="M128 512h768v85.333H128z" fill="currentColor" />
            </svg>
          </button>
          <button class="win-btn" :title="isMaximized ? '向下还原' : '最大化'" @click="handleMaximize">
            <svg v-if="isMaximized" viewBox="0 0 1024 1024" width="10" height="10">
              <path d="M341.333 170.667h512v512h-170.667v-85.333h85.333v-341.333h-341.333v85.333h-85.333z" fill="currentColor" />
              <path d="M170.667 341.333h512v512h-512z M256 426.667h341.333v341.333H256z" fill="currentColor" fill-rule="evenodd" />
            </svg>
            <svg v-else viewBox="0 0 1024 1024" width="10" height="10">
              <path d="M170.667 170.667h682.666v682.666H170.667zM256 256v512h512V256z" fill="currentColor" />
            </svg>
          </button>
          <button class="win-btn win-close-btn" title="关闭" @click="handleClose">
            <svg viewBox="0 0 1024 1024" width="10" height="10">
              <path d="M571.733 512l275.2-275.2c16.427-16.427 16.427-43.093 0-59.733s-43.093-16.427-59.733 0L512 452.267l-275.2-275.2c-16.427-16.427-43.093-16.427-59.733 0s-16.427 43.093 0 59.733L452.267 512l-275.2 275.2c-16.427 16.427-16.427 43.093 0 59.733a42.112 42.112 0 0 0 29.867 12.373c10.88 0 21.76-4.053 29.867-12.373L512 571.733l275.2 275.2c8.107 8.32 18.987 12.373 29.867 12.373s21.76-4.053 29.867-12.373c16.427-16.427 16.427-43.093 0-59.733L571.733 512z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Left Sidebar (Windows Settings Style) -->
      <aside v-if="!currentPath.startsWith('/test/')" class="fluent-sidebar no-print">
        <div class="fluent-sidebar-header" @dblclick="handleDoubleClick">
          <div class="fluent-sidebar-header-left">
            <el-icon size="24" color="var(--fluent-accent)"><FirstAidKit /></el-icon>
            <span class="fluent-sidebar-logo">OpenMind</span>
          </div>

          <!-- 嵌入侧栏顶部的三个窗口控制按钮 -->
          <div class="sidebar-window-actions">
            <button class="win-btn" title="最小化" @click.stop="handleMinimize">
              <svg viewBox="0 0 1024 1024" width="10" height="10">
                <path d="M128 512h768v85.333H128z" fill="currentColor" />
              </svg>
            </button>
            <button class="win-btn" :title="isMaximized ? '向下还原' : '最大化'" @click.stop="handleMaximize">
              <svg v-if="isMaximized" viewBox="0 0 1024 1024" width="10" height="10">
                <path d="M341.333 170.667h512v512h-170.667v-85.333h85.333v-341.333h-341.333v85.333h-85.333z" fill="currentColor" />
                <path d="M170.667 341.333h512v512h-512z M256 426.667h341.333v341.333H256z" fill="currentColor" fill-rule="evenodd" />
              </svg>
              <svg v-else viewBox="0 0 1024 1024" width="10" height="10">
                <path d="M170.667 170.667h682.666v682.666H170.667zM256 256v512h512V256z" fill="currentColor" />
              </svg>
            </button>
            <button class="win-btn win-close-btn" title="关闭" @click.stop="handleClose">
              <svg viewBox="0 0 1024 1024" width="10" height="10">
                <path d="M571.733 512l275.2-275.2c16.427-16.427 16.427-43.093 0-59.733s-43.093-16.427-59.733 0L512 452.267l-275.2-275.2c-16.427-16.427-43.093-16.427-59.733 0s-16.427 43.093 0 59.733L452.267 512l-275.2 275.2c-16.427 16.427-16.427 43.093 0 59.733a42.112 42.112 0 0 0 29.867 12.373c10.88 0 21.76-4.053 29.867-12.373L512 571.733l275.2 275.2c8.107 8.32 18.987 12.373 29.867 12.373s21.76-4.053 29.867-12.373c16.427-16.427 16.427-43.093 0-59.733L571.733 512z" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>

        <nav class="fluent-sidebar-menu">
          <router-link to="/" class="fluent-sidebar-item" :class="{ active: currentPath === '/' }">
            <el-icon><HomeFilled /></el-icon>
            <span>首 页</span>
          </router-link>
          <router-link to="/scales" class="fluent-sidebar-item" :class="{ active: currentPath === '/scales' }">
            <el-icon><Document /></el-icon>
            <span>量表浏览</span>
          </router-link>
          <router-link v-if="authStore.currentOperator?.role === 'admin'" to="/scale-editor" class="fluent-sidebar-item" :class="{ active: currentPath === '/scale-editor' }">
            <el-icon><EditPen /></el-icon>
            <span>量表编辑器</span>
          </router-link>
          <router-link to="/users" class="fluent-sidebar-item" :class="{ active: currentPath === '/users' }">
            <el-icon><User /></el-icon>
            <span>用户管理</span>
          </router-link>
          <!-- 新增“历史记录”导航，由于需要指定当前选中用户的历史，如果未选中则可去用户列表或默认路由 -->
          <router-link
            :to="userStore.currentUser ? `/user/${userStore.currentUser.id}/history` : '/users'"
            class="fluent-sidebar-item"
            :class="{ active: currentPath.includes('/history') }"
          >
            <el-icon><Calendar /></el-icon>
            <span>历史记录</span>
          </router-link>
          <router-link to="/appointments" class="fluent-sidebar-item" :class="{ active: currentPath === '/appointments' }">
            <el-icon><Timer /></el-icon>
            <span>预约管理</span>
          </router-link>
          <router-link to="/data-analysis" class="fluent-sidebar-item" :class="{ active: currentPath === '/data-analysis' }">
            <el-icon><PieChart /></el-icon>
            <span>数据分析</span>
          </router-link>
          <router-link to="/settings" class="fluent-sidebar-item" :class="{ active: currentPath === '/settings' }">
            <el-icon><Setting /></el-icon>
            <span>系统设置</span>
          </router-link>
        </nav>

        <!-- Sidebar bottom settings profile -->
        <div class="fluent-sidebar-footer">
          <!-- 1. 当前被试信息放在上方 -->
          <div class="user-status-widget" v-if="userStore.currentUser" style="font-size: 13px; padding: 4px 0; margin-bottom: 8px;">
            <div style="padding: 0 4px; font-size: 11px; color: var(--fluent-text-secondary); margin-bottom: 4px;">
              当前被试
            </div>
            <div style="padding: 0 4px; font-weight: 600; color: var(--fluent-text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
              {{ userStore.currentUser.name }}
            </div>
            <div style="padding: 0 4px; font-size: 11px; color: var(--fluent-text-secondary); margin-top: 2px;">
              {{ userStore.currentUser.gender === 'male' ? '男' : userStore.currentUser.gender === 'female' ? '女' : '未指定' }} · {{ userStore.currentUser.birthdate }}
            </div>
            <el-button type="primary" size="small" style="width: 100%; margin-top: 8px; height: 28px !important;" @click="triggerUserSelect">
              切换被试
            </el-button>
          </div>
          <div class="user-status-widget" v-else style="padding: 4px 0; margin-bottom: 8px;">
            <el-button type="danger" size="small" style="width: 100%; height: 28px !important;" @click="triggerUserSelect">
              创建被试档案
            </el-button>
          </div>

          <!-- 模式切换按钮 -->
          <el-button style="width: 100%; height: 28px !important; margin-bottom: 8px;" @click="settingsStore.setDarkMode(!settingsStore.darkMode)">
            <el-icon><component :is="settingsStore.darkMode ? 'Sunny' : 'Moon'" /></el-icon>
            <span>{{ settingsStore.darkMode ? '浅色模式' : '深色模式' }}</span>
          </el-button>

          <!-- 2. 操作员信息和退出按钮放在最底部，两者用分隔线隔开 -->
          <el-divider style="margin: 8px 0; border-color: var(--fluent-border);" />

          <div class="user-status-widget" v-if="authStore.currentOperator" style="font-size: 13px; padding: 4px 0;">
            <div style="padding: 0 4px; font-weight: 600; color: var(--fluent-text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
              {{ authStore.currentOperator.name }} · {{ authStore.currentOperator.role === 'admin' ? '管理员' : '普通操作员' }}
            </div>
            <el-button type="danger" plain size="small" style="width: 100%; margin-top: 8px; height: 28px !important;" @click="handleLogout">
              退出登录
            </el-button>
          </div>
        </div>
      </aside>

      <!-- Right Content View Area -->
      <main class="fluent-content-container" :class="{ 'full-screen-content': currentPath.startsWith('/test/') }">
        <!-- 非答题页面，且没有左侧栏全屏时，右侧内容顶部也提供拖拽句柄，提升多屏幕拖拽友好度 -->
        <div v-if="!currentPath.startsWith('/test/')" class="right-content-drag-header no-print" @dblclick="handleDoubleClick"></div>
        <router-view v-slot="{ Component }">
          <component :is="Component" @trigger-user-select="triggerUserSelect" />
        </router-view>
      </main>
    </div>

    <!-- 隐私声明弹窗 -->
    <el-dialog
      v-model="showPrivacy"
      title="隐私声明"
      width="560px"
      :close-on-click-modal="false"
      :show-close="false"
      align-center
    >
      <div class="privacy-content">
        <p><strong>OpenMind Assessment</strong> 是一款纯本地运行的心理测评软件。</p>
        <el-divider style="margin: 12px 0;" />
        <p><strong>数据存储：</strong>所有数据（用户信息、测试记录、量表文件）仅保存在您的本地设备，使用 SQLite 数据库或本地缓存存储。</p>
        <p><strong>网络传输：</strong>本软件默认不上传任何数据到服务器，所有操作均在本地完成。</p>
        <p><strong>数据所有权：</strong>您对自己的数据拥有完全的控制权，可随时备份或删除。</p>
        <el-alert
          title="重要提示"
          description="本软件提供的测评结果仅供参考，不能替代专业医疗诊断。如有心理困扰，请寻求专业帮助。"
          type="warning"
          :closable="false"
          style="margin-top: 16px"
        />
      </div>
      <template #footer>
        <el-button @click="disagreePrivacy">不同意</el-button>
        <el-button type="primary" @click="agreePrivacy">我已了解并同意</el-button>
      </template>
    </el-dialog>

    <!-- 首次启动创建管理员账户 -->
    <el-dialog
      v-model="showFirstRegister"
      title="初始化管理员账户"
      width="460px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
      align-center
    >
      <div style="font-size: 13px; color: var(--fluent-text-secondary); margin-bottom: 16px;">
        检测到系统首次启动，请先设置系统唯一的超级管理员账户。该账户后续可用于进行操作员管理和高级设置。
      </div>
      <el-form :model="firstRegisterForm" label-width="80px">
        <el-form-item label="用户名" required>
          <el-input v-model="firstRegisterForm.username" placeholder="建议使用 admin" />
        </el-form-item>
        <el-form-item label="姓名/名称" required>
          <el-input v-model="firstRegisterForm.name" placeholder="显示名称，如 系统管理员" />
        </el-form-item>
        <el-form-item label="密码" required>
          <el-input v-model="firstRegisterForm.password" type="password" show-password placeholder="请输入密码 (至少6位)" />
        </el-form-item>
        <el-form-item label="确认密码" required>
          <el-input v-model="firstRegisterForm.confirmPassword" type="password" show-password placeholder="请再次输入密码" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="primary" @click="handleFirstRegister" style="width: 100%;">注册并登录</el-button>
      </template>
    </el-dialog>

    <!-- 操作员登录窗口 -->
    <el-dialog
      v-model="showLogin"
      title="操作员登录"
      width="400px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
      align-center
    >
      <div style="font-size: 13px; color: var(--fluent-text-secondary); margin-bottom: 16px;">
        请使用您的操作员或管理员账户登录以继续使用 OpenMind 系统。
      </div>
      <el-form :model="loginForm" label-width="70px" @keyup.enter="handleLogin">
        <el-form-item label="用户名" required>
          <el-input v-model="loginForm.username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码" required>
          <el-input v-model="loginForm.password" type="password" show-password placeholder="请输入密码" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="primary" @click="handleLogin" style="width: 100%;">登 录</el-button>
      </template>
    </el-dialog>

    <!-- 用户选择/创建对话框 -->
    <el-dialog
      v-model="showUserSelect"
      title="请先选择或创建被试用户档案"
      width="500px"
      :close-on-click-modal="false"
      :show-close="userStore.currentUser !== null"
      align-center
    >
      <!-- 对话框内容已略 -->
    </el-dialog>

    <!-- 新版本更新提示弹窗 -->
    <el-dialog
      v-model="showUpdateDialog"
      :title="`发现新版本 v${updateInfo.latestVersion}`"
      width="520px"
      align-center
      :close-on-click-modal="true"
      :close-on-press-escape="true"
    >
      <div style="font-size: 14px; line-height: 1.6;">
        <div style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; background: var(--fluent-bg); padding: 8px 12px; border-radius: 4px;">
          <span>当前版本：<strong>v{{ updateInfo.currentVersion }}</strong></span>
          <el-icon><ArrowRight /></el-icon>
          <span style="color: var(--el-color-success);">最新版本：<strong>v{{ updateInfo.latestVersion }}</strong></span>
        </div>
        <div v-if="updateInfo.body" style="margin-top: 16px;">
          <div style="font-weight: bold; margin-bottom: 8px; color: var(--fluent-text-primary);">更新日志摘要：</div>
          <div style="background: var(--fluent-bg); padding: 12px; border-radius: 4px; max-height: 180px; overflow-y: auto; font-family: monospace; white-space: pre-wrap; word-break: break-all; font-size: 12px; color: var(--fluent-text-secondary); border: 1px solid var(--fluent-card-border);">
            {{ updateInfo.body.length > 300 ? updateInfo.body.slice(0, 300) + '...' : updateInfo.body }}
          </div>
        </div>
        <div style="margin-top: 16px; text-align: right;">
          <el-link type="primary" :href="updateInfo.htmlUrl" target="_blank" style="font-size: 13px;">查看完整更新日志</el-link>
        </div>
      </div>
      <template #footer>
        <div style="display: flex; justify-content: flex-end; gap: 12px;">
          <el-button @click="handleIgnoreUpdate">稍后提醒</el-button>
          <el-button type="primary" @click="handleDownloadUpdate">下载更新</el-button>
        </div>
      </template>
    </el-dialog>
    <!-- 用户选择/创建对话框 -->
    <el-dialog
      v-model="showUserSelect"
      title="请先选择或创建被试用户档案"
      width="500px"
      :close-on-click-modal="false"
      :show-close="userStore.currentUser !== null"
      align-center
    >
      <div class="user-select-dialog-content">
        <el-tabs v-model="isCreatingNew">
          <el-tab-pane label="选择已有用户" :name="false" :disabled="userStore.users.length === 0">
            <el-form label-width="100px" style="margin-top: 16px">
              <el-form-item label="选择用户">
                <el-select v-model="userSelectForm.selectedUserId" placeholder="请选择用户" style="width: 100%">
                  <el-option
                    v-for="u in userStore.users"
                    :key="u.id"
                    :label="`${u.name} (${u.gender === 'male' ? '男' : u.gender === 'female' ? '女' : '未知'}, ${u.birthdate || '无出生日期'})`"
                    :value="u.id"
                  />
                </el-select>
              </el-form-item>
            </el-form>
          </el-tab-pane>

          <el-tab-pane label="创建新用户" :name="true">
            <el-form label-width="100px" style="margin-top: 16px">
              <el-form-item label="姓名/化名" required>
                <el-input v-model="userSelectForm.name" placeholder="请输入被试姓名或代号" />
              </el-form-item>
              <el-form-item label="性别" required>
                <el-radio-group v-model="userSelectForm.gender">
                  <el-radio label="male">男</el-radio>
                  <el-radio label="female">女</el-radio>
                </el-radio-group>
              </el-form-item>
              <el-form-item label="出生日期" required>
                <el-date-picker
                  v-model="userSelectForm.birthdate"
                  type="date"
                  placeholder="选择出生日期"
                  value-format="YYYY-MM-DD"
                  style="width: 100%"
                />
              </el-form-item>
              <el-form-item label="联系电话">
                <el-input v-model="userSelectForm.contact" placeholder="手机号，用于PDF报告" />
              </el-form-item>
              <el-form-item label="诊断备注">
                <el-input v-model="userSelectForm.notes" type="textarea" rows="2" placeholder="个案临床备注说明" />
              </el-form-item>
            </el-form>
          </el-tab-pane>
        </el-tabs>
      </div>
      <template #footer>
        <el-button v-if="userStore.currentUser !== null" @click="showUserSelect = false">取消</el-button>
        <el-button type="primary" @click="handleUserSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style>
.app-wrapper {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--fluent-bg);
  color: var(--fluent-text-primary);
  transition: background 0.3s, color 0.3s;
  overflow: hidden;
}

/* Let fluent-layout fill the full height of window as TitleBar is removed */
.fluent-layout {
  flex: 1;
  height: 100vh;
  overflow: hidden;
}

/* 答题页隐藏侧栏后的全屏布局逻辑与消除黑条 */
.full-screen-layout {
  display: flex !important;
  flex-direction: column !important;
  height: 100vh !important;
  overflow: hidden !important;
}

.full-screen-content {
  padding: 0 !important; /* 消除 fluent-content-container 的 32px 40px 内边距 */
  margin: 0 !important;
  overflow: hidden !important;
  height: 100vh !important;
}

/* 答题页极简窗口控制条样式 */
.答题页控制条 {
  height: 30px;
  width: 100%;
  display: flex;
  background: var(--fluent-bg);
  border-bottom: 1px solid var(--fluent-card-border);
  box-sizing: border-box;
}

.答题页控制条 .drag-handle {
  flex: 1;
  height: 100%;
  -webkit-app-region: drag;
}

.答题页控制条 .window-control-buttons {
  display: flex;
  height: 100%;
  -webkit-app-region: no-drag;
}

/* 顶部空白拖拽句柄（非答题页，右侧部分） */
.right-content-drag-header {
  position: absolute;
  top: 0;
  right: 0;
  left: 260px;
  height: 30px;
  z-index: 9999;
  -webkit-app-region: drag;
  pointer-events: auto;
}

/* 左侧栏头部样式扩展 */
.fluent-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 8px 12px 16px !important;
  margin-bottom: 20px;
  -webkit-app-region: drag;
  user-select: none;
  cursor: default;
}

.fluent-sidebar-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  pointer-events: none; /* 让事件透传，不干扰拖拽 */
}

/* 嵌入式控制按钮样式 */
.sidebar-window-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  -webkit-app-region: no-drag;
}

.win-btn {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: none;
  outline: none;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fluent-text-primary);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.win-btn:hover {
  background-color: var(--fluent-subtle-fill-hover);
}

.win-btn:active {
  background-color: var(--fluent-subtle-fill);
}

.win-close-btn:hover {
  background-color: #e81123 !important;
  color: #ffffff !important;
}

.win-close-btn:active {
  background-color: #f1707a !important;
  color: #ffffff !important;
}

/* 保证 dark 主题下按钮完美自适应 */
:global(.dark) .win-btn {
  color: #ffffff !important;
}

/* 打印优化 */
@media print {
  html, body {
    background-color: #ffffff !important;
    color: #000000 !important;
  }
  
  .no-print {
    display: none !important;
  }
  
  .fluent-sidebar {
    display: none !important;
  }
  
  .fluent-content-container {
    padding: 0 !important;
    background-color: #ffffff !important;
    overflow: visible !important;
    height: auto !important;
    width: 100% !important;
  }

  .app-wrapper {
    background-color: #ffffff !important;
    color: #000000 !important;
  }

  .fluent-layout {
    display: block !important;
    height: auto !important;
    overflow: visible !important;
  }

  /* 打印时强制定制暗色/浅色下的文字颜色为纯黑色 */
  .result-view,
  .result-view *,
  .el-card,
  .el-card__header,
  .el-card__body,
  .score-value,
  .score-label,
  .info-label,
  .info-value,
  .interpretation-text {
    color: #000000 !important;
    background-color: #ffffff !important;
    background: #ffffff !important;
    border-color: #e4e7ed !important;
  }

  /* 移除阴影、边框，防止打印截断或产生灰色斑块 */
  .el-card, .acrylic-panel {
    border: 1px solid #e4e7ed !important;
    box-shadow: none !important;
    background: #ffffff !important;
    margin-bottom: 24px !important;
    page-break-inside: avoid;
  }

  /* 展开原始数据 table 进行打印，避免滚动条 and 截断 */
  .el-table {
    border: 1px solid #ddd !important;
    color: #000000 !important;
  }
  
  .el-table th, .el-table td {
    border-bottom: 1px solid #ddd !important;
    color: #000000 !important;
    padding: 8px 4px !important;
  }

  /* 强制打印背景颜色，保留一些色彩提示 */
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
}
</style>

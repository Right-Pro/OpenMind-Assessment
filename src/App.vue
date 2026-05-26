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
})

import { onBeforeUnmount } from 'vue'
onBeforeUnmount(() => {
  if (unsubscribeNavigate) {
    unsubscribeNavigate()
  }
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
</script>

<template>
  <div class="app-wrapper" :class="[settingsStore.fontSizeClass(), { dark: settingsStore.darkMode }]">
    <!-- Fluent Design Sidebar Layout Shell -->
    <div class="fluent-layout" :class="{ 'full-screen-layout': currentPath.startsWith('/test/') }">
      <!-- Left Sidebar (Windows Settings Style) -->
      <aside v-if="!currentPath.startsWith('/test/')" class="fluent-sidebar no-print">
        <div class="fluent-sidebar-header">
          <el-icon size="24" color="var(--fluent-accent)"><FirstAidKit /></el-icon>
          <span class="fluent-sidebar-logo">OpenMind</span>
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
  min-height: 100vh;
  background: var(--fluent-bg);
  color: var(--fluent-text-primary);
  transition: background 0.3s, color 0.3s;
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

  /* 展开原始数据 table 进行打印，避免滚动条和截断 */
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

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useScaleStore } from '@/stores/scaleStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore } from '@/stores/userStore'
import { useFavoriteStore } from '@/stores/favoriteStore'
import { useAuthStore } from '@/stores/authStore'
import { useAppointmentStore } from '@/stores/appointmentStore'
import { ElMessage, ElMessageBox } from 'element-plus'

const emit = defineEmits(['trigger-user-select'])

const router = useRouter()
const scaleStore = useScaleStore()
const settingsStore = useSettingsStore()
const userStore = useUserStore()
const favoriteStore = useFavoriteStore()
const authStore = useAuthStore()
const appointmentStore = useAppointmentStore()

const dashboardStats = ref<{
  totalTests: number
  topScales: string[]
  avgDurationSeconds: number
  activeUsers: number
}>({
  totalTests: 0,
  topScales: [],
  avgDurationSeconds: 0,
  activeUsers: 0
})

const incompleteTests = ref<any[]>([])

async function loadDashboardData() {
  if (window.electronAPI) {
    try {
      dashboardStats.value = await window.electronAPI.getDashboardStats()
      incompleteTests.value = await window.electronAPI.getIncompleteTests()
    } catch (e) {
      console.error('加载仪表盘统计失败:', e)
    }
  }
}

onMounted(async () => {
  await favoriteStore.loadFavorites()
  await loadDashboardData()
  try {
    await appointmentStore.loadAppointments()
  } catch (e) {
    console.error('加载预约列表失败:', e)
  }
})

const activeUserAppointments = computed(() => {
  if (!userStore.currentUser) return []
  return appointmentStore.appointments.filter(appt => 
    appt.userId === userStore.currentUser!.id && appt.status === 'pending'
  )
})

async function startAppointmentTest(appt: any) {
  if (!userStore.currentUser) return

  try {
    await appointmentStore.updateStatus(appt.id, 'completed')
  } catch (err) {
    console.error('更新预约状态失败:', err)
  }

  ElMessage.success(`正在开启 [${appt.scaleName || appt.scaleId}] 测评`)
  router.push(`/test/${appt.scaleId}`)
}

const searchQuery = ref('')

// 获取所有被收藏的量表定义
const favoriteScales = computed(() => {
  return scaleStore.scales.filter(scale => favoriteStore.isFavorite(scale.id))
})

// 根据搜索关键词过滤推荐量表（默认推荐：PHQ-9, GAD-7, SCL-90, SAS, SDS, MMPI，按顺序优先排列）
const recentScales = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  
  // 默认推荐列表顺序定义
  const defaultOrder = ['phq-9', 'gad-7', 'scl-90', 'sas', 'sds', 'mmpi']
  
  // 获取当前已加载的全部量表
  const allScales = [...scaleStore.scales]
  
  // 对所有量表排序：如果在推荐列表中则按其推荐位置排序，其余的排在后面
  allScales.sort((a, b) => {
    const idxA = defaultOrder.indexOf(a.id.toLowerCase())
    const idxB = defaultOrder.indexOf(b.id.toLowerCase())
    
    if (idxA !== -1 && idxB !== -1) {
      return idxA - idxB
    }
    if (idxA !== -1) return -1
    if (idxB !== -1) return 1
    return 0
  })

  if (!query) {
    return allScales.slice(0, 6)
  }
  
  return allScales.filter(scale => {
    const nameMatch = scale.name.toLowerCase().includes(query)
    const enNameMatch = scale.name_en?.toLowerCase().includes(query) || false
    const idMatch = scale.id.toLowerCase().includes(query)
    return nameMatch || enNameMatch || idMatch
  })
})

function startScale(scaleId: string) {
  if (!userStore.currentUser) {
    ElMessage.warning('答题前必须创建或选择用户档案！')
    emit('trigger-user-select')
    return
  }
  router.push(`/test/${scaleId}`)
}

function handleSwitchUser() {
  emit('trigger-user-select')
}

function goTo(route: string) {
  router.push(`/${route}`)
}

async function resumeIncompleteTest(item: any) {
  // 设置当前活动被试为测试所属被试
  const targetUser = userStore.users.find(u => u.id === item.userId)
  if (targetUser) {
    userStore.setCurrentUser(targetUser)
  }
  if (item.isPackage) {
    // 如果是套餐，我们需要恢复套餐答题
    router.push({
      path: `/test/${item.scaleId}`
    })
  } else {
    router.push({
      path: `/test/${item.scaleId}`,
      query: { resumeTestId: String(item.id) }
    })
  }
}

async function discardIncompleteTest(item: any) {
  try {
    await ElMessageBox.confirm(
      `确定丢弃被试 "${item.userName}" 的量表 "${item.scaleName}" 的未完成答题进度吗？此操作不可恢复。`,
      '丢弃确认',
      {
        confirmButtonText: '确认丢弃',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    let result
    if (item.isPackage) {
      // 物理删除未完成套餐 package_sessions
      const deleteResult = await window.electronAPI.dbRun(
        `DELETE FROM package_sessions WHERE id = ?`,
        [item.id]
      )
      result = { success: true }
    } else {
      result = await window.electronAPI.deleteTest(item.id)
    }
    if (result.success) {
      ElMessage.success('已丢弃该未完成进度')
      await loadDashboardData()
    } else {
      ElMessage.error('丢弃失败')
    }
  } catch (e) {
    // 取消
  }
}
</script>

<template>
  <div class="home-view">
    <!-- 主内容 -->
    <main class="home-main" style="padding-top: 0;">
      <div class="hero-section">
        <h2>新一代心理测试软件</h2>
        <p class="subtitle">纯本地运行 · 结果仅供参考</p>
        <div class="hero-actions">
          <el-button type="primary" size="large" @click="goTo('scales')">
            <el-icon><Document /></el-icon>
            浏览量表
          </el-button>
          <el-button size="large" @click="goTo('users')">
            <el-icon><User /></el-icon>
            用户管理
          </el-button>
          <el-button size="large" @click="goTo('settings')">
            <el-icon><Setting /></el-icon>
            系统设置
          </el-button>
        </div>
      </div>

      <!-- 统计看板 (第一行，固定 4 个等宽卡片) -->
      <div class="dashboard-stats-grid">
        <el-card class="stat-card" :body-style="{ padding: '16px' }">
          <div class="stat-value">{{ dashboardStats.totalTests }}</div>
          <div class="stat-label">本月测试总量</div>
        </el-card>
        
        <el-card class="stat-card" :body-style="{ padding: '16px' }">
          <div class="stat-value">
            <template v-if="dashboardStats.avgDurationSeconds > 0">
              {{ Math.floor(dashboardStats.avgDurationSeconds / 60) }}<span class="stat-unit">分</span>{{ dashboardStats.avgDurationSeconds % 60 }}<span class="stat-unit">秒</span>
            </template>
            <template v-else>
              0<span class="stat-unit">秒</span>
            </template>
          </div>
          <div class="stat-label">平均作答时长</div>
        </el-card>
        
        <el-card class="stat-card" :body-style="{ padding: '16px' }">
          <div class="stat-value">{{ dashboardStats.activeUsers }}</div>
          <div class="stat-label">活跃被试数</div>
        </el-card>

        <el-card class="stat-card" :body-style="{ padding: '16px' }">
          <div class="stat-value operator-name-val" :title="authStore.currentOperator?.name || '系统管理员'">
            {{ authStore.currentOperator?.name || '系统管理员' }}
          </div>
          <div class="stat-label">当前操作员</div>
        </el-card>
      </div>

      <!-- Top3 独立区域 (第二行) -->
      <div class="top-scales-strip">
        <div class="strip-title">本月热门量表</div>
        <div class="strip-content">
          <template v-if="dashboardStats.topScales && dashboardStats.topScales.length > 0">
            <div v-for="scale in dashboardStats.topScales" :key="scale" class="strip-pill">
              {{ scale }}
            </div>
          </template>
          <div v-else class="strip-empty">
            本月暂无测试记录
          </div>
        </div>
      </div>

      <!-- 预约待办提醒 -->
      <template v-if="userStore.currentUser && activeUserAppointments.length > 0">
        <div class="section-title" style="margin-top: 24px; margin-bottom: 16px;">
          <span>被试预约待办提醒 ({{ userStore.currentUser.name }})</span>
        </div>
        <div class="active-appointments-list" style="margin-bottom: 24px;">
          <el-card v-for="appt in activeUserAppointments" :key="appt.id" shadow="hover" style="margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; flex-wrap: wrap; gap: 12px;">
              <div>
                <span style="font-weight: 600; font-size: 15px; color: var(--el-color-primary);">
                  {{ appt.scaleName }}
                </span>
                <div style="font-size: 13px; color: var(--el-text-color-secondary); margin-top: 4px;">
                  预约时间：{{ new Date(appt.scheduledAt).toLocaleString() }}
                </div>
              </div>
              <div>
                <el-button type="primary" size="default" @click="startAppointmentTest(appt)">
                  开始测评
                </el-button>
              </div>
            </div>
          </el-card>
        </div>
      </template>

      <!-- 最近未完成测试 (若没有则完全不渲染) -->
      <template v-if="incompleteTests.length > 0">
        <div class="section-title" style="margin-top: 24px; margin-bottom: 16px;">
          <span>最近未完成测试</span>
        </div>
        <div class="incomplete-grid">
          <el-card v-for="item in incompleteTests" :key="item.id" class="incomplete-card" shadow="hover">
            <div class="incomplete-info">
              <div class="incomplete-title">
                <span class="user-tag">{{ item.userName }}</span> 正在作答 <strong>{{ item.scaleName }}</strong>
              </div>
              <div class="incomplete-details">
                <span>已答题数: <el-tag size="small" type="warning">{{ item.answeredCount }} 题</el-tag></span>
                <span class="time-text">上次作答: {{ item.createdAt }}</span>
              </div>
            </div>
            <div class="incomplete-actions">
              <el-button type="success" size="small" @click="resumeIncompleteTest(item)">继续测评</el-button>
              <el-button type="danger" size="small" plain @click="discardIncompleteTest(item)">丢弃进度</el-button>
            </div>
          </el-card>
        </div>
      </template>

      <!-- 常用量表 (只有在收藏夹不为空时才渲染) -->
      <template v-if="favoriteScales.length > 0">
        <div class="section-title" style="margin-top: 24px; margin-bottom: 20px;">
          <span>常用量表</span>
        </div>
        <div class="scale-grid" style="margin-bottom: 32px;">
          <template v-for="scale in favoriteScales" :key="scale.id">
            <el-tooltip
              :disabled="!scale.targetPopulation || !scale.targetPopulation.gender"
              :content="`适用于：${scale.targetPopulation?.gender === 'male' ? '男性' : scale.targetPopulation?.gender === 'female' ? '女性' : '不限'}`"
              placement="top"
            >
              <el-card
                class="scale-card"
                shadow="hover"
                @click="startScale(scale.id)"
                style="position: relative;"
              >
                <!-- 当前适用的小角标，极小且灰色 -->
                <div
                  v-if="userStore.currentUser && userStore.currentUser.gender && scale.targetPopulation && (scale.targetPopulation.gender === 'any' || scale.targetPopulation.gender === userStore.currentUser.gender)"
                  style="position: absolute; top: 8px; right: 8px; z-index: 10;"
                >
                  <el-tag size="mini" type="info" style="font-size: 10px; padding: 0 4px; height: 16px; line-height: 14px;">
                    当前适用
                  </el-tag>
                </div>
                <template #header>
                  <div class="scale-card-header">
                    <span style="font-weight: 600;">{{ scale.id.toUpperCase() }} {{ scale.name }}</span>
                    <el-tag size="small">{{ scale.questions.length }}题</el-tag>
                  </div>
                </template>
                <p class="scale-desc">{{ scale.description }}</p>
                <div class="scale-tags">
                  <el-tag size="small">{{ scale.category === 'mood' ? '情绪' : scale.category === 'personality' ? '人格' : scale.category === 'psychiatric' ? '精神科' : scale.category === 'cognitive' ? '认知' : scale.category === 'screening' ? '筛查' : '其他' }}</el-tag>
                  <el-tag v-for="tag in scale.tags.slice(0, 2)" :key="tag" size="small" type="info">{{ tag }}</el-tag>
                </div>
              </el-card>
            </el-tooltip>
          </template>
        </div>
      </template>

      <!-- 最近量表 / 量表推荐 (若有常用量表则不渲染"量表推荐与快速开始") -->
      <template v-else>
        <div class="section-title" style="margin-top: 24px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 20px;">
          <span>量表推荐与快速开始</span>
          <el-input
            v-model="searchQuery"
            placeholder="搜索量表名称、英文名称或ID..."
            clearable
            style="width: 280px;"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </div>
        <div class="scale-grid" v-if="recentScales.length > 0">
          <template v-for="scale in recentScales" :key="scale.id">
            <el-tooltip
              :disabled="!scale.targetPopulation || !scale.targetPopulation.gender"
              :content="`适用于：${scale.targetPopulation?.gender === 'male' ? '男性' : scale.targetPopulation?.gender === 'female' ? '女性' : '不限'}`"
              placement="top"
            >
              <el-card
                class="scale-card"
                shadow="hover"
                @click="startScale(scale.id)"
                style="position: relative;"
              >
                <!-- 当前适用的小角标，极小且灰色 -->
                <div
                  v-if="userStore.currentUser && userStore.currentUser.gender && scale.targetPopulation && (scale.targetPopulation.gender === 'any' || scale.targetPopulation.gender === userStore.currentUser.gender)"
                  style="position: absolute; top: 8px; right: 8px; z-index: 10;"
                >
                  <el-tag size="mini" type="info" style="font-size: 10px; padding: 0 4px; height: 16px; line-height: 14px;">
                    当前适用
                  </el-tag>
                </div>
                <template #header>
                  <div class="scale-card-header">
                    <span style="font-weight: 600;">{{ scale.id.toUpperCase() }} {{ scale.name }}</span>
                    <el-tag size="small">{{ scale.questions.length }}题</el-tag>
                  </div>
                </template>
                <p class="scale-desc">{{ scale.description }}</p>
                <div class="scale-tags">
                  <el-tag v-for="tag in scale.tags.slice(0, 3)" :key="tag" size="small" type="info">{{ tag }}</el-tag>
                </div>
              </el-card>
            </el-tooltip>
          </template>
        </div>
        <el-empty v-else description="未找到符合条件的量表" :image-size="80" style="padding: 24px 0;" />
      </template>
    </main>

    <!-- 底部 -->
    <footer class="home-footer no-print">
      <p>本测试结果仅供参考，不能替代专业医疗诊断。如有心理困扰，请寻求专业心理咨询师或精神科医生的帮助。</p>
    </footer>
  </div>
</template>

<style scoped>
.home-view {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.home-header {
  background: var(--app-card, #fff);
  border-bottom: 1px solid var(--el-border-color);
  padding: 0 24px;
}

.header-content {
  max-width: 900px;
  margin: 0 auto;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.user-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.user-name {
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.home-main {
  flex: 1;
  max-width: 900px;
  width: 100%;
  margin: 0 auto;
  padding: 32px 24px 80px; /* padding-bottom to avoid footer overlap */
}

.hero-section {
  text-align: center;
  padding: 48px 0;
}

.hero-section h2 {
  font-size: 32px;
  margin-bottom: 12px;
}

.subtitle {
  color: var(--el-text-color-secondary);
  font-size: 16px;
  margin-bottom: 24px;
}

.hero-actions {
  display: flex;
  gap: 16px;
  justify-content: center;
}

.dashboard-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}

.stat-card {
  text-align: center;
  height: 120px; /* 固定高度，确保卡片视觉层级与高度一致 */
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  box-sizing: border-box;
}

:deep(.stat-card .el-card__body) {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  padding: 16px !important;
}

/* Top3 独立横向条带样式 */
.top-scales-strip {
  background: var(--fluent-card-bg-subtle, #f5f6f8);
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 24px; /* 与下方元素有 24px 间距 */
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.dark .top-scales-strip {
  background: var(--app-card-subtle, #1a2640);
}

.strip-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.strip-content {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.strip-pill {
  background: var(--el-color-primary-light-9, #ecf5ff);
  color: var(--el-color-primary, #409eff);
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid var(--el-color-primary-light-8, #d9ecff);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.dark .strip-pill {
  background: rgba(64, 158, 255, 0.15);
  color: #66b1ff;
  border-color: rgba(64, 158, 255, 0.25);
}

.strip-empty {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.operator-name-val {
  font-size: 20px !important;
  font-weight: 700 !important;
  color: var(--el-color-primary) !important;
  line-height: 48px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
  text-align: center;
}

.incomplete-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 32px;
}

.incomplete-card {
  display: flex;
  flex-direction: column;
}

:deep(.incomplete-card .el-card__body) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  box-sizing: border-box;
  flex-wrap: wrap;
  gap: 16px;
}

.incomplete-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.incomplete-title {
  font-size: 15px;
}

.user-tag {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: bold;
  margin-right: 6px;
}

.incomplete-details {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.incomplete-actions {
  display: flex;
  gap: 8px;
}

@media (max-width: 768px) {
  .dashboard-stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .top-scales-strip {
    flex-direction: column;
    align-items: flex-start;
  }
}

.stat-value {
  font-size: 32px !important;
  font-weight: 700 !important;
  color: var(--el-color-primary) !important;
  line-height: 48px;
  display: flex;
  align-items: baseline;
  justify-content: center;
}

.stat-unit {
  font-size: 16px !important;
  font-weight: normal !important;
  color: var(--el-text-color-secondary) !important;
  margin-left: 2px;
  margin-right: 4px;
}

.stat-label {
  font-size: 14px !important;
  color: var(--el-text-color-secondary) !important;
  font-weight: normal !important;
  margin-top: 8px;
  text-align: center;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color);
}

.scale-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.scale-card {
  cursor: pointer;
  transition: transform 0.2s;
}

.scale-card:hover {
  transform: translateY(-2px);
}

.scale-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.scale-desc {
  color: var(--el-text-color-secondary);
  font-size: 14px;
  line-height: 1.6;
  margin: 0 0 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.scale-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.home-footer {
  position: fixed;
  bottom: 0;
  left: 260px; /* Sidebar width */
  right: 0;
  z-index: 1000;
  background: var(--fluent-bg);
  text-align: center;
  padding: 12px 24px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  border-top: 1px solid var(--el-border-color);
  box-sizing: border-box;
}

/* 兼容打印媒体 */
@media print {
  .home-footer {
    position: relative !important;
    left: 0 !important;
    border-top: none !important;
    padding: 0 !important;
  }
}

.dark .home-header,
.dark .stat-card,
.dark .scale-card {
  background: var(--app-card, #16213e);
  color: var(--app-text, #e0e0e0);
}
</style>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/userStore'
import { useScaleStore } from '@/stores/scaleStore'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const scaleStore = useScaleStore()

const testIds = ref<number[]>([])
const resultsList = ref<any[]>([])
const loading = ref(true)

onMounted(async () => {
  if (!userStore.currentUser) {
    ElMessage.warning('无被试信息，返回主页')
    router.push('/')
    return
  }

  // 从 query 参数中获取已完成的 testId 列表
  const testIdsQuery = route.query.testIds as string
  if (!testIdsQuery) {
    ElMessage.warning('未检测到连续测评记录，返回主页')
    router.push('/')
    return
  }

  testIds.value = testIdsQuery.split(',').map(id => parseInt(id)).filter(id => !isNaN(id))
  
  if (testIds.value.length === 0) {
    ElMessage.warning('未检测到有效连续测评记录，返回主页')
    router.push('/')
    return
  }

  try {
    // 异步加载所有量表以备查显示名称
    await scaleStore.loadScales()
    
    // 从 tests 表读取数据
    const placeHolders = testIds.value.map(() => '?').join(',')
    const sql = `
      SELECT id, scale_id, scale_name, raw_score, std_score, result_json, created_at
      FROM tests
      WHERE id IN (${placeHolders})
      ORDER BY created_at ASC
    `
    const rows = await window.electronAPI.dbQuery(sql, testIds.value)
    
    resultsList.value = rows.map((r: any) => {
      let parsedResult: any = {}
      try {
        parsedResult = JSON.parse(r.result_json || '{}')
      } catch (err) {}

      // 获取测评结论
      const conclusion = parsedResult.conclusion || parsedResult.interpretation?.conclusion || '无'
      
      return {
        id: r.id,
        scaleId: r.scale_id,
        scaleName: r.scale_name,
        rawScore: r.raw_score,
        stdScore: r.std_score,
        conclusion,
        createdAt: r.created_at
      }
    })
  } catch (err) {
    console.error('加载套餐总结结果失败:', err)
    ElMessage.error('加载套餐总结结果失败')
  } finally {
    loading.value = false
  }
})

function viewHistory() {
  if (userStore.currentUser) {
    router.push(`/user/${userStore.currentUser.id}/history`)
  } else {
    router.push('/')
  }
}

function goHome() {
  router.push('/')
}
</script>

<template>
  <div class="package-summary-view">
    <div class="summary-container" v-loading="loading">
      <div class="header">
        <span class="success-icon">🎉</span>
        <h2>套餐完成 · 共 {{ resultsList.length }} 个量表</h2>
        <p class="subtitle" v-if="userStore.currentUser">
          被试姓名：<strong>{{ userStore.currentUser.name }}</strong> | 
          性别：<strong>{{ userStore.currentUser.gender || '未知' }}</strong> |
          联系方式：<strong>{{ userStore.currentUser.contact || '暂无' }}</strong>
        </p>
      </div>

      <el-card class="results-card" shadow="never">
        <el-table :data="resultsList" style="width: 100%" border>
          <el-table-column prop="scaleName" label="量表名称" min-width="180">
            <template #default="{ row }">
              <span class="scale-name">{{ row.scaleId }} - {{ row.scaleName }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="rawScore" label="原始分" width="100" align="center" />
          <el-table-column prop="stdScore" label="标准分" width="100" align="center">
            <template #default="{ row }">
              {{ row.stdScore !== null && row.stdScore !== undefined ? row.stdScore : '-' }}
            </template>
          </el-table-column>
          <el-table-column prop="conclusion" label="测评结论" min-width="200">
            <template #default="{ row }">
              <el-tag :type="row.conclusion && row.conclusion !== '正常' && row.conclusion !== '无' ? 'danger' : 'success'" size="small">
                {{ row.conclusion }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="createdAt" label="测评时间" width="180" align="center" />
        </el-table>
      </el-card>

      <div class="actions-footer">
        <el-button type="primary" size="large" @click="viewHistory">
          查看各量表详细报告
        </el-button>
        <el-button size="large" @click="goHome">
          返回首页
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.package-summary-view {
  min-height: 100vh;
  background-color: var(--app-bg, #f5f7fa);
  padding: 40px 20px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.summary-container {
  width: 100%;
  max-width: 900px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.header {
  text-align: center;
  background: var(--app-card, #fff);
  padding: 32px;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04);
}

.success-icon {
  font-size: 48px;
  display: block;
  margin-bottom: 12px;
}

.header h2 {
  margin: 0 0 12px 0;
  font-size: 24px;
  color: var(--el-text-color-primary);
}

.subtitle {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

.results-card {
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04);
  background: var(--app-card, #fff);
}

.scale-name {
  font-weight: 500;
}

.actions-footer {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 12px;
}

/* 兼容暗色模式 */
.dark .header,
.dark .results-card {
  background: var(--app-card, #1e293b);
  border-color: #334155;
}

.dark .package-summary-view {
  background-color: var(--app-bg, #0f172a);
}
</style>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useScaleStore } from '@/stores/scaleStore'
import { useUserStore } from '@/stores/userStore'
import { useFavoriteStore } from '@/stores/favoriteStore'
import { usePackageStore } from '@/stores/packageStore'
import { ElMessage } from 'element-plus'
import * as XLSX from 'xlsx'

const emit = defineEmits(['trigger-user-select'])

const router = useRouter()
const scaleStore = useScaleStore()
const userStore = useUserStore()
const favoriteStore = useFavoriteStore()
const packageStore = usePackageStore()

const activeTab = ref('scales')

onMounted(async () => {
  await favoriteStore.loadFavorites()
  await packageStore.loadPackages()
})

async function handleToggleFavorite(scaleId: string) {
  const res = await favoriteStore.toggleFavorite(scaleId)
  if (res.success) {
    if (res.action === 'added') {
      ElMessage.success('已添加到常用量表')
    } else {
      ElMessage.success('已取消收藏')
    }
  } else {
    ElMessage.error('操作失败')
  }
}

const searchQuery = ref('')

const filteredScales = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return scaleStore.scales
  return scaleStore.scales.filter(scale => {
    const nameMatch = scale.name.toLowerCase().includes(query)
    const enNameMatch = scale.name_en?.toLowerCase().includes(query) || false
    const idMatch = scale.id.toLowerCase().includes(query)
    return nameMatch || enNameMatch || idMatch
  })
})

const categories = [
  { value: 'mood', label: '情绪' },
  { value: 'personality', label: '人格' },
  { value: 'psychiatric', label: '精神科' },
  { value: 'cognitive', label: '认知' },
  { value: 'screening', label: '筛查' },
  { value: 'other', label: '其他' }
]

const categoryLabel = (val: string) => categories.find(c => c.value === val)?.label || val

function startScale(scaleId: string) {
  if (!userStore.currentUser) {
    ElMessage.warning('答题前必须创建或选择用户档案！')
    emit('trigger-user-select')
    return
  }
  router.push(`/test/${scaleId}`)
}

function startPackage(pkg: any) {
  if (!userStore.currentUser) {
    ElMessage.warning('答题前必须创建或选择用户档案！')
    emit('trigger-user-select')
    return
  }
  if (!pkg.scale_ids || pkg.scale_ids.length === 0) {
    ElMessage.warning('套餐内没有量表！')
    return
  }
  // 连续测评：将套餐内所有量表ID作为逗号分隔的参数传给答题页面
  const scaleIdsStr = pkg.scale_ids.join(',')
  router.push(`/test/${scaleIdsStr}`)
}

import { useAuthStore } from '@/stores/authStore'

const authStore = useAuthStore()

async function handleImport() {
  // 操作员角色校验：只有 admin 允许导入量表
  if (authStore.currentOperator?.role !== 'admin') {
    ElMessage.error('权限不足：只有管理员账户允许导入量表！')
    return
  }

  const res = await scaleStore.importScale()
  if (res.success) {
    ElMessage.success(res.message)
  } else {
    ElMessage.error(res.message)
  }
}

function openScalesDir() {
  window.electronAPI.openScalesDir()
}

function goBack() {
  router.push('/')
}

// 导出所选量表的全部记录（全库脱敏）
const isExportingAll = ref(false)
const exportProgress = ref(0)
const exportTotal = ref(0)
const exportCurrentCount = ref(0)

function calculateAge(birthdateStr?: string) {
  if (!birthdateStr) return '/'
  const birth = new Date(birthdateStr)
  if (isNaN(birth.getTime())) return '/'
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--
  }
  return age > 0 ? String(age) : '0'
}

async function exportAnonymizedScaleData(scaleId: string) {
  const scale = scaleStore.getScaleById(scaleId)
  const scaleName = scale ? scale.name : scaleId
  
  try {
    isExportingAll.value = true
    exportProgress.value = 0
    exportCurrentCount.value = 0
    
    // 1. 先查询总记录数
    const totalCount = await window.electronAPI.getScaleTestsCount(scaleId)
    if (totalCount === 0) {
      ElMessage.warning('该量表在系统内无历史测试记录')
      isExportingAll.value = false
      return
    }
    
    exportTotal.value = totalCount
    
    // 2. 分批查询并处理数据
    const batchSize = 500
    const totalPages = Math.ceil(totalCount / batchSize)
    const allProcessedData: any[] = []
    
    // 在本批次导出内，按顺序对被试姓名做递增脱敏映射：姓名 -> User_001, User_002...
    const userNameMap = new Map<string, string>()
    let userIncrementId = 1
    
    for (let page = 0; page < totalPages; page++) {
      const rows = await window.electronAPI.getScaleTestsForExport(scaleId, page, batchSize)
      
      for (const r of rows) {
        let interpretationLabel = '/'
        let answersObj: Record<string, string | number> = {}
        
        try {
          if (r.resultJson) {
            const parsed = JSON.parse(r.resultJson)
            interpretationLabel = parsed.interpretation?.label || '/'
            answersObj = parsed.answers || {}
          }
        } catch (e) {}
        
        // 姓名递增映射
        const originalName = r.userName || '未知'
        let anonymizedName = userNameMap.get(originalName)
        if (!anonymizedName) {
          anonymizedName = `User_${String(userIncrementId++).padStart(3, '0')}`
          userNameMap.set(originalName, anonymizedName)
        }
        
        // 处理性别
        const genderText = r.userGender === 'male' ? '男' : r.userGender === 'female' ? '女' : '未知'
        
        // 计算年龄
        const ageVal = calculateAge(r.userBirthdate)
        
        // 构建行基础脱敏数据 (被试姓名脱敏为递增User_xxx，删除联系方式/备注)
        const rowData: Record<string, any> = {
          '被试编号': anonymizedName,
          '性别': genderText,
          '年龄': ageVal !== '/' ? `${ageVal}岁` : '/',
          '测评时间': r.createdAt ? new Date(r.createdAt).toLocaleString() : '/',
          '答题用时': r.durationSeconds ? `${Math.floor(r.durationSeconds / 60)}分${r.durationSeconds % 60}秒` : '/',
          '原始总分': r.rawScore !== null && r.rawScore !== undefined ? r.rawScore.toFixed(1) : '/',
          '标准总分': r.stdScore !== null && r.stdScore !== undefined ? r.stdScore.toFixed(1) : '/',
          '测评结论': interpretationLabel,
          '报告医生': r.reportDoctor || '/'
        }
        
        // 动态添加各题答案 (保留各题答案)
        if (scale && scale.questions) {
          scale.questions.forEach((q: any) => {
            const answerDetail = r.answers?.find((a: any) => a.question_id === q.id)
            let answerRaw: string | number = '/'
            if (answerDetail) {
              answerRaw = answerDetail.option_value !== undefined && answerDetail.option_value !== null ? answerDetail.option_value : '/'
            } else if (answersObj[q.id] !== undefined) {
              const ansVal = answersObj[q.id]
              if (ansVal && typeof ansVal === 'object' && 'value' in ansVal) {
                answerRaw = (ansVal as any).value !== undefined && (ansVal as any).value !== null ? (ansVal as any).value : '/'
              } else {
                answerRaw = ansVal !== undefined && ansVal !== null ? ansVal : '/'
              }
            }

            let answerText = '/'
            if (answerRaw !== '/') {
              // 优先查找选项 label 映射
              const matchedOption = q.options?.find((opt: any) => String(opt.value) === String(answerRaw))
              const labelStr = matchedOption && matchedOption.label ? String(matchedOption.label) : String(answerRaw)
              // 限制最长30个字符
              answerText = labelStr.length > 30 ? labelStr.slice(0, 27) + '...' : labelStr
            }
            rowData[`题目: ${q.id} ${q.text.slice(0, 15)}...`] = answerText
          })
        }
        
        // 动态添加维度分
        try {
          if (r.resultJson) {
            const parsed = JSON.parse(r.resultJson)
            if (parsed.dimensionScores) {
              Object.entries(parsed.dimensionScores).forEach(([dimName, scoreVal]) => {
                rowData[`维度: ${dimName}`] = typeof scoreVal === 'number' ? scoreVal.toFixed(1) : scoreVal
              })
            }
          }
        } catch (e) {}
        
        allProcessedData.push(rowData)
        exportCurrentCount.value++
      }
      
      exportProgress.value = Math.round((exportCurrentCount.value / totalCount) * 100)
    }
    
    // 3. 生成 Excel
    const ws = XLSX.utils.json_to_sheet(allProcessedData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '全部脱敏测评数据')
    
    // 设置基础列的列宽
    const cols = [
      { wch: 12 }, // 被试编号
      { wch: 6 },  // 性别
      { wch: 8 },  // 年龄
      { wch: 20 }, // 测评时间
      { wch: 12 }, // 答题用时
      { wch: 10 }, // 原始总分
      { wch: 10 }, // 标准总分
      { wch: 15 }, // 测评结论
      { wch: 12 }  // 报告医生
    ]
    
    // 为后面的动态答案列和维度列设置宽度
    if (allProcessedData.length > 0) {
      const firstRow = allProcessedData[0]
      const keys = Object.keys(firstRow)
      for (let i = 9; i < keys.length; i++) {
        cols.push({ wch: 18 })
      }
    }
    ws['!cols'] = cols
    
    const YYYYMMDD = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const fileName = `${scaleName}_全部脱敏_${YYYYMMDD}.xlsx`
    
    XLSX.writeFile(wb, fileName)
    ElMessage.success('该量表全部记录去标识化导出成功！')
  } catch (e: any) {
    ElMessage.error('导出失败: ' + e.message)
  } finally {
    isExportingAll.value = false
  }
}
</script>

<template>
  <div class="scale-list-view">
    <div class="page-header no-print">
      <div class="header-left">
        <el-button @click="goBack" circle>
          <el-icon><ArrowLeft /></el-icon>
        </el-button>
        <h2>量表浏览</h2>
      </div>
      <div class="header-actions">
        <el-button type="primary" @click="handleImport">
          <el-icon><Upload /></el-icon>
          导入量表
        </el-button>
        <el-button @click="openScalesDir">
          <el-icon><Folder /></el-icon>
          打开目录
        </el-button>
        <el-button circle @click="scaleStore.loadScales()">
          <el-icon><Refresh /></el-icon>
        </el-button>
      </div>
    </div>

    <div class="page-content">
      <el-tabs v-model="activeTab" style="margin-bottom: 16px;">
        <el-tab-pane label="单项量表" name="scales" />
        <el-tab-pane label="测评套餐 (批量连续测评)" name="packages" />
      </el-tabs>

      <div v-if="activeTab === 'scales'">
        <!-- 搜索栏 -->
        <div class="search-bar no-print" style="margin-bottom: 16px;">
          <el-input
            v-model="searchQuery"
            placeholder="搜索量表名称、英文名称或ID..."
            clearable
            style="width: 300px;"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </div>

        <!-- 错误提示 -->
        <el-alert
          v-if="scaleStore.loadErrors.length > 0"
          :title="`有 ${scaleStore.loadErrors.length} 个量表文件加载失败`"
          type="error"
          :closable="false"
          class="error-alert"
        >
          <div v-for="(err, idx) in scaleStore.loadErrors" :key="idx" class="error-item">
            <el-text type="danger">{{ err.file }}: {{ err.error || JSON.stringify(err.errors) }}</el-text>
          </div>
        </el-alert>

        <!-- 全量导出进度弹窗 -->
        <el-dialog
          v-model="isExportingAll"
          title="正在全库脱敏导出量表数据..."
          width="420px"
          :close-on-click-modal="false"
          :close-on-press-escape="false"
          :show-close="false"
        >
          <div style="text-align: center; padding: 10px 0;">
            <div style="margin-bottom: 15px; font-size: 14px;">
              正在处理第 <strong>{{ exportCurrentCount }}</strong> / {{ exportTotal }} 条记录，请稍候...
            </div>
            <el-progress type="line" :percentage="exportProgress" :stroke-width="15" striped striped-flow />
          </div>
        </el-dialog>

        <!-- 量表列表 -->
        <el-table :data="filteredScales" style="width: 100%" v-loading="scaleStore.loading">
        <el-table-column prop="name" label="量表名称" min-width="180">
          <template #default="{ row }">
            <el-tooltip
              v-if="row.targetPopulation && row.targetPopulation.gender"
              :content="`适用于：${row.targetPopulation.gender === 'male' ? '男性' : row.targetPopulation.gender === 'female' ? '女性' : '不限'}`"
              placement="top"
            >
              <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <el-text strong>{{ row.id }} {{ row.name }}</el-text>
                  <!-- 匹配当前选中用户性别标签 -->
                  <el-tag
                    v-if="userStore.currentUser && userStore.currentUser.gender && (row.targetPopulation.gender === 'any' || row.targetPopulation.gender === userStore.currentUser.gender)"
                    size="mini"
                    type="info"
                    style="font-size: 10px; padding: 0 4px; height: 16px; line-height: 14px;"
                  >
                    当前适用
                  </el-tag>
                </div>
                <el-text type="info" size="small" v-if="row.name_en" style="display: block; width: 100%; text-align: left;">{{ row.name_en }}</el-text>
              </div>
            </el-tooltip>
            <div v-else style="display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <el-text strong>{{ row.id }} {{ row.name }}</el-text>
                <!-- 匹配当前选中用户性别标签 (兜底: targetPopulation 未指定或者为 any) -->
                <el-tag
                  v-if="userStore.currentUser && userStore.currentUser.gender && (!row.targetPopulation || !row.targetPopulation.gender || row.targetPopulation.gender === 'any')"
                  size="mini"
                  type="info"
                  style="font-size: 10px; padding: 0 4px; height: 16px; line-height: 14px;"
                >
                  当前适用
                </el-tag>
              </div>
              <el-text type="info" size="small" v-if="row.name_en" style="display: block; width: 100%; text-align: left;">{{ row.name_en }}</el-text>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="category" label="分类" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ categoryLabel(row.category) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="questions" label="题数" width="80">
          <template #default="{ row }">
            {{ row.questions.length }}题
          </template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <div style="display: flex; align-items: center; gap: 8px;">
              <el-button
                type="text"
                style="padding: 0; min-height: auto;"
                @click="handleToggleFavorite(row.id)"
              >
                <el-icon :size="20" :style="{ color: favoriteStore.isFavorite(row.id) ? '#e6a23c' : '#c0c4cc' }">
                  <component :is="favoriteStore.isFavorite(row.id) ? 'StarFilled' : 'Star'" />
                </el-icon>
              </el-button>
              <el-button
                type="primary"
                size="small"
                @click="startScale(row.id)"
              >
                开始测评
              </el-button>
              <el-button
                type="warning"
                size="small"
                plain
                @click="exportAnonymizedScaleData(row.id)"
              >
                <el-icon style="margin-right: 4px;"><Download /></el-icon>
                导出全部脱敏数据
              </el-button>
              <el-button
                type="success"
                size="small"
                plain
                @click="$router.push({ path: '/data-analysis', query: { scaleId: row.id } })"
              >
                <el-icon style="margin-right: 4px;"><PieChart /></el-icon>
                数据分析
              </el-button>
            </div>
          </template>
        </el-table-column>
        </el-table>
      </div>

      <div v-else-if="activeTab === 'packages'">
        <el-table :data="packageStore.packages" style="width: 100%">
          <el-table-column prop="name" label="套餐名称" width="200" />
          <el-table-column label="包含量表数量" width="120">
            <template #default="{ row }">
              {{ row.scale_ids?.length || 0 }} 个量表
            </template>
          </el-table-column>
          <el-table-column label="量表详情">
            <template #default="{ row }">
              <el-tag
                v-for="scaleId in row.scale_ids"
                :key="scaleId"
                style="margin-right: 4px; margin-bottom: 4px;"
                type="info"
                size="small"
              >
                {{ scaleStore.scales.find(s => s.id === scaleId)?.name || scaleId }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button
                type="primary"
                size="small"
                @click="startPackage(row)"
              >
                开始连续测评
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scale-list-view {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-left h2 {
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.error-alert {
  margin-bottom: 16px;
}

.error-item {
  padding: 4px 0;
  font-size: 13px;
}

.scale-name-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.page-content {
  background: var(--app-card, #fff);
  border-radius: 8px;
  padding: 16px;
}

.dark .page-content {
  background: var(--app-card, #16213e);
}
</style>

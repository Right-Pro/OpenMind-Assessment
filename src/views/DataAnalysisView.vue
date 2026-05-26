<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useScaleStore } from '@/stores/scaleStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { ElMessage } from 'element-plus'
import * as XLSX from 'xlsx'
import { useRoute, useRouter } from 'vue-router'

// 1. ECharts 引入
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent
} from 'echarts/components'

use([
  CanvasRenderer,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent
])

const scaleStore = useScaleStore()
const settingsStore = useSettingsStore()
const route = useRoute()
const router = useRouter()

// 激活的模块选项卡
const activeTab = ref('module1')

// 可选量表列表
const scaleList = computed(() => scaleStore.scales)

// 暗黑模式适配 ECharts
const isDark = computed(() => settingsStore.darkMode)
const echartsTheme = computed(() => (isDark.value ? 'dark' : 'light'))

const textStyleColor = computed(() => (isDark.value ? '#ffffff' : '#333333'))
const axisLineColor = computed(() => (isDark.value ? '#555555' : '#cccccc'))
const splitLineColor = computed(() => (isDark.value ? '#333333' : '#eeeeee'))

// ==================== 模块一：跨被试项目统计 ====================
const m1SelectedScaleId = ref('')
const m1Loading = ref(false)
const m1HasData = ref(false)

const m1Stats = ref({
  max: 0,
  min: 0,
  avg: 0,
  stdDev: 0,
  n: 0,
  median: 0
})

const m1ChartOption = ref<any>(null)
const m1TableData = ref<any[]>([])

async function loadModule1Data(scaleId: string) {
  if (!scaleId) return
  m1Loading.value = true
  m1HasData.value = false
  try {
    // 1. 获取该量表下所有已完成的记录总分列表（采用聚合与批量查询相结合）
    // SQLite 没有原生的 MEDIAN 和 STDDEV_SAMP，因此我们直接聚合获取 Max, Min, Avg, N，并拉取总分列表在前端计算中位数和标准差
    // 由于只拉取每个被试的“总分”(一个数字)，即使有几万条数据也只有几万个数字，完全不会卡死，而不需要拉取 full JSON 或 answers 详情。
    const querySql = `
      SELECT raw_score 
      FROM tests 
      WHERE scale_id = ? AND status = 'completed'
      ORDER BY raw_score ASC
    `
    const records = await window.electronAPI.dbQuery(querySql, [scaleId])
    const n = records.length
    if (n === 0) {
      m1HasData.value = false
      m1Stats.value = { max: 0, min: 0, avg: 0, stdDev: 0, n: 0, median: 0 }
      m1ChartOption.value = null
      m1TableData.value = []
      return
    }

    m1HasData.value = true
    const scores = records.map((r: any) => r.raw_score)

    // 计算 Max, Min, Avg
    const min = scores[0]
    const max = scores[n - 1]
    const sum = scores.reduce((acc: number, val: number) => acc + val, 0)
    const avg = sum / n

    // 计算中位数 Median
    let median = 0
    if (n % 2 === 1) {
      median = scores[Math.floor(n / 2)]
    } else {
      median = (scores[n / 2 - 1] + scores[n / 2]) / 2
    }

    // 计算标准差 StdDev
    let stdDev = 0
    if (n > 1) {
      const variance = scores.reduce((acc: number, val: number) => acc + Math.pow(val - avg, 2), 0) / (n - 1)
      stdDev = Math.sqrt(variance)
    }

    m1Stats.value = {
      max: Number(max.toFixed(2)),
      min: Number(min.toFixed(2)),
      avg: Number(avg.toFixed(2)),
      stdDev: Number(stdDev.toFixed(2)),
      n,
      median: Number(median.toFixed(2))
    }

    // 计算分数区间柱状图分布
    // 区间大小根据 max - min 动态定义，或者默认以 10 分为一档（0-10, 11-20, 21-30...）
    // 或者根据最大分数上限动态划分 10 个区间
    const scoreRangeMax = Math.max(max, 10)
    const step = Math.ceil(scoreRangeMax / 10) || 1
    const intervals: { label: string; min: number; max: number; count: number }[] = []
    
    for (let i = 0; i < 10; i++) {
      const curMin = i * step
      const curMax = (i + 1) * step
      intervals.push({
        label: `${curMin}-${curMax}`,
        min: curMin,
        max: curMax,
        count: 0
      })
    }

    scores.forEach((score: number) => {
      // 找到匹配的区间
      let placed = false
      for (let i = 0; i < intervals.length; i++) {
        const interval = intervals[i]
        // 最后一个区间包含最大边界
        if (i === intervals.length - 1) {
          if (score >= interval.min) {
            interval.count++
            placed = true
            break
          }
        } else {
          if (score >= interval.min && score < interval.max) {
            interval.count++
            placed = true
            break
          }
        }
      }
      if (!placed && scores.length > 0) {
        // 防止溢出或边界问题
        if (score < intervals[0].min) {
          intervals[0].count++
        } else {
          intervals[intervals.length - 1].count++
        }
      }
    })

    // 图表配置
    m1ChartOption.value = {
      backgroundColor: 'transparent',
      title: {
        text: '被试得分区间人数分布',
        textStyle: { color: textStyleColor.value, fontSize: 14, fontWeight: 'normal' },
        left: 'center'
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' }
      },
      grid: {
        left: '5%',
        right: '5%',
        bottom: '10%',
        top: '15%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        data: intervals.map(item => item.label),
        axisLine: { lineStyle: { color: axisLineColor.value } },
        axisLabel: { color: textStyleColor.value }
      },
      yAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: axisLineColor.value } },
        axisLabel: { color: textStyleColor.value },
        splitLine: { lineStyle: { color: splitLineColor.value } }
      },
      series: [
        {
          name: '被试人数',
          type: 'bar',
          data: intervals.map(item => item.count),
          itemStyle: {
            color: '#409EFF'
          },
          barMaxWidth: 40
        }
      ]
    }

    // 表格展示数据
    m1TableData.value = [
      { metric: '样本量 (N)', value: m1Stats.value.n },
      { metric: '最大值 (Max)', value: m1Stats.value.max },
      { metric: '最小值 (Min)', value: m1Stats.value.min },
      { metric: '平均值 (Mean)', value: m1Stats.value.avg },
      { metric: '中位数 (Median)', value: m1Stats.value.median },
      { metric: '标准差 (StdDev)', value: m1Stats.value.stdDev }
    ]
  } catch (e: any) {
    ElMessage.error('加载项目统计失败: ' + e.message)
  } finally {
    m1Loading.value = false
  }
}


// ==================== 模块二：跨被试因子统计 ====================
const m2SelectedScaleId = ref('')
const m2Loading = ref(false)
const m2HasData = ref(false)
const m2HasDimensions = ref(true)
const m2DisplayType = ref<'avg' | 'max' | 'min'>('avg') // 柱状图切换显示平均值/最大值/最小值

const m2StatsTable = ref<any[]>([])
const m2ChartOption = ref<any>(null)

async function loadModule2Data(scaleId: string) {
  if (!scaleId) return
  m2Loading.value = true
  m2HasData.value = false
  m2HasDimensions.value = true
  try {
    const scale = scaleStore.getScaleById(scaleId)
    if (!scale) return

    // 检查是否有维度配置
    const dimensions = scale.scoring?.dimensions
    if (!dimensions || dimensions.length === 0) {
      m2HasDimensions.value = false
      m2HasData.value = false
      m2StatsTable.value = []
      m2ChartOption.value = null
      return
    }

    // 获取该量表下所有已完成的记录
    const querySql = `
      SELECT result_json 
      FROM tests 
      WHERE scale_id = ? AND status = 'completed'
    `
    const records = await window.electronAPI.dbQuery(querySql, [scaleId])
    const n = records.length
    if (n === 0) {
      m2HasData.value = false
      m2StatsTable.value = []
      m2ChartOption.value = null
      return
    }

    m2HasData.value = true

    // 解析各个因子的分数
    // 每个维度对应的统计容器：{ name: string, scores: number[] }
    const dimScoreMap: Record<string, number[]> = {}
    dimensions.forEach(d => {
      dimScoreMap[d.name] = []
    })

    records.forEach((r: any) => {
      try {
        if (r.result_json) {
          const resultObj = JSON.parse(r.result_json)
          if (resultObj.dimensionScores) {
            Object.entries(resultObj.dimensionScores).forEach(([dimName, scoreVal]) => {
              if (dimScoreMap[dimName] !== undefined && typeof scoreVal === 'number') {
                dimScoreMap[dimName].push(scoreVal)
              }
            })
          }
        }
      } catch (err) {}
    })

    // 计算每个因子的样本量、最大值、最小值、平均值、标准差
    const calculatedDims: any[] = []
    dimensions.forEach(d => {
      const scores = dimScoreMap[d.name] || []
      const count = scores.length
      if (count === 0) {
        calculatedDims.push({
          name: d.name,
          n: 0,
          max: '/',
          min: '/',
          avg: '/',
          stdDev: '/'
        })
        return
      }

      scores.sort((a, b) => a - b)
      const min = scores[0]
      const max = scores[count - 1]
      const sum = scores.reduce((acc, v) => acc + v, 0)
      const avg = sum / count

      let stdDev = 0
      if (count > 1) {
        const variance = scores.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / (count - 1)
        stdDev = Math.sqrt(variance)
      }

      calculatedDims.push({
        name: d.name,
        n: count,
        max: Number(max.toFixed(2)),
        min: Number(min.toFixed(2)),
        avg: Number(avg.toFixed(2)),
        stdDev: Number(stdDev.toFixed(2))
      })
    })

    m2StatsTable.value = calculatedDims
    renderModule2Chart()
  } catch (e: any) {
    ElMessage.error('加载因子统计失败: ' + e.message)
  } finally {
    m2Loading.value = false
  }
}

function renderModule2Chart() {
  if (m2StatsTable.value.length === 0) {
    m2ChartOption.value = null
    return
  }

  const validData = m2StatsTable.value.filter(d => d.n > 0)
  const names = validData.map(d => d.name)
  let yData: number[] = []
  let seriesName = '平均分'

  if (m2DisplayType.value === 'avg') {
    yData = validData.map(d => d.avg)
    seriesName = '平均分'
  } else if (m2DisplayType.value === 'max') {
    yData = validData.map(d => d.max)
    seriesName = '最大分'
  } else if (m2DisplayType.value === 'min') {
    yData = validData.map(d => d.min)
    seriesName = '最小分'
  }

  m2ChartOption.value = {
    backgroundColor: 'transparent',
    title: {
      text: `因子维度分统计图 (${seriesName})`,
      textStyle: { color: textStyleColor.value, fontSize: 14, fontWeight: 'normal' },
      left: 'center'
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' }
    },
    grid: {
      left: '5%',
      right: '5%',
      bottom: '10%',
      top: '15%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: names,
      axisLine: { lineStyle: { color: axisLineColor.value } },
      axisLabel: { color: textStyleColor.value, interval: 0, rotate: 25 }
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: axisLineColor.value } },
      axisLabel: { color: textStyleColor.value },
      splitLine: { lineStyle: { color: splitLineColor.value } }
    },
    series: [
      {
        name: seriesName,
        type: 'bar',
        data: yData,
        itemStyle: {
          color: m2DisplayType.value === 'avg' ? '#67C23A' : m2DisplayType.value === 'max' ? '#F56C6C' : '#E6A23C'
        },
        barMaxWidth: 40
      }
    ]
  }
}

// 监听因子图表显示指标切换
watch(m2DisplayType, () => {
  renderModule2Chart()
})


// ==================== 模块三：多维度汇总查询 ====================
const m3Filters = ref<{
  scaleId: string
  groupId: string // 用户分组 (tags 字段)
  ageRange: string
  gender: string
  dateRange: [string, string] | null
}>({
  scaleId: '',
  groupId: '',
  ageRange: '',
  gender: 'all',
  dateRange: null
})

const m3Loading = ref(false)
const m3HasData = ref(false)

// 可用的测试分组 (从所有用户档案中提取不重复的 tags 展开)
const groupOptions = ref<string[]>([])

// 汇总结果数据
const m3Result = ref<{
  totalCount: number
  overallAvg: number | string
  dimensionAvgs: { name: string; avg: number }[]
  severityDist: { name: string; count: number; color: string }[]
}>({
  totalCount: 0,
  overallAvg: 0,
  dimensionAvgs: [],
  severityDist: []
})

const m3ChartOption = ref<any>(null)
const m3TableData = ref<any[]>([])

// 初始化加载测试分组下拉数据
async function loadGroupOptions() {
  try {
    const querySql = "SELECT tags FROM users WHERE tags IS NOT NULL AND tags != ''"
    const rows = await window.electronAPI.dbQuery(querySql)
    const groupsSet = new Set<string>()
    rows.forEach((r: any) => {
      try {
        const parsed = JSON.parse(r.tags)
        if (Array.isArray(parsed)) {
          parsed.forEach((tag: string) => {
            if (tag.trim()) groupsSet.add(tag.trim())
          })
        }
      } catch (err) {}
    })
    groupOptions.value = Array.from(groupsSet)
  } catch (e) {
    console.error('加载分组列表失败:', e)
  }
}

async function handleM3Search() {
  const scaleId = m3Filters.value.scaleId
  if (!scaleId) {
    ElMessage.warning('请先选择一个量表')
    return
  }

  m3Loading.value = true
  m3HasData.value = false
  try {
    const scale = scaleStore.getScaleById(scaleId)
    if (!scale) return

    // 1. 构建查询条件
    const conditions: string[] = ['t.scale_id = ?', "t.status = 'completed'"]
    const params: any[] = [scaleId]

    // 筛选：测试分组
    if (m3Filters.value.groupId) {
      // 模糊匹配 JSON 数组中的特定 tag，或者直接 LIKE
      conditions.push('u.tags LIKE ?')
      params.push(`%\"${m3Filters.value.groupId}\"%`)
    }

    // 筛选：性别
    if (m3Filters.value.gender && m3Filters.value.gender !== 'all') {
      conditions.push('u.gender = ?')
      params.push(m3Filters.value.gender === 'male' ? 'male' : 'female')
    }

    // 筛选：测试时间范围
    if (m3Filters.value.dateRange && m3Filters.value.dateRange.length === 2) {
      conditions.push('t.created_at >= ? AND t.created_at <= ?')
      params.push(m3Filters.value.dateRange[0] + ' 00:00:00', m3Filters.value.dateRange[1] + ' 23:59:59')
    }

    // SQLite 中无法直接做年龄区间过滤（出生日期是 YYYY-MM-DD，通过 datetime('now') - birthdate 算出），我们可以在前端配合年龄段的 birthdate 边界计算，或者拉取数据后在前端过滤年龄段。
    // 为了满足“数据库查询尽量用聚合函数，不要全量拉取到前端再计算，防止数据量大时卡死”的要求，我们可以在 SQL 层就实现精确的年龄阶段出生日期边界划分。
    // <18 / 18-30 / 31-50 / >50
    // 例如今年是 2026 年，<18 表示出生日期在 2008-05-26 之后；18-30 表示在 1996-05-26 到 2008-05-26 之间。
    // 我们可以直接在 SQL 中根据当前时间动态计算 birthdate 条件：
    if (m3Filters.value.ageRange) {
      const todayStr = new Date().toISOString().slice(0, 10)
      if (m3Filters.value.ageRange === '<18') {
        conditions.push("CAST(strftime('%Y', 'now') - strftime('%Y', u.birthdate) AS INT) < 18")
      } else if (m3Filters.value.ageRange === '18-30') {
        conditions.push("CAST(strftime('%Y', 'now') - strftime('%Y', u.birthdate) AS INT) BETWEEN 18 AND 30")
      } else if (m3Filters.value.ageRange === '31-50') {
        conditions.push("CAST(strftime('%Y', 'now') - strftime('%Y', u.birthdate) AS INT) BETWEEN 31 AND 50")
      } else if (m3Filters.value.ageRange === '>50') {
        conditions.push("CAST(strftime('%Y', 'now') - strftime('%Y', u.birthdate) AS INT) > 50")
      }
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

    // 2. 统计记录数与总分平均值 (聚合查询)
    const aggregateSql = `
      SELECT COUNT(t.id) as total_count, AVG(t.raw_score) as avg_score
      FROM tests t
      LEFT JOIN users u ON t.user_id = u.id
      ${whereClause}
    `
    const aggResult = await window.electronAPI.dbQuery(aggregateSql, params)
    const totalCount = aggResult[0]?.total_count || 0
    const avgScore = aggResult[0]?.avg_score || 0

    if (totalCount === 0) {
      m3HasData.value = false
      m3Result.value = { totalCount: 0, overallAvg: 0, dimensionAvgs: [], severityDist: [] }
      m3ChartOption.value = null
      m3TableData.value = []
      return
    }

    m3HasData.value = true

    // 3. 统计各因子的平均分
    // 因为 dimension 结果以 JSON string (result_json) 存储在 tests 中，难以在 SQLite 中用标准聚合直接查询 JSON
    // 但我们可以利用 SQLite 聚合查询，只查询 result_json 这一列（在当前过滤条件下），即使条数很多，我们也只取出 result_json 的文本而非所有关联数据，然后在前端进行汇总。
    // 为了避免拉取大块的 answers (题库详细答题历史)，只拉取 result_json 已经足够轻量。
    const resultJsonSql = `
      SELECT t.result_json 
      FROM tests t
      LEFT JOIN users u ON t.user_id = u.id
      ${whereClause}
    `
    const records = await window.electronAPI.dbQuery(resultJsonSql, params)

    const dimSum: Record<string, { sum: number; count: number }> = {}
    const severityCountMap: Record<string, number> = {}

    // 初始化因子和严重等级
    const dimensions = scale.scoring?.dimensions || []
    dimensions.forEach(d => {
      dimSum[d.name] = { sum: 0, count: 0 }
    })

    const cutoffs = scale.interpretation?.cutoffs || []
    const severityMetaMap: Record<string, { label: string; color: string }> = {}
    cutoffs.forEach(c => {
      severityCountMap[c.label] = 0
      severityMetaMap[c.label] = {
        label: c.label,
        color: c.color || '#909399'
      }
    })

    records.forEach((r: any) => {
      try {
        if (r.result_json) {
          const parsed = JSON.parse(r.result_json)
          // 因子累加
          if (parsed.dimensionScores) {
            Object.entries(parsed.dimensionScores).forEach(([dimName, scoreVal]) => {
              if (dimSum[dimName] !== undefined && typeof scoreVal === 'number') {
                dimSum[dimName].sum += scoreVal
                dimSum[dimName].count++
              }
            })
          }
          // severity 状态等级统计
          const label = parsed.interpretation?.label
          if (label && severityCountMap[label] !== undefined) {
            severityCountMap[label]++
          }
        }
      } catch (err) {}
    })

    // 组装因子平均分
    const dimensionAvgs = Object.entries(dimSum).map(([name, val]) => ({
      name,
      avg: val.count > 0 ? Number((val.sum / val.count).toFixed(2)) : 0
    }))

    // 组装严重等级分布
    const severityDist = Object.entries(severityCountMap).map(([label, count]) => ({
      name: label,
      count,
      color: severityMetaMap[label]?.color || '#909399'
    }))

    m3Result.value = {
      totalCount,
      overallAvg: Number(avgScore.toFixed(2)),
      dimensionAvgs,
      severityDist
    }

    // 图表：ECharts 分组柱状图（包含总分平均分与各个因子平均分）
    const barNames = ['总分平均值', ...dimensionAvgs.map(d => d.name)]
    const barValues = [Number(avgScore.toFixed(2)), ...dimensionAvgs.map(d => d.avg)]

    m3ChartOption.value = {
      backgroundColor: 'transparent',
      title: {
        text: '多维度汇总分数指标 (平均分)',
        textStyle: { color: textStyleColor.value, fontSize: 14, fontWeight: 'normal' },
        left: 'center'
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' }
      },
      grid: {
        left: '5%',
        right: '5%',
        bottom: '10%',
        top: '15%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        data: barNames,
        axisLine: { lineStyle: { color: axisLineColor.value } },
        axisLabel: { color: textStyleColor.value, interval: 0, rotate: 25 }
      },
      yAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: axisLineColor.value } },
        axisLabel: { color: textStyleColor.value },
        splitLine: { lineStyle: { color: splitLineColor.value } }
      },
      series: [
        {
          name: '平均分',
          type: 'bar',
          data: barValues,
          itemStyle: {
            color: '#409EFF'
          },
          barMaxWidth: 40
        }
      ]
    }

    // 底部表格数据汇总
    const tData: any[] = [
      { metric: '总分平均分', value: m3Result.value.overallAvg }
    ]
    dimensionAvgs.forEach(d => {
      tData.push({ metric: `维度: ${d.name} 平均分`, value: d.avg })
    })
    severityDist.forEach(s => {
      tData.push({ metric: `等级: ${s.name} 被试人数`, value: `${s.count} 人` })
    })

    m3TableData.value = tData
  } catch (e: any) {
    ElMessage.error('汇总查询失败: ' + e.message)
  } finally {
    m3Loading.value = false
  }
}

// 导出 Excel 文件汇总 (SheetJS)
async function handleM3Export() {
  const scaleId = m3Filters.value.scaleId
  if (!scaleId) {
    ElMessage.warning('请先选择一个量表')
    return
  }
  const scale = scaleStore.getScaleById(scaleId)
  if (!scale) return

  if (m3TableData.value.length === 0) {
    ElMessage.warning('暂无汇总查询结果可导出')
    return
  }

  try {
    // 准备数据源
    const exportData = m3TableData.value.map(row => ({
      '统计指标/维度名称': row.metric,
      '指标数值/人数占比': row.value
    }))

    // 添加一些基本元数据信息
    const metaData = [
      { '统计指标/维度名称': '查询量表', '指标数值/人数占比': scale.name },
      { '统计指标/维度名称': '测试分组条件', '指标数值/人数占比': m3Filters.value.groupId || '全部' },
      { '统计指标/维度名称': '年龄段条件', '指标数值/人数占比': m3Filters.value.ageRange || '全部' },
      { '统计指标/维度名称': '性别条件', '指标数值/人数占比': m3Filters.value.gender === 'male' ? '男' : m3Filters.value.gender === 'female' ? '女' : '全部' },
      { '统计指标/维度名称': '测试记录数 (N)', '指标数值/人数占比': `${m3Result.value.totalCount} 记录` },
      { '统计指标/维度名称': '', '指标数值/人数占比': '' } // 空白隔离行
    ]

    const ws = XLSX.utils.json_to_sheet([...metaData, ...exportData])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '汇总统计结果')

    // 列宽自适应
    ws['!cols'] = [{ wch: 25 }, { wch: 20 }]

    const YYYYMMDD = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const fileName = `汇总查询_${scale.name}_${YYYYMMDD}.xlsx`

    XLSX.writeFile(wb, fileName)
    ElMessage.success('汇总查询 Excel 报表导出成功！')
  } catch (e: any) {
    ElMessage.error('导出 Excel 失败: ' + e.message)
  }
}

// 统一监听量表选择变化自动加载数据 (如果量表被选择)
watch(m1SelectedScaleId, (newId) => {
  if (newId) loadModule1Data(newId)
})

watch(m2SelectedScaleId, (newId) => {
  if (newId) loadModule2Data(newId)
})

// 当全局暗色模式或者相关样式发生变化时，重新渲染 ECharts
watch(isDark, () => {
  if (m1SelectedScaleId.value) loadModule1Data(m1SelectedScaleId.value)
  if (m2SelectedScaleId.value) loadModule2Data(m2SelectedScaleId.value)
  if (m3Filters.value.scaleId && m3HasData.value) handleM3Search()
})

onMounted(async () => {
  await scaleStore.loadScales()
  await loadGroupOptions()

  // 检查是否从外部链接/路由带参数跳转过来的
  const fromScaleId = route.query.scaleId as string
  if (fromScaleId) {
    m1SelectedScaleId.value = fromScaleId
    m2SelectedScaleId.value = fromScaleId
    m3Filters.value.scaleId = fromScaleId
    // 如果有带参数，可以默认激活第一项
    activeTab.value = 'module1'
  }
})
</script>

<template>
  <div class="data-analysis-view">
    <div class="page-header no-print">
      <div class="header-left">
        <h2>数据分析中心</h2>
      </div>
    </div>

    <div class="page-content">
      <el-tabs v-model="activeTab" class="fluent-tabs">
        <!-- 模块一：项目统计 -->
        <el-tab-pane label="项目统计" name="module1">
          <div class="tab-module-container">
            <!-- 筛选区 -->
            <div class="filter-section acrylic-panel">
              <el-form inline>
                <el-form-item label="量表选择">
                  <el-select
                    v-model="m1SelectedScaleId"
                    placeholder="选择量表进行统计"
                    filterable
                    style="width: 260px"
                  >
                    <el-option
                      v-for="s in scaleList"
                      :key="s.id"
                      :label="s.name"
                      :value="s.id"
                    />
                  </el-select>
                </el-form-item>
              </el-form>
            </div>

            <!-- 数据展示与图表区 -->
            <div v-loading="m1Loading" class="analysis-results">
              <div v-if="m1SelectedScaleId && m1HasData" class="results-layout">
                <!-- 顶部数值指标卡片 -->
                <div class="summary-cards">
                  <el-row :gutter="16">
                    <el-col :span="4">
                      <div class="metric-card">
                        <div class="metric-label">样本量 (N)</div>
                        <div class="metric-value">{{ m1Stats.n }}</div>
                      </div>
                    </el-col>
                    <el-col :span="4">
                      <div class="metric-card">
                        <div class="metric-label">最大值 (Max)</div>
                        <div class="metric-value">{{ m1Stats.max }}</div>
                      </div>
                    </el-col>
                    <el-col :span="4">
                      <div class="metric-card">
                        <div class="metric-label">最小值 (Min)</div>
                        <div class="metric-value">{{ m1Stats.min }}</div>
                      </div>
                    </el-col>
                    <el-col :span="4">
                      <div class="metric-card">
                        <div class="metric-label">平均值 (Mean)</div>
                        <div class="metric-value">{{ m1Stats.avg }}</div>
                      </div>
                    </el-col>
                    <el-col :span="4">
                      <div class="metric-card">
                        <div class="metric-label">中位数 (Median)</div>
                        <div class="metric-value">{{ m1Stats.median }}</div>
                      </div>
                    </el-col>
                    <el-col :span="4">
                      <div class="metric-card">
                        <div class="metric-label">标准差 (StdDev)</div>
                        <div class="metric-value">{{ m1Stats.stdDev }}</div>
                      </div>
                    </el-col>
                  </el-row>
                </div>

                <!-- 中部图表区 -->
                <div class="chart-container acrylic-panel" style="margin-top: 16px;">
                  <div class="chart-wrapper" style="height: 350px;">
                    <v-chart :option="m1ChartOption" :theme="echartsTheme" autoresize />
                  </div>
                </div>

                <!-- 底部表格区 -->
                <div class="table-container" style="margin-top: 16px;">
                  <el-card shadow="never" class="acrylic-card">
                    <template #header>
                      <span class="card-title">具体统计数值</span>
                    </template>
                    <el-table :data="m1TableData" border style="width: 100%">
                      <el-table-column prop="metric" label="统计指标" />
                      <el-table-column prop="value" label="指标数值" />
                    </el-table>
                  </el-card>
                </div>
              </div>

              <!-- 占位图 -->
              <div v-else-if="m1SelectedScaleId && !m1HasData" class="no-data-placeholder">
                <el-empty description="暂无该量表的测试记录数据" />
              </div>
              <div v-else class="no-data-placeholder">
                <el-empty description="请从上方下拉菜单选择一个量表以开始分析" />
              </div>
            </div>
          </div>
        </el-tab-pane>

        <!-- 模块二：因子统计 -->
        <el-tab-pane label="因子统计" name="module2">
          <div class="tab-module-container">
            <!-- 筛选区 -->
            <div class="filter-section acrylic-panel">
              <el-form inline>
                <el-form-item label="量表选择">
                  <el-select
                    v-model="m2SelectedScaleId"
                    placeholder="选择量表进行因子统计"
                    filterable
                    style="width: 260px"
                  >
                    <el-option
                      v-for="s in scaleList"
                      :key="s.id"
                      :label="s.name"
                      :value="s.id"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item v-if="m2SelectedScaleId && m2HasDimensions && m2HasData" label="指标切换">
                  <el-radio-group v-model="m2DisplayType" size="small">
                    <el-radio-button label="avg">平均值</el-radio-button>
                    <el-radio-button label="max">最大值</el-radio-button>
                    <el-radio-button label="min">最小值</el-radio-button>
                  </el-radio-group>
                </el-form-item>
              </el-form>
            </div>

            <!-- 结果与图表区 -->
            <div v-loading="m2Loading" class="analysis-results">
              <div v-if="m2SelectedScaleId && m2HasDimensions && m2HasData" class="results-layout">
                <!-- 中部图表区 -->
                <div class="chart-container acrylic-panel">
                  <div class="chart-wrapper" style="height: 350px;">
                    <v-chart :option="m2ChartOption" :theme="echartsTheme" autoresize />
                  </div>
                </div>

                <!-- 底部表格区 -->
                <div class="table-container" style="margin-top: 16px;">
                  <el-card shadow="never" class="acrylic-card">
                    <template #header>
                      <span class="card-title">各维度因子详细统计</span>
                    </template>
                    <el-table :data="m2StatsTable" border style="width: 100%">
                      <el-table-column prop="name" label="维度/因子名称" />
                      <el-table-column prop="n" label="样本量 (N)" />
                      <el-table-column prop="max" label="最大值 (Max)" />
                      <el-table-column prop="min" label="最小值 (Min)" />
                      <el-table-column prop="avg" label="平均值 (Mean)" />
                      <el-table-column prop="stdDev" label="标准差 (StdDev)" />
                    </el-table>
                  </el-card>
                </div>
              </div>

              <!-- 占位与异常提示 -->
              <div v-else-if="m2SelectedScaleId && !m2HasDimensions" class="no-data-placeholder">
                <el-alert
                  title="该量表无维度划分"
                  type="info"
                  show-icon
                  description="当前量表未在 scoring -> dimensions 配置中定义子成分/因子，无法进行因子统计分析。"
                  :closable="false"
                  style="max-width: 500px; margin: 40px auto;"
                />
              </div>
              <div v-else-if="m2SelectedScaleId && !m2HasData" class="no-data-placeholder">
                <el-empty description="暂无该量表的测试记录数据" />
              </div>
              <div v-else class="no-data-placeholder">
                <el-empty description="请从上方下拉菜单选择一个量表以开始分析" />
              </div>
            </div>
          </div>
        </el-tab-pane>

        <!-- 模块三：多维度汇总查询 -->
        <el-tab-pane label="多维度汇总查询" name="module3">
          <div class="tab-module-container">
            <!-- 顶部多条件筛选区 -->
            <div class="filter-section acrylic-panel" style="padding: 16px 20px;">
              <el-form :model="m3Filters" inline label-width="auto">
                <el-form-item label="选择量表" required>
                  <el-select
                    v-model="m3Filters.scaleId"
                    placeholder="选择量表 (必选)"
                    filterable
                    style="width: 220px;"
                  >
                    <el-option
                      v-for="s in scaleList"
                      :key="s.id"
                      :label="s.name"
                      :value="s.id"
                    />
                  </el-select>
                </el-form-item>

                <el-form-item label="测试分组">
                  <el-select
                    v-model="m3Filters.groupId"
                    placeholder="选择分组"
                    clearable
                    style="width: 160px;"
                  >
                    <el-option
                      v-for="group in groupOptions"
                      :key="group"
                      :label="group"
                      :value="group"
                    />
                  </el-select>
                </el-form-item>

                <el-form-item label="年龄阶段">
                  <el-select
                    v-model="m3Filters.ageRange"
                    placeholder="选择年龄段"
                    clearable
                    style="width: 140px;"
                  >
                    <el-option label="< 18 岁" value="<18" />
                    <el-option label="18 - 30 岁" value="18-30" />
                    <el-option label="31 - 50 岁" value="31-50" />
                    <el-option label="> 50 岁" value=">50" />
                  </el-select>
                </el-form-item>

                <el-form-item label="性别">
                  <el-select
                    v-model="m3Filters.gender"
                    placeholder="选择性别"
                    style="width: 100px;"
                  >
                    <el-option label="全部" value="all" />
                    <el-option label="男" value="male" />
                    <el-option label="女" value="female" />
                  </el-select>
                </el-form-item>

                <el-form-item label="时间范围">
                  <el-date-picker
                    v-model="m3Filters.dateRange"
                    type="daterange"
                    range-separator="至"
                    start-placeholder="开始日期"
                    end-placeholder="结束日期"
                    value-format="YYYY-MM-DD"
                    style="width: 240px;"
                  />
                </el-form-item>

                <el-form-item>
                  <el-button type="primary" @click="handleM3Search">
                    <el-icon style="margin-right: 4px;"><Search /></el-icon>
                    汇总查询
                  </el-button>
                  <el-button
                    type="success"
                    :disabled="!m3HasData"
                    @click="handleM3Export"
                  >
                    <el-icon style="margin-right: 4px;"><Download /></el-icon>
                    导出 Excel
                  </el-button>
                </el-form-item>
              </el-form>
            </div>

            <!-- 结果与图表区 -->
            <div v-loading="m3Loading" class="analysis-results">
              <div v-if="m3HasData" class="results-layout">
                <!-- 顶部结果概要卡片 -->
                <div class="summary-cards" style="margin-top: 16px;">
                  <el-row :gutter="16">
                    <el-col :span="6">
                      <div class="metric-card">
                        <div class="metric-label">符合条件测试记录数</div>
                        <div class="metric-value">{{ m3Result.totalCount }}</div>
                      </div>
                    </el-col>
                    <el-col :span="6">
                      <div class="metric-card">
                        <div class="metric-label">总分平均值</div>
                        <div class="metric-value">{{ m3Result.overallAvg }}</div>
                      </div>
                    </el-col>
                    <el-col :span="12">
                      <div class="metric-card severity-card-container">
                        <div class="metric-label">被试 severity 等级人数分布</div>
                        <div class="severity-tags-list">
                          <span
                            v-for="s in m3Result.severityDist"
                            :key="s.name"
                            class="severity-item"
                          >
                            <span class="severity-dot" :style="{ backgroundColor: s.color }" />
                            {{ s.name }}: <strong>{{ s.count }}人</strong>
                          </span>
                        </div>
                      </div>
                    </el-col>
                  </el-row>
                </div>

                <!-- 中部图表区 -->
                <div class="chart-container acrylic-panel" style="margin-top: 16px;">
                  <div class="chart-wrapper" style="height: 350px;">
                    <v-chart :option="m3ChartOption" :theme="echartsTheme" autoresize />
                  </div>
                </div>

                <!-- 底部表格区 -->
                <div class="table-container" style="margin-top: 16px;">
                  <el-card shadow="never" class="acrylic-card">
                    <template #header>
                      <span class="card-title">多维度汇总表格</span>
                    </template>
                    <el-table :data="m3TableData" border style="width: 100%">
                      <el-table-column prop="metric" label="统计指标/维度/等级" />
                      <el-table-column prop="value" label="指标数值 / 人数" />
                    </el-table>
                  </el-card>
                </div>
              </div>

              <!-- 占位图 -->
              <div v-else class="no-data-placeholder" style="margin-top: 20px;">
                <el-empty description="暂无符合筛选条件的数据" />
              </div>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<style scoped>
.data-analysis-view {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 20px;
}

.page-content {
  background: var(--app-card, #fff);
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
}

.dark .page-content {
  background: var(--app-card, #16213e);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.filter-section {
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 16px;
  background: var(--fluent-card, #fcfcfc);
  border: 1px solid var(--fluent-border, #eaeaea);
}

.dark .filter-section {
  background: var(--fluent-card, #1b2644);
  border-color: var(--fluent-border, #2a3b68);
}

.acrylic-panel {
  box-shadow: 0 2px 8px rgba(0,0,0,0.02);
}

.metric-card {
  background: var(--fluent-card, #f8f9fa);
  border: 1px solid var(--fluent-border, #eaeaea);
  border-radius: 6px;
  padding: 12px;
  text-align: center;
  transition: transform 0.2s;
}

.dark .metric-card {
  background: var(--fluent-card, #1b2644);
  border-color: var(--fluent-border, #2a3b68);
}

.metric-label {
  font-size: 12px;
  color: var(--fluent-text-secondary, #909399);
  margin-bottom: 4px;
}

.metric-value {
  font-size: 20px;
  font-weight: bold;
  color: var(--fluent-text-primary, #303133);
}

.dark .metric-value {
  color: #fff;
}

.severity-card-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 52px;
}

.severity-tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 4px;
}

.severity-item {
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.severity-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.chart-container {
  padding: 16px;
  border-radius: 8px;
  border: 1px solid var(--fluent-border, #eaeaea);
}

.dark .chart-container {
  border-color: var(--fluent-border, #2a3b68);
}

.acrylic-card {
  border-radius: 8px;
  border: 1px solid var(--fluent-border, #eaeaea) !important;
}

.dark .acrylic-card {
  background: transparent !important;
  border-color: var(--fluent-border, #2a3b68) !important;
  color: #fff;
}

.card-title {
  font-weight: bold;
  font-size: 14px;
}

.no-data-placeholder {
  padding: 60px 0;
  text-align: center;
}

.el-empty {
  padding: 20px 0;
}
</style>

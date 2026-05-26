<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useTestStore } from '@/stores/testStore'
import { useUserStore } from '@/stores/userStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useScaleStore } from '@/stores/scaleStore'
import { useScoring } from '@/composables/useScoring'
import { ElMessage } from 'element-plus'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, LineChart, RadarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, TitleComponent, RadarComponent } from 'echarts/components'

use([CanvasRenderer, BarChart, LineChart, RadarChart, GridComponent, TooltipComponent, LegendComponent, TitleComponent, RadarComponent])

const router = useRouter()
const route = useRoute()
const testStore = useTestStore()
const userStore = useUserStore()
const settingsStore = useSettingsStore()
const scaleStore = useScaleStore()
const { scoreTest } = useScoring()

const showRawData = ref(false)
const saving = ref(false)
const isSaved = ref(false)

// 批量测评数据结构
const batchResults = ref<any[]>([])
const selectedBatchIndex = ref(0)
const isBatch = computed(() => !!route.query.batchIds)

// 强制转型为 any 规避 typescript unknown 校验
const result = computed<any>(() => {
  if (isBatch.value && batchResults.value.length > 0) {
    return batchResults.value[selectedBatchIndex.value]?.result
  }
  return testStore.result
})

const scale = computed(() => {
  if (isBatch.value && batchResults.value.length > 0) {
    const scaleId = batchResults.value[selectedBatchIndex.value]?.scaleId
    return scaleStore.getScaleById(scaleId)
  }
  return testStore.currentScale
})

// 计算用户年龄
const userAge = computed(() => {
  if (!userStore.currentUser?.birthdate) return ''
  const birth = new Date(userStore.currentUser.birthdate)
  if (isNaN(birth.getTime())) return ''
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--
  }
  return age > 0 ? String(age) : '0'
})

// MMPI 效度评估与 T分计算
const mmpiTValues = computed(() => {
  if (scale.value?.id.toUpperCase() !== 'MMPI' || !result.value) return null
  const gender = userStore.currentUser?.gender === 'female' ? 'female' : 'male'
  const norms = scale.value.scoring.mmpiConfig?.norms?.[gender] || scale.value.scoring.mmpiConfig?.norms?.male
  if (!norms) return null

  const tScores: Record<string, number> = {}
  for (const [dim, raw] of Object.entries(result.value.dimensionScores || {}) as [string, any][]) {
    const norm = norms[dim]
    if (norm) {
      tScores[dim] = Math.round(50 + 10 * (raw - norm.mean) / norm.sd)
    } else {
      tScores[dim] = Math.round(raw)
    }
  }
  return tScores
})

const mmpiValidity = computed(() => {
  if (scale.value?.id.toUpperCase() !== 'MMPI' || !result.value || !mmpiTValues.value) return null

  const tL = mmpiTValues.value['L'] || 50
  const tF = mmpiTValues.value['F'] || 50
  const tK = mmpiTValues.value['K'] || 50

  const evalL = tL >= 70 ? '无效' : (tL >= 60 ? '警告' : '正常')
  const evalF = tF >= 80 ? '无效' : (tF >= 70 ? '警告' : '正常')
  const evalK = (tK >= 70 || tK <= 40) ? '警告' : '正常'

  let overallStatus = '正常'
  if (evalL === '无效' || evalF === '无效') {
    overallStatus = '无效'
  } else if (evalL === '警告' || evalF === '警告' || evalK === '警告') {
    overallStatus = '警告'
  }

  return {
    L: { raw: Number(result.value.dimensionScores?.['L'] || 0), t: Math.round(tL), status: evalL },
    F: { raw: Number(result.value.dimensionScores?.['F'] || 0), t: Math.round(tF), status: evalF },
    K: { raw: Number(result.value.dimensionScores?.['K'] || 0), t: Math.round(tK), status: evalK },
    overallStatus
  }
})

const mmpiHighPoints = computed(() => {
  if (scale.value?.id.toUpperCase() !== 'MMPI' || !mmpiTValues.value) return null

  const clinicalScales = ['Hs', 'D', 'Hy', 'Pd', 'Mf', 'Pa', 'Pt', 'Sc', 'Ma', 'Si']
  const scaleLabels: Record<string, string> = {
    Hs: '疑病 (Hs)',
    D: '抑郁 (D)',
    Hy: '癔症 (Hy)',
    Pd: '精神病态 (Pd)',
    Mf: '男子气-女子气 (Mf)',
    Pa: '偏执 (Pa)',
    Pt: '精神衰弱 (Pt)',
    Sc: '精神分裂 (Sc)',
    Ma: '轻躁狂 (Ma)',
    Si: '社会内向 (Si)'
  }

  const scaleDesc: Record<string, string> = {
    Hs: '高分提示对身体健康过度关注，可能将心理冲突转化为躯体不适主诉（躯体化倾向），常伴有疑病倾向、疲劳或焦虑。',
    D: '高分提示存在显著的抑郁情绪，如情绪消沉、悲观失望、缺乏活力、自我评价低及兴趣减退，多表现为退缩或忧郁。',
    Hy: '高分提示倾向于使用躯体症状来回避心理冲突和压力，渴望得到赞许，在人际中可能表现出过度依赖、幼稚或否认冲突。',
    Pd: '高分提示冲动、对社会规范的违背、容易产生敌意和人际冲突，可能存在亲密关系困难或对权威的抗拒。',
    Mf: '反映性别角色认同和兴趣广泛性。高分表示兴趣偏离传统性别角色，或存在性别角色的认同与社会心理冲突。',
    Pa: '高分提示偏执特质显著，容易敏感多疑、人际不信任、觉得受到不公正对待或抱有敌意，甚至可能出现受害者观念。',
    Pt: '高分提示存在强迫倾向、慢性焦虑、完美主义与缺乏安全感。容易过度担忧、反复思考、决策困难以及对自我要求过高。',
    Sc: '高分提示思维习惯独特或偏离常规，感到内心孤独、社交退缩或感到与他人有隔阂。极高分（T>=70）提示需防范感知觉或现实检验的偏离。',
    Ma: '高分提示思维活跃、精力充沛、情感高涨或易激惹。可能表现为活动增多、计划繁多但难以坚持，以及冲动鲁莽。',
    Si: '高分提示社会退缩、内向、害羞、社交回避或人际交往中感到不适；低分（T<40）则提示性格外向、喜爱社交。'
  }

  const scores = clinicalScales
    .map(key => ({
      key,
      label: scaleLabels[key],
      t: mmpiTValues.value![key] || 0,
      desc: scaleDesc[key]
    }))
    .sort((a, b) => b.t - a.t)

  const topScales = scores.slice(0, 3)
  const elevatedCount = topScales.filter(s => s.t >= 60).length
  const codeType = topScales.map(s => s.key).join('/')

  return {
    topScales,
    codeType,
    elevatedCount
  }
})

// 参考值范围逻辑计算
const referenceRange = computed(() => {
  if (!scale.value) return '/'
  const idUpper = scale.value.id.toUpperCase()
  if (idUpper === 'SAS') return '< 50'
  if (idUpper === 'SDS') return '< 53'
  if (idUpper === 'PHQ-9') return '< 5'
  if (idUpper === 'GAD-7') return '< 5'
  if (idUpper === 'PSQI') return '≤ 7'
  if (idUpper === 'HAMA') return '< 7'
  if (idUpper === 'HRSD-17') return '< 7'
  if (idUpper === 'SCL-90') return '总分 < 160，任意维度分 < 2'
  return '/'
})

// 水印背景样式
const watermarkBgStyle = computed(() => {
  const text = settingsStore.watermarkText
  if (!text) return {}
  
  const canvas = document.createElement('canvas')
  canvas.width = 280
  canvas.height = 200
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = '14px sans-serif'
    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)' // 按照要求使用 0.08 半透明度
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((-45 * Math.PI) / 180) // 旋转 45 度
    ctx.fillText(text, 0, 0)
  }
  
  return {
    backgroundImage: `url(${canvas.toDataURL()})`,
    backgroundRepeat: 'repeat',
    position: 'absolute' as const,
    left: '0px',
    top: '0px',
    width: '100%',
    height: '100%',
    pointerEvents: 'none' as const,
    zIndex: 99
  }
})

// SCL-90 专用指标计算
const scl90Metrics = computed(() => {
  if (scale.value?.id.toUpperCase() !== 'SCL-90' || !result.value) return null
  
  // 1. 总分
  // SCL-90 各题选项为 1, 2, 3, 4, 5，所以总分为所有回答的分数累加（1-5分）
  let totalScore = 0
  let positiveCount = 0
  
  ;(result.value.answers || []).forEach((ans: any) => {
    totalScore += (ans.score || 0)
    if ((ans.score || 0) >= 2) {
      positiveCount++ // 阳性项目数：单项得分 >= 2 的项目数
    }
  })
  
  // 2. 总均分 = 总分 / 90
  const meanScore = totalScore / 90

  return {
    totalScore,
    meanScore: Number(meanScore.toFixed(2)),
    positiveCount
  }
})

// ASRS-18 ADHD 前 6 题筛查逻辑计算
const asrsPartAScore = computed(() => {
  if (!result.value || scale.value?.id.toUpperCase() !== 'ASRS-18') return 0
  // 前 6 题的 ID 分别为 1, 2, 3, 4, 5, 6
  let meetCount = 0
  for (let i = 1; i <= 6; i++) {
    const ans = (result.value.answers || []).find((a: any) => String(a.questionId) === String(i))
    if (ans && (ans.score || 0) >= 2) {
      meetCount++
    }
  }
  return meetCount
})

const asrsAdhdScreening = computed(() => {
  return asrsPartAScore.value >= 4
})

// 医生意见输入绑定
const doctorNoteInput = ref('')
const reportDoctorInput = ref('')

// 监听结果加载并更新医生诊断输入域
watch(
  () => result.value,
  (newRes: any) => {
    if (newRes) {
      doctorNoteInput.value = newRes.doctorNote || ''
      reportDoctorInput.value = newRes.reportDoctor || ''
    } else {
      doctorNoteInput.value = ''
      reportDoctorInput.value = ''
    }
  },
  { immediate: true }
)

// 维度评分细则数据源
const dimensionDetailsList = computed(() => {
  if (!result.value || !scale.value) return []
  const list: any[] = []
  const rawDimensions = result.value.dimensionScores || {}
  
  if (scale.value.scoring?.dimensions) {
    for (const dimDef of scale.value.scoring.dimensions) {
      const name = dimDef.name
      const score = rawDimensions[name] !== undefined ? rawDimensions[name] : 0
      
      let conclusion = '正常'
      let description = '分数处于正常范围'
      
      if (scale.value.id.toUpperCase() === 'MMPI' && mmpiTValues.value) {
        const tScore = mmpiTValues.value[name] || 50
        conclusion = tScore >= 70 ? '显著升高' : tScore >= 60 ? '轻度升高' : '正常'
        description = `T分数: ${tScore} T. ${conclusion === '显著升高' ? '达到临床显著偏离水平，建议开展临床干预。' : conclusion === '轻度升高' ? '呈轻度升高，建议密切关注。' : '状态良好。'}`
      } else if ((dimDef as any).cutoffs) {
        for (const cutoff of (dimDef as any).cutoffs) {
          const min = cutoff.min ?? -Infinity
          const max = cutoff.max ?? Infinity
          if (score >= min && score <= max) {
            conclusion = cutoff.label || conclusion
            description = cutoff.description || description
            break
          }
        }
      } else {
        if (scale.value.id.toUpperCase() === 'SCL-90') {
          conclusion = score >= 2 ? '阳性偏高' : '正常'
          description = score >= 2 ? '因子分均值超过心理健康筛查临界值，提示该因子存在一定症状反应。' : '因子均分在健康常模常态范围。'
        }
      }
      
      list.push({
        name,
        score: typeof score === 'number' ? score : 0,
        conclusion,
        description: (dimDef as any).description || description
      })
    }
  } else {
    for (const [name, score] of Object.entries(rawDimensions) as [string, any][]) {
      list.push({
        name,
        score: typeof score === 'number' ? score : 0,
        conclusion: '正常',
        description: '分数在正常常模范围'
      })
    }
  }
  
  return list
})

// 保存医生意见与诊断
async function saveDoctorNote() {
  if (!result.value) return
  if (!result.value.id) {
    // 自动先保存测评结果
    await saveResult()
    if (!result.value.id) return
  }
  
  const testId = result.value.id
  try {
    const success = await testStore.updateDoctorNote(testId, doctorNoteInput.value, reportDoctorInput.value)
    if (success) {
      ElMessage.success('医生诊断意见与备注保存成功！')
      if (result.value) {
        result.value.doctorNote = doctorNoteInput.value
        result.value.reportDoctor = reportDoctorInput.value
      }
    } else {
      ElMessage.error('保存医生诊断意见失败')
    }
  } catch (err: any) {
    ElMessage.error('保存失败: ' + err.message)
  }
}

const dimensionChartOption = computed<any>(() => {
  if (!result.value?.dimensionScores || Object.keys(result.value.dimensionScores).length === 0) {
    return undefined
  }

  const idUpper = scale.value?.id.toUpperCase()
  const isMMPI = idUpper === 'MMPI'
  const isSCL90 = idUpper === 'SCL-90'
  
  let chartData: { name: string; value: number }[] = []

  if (isMMPI && mmpiTValues.value) {
    const order = ['L', 'F', 'K', 'Hs', 'D', 'Hy', 'Pd', 'Mf', 'Pa', 'Pt', 'Sc', 'Ma', 'Si']
    for (const dim of order) {
      if (mmpiTValues.value[dim] !== undefined) {
        chartData.push({ name: dim, value: Number(mmpiTValues.value[dim]) })
      }
    }
    for (const [k, v] of Object.entries(mmpiTValues.value)) {
      if (!order.includes(k)) {
        chartData.push({ name: k, value: Number(v) })
      }
    }
  } else {
    chartData = Object.entries(result.value.dimensionScores || {}).map(([k, v]) => ({ name: k, value: Number(v) }))
  }

  // 如果是 SCL-90，采用雷达图 (Radar Chart) 进行多维度可视化
  if (isSCL90) {
    const indicators = chartData.map(d => ({
      name: d.name,
      max: 5,
      min: 1
    }))
    
    return {
      title: { text: 'SCL-90 各维度因子均分', left: 'center', textStyle: { fontSize: 16 } },
      tooltip: { trigger: 'item' },
      radar: {
        indicator: indicators,
        radius: '65%',
        center: ['50%', '55%'],
        splitArea: {
          areaStyle: {
            color: ['#f8f9fa', '#e9ecef', '#dee2e6', '#ced4da'],
            shadowColor: 'rgba(0, 0, 0, 0.05)',
            shadowBlur: 10
          }
        },
        axisLine: {
          lineStyle: {
            color: '#adb5bd'
          }
        },
        splitLine: {
          lineStyle: {
            color: '#adb5bd'
          }
        }
      },
      series: [{
        name: '因子分',
        type: 'radar',
        data: [{
          value: chartData.map(d => Number(d.value.toFixed(2))),
          name: '因子均分',
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: {
            width: 2,
            color: '#409EFF'
          },
          areaStyle: {
            color: 'rgba(64, 158, 255, 0.3)'
          },
          itemStyle: {
            color: '#409EFF'
          }
        }]
      }]
    }
  }

  // 默认柱状图
  return {
    title: { text: isMMPI ? 'MMPI 剖面图 (T分数)' : '维度得分', left: 'center', textStyle: { fontSize: 16 } },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: chartData.map(d => d.name),
      axisLabel: { rotate: chartData.length > 4 ? 30 : 0 }
    },
    yAxis: isMMPI ? {
      type: 'value',
      min: 0,
      max: 100,
      interval: 10
    } : {
      type: 'value',
      min: 0
    },
    series: [{
      type: 'bar',
      data: chartData.map(d => d.value),
      itemStyle: {
        color: (params: any) => {
          const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272']
          return colors[params.dataIndex % colors.length]
        }
      },
      markLine: isMMPI ? {
        silent: true,
        lineStyle: {
          type: 'dashed'
        },
        data: [
          { yAxis: 50, name: '均值(50)', lineStyle: { color: '#909399' } },
          { yAxis: 60, name: '轻度偏离(60)', lineStyle: { color: '#E6A23C' } },
          { yAxis: 70, name: '临床显著(70)', lineStyle: { color: '#F56C6C', width: 1.5 } }
        ]
      } : undefined
    }]
  }
})

async function saveResult() {
  if (!result.value) return
  if (!userStore.currentUser) {
    ElMessage.warning('没有选中当前用户，无法保存结果。请先返回首页选择/创建用户。')
    return
  }

  saving.value = true
  try {
    const userId = userStore.currentUser.id
    // 同步将当前医生意见与签名也存入结果
    result.value.doctorNote = doctorNoteInput.value
    result.value.reportDoctor = reportDoctorInput.value

    const testId = await testStore.saveTestResult(userId, result.value)
    if (result.value) {
      result.value.id = testId
    }
    
    // 同步更新数据库 tests 表中的独立字段 doctorNote 和 reportDoctor
    await testStore.updateDoctorNote(testId, doctorNoteInput.value, reportDoctorInput.value)

    ElMessage.success('保存成功')
    isSaved.value = true
  } catch (e: any) {
    ElMessage.error('保存失败: ' + e.message)
  } finally {
    saving.value = false
  }
}

function goHome() {
  testStore.clearTest()
  router.push('/')
}

function newTest() {
  testStore.clearTest()
  router.push('/scales')
}

import * as XLSX from 'xlsx'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

async function exportPDF() {
  if (!result.value || !scale.value) {
    ElMessage.warning('没有可导出的测试数据')
    return
  }

  const printArea = document.querySelector('.medical-report-print') as HTMLElement
  if (!printArea) {
    ElMessage.error('未找到报告内容区域')
    return
  }

  // 临时显示用于生成的打印区域
  const originalDisplay = printArea.style.display
  printArea.style.display = 'block'
  printArea.style.position = 'absolute'
  printArea.style.left = '-9999px'
  printArea.style.top = '0'
  printArea.style.width = '794px' // A4 width at 96 DPI roughly

  try {
    const canvas = await html2canvas(printArea, {
      scale: 2, // 提高清晰度
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff'
    })

    // 恢复打印区域的原本显示样式
    printArea.style.display = originalDisplay
    printArea.style.position = ''
    printArea.style.left = ''
    printArea.style.top = ''
    printArea.style.width = ''

    const imgData = canvas.toDataURL('image/jpeg', 0.95)

    // 创建纵向 A4 尺寸的 PDF，单位是 mm，A4 为 210 x 297
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = pdf.internal.pageSize.getHeight()

    // 保持比例计算图片尺寸
    const imgWidth = pdfWidth
    const imgHeight = (canvas.height * pdfWidth) / canvas.width

    let heightLeft = imgHeight
    let position = 0

    // 将图片分页写入 PDF
    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
    heightLeft -= pdfHeight

    while (heightLeft >= 0) {
      position = heightLeft - imgHeight
      pdf.addPage()
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
      heightLeft -= pdfHeight
    }

    const defaultName = `${userStore.currentUser?.name || '用户'}_${scale.value.name}_测评报告_${new Date().toISOString().slice(0, 10)}.pdf`
    
    // 调用 electronAPI 调起保存对话框，让用户选择保存路径
    const { canceled, filePath } = await window.electronAPI.showSaveDialog({
      title: '选择报告保存位置',
      defaultPath: defaultName,
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
    })

    if (canceled || !filePath) {
      ElMessage.info('导出被取消')
      return
    }

    // 获取 PDF ArrayBuffer 并在主进程中静默写入文件
    const pdfArrayBuffer = pdf.output('arraybuffer')
    
    // 渲染进程中不使用 Node.js 的 Buffer，改用 Uint8Array 与 window.btoa 进行纯前端 Base64 转换
    const bytes = new Uint8Array(pdfArrayBuffer)
    let binary = ''
    const len = bytes.byteLength
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    const base64Data = window.btoa(binary)
    
    const saveRes = await window.electronAPI.saveBufferFile(filePath, base64Data)
    if (saveRes.success) {
      ElMessage.success('PDF 报告导出并保存成功！')
    } else {
      ElMessage.error('保存 PDF 失败: ' + saveRes.error)
    }
  } catch (err: any) {
    // 出错时恢复样式
    printArea.style.display = originalDisplay
    printArea.style.position = ''
    printArea.style.left = ''
    printArea.style.top = ''
    printArea.style.width = ''
    ElMessage.error('生成 PDF 失败: ' + err.message)
  }
}

async function exportPNG() {
  if (!result.value || !scale.value) {
    ElMessage.warning('没有可导出的测试数据')
    return
  }

  const printArea = document.querySelector('.medical-report-print') as HTMLElement
  if (!printArea) {
    ElMessage.error('未找到报告单打印区域')
    return
  }

  // 临时显示用于生成的打印区域
  const originalDisplay = printArea.style.display
  printArea.style.display = 'block'
  printArea.style.position = 'absolute'
  printArea.style.left = '-9999px'
  printArea.style.top = '0'
  printArea.style.width = '794px' // A4 width at 96 DPI roughly

  try {
    const canvas = await html2canvas(printArea, {
      scale: 2, // 提高清晰度
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff'
    })

    // 恢复打印区域的原本显示样式
    printArea.style.display = originalDisplay
    printArea.style.position = ''
    printArea.style.left = ''
    printArea.style.top = ''
    printArea.style.width = ''

    const imgData = canvas.toDataURL('image/png', 0.95)
    const base64Data = imgData.split(',')[1]

    const defaultName = `${userStore.currentUser?.name || '用户'}_${scale.value.name}_测评报告_${new Date().toISOString().slice(0, 10)}.png`
    
    // 调用 electronAPI 调起保存对话框，让用户选择保存路径
    const { canceled, filePath } = await window.electronAPI.showSaveDialog({
      title: '选择报告图片保存位置',
      defaultPath: defaultName,
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    })

    if (canceled || !filePath) {
      ElMessage.info('导出被取消')
      return
    }

    const saveRes = await window.electronAPI.savePngFile(base64Data, filePath)
    if (saveRes.success) {
      ElMessage.success('PNG 报告图片导出并保存成功！')
    } else {
      ElMessage.error('保存 PNG 失败: ' + saveRes.error)
    }
  } catch (err: any) {
    // 出错时恢复样式
    printArea.style.display = originalDisplay
    printArea.style.position = ''
    printArea.style.left = ''
    printArea.style.top = ''
    printArea.style.width = ''
    ElMessage.error('生成 PNG 失败: ' + err.message)
  }
}

async function exportExcel() {
  if (!result.value || !scale.value) {
    ElMessage.warning('没有可导出的测试数据')
    return
  }

  try {
    // 准备基本信息
    const baseInfo = [
      ['心理测评报告导出'],
      [],
      ['姓名', userStore.currentUser?.name || '未知'],
      ['性别', userStore.currentUser?.gender === 'male' ? '男' : userStore.currentUser?.gender === 'female' ? '女' : '未知'],
      ['出生日期', userStore.currentUser?.birthdate || '未知'],
      [],
      ['量表名称', scale.value.name],
      ['测评日期', new Date().toLocaleString()],
      ['答题用时', `${Math.floor(result.value.duration / 60)}分${result.value.duration % 60}秒`],
      ['原始总分', result.value.rawScore.toFixed(1)],
      ['标准总分', result.value.stdScore.toFixed(1)],
      ['测评结论', result.value.interpretation?.label || '无'],
      ['结果解释', result.value.interpretation?.description || '无'],
      ['专家建议', result.value.interpretation?.suggestion || '无'],
      []
    ]

    // 准备维度得分
    const dimensionHeaders = ['维度名称', '得分']
    const dimensionRows = result.value.dimensionScores 
      ? (Object.entries(result.value.dimensionScores) as [string, any][]).map(([name, score]) => [name, score.toFixed(1)])
      : []

    // 准备答题明细
    const detailHeaders = ['题号', '题目内容', '选择选项', '选项得分']
    const detailRows = (result.value.answers || []).map((ans: any) => {
      const q = scale.value?.questions.find(item => String(item.id) === String(ans.questionId))
      const opt = q?.options.find(o => String(o.value) === String(ans.value))
      return [
        ans.questionId,
        q?.text || '',
        opt?.label || ans.value,
        Number(ans.score || 0)
      ]
    })

    // 创建 worksheet
    const wsData = [
      ...baseInfo,
      ['维度得分情况'],
      dimensionHeaders,
      ...dimensionRows,
      [],
      ['答题明细'],
      detailHeaders,
      ...detailRows
    ]

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(wsData)

    // 设置列宽
    ws['!cols'] = [
      { wch: 15 },
      { wch: 45 },
      { wch: 15 },
      { wch: 15 }
    ]

    XLSX.utils.book_append_sheet(wb, ws, '测评结果')

    // 写入并保存文件
    const fileName = `${userStore.currentUser?.name || '用户'}_${scale.value.name}_测评结果_${new Date().toISOString().slice(0, 10)}.xlsx`
    XLSX.writeFile(wb, fileName)
    ElMessage.success('Excel 导出成功！')
  } catch (e: any) {
    ElMessage.error('导出失败: ' + e.message)
  }
}

onMounted(async () => {
  const batchIdsStr = route.query.batchIds as string
  if (batchIdsStr) {
    const ids = batchIdsStr.split(',')
    const resultsTemp = []
    for (const id of ids) {
      try {
        const rows = await window.electronAPI.dbQuery(
          'SELECT result_json, scale_id, scale_name FROM tests WHERE id = ?',
          [parseInt(id)]
        )
        if (rows && rows.length > 0) {
          const resObj = JSON.parse(rows[0].result_json)
          resultsTemp.push({
            testId: parseInt(id),
            scaleId: rows[0].scale_id,
            scaleName: rows[0].scale_name,
            result: resObj
          })
        }
      } catch (err) {
        console.error('加载批量测评数据失败:', err)
      }
    }
    batchResults.value = resultsTemp
    if (resultsTemp.length > 0) {
      selectedBatchIndex.value = 0
    }
  }
})

// =========================================================================
// 模块一：危机预警拦截相关状态与逻辑
// =========================================================================
import { useAuthStore } from '../stores/authStore'
const authStore = useAuthStore()
const crisisDialogVisible = ref(false)
const crisisInterventionNote = ref('')
const crisisSubmitting = ref(false)

const isCrisisAlert = computed(() => {
  if (!result.value || !scale.value) return false
  const scaleId = scale.value.id ? scale.value.id.toUpperCase() : ''
  const score = result.value.score !== undefined ? result.value.score : 0
  const severity = result.value.severity || ''
  
  if (scaleId === 'BSS' && score > 0) return true
  
  if (scaleId === 'C-SSRS') {
    const conclusion = result.value.conclusion || ''
    const severityStr = String(severity || '')
    if (conclusion.includes('高风险') || conclusion.includes('自杀') || severityStr.includes('高风险') || severityStr.includes('自杀')) {
      return true
    }
  }
  
  if (scaleId === 'PHQ-9' && score >= 20) return true
  
  const sevLower = String(severity || '').toLowerCase()
  if (sevLower === 'critical' || sevLower === 'severe' || sevLower.includes('极重度') || sevLower.includes('重度') || sevLower.includes('极高') || sevLower.includes('高危')) {
    return true
  }
  
  return false
})

async function checkAndHandleCrisisAlert() {
  if (!result.value || !isCrisisAlert.value) return
  
  const testId = result.value.id
  if (!testId) return
  
  try {
    const alerts = await window.electronAPI.dbQuery('SELECT * FROM crisis_alerts WHERE test_record_id = ?', [testId])
    if (alerts && alerts.length > 0) {
      const alert = alerts[0]
      if (alert.status === 'acknowledged' || alert.status === 'resolved') {
        crisisDialogVisible.value = false
        return
      }
      crisisDialogVisible.value = true
    } else {
      const alertLevel = (scale.value.id.toUpperCase() === 'BSS' || scale.value.id.toUpperCase() === 'C-SSRS') ? 'critical' : 'high'
      const alertReason = `量表: ${scale.value.name || ''}, 得分: ${result.value.score || 0}, 风险等级: ${result.value.severity || ''}`
      const subjectId = result.value.userId || result.value.user_id || 0
      
      await window.electronAPI.dbRun(
        `INSERT INTO crisis_alerts (test_record_id, scale_id, subject_id, alert_level, alert_reason, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', datetime('now', 'localtime'))`,
         [testId, scale.value.id, subjectId, alertLevel, alertReason]
      )
      crisisDialogVisible.value = true
    }
  } catch (err) {
    console.error('Check crisis alert error:', err)
  }
}

async function submitCrisisIntervention() {
  if (crisisInterventionNote.value.trim().length < 5) return
  if (!result.value) return
  
  crisisSubmitting.value = true
  try {
    const operatorName = authStore.user?.name || authStore.user?.username || '系统管理员'
    const testId = result.value.id
    
    await window.electronAPI.dbRun(
      `UPDATE crisis_alerts 
       SET status = 'acknowledged', acknowledged_note = ?, resolved_at = datetime('now', 'localtime')
       WHERE test_record_id = ?`,
      [crisisInterventionNote.value.trim(), testId]
    )
    
    const alertReason = `被试: ${result.value.userName || result.value.user_id || ''}, 量表: ${scale.value.name || ''}, 已由操作员 ${operatorName} 介入处理。`
    await window.electronAPI.dbRun(
      `INSERT INTO notifications (type, title, content, related_id, is_read, created_at)
       VALUES ('crisis', '高危结果预警介入', ?, ?, 0, datetime('now', 'localtime'))`,
      [alertReason, testId]
    )
    
    crisisDialogVisible.value = false
    ElMessage.success('干预记录已保存，预警已解除锁定。')
  } catch (err) {
    ElMessage.error('提交失败: ' + err.message)
  } finally {
    crisisSubmitting.value = false
  }
}

watch(() => result.value, (newVal) => {
  if (newVal && newVal.id) {
    checkAndHandleCrisisAlert()
  }
}, { immediate: true })

watch(crisisDialogVisible, (val) => {
  const container = document.querySelector('.result-container') || document.querySelector('.result-view') || document.querySelector('.app-container')
  if (container) {
    if (val) {
      container.classList.add('crisis-locked-blur')
    } else {
      container.classList.remove('crisis-locked-blur')
    }
  }
})
</script>

<template>
  <div class="result-view">
  <!-- 检查报告单风格容器（仅在打印时，或通过 print 样式强行接管时呈现） -->
  <div class="medical-report-print" v-if="result && scale" style="position: relative;">
    <!-- 水印遮罩 (打印版) -->
    <div v-if="settingsStore.watermarkText" :style="watermarkBgStyle"></div>
    <!-- 报告单位头部 -->
    <div class="report-unit-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; border-bottom: 1px dashed #cccccc; padding-bottom: 8px;" v-if="settingsStore.unitLogo || settingsStore.unitName">
      <div style="display: flex; align-items: center; gap: 12px;">
        <img v-if="settingsStore.unitLogo" :src="settingsStore.unitLogo" alt="Unit Logo" style="height: 30px; width: auto; object-fit: contain;" />
        <div style="text-align: left;">
          <div style="font-size: 18px; font-weight: bold; letter-spacing: 1px; color: #000000; line-height: 1.2;">
            {{ settingsStore.unitName || 'OpenMind 心理测评' }}
          </div>
          <div style="font-size: 10px; color: #666666; margin-top: 2px;" v-if="settingsStore.unitDesc">
            {{ settingsStore.unitDesc }}
          </div>
        </div>
      </div>
      <div style="font-size: 11px; color: #909399; font-style: italic;">
        OpenMind 心理测评系统
      </div>
    </div>
    
    <div class="report-title">{{ scale.id }} {{ scale.name }} 结果分析报告</div>
    
    <div class="report-meta-row" style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 8px; border-bottom: 2.5px solid #000000; padding-bottom: 4px;">
      <span style="font-weight: 500;">测评机构: {{ settingsStore.unitName || '自主测评' }}</span>
      <span>测评时间: {{ new Date().toLocaleString() }}</span>
    </div>
    
    <table class="patient-info-table">
      <tbody>
        <tr>
          <td class="label">姓&nbsp;&nbsp;&nbsp;&nbsp;名:</td>
          <td class="value">{{ userStore.currentUser?.name || '/' }}</td>
          <td class="label">性&nbsp;&nbsp;&nbsp;&nbsp;别:</td>
          <td class="value">{{ userStore.currentUser?.gender === 'male' ? '男' : userStore.currentUser?.gender === 'female' ? '女' : '未知' }}</td>
          <td class="label">年&nbsp;&nbsp;&nbsp;&nbsp;龄:</td>
          <td class="value">{{ userAge || '/' }}</td>
        </tr>
        <tr>
          <td class="label">联系方式:</td>
          <td class="value">{{ userStore.currentUser?.contact || '/' }}</td>
          <td class="label">出生日期:</td>
          <td class="value">{{ userStore.currentUser?.birthdate || '/' }}</td>
          <td class="label">备&nbsp;&nbsp;&nbsp;&nbsp;注:</td>
          <td class="value">{{ userStore.currentUser?.notes || '/' }}</td>
        </tr>
      </tbody>
    </table>

    <!-- ------------------------------------------------------------- -->
    <!-- 模板 B: MMPI 专用打印模板 -->
    <!-- ------------------------------------------------------------- -->
    <template v-if="scale.id.toUpperCase() === 'MMPI'">
      <!-- 1. 效度量表卡片 -->
      <div class="report-section-card" style="margin-top: 12px; border: 1px solid #ddd; padding: 10px; border-radius: 4px;">
        <div style="font-weight: bold; font-size: 14px; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-bottom: 8px;">
          效度量表分析 (Validity Scales)
        </div>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
          <div v-for="scaleItem in result.interpretation?.mmpiValidityCheck?.details || []" :key="scaleItem.name" style="padding: 6px; background-color: #f9f9f9; border-radius: 4px;">
            <div style="font-weight: bold; font-size: 12px; color: #333;">{{ scaleItem.name }} ({{ scaleItem.label || '效度' }})</div>
            <div style="margin-top: 4px; font-size: 13px;">
              T分: <span style="font-weight: bold;">{{ scaleItem.tScore }}</span>
              <span :style="{ color: scaleItem.invalid ? '#F56C6C' : scaleItem.warning ? '#E6A23C' : '#67C23A', marginLeft: '6px', fontWeight: 'bold' }">
                {{ scaleItem.invalid ? '无效' : scaleItem.warning ? '可疑' : '正常' }}
              </span>
            </div>
          </div>
        </div>
        <!-- 效度可疑总警告 -->
        <div v-if="result.warnings && result.warnings.length > 0" style="margin-top: 8px; color: #F56C6C; font-size: 12px; font-weight: bold; display: flex; align-items: center; gap: 4px;">
          ⚠️ 警告: 该结果效度可疑，建议结合临床评估或重新测试。
        </div>
      </div>

      <!-- 4. 高点编码分析 -->
      <div class="diagnosis-section" style="margin-top: 12px;">
        <div class="section-title" style="font-weight: bold; font-size: 14px;">高点编码临床分析 (High-Point Coding):</div>
        <div style="font-size: 12px; line-height: 1.6; margin-top: 8px; border: 1px dashed #ddd; padding: 10px; border-radius: 4px; background-color: #fffaf0;">
          <div style="margin-bottom: 6px;">
            分析编码：<span style="font-weight: bold; color: #f56c6c; font-size: 14px;">{{ mmpiHighPoints?.codeType || '/' }}</span>
            <span style="margin-left: 10px; color: #666;">({{ mmpiHighPoints?.elevatedCount || 0 }} 个量表 T ≥ 60)</span>
          </div>
          <div v-for="(item, idx) in mmpiHighPoints?.topScales || []" :key="idx" style="margin-top: 6px;">
            <div style="font-weight: bold;">{{ idx + 1 }}. {{ item.label }} (T: {{ item.t }}):</div>
            <div style="color: #555; text-indent: 12px;">{{ item.desc }}</div>
          </div>
        </div>
      </div>
    </template>

    <!-- ------------------------------------------------------------- -->
    <!-- 模板 C: 他评量表专用打印模板 (HRSD / HAMA 等) -->
    <!-- ------------------------------------------------------------- -->
    <template v-else-if="scale.category === 'psychiatric' || (scale.tags && scale.tags.includes('他评'))">
      <!-- 评分医生签名栏 -->
      <div class="report-section-card" style="margin-top: 12px; border: 1.5px solid #409EFF; padding: 10px; border-radius: 4px; background-color: #ecf5ff;">
        <div style="font-weight: bold; font-size: 14px; display: flex; justify-content: space-between;">
          <span style="color: #409EFF;">👨‍⚕️ 他评量表评定状态</span>
          <span style="color: #606266; font-size: 12px;">评定医生签名：____________________  日期：____________________</span>
        </div>
      </div>

      <!-- 总分与严重度色块 -->
      <div style="margin-top: 12px; display: flex; gap: 16px;">
        <div style="flex: 1; border: 1px solid #ddd; padding: 10px; border-radius: 4px; text-align: center;">
          <div style="font-size: 12px; color: #666;">评定总粗分 (Total score)</div>
          <div style="font-size: 28px; font-weight: bold; color: #409eff; margin-top: 4px;">{{ result.stdScore.toFixed(0) }} 分</div>
        </div>
        <div style="flex: 1; border: 1px solid #ddd; padding: 10px; border-radius: 4px; text-align: center;" :style="{ borderColor: result.interpretation?.color || '#ddd' }">
          <div style="font-size: 12px; color: #666;">评定严重程度</div>
          <div style="font-size: 20px; font-weight: bold; margin-top: 8px;" :style="{ color: result.interpretation?.color || '#333' }">
            {{ result.interpretation?.label || '正常' }}
          </div>
        </div>
      </div>

      <!-- 各题得分明细表 (他评量表通常需要逐题展示医生评分) -->
      <div class="report-section-card" style="margin-top: 12px; border: 1px solid #ddd; padding: 10px; border-radius: 4px;">
        <div style="font-weight: bold; font-size: 14px; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-bottom: 8px;">
          他评量表逐题评定明细 (Physician Rating Sheet)
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;">
          <thead>
            <tr style="background-color: #f5f7fa; border-bottom: 1.5px solid #aaa;">
              <th style="padding: 4px 8px; border: 1px solid #ddd; width: 60px; text-align: center;">题号</th>
              <th style="padding: 4px 8px; border: 1px solid #ddd;">评定题目</th>
              <th style="padding: 4px 8px; border: 1px solid #ddd; width: 120px; text-align: center;">被试反应</th>
              <th style="padding: 4px 8px; border: 1px solid #ddd; width: 60px; text-align: center;">医生评分</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="answer in result.answers" :key="answer.questionId" style="border-bottom: 1px solid #eee;">
              <td style="padding: 4px 8px; border: 1px solid #ddd; text-align: center; font-weight: bold;">{{ answer.questionId }}</td>
              <td style="padding: 4px 8px; border: 1px solid #ddd;">
                {{ scale.questions.find(q => String(q.id) === String(answer.questionId))?.text || '-' }}
              </td>
              <td style="padding: 4px 8px; border: 1px solid #ddd; text-align: center; color: #666;">
                {{ scale.questions.find(q => String(q.id) === String(answer.questionId))?.options.find(o => String(o.score) === String(answer.score))?.label || '/' }}
              </td>
              <td style="padding: 4px 8px; border: 1px solid #ddd; text-align: center; font-weight: bold; color: #409eff;">{{ answer.score }} 分</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 结果解释与分析说明 -->
      <div class="diagnosis-section" style="margin-top: 12px;">
        <div class="section-title" style="font-weight: bold; font-size: 14px;">临床评定解释:</div>
        <div class="diagnosis-content" style="margin-top: 8px; font-size: 12px; line-height: 1.6; border: 1px solid #ddd; padding: 10px; border-radius: 4px; background-color: #fafafa;">
          {{ result.interpretation?.description || '暂无详细解释说明' }}
        </div>
      </div>
    </template>

    <!-- ------------------------------------------------------------- -->
    <!-- 模板 A: 标准自评量表 (PHQ-9 / SDS 等) -->
    <!-- ------------------------------------------------------------- -->
    <template v-else>
      <!-- 总粗分标准分卡片 -->
      <table class="report-data-table" style="margin-top: 12px;">
        <thead>
          <tr>
            <th style="width: 40%">测评指标</th>
            <th style="width: 30%">分值</th>
            <th style="width: 30%">参考值</th>
          </tr>
        </thead>
        <tbody>
          <!-- SAS 和 SDS 展示总粗分与标准分 -->
          <template v-if="scale.id.toUpperCase() === 'SAS' || scale.id.toUpperCase() === 'SDS'">
            <tr>
              <td>总粗分</td>
              <td>{{ result.rawScore.toFixed(0) }}</td>
              <td>{{ scale.id.toUpperCase() === 'SAS' ? '40' : '41' }}</td>
            </tr>
            <tr>
              <td>标准分</td>
              <td>{{ result.stdScore.toFixed(0) }}</td>
              <td>{{ scale.id.toUpperCase() === 'SAS' ? '50' : '53' }}</td>
            </tr>
          </template>
          <!-- 其它量表如 PHQ-9 仅展示总分 -->
          <template v-else>
            <tr>
              <td>总分</td>
              <td>{{ result.stdScore.toFixed(0) }}</td>
              <td>{{ referenceRange }}</td>
            </tr>
          </template>
        </tbody>
      </table>

      <!-- 严重等级与解释卡片 -->
      <div class="diagnosis-section" style="margin-top: 12px;">
        <div class="section-title">测评结论:</div>
        <div class="diagnosis-content" style="margin-top: 8px; border: 1px solid #ddd; padding: 10px; border-radius: 4px; background-color: #fafafa;" :style="{ borderLeft: `5px solid ${result.interpretation?.color || '#409EFF'}` }">
          <div style="font-weight: bold; margin-bottom: 6px; font-size: 13px;" :style="{ color: result.interpretation?.color || '#333' }">
            当前结果：{{ result.interpretation?.label || '正常' }} ({{ result.stdScore.toFixed(0) }}分)
          </div>
          <div style="font-size: 12px; line-height: 1.6; color: #555;">
            {{ result.interpretation?.description || '无详细解释说明' }}
          </div>
        </div>
      </div>

      <!-- 维度得分表 (如果量表有分维度计分) -->
      <div v-if="result.interpretation?.dimensions && result.interpretation.dimensions.length > 0" class="report-section-card" style="margin-top: 12px; border: 1px solid #ddd; padding: 10px; border-radius: 4px;">
        <div style="font-weight: bold; font-size: 14px; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-bottom: 8px;">
          各维度得分明细 (Dimension Breakdown)
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: center;">
          <thead>
            <tr style="background-color: #f5f7fa; border-bottom: 1.5px solid #aaa;">
              <th style="padding: 4px; border: 1px solid #ddd;">维度名称</th>
              <th style="padding: 4px; border: 1px solid #ddd;">维度得分</th>
              <th style="padding: 4px; border: 1px solid #ddd;">涉及题数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="dim in result.interpretation.dimensions" :key="dim.name" style="border-bottom: 1px solid #eee;">
              <td style="padding: 4px; border: 1px solid #ddd; font-weight: bold;">{{ dim.name }}</td>
              <td style="padding: 4px; border: 1px solid #ddd; color: #409eff; font-weight: bold;">{{ dim.score.toFixed(1) }} 分</td>
              <td style="padding: 4px; border: 1px solid #ddd; color: #666;">{{ dim.questionIds ? dim.questionIds.length : '/' }} 题</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 原始答案折叠表格 -->
      <div class="report-section-card" style="margin-top: 12px; border: 1px solid #ddd; padding: 10px; border-radius: 4px;">
        <div style="font-weight: bold; font-size: 14px; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-bottom: 8px;">
          答题明细清单 (Response Details)
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 10px; text-align: left;">
          <thead>
            <tr style="background-color: #f5f7fa; border-bottom: 1.5px solid #aaa;">
              <th style="padding: 4px; border: 1px solid #ddd; width: 40px; text-align: center;">题号</th>
              <th style="padding: 4px; border: 1px solid #ddd;">题目</th>
              <th style="padding: 4px; border: 1px solid #ddd; width: 80px; text-align: center;">答案</th>
              <th style="padding: 4px; border: 1px solid #ddd; width: 40px; text-align: center;">得分</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="answer in result.answers" :key="answer.questionId" style="border-bottom: 1px solid #eee;">
              <td style="padding: 4px; border: 1px solid #ddd; text-align: center;">{{ answer.questionId }}</td>
              <td style="padding: 4px; border: 1px solid #ddd;">
                {{ scale.questions.find(q => String(q.id) === String(answer.questionId))?.text || '-' }}
              </td>
              <td style="padding: 4px; border: 1px solid #ddd; text-align: center; color: #666;">
                {{ scale.questions.find(q => String(q.id) === String(answer.questionId))?.options.find(o => String(o.score) === String(answer.score))?.label || '/' }}
              </td>
              <td style="padding: 4px; border: 1px solid #ddd; text-align: center; font-weight: bold;">{{ answer.score }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- 维度评分细则表格 (打印版) -->
    <div v-if="dimensionDetailsList && dimensionDetailsList.length > 0" class="report-section-card" style="margin-top: 12px; border: 1px solid #ddd; padding: 10px; border-radius: 4px; page-break-inside: avoid;">
      <div style="font-weight: bold; font-size: 14px; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-bottom: 8px;">
        维度评分细则 (Dimension Scoring Details)
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: center;">
        <thead>
          <tr style="background-color: #f5f7fa; border-bottom: 1.5px solid #aaa;">
            <th style="padding: 4px; border: 1px solid #ddd; text-align: left;">维度名称</th>
            <th style="padding: 4px; border: 1px solid #ddd; width: 80px;">得分</th>
            <th style="padding: 4px; border: 1px solid #ddd; width: 100px;">临床结论</th>
            <th style="padding: 4px; border: 1px solid #ddd; text-align: left;">结论说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="dim in dimensionDetailsList" :key="dim.name" style="border-bottom: 1px solid #eee;">
            <td style="padding: 4px; border: 1px solid #ddd; text-align: left; font-weight: bold;">{{ dim.name }}</td>
            <td style="padding: 4px; border: 1px solid #ddd; font-weight: bold; color: #409eff;">{{ dim.score.toFixed(1) }} 分</td>
            <td style="padding: 4px; border: 1px solid #ddd;">
              <span :style="{ color: dim.conclusion.includes('升高') || dim.conclusion.includes('偏高') ? '#F56C6C' : '#67C23A', fontWeight: 'bold' }">
                {{ dim.conclusion }}
              </span>
            </td>
            <td style="padding: 4px; border: 1px solid #ddd; text-align: left; color: #555;">{{ dim.description }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 医生临床诊断意见与备注 (打印版) -->
    <div class="report-section-card" style="margin-top: 12px; border: 1.5px solid #000; padding: 10px; border-radius: 4px; background-color: #fcfcfc; page-break-inside: avoid;" v-if="doctorNoteInput">
      <div style="font-weight: bold; font-size: 14px; border-bottom: 1px solid #000; padding-bottom: 6px; margin-bottom: 8px;">
        👨‍⚕️ 医生临床诊断意见与备注
      </div>
      <div style="font-size: 12px; line-height: 1.6; white-space: pre-wrap; color: #000; min-height: 50px;">
        {{ doctorNoteInput }}
      </div>
      <div style="margin-top: 10px; display: flex; justify-content: space-between; font-size: 12px; font-weight: bold;">
        <span>报告/诊断医生：<span style="text-decoration: underline; padding: 0 8px;">{{ reportDoctorInput || '____________' }}</span></span>
        <span>签字盖章：____________________</span>
      </div>
    </div>

    <!-- 免责声明 -->
    <div style="margin-top: 16px; font-size: 10px; color: #7f8c8d; border-top: 1px solid #eee; padding-top: 8px; text-align: center; line-height: 1.4;">
      免责声明：本测试结果仅供参考，不能替代专业医疗诊断。如有心理困扰，请寻求专业心理咨询师或精神科医生的帮助。
    </div>

    <div class="report-bottom-signature" style="margin-top: 40px; display: flex; justify-content: right; font-size: 12px; border-top: 1px solid #000; padding-top: 8px;">
      <span>报告时间：{{ new Date().toLocaleString() }}</span>
    </div>
  </div>

    <div class="result-container no-print" v-if="result && scale" style="position: relative;">
      <!-- 水印遮罩 (网页版) -->
      <div v-if="settingsStore.watermarkText" :style="watermarkBgStyle"></div>
      <!-- 批量连续测评切换选项卡 -->
      <div v-if="isBatch && batchResults.length > 1" style="margin-bottom: 20px;">
        <el-radio-group v-model="selectedBatchIndex" size="large">
          <el-radio-button 
            v-for="(r, idx) in batchResults" 
            :key="r.testId" 
            :value="idx"
          >
            {{ r.scaleName }}
          </el-radio-button>
        </el-radio-group>
      </div>

      <!-- 头部操作栏 -->
      <div class="result-header no-print">
      <div class="header-left">
          <el-button @click="goHome" circle>
            <el-icon><ArrowLeft /></el-icon>
          </el-button>
      <h2>测评结果</h2>
      <!-- 快捷跳转查看该用户历史 -->
      <el-button
        v-if="userStore.currentUser"
        type="success"
        size="small"
        plain
        style="margin-left: 12px;"
        @click="router.push(`/user/${userStore.currentUser.id}/history`)"
      >
        查看该用户历史
      </el-button>
      </div>
        <div class="header-actions">
          <el-button @click="exportExcel">
            <el-icon><Download /></el-icon>
            导出 Excel
          </el-button>
          <el-button @click="exportPNG">
            <el-icon><Picture /></el-icon>
            分享报告 (PNG)
          </el-button>
          <el-button @click="exportPDF">
            <el-icon><Document /></el-icon>
            打印报告单
          </el-button>
          <el-button type="primary" :loading="saving" :disabled="isSaved" @click="saveResult">
            <el-icon><Check /></el-icon>
            {{ isSaved ? '已保存' : '保存结果' }}
          </el-button>
        </div>
      </div>

      <!-- 警告信息 -->
      <el-alert
        v-for="(w, idx) in result.warnings"
        :key="idx"
        :title="w"
        type="warning"
        show-icon
        :closable="false"
        style="margin-bottom: 12px"
      />

      <!-- 结果总览 -->
      <div class="result-overview" :style="scale.id.toUpperCase() === 'MMPI' ? { gridTemplateColumns: '1fr' } : {}">
        <!-- SCL-90 自定义结果分数展示面板 -->
        <el-card class="score-card" v-if="scale.id.toUpperCase() === 'SCL-90'">
          <div style="display: flex; flex-direction: column; gap: 12px; align-items: center; justify-content: center; padding: 12px 0;">
            <div style="display: flex; gap: 40px; justify-content: center; width: 100%;">
              <div style="text-align: center;">
                <div style="font-size: 36px; font-weight: 800; color: #409EFF; line-height: 1.2;">
                  {{ scl90Metrics?.totalScore || 0 }}
                </div>
                <div style="font-size: 13px; color: var(--el-text-color-secondary); margin-top: 4px;">总分</div>
              </div>
              <div style="text-align: center; border-left: 1px solid var(--el-border-color-light); border-right: 1px solid var(--el-border-color-light); padding: 0 40px;">
                <div style="font-size: 36px; font-weight: 800; color: #67C23A; line-height: 1.2;">
                  {{ scl90Metrics?.meanScore.toFixed(2) || '0.00' }}
                </div>
                <div style="font-size: 13px; color: var(--el-text-color-secondary); margin-top: 4px;">总均分</div>
              </div>
              <div style="text-align: center;">
                <div style="font-size: 36px; font-weight: 800; color: #F56C6C; line-height: 1.2;">
                  {{ scl90Metrics?.positiveCount || 0 }}
                </div>
                <div style="font-size: 13px; color: var(--el-text-color-secondary); margin-top: 4px;">阳性项目数</div>
              </div>
            </div>
            <el-tag
              v-if="result.interpretation"
              :type="result.interpretation.severity === 'none' ? 'success' : result.interpretation.severity === 'mild' ? 'info' : result.interpretation.severity === 'moderate' ? 'warning' : 'danger'"
              size="large"
              style="margin-top: 12px"
            >
              {{ result.interpretation.label }}
            </el-tag>
          </div>
        </el-card>

        <el-card class="score-card" v-else-if="scale.id.toUpperCase() !== 'MMPI'">
          <div class="score-value" :style="{ color: result.interpretation?.color || '#303133' }">
            {{ result.stdScore.toFixed(1) }}
          </div>
          <div class="score-label">标准分</div>
          <el-tag
            v-if="result.interpretation"
            :type="result.interpretation.severity === 'none' ? 'success' : result.interpretation.severity === 'mild' ? 'info' : result.interpretation.severity === 'moderate' ? 'warning' : 'danger'"
            size="large"
            style="margin-top: 12px"
          >
            {{ result.interpretation.label }}
          </el-tag>
        </el-card>

        <el-card class="info-card" :style="scale.id.toUpperCase() === 'MMPI' ? { gridColumn: 'span 2' } : {}">
          <div class="info-row">
            <span class="info-label">量表</span>
            <span class="info-value">{{ scale.id }} {{ scale.name }}</span>
          </div>
          <div class="info-row" v-if="userStore.currentUser">
            <span class="info-label">被试用户</span>
            <span class="info-value">{{ userStore.currentUser.name }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">用时</span>
            <span class="info-value">{{ Math.floor(result.duration / 60) }}分{{ result.duration % 60 }}秒</span>
          </div>
          <div class="info-row">
            <span class="info-label">作答</span>
            <span class="info-value">{{ result.answers.length }}/{{ scale.questions.length }} 题</span>
          </div>
        </el-card>
      </div>

      <!-- 文字解释 -->
      <el-card v-if="result.interpretation && scale.id.toUpperCase() !== 'MMPI'" class="interpretation-card">
        <template #header>
          <span>结果解释</span>
        </template>
        <!-- ASRS-18 ADHD 阳性额外红色警告提示 -->
        <el-alert
          v-if="scale.id.toUpperCase() === 'ASRS-18' && asrsAdhdScreening"
          title="【ADHD筛查阳性】"
          description="前6题中≥4题达到2分或以上，建议尽快进行专业ADHD诊断评估。"
          type="error"
          show-icon
          :closable="false"
          style="margin-bottom: 16px; font-weight: bold; border-left: 5px solid var(--el-color-danger);"
        />
        <p class="interpretation-text">{{ result.interpretation.description }}</p>
        <el-alert
          v-if="result.interpretation.suggestion"
          :title="result.interpretation.suggestion"
          type="info"
          :closable="false"
          style="margin-top: 12px"
        />
      </el-card>

      <!-- 维度图表 -->
      <el-card v-if="dimensionChartOption" class="chart-card">
        <v-chart :option="dimensionChartOption" style="height: 320px; width: 100%" autoresize />
      </el-card>

      <!-- MMPI 高点分析卡片 -->
      <el-card v-if="scale.id.toUpperCase() === 'MMPI' && mmpiHighPoints" class="highpoint-card" style="margin-bottom: 16px;">
        <template #header>
          <div style="font-weight: bold; font-size: 16px;">临床高点分析 (Clinical High-Point Analysis)</div>
        </template>
        <div style="margin-bottom: 16px;">
          <span>当前剖面图主要高点组合编码：</span>
          <el-tag type="danger" size="large" style="font-weight: bold; font-size: 16px; margin-left: 8px;">
            {{ mmpiHighPoints.codeType }}
          </el-tag>
          <span style="margin-left: 16px; color: #606266; font-size: 14px;">
            (其中 {{ mmpiHighPoints.elevatedCount }} 个量表处于临床显著/筛查阳性水平 T ≥ 60)
          </span>
        </div>
        <div v-for="(item, idx) in mmpiHighPoints.topScales" :key="idx" style="margin-bottom: 16px; border-bottom: 1px dashed var(--el-border-color-light); padding-bottom: 12px;">
          <div style="display: flex; align-items: center; margin-bottom: 8px;">
            <span style="font-weight: bold; font-size: 15px; margin-right: 12px;">{{ idx + 1 }}. {{ item.label }}</span>
            <el-tag :type="item.t >= 70 ? 'danger' : item.t >= 60 ? 'warning' : 'info'">
              T 分: {{ item.t }} ({{ item.t >= 70 ? '显著升高' : item.t >= 60 ? '轻度升高' : '正常' }})
            </el-tag>
          </div>
          <p style="margin: 0; line-height: 1.6; font-size: 14px; color: #555;">{{ item.desc }}</p>
        </div>
      </el-card>

      <!-- 医生诊断意见与备注卡片 (网页版) -->
      <el-card class="doctor-note-card" style="margin-bottom: 16px;">
        <template #header>
          <div style="font-weight: bold; font-size: 16px; display: flex; justify-content: space-between; align-items: center;">
            <span>医生诊断意见与备注卡片</span>
            <el-tag v-if="result.id" type="success">关联测评记录ID: {{ result.id }}</el-tag>
            <el-tag v-else type="warning">暂未保存测评结果</el-tag>
          </div>
        </template>
        <el-form label-position="top">
          <div style="margin-bottom: 12px; font-size: 13px; color: #e6a23c; display: flex; align-items: center; gap: 4px;">
            <el-icon><InfoFilled /></el-icon>
            提示：请先保存测评结果后再保存或更新医生意见。更新意见后将自动同步至打印报告单中。
          </div>
          <el-form-item label="医生临床诊断意见及建议">
            <el-input
              v-model="doctorNoteInput"
              type="textarea"
              :rows="4"
              placeholder="请输入临床诊断意见、测评建议或备注信息..."
            />
          </el-form-item>
          <div style="display: flex; gap: 16px; align-items: flex-end; margin-top: 12px;">
            <el-form-item label="报告医生" style="flex: 1; margin-bottom: 0;">
              <el-input v-model="reportDoctorInput" placeholder="请输入报告/诊断医生姓名" />
            </el-form-item>
            <el-button type="success" @click="saveDoctorNote">
              <el-icon style="margin-right: 4px;"><Check /></el-icon>
              保存意见
            </el-button>
          </div>
        </el-form>
      </el-card>

      <!-- 维度评分细则表格 (网页版, 折叠面板包裹) -->
      <el-card v-if="dimensionDetailsList && dimensionDetailsList.length > 0" class="dimension-table-card" style="margin-bottom: 16px;">
        <template #header>
          <div style="font-weight: bold; font-size: 16px;">维度评分细则</div>
        </template>
        <el-collapse>
          <el-collapse-item name="dimensions" title="展开/收起维度分值、临床结论与结论说明">
            <el-table :data="dimensionDetailsList" style="width: 100%">
              <el-table-column prop="name" label="维度名称" min-width="120" />
              <el-table-column prop="score" label="得分" width="100" sortable>
                <template #default="{ row }">
                  <span style="font-weight: bold; color: #409eff;">{{ row.score.toFixed(1) }} 分</span>
                </template>
              </el-table-column>
              <el-table-column prop="conclusion" label="临床结论" width="120">
                <template #default="{ row }">
                  <el-tag :type="row.conclusion.includes('升高') || row.conclusion.includes('偏高') ? 'danger' : 'success'">
                    {{ row.conclusion }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="description" label="结论说明" min-width="250" />
            </el-table>
          </el-collapse-item>
        </el-collapse>
      </el-card>

      <!-- 原始数据 -->
      <el-card class="raw-data-card">
        <template #header>
          <div class="raw-data-header">
            <span>原始数据</span>
            <el-button text @click="showRawData = !showRawData">
              {{ showRawData ? '收起' : '展开' }}
            </el-button>
          </div>
        </template>
        <el-table v-if="showRawData" :data="result.answers" size="small">
          <el-table-column prop="questionId" label="题号" width="80" />
          <el-table-column label="题目" min-width="200">
            <template #default="{ row }">
              {{ scale.questions.find(q => String(q.id) === String(row.questionId))?.text || '-' }}
            </template>
          </el-table-column>
          <el-table-column prop="value" label="选项值" width="100" />
          <el-table-column prop="score" label="得分" width="80" />
        </el-table>
      </el-card>

      <!-- 免责声明 -->
      <el-alert
        title="免责声明"
        description="本测试结果仅供参考，不能替代专业医疗诊断。如有心理困扰，请寻求专业心理咨询师或精神科医生的帮助。"
        type="info"
        :closable="false"
        show-icon
        style="margin-top: 16px"
      />

      <!-- 底部操作 -->
      <div class="result-footer no-print">
        <el-button @click="goHome">返回首页</el-button>
        <el-button type="primary" @click="newTest">继续测评</el-button>
      </div>
    </div>
  </div>

  <!-- 危机预警弹窗拦截 -->
  <el-dialog
    v-model="crisisDialogVisible"
    width="90%"
    top="5vh"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
    modal-class="crisis-modal-overlay"
    class="crisis-custom-dialog"
  >
    <template #header>
      <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
        <el-icon size="30px" color="#F56C6C"><Warning /></el-icon>
        <span style="font-size: 24px; font-weight: bold; color: #F56C6C;">高危结果预警</span>
      </div>
    </template>

    <div style="padding: 20px; line-height: 1.8;">
      <el-descriptions :column="2" border size="large">
        <el-descriptions-item label="被试姓名">
          <span style="font-weight: bold; font-size: 16px;">{{ result?.userName || '未知被试' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="量表名称">
          <span>{{ scale?.name || '未知量表' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="测评得分">
          <span style="color: #F56C6C; font-weight: bold; font-size: 18px;">{{ result?.score }} 分</span>
        </el-descriptions-item>
        <el-descriptions-item label="风险等级">
          <el-tag type="danger" effect="dark" size="large">{{ result?.severity || '高危' }}</el-tag>
        </el-descriptions-item>
      </el-descriptions>

      <div style="margin-top: 25px; text-align: center; color: #F56C6C; font-size: 18px; font-weight: bold;">
        ⚠️ 该被试测评结果达到高危阈值，请立即采取干预措施！
      </div>

      <div style="margin-top: 25px;">
        <div style="margin-bottom: 10px; font-weight: bold; font-size: 14px;">干预措施记录：</div>
        <el-input
          v-model="crisisInterventionNote"
          type="textarea"
          :rows="4"
          placeholder="请记录已采取的干预措施（至少 5 个字）"
          maxlength="500"
          show-word-limit
        />
      </div>
    </div>

    <template #footer>
      <div style="text-align: center; padding-bottom: 10px;">
        <el-button
          type="danger"
          size="large"
          :disabled="crisisInterventionNote.trim().length < 5"
          :loading="crisisSubmitting"
          @click="submitCrisisIntervention"
          style="width: 200px; font-size: 16px;"
        >
          确认已介入
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.result-view {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px;
}

.result-header {
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

.result-overview {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}

.score-card {
  text-align: center;
  padding: 24px;
}

.score-value {
  font-size: 84px !important;
  font-weight: 800;
  line-height: 1;
  color: var(--fluent-accent);
  margin-bottom: 8px;
}

.score-label {
  font-size: 14px;
  color: var(--el-text-color-secondary);
  margin-top: 8px;
}

.info-card {
  padding: 16px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-light);
}

.info-row:last-child {
  border-bottom: none;
}

.info-label {
  color: var(--el-text-color-secondary);
}

.info-value {
  font-weight: 500;
}

.interpretation-card,
.chart-card,
.raw-data-card {
  margin-bottom: 16px;
}

.interpretation-text {
  font-size: 15px;
  line-height: 1.8;
  margin: 0;
}

.raw-data-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.result-footer {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 24px;
  padding-bottom: 32px;
}

.dark .result-view :deep(.el-card) {
  background: var(--app-card, #16213e);
  color: var(--app-text, #e0e0e0);
}

/* 解决结果页在部分模式下可能出现的黑底黑字或对比度差问题，增强页面可读性 */
.result-view {
  color: var(--fluent-text-primary) !important;
}

.dark .result-view :deep(.el-table) {
  --el-table-text-color: var(--fluent-text-primary) !important;
  --el-table-header-text-color: var(--fluent-text-primary) !important;
  --el-table-bg-color: transparent !important;
  --el-table-tr-bg-color: transparent !important;
}

.dark .result-view :deep(.el-table th),
.dark .result-view :deep(.el-table td) {
  color: var(--fluent-text-primary) !important;
}

.dark .result-view :deep(.el-card__header) {
  color: var(--fluent-text-primary) !important;
  border-bottom: 1px solid var(--fluent-card-border) !important;
}

.dark .result-view :deep(.el-text) {
  color: var(--fluent-text-primary) !important;
}

.dark .result-view :deep(.el-text--info) {
  color: var(--fluent-text-secondary) !important;
}

.dark .result-view :deep(.el-text--danger) {
  color: #ff6b6b !important;
}

.dark .result-view :deep(.el-text--success) {
  color: #67c23a !important;
}

.dark .result-view :deep(.el-button--text) {
  color: var(--fluent-accent) !important;
}

@media (max-width: 768px) {
  .result-overview {
    grid-template-columns: 1fr;
  }
}

/* 医科大学附属第一医院检查报告风格 */
.medical-report-print {
  display: none;
  font-family: "SimSun", "STSong", "Songti SC", serif;
  color: #000000;
  background-color: #ffffff;
  padding: 40px;
  box-sizing: border-box;
}

.report-title {
  font-size: 22px;
  font-weight: bold;
  text-align: center;
  margin-top: 10px;
  margin-bottom: 24px;
  letter-spacing: 1px;
}

.patient-info-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 12px;
}

.patient-info-table td {
  padding: 6px 4px;
  font-size: 14px;
  border: none;
}

.patient-info-table td.label {
  font-weight: bold;
  text-align: left;
  white-space: nowrap;
  padding-right: 8px;
  width: 1%;
}

.patient-info-table td.value {
  border-bottom: 1px solid #000;
  text-align: left;
  white-space: nowrap;
  padding-right: 24px;
  width: 32%;
}

.report-data-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 16px;
  margin-bottom: 24px;
}

.report-data-table th, 
.report-data-table td {
  border-bottom: 1px solid #000;
  padding: 10px 8px;
  text-align: left;
  font-size: 14px;
}

.report-data-table th {
  font-weight: bold;
  border-top: 1.5px solid #000;
  border-bottom: 1.5px solid #000;
}

.diagnosis-section {
  margin-top: 24px;
  border-top: 1px solid #000;
  padding-top: 12px;
}

.diagnosis-section .section-title {
  font-size: 15px;
  font-weight: bold;
  margin-bottom: 8px;
}

.diagnosis-content {
  font-size: 14px;
  line-height: 1.8;
  white-space: pre-wrap;
}

/* 打印时强制定制显示 */
@media print {
  .result-container.no-print {
    display: none !important;
  }
  .medical-report-print {
    display: block !important;
    width: 100% !important;
    height: auto !important;
  }
}

.crisis-locked-blur {
  filter: blur(2px) !important;
  pointer-events: none !important;
}
.crisis-modal-overlay {
  background-color: rgba(180, 0, 0, 0.15) !important;
}
.crisis-custom-dialog {
  border-radius: 8px;
  overflow: hidden;
}
.dark .crisis-custom-dialog {
  background-color: #1e1e1e !important;
  border: 1px solid #4c2c2c;
}
.dark .crisis-modal-overlay {
  background-color: rgba(100, 0, 0, 0.25) !important;
}
</style>

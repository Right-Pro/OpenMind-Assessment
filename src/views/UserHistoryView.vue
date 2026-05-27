<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/userStore'
import { useTestStore } from '@/stores/testStore'
import { useScaleStore } from '@/stores/scaleStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { ElMessage, ElMessageBox, ElLoading } from 'element-plus'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, TitleComponent } from 'echarts/components'
import type { User, TestHistory } from '@/types'
import * as XLSX from 'xlsx'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

// 预约快速弹窗逻辑
import { useAppointmentStore } from '@/stores/appointmentStore'

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, LegendComponent, TitleComponent])

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const testStore = useTestStore()
const scaleStore = useScaleStore()
const settingsStore = useSettingsStore()
const appointmentStore = useAppointmentStore()

// 引入 BarChart 的注册以便对比柱状图显示
use([BarChart])

const userId = Number(route.params.id)
const user = ref<User | null>(null)
const histories = ref<TestHistory[]>([])
const loading = ref(false)

// 筛选和表单逻辑
const selectedScaleId = ref('')
const tableFilterText = ref('')

// 预约弹窗
const apptDialogVisible = ref(false)
const apptForm = ref({
  scaleId: '',
  date: '',
  time: ''
})

// 多选表格数据
const selectedRows = ref<TestHistory[]>([])

function handleSelectionChange(rows: TestHistory[]) {
  selectedRows.value = rows
}

// 去标识化规则掩码方法
function maskName(name?: string) {
  if (!name) return '/'
  if (name.length <= 1) return '*'
  if (name.length === 2) return name[0] + '*'
  return name[0] + '*'.repeat(name.length - 1)
}

function maskContact(contact?: string) {
  if (!contact) return '/'
  if (contact.length < 7) return '***'
  return contact.slice(0, 3) + '****' + contact.slice(-4)
}

function maskBirthdate(birthdate?: string) {
  if (!birthdate) return '/'
  const match = birthdate.match(/^(\d{4})/)
  if (match) {
    return `${match[1]}-**-**`
  }
  return '****'
}

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

// 维度评估说明
function getDimensionDesc(scaleObj: any, dimName: string, score: any) {
  if (!scaleObj || !scaleObj.scoring?.dimensions) return '正常'
  const dimDef = scaleObj.scoring.dimensions.find((d: any) => d.name === dimName)
  if (!dimDef) return '正常'
  
  const scoreNum = typeof score === 'number' ? score : Number(score)
  if (isNaN(scoreNum)) return '正常'
  
  if (scaleObj.id.toUpperCase() === 'MMPI') {
    const gender = user.value?.gender === 'female' ? 'female' : 'male'
    const norms = scaleObj.scoring.mmpiConfig?.norms?.[gender] || scaleObj.scoring.mmpiConfig?.norms?.male
    const norm = norms?.[dimName]
    const tScore = norm ? Math.round(50 + 10 * (scoreNum - norm.mean) / norm.sd) : scoreNum
    return `T分: ${tScore} (${tScore >= 70 ? '显著升高' : tScore >= 60 ? '轻度升高' : '正常'})`
  }
  
  if (dimDef.cutoffs) {
    for (const cutoff of dimDef.cutoffs) {
      const min = cutoff.min ?? -Infinity
      const max = cutoff.max ?? Infinity
      if (scoreNum >= min && scoreNum <= max) {
        return cutoff.label || '正常'
      }
    }
  }
  return dimDef.description || '正常'
}

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
    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)' // 使用 0.08 半透明度
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((-45 * Math.PI) / 180)
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

// 批量打印状态
const isPrinting = ref(false)
const printProgress = ref(0)
const totalToPrint = ref(0)
const cancelPrint = ref(false)
const currentPrintIndex = ref(0)
const printingTestObj = ref<any>(null)
const printingScaleObj = ref<any>(null)

// 批量打印 PDF
async function startBatchPrint() {
  if (selectedRows.value.length === 0) {
    ElMessage.warning('请先选择要打印的测试记录')
    return
  }
  
  const selectedTests = [...selectedRows.value]
  totalToPrint.value = selectedTests.length
  printProgress.value = 0
  currentPrintIndex.value = 0
  cancelPrint.value = false
  isPrinting.value = true
  
  const pdf = new jsPDF('p', 'mm', 'a4')
  const pdfWidth = pdf.internal.pageSize.getWidth()
  const pdfHeight = pdf.internal.pageSize.getHeight()
  
  for (let i = 0; i < selectedTests.length; i++) {
    if (cancelPrint.value) {
      break
    }
    
    currentPrintIndex.value = i
    const test = selectedTests[i]
    
    let testResult: any = null
    try {
      testResult = JSON.parse(test.result_json)
    } catch (e) {
      console.error('解析结果 JSON 失败', e)
      continue
    }
    
    const scale = scaleStore.getScaleById(test.scale_id)
    if (!scale) continue
    
    printingTestObj.value = {
      ...test,
      result: testResult,
      userAge: calculateAge(user.value?.birthdate),
      pageNumber: i + 1,
      totalPages: selectedTests.length
    }
    printingScaleObj.value = scale
    
    await nextTick()
    
    const printArea = document.querySelector('.batch-print-single-page') as HTMLElement
    if (printArea) {
      const canvas = await html2canvas(printArea, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff'
      })
      
      const imgData = canvas.toDataURL('image/jpeg', 0.9)
      
      if (i > 0) {
        pdf.addPage()
      }
      
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight)
      
      // 显式释放 Canvas 内存
      canvas.width = 0
      canvas.height = 0
    }
    
    printProgress.value = Math.round(((i + 1) / selectedTests.length) * 100)
  }
  
  isPrinting.value = false
  printingTestObj.value = null
  printingScaleObj.value = null
  
  if (cancelPrint.value) {
    ElMessage.info('批量生成被取消')
    return
  }
  
  const defaultName = `${user.value?.name || '用户'}_批量评定报告_${new Date().toISOString().slice(0, 10)}.pdf`
  const { canceled, filePath } = await window.electronAPI.showSaveDialog({
    title: '保存合并 PDF 报告',
    defaultPath: defaultName,
    filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
  })

  if (canceled || !filePath) {
    ElMessage.info('导出被取消')
    return
  }

  const pdfArrayBuffer = pdf.output('arraybuffer')
  const bytes = new Uint8Array(pdfArrayBuffer)
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const base64Data = window.btoa(binary)
  const saveRes = await window.electronAPI.saveBufferFile(filePath, base64Data)
  if (saveRes.success) {
    ElMessage.success('批量 PDF 报告合并生成并保存成功！')
  } else {
    ElMessage.error('保存 PDF 失败: ' + saveRes.error)
  }
}

// 去标识化 Excel 导出
function exportAnonymizedExcel() {
  const selected = selectedRows.value.length > 0 ? selectedRows.value : filteredHistories.value
  if (selected.length === 0) {
    ElMessage.warning('没有可导出的测试记录')
    return
  }
  
  try {
    const data = selected.map((h, index) => {
      let interpretationLabel = '/'
      try {
        if (h.result_json) {
          interpretationLabel = JSON.parse(h.result_json).interpretation?.label || '/'
        }
      } catch (e) {}
      
      return {
        '序号': index + 1,
        '被试姓名': maskName(user.value?.name),
        '性别': user.value?.gender === 'male' ? '男' : user.value?.gender === 'female' ? '女' : '未知',
        '年龄': userAge.value ? `${userAge.value}岁` : '/',
        '联系方式': maskContact(user.value?.contact),
        '出生日期': maskBirthdate(user.value?.birthdate),
        '量表ID': h.scale_id,
        '量表名称': h.scale_name,
        '测评时间': new Date(h.created_at).toLocaleString(),
        '用时': `${Math.floor(h.duration_seconds / 60)}分${h.duration_seconds % 60}秒`,
        '原始分': h.raw_score.toFixed(1),
        '标准分': h.std_score !== null && h.std_score !== undefined ? h.std_score.toFixed(1) : '/',
        '测评结论': interpretationLabel,
        '医生意见': h.doctorNote || '/',
        '报告医生': h.reportDoctor || '/'
      }
    })
    
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '测评去标识历史记录')
    
    // 设置列宽
    ws['!cols'] = [
      { wch: 6 },
      { wch: 12 },
      { wch: 6 },
      { wch: 6 },
      { wch: 15 },
      { wch: 12 },
      { wch: 10 },
      { wch: 25 },
      { wch: 20 },
      { wch: 10 },
      { wch: 8 },
      { wch: 8 },
      { wch: 15 },
      { wch: 25 },
      { wch: 10 }
    ]
    
    const fileName = `去标识化_测试历史_${user.value?.name ? maskName(user.value.name) : '用户'}_${new Date().toISOString().slice(0, 10)}.xlsx`
    XLSX.writeFile(wb, fileName)
    ElMessage.success('去标识化 Excel 导出成功！')
  } catch (e: any) {
    ElMessage.error('导出失败: ' + e.message)
  }
}

// 导出所选量表的全部记录（全库脱敏）
const isExportingAll = ref(false)
const exportProgress = ref(0)
const exportTotal = ref(0)
const exportCurrentCount = ref(0)
const exportScaleDialogVisible = ref(false)
const exportScaleForm = ref({
  scaleId: ''
})

async function exportScaleAllAnonymized() {
  // 如果当前已经有选中的筛选量表，直接导出该量表；否则弹出选择框
  if (selectedScaleId.value) {
    performScaleAllExport(selectedScaleId.value)
  } else {
    // 弹出量表选择对话框
    exportScaleForm.value.scaleId = ''
    exportScaleDialogVisible.value = true
  }
}

function handleConfirmScaleExport() {
  if (!exportScaleForm.value.scaleId) {
    ElMessage.warning('请选择量表')
    return
  }
  exportScaleDialogVisible.value = false
  performScaleAllExport(exportScaleForm.value.scaleId)
}

// 通用全库脱敏导出量表方法
async function performScaleAllExport(scaleId: string) {
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
            // 从 r.answers 查找或从 answersObj 查找
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

// 对比图表和内容 DOM 引用
const compareChartRef = ref<any>(null)
const compareContentRef = ref<HTMLElement | null>(null)

// 结果对比状态
const compareDialogVisible = ref(false)
const compareData = ref<{
  testA: any
  testB: any
  scaleA: any
  scaleB: any
  isSameScale: boolean
  scoreDiff: number
  stdDiff: number
  dimensions: { name: string; scoreA: number; scoreB: number; diff: number }[]
} | null>(null)

// 打印测评对比报告
async function printCompareReport() {
  if (!compareData.value) return

  // 1. 获取并渲染图表 (Resize + 延迟 500ms)
  if (compareChartRef.value) {
    compareChartRef.value.resize()
  }
  await new Promise(resolve => setTimeout(resolve, 500))

  let loadingInstance: any = null
  let printContainer: HTMLElement | null = null
  try {
    // 2. 显示 Loading
    loadingInstance = ElLoading.service({
      text: '正在生成对比报告 PDF...',
      background: 'rgba(0, 0, 0, 0.7)'
    })

    // 3. 弹出系统保存对话框
    const defaultName = `${user.value?.name || '被试'}_测评对比报告_${new Date().toISOString().slice(0, 10)}.pdf`
    const { canceled, filePath } = await window.electronAPI.showSaveDialog({
      title: '保存测评对比报告',
      defaultPath: defaultName,
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
    })

    if (canceled || !filePath) {
      ElMessage.info('导出被取消')
      return
    }

    // 4. 克隆到白底隐藏容器方案解决暗色模式截图卡死问题
    const originalNode = compareContentRef.value
    if (!originalNode) {
      throw new Error('找不到要对比的内容节点')
    }

    // 4.1 创建临时隐藏容器，并设置白底
    printContainer = document.createElement('div')
    printContainer.id = 'print-container'
    printContainer.style.position = 'absolute'
    printContainer.style.left = '-9999px'
    printContainer.style.top = '0'
    printContainer.style.width = '800px' // 固定宽度方便截图
    printContainer.style.backgroundColor = '#ffffff'
    printContainer.style.color = '#000000'
    printContainer.style.zIndex = '-9999'
    document.body.appendChild(printContainer)

    // 4.2 克隆对比页 DOM 到隐藏容器
    const cloneNode = originalNode.cloneNode(true) as HTMLElement
    // 强行展开滚动区域，避免被截断
    cloneNode.style.maxHeight = 'none'
    cloneNode.style.overflow = 'visible'
    cloneNode.style.padding = '30px'
    cloneNode.style.backgroundColor = '#ffffff'
    cloneNode.style.color = '#000000'

    // 4.3 递归强制设置所有文字颜色为 #000，背景为 #fff (内联样式覆盖)
    const forceWhiteStyle = (el: HTMLElement) => {
      // 排除 element-plus 的 tag 等可能需要颜色样式的元素，但背景文字强制设为安全的高对比度色
      el.style.backgroundColor = '#ffffff'
      el.style.color = '#000000'
      el.style.setProperty('background-color', '#ffffff', 'important')
      el.style.setProperty('color', '#000000', 'important')
      
      // 特殊处理 el-table 等边框及背景样式
      if (el.classList.contains('el-table') || el.classList.contains('el-card')) {
        el.style.border = '1px solid #ddd'
      }
      
      // 遍历子节点
      for (let i = 0; i < el.children.length; i++) {
        forceWhiteStyle(el.children[i] as HTMLElement)
      }
    }
    forceWhiteStyle(cloneNode)

    // 4.4 针对 Canvas 进行特别克隆 (把 ECharts Canvas 替换为静态 img)
    const originalCanvas = originalNode.querySelector('canvas') as HTMLCanvasElement
    if (originalCanvas) {
      const imgData = originalCanvas.toDataURL('image/png')
      const img = document.createElement('img')
      img.src = imgData
      img.style.width = '100%'
      img.style.height = 'auto'
      img.style.display = 'block'
      
      const cloneChartWrapper = cloneNode.querySelector('.compare-chart-wrapper') as HTMLElement
      if (cloneChartWrapper) {
        cloneChartWrapper.innerHTML = ''
        cloneChartWrapper.appendChild(img)
      }
    }

    // 挂载克隆节点
    printContainer.appendChild(cloneNode)

    // 4.5 对克隆后的 DOM 调用 html2canvas
    const canvas = await html2canvas(cloneNode, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff'
    })

    const imgData = canvas.toDataURL('image/jpeg', 0.9)
    
    // 5. 生成 PDF 并保存
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pdfWidth = pdf.internal.pageSize.getWidth()
    // 自动计算高度以自适应
    const imgWidth = 210 // A4 宽 210mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width
    
    // 如果图片超出单页，就分页
    let heightLeft = imgHeight
    let position = 0
    
    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
    heightLeft -= pdf.internal.pageSize.getHeight()
    
    while (heightLeft > 0) {
      position = heightLeft - imgHeight
      pdf.addPage()
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
      heightLeft -= pdf.internal.pageSize.getHeight()
    }

    const pdfArrayBuffer = pdf.output('arraybuffer')
    const bytes = new Uint8Array(pdfArrayBuffer)
    let binary = ''
    const len = bytes.byteLength
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    const base64Data = window.btoa(binary)
    const saveRes = await window.electronAPI.saveBufferFile(filePath, base64Data)
    
    if (saveRes.success) {
      ElMessage.success('测评对比 PDF 报告生成成功！')
    } else {
      throw new Error(saveRes.error || '保存文件失败')
    }

    // 显式释放 Canvas 内存
    canvas.width = 0
    canvas.height = 0
  } catch (err: any) {
    console.error(err)
    ElMessage.error('生成 PDF 失败: ' + err.message)
  } finally {
    // 销毁克隆节点与临时容器
    if (printContainer && printContainer.parentNode) {
      printContainer.parentNode.removeChild(printContainer)
    }
    if (loadingInstance) {
      loadingInstance.close()
    }
  }
}

// 测评对比触发
function compareTests() {
  if (selectedRows.value.length !== 2) {
    ElMessage.warning('请选择恰好两条测试记录进行对比')
    return
  }
  
  const [tA, tB] = selectedRows.value
  let testA = tA
  let testB = tB
  if (new Date(testA.created_at).getTime() > new Date(testB.created_at).getTime()) {
    testA = tB
    testB = tA
  }
  
  let resA: any = null
  let resB: any = null
  try {
    resA = JSON.parse(testA.result_json)
    resB = JSON.parse(testB.result_json)
  } catch (e) {
    ElMessage.error('解析测评结果数据失败')
    return
  }
  
  const isSameScale = testA.scale_id === testB.scale_id
  const scaleA = scaleStore.getScaleById(testA.scale_id)
  const scaleB = scaleStore.getScaleById(testB.scale_id)
  
  const dimensions: any[] = []
  if (isSameScale && resA.dimensionScores && resB.dimensionScores) {
    const allDims = Array.from(new Set([
      ...Object.keys(resA.dimensionScores),
      ...Object.keys(resB.dimensionScores)
    ]))
    
    allDims.forEach(dim => {
      const valA = Number(resA.dimensionScores[dim] || 0)
      const valB = Number(resB.dimensionScores[dim] || 0)
      dimensions.push({
        name: dim,
        scoreA: valA,
        scoreB: valB,
        diff: Number((valB - valA).toFixed(1))
      })
    })
  }
  
  compareData.value = {
    testA: { ...testA, result: resA },
    testB: { ...testB, result: resB },
    scaleA,
    scaleB,
    isSameScale,
    scoreDiff: Number((testB.raw_score - testA.raw_score).toFixed(1)),
    stdDiff: (testB.std_score !== null && testA.std_score !== null)
      ? Number((testB.std_score - testA.std_score).toFixed(1))
      : 0,
    dimensions
  }
  
  compareDialogVisible.value = true
}

// 对比图表 ECharts Option
const compareChartOption = computed<any>(() => {
  if (!compareData.value || !compareData.value.isSameScale || compareData.value.dimensions.length === 0) return undefined
  
  const dims = compareData.value.dimensions
  const categories = dims.map(d => d.name)
  const dataA = dims.map(d => d.scoreA)
  const dataB = dims.map(d => d.scoreB)
  const isDark = settingsStore.darkMode
  
  return {
    backgroundColor: 'transparent',
    title: { 
      text: '两次评定维度得分对比剖面', 
      left: 'center', 
      textStyle: { 
        fontSize: 13, 
        fontWeight: 'bold',
        color: isDark ? '#ffffff' : '#333333'
      } 
    },
    tooltip: { 
      trigger: 'axis',
      backgroundColor: isDark ? '#1f2d3d' : '#ffffff',
      textStyle: { color: isDark ? '#ffffff' : '#333333' }
    },
    legend: { 
      data: ['前期评定', '跟进评定'], 
      bottom: 0,
      textStyle: { color: isDark ? '#cad1d9' : '#333333' }
    },
    xAxis: { 
      type: 'category', 
      data: categories,
      axisLabel: { color: isDark ? '#cad1d9' : '#333333' },
      axisLine: { lineStyle: { color: isDark ? '#444444' : '#e0e0e0' } }
    },
    yAxis: { 
      type: 'value', 
      name: '分数',
      nameTextStyle: { color: isDark ? '#cad1d9' : '#333333' },
      axisLabel: { color: isDark ? '#cad1d9' : '#333333' },
      axisLine: { lineStyle: { color: isDark ? '#444444' : '#e0e0e0' } },
      splitLine: { lineStyle: { color: isDark ? '#333333' : '#f0f0f0' } }
    },
    series: [
      {
        name: '前期评定',
        type: 'bar',
        data: dataA,
        itemStyle: { color: isDark ? '#8a9099' : '#909399' }
      },
      {
        name: '跟进评定',
        type: 'bar',
        data: dataB,
        itemStyle: { color: isDark ? '#60cdff' : '#409EFF' }
      }
    ]
  }
})

// 是否来自“用户管理”页面的标示，用于动态显示面包屑 and 返回按钮
const isFromUsers = computed(() => {
  return route.query.from === 'users'
})

function initDefaultScale() {
  const counts: Record<string, number> = {}
  histories.value.forEach(h => {
    counts[h.scale_id] = (counts[h.scale_id] || 0) + 1
  })
  let defaultScaleId = ''
  let maxCount = 0
  Object.entries(counts).forEach(([id, count]) => {
    if (count > maxCount && count > 1) { // 必须有多次测试记录
      maxCount = count
      defaultScaleId = id
    }
  })
  selectedScaleId.value = defaultScaleId
}

onMounted(async () => {
  loading.value = true
  try {
    // 确保用户和量表数据载入
    await userStore.loadUsers()
    if (scaleStore.scales.length === 0) {
      await scaleStore.loadScales()
    }
    
    const foundUser = userStore.users.find(u => u.id === userId)
    if (foundUser) {
      user.value = foundUser
      // 获取用户历史
      histories.value = await userStore.getTestHistory(userId)
      initDefaultScale()
    } else {
      ElMessage.error('未找到该用户')
      router.push('/users')
    }
  } catch (e: any) {
    ElMessage.error('加载历史记录失败: ' + e.message)
  } finally {
    loading.value = false
  }
})

// 计算用户年龄
const userAge = computed(() => {
  if (!user.value?.birthdate) return ''
  const birth = new Date(user.value.birthdate)
  if (isNaN(birth.getTime())) return ''
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--
  }
  return age > 0 ? String(age) : '0'
})

// 量表筛选下拉框选项
const scaleOptions = computed(() => {
  const uniqueIds = Array.from(new Set(histories.value.map(h => h.scale_id)))
  return uniqueIds.map(id => {
    const hist = histories.value.find(h => h.scale_id === id)
    const count = histories.value.filter(h => h.scale_id === id).length
    return {
      id,
      name: hist ? `${hist.scale_id} ${hist.scale_name}` : id,
      count,
      disabled: false, // 所有条目都是可点击的
      hasNoTrend: count <= 1
    }
  })
})

// 监听选中的量表，如果仅1次测试，则直接跳转到报告详情，并重置选中状态
watch(selectedScaleId, (newVal) => {
  if (!newVal) return
  const opt = scaleOptions.value.find(o => o.id === newVal)
  if (opt && opt.hasNoTrend) {
    const singleTest = histories.value.find(h => h.scale_id === newVal)
    if (singleTest) {
      viewTestResult(singleTest)
      // 延迟重置，防止选中状态残留
      nextTick(() => {
        selectedScaleId.value = ''
      })
    }
  }
})

// 统计摘要
const statistics = computed(() => {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  let last7 = 0
  let last30 = 0

  histories.value.forEach(h => {
    const testDate = new Date(h.created_at)
    if (testDate >= sevenDaysAgo) last7++
    if (testDate >= thirtyDaysAgo) last30++
  })

  // 测过最多的量表及次数
  let mostTestedScaleName = '无'
  let mostTestedScaleCount = 0
  
  const counts: Record<string, { id: string, name: string, count: number }> = {}
  histories.value.forEach(h => {
    if (!counts[h.scale_id]) {
      counts[h.scale_id] = { id: h.scale_id, name: h.scale_name, count: 0 }
    }
    counts[h.scale_id].count++
  })
  
  Object.values(counts).forEach(item => {
    if (item.count > mostTestedScaleCount) {
      mostTestedScaleCount = item.count
      mostTestedScaleName = `${item.id} ${item.name}`
    }
  })

  return {
    total: histories.value.length,
    mostTested: mostTestedScaleCount > 0 ? `${mostTestedScaleName} (${mostTestedScaleCount}次)` : '无',
    last7,
    last30
  }
})

// 过滤后的列表
const filteredHistories = computed(() => {
  let list = [...histories.value]
  
  if (selectedScaleId.value) {
    list = list.filter(h => h.scale_id === selectedScaleId.value)
  }
  
  if (tableFilterText.value.trim()) {
    const query = tableFilterText.value.toLowerCase()
    list = list.filter(h => {
      const nameMatch = h.scale_name.toLowerCase().includes(query)
      const idMatch = h.scale_id.toLowerCase().includes(query)
      // 查找对应的量表定义以获取英文名称进行匹配
      const scaleDef = scaleStore.getScaleById(h.scale_id)
      const enMatch = scaleDef?.name_en?.toLowerCase().includes(query) || false
      return nameMatch || idMatch || enMatch
    })
  }

  // 按时间倒序排序
  return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
})

// ECharts 折线图配置
const chartOption = computed<any>(() => {
  if (!selectedScaleId.value) return undefined

  // 过滤用于画图的数据
  let drawData = histories.value.filter(h => h.scale_id === selectedScaleId.value)
  if (drawData.length <= 1) return undefined

  // 按时间正序排序画折线
  drawData.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  const scaleName = drawData[0] ? `${drawData[0].scale_id} ${drawData[0].scale_name}` : ''
  
  // 提取数据点
  const chartPoints = drawData.map(h => {
    const scoreVal = h.std_score !== null && h.std_score !== undefined ? h.std_score : h.raw_score
    const interpretationLabel = h.result_json ? (JSON.parse(h.result_json).interpretation?.label || '无') : '无'
    return {
      name: new Date(h.created_at).toLocaleString(),
      value: scoreVal,
      rawScore: h.raw_score,
      stdScore: h.std_score,
      interpretation: interpretationLabel
    }
  })

  return {
    title: {
      text: `${scaleName} 历史得分趋势（${drawData.length}次测试）`,
      left: 'center',
      textStyle: {
        fontSize: 14,
        fontWeight: 'bold'
      }
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        const d = params.data
        return `<div style="font-size:12px;padding:4px;">
          <strong>${scaleName}</strong><br/>
          日期: ${params.name}<br/>
          原始分: ${d.rawScore?.toFixed(1) || '/'}<br/>
          标准分: ${d.stdScore?.toFixed(1) || '/'}<br/>
          结论: ${d.interpretation}
        </div>`
      }
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '10%',
      top: '15%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: chartPoints.map(p => p.name),
      boundaryGap: true
    },
    yAxis: {
      type: 'value',
      name: '分数'
    },
    series: [
      {
        name: scaleName,
        type: 'line',
        data: chartPoints.map(p => ({
          name: p.name,
          value: p.value,
          rawScore: p.rawScore,
          stdScore: p.stdScore,
          interpretation: p.interpretation
        })),
        smooth: true,
        symbol: 'circle',
        symbolSize: 8
      }
    ]
  }
})

// 查看报告
function viewTestResult(test: TestHistory) {
  try {
    const testResult = JSON.parse(test.result_json)
    const scale = scaleStore.getScaleById(test.scale_id)
    if (!scale) {
      const displayScore = test.std_score !== null && test.std_score !== undefined ? test.std_score : test.raw_score
      ElMessageBox.alert(
        `该量表文件已在当前版本中移除，仅保留原始得分记录：总分 ${displayScore}`,
        '量表文件不存在',
        {
          confirmButtonText: '确定',
          type: 'warning'
        }
      )
      return
    }
    // 附加额外字段以便 ResultView 展现/编辑
    testResult.id = test.id
    testResult.doctorNote = test.doctorNote || ''
    testResult.reportDoctor = test.reportDoctor || ''
    
    // 将历史数据还原至 testStore 中
    testStore.initTest(scale)
    testStore.setResult(testResult)
    router.push('/result')
  } catch (e: any) {
    ElMessage.error('无法解析历史结果数据')
  }
}

// 删除历史记录
async function deleteHistory(test: TestHistory) {
  try {
    await ElMessageBox.confirm(`确定要彻底删除该次 [${test.scale_id} ${test.scale_name}] 测试记录吗？删除后将无法恢复。`, '二次确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    
    // 执行 SQL 语句删除该条记录
    // 1. 删除 answers 表关联数据
    await window.electronAPI.dbRun('DELETE FROM answers WHERE test_id = ?', [test.id])
    // 2. 删除 tests 表该测试记录
    await window.electronAPI.dbRun('DELETE FROM tests WHERE id = ?', [test.id])
    
    ElMessage.success('删除成功！')
    
    // 刷新数据
    histories.value = await userStore.getTestHistory(userId)
    // 如果当前选中的量表测试次数不够了，重新初始化默认选中的量表
    const currentScaleCount = histories.value.filter(h => h.scale_id === selectedScaleId.value).length
    if (currentScaleCount <= 1) {
      initDefaultScale()
    }
  } catch (e: any) {
    if (e !== 'cancel') {
      ElMessage.error('删除失败: ' + e.message)
    }
  }
}

function goBack() {
  router.push('/users')
}

async function openQuickAppt() {
  apptForm.value = {
    scaleId: '',
    date: '',
    time: ''
  }
  if (scaleStore.scales.length === 0) {
    await scaleStore.loadScales()
  }
  apptDialogVisible.value = true
}

async function saveAppointment() {
  if (!apptForm.value.scaleId) {
    ElMessage.warning('请选择量表')
    return
  }
  if (!apptForm.value.date || !apptForm.value.time) {
    ElMessage.warning('请选择完整的日期和时间')
    return
  }

  try {
    const scheduledDateTime = new Date(`${apptForm.value.date}T${apptForm.value.time}`)
    if (isNaN(scheduledDateTime.getTime())) {
      ElMessage.warning('日期或时间格式不正确')
      return
    }

    if (user.value?.id) {
      await appointmentStore.addAppointment(
        user.value.id,
        apptForm.value.scaleId,
        scheduledDateTime.getTime()
      )
      ElMessage.success('预约成功')
      apptDialogVisible.value = false
    }
  } catch (err: any) {
    ElMessage.error('预约失败: ' + err.message)
  }
}
</script>

<template>
  <div class="user-history-view" v-loading="loading">
    <!-- 面包屑及顶部导航，仅在从用户管理页面进入时展示 -->
    <div v-if="isFromUsers" class="page-nav no-print">
      <el-breadcrumb separator="/">
        <el-breadcrumb-item :to="{ path: '/' }">首页</el-breadcrumb-item>
        <el-breadcrumb-item :to="{ path: '/users' }">用户管理</el-breadcrumb-item>
        <el-breadcrumb-item>{{ user?.name || '未知用户' }} 的历史记录</el-breadcrumb-item>
      </el-breadcrumb>
      <el-button @click="goBack" size="small" style="margin-top: 10px;">
        <el-icon style="margin-right: 4px;"><ArrowLeft /></el-icon>返回用户管理
      </el-button>
    </div>

    <!-- 用户基本信息栏 -->
    <el-card v-if="user" class="user-info-card" shadow="never">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 600;">基本信息</span>
          <el-button type="primary" size="small" @click="openQuickAppt">
            预约下次测评
          </el-button>
        </div>
      </template>
      <div class="info-layout">
        <div class="info-left">
          <div class="info-avatar">
            {{ user.name.slice(0, 2) }}
          </div>
          <div class="info-detail-grid">
            <div class="grid-item">
              <span class="detail-label">姓名:</span>
              <span class="detail-val">{{ user.name }}</span>
            </div>
            <div class="grid-item">
              <span class="detail-label">性别:</span>
              <span class="detail-val">{{ user.gender === 'male' ? '男' : user.gender === 'female' ? '女' : '未知' }}</span>
            </div>
            <div class="grid-item">
              <span class="detail-label">年龄:</span>
              <span class="detail-val">{{ userAge ? `${userAge}岁` : '/' }}</span>
            </div>
            <div class="grid-item">
              <span class="detail-label">出生日期:</span>
              <span class="detail-val">{{ user.birthdate || '/' }}</span>
            </div>
            <div class="grid-item" style="grid-column: span 2;">
              <span class="detail-label">联系电话:</span>
              <span class="detail-val">{{ user.contact || '/' }}</span>
            </div>
          </div>
        </div>
        <div class="info-right">
          <div class="notes-box">
            <div class="notes-title">诊断备注:</div>
            <p class="notes-content">{{ user.notes || '暂无备注说明' }}</p>
          </div>
          <div class="count-box">
            <span class="count-num">{{ histories.length }}</span>
            <span class="count-label">测试总次数</span>
          </div>
        </div>
      </div>
    </el-card>

    <!-- 趋势分析区 -->
    <el-card class="chart-section-card" shadow="never">
      <template #header>
        <div class="chart-header">
          <span style="font-weight: 600;">趋势分析图表</span>
          <el-select v-model="selectedScaleId" placeholder="请选择量表" size="small" style="width: 280px;">
            <el-option label="请选择量表" value="" />
            <el-option
              v-for="opt in scaleOptions"
              :key="opt.id"
              :label="opt.name"
              :value="opt.id"
              :disabled="false"
            >
              <div style="display: flex; justify-content: space-between; width: 100%; gap: 16px;">
                <span>{{ opt.name }}</span>
                <span style="color: var(--el-text-color-secondary); font-size: 12px;">
                  {{ opt.hasNoTrend ? '仅1次测试，无趋势' : `${opt.count}次` }}
                </span>
              </div>
            </el-option>
          </el-select>
        </div>
      </template>

      <!-- 折线趋势图 -->
      <div class="chart-container">
        <el-empty
          v-if="!selectedScaleId"
          description="请选择量表以查看得分趋势（仅多次测试的量表可查看趋势）"
        />
        <el-empty
          v-else-if="histories.filter(h => h.scale_id === selectedScaleId).length <= 1"
          description="该量表仅 1 次测试记录，无趋势数据"
        />
        <v-chart
          v-else-if="chartOption"
          :option="chartOption"
          style="height: 350px; width: 100%;"
          autoresize
        />
      </div>
    </el-card>

    <!-- 统计摘要卡片一行 -->
    <div class="summary-cards-row">
      <el-card class="summary-card" shadow="hover">
        <div class="summary-card-inner">
          <div class="summary-label">该用户总测试次数</div>
          <div class="summary-value">{{ statistics.total }}</div>
        </div>
      </el-card>
      <el-card class="summary-card" shadow="hover">
        <div class="summary-card-inner">
          <div class="summary-label">测过最多的量表及次数</div>
          <div class="summary-value" style="font-size: 14px; font-weight: bold; height: 28px; line-height: 28px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" :title="statistics.mostTested">
            {{ statistics.mostTested }}
          </div>
        </div>
      </el-card>
      <el-card class="summary-card" shadow="hover">
        <div class="summary-card-inner">
          <div class="summary-label">最近 7 天测试次数</div>
          <div class="summary-value">{{ statistics.last7 }}</div>
        </div>
      </el-card>
      <el-card class="summary-card" shadow="hover">
        <div class="summary-card-inner">
          <div class="summary-label">最近 30 天测试次数</div>
          <div class="summary-value">{{ statistics.last30 }}</div>
        </div>
      </el-card>
    </div>

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

    <!-- 选择量表导出全部的弹窗 -->
    <el-dialog
      v-model="exportScaleDialogVisible"
      title="选择要导出全部去标识化数据的量表"
      width="480px"
    >
      <el-form :model="exportScaleForm" label-width="auto" style="padding: 10px 0;">
        <el-form-item label="量表选择" required>
          <el-select v-model="exportScaleForm.scaleId" placeholder="请选择要导出的量表" style="width: 100%;">
            <el-option
              v-for="scale in scaleStore.scales"
              :key="scale.id"
              :label="`${scale.id} - ${scale.name}`"
              :value="scale.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <div style="text-align: right;">
          <el-button @click="exportScaleDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="handleConfirmScaleExport">开始导出</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 历史测试完整列表 -->
    <el-card class="list-section-card" shadow="never">
      <template #header>
        <div class="list-header">
          <span style="font-weight: 600;">历史测试明细</span>
          <div style="display: flex; gap: 10px; align-items: center;">
            <el-dropdown trigger="click" size="small" style="margin-right: 4px;">
              <el-button type="warning" size="small">
                <el-icon style="margin-right: 4px;"><Download /></el-icon>
                去标识化导出
                <el-icon class="el-icon--right"><arrow-down /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="exportAnonymizedExcel">
                    导出当前筛选结果
                  </el-dropdown-item>
                  <el-dropdown-item @click="exportScaleAllAnonymized">
                    导出该量表全部记录
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-input
              v-model="tableFilterText"
              placeholder="搜索量表名称、英文名称或ID..."
              size="small"
              clearable
              style="width: 220px;"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
          </div>
        </div>
      </template>

      <!-- 批量操作栏 -->
      <div v-if="selectedRows.length > 0" style="margin-bottom: 12px; background: var(--el-fill-color-light); padding: 8px 12px; border-radius: 4px; display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: 13px; color: var(--el-text-color-regular);">
          已选择 <strong style="color: var(--el-color-primary);">{{ selectedRows.length }}</strong> 项记录
        </span>
        <div style="display: flex; gap: 8px;">
          <el-button 
            type="success" 
            size="small" 
            :disabled="selectedRows.length !== 2" 
            @click="compareTests"
          >
            <el-icon style="margin-right: 4px;"><TrendCharts /></el-icon>
            对比选中结果 (2项)
          </el-button>
          <el-button type="warning" size="small" @click="exportAnonymizedExcel">
            <el-icon style="margin-right: 4px;"><Download /></el-icon>
            去标识化导出
          </el-button>
          <el-button type="primary" size="small" @click="startBatchPrint">
            <el-icon style="margin-right: 4px;"><Printer /></el-icon>
            批量打印报告
          </el-button>
        </div>
      </div>

      <el-table :data="filteredHistories" size="default" style="width: 100%;" @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="55" />
        <el-table-column label="量表名称" min-width="160">
          <template #default="{ row }">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span>{{ row.scale_id }} {{ row.scale_name }}</span>
              <el-tooltip v-if="row.doctorNote" :content="`有医生诊断意见: ${row.doctorNote}`" placement="top">
                <span style="cursor: pointer; font-size: 14px;">📝</span>
              </el-tooltip>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="operatorName" label="测评人 (操作员)" width="120">
          <template #default="{ row }">
            {{ row.operatorName || '系统管理员' }}
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="测试时间" width="170">
          <template #default="{ row }">
            {{ new Date(row.created_at).toLocaleString() }}
          </template>
        </el-table-column>
        <el-table-column prop="raw_score" label="原始分" width="90">
          <template #default="{ row }">
            {{ row.raw_score.toFixed(1) }}
          </template>
        </el-table-column>
        <el-table-column prop="std_score" label="标准分" width="90">
          <template #default="{ row }">
            {{ row.std_score !== null && row.std_score !== undefined ? row.std_score.toFixed(1) : '/' }}
          </template>
        </el-table-column>
        <el-table-column label="测评结论" min-width="140">
          <template #default="{ row }">
            <div style="display: flex; align-items: center; gap: 6px;">
              <el-tag
                v-if="row.result_json"
                size="small"
                :type="JSON.parse(row.result_json).interpretation?.severity === 'none' ? 'success' : JSON.parse(row.result_json).interpretation?.severity === 'mild' ? 'info' : JSON.parse(row.result_json).interpretation?.severity === 'moderate' ? 'warning' : 'danger'"
              >
                {{ JSON.parse(row.result_json).interpretation?.label || '无' }}
              </el-tag>
              <span v-else>/</span>
              <el-tooltip v-if="row.doctorNote" :content="`已录入医生意见: ${row.doctorNote}`" placement="top">
                <span style="cursor: pointer; font-size: 14px;">📝</span>
              </el-tooltip>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="duration_seconds" label="用时" width="100">
          <template #default="{ row }">
            {{ Math.floor(row.duration_seconds / 60) }}分{{ row.duration_seconds % 60 }}秒
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180">
          <template #default="{ row }">
            <div style="display: flex; gap: 8px; align-items: center;">
              <el-button type="primary" size="small" @click="viewTestResult(row)">查看报告</el-button>
              <el-button type="danger" size="small" plain @click="deleteHistory(row)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>

  <!-- 批量打印进度提示弹窗 -->
  <el-dialog
    v-model="isPrinting"
    title="批量生成报告 PDF"
    width="420px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
  >
    <div style="text-align: center; padding: 10px 0;">
      <div style="margin-bottom: 15px; font-size: 14px;">
        正在生成第 <strong>{{ currentPrintIndex + 1 }}</strong> / {{ totalToPrint }} 份报告，请稍候...
      </div>
      <el-progress type="circle" :percentage="printProgress" />
      <div style="margin-top: 15px; color: #909399; font-size: 12px;">
        提示：生成过程中请勿关闭或切换页面，以保证渲染质量。
      </div>
    </div>
    <template #footer>
      <div style="text-align: center;">
        <el-button type="danger" @click="cancelPrint = true">取消生成</el-button>
      </div>
    </template>
  </el-dialog>

  <!-- 测评结果对比弹窗 -->
  <el-dialog
    v-model="compareDialogVisible"
    title="测评结果对比"
    width="850px"
    append-to-body
  >
    <template #header>
      <div style="display: flex; justify-content: space-between; align-items: center; width: 95%;">
        <span style="font-size: 16px; font-weight: bold;">测评结果对比</span>
      </div>
    </template>
    <div v-if="compareData" id="compare-report-content" ref="compareContentRef" style="max-height: 65vh; overflow-y: auto; padding: 0 10px;">
      <!-- 用户基本信息 -->
      <div style="border-left: 4px solid #409EFF; padding-left: 10px; margin-bottom: 16px; font-weight: bold;">
        被试：{{ maskName(user?.name) }} | 性别：{{ user?.gender === 'male' ? '男' : '女' }} | 年龄：{{ userAge }}岁
      </div>
      
      <!-- 两次测试基本信息对照 -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
        <el-card shadow="never" class="compare-card compare-card-baseline">
          <template #header><strong>前期测试 (基线)</strong></template>
          <div style="font-size: 13px; line-height: 1.6;">
            <div><strong>测试时间：</strong>{{ new Date(compareData.testA.created_at).toLocaleString() }}</div>
            <div><strong>量表：</strong>{{ compareData.scaleA?.id }} {{ compareData.scaleA?.name }}</div>
            <div><strong>原始分/标准分：</strong>{{ compareData.testA.raw_score.toFixed(1) }} / {{ compareData.testA.std_score !== null ? compareData.testA.std_score.toFixed(1) : '/' }}</div>
            <div><strong>测评结论：</strong>
              <el-tag size="small" type="info">{{ compareData.testA.result?.interpretation?.label || '无' }}</el-tag>
            </div>
            <div style="margin-top: 6px; font-size: 12px;" class="compare-card-note"><strong>医生诊断：</strong>{{ compareData.testA.doctorNote || '无' }}</div>
          </div>
        </el-card>
        
        <el-card shadow="never" class="compare-card compare-card-followup">
          <template #header><strong>后期测试 (跟进)</strong></template>
          <div style="font-size: 13px; line-height: 1.6;">
            <div><strong>测试时间：</strong>{{ new Date(compareData.testB.created_at).toLocaleString() }}</div>
            <div><strong>量表：</strong>{{ compareData.scaleB?.id }} {{ compareData.scaleB?.name }}</div>
            <div><strong>原始分/标准分：</strong>{{ compareData.testB.raw_score.toFixed(1) }} / {{ compareData.testB.std_score !== null ? compareData.testB.std_score.toFixed(1) : '/' }}</div>
            <div><strong>测评结论：</strong>
              <el-tag size="small" type="primary">{{ compareData.testB.result?.interpretation?.label || '无' }}</el-tag>
            </div>
            <div style="margin-top: 6px; font-size: 12px;" class="compare-card-note"><strong>医生诊断：</strong>{{ compareData.testB.doctorNote || '无' }}</div>
          </div>
        </el-card>
      </div>

      <!-- 分数差异统计 -->
      <div style="margin-bottom: 20px; text-align: center;">
        <el-row :gutter="20">
          <el-col :span="12">
            <div class="compare-stat-box">
              <div style="font-size: 12px;" class="compare-stat-label">原始总分变化</div>
              <div style="font-size: 20px; font-weight: bold; margin-top: 4px;" :style="{ color: compareData.scoreDiff > 0 ? '#F56C6C' : compareData.scoreDiff < 0 ? '#67C23A' : (settingsStore.darkMode ? '#ffffff' : '#303133') }">
                {{ compareData.scoreDiff > 0 ? '+' : '' }}{{ compareData.scoreDiff }} 分
                <span style="font-size: 13px; font-weight: normal;">
                  ({{ compareData.scoreDiff > 0 ? '分数上升' : compareData.scoreDiff < 0 ? '分数下降' : '无变化' }})
                </span>
              </div>
            </div>
          </el-col>
          <el-col :span="12">
            <div class="compare-stat-box">
              <div style="font-size: 12px;" class="compare-stat-label">标准总分变化</div>
              <div style="font-size: 20px; font-weight: bold; margin-top: 4px;" :style="{ color: compareData.stdDiff > 0 ? '#F56C6C' : compareData.stdDiff < 0 ? '#67C23A' : (settingsStore.darkMode ? '#ffffff' : '#303133') }">
                {{ compareData.stdDiff > 0 ? '+' : '' }}{{ compareData.stdDiff }} 分
                <span style="font-size: 13px; font-weight: normal;">
                  ({{ compareData.stdDiff > 0 ? '分数上升' : compareData.stdDiff < 0 ? '分数下降' : '无变化' }})
                </span>
              </div>
            </div>
          </el-col>
        </el-row>
      </div>

      <!-- 不同量表时的提示 -->
      <el-alert
        v-if="!compareData.isSameScale"
        title="量表不一致提示"
        description="注意：对比的两次测评使用了不同的量表，因此无法对比各细分维度的分值变化及变化趋势，仅能展示总体标准分及严重度结论的变化。"
        type="warning"
        show-icon
        :closable="false"
        style="margin-bottom: 16px;"
      />

      <!-- 同量表时的详细对比表格与 ECharts 对比图 -->
      <template v-else>
        <!-- 对比图表 -->
        <div class="compare-chart-wrapper">
          <v-chart v-if="compareDialogVisible && compareChartOption" ref="compareChartRef" :option="compareChartOption" style="height: 300px; width: 100%;" autoresize />
        </div>

        <!-- 维度细节表格 -->
        <div style="font-weight: bold; margin-bottom: 8px; font-size: 14px;">各维度分值变化及特征明细：</div>
        <el-table :data="compareData.dimensions" border stripe style="width: 100%; margin-bottom: 16px;">
          <el-table-column prop="name" label="维度名称" min-width="150" />
          <el-table-column label="前期测试得分" align="center" width="130">
            <template #default="{ row }">
              {{ row.scoreA.toFixed(1) }} 分
            </template>
          </el-table-column>
          <el-table-column label="后期测试得分" align="center" width="130">
            <template #default="{ row }">
              {{ row.scoreB.toFixed(1) }} 分
            </template>
          </el-table-column>
          <el-table-column label="差异值 (B - A)" align="center" width="140">
            <template #default="{ row }">
              <span :style="{ color: row.diff > 0 ? '#F56C6C' : row.diff < 0 ? '#67C23A' : '#303133', fontWeight: 'bold' }">
                {{ row.diff > 0 ? '+' : '' }}{{ row.diff }}
                <el-icon v-if="row.diff > 0"><CaretTop /></el-icon>
                <el-icon v-else-if="row.diff < 0"><CaretBottom /></el-icon>
              </span>
            </template>
          </el-table-column>
          <el-table-column label="说明" min-width="150">
            <template #default="{ row }">
              {{ getDimensionDesc(compareData.scaleA, row.name, row.scoreB) }}
            </template>
          </el-table-column>
        </el-table>
      </template>
    </div>
    <template #footer>
      <span class="dialog-footer">
        <el-button type="primary" @click="printCompareReport">
          <el-icon style="margin-right: 4px;"><Printer /></el-icon>
          打印对比报告
        </el-button>
        <el-button @click="compareDialogVisible = false">关闭</el-button>
      </span>
    </template>
  </el-dialog>

  <!-- 隐藏的单页打印模板 (批量打印渲染用) -->
  <div style="position: absolute; left: -9999px; top: 0;" class="no-print">
    <div v-if="printingTestObj && printingScaleObj" class="batch-print-single-page" style="position: relative; width: 794px; height: 1123px; padding: 40px; box-sizing: border-box; background: white; font-family: 'SimSun', 'STSong', serif; color: black; display: flex; flex-direction: column; justify-content: space-between;">
      <!-- 水印遮罩 -->
      <div v-if="settingsStore.watermarkText" :style="watermarkBgStyle"></div>
      
      <div>
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; border-bottom: 1.5px solid black; padding-bottom: 4px; font-size: 11px; margin-bottom: 12px;">
          <span style="font-weight: bold;">{{ settingsStore.unitName || '测评分析机构' }}</span>
          <span style="font-weight: bold;">页码: {{ printingTestObj.pageNumber }} / {{ printingTestObj.totalPages }}</span>
        </div>
        
        <!-- Title -->
        <div style="font-size: 18px; font-weight: bold; text-align: center; margin-top: 10px; margin-bottom: 15px; letter-spacing: 1px;">
          {{ printingScaleObj.id }} {{ printingScaleObj.name }} 结果分析报告
        </div>
        
        <!-- Patient Info -->
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 12px;">
          <tr>
            <td style="padding: 4px 0; font-weight: bold; width: 65px;">被试姓名:</td>
            <td style="padding: 4px 0; border-bottom: 1px solid black; width: 120px;">{{ user?.name }}</td>
            <td style="padding: 4px 0; font-weight: bold; width: 65px; text-align: center;">性别:</td>
            <td style="padding: 4px 0; border-bottom: 1px solid black; width: 80px; text-align: center;">{{ user?.gender === 'male' ? '男' : user?.gender === 'female' ? '女' : '未知' }}</td>
            <td style="padding: 4px 0; font-weight: bold; width: 65px; text-align: center;">年龄:</td>
            <td style="padding: 4px 0; border-bottom: 1px solid black; text-align: center;">{{ printingTestObj.userAge }}岁</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; font-weight: bold;">联系电话:</td>
            <td style="padding: 4px 0; border-bottom: 1px solid black;">{{ user?.contact || '/' }}</td>
            <td style="padding: 4px 0; font-weight: bold; text-align: center;">出生日期:</td>
            <td style="padding: 4px 0; border-bottom: 1px solid black; text-align: center;">{{ user?.birthdate || '/' }}</td>
            <td style="padding: 4px 0; font-weight: bold; text-align: center;">测试用时:</td>
            <td style="padding: 4px 0; border-bottom: 1px solid black; text-align: center;">{{ Math.floor(printingTestObj.duration_seconds / 60) }}分{{ printingTestObj.duration_seconds % 60 }}秒</td>
          </tr>
        </table>
        
        <!-- Basic score card -->
        <div style="border: 1px solid black; padding: 10px; border-radius: 4px; margin-bottom: 12px; background-color: #fafafa;">
          <div style="font-size: 13px; font-weight: bold; margin-bottom: 4px; display: flex; justify-content: space-between;">
            <span>得分总览与结论</span>
            <span>结论：<strong style="color: #409EFF; font-size: 14px;">{{ printingTestObj.result?.interpretation?.label || '正常' }}</strong></span>
          </div>
          <div style="font-size: 12px; line-height: 1.4;">
            原始总分：{{ printingTestObj.raw_score.toFixed(1) }}分 &nbsp;&nbsp;&nbsp;&nbsp;
            标准总分：{{ printingTestObj.std_score !== null ? printingTestObj.std_score.toFixed(1) + '分' : '/' }}
          </div>
          <div style="font-size: 11px; color: #555; margin-top: 6px; line-height: 1.4; border-top: 1px dashed #ccc; padding-top: 4px;">
            结论解释：{{ printingTestObj.result?.interpretation?.description || '无详细结果解释' }}
          </div>
        </div>

        <!-- Dimension table -->
        <div v-if="printingTestObj.result?.dimensionScores && Object.keys(printingTestObj.result.dimensionScores).length > 0" style="margin-bottom: 12px;">
          <div style="font-size: 12px; font-weight: bold; margin-bottom: 4px;">各维度因子得分明细:</div>
          <table style="width: 100%; border-collapse: collapse; font-size: 10px; text-align: center;">
            <thead>
              <tr style="background-color: #f5f7fa; border-top: 1px solid black; border-bottom: 1px solid black;">
                <th style="padding: 3px; border: 1px solid #ddd; text-align: left;">维度名称</th>
                <th style="padding: 3px; border: 1px solid #ddd; width: 80px;">得分</th>
                <th style="padding: 3px; border: 1px solid #ddd; text-align: left;">解释说明</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(val, dimName) in printingTestObj.result.dimensionScores" :key="dimName as string" style="border-bottom: 1px solid #eee;">
                <td style="padding: 3px; border: 1px solid #ddd; text-align: left; font-weight: bold;">{{ dimName }}</td>
                <td style="padding: 3px; border: 1px solid #ddd; font-weight: bold; color: #409EFF;">{{ typeof val === 'number' ? val.toFixed(1) : val }} 分</td>
                <td style="padding: 3px; border: 1px solid #ddd; text-align: left; color: #555;">
                  {{ getDimensionDesc(printingScaleObj, dimName as string, val) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <!-- Doctor Note -->
        <div v-if="printingTestObj.doctorNote" style="border: 1.5px solid black; padding: 8px; border-radius: 4px; background: #fafafa; margin-bottom: 12px;">
          <div style="font-size: 12px; font-weight: bold; border-bottom: 1px solid black; padding-bottom: 4px; margin-bottom: 4px;">👨‍⚕️ 医生临床诊断意见与备注:</div>
          <div style="font-size: 11px; line-height: 1.4; white-space: pre-wrap;">{{ printingTestObj.doctorNote }}</div>
          <div style="text-align: right; font-size: 10px; margin-top: 4px; font-weight: bold;">
            报告医生：{{ printingTestObj.reportDoctor || '/' }}
          </div>
        </div>
      </div>
      
      <div>
        <!-- Disclaimer -->
        <div style="font-size: 9px; color: #666; border-top: 1px solid black; padding-top: 4px; text-align: center; line-height: 1.3;">
          免责声明：本测评报告结果仅供参考，不作为心理/精神疾病的最终临床诊断。
        </div>
        
        <!-- Signatures -->
        <div style="display: flex; justify-content: space-between; font-size: 10px; margin-top: 6px; font-weight: bold;">
          <span>评定日期: {{ new Date(printingTestObj.created_at).toLocaleString() }}</span>
          <span>分析机构盖章及签字: ____________________</span>
        </div>
      </div>
    </div>
  </div>


    <!-- 快速预约弹窗 -->
    <el-dialog
      v-model="apptDialogVisible"
      :title="`为被试 [${user?.name || ''}] 预约测评`"
      width="500px"
      append-to-body
    >
    <el-form :model="apptForm" label-width="auto">
      <el-form-item label="选择量表" required>
        <el-select v-model="apptForm.scaleId" placeholder="请选择要测试的量表" style="width: 100%;">
          <el-option
            v-for="scale in scaleStore.scales"
            :key="scale.id"
            :label="`${scale.id} - ${scale.name}`"
            :value="scale.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="日期" required>
        <el-date-picker
          v-model="apptForm.date"
          type="date"
          placeholder="选择日期"
          value-format="YYYY-MM-DD"
          style="width: 100%;"
        />
      </el-form-item>
      <el-form-item label="时间" required>
        <el-time-picker
          v-model="apptForm.time"
          placeholder="选择时间"
          value-format="HH:mm:ss"
          style="width: 100%;"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="apptDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveAppointment">确认预约</el-button>
      </span>
    </template>
  </el-dialog>
</template>

<style scoped>
.user-history-view {
  max-width: 1000px;
  margin: 0 auto;
  padding: 24px;
}

.page-nav {
  margin-bottom: 20px;
}

.user-info-card {
  margin-bottom: 16px;
  border-radius: 6px;
  border: 1px solid var(--fluent-card-border, #e0e0e0);
}

.info-layout {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 24px;
}

.info-left {
  display: flex;
  align-items: center;
  gap: 20px;
  flex: 1;
}

.info-avatar {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background-color: var(--fluent-accent, #0078d4);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: bold;
}

.info-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  flex: 1;
}

.grid-item {
  display: flex;
  font-size: 14px;
  gap: 8px;
}

.detail-label {
  color: var(--el-text-color-secondary);
  font-weight: 500;
  width: 70px;
}

.detail-val {
  font-weight: 600;
  color: var(--fluent-text-primary);
}

.info-right {
  display: flex;
  gap: 16px;
  align-items: stretch;
  width: 350px;
  border-left: 1px solid var(--el-border-color-light);
  padding-left: 20px;
}

.notes-box {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.notes-title {
  font-size: 13px;
  font-weight: bold;
  color: var(--el-text-color-secondary);
}

.notes-content {
  font-size: 13px;
  color: var(--fluent-text-primary);
  margin: 0;
  line-height: 1.5;
  max-height: 70px;
  overflow-y: auto;
  white-space: pre-wrap;
}

.count-box {
  width: 90px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background-color: var(--el-color-primary-light-9, #f0f7ff);
  border-radius: 6px;
  padding: 8px;
}

.count-num {
  font-size: 28px;
  font-weight: 800;
  color: var(--fluent-accent, #0078d4);
  line-height: 1;
  margin-bottom: 4px;
}

.count-label {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.chart-section-card {
  margin-bottom: 16px;
  border-radius: 6px;
  border: 1px solid var(--fluent-card-border, #e0e0e0);
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chart-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 350px;
}

.summary-cards-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 16px;
}

.summary-card {
  border-radius: 6px;
  text-align: center;
}

.summary-card-inner {
  padding: 8px 0;
}

.summary-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}

.summary-value {
  font-size: 24px;
  font-weight: bold;
  color: var(--fluent-accent, #0078d4);
  line-height: 1.2;
}

.summary-scale-name {
  font-size: 13px;
  color: var(--el-text-color-regular);
  margin-top: 4px;
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 8px;
  line-height: 1.4;
  height: 2.8em; /* 固定两行高度，保持卡片高度整齐 */
}

.summary-value-text {
  font-size: 14px;
  font-weight: bold;
  color: var(--fluent-text-primary);
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  padding: 0 4px;
}

.list-section-card {
  margin-bottom: 24px;
  border-radius: 6px;
  border: 1px solid var(--fluent-card-border, #e0e0e0);
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dark :deep(.el-card) {
  background: var(--app-card, #16213e);
  color: var(--app-text, #e0e0e0);
}

.dark .count-box {
  background-color: rgba(64, 158, 255, 0.15) !important;
}

.dark .count-num {
  color: #66b1ff !important;
}

.dark :deep(.el-table) {
  --el-table-text-color: var(--fluent-text-primary) !important;
  --el-table-header-text-color: var(--fluent-text-primary) !important;
  --el-table-bg-color: transparent !important;
  --el-table-tr-bg-color: transparent !important;
}

/* 测评结果对比弹窗样式 */
.compare-card {
  transition: none !important;
}
.compare-card-baseline {
  background-color: #fafafa !important;
  border-color: #e0e0e0 !important;
}
.compare-card-baseline :deep(.el-card__header) {
  color: #606266 !important;
}
.compare-card-baseline {
  color: #333333 !important;
}
.compare-card-baseline .compare-card-note {
  color: #666666;
}

.compare-card-followup {
  background-color: #f6faff !important;
  border-color: #d9ecff !important;
}
.compare-card-followup :deep(.el-card__header) {
  color: #409EFF !important;
}
.compare-card-followup {
  color: #2c3e50 !important;
}
.compare-card-followup .compare-card-note {
  color: #555555;
}

.compare-stat-box {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 12px;
  background-color: #ffffff;
}
.compare-stat-label {
  color: #909399;
}

.compare-chart-wrapper {
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 16px;
  margin-bottom: 20px;
  background-color: #ffffff;
}

/* 暗色模式适配 */
.dark .compare-card-baseline {
  background-color: rgba(255, 255, 255, 0.05) !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
}
.dark .compare-card-baseline :deep(.el-card__header) {
  color: #cad1d9 !important;
}
.dark .compare-card-baseline {
  color: var(--fluent-text-primary) !important;
}
.dark .compare-card-baseline .compare-card-note {
  color: var(--fluent-text-secondary);
}

.dark .compare-card-followup {
  background-color: rgba(96, 205, 255, 0.1) !important;
  border-color: rgba(96, 205, 255, 0.2) !important;
}
.dark .compare-card-followup :deep(.el-card__header) {
  color: #60cdff !important;
}
.dark .compare-card-followup {
  color: var(--fluent-text-primary) !important;
}
.dark .compare-card-followup .compare-card-note {
  color: var(--fluent-text-secondary);
}

.dark .compare-stat-box {
  border-color: rgba(255, 255, 255, 0.15);
  background-color: rgba(255, 255, 255, 0.02);
}
.dark .compare-stat-label {
  color: var(--fluent-text-secondary);
}

.dark .compare-chart-wrapper {
  border-color: rgba(255, 255, 255, 0.15);
  background-color: rgba(0, 0, 0, 0.15);
}

@media (max-width: 850px) {
  .info-layout {
    flex-direction: column;
  }
  .info-right {
    width: 100%;
    border-left: none;
    border-top: 1px solid var(--el-border-color-light);
    padding-left: 0;
    padding-top: 16px;
  }
  .summary-cards-row {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
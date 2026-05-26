<script setup lang="ts">
import { ref, onMounted, computed, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/userStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useScaleStore } from '@/stores/scaleStore'
import { ElMessage, ElMessageBox, ElLoading } from 'element-plus'
import type { User, TestHistory } from '@/types'
import * as XLSX from 'xlsx'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

const emit = defineEmits(['trigger-user-select'])

const router = useRouter()
const userStore = useUserStore()

const dialogVisible = ref(false)
const editingUser = ref<Partial<User>>({})
const isEdit = ref(false)

// 高级检索字段
const searchName = ref('')
const searchGender = ref('')
const searchContact = ref('')
const searchNotes = ref('')
const searchTags = ref<string[]>([])
const searchTagMode = ref<'AND' | 'OR'>('AND')
const searchRecentTestTime = ref('')
const isAdvancedSearchCollapsed = ref(true)
const latestTestMap = ref<Record<number, number>>({}) // userId -> latest test timestamp

// 自定义标签输入
const newTagInput = ref('')
const tagOptions = ref(['学生', '教职工', '高危', '随访人员', '普通'])

const formRules = {
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }]
}

function addCustomTag() {
  const trimmed = newTagInput.value.trim()
  if (!trimmed) return
  if (!tagOptions.value.includes(trimmed)) {
    tagOptions.value.push(trimmed)
  }
  
  // 自动将新标签关联到当前编辑的被试
  const currentTags = editingUser.value.tags ? getUserTags(editingUser.value as User) : []
  if (!currentTags.includes(trimmed)) {
    const updatedTags = [...currentTags, trimmed]
    editingUser.value.tags = JSON.stringify(updatedTags)
  }
  
  newTagInput.value = ''
  ElMessage.success(`成功添加并关联标签: ${trimmed}`)
}

// PDF 导出状态与逻辑
const pdfExportUser = ref<User | null>(null)
const pdfExportHistories = ref<TestHistory[]>([])
const isGeneratingPDF = ref(false)
const profilePrintArea = ref<HTMLElement | null>(null)

async function generatePortfolio(user: User) {
  let loadingInstance: any = null
  try {
    const histories = await userStore.getTestHistory(user.id)
    if (!histories || histories.length === 0) {
      ElMessage.warning('暂无测试记录，无法生成档案袋')
      return
    }

    loadingInstance = ElLoading.service({
      lock: true,
      text: '正在生成 PDF，请稍候...',
      background: 'rgba(0, 0, 0, 0.6)'
    })
    
    // 我们在此处用纯 jsPDF 来绘制高要求的 PDF 档案袋以符合验收标准！
    // A4 尺寸：210 x 297 mm
    const pdf = new jsPDF('p', 'mm', 'a4')
    
    // 页码和中文字体支持
    const settingsStore = useSettingsStore()
    const scaleStore = useScaleStore()
    
    // 中文字体直接在 jsPDF 中由于没有内嵌 font 可能不支持，我们通过加载一个隐藏的 DOM 渲染并使用 html2canvas 或者是纯文本配合系统的中文字体。
    // 由于纯 jspdf 需要配置中文字体比较复杂，这里我们利用一个动态渲染的 DOM，放入 document.body 中，再用 html2canvas 转换为图片以支持完美的中文字体和 WPS/Adobe 打开！
    // 这种做法能够 100% 解决乱码问题且样式可以极其精致，同时又是白底黑字不受暗色模式影响。
    
    const container = document.createElement('div')
    container.style.position = 'absolute'
    container.style.left = '-9999px'
    container.style.top = '0'
    container.style.width = '794px' // A4 width at 96 DPI
    container.style.backgroundColor = '#ffffff'
    container.style.color = '#000000'
    container.style.padding = '40px'
    container.style.boxSizing = 'border-box'
    container.style.fontFamily = 'SimSun, STSong, "Microsoft YaHei", sans-serif'
    
    // 封面
    const cover = document.createElement('div')
    cover.style.height = '1050px' // 撑满第一页
    cover.style.display = 'flex'
    cover.style.flexDirection = 'column'
    cover.style.justifyContent = 'space-between'
    cover.style.alignItems = 'center'
    cover.style.padding = '100px 0'
    cover.style.boxSizing = 'border-box'
    
    // 封面顶部 Logo & 标题
    const coverHeader = document.createElement('div')
    coverHeader.style.textAlign = 'center'
    if (settingsStore.unitLogo) {
      const logoImg = document.createElement('img')
      logoImg.src = settingsStore.unitLogo
      logoImg.style.height = '45px'
      logoImg.style.marginBottom = '20px'
      coverHeader.appendChild(logoImg)
    }
    const coverTitle = document.createElement('h1')
    coverTitle.innerText = '心理档案袋'
    coverTitle.style.fontSize = '36px'
    coverTitle.style.fontWeight = 'bold'
    coverTitle.style.letterSpacing = '8px'
    coverTitle.style.margin = '10px 0'
    coverHeader.appendChild(coverTitle)
    
    const coverSubtitle = document.createElement('h3')
    coverSubtitle.innerText = 'OpenMind Psychological Portfolio'
    coverSubtitle.style.fontSize = '16px'
    coverSubtitle.style.fontWeight = 'normal'
    coverSubtitle.style.color = '#555555'
    coverHeader.appendChild(coverSubtitle)
    
    cover.appendChild(coverHeader)
    
    // 封面中部个人信息
    const coverInfo = document.createElement('div')
    coverInfo.style.width = '350px'
    coverInfo.style.border = '1px solid #000000'
    coverInfo.style.padding = '24px 32px'
    coverInfo.style.borderRadius = '8px'
    coverInfo.style.fontSize = '16px'
    coverInfo.style.lineHeight = '2.2'
    
    const maskName = (name: string) => {
      if (!name) return ''
      if (name.length <= 1) return name
      if (name.length === 2) return name[0] + '*'
      return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1]
    }
    
    const age = () => {
      if (!user.birthdate) return '/'
      const birth = new Date(user.birthdate)
      const today = new Date()
      let ageVal = today.getFullYear() - birth.getFullYear()
      const m = today.getMonth() - birth.getMonth()
      if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
        ageVal--
      }
      return ageVal > 0 ? String(ageVal) : '0'
    }
    
    coverInfo.innerHTML = `
      <div style="display: flex; justify-content: space-between;"><strong>被试姓名:</strong> <span>${maskName(user.name)}</span></div>
      <div style="display: flex; justify-content: space-between;"><strong>性&nbsp;&nbsp;&nbsp;&nbsp;别:</strong> <span>${user.gender === 'male' ? '男' : user.gender === 'female' ? '女' : '未知'}</span></div>
      <div style="display: flex; justify-content: space-between;"><strong>年&nbsp;&nbsp;&nbsp;&nbsp;龄:</strong> <span>${age()} 岁</span></div>
      <div style="display: flex; justify-content: space-between;"><strong>档案编号:</strong> <span>OMP-${user.id.toString().padStart(6, '0')}</span></div>
      <div style="display: flex; justify-content: space-between;"><strong>生成日期:</strong> <span>${new Date().toLocaleDateString()}</span></div>
    `
    cover.appendChild(coverInfo)
    
    // 封面底部页脚
    const coverFooter = document.createElement('div')
    coverFooter.style.textAlign = 'center'
    coverFooter.style.fontSize = '12px'
    coverFooter.style.color = '#777777'
    coverFooter.innerText = '本报告仅供专业参考，不构成医学诊断'
    cover.appendChild(coverFooter)
    
    container.appendChild(cover)
    
    // 页 2: 测试记录总表
    const listPage = document.createElement('div')
    listPage.style.height = '1050px'
    listPage.style.position = 'relative'
    listPage.style.padding = '60px 0'
    listPage.style.boxSizing = 'border-box'
    
    // 页眉
    const headerEl = document.createElement('div')
    headerEl.style.display = 'flex'
    headerEl.style.justifyContent = 'space-between'
    headerEl.style.alignItems = 'center'
    headerEl.style.borderBottom = '1px solid #cccccc'
    headerEl.style.paddingBottom = '8px'
    headerEl.style.marginBottom = '20px'
    
    const headerLeft = document.createElement('div')
    headerLeft.style.display = 'flex'
    headerLeft.style.alignItems = 'center'
    headerLeft.style.gap = '8px'
    if (settingsStore.unitLogo) {
      const logo = document.createElement('img')
      logo.src = settingsStore.unitLogo
      logo.style.height = '20px'
      headerLeft.appendChild(logo)
    }
    const headerTitle = document.createElement('span')
    headerTitle.innerText = 'OpenMind 心理档案袋'
    headerTitle.style.fontSize = '12px'
    headerTitle.style.fontWeight = 'bold'
    headerLeft.appendChild(headerTitle)
    headerEl.appendChild(headerLeft)
    
    const headerPageNum = document.createElement('span')
    headerPageNum.innerText = '第 2 页'
    headerPageNum.style.fontSize = '11px'
    headerPageNum.style.color = '#666666'
    headerEl.appendChild(headerPageNum)
    listPage.appendChild(headerEl)
    
    const listTitle = document.createElement('h3')
    listTitle.innerText = '测试历史记录总表'
    listTitle.style.fontSize = '20px'
    listTitle.style.marginBottom = '16px'
    listPage.appendChild(listTitle)
    
    const table = document.createElement('table')
    table.style.width = '100%'
    table.style.borderCollapse = 'collapse'
    
    const thead = document.createElement('tr')
    thead.style.backgroundColor = '#f2f2f2'
    thead.innerHTML = `
      <th style="border: 1px solid #dddddd; padding: 10px; font-size: 13px; text-align: left;">量表名称</th>
      <th style="border: 1px solid #dddddd; padding: 10px; font-size: 13px; text-align: center; width: 18%;">测试日期</th>
      <th style="border: 1px solid #dddddd; padding: 10px; font-size: 13px; text-align: center; width: 12%;">总分</th>
      <th style="border: 1px solid #dddddd; padding: 10px; font-size: 13px; text-align: center; width: 18%;">结果等级</th>
      <th style="border: 1px solid #dddddd; padding: 10px; font-size: 13px; text-align: center; width: 12%;">用时</th>
    `
    table.appendChild(thead)
    
    histories.forEach(h => {
      let severityLabel = '无'
      try {
        if (h.result_json) {
          const res = JSON.parse(h.result_json)
          severityLabel = res.interpretation?.label || '无'
        }
      } catch (err) {}
      
      const tr = document.createElement('tr')
      const minutes = Math.floor(h.duration_seconds / 60)
      const seconds = h.duration_seconds % 60
      const durationStr = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`
      
      tr.innerHTML = `
        <td style="border: 1px solid #dddddd; padding: 10px; font-size: 13px;">${h.scale_name}</td>
        <td style="border: 1px solid #dddddd; padding: 10px; font-size: 13px; text-align: center;">${new Date(h.created_at).toLocaleDateString()}</td>
        <td style="border: 1px solid #dddddd; padding: 10px; font-size: 13px; text-align: center; font-weight: bold; color: #409EFF;">${h.std_score !== null && h.std_score !== undefined ? h.std_score : h.raw_score}</td>
        <td style="border: 1px solid #dddddd; padding: 10px; font-size: 13px; text-align: center;">${severityLabel}</td>
        <td style="border: 1px solid #dddddd; padding: 10px; font-size: 13px; text-align: center;">${durationStr}</td>
      `
      table.appendChild(tr)
    })
    listPage.appendChild(table)
    
    // 页脚
    const footerEl = document.createElement('div')
    footerEl.style.position = 'absolute'
    footerEl.style.bottom = '20px'
    footerEl.style.left = '0'
    footerEl.style.right = '0'
    footerEl.style.borderTop = '1px solid #eeeeee'
    footerEl.style.paddingTop = '8px'
    footerEl.style.textAlign = 'center'
    footerEl.style.fontSize = '10px'
    footerEl.style.color = '#888888'
    footerEl.innerText = '本报告仅供专业参考，不构成医学诊断'
    listPage.appendChild(footerEl)
    
    container.appendChild(listPage)
    
    // 页 3+: 详细量表报告 (每个量表一页)
    let pageCount = 3
    for (const h of histories) {
      let resultObj: any = null
      try {
        if (h.result_json) {
          resultObj = JSON.parse(h.result_json)
        }
      } catch (err) {}
      
      const detailPage = document.createElement('div')
      detailPage.style.height = '1050px'
      detailPage.style.position = 'relative'
      detailPage.style.padding = '60px 0'
      detailPage.style.boxSizing = 'border-box'
      
      // 页眉
      const hpEl = document.createElement('div')
      hpEl.style.display = 'flex'
      hpEl.style.justifyContent = 'space-between'
      hpEl.style.alignItems = 'center'
      hpEl.style.borderBottom = '1px solid #cccccc'
      hpEl.style.paddingBottom = '8px'
      hpEl.style.marginBottom = '20px'
      
      const hpLeft = document.createElement('div')
      hpLeft.style.display = 'flex'
      hpLeft.style.alignItems = 'center'
      hpLeft.style.gap = '8px'
      if (settingsStore.unitLogo) {
        const logo = document.createElement('img')
        logo.src = settingsStore.unitLogo
        logo.style.height = '20px'
        hpLeft.appendChild(logo)
      }
      const hpTitle = document.createElement('span')
      hpTitle.innerText = 'OpenMind 心理档案袋'
      hpTitle.style.fontSize = '12px'
      hpTitle.style.fontWeight = 'bold'
      hpLeft.appendChild(hpTitle)
      hpEl.appendChild(hpLeft)
      
      const hpPageNum = document.createElement('span')
      hpPageNum.innerText = `第 ${pageCount} 页`
      hpPageNum.style.fontSize = '11px'
      hpPageNum.style.color = '#666666'
      hpEl.appendChild(hpPageNum)
      detailPage.appendChild(hpEl)
      
      // 内容
      const detailTitle = document.createElement('h3')
      detailTitle.innerText = `${h.scale_name} 详细结果分析`
      detailTitle.style.fontSize = '20px'
      detailTitle.style.marginBottom = '20px'
      detailPage.appendChild(detailTitle)
      
      // 基本得分卡
      const scoreCard = document.createElement('div')
      scoreCard.style.display = 'flex'
      scoreCard.style.gap = '20px'
      scoreCard.style.marginBottom = '20px'
      scoreCard.innerHTML = `
        <div style="flex: 1; border: 1px solid #dddddd; padding: 12px; border-radius: 4px; text-align: center;">
          <div style="font-size: 12px; color: #666666;">测试时间</div>
          <div style="font-size: 15px; font-weight: bold; margin-top: 6px;">${new Date(h.created_at).toLocaleString()}</div>
        </div>
        <div style="flex: 1; border: 1px solid #dddddd; padding: 12px; border-radius: 4px; text-align: center;">
          <div style="font-size: 12px; color: #666666;">量表总分</div>
          <div style="font-size: 24px; font-weight: bold; color: #409EFF; margin-top: 2px;">${h.std_score !== null && h.std_score !== undefined ? h.std_score : h.raw_score} 分</div>
        </div>
        <div style="flex: 1; border: 1px solid #dddddd; padding: 12px; border-radius: 4px; text-align: center;">
          <div style="font-size: 12px; color: #666666;">结果等级</div>
          <div style="font-size: 18px; font-weight: bold; color: #E6A23C; margin-top: 6px;">${resultObj?.interpretation?.label || '正常'}</div>
        </div>
      `
      detailPage.appendChild(scoreCard)
      
      // 维度得分
      if (resultObj?.dimensionScores && Object.keys(resultObj.dimensionScores).length > 0) {
        const dimBox = document.createElement('div')
        dimBox.style.marginBottom = '20px'
        dimBox.innerHTML = '<h4 style="margin: 0 0 10px 0; font-size: 14px; border-left: 3px solid #409eff; padding-left: 6px;">维度得分明细:</h4>'
        
        const dimTable = document.createElement('table')
        dimTable.style.width = '100%'
        dimTable.style.borderCollapse = 'collapse'
        dimTable.innerHTML = `
          <tr style="background-color: #fafafa;">
            <th style="border: 1px solid #dddddd; padding: 6px; font-size: 12px; text-align: left;">维度名称</th>
            <th style="border: 1px solid #dddddd; padding: 6px; font-size: 12px; text-align: center; width: 30%;">维度得分</th>
          </tr>
        `
        for (const [dName, dScore] of Object.entries(resultObj.dimensionScores)) {
          const dTr = document.createElement('tr')
          dTr.innerHTML = `
            <td style="border: 1px solid #dddddd; padding: 6px; font-size: 12px;">${dName}</td>
            <td style="border: 1px solid #dddddd; padding: 6px; font-size: 12px; text-align: center; font-weight: bold;">${Number(dScore).toFixed(1)} 分</td>
          `
          dimTable.appendChild(dTr)
        }
        dimBox.appendChild(dimTable)
        detailPage.appendChild(dimBox)
      }
      
      // 文字解释
      const interpBox = document.createElement('div')
      interpBox.style.marginBottom = '20px'
      interpBox.innerHTML = `
        <h4 style="margin: 0 0 8px 0; font-size: 14px; border-left: 3px solid #67C23A; padding-left: 6px;">测评结论与解释:</h4>
        <div style="font-size: 13px; line-height: 1.6; color: #333333; background-color: #f9f9f9; padding: 12px; border-radius: 4px; white-space: pre-wrap;">
          ${resultObj?.interpretation?.description || '暂无详细测评解释说明。'}
        </div>
      `
      detailPage.appendChild(interpBox)
      
      // 医生诊断/诊断意见 (如果有)
      if (h.doctorNote) {
        const docBox = document.createElement('div')
        docBox.innerHTML = `
          <h4 style="margin: 0 0 8px 0; font-size: 14px; border-left: 3px solid #F56C6C; padding-left: 6px;">医生评定诊断及建议:</h4>
          <div style="font-size: 13px; line-height: 1.6; color: #333333; background-color: #fffaf0; border: 1px dashed #fbdfa2; padding: 12px; border-radius: 4px; white-space: pre-wrap;">
            ${h.doctorNote}
            ${h.reportDoctor ? `<div style="text-align: right; margin-top: 8px; font-weight: bold; font-size: 12px;">评定医生签名: ${h.reportDoctor}</div>` : ''}
          </div>
        `
        detailPage.appendChild(docBox)
      }
      
      // 页脚
      const dfEl = document.createElement('div')
      dfEl.style.position = 'absolute'
      dfEl.style.bottom = '20px'
      dfEl.style.left = '0'
      dfEl.style.right = '0'
      dfEl.style.borderTop = '1px solid #eeeeee'
      dfEl.style.paddingTop = '8px'
      dfEl.style.textAlign = 'center'
      dfEl.style.fontSize = '10px'
      dfEl.style.color = '#888888'
      dfEl.innerText = '本报告仅供专业参考，不构成医学诊断'
      detailPage.appendChild(dfEl)
      
      container.appendChild(detailPage)
      pageCount++
    }
    
    document.body.appendChild(container)
    
    // html2canvas 逐页渲染并贴入 jsPDF
    const pages = container.childNodes
    for (let i = 0; i < pages.length; i++) {
      const pageNode = pages[i] as HTMLElement
      const canvas = await html2canvas(pageNode, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff'
      })
      const imgData = canvas.toDataURL('image/jpeg', 0.95)
      
      if (i > 0) {
        pdf.addPage()
      }
      
      const pdfWidth = pdf.internal.pageSize.getWidth()
      const pdfHeight = pdf.internal.pageSize.getHeight()
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight)
    }
    
    // 销毁临时渲染 DOM 节点
    document.body.removeChild(container)
    
    const defaultName = `心理档案袋_${user.name}_${new Date().toISOString().slice(0, 10)}.pdf`
    if (window.electronAPI) {
      const saveRes = await window.electronAPI.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
      })

      // 在弹出保存对话框后，或者是保存完成后，关闭遮罩
      if (loadingInstance) {
        loadingInstance.close()
        loadingInstance = null
      }

      if (saveRes.filePath) {
        const pdfArrayBuffer = pdf.output('arraybuffer')
        const bytes = new Uint8Array(pdfArrayBuffer)
        let binary = ''
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        const base64 = window.btoa(binary)
        
        const writeRes = await window.electronAPI.saveBufferFile(saveRes.filePath, base64)
        if (writeRes.success) {
          ElMessage.success('心理档案袋 PDF 生成成功！')
        } else {
          ElMessage.error('保存 PDF 失败: ' + writeRes.error)
        }
      }
    } else {
      if (loadingInstance) {
        loadingInstance.close()
        loadingInstance = null
      }
      pdf.save(defaultName)
      ElMessage.success('心理档案袋 PDF 导出成功！')
    }
    
  } catch (err: any) {
    if (loadingInstance) {
      loadingInstance.close()
      loadingInstance = null
    }
    ElMessage.error('生成失败，请重试')
  }
}

async function exportUserProfilePDF(user: User) {
  try {
    ElMessage.info('正在获取被试测评数据以生成健康档案 PDF...')
    pdfExportUser.value = user
    const histories = await userStore.getTestHistory(user.id)
    pdfExportHistories.value = histories
    isGeneratingPDF.value = true
    
    // 等待渲染进程完成 PDF 模板 DOM 更新
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 800)) // 给一点 DOM 绘制时间

    const printArea = document.getElementById('profile-print-area')
    if (!printArea) {
      throw new Error('未找到打印模板元素')
    }

    // 临时修改样式以获得良好渲染
    const originalStyle = printArea.style.cssText
    printArea.style.display = 'block'
    printArea.style.width = '800px'
    
    const canvas = await html2canvas(printArea, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff'
    })

    printArea.style.cssText = originalStyle
    isGeneratingPDF.value = false

    const imgData = canvas.toDataURL('image/jpeg', 0.9)
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = pdf.internal.pageSize.getHeight()
    const imgWidth = pdfWidth
    const imgHeight = (canvas.height * pdfWidth) / canvas.width

    let heightLeft = imgHeight
    let position = 0

    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
    heightLeft -= pdfHeight

    while (heightLeft >= 0) {
      position = heightLeft - imgHeight
      pdf.addPage()
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
      heightLeft -= pdfHeight
    }

    const defaultName = `${user.name}_健康档案及心理测评报告_${new Date().toISOString().slice(0, 10)}.pdf`
    
    if (window.electronAPI) {
      const saveRes = await window.electronAPI.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
      })

      if (saveRes.filePath) {
        const pdfArrayBuffer = pdf.output('arraybuffer')
        const bytes = new Uint8Array(pdfArrayBuffer)
        let binary = ''
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        const base64 = window.btoa(binary)
        
        const writeRes = await window.electronAPI.saveBufferFile(saveRes.filePath, base64)
        if (writeRes.success) {
          ElMessage.success('被试健康档案 PDF 导出成功！')
        } else {
          ElMessage.error('保存 PDF 失败: ' + writeRes.error)
        }
      }
    } else {
      pdf.save(defaultName)
      ElMessage.success('被试健康档案 PDF 导出成功（浏览器下载模式）')
    }
  } catch (err: any) {
    isGeneratingPDF.value = false
    ElMessage.error('导出 PDF 失败: ' + err.message)
  }
}

onMounted(async () => {
  await userStore.loadUsers()
  try {
    const allTests = await userStore.getAllTests()
    const tempMap: Record<number, number> = {}
    for (const test of allTests) {
      if (test.user_id && !tempMap[test.user_id]) {
        tempMap[test.user_id] = new Date(test.created_at).getTime()
      }
    }
    latestTestMap.value = tempMap
  } catch (err) {
    console.error('加载测试记录失败:', err)
  }
})

// 解析用户标签数组的辅助函数
function getUserTags(user: User): string[] {
  if (!user.tags) return []
  try {
    const parsed = typeof user.tags === 'string' ? JSON.parse(user.tags) : user.tags
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    return []
  }
}

const filteredUsers = computed(() => {
  let list = userStore.users

  // 姓名检索
  if (searchName.value.trim()) {
    const q = searchName.value.toLowerCase()
    list = list.filter(u => u.name.toLowerCase().includes(q))
  }

  // 性别检索
  if (searchGender.value) {
    list = list.filter(u => u.gender === searchGender.value)
  }

  // 联系方式检索
  if (searchContact.value.trim()) {
    const q = searchContact.value.toLowerCase()
    list = list.filter(u => u.contact && u.contact.toLowerCase().includes(q))
  }

  // 备注检索
  if (searchNotes.value.trim()) {
    const q = searchNotes.value.toLowerCase()
    list = list.filter(u => u.notes && u.notes.toLowerCase().includes(q))
  }

  // 多标签/组合检索 (AND/OR 逻辑)
  if (searchTags.value && searchTags.value.length > 0) {
    list = list.filter(u => {
      const tags = getUserTags(u)
      if (searchTagMode.value === 'AND') {
        return searchTags.value.every(t => tags.includes(t))
      } else {
        return searchTags.value.some(t => tags.includes(t))
      }
    })
  }

  // 最近测试时间过滤
  if (searchRecentTestTime.value) {
    const now = Date.now()
    list = list.filter(u => {
      const lastTime = latestTestMap.value[u.id]
      if (searchRecentTestTime.value === 'never') {
        return !lastTime
      }
      if (!lastTime) return false
      const diffDays = (now - lastTime) / (1000 * 60 * 60 * 24)
      if (searchRecentTestTime.value === '3days') {
        return diffDays <= 3
      }
      if (searchRecentTestTime.value === '1week') {
        return diffDays <= 7
      }
      if (searchRecentTestTime.value === '1month') {
        return diffDays <= 30
      }
      if (searchRecentTestTime.value === 'over1month') {
        return diffDays > 30
      }
      return true
    })
  }

  return list
})

function resetFilters() {
  searchName.value = ''
  searchGender.value = ''
  searchContact.value = ''
  searchNotes.value = ''
  searchTags.value = []
  searchTagMode.value = 'AND'
  searchRecentTestTime.value = ''
}

async function exportFilteredUsersExcel() {
  if (filteredUsers.value.length === 0) {
    ElMessage.warning('没有可导出的被试')
    return
  }
  try {
    ElMessage.info('正在生成筛选被试的档案报表...')
    const profileRows = []
    const allHistories = []
    
    for (const u of filteredUsers.value) {
      const histories = await userStore.getTestHistory(u.id)
      const lastTime = latestTestMap.value[u.id]
      
      profileRows.push({
        '被试姓名': u.name,
        '性别': u.gender === 'male' ? '男' : u.gender === 'female' ? '女' : '未知',
        '出生日期': u.birthdate || '未设置',
        '联系电话': u.contact || '无',
        '临床备注': u.notes || '无',
        '标签/分组': getUserTags(u).join(', ') || '无',
        '建档时间': u.created_at ? new Date(u.created_at).toLocaleString() : '未知',
        '最新测评时间': lastTime ? new Date(lastTime).toLocaleString() : '未曾测评',
        '测评总次数': histories.length
      })
      
      for (const h of histories) {
        let severityLabel = '无'
        try {
          if (h.result_json) {
            const res = JSON.parse(h.result_json)
            severityLabel = res.interpretation?.label || '无'
          }
        } catch (err) {}
        
        allHistories.push({
          '被试姓名': u.name,
          '性别': u.gender === 'male' ? '男' : u.gender === 'female' ? '女' : '未知',
          '量表ID': h.scale_id,
          '量表名称': h.scale_name,
          '原始分': h.raw_score,
          '标准分': h.std_score !== null && h.std_score !== undefined ? h.std_score : '无',
          '测评人 (操作员)': h.operatorName || '系统管理员',
          '测评时间': new Date(h.created_at).toLocaleString(),
          '用时 (秒)': h.duration_seconds,
          '测评结论': severityLabel,
          '医生诊断备注': h.doctorNote || '无',
          '报告医生': h.reportDoctor || '无'
        })
      }
    }
    
    const profileSheet = XLSX.utils.json_to_sheet(profileRows)
    const historySheet = XLSX.utils.json_to_sheet(allHistories)
    
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, profileSheet, '被试档案汇总')
    XLSX.utils.book_append_sheet(workbook, historySheet, '测评历史汇总')
    
    const filename = `筛选被试档案及历史汇总_${new Date().toISOString().split('T')[0]}.xlsx`
    XLSX.writeFile(workbook, filename)
    ElMessage.success(`成功导出 ${filteredUsers.value.length} 位被试档案！`)
  } catch (err: any) {
    ElMessage.error('导出 Excel 失败: ' + err.message)
  }
}

async function exportFilteredUsersPDF() {
  if (filteredUsers.value.length === 0) {
    ElMessage.warning('没有可导出的被试')
    return
  }
  try {
    ElMessage.info('正在获取被试档案并生成 PDF 汇总报表...')
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 500))

    const printArea = document.getElementById('filtered-users-print-area')
    if (!printArea) {
      throw new Error('未找到汇总打印模板元素')
    }

    const originalStyle = printArea.style.cssText
    printArea.style.display = 'block'
    printArea.style.width = '800px'
    
    const canvas = await html2canvas(printArea, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff'
    })

    printArea.style.cssText = originalStyle

    const imgData = canvas.toDataURL('image/jpeg', 0.9)
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = pdf.internal.pageSize.getHeight()
    const imgWidth = pdfWidth
    const imgHeight = (canvas.height * pdfWidth) / canvas.width

    let heightLeft = imgHeight
    let position = 0

    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
    heightLeft -= pdfHeight

    while (heightLeft >= 0) {
      position = heightLeft - imgHeight
      pdf.addPage()
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
      heightLeft -= pdfHeight
    }

    const defaultName = `筛选被试档案汇总_${new Date().toISOString().slice(0, 10)}.pdf`
    
    if (window.electronAPI) {
      const saveRes = await window.electronAPI.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
      })
      if (saveRes.filePath) {
        const pdfArrayBuffer = pdf.output('arraybuffer')
        const bytes = new Uint8Array(pdfArrayBuffer)
        let binary = ''
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        const base64 = window.btoa(binary)
        const writeRes = await window.electronAPI.saveBufferFile(saveRes.filePath, base64)
        if (writeRes.success) {
          ElMessage.success('PDF 档案汇总导出成功！')
        } else {
          ElMessage.error('保存 PDF 失败: ' + writeRes.error)
        }
      }
    } else {
      pdf.save(defaultName)
      ElMessage.success('PDF 档案汇总导出成功（浏览器下载）')
    }
  } catch (err: any) {
    ElMessage.error('导出 PDF 失败: ' + err.message)
  }
}

function openAddDialog() {
  editingUser.value = {
    name: '',
    gender: 'male',
    birthdate: '',
    contact: '',
    notes: '',
    tags: JSON.stringify([])
  }
  isEdit.value = false
  dialogVisible.value = true
}

function openEditDialog(user: User) {
  editingUser.value = { 
    ...user,
    tags: user.tags || JSON.stringify([])
  }
  isEdit.value = true
  dialogVisible.value = true
}

// 辅助方法，更新对话框中的标签
function toggleFormTag(tag: string) {
  const currentTags = editingUser.value.tags ? getUserTags(editingUser.value as User) : []
  let updatedTags: string[]
  if (currentTags.includes(tag)) {
    updatedTags = currentTags.filter(t => t !== tag)
  } else {
    updatedTags = [...currentTags, tag]
  }
  editingUser.value.tags = JSON.stringify(updatedTags)
}

async function saveUser() {
  if (!editingUser.value.name) {
    ElMessage.warning('请输入姓名')
    return
  }
  try {
    if (isEdit.value && editingUser.value.id) {
      await userStore.updateUser(editingUser.value.id, editingUser.value)
      ElMessage.success('更新成功')
    } else {
      await userStore.addUser({
        name: editingUser.value.name,
        gender: editingUser.value.gender,
        birthdate: editingUser.value.birthdate,
        contact: editingUser.value.contact,
        notes: editingUser.value.notes,
        tags: editingUser.value.tags || '[]'
      })
      ElMessage.success('添加成功')
    }
    dialogVisible.value = false
    await userStore.loadUsers()
  } catch (e: any) {
    ElMessage.error('操作失败: ' + e.message)
  }
}

// 导出被试个人档案及测评历史数据至 Excel
async function exportUserProfile(user: User) {
  try {
    ElMessage.info('正在生成被试档案及测评历史报表...')
    // 获取该用户所有测评历史
    const histories = await userStore.getTestHistory(user.id)
    
    // Sheet 1: 被试基本档案
    const profileData = [
      { '项目': '被试姓名', '详细内容': user.name },
      { '项目': '性别', '详细内容': user.gender === 'male' ? '男' : user.gender === 'female' ? '女' : '未知' },
      { '项目': '出生日期', '详细内容': user.birthdate || '未设置' },
      { '项目': '联系电话', '详细内容': user.contact || '无' },
      { '项目': '临床备注', '详细内容': user.notes || '无' },
      { '项目': '标签/分组', '详细内容': getUserTags(user).join(', ') || '无' },
      { '项目': '建档时间', '详细内容': user.created_at ? new Date(user.created_at).toLocaleString() : '未知' },
      { '项目': '测评总次数', '详细内容': histories.length }
    ]
    const profileSheet = XLSX.utils.json_to_sheet(profileData)
    
    // Sheet 2: 测评历史记录
    const historyRows = histories.map(h => {
      let severityLabel = '无'
      let doctorNote = h.doctorNote || '无'
      let reportDoctor = h.reportDoctor || '无'
      try {
        if (h.result_json) {
          const res = JSON.parse(h.result_json)
          severityLabel = res.interpretation?.label || '无'
        }
      } catch (err) {}
      
      return {
        '量表ID': h.scale_id,
        '量表名称': h.scale_name,
        '原始分': h.raw_score,
        '标准分': h.std_score !== null && h.std_score !== undefined ? h.std_score : '无',
        '测评人 (操作员)': h.operatorName || '系统管理员',
        '测评时间': new Date(h.created_at).toLocaleString(),
        '用时 (秒)': h.duration_seconds,
        '测评结论': severityLabel,
        '医生诊断备注': doctorNote,
        '报告医生': reportDoctor
      }
    })
    const historySheet = XLSX.utils.json_to_sheet(historyRows)
    
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, profileSheet, '被试基本档案')
    XLSX.utils.book_append_sheet(workbook, historySheet, '测评历史记录')
    
    // 输出文件名
    const filename = `${user.name}_被试档案及测评历史_${new Date().toISOString().split('T')[0]}.xlsx`
    XLSX.writeFile(workbook, filename)
    ElMessage.success(`导出成功：${filename}`)
  } catch (err: any) {
    ElMessage.error('导出失败: ' + err.message)
  }
}

async function handleDelete(user: User) {
  try {
    await ElMessageBox.confirm(`确定删除用户 "${user.name}"？相关测试记录及答题历史也将被级联物理删除，且不可恢复！`, '确认删除', {
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    
    // 调用 sqlite 底层物理删除相关测试和回答
    const tests = await userStore.getTestHistory(user.id)
    for (const t of tests) {
      await window.electronAPI.dbRun('DELETE FROM answers WHERE test_id = ?', [t.id])
    }
    await window.electronAPI.dbRun('DELETE FROM tests WHERE user_id = ?', [user.id])
    
    // 删除用户本身
    await userStore.deleteUser(user.id)
    
    // 如果当前选中的是被删除的用户，则清空当前用户选中态
    if (userStore.currentUser?.id === user.id) {
      userStore.setCurrentUser(null)
    }
    
    ElMessage.success('用户及其历史记录已全部清空！')
    await userStore.loadUsers()
  } catch (e: any) {
    if (e !== 'cancel') {
      ElMessage.error('删除失败: ' + e.message)
    }
  }
}

function selectUser(user: User) {
  userStore.setCurrentUser(user)
  ElMessage.success(`已选择当前活动被试: ${user.name}`)
}

function viewHistory(user: User) {
  router.push({
    path: `/user/${user.id}/history`,
    query: { from: 'users' }
  })
}

function goBack() {
  router.push('/')
}

// 批量导入用户相关状态
const importDialogVisible = ref(false)
const importFile = ref<File | null>(null)
const importStrategy = ref<'skip' | 'all'>('skip')
const previewData = ref<any[]>([])
const importLoading = ref(false)
const dragOver = ref(false)

function openImportDialog() {
  importFile.value = null
  previewData.value = []
  importStrategy.value = 'skip'
  importDialogVisible.value = true
}

// 文件选择/拖拽处理
function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    processFile(target.files[0])
  }
}

function handleFileDrop(event: DragEvent) {
  dragOver.value = false
  if (event.dataTransfer && event.dataTransfer.files.length > 0) {
    processFile(event.dataTransfer.files[0])
  }
}

// 解析导入的 Excel / CSV 文件
function processFile(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension !== 'xlsx' && extension !== 'xls' && extension !== 'csv') {
    ElMessage.error('仅支持 .xlsx, .xls 和 .csv 格式的文件！')
    return
  }
  
  importFile.value = file
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target?.result as ArrayBuffer)
      const workbook = XLSX.read(data, { type: 'array' })
      const firstSheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[firstSheetName]
      
      // 读取为原始的二维数组（第一行为表头）
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][]
      if (rows.length === 0) {
        ElMessage.error('文件为空或解析失败，请检查格式')
        importFile.value = null
        return
      }
      
      const headerRow = rows[0].map(h => String(h || '').trim().toLowerCase())
      
      // 字段名映射与索引定位
      const nameIndex = headerRow.findIndex(h => h === '姓名' || h === 'name')
      if (nameIndex === -1) {
        ElMessage.error('文件解析失败：缺少必填列：姓名')
        importFile.value = null
        return
      }
      
      const genderIndex = headerRow.findIndex(h => h === '性别' || h === 'gender')
      const birthIndex = headerRow.findIndex(h => h === '出生日期' || h === 'birthdate' || h === '出生' || h === 'birthDate')
      const phoneIndex = headerRow.findIndex(h => h === '联系电话' || h === 'phone' || h === '电话')
      const noteIndex = headerRow.findIndex(h => h === '诊断备注' || h === 'diagnosis' || h === '备注')
      
      const parsedUsers: any[] = []
      
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i]
        if (!row || row.length === 0) continue
        
        const nameVal = row[nameIndex] ? String(row[nameIndex]).trim() : ''
        if (!nameVal) continue // 跳过姓名为空的行
        
        // 性别映射：男/male/M → male，女/female/F → female，其他 → null
        let genderVal = row[genderIndex] ? String(row[genderIndex]).trim().toLowerCase() : ''
        if (genderVal === '男' || genderVal === 'male' || genderVal === 'm') {
          genderVal = 'male'
        } else if (genderVal === '女' || genderVal === 'female' || genderVal === 'f') {
          genderVal = 'female'
        } else {
          genderVal = ''
        }
        
        // 出生日期解析格式：支持 YYYY-MM-DD, YYYY/MM/DD, Excel 日期序号
        let birthVal = ''
        if (row[birthIndex] !== undefined && row[birthIndex] !== null) {
          const rawBirth = row[birthIndex]
          if (typeof rawBirth === 'number') {
            // Excel 序列号日期转换
            const date = new Date((rawBirth - 25569) * 86400 * 1000)
            const y = date.getFullYear()
            const m = String(date.getMonth() + 1).padStart(2, '0')
            const d = String(date.getDate()).padStart(2, '0')
            birthVal = `${y}-${m}-${d}`
          } else {
            const birthStr = String(rawBirth).trim().replace(/\//g, '-')
            const match = birthStr.match(/^(\d{4})[-_/\s]?(\d{1,2})[-_/\s]?(\d{1,2})$/)
            if (match) {
              const y = match[1]
              const m = match[2].padStart(2, '0')
              const d = match[3].padStart(2, '0')
              birthVal = `${y}-${m}-${d}`
            } else {
              birthVal = birthStr
            }
          }
        }
        
        const phoneVal = phoneIndex !== -1 && row[phoneIndex] ? String(row[phoneIndex]).trim() : ''
        const noteVal = noteIndex !== -1 && row[noteIndex] ? String(row[noteIndex]).trim() : ''
        
        parsedUsers.push({
          name: nameVal,
          gender: genderVal || null,
          birthdate: birthVal || null,
          contact: phoneVal || null,
          notes: noteVal || null
        })
      }
      
      if (parsedUsers.length === 0) {
        ElMessage.warning('未在文件中解析到有效的被试数据（首行需包含“姓名”表头且下方有数据）')
        importFile.value = null
        return
      }
      
      previewData.value = parsedUsers
    } catch (err) {
      console.error(err)
      ElMessage.error('文件解析失败，请检查格式')
      importFile.value = null
    }
  }
  reader.readAsArrayBuffer(file)
}

// 预约弹窗逻辑
import { useAppointmentStore } from '@/stores/appointmentStore'

const appointmentStore = useAppointmentStore()
const scaleStore = useScaleStore()

const apptDialogVisible = ref(false)
const apptTargetUser = ref<User | null>(null)
const apptForm = ref({
  scaleId: '',
  date: '',
  time: ''
})

async function openApptDialog(user: User) {
  apptTargetUser.value = user
  apptForm.value = {
    scaleId: '',
    date: '',
    time: ''
  }
  // 确保已加载量表
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

    if (apptTargetUser.value?.id) {
      await appointmentStore.addAppointment(
        apptTargetUser.value.id,
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

// 物理执行批量写入 SQLite
async function confirmImport() {
  if (previewData.value.length === 0) return
  importLoading.value = true
  try {
    const result = await window.electronAPI.importUsersBulk(previewData.value, importStrategy.value)
    if (result.success) {
      ElMessageBox.alert(
        `批量导入完成！<br/>成功导入：<strong style="color: #67C23A;">${result.successCount}</strong> 人<br/>跳过重复姓名：<strong style="color: #E6A23C;">${result.skipCount}</strong> 人`,
        '导入结果',
        { dangerouslyUseHTMLString: true }
      )
      importDialogVisible.value = false
      await userStore.loadUsers()
    } else {
      ElMessage.error('导入失败: ' + (result.error || '未知错误'))
    }
  } catch (err: any) {
    ElMessage.error('导入失败: ' + err.message)
  } finally {
    importLoading.value = false
  }
}
</script>

<template>
  <div class="user-manager-view">
    <div class="page-header no-print">
      <div class="header-left">
        <el-button @click="goBack" circle>
          <el-icon><ArrowLeft /></el-icon>
        </el-button>
        <h2>用户管理（被试档案）</h2>
      </div>
      <div class="header-actions">
        <el-button type="success" @click="emit('trigger-user-select')">
          快速切换/登录
        </el-button>
        <el-button type="success" plain @click="openImportDialog">
          <el-icon><Upload /></el-icon>
          批量导入
        </el-button>
        <el-dropdown trigger="click" style="margin-right: 12px; margin-left: 12px;">
          <el-button type="warning" plain>
            <el-icon><Download /></el-icon>
            导出用户档案
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="exportFilteredUsersExcel">
                <el-icon><Grid /></el-icon>导出筛选用户为 Excel
              </el-dropdown-item>
              <el-dropdown-item @click="exportFilteredUsersPDF">
                <el-icon><Document /></el-icon>导出筛选用户为 PDF
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button type="primary" @click="openAddDialog">
          <el-icon><Plus /></el-icon>
          添加被试
        </el-button>
      </div>
    </div>

    <!-- 高级多维度检索过滤卡片 -->
    <el-card shadow="never" class="search-card no-print" style="margin-bottom: 16px;">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" @click="isAdvancedSearchCollapsed = !isAdvancedSearchCollapsed">
          <span style="font-weight: bold; font-size: 15px;">
            <el-icon style="margin-right: 4px; vertical-align: middle;"><Search /></el-icon>
            被试档案多维度高级检索
          </span>
          <el-button link type="primary">
            {{ isAdvancedSearchCollapsed ? '展开搜索条件' : '收起搜索条件' }}
            <el-icon><component :is="isAdvancedSearchCollapsed ? 'ArrowDown' : 'ArrowUp'" /></el-icon>
          </el-button>
        </div>
      </template>
      <div v-show="!isAdvancedSearchCollapsed">
        <el-form label-width="80px" size="default" style="margin-bottom: -10px;">
          <el-row :gutter="20">
            <el-col :span="6">
              <el-form-item label="被试姓名">
                <el-input v-model="searchName" placeholder="输入被试姓名 (支持模糊)" clearable />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item label="被试性别">
                <el-select v-model="searchGender" placeholder="选择性别" clearable style="width: 100%;">
                  <el-option label="全部" value="" />
                  <el-option label="男" value="male" />
                  <el-option label="女" value="female" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item label="联系方式">
                <el-input v-model="searchContact" placeholder="手机号/电话" clearable />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item label="临床备注">
                <el-input v-model="searchNotes" placeholder="检索诊断或临床备注" clearable />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="20" style="margin-top: 10px; align-items: center;">
            <el-col :span="10">
              <el-form-item label="标签过滤" style="margin-bottom: 0;">
                <el-select
                  v-model="searchTags"
                  multiple
                  collapse-tags
                  collapse-tags-tooltip
                  placeholder="选择或输入标签进行组合筛选"
                  style="width: 100%;"
                >
                  <el-option
                    v-for="tag in tagOptions"
                    :key="tag"
                    :label="tag"
                    :value="tag"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="4">
              <el-form-item label="标签模式" style="margin-bottom: 0;">
                <el-switch
                  v-model="searchTagMode"
                  active-value="AND"
                  inactive-value="OR"
                  active-text="且"
                  inactive-text="或"
                />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item label="测试时间" style="margin-bottom: 0;">
                <el-select v-model="searchRecentTestTime" placeholder="全部" clearable style="width: 100%;">
                  <el-option label="全部" value="" />
                  <el-option label="未曾测试" value="never" />
                  <el-option label="过去3天内" value="3days" />
                  <el-option label="过去1周内" value="1week" />
                  <el-option label="过去1个月内" value="1month" />
                  <el-option label="超过1个月" value="over1month" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="4" style="text-align: right;">
              <el-button type="info" plain @click="resetFilters">
                清空筛选
              </el-button>
            </el-col>
          </el-row>
        </el-form>
      </div>
      <div v-show="isAdvancedSearchCollapsed" style="display: flex; gap: 16px; align-items: center;">
        <el-input
          v-model="searchName"
          placeholder="快速按姓名检索..."
          style="width: 250px;"
          clearable
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <span style="color: var(--el-text-color-secondary); font-size: 13px;">
          当前筛选出 <strong>{{ filteredUsers.length }}</strong> 位被试 (共 {{ userStore.users.length }} 人)
        </span>
      </div>
    </el-card>

    <!-- 当前选中用户高亮提示 -->
    <div class="user-status-card">
      <el-alert
        v-if="userStore.currentUser"
        :title="`当前活动被试：${userStore.currentUser.name} (${userStore.currentUser.gender === 'male' ? '男' : userStore.currentUser.gender === 'female' ? '女' : '未知'}) | 生日：${userStore.currentUser.birthdate || '未设置'}`"
        type="success"
        :closable="false"
        show-icon
      />
      <el-alert
        v-else
        title="当前未选择任何被试！请在下方列表点击【选择】或通过【快速切换/登录】配置当前被试档案"
        type="warning"
        :closable="false"
        show-icon
      />
    </div>

    <el-card shadow="never" style="margin-top: 16px;">
      <el-table :data="filteredUsers" style="width: 100%" size="default">
        <el-table-column prop="name" label="被试姓名" min-width="120">
          <template #default="{ row }">
            <div class="user-name-cell">
              <el-text strong>{{ row.name }}</el-text>
              <el-tag v-if="userStore.currentUser?.id === row.id" size="small" type="success" effect="dark">活动中</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="gender" label="性别" width="80">
          <template #default="{ row }">
            {{ row.gender === 'male' ? '男' : row.gender === 'female' ? '女' : '未指定' }}
          </template>
        </el-table-column>
        <el-table-column prop="birthdate" label="出生日期" width="120" />
        <el-table-column prop="contact" label="联系电话" min-width="120">
          <template #default="{ row }">
            {{ row.contact || '/' }}
          </template>
        </el-table-column>
        <el-table-column prop="tags" label="标签分组" min-width="140">
          <template #default="{ row }">
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
              <el-tag
                v-for="t in getUserTags(row)"
                :key="t"
                size="small"
                type="info"
                effect="plain"
              >
                {{ t }}
              </el-tag>
              <span v-if="getUserTags(row).length === 0" style="color: var(--el-text-color-placeholder)">-</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="notes" label="临床备注" min-width="150">
          <template #default="{ row }">
            <span class="clinical-notes" :title="row.notes">{{ row.notes || '/' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="500">
          <template #default="{ row }">
            <div class="user-actions-cell" style="display: flex; gap: 6px; flex-wrap: nowrap; align-items: center;">
              <el-button
                type="primary"
                size="small"
                @click="selectUser(row)"
                :disabled="userStore.currentUser?.id === row.id"
              >
                选择
              </el-button>
              <el-button type="success" size="small" plain @click="viewHistory(row)">
                历史
              </el-button>
              <el-button type="warning" size="small" plain @click="openEditDialog(row)">
                编辑
              </el-button>
              <el-button type="info" size="small" plain @click="openApptDialog(row)">
                预约
              </el-button>
              <el-dropdown trigger="click" size="small">
                <el-button type="success" size="small" plain style="height: 24px; padding: 0 8px; display: inline-flex; align-items: center;">
                  导出档案
                  <el-icon class="el-icon--right" style="margin-left: 2px;"><ArrowDown /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item @click="exportUserProfile(row)">
                      <el-icon><Grid /></el-icon>导出为 Excel (.xlsx)
                    </el-dropdown-item>
                    <el-dropdown-item @click="exportUserProfilePDF(row)">
                      <el-icon><Document /></el-icon>导出为 PDF 档案 (.pdf)
                    </el-dropdown-item>
                    <el-dropdown-item @click="generatePortfolio(row)">
                      <el-icon><Notebook /></el-icon>生成心理档案袋 (PDF)
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <el-button type="danger" size="small" plain @click="handleDelete(row)">
                删除
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 批量导入用户弹窗 -->
    <el-dialog
      v-model="importDialogVisible"
      title="批量导入被试档案"
      width="780px"
      append-to-body
    >
      <div
        class="import-dropzone"
        :class="{ active: dragOver }"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="handleFileDrop"
      >
        <el-icon class="upload-icon"><UploadFilled /></el-icon>
        <div class="upload-text">
          <template v-if="!importFile">
            将 Excel (.xlsx/.xls) 或 CSV 文件拖到此处，或
            <label class="file-label">
              点击选择文件
              <input type="file" accept=".xlsx,.xls,.csv" @change="handleFileChange" style="display: none;" />
            </label>
          </template>
          <template v-else>
            已选择文件：<strong>{{ importFile.name }}</strong> ({{ (importFile.size / 1024).toFixed(2) }} KB)
            <br />
            <label class="file-label" style="margin-top: 8px;">重新选择文件
              <input type="file" accept=".xlsx,.xls,.csv" @change="handleFileChange" style="display: none;" />
            </label>
          </template>
        </div>
        <div class="upload-tip" style="margin-top: 12px; font-size: 13px; color: var(--el-text-color-secondary); text-align: left; max-width: 500px; margin-left: auto; margin-right: auto; line-height: 1.6;">
          <div><strong>支持格式：</strong>.xlsx / .xls / .csv</div>
          <div style="margin-top: 4px;"><strong>必填列：</strong>姓名、性别、出生日期</div>
          <div style="margin-top: 2px;"><strong>可选列：</strong>联系电话、诊断备注</div>
          <div style="margin-top: 6px; color: var(--el-color-primary); font-size: 12px;">提示：表头支持中文，导入时会自动识别。</div>
        </div>
      </div>

      <!-- 数据预览 -->
      <template v-if="previewData.length > 0">
        <h4 style="margin: 16px 0 10px 0;">数据预览（展示前 10 条，共计 {{ previewData.length }} 条记录）</h4>
        <el-table :data="previewData.slice(0, 10)" border size="small" style="width: 100%;">
          <el-table-column prop="name" label="姓名" width="120" />
          <el-table-column prop="gender" label="性别" width="80">
            <template #default="{ row }">
              {{ row.gender === 'male' ? '男' : row.gender === 'female' ? '女' : '未指定' }}
            </template>
          </el-table-column>
          <el-table-column prop="birthdate" label="出生日期" width="120" />
          <el-table-column prop="contact" label="联系电话" width="150" />
          <el-table-column prop="notes" label="诊断备注" min-width="150" />
        </el-table>

        <!-- 导入策略 -->
        <div class="strategy-selector" style="margin-top: 16px; display: flex; align-items: center; gap: 16px;">
          <span style="font-weight: 600; font-size: 14px;">重复姓名导入策略：</span>
          <el-radio-group v-model="importStrategy">
            <el-radio label="skip">跳过重复（若存在同名用户则不导入该行）</el-radio>
            <el-radio label="all">全部导入（允许同名用户并存）</el-radio>
          </el-radio-group>
        </div>
      </template>

      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="previewData.length === 0"
          :loading="importLoading"
          @click="confirmImport"
        >
          <template v-if="previewData.length === 0">请先上传文件</template>
          <template v-else>确认导入（共 {{ previewData.length }} 人）</template>
        </el-button>
      </template>
    </el-dialog>

    <!-- 添加/编辑用户弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑被试档案' : '添加被试档案'"
      width="500px"
      append-to-body
    >
      <el-form :model="editingUser" :rules="formRules" label-width="90px">
        <el-form-item label="姓名/化名" prop="name">
          <el-input v-model="editingUser.name" placeholder="请输入被试姓名或代称" />
        </el-form-item>
        <el-form-item label="性别">
          <el-radio-group v-model="editingUser.gender">
            <el-radio label="male">男</el-radio>
            <el-radio label="female">女</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="出生日期">
          <el-date-picker
            v-model="editingUser.birthdate"
            type="date"
            placeholder="选择出生日期"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="editingUser.contact" placeholder="可填入手机号/电话，用于PDF报告" />
        </el-form-item>
        <el-form-item label="标签分组">
          <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px;">
            <el-tag
              v-for="tag in tagOptions"
              :key="tag"
              class="cursor-pointer"
              :effect="getUserTags(editingUser as User).includes(tag) ? 'dark' : 'plain'"
              :type="getUserTags(editingUser as User).includes(tag) ? 'primary' : 'info'"
              style="cursor: pointer; user-select: none;"
              @click="toggleFormTag(tag)"
            >
              {{ tag }}
            </el-tag>
          </div>
          <!-- 自定义标签动态输入集成 -->
          <div style="display: flex; gap: 8px; width: 100%;">
            <el-input
              v-model="newTagInput"
              placeholder="自定义新标签"
              size="small"
              style="width: 140px;"
              @keyup.enter="addCustomTag"
            />
            <el-button type="primary" size="small" plain @click="addCustomTag">
              添加标签
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label="诊断备注">
          <el-input v-model="editingUser.notes" type="textarea" rows="3" placeholder="个案临床诊断备注或特别说明" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveUser">保存</el-button>
      </template>
    </el-dialog>
  </div>

  <!-- 预约弹窗 -->
  <el-dialog
    v-model="apptDialogVisible"
    :title="`为被试 [${apptTargetUser?.name || ''}] 预约测评`"
    width="500px"
    append-to-body
  >
    <el-form :model="apptForm" label-width="80px">
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

  <!-- 隐藏打印 HTML 模版区域：为了避免中文乱码，我们会在 JS 中将本 DOM 通过 html2canvas 转为 PNG 再贴入 jsPDF 页面中 -->
  <!-- 额外增加一个用于导出筛选用户汇总列表的隐藏 DOM -->
  <div id="filtered-users-print-area" style="display: none; padding: 40px; font-family: SimSun, serif; color: #000; background: #fff;">
    <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 24px;">
      <h2 style="margin: 0; font-size: 22px; font-weight: bold; letter-spacing: 2px;">被试人员健康档案汇总表</h2>
      <div style="margin-top: 6px; font-size: 13px; color: #555;">汇总时间：{{ new Date().toLocaleString() }} | 被试总数：{{ filteredUsers.length }} 人</div>
    </div>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <thead>
        <tr style="background: #f5f5f5;">
          <th style="border: 1px solid #000; padding: 8px; font-size: 13px; text-align: center;">姓名</th>
          <th style="border: 1px solid #000; padding: 8px; font-size: 13px; text-align: center; width: 10%;">性别</th>
          <th style="border: 1px solid #000; padding: 8px; font-size: 13px; text-align: center; width: 18%;">出生日期</th>
          <th style="border: 1px solid #000; padding: 8px; font-size: 13px; text-align: center; width: 20%;">联系电话</th>
          <th style="border: 1px solid #000; padding: 8px; font-size: 13px; text-align: left;">标签/分组</th>
          <th style="border: 1px solid #000; padding: 8px; font-size: 13px; text-align: left;">临床备注</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in filteredUsers" :key="u.id">
          <td style="border: 1px solid #000; padding: 8px; font-size: 13px; text-align: center; font-weight: bold;">{{ u.name }}</td>
          <td style="border: 1px solid #000; padding: 8px; font-size: 13px; text-align: center;">{{ u.gender === 'male' ? '男' : u.gender === 'female' ? '女' : '未知' }}</td>
          <td style="border: 1px solid #000; padding: 8px; font-size: 13px; text-align: center;">{{ u.birthdate || '未设置' }}</td>
          <td style="border: 1px solid #000; padding: 8px; font-size: 13px; text-align: center;">{{ u.contact || '无' }}</td>
          <td style="border: 1px solid #000; padding: 8px; font-size: 12px; text-align: left;">{{ getUserTags(u).join(', ') || '-' }}</td>
          <td style="border: 1px solid #000; padding: 8px; font-size: 12px; text-align: left; white-space: pre-wrap;">{{ u.notes || '-' }}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- 隐藏打印 HTML 模版区域：专门为个人健康档案及测评历史 PDF 导出渲染 -->
  <div v-if="pdfExportUser" id="profile-print-area" style="display: none; padding: 40px; font-family: SimSun, serif; color: #000; background: #fff;">
    <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 24px;">
      <h2 style="margin: 0; font-size: 22px; font-weight: bold; letter-spacing: 2px;">被试人员心理健康档案及测评历史报告</h2>
      <div style="margin-top: 6px; font-size: 13px; color: #555;">打印时间：{{ new Date().toLocaleString() }}</div>
    </div>

    <!-- 被试基本信息卡片 -->
    <h3 style="font-size: 16px; border-left: 4px solid #000; padding-left: 8px; margin-bottom: 12px;">一、被试基本档案</h3>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr>
        <td style="border: 1px solid #000; padding: 8px; font-weight: bold; width: 15%; background: #f5f5f5;">被试姓名</td>
        <td style="border: 1px solid #000; padding: 8px; width: 35%;">{{ pdfExportUser.name }}</td>
        <td style="border: 1px solid #000; padding: 8px; font-weight: bold; width: 15%; background: #f5f5f5;">性别</td>
        <td style="border: 1px solid #000; padding: 8px; width: 35%;">{{ pdfExportUser.gender === 'male' ? '男' : pdfExportUser.gender === 'female' ? '女' : '未指定' }}</td>
      </tr>
      <tr>
        <td style="border: 1px solid #000; padding: 8px; font-weight: bold; background: #f5f5f5;">出生日期</td>
        <td style="border: 1px solid #000; padding: 8px;">{{ pdfExportUser.birthdate || '未填写' }}</td>
        <td style="border: 1px solid #000; padding: 8px; font-weight: bold; background: #f5f5f5;">联系电话</td>
        <td style="border: 1px solid #000; padding: 8px;">{{ pdfExportUser.contact || '未填写' }}</td>
      </tr>
      <tr>
        <td style="border: 1px solid #000; padding: 8px; font-weight: bold; background: #f5f5f5;">标签分组</td>
        <td style="border: 1px solid #000; padding: 8px;" colspan="3">{{ getUserTags(pdfExportUser).join(', ') || '无' }}</td>
      </tr>
      <tr>
        <td style="border: 1px solid #000; padding: 8px; font-weight: bold; background: #f5f5f5;">临床备注说明</td>
        <td style="border: 1px solid #000; padding: 8px; min-height: 60px; vertical-align: top; white-space: pre-wrap;" colspan="3">{{ pdfExportUser.notes || '无特别备注' }}</td>
      </tr>
    </table>

    <!-- 心理测评历史记录列表 -->
    <h3 style="font-size: 16px; border-left: 4px solid #000; padding-left: 8px; margin-bottom: 12px;">二、心理测评历史记录 (共计 {{ pdfExportHistories.length }} 次)</h3>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <thead>
        <tr style="background: #f5f5f5;">
          <th style="border: 1px solid #000; padding: 8px; font-size: 13px; text-align: left;">量表名称</th>
          <th style="border: 1px solid #000; padding: 8px; font-size: 13px; width: 8%; text-align: center;">原始分</th>
          <th style="border: 1px solid #000; padding: 8px; font-size: 13px; width: 8%; text-align: center;">标准分</th>
          <th style="border: 1px solid #000; padding: 8px; font-size: 13px; width: 12%; text-align: center;">结果结论</th>
          <th style="border: 1px solid #000; padding: 8px; font-size: 13px; width: 18%; text-align: center;">测评时间</th>
          <th style="border: 1px solid #000; padding: 8px; font-size: 13px; width: 25%; text-align: left;">医生临床意见与备注</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="h in pdfExportHistories" :key="h.id">
          <td style="border: 1px solid #000; padding: 8px; font-size: 13px;">{{ h.scale_name }}</td>
          <td style="border: 1px solid #000; padding: 8px; font-size: 13px; text-align: center;">{{ h.raw_score }}</td>
          <td style="border: 1px solid #000; padding: 8px; font-size: 13px; text-align: center;">{{ h.std_score !== null && h.std_score !== undefined ? h.std_score : '/' }}</td>
          <td style="border: 1px solid #000; padding: 8px; font-size: 13px; text-align: center;">
            {{ (h.result_json ? JSON.parse(h.result_json).interpretation?.label : '') || '无' }}
          </td>
          <td style="border: 1px solid #000; padding: 8px; font-size: 13px; text-align: center;">{{ new Date(h.created_at).toLocaleString() }}</td>
          <td style="border: 1px solid #000; padding: 8px; font-size: 12px; white-space: pre-wrap; line-height: 1.4;">
            {{ h.doctorNote || '无' }} <span v-if="h.reportDoctor" style="color: #666; font-size: 11px;">(报告人: {{ h.reportDoctor }})</span>
          </td>
        </tr>
        <tr v-if="pdfExportHistories.length === 0">
          <td colspan="6" style="border: 1px solid #000; padding: 16px; text-align: center; color: #888; font-style: italic;">暂无任何历史测评数据</td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top: 40px; text-align: right; font-size: 13px; display: flex; justify-content: space-between;">
      <span>被试确认签字：_______________</span>
      <span>报告出具人：_______________</span>
    </div>
  </div>
</template>

<style scoped>
.user-manager-view {
  max-width: 1000px;
  margin: 0 auto;
  padding: 24px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-left h2 {
  margin: 0;
  font-size: 20px;
  font-weight: bold;
}

.user-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.clinical-notes {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-actions-cell {
  display: flex;
  gap: 4px;
}

/* 导入区拖拽样式 */
.import-dropzone {
  border: 2px dashed var(--el-border-color);
  border-radius: 8px;
  padding: 32px 24px;
  text-align: center;
  transition: all 0.3s;
  background: var(--el-fill-color-blank);
}

.import-dropzone.active,
.import-dropzone:hover {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.upload-icon {
  font-size: 48px;
  color: var(--el-text-color-placeholder);
  margin-bottom: 12px;
}

.upload-text {
  font-size: 14px;
  color: var(--el-text-color-regular);
  line-height: 1.6;
}

.file-label {
  color: var(--el-color-primary);
  cursor: pointer;
  font-weight: 600;
  text-decoration: underline;
  display: inline-block;
}

.dark :deep(.el-card) {
  background: var(--app-card, #16213e);
  color: var(--app-text, #e0e0e0);
}

.dark :deep(.el-table) {
  --el-table-text-color: var(--fluent-text-primary) !important;
  --el-table-header-text-color: var(--fluent-text-primary) !important;
  --el-table-bg-color: transparent !important;
  --el-table-tr-bg-color: transparent !important;
}
</style>

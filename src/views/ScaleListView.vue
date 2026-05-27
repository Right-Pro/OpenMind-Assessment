<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useScaleStore } from '@/stores/scaleStore'
import { useUserStore } from '@/stores/userStore'
import { useFavoriteStore } from '@/stores/favoriteStore'
import { usePackageStore } from '@/stores/packageStore'
import { ElMessage, ElLoading } from 'element-plus'
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import { useSettingsStore } from '@/stores/settingsStore'
import html2canvas from 'html2canvas'

const emit = defineEmits(['trigger-user-select'])

const router = useRouter()
const scaleStore = useScaleStore()
const userStore = useUserStore()
const favoriteStore = useFavoriteStore()
const packageStore = usePackageStore()

const activeTab = ref('scales')

// 自定义分类与统计状态
const customCategories = ref<any[]>([])
const scaleCategoryMap = ref<Record<string, any[]>>({}) // scaleId -> custom category object array
const scaleStatsMap = ref<Record<string, { usage_count: number; avg_duration: number }>>({})

// 高级筛选状态
const filterCategory = ref('')
const filterFavoriteOnly = ref(false)
const filterApplicableOnly = ref(false)
const filterSuitability = ref('all')
const filterQuestionLength = ref('all')
const showAdvancedFilters = ref(false)

// 分页状态
const currentPage = ref(1)
const pageSize = ref(12)

async function loadCustomCategoriesData() {
  if (!window.electronAPI) return
  try {
    const categoriesRows = await window.electronAPI.dbQuery("SELECT * FROM scale_categories ORDER BY sort_order ASC, id ASC")
    customCategories.value = categoriesRows || []

    const relationsRows = await window.electronAPI.dbQuery(`
      SELECT r.scale_id, r.category_id, c.name, c.color
      FROM scale_category_relations r
      JOIN scale_categories c ON r.category_id = c.id
    `)
    const map: Record<string, any[]> = {}
    if (relationsRows) {
      for (const row of relationsRows) {
        if (!map[row.scale_id]) {
          map[row.scale_id] = []
        }
        map[row.scale_id].push({
          id: row.category_id,
          name: row.name,
          color: row.color
        })
      }
    }
    scaleCategoryMap.value = map
  } catch (err) {
    console.error('加载自定义分类数据失败:', err)
  }
}

async function loadScaleStats() {
  if (!window.electronAPI) return
  try {
    const statsRows = await window.electronAPI.dbQuery(`
      SELECT scale_id, COUNT(*) as usage_count, AVG(duration_seconds) as avg_duration
      FROM tests
      WHERE status = 'completed'
      GROUP BY scale_id
    `)
    const map: Record<string, { usage_count: number; avg_duration: number }> = {}
    if (statsRows) {
      for (const r of statsRows) {
        map[r.scale_id] = {
          usage_count: Number(r.usage_count || 0),
          avg_duration: Math.round(Number(r.avg_duration || 0))
        }
      }
    }
    scaleStatsMap.value = map
  } catch (err) {
    console.error('加载量表统计数据失败:', err)
  }
}

onMounted(async () => {
  await favoriteStore.loadFavorites()
  await packageStore.loadPackages()
  await loadCustomCategoriesData()
  await loadScaleStats()
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
  let list = scaleStore.scales || []

  // 1. Search Query
  const query = searchQuery.value.trim().toLowerCase()
  if (query) {
    list = list.filter(scale => {
      const nameMatch = scale.name.toLowerCase().includes(query)
      const enNameMatch = scale.name_en?.toLowerCase().includes(query) || false
      const idMatch = scale.id.toLowerCase().includes(query)
      return nameMatch || enNameMatch || idMatch
    })
  }

  // 2. Category Filter (Built-in or Custom)
  if (filterCategory.value) {
    if (filterCategory.value.startsWith('sys:')) {
      const catVal = filterCategory.value.substring(4)
      list = list.filter(scale => scale.category === catVal)
    } else if (filterCategory.value.startsWith('custom:')) {
      const catId = parseInt(filterCategory.value.substring(7), 10)
      list = list.filter(scale => {
        const customCats = scaleCategoryMap.value[scale.id] || []
        return customCats.some(c => c.id === catId)
      })
    }
  }

  // 3. Favorite Only
  if (filterFavoriteOnly.value) {
    list = list.filter(scale => favoriteStore.isFavorite(scale.id))
  }

  // 4. Applicable Only (to current user)
  if (filterApplicableOnly.value && userStore.currentUser) {
    list = list.filter(scale => {
      const status = getScaleApplicability(scale)
      return status.applicable
    })
  }

  // 5. Suitability/Gender Filter
  if (filterSuitability.value !== 'all') {
    list = list.filter(scale => {
      const targetGender = scale.targetPopulation?.gender || 'any'
      return targetGender === filterSuitability.value
    })
  }

  // 6. Question Length Filter
  if (filterQuestionLength.value !== 'all') {
    list = list.filter(scale => {
      const len = scale.questions?.length || 0
      if (filterQuestionLength.value === 'short') return len < 20
      if (filterQuestionLength.value === 'medium') return len >= 20 && len <= 50
      if (filterQuestionLength.value === 'long') return len > 50
      return true
    })
  }

  return list
})

const paginatedScales = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return filteredScales.value.slice(start, end)
})

// 自定义分类管理 Dialog 状态
const categoryManagerVisible = ref(false)
const categoryForm = ref({
  id: null as number | null,
  name: '',
  color: '#409EFF',
  sort_order: 0
})
const selectedScaleIdsForCategory = ref<string[]>([])
const categoryScaleSearchQuery = ref('')

const filteredScalesForCategorySelection = computed(() => {
  const query = categoryScaleSearchQuery.value.trim().toLowerCase()
  if (!query) return scaleStore.scales || []
  return (scaleStore.scales || []).filter(s => 
    s.name.toLowerCase().includes(query) || 
    s.id.toLowerCase().includes(query) || 
    (s.name_en && s.name_en.toLowerCase().includes(query))
  )
})

// 保存或更新分类及其关联量表
async function handleSaveCategory() {
  const targetName = categoryForm.value.name.trim()
  if (!targetName) {
    ElMessage.warning('请输入分类名称')
    return
  }

  // 1. 前端重复校验
  // 系统默认分类包括: "情绪" (mood), "人格" (personality), "精神科" (psychiatric), "认知" (cognitive), "筛查" (screening), "其他" (other)
  const defaultCategoryNames = ['情绪', '人格', '精神科', '认知', '筛查', '其他']
  
  // 检查是否与系统默认分类重复
  const isDuplicateWithDefault = defaultCategoryNames.some(name => name.toLowerCase() === targetName.toLowerCase())
  if (isDuplicateWithDefault) {
    ElMessage.warning("分类名称已存在，请使用其他名称")
    return
  }

  // 检查是否与自定义分类重复（排除当前编辑的分类本身）
  const isDuplicateWithCustom = customCategories.value.some(cat => {
    // 如果是编辑，且属于同一个分类，则不视为重复
    if (categoryForm.value.id && cat.id === categoryForm.value.id) {
      return false
    }
    return cat.name.trim().toLowerCase() === targetName.toLowerCase()
  })
  
  if (isDuplicateWithCustom) {
    ElMessage.warning("分类名称已存在，请使用其他名称")
    return
  }

  try {
    // 确保 scale_categories 和 scale_category_relations 表存在
    if (window.electronAPI) {
      await window.electronAPI.dbRun(`
        CREATE TABLE IF NOT EXISTS scale_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          color TEXT NOT NULL,
          sort_order INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
      `)
      await window.electronAPI.dbRun(`
        CREATE TABLE IF NOT EXISTS scale_category_relations (
          scale_id TEXT NOT NULL,
          category_id INTEGER NOT NULL,
          PRIMARY KEY (scale_id, category_id),
          FOREIGN KEY (category_id) REFERENCES scale_categories(id) ON DELETE CASCADE
        );
      `)
    }

    let categoryId = categoryForm.value.id
    if (categoryId) {
      // 1. 更新分类属性
      await window.electronAPI.dbRun(
        "UPDATE scale_categories SET name = ?, color = ?, sort_order = ? WHERE id = ?",
        [targetName, categoryForm.value.color, categoryForm.value.sort_order, categoryId]
      )
      
      // 2. 清理历史关联
      await window.electronAPI.dbRun("DELETE FROM scale_category_relations WHERE category_id = ?", [categoryId])
      
      // 3. 重新插入新关联量表
      for (const scaleId of selectedScaleIdsForCategory.value) {
        await window.electronAPI.dbRun(
          "INSERT INTO scale_category_relations (scale_id, category_id) VALUES (?, ?)",
          [scaleId, categoryId]
        )
      }
      ElMessage.success('更新分类及其量表关联成功')
    } else {
      // 1. 插入新分类并获取自增 ID
      const result = await window.electronAPI.dbRun(
        "INSERT INTO scale_categories (name, color, sort_order) VALUES (?, ?, ?)",
        [targetName, categoryForm.value.color, categoryForm.value.sort_order]
      )
      
      categoryId = Number(result.lastInsertRowid)
      
      // 2. 插入关联量表
      for (const scaleId of selectedScaleIdsForCategory.value) {
        await window.electronAPI.dbRun(
          "INSERT INTO scale_category_relations (scale_id, category_id) VALUES (?, ?)",
          [scaleId, categoryId]
        )
      }
      ElMessage.success('新建分类及关联量表成功')
    }
    
    // 重置表单状态
    resetCategoryForm()
    await loadCustomCategoriesData()
  } catch (err: any) {
    ElMessage.error('保存分类失败: ' + err.message)
  }
}

function resetCategoryForm() {
  categoryForm.value = { id: null, name: '', color: '#409EFF', sort_order: 0 }
  selectedScaleIdsForCategory.value = []
  categoryScaleSearchQuery.value = ''
}

// 编辑分类赋值并获取已关联的量表 ID
async function handleEditCategory(row: any) {
  categoryForm.value = {
    id: row.id,
    name: row.name,
    color: row.color,
    sort_order: row.sort_order || 0
  }
  categoryScaleSearchQuery.value = ''
  
  // 查询当前分类已绑定的量表 ID
  try {
    const relationRows = await window.electronAPI.dbQuery(
      "SELECT scale_id FROM scale_category_relations WHERE category_id = ?",
      [row.id]
    )
    selectedScaleIdsForCategory.value = relationRows ? relationRows.map((r: any) => r.scale_id) : []
  } catch (err) {
    console.error('获取分类关联量表失败:', err)
    selectedScaleIdsForCategory.value = []
  }
}

// 删除分类
async function handleDeleteCategory(id: number) {
  try {
    await window.electronAPI.dbRun("DELETE FROM scale_categories WHERE id = ?", [id])
    ElMessage.success('删除分类成功')
    if (categoryForm.value.id === id) {
      resetCategoryForm()
    }
    await loadCustomCategoriesData()
  } catch (err: any) {
    ElMessage.error('删除分类失败: ' + err.message)
  }
}

// 量表分配分类 Dialog 状态
const scaleCategorySetVisible = ref(false)
const currentScaleId = ref('')
const currentScaleName = ref('')
const selectedCustomCategoryIds = ref<number[]>([])

function showScaleCategorySet(scale: any) {
  currentScaleId.value = scale.id
  currentScaleName.value = scale.name
  const scaleCats = scaleCategoryMap.value[scale.id] || []
  selectedCustomCategoryIds.value = scaleCats.map(c => c.id)
  scaleCategorySetVisible.value = true
}

async function handleSaveScaleCategories() {
  try {
    // 1. 删除原有的分类映射
    await window.electronAPI.dbRun("DELETE FROM scale_category_relations WHERE scale_id = ?", [currentScaleId.value])
    
    // 2. 插入新选中的分类映射
    for (const catId of selectedCustomCategoryIds.value) {
      await window.electronAPI.dbRun(
        "INSERT INTO scale_category_relations (scale_id, category_id) VALUES (?, ?)",
        [currentScaleId.value, catId]
      )
    }
    
    ElMessage.success('量表分类设置成功')
    scaleCategorySetVisible.value = false
    await loadCustomCategoriesData()
  } catch (err: any) {
    ElMessage.error('设置分类失败: ' + err.message)
  }
}

const categories = [
  { value: 'mood', label: '情绪' },
  { value: 'personality', label: '人格' },
  { value: 'psychiatric', label: '精神科' },
  { value: 'cognitive', label: '认知' },
  { value: 'screening', label: '筛查' },
  { value: 'other', label: '其他' }
]

const categoryLabel = (val: string): string => categories.find(c => c.value === val)?.label || val

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

function getScaleApplicability(scale: any): { applicable: boolean; text: string; type: string } {
  if (!userStore.currentUser) {
    return { applicable: false, text: '', type: '' }
  }

  // 1. 性别判断
  const targetGender = scale.targetPopulation?.gender || 'any'
  const userGender = userStore.currentUser.gender
  const genderMatch = targetGender === 'any' || targetGender === userGender

  // 2. 年龄判断
  let ageMatch = true
  if (scale.age_range) {
    const { min, max } = scale.age_range
    const ageVal = calculateAge(userStore.currentUser.birthdate)
    if (ageVal === '/') {
      // 如果有年龄限制，且被试年龄算不出来/无生日，视为不匹配
      ageMatch = false
    } else {
      const ageNum = parseInt(ageVal, 10)
      ageMatch = ageNum >= min && ageNum <= max
    }
  }

  const isApplicable = genderMatch && ageMatch

  return {
    applicable: isApplicable,
    text: isApplicable ? '当前适用' : '不适用',
    type: isApplicable ? 'success' : 'info'
  }
}

async function printBlankScale(scale: any) {
  let loadingInstance: any = null
  try {
    loadingInstance = ElLoading.service({
      lock: true,
      text: '正在生成 PDF，请稍候...',
      background: 'rgba(0, 0, 0, 0.6)'
    })
    
    const settingsStore = useSettingsStore()
    
    // 创建一个隐藏的 DOM 容器
    const container = document.createElement('div')
    container.id = 'blank-scale-container'
    container.style.position = 'absolute'
    container.style.left = '-9999px'
    container.style.top = '0'
    container.style.width = '794px'
    container.style.zIndex = '-9999'
    container.style.backgroundColor = 'transparent'
    container.style.boxSizing = 'border-box'
    document.body.appendChild(container)
    
    let currentPageNum = 1
    const maxContentHeight = 900 // A4 is 1123px height
    
    function createPage() {
      const page = document.createElement('div')
      page.className = 'blank-scale-page'
      page.style.width = '794px'
      page.style.height = '1123px'
      page.style.padding = '60px 40px'
      page.style.boxSizing = 'border-box'
      page.style.position = 'relative'
      page.style.backgroundColor = '#ffffff'
      page.style.color = '#000000'
      page.style.fontFamily = 'SimSun, STSong, "Microsoft YaHei", sans-serif'
      page.style.display = 'flex'
      page.style.flexDirection = 'column'
      
      // 页眉
      const headerEl = document.createElement('div')
      headerEl.style.display = 'flex'
      headerEl.style.justifyContent = 'space-between'
      headerEl.style.alignItems = 'center'
      headerEl.style.borderBottom = '1px solid #cccccc'
      headerEl.style.paddingBottom = '8px'
      headerEl.style.marginBottom = '20px'
      headerEl.style.height = '30px'
      headerEl.style.boxSizing = 'border-box'
      
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
      headerTitle.innerText = 'OpenMind 空白量表问卷'
      headerTitle.style.fontSize = '12px'
      headerTitle.style.fontWeight = 'bold'
      headerLeft.appendChild(headerTitle)
      headerEl.appendChild(headerLeft)
      
      const headerPageNum = document.createElement('span')
      headerPageNum.innerText = `第 ${currentPageNum} 页`
      headerPageNum.style.fontSize = '11px'
      headerPageNum.style.color = '#666666'
      headerEl.appendChild(headerPageNum)
      page.appendChild(headerEl)
      
      // 内容区域 (不设 flex: 1，从而 offsetHeight 可以准确反映内容高度)
      const contentArea = document.createElement('div')
      contentArea.style.display = 'flex'
      contentArea.style.flexDirection = 'column'
      contentArea.style.gap = '15px'
      page.appendChild(contentArea)
      
      // 页脚
      const footerEl = document.createElement('div')
      footerEl.style.position = 'absolute'
      footerEl.style.bottom = '20px'
      footerEl.style.left = '40px'
      footerEl.style.right = '40px'
      footerEl.style.borderTop = '1px solid #eeeeee'
      footerEl.style.paddingTop = '8px'
      footerEl.style.textAlign = 'center'
      footerEl.style.fontSize = '10px'
      footerEl.style.color = '#888888'
      footerEl.innerText = '本报告仅供专业参考，不构成医学诊断'
      page.appendChild(footerEl)
      
      container.appendChild(page)
      currentPageNum++
      
      return { page, contentArea }
    }
    
    // 封面页（第 1 页）：标题 + 量表说明，不排题目
    let { page, contentArea } = createPage()
    
    // Title
    const titleEl = document.createElement('h1')
    titleEl.innerText = `${scale.name}（空白问卷）`
    titleEl.style.fontSize = '22px'
    titleEl.style.fontWeight = 'bold'
    titleEl.style.textAlign = 'center'
    titleEl.style.margin = '10px 0 15px 0'
    titleEl.style.color = '#000000'
    contentArea.appendChild(titleEl)
    
    // Description
    if (scale.description) {
      const descEl = document.createElement('p')
      descEl.innerText = scale.description
      descEl.style.fontSize = '14px'
      descEl.style.lineHeight = '1.8'
      descEl.style.color = '#333333'
      descEl.style.margin = '0 0 10px 0'
      contentArea.appendChild(descEl)
      
      // Divider
      const divider = document.createElement('div')
      divider.style.borderBottom = '2px solid #000000'
      divider.style.margin = '5px 0 15px 0'
      contentArea.appendChild(divider)
    }
    
    // 从第 2 页开始安排题目
    const firstContentPage = createPage()
    page = firstContentPage.page
    contentArea = firstContentPage.contentArea
    
    // 遍历题目
    const questions = scale.questions || []
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      
      const qBlock = document.createElement('div')
      qBlock.style.fontSize = '14px'
      qBlock.style.lineHeight = '1.8'
      qBlock.style.color = '#000000'
      qBlock.style.marginBottom = '20px'
      qBlock.style.pageBreakInside = 'avoid'
      
      // 题干
      const qTextEl = document.createElement('div')
      qTextEl.style.fontWeight = 'bold'
      qTextEl.style.marginBottom = '8px'
      qTextEl.style.fontSize = '14px'
      qTextEl.style.lineHeight = '1.8'
      qTextEl.innerText = `${i + 1}. ${q.text}`
      qBlock.appendChild(qTextEl)
      
      // 选项
      const options = q.options || []
      const optionsContainer = document.createElement('div')
      optionsContainer.style.display = 'flex'
      optionsContainer.style.flexDirection = 'column'
      optionsContainer.style.gap = '6px'
      optionsContainer.style.paddingLeft = '20px'
      
      options.forEach((opt: any) => {
        const optEl = document.createElement('div')
        optEl.style.display = 'flex'
        optEl.style.alignItems = 'flex-start'
        optEl.style.gap = '8px'
        optEl.style.fontSize = '14px'
        optEl.style.lineHeight = '1.8'
        
        const boxEl = document.createElement('span')
        boxEl.innerHTML = '[ &nbsp; ]'
        boxEl.style.fontWeight = 'bold'
        boxEl.style.fontFamily = 'monospace, Courier, sans-serif'
        boxEl.style.whiteSpace = 'pre'
        boxEl.style.flexShrink = '0'
        
        const textEl = document.createElement('span')
        textEl.innerText = opt.label
        
        optEl.appendChild(boxEl)
        optEl.appendChild(textEl)
        optionsContainer.appendChild(optEl)
      })
      
      qBlock.appendChild(optionsContainer)
      
      contentArea.appendChild(qBlock)
      
      // 动态分页检查 (如果当前页剩的空间不够放整道题，整道题移到下一页)
      if (contentArea.offsetHeight > maxContentHeight && contentArea.children.length > 1) {
        contentArea.removeChild(qBlock)
        const newPageInfo = createPage()
        page = newPageInfo.page
        contentArea = newPageInfo.contentArea
        contentArea.appendChild(qBlock)
      }
    }
    
    // 给 DOM 渲染点时间（如果是包含 logo 图片等）
    await new Promise((resolve) => setTimeout(resolve, 300))
    
    // html2canvas 逐页转换并写入 jsPDF
    const pdf = new jsPDF('p', 'mm', 'a4')
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
    
    // 清理隐藏容器
    document.body.removeChild(container)
    
    const defaultName = `${scale.name}_空白问卷_${new Date().toISOString().slice(0, 10)}.pdf`
    if (window.electronAPI) {
      const saveRes = await window.electronAPI.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
      })

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
          ElMessage.success('空白问卷 PDF 生成成功！')
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
      ElMessage.success('空白问卷 PDF 导出成功！')
    }
    
  } catch (err: any) {
    if (loadingInstance) {
      loadingInstance.close()
      loadingInstance = null
    }
    ElMessage.error('生成失败，请重试')
  }
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
    
    // 弹出 Electron 的保存对话框
    const defaultName = `${scaleName}_全部脱敏_${new Date().toISOString().slice(0, 10)}.xlsx`
    let savePath = ''
    if (window.electronAPI) {
      const saveRes = await window.electronAPI.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
      })
      if (!saveRes.filePath) {
        // 用户取消了对话框
        isExportingAll.value = false
        return
      }
      savePath = saveRes.filePath
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
    
    if (window.electronAPI && savePath) {
      // 在 Electron 环境下通过 write_file 写入，避免使用 window 触发下载
      const excelBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      const bytes = new Uint8Array(excelBuffer)
      let binary = ''
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i])
      }
      const base64 = window.btoa(binary)
      
      const writeRes = await window.electronAPI.saveBufferFile(savePath, base64)
      if (writeRes.success) {
        ElMessage.success('该量表全部记录去标识化导出成功！')
      } else {
        ElMessage.error('保存 Excel 失败: ' + writeRes.error)
      }
    } else {
      XLSX.writeFile(wb, defaultName)
      ElMessage.success('该量表全部记录去标识化导出成功！')
    }
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
        <el-button type="warning" @click="categoryManagerVisible = true">
          <el-icon><Menu /></el-icon>
          分类管理
        </el-button>
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
        <!-- 搜索与高级筛选栏 -->
        <div class="search-bar no-print" style="margin-bottom: 16px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between;">
          <div style="display: flex; gap: 8px; align-items: center;">
            <el-input
              v-model="searchQuery"
              placeholder="搜索量表名称、英文名称或ID..."
              clearable
              style="width: 260px;"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
            
            <el-select
              v-model="filterCategory"
              placeholder="选择量表分类 (全部)"
              clearable
              style="width: 200px;"
            >
              <el-option label="全部分类" value="" />
              <el-option-group label="系统分类">
                <el-option
                  v-for="cat in categories"
                  :key="cat.value"
                  :label="cat.label"
                  :value="'sys:' + cat.value"
                />
              </el-option-group>
              <el-option-group label="自定义分类" v-if="customCategories.length > 0">
                <el-option
                  v-for="cat in customCategories"
                  :key="cat.id"
                  :label="cat.name"
                  :value="'custom:' + cat.id"
                />
              </el-option-group>
            </el-select>

            <el-button @click="showAdvancedFilters = !showAdvancedFilters" type="text" style="font-size: 13px; padding: 0;">
              {{ showAdvancedFilters ? '收起高级筛选' : '展开高级筛选' }}
              <el-icon><component :is="showAdvancedFilters ? 'ArrowUp' : 'ArrowDown'" /></el-icon>
            </el-button>
          </div>
          
          <div style="display: flex; gap: 16px; align-items: center;">
            <el-checkbox v-model="filterFavoriteOnly">仅显示常用</el-checkbox>
            <el-checkbox v-if="userStore.currentUser" v-model="filterApplicableOnly">仅显示当前被试适用</el-checkbox>
          </div>
        </div>

        <!-- 高级筛选展开区域 -->
        <el-collapse-transition>
          <div v-show="showAdvancedFilters" class="advanced-filters-panel" style="margin-bottom: 16px; padding: 12px; border-radius: 6px; background: var(--el-fill-color-blank); border: 1px solid var(--el-border-color-light); display: flex; flex-wrap: wrap; gap: 24px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 13px; color: var(--el-text-color-secondary);">适用人群性别:</span>
              <el-radio-group v-model="filterSuitability" size="small">
                <el-radio-button label="all">全部</el-radio-button>
                <el-radio-button label="any">不限</el-radio-button>
                <el-radio-button label="male">男性</el-radio-button>
                <el-radio-button label="female">女性</el-radio-button>
              </el-radio-group>
            </div>
            
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 13px; color: var(--el-text-color-secondary);">题目篇幅:</span>
              <el-radio-group v-model="filterQuestionLength" size="small">
                <el-radio-button label="all">全部</el-radio-button>
                <el-radio-button label="short">精简量表 (< 20题)</el-radio-button>
                <el-radio-button label="medium">中等量表 (20 - 50题)</el-radio-button>
                <el-radio-button label="long">深度量表 (> 50题)</el-radio-button>
              </el-radio-group>
            </div>
          </div>
        </el-collapse-transition>

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
        <el-table :data="paginatedScales" style="width: 100%" v-loading="scaleStore.loading" class="custom-scale-table">
        <el-table-column prop="name" label="量表名称" min-width="220">
          <template #default="{ row }">
            <el-tooltip
              v-if="row.targetPopulation && row.targetPopulation.gender"
              :content="`适用于：${row.targetPopulation.gender === 'male' ? '男性' : row.targetPopulation.gender === 'female' ? '女性' : '不限'}`"
              placement="bottom"
              :show-after="800"
            >
              <div class="scale-name-cell">
                <div class="scale-name-row">
                  <span class="scale-name-text">{{ row.id }} {{ row.name }}</span>
                  <!-- 匹配当前选中用户适用性标签 -->
                  <el-tag
                    v-if="userStore.currentUser && userStore.currentUser.gender"
                    size="mini"
                    :type="getScaleApplicability(row).type"
                    class="applicability-tag"
                  >
                    {{ getScaleApplicability(row).text }}
                  </el-tag>
                </div>
                <div class="scale-name-en" v-if="row.name_en">{{ row.name_en }}</div>
              </div>
            </el-tooltip>
            <div v-else class="scale-name-cell">
              <div class="scale-name-row">
                <span class="scale-name-text">{{ row.id }} {{ row.name }}</span>
                <!-- 匹配当前选中用户适用性标签 (兜底: targetPopulation 未指定或者为 any) -->
                <el-tag
                  v-if="userStore.currentUser && userStore.currentUser.gender"
                  size="mini"
                  :type="getScaleApplicability(row).type"
                  class="applicability-tag"
                >
                  {{ getScaleApplicability(row).text }}
                </el-tag>
              </div>
              <div class="scale-name-en" v-if="row.name_en">{{ row.name_en }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="category" label="分类" width="70" align="center">
          <template #default="{ row }">
            <div class="compact-category-cell">
              <el-tag size="small" class="compact-cat-tag">{{ categoryLabel(row.category) }}</el-tag>
              <template v-if="scaleCategoryMap[row.id]">
                <el-tag 
                  v-for="cat in scaleCategoryMap[row.id]" 
                  :key="cat.id" 
                  size="small" 
                  effect="plain"
                  class="compact-cat-tag"
                  :style="{ color: cat.color, borderColor: cat.color }"
                >
                  {{ cat.name }}
                </el-tag>
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="questions" label="题数" width="60" align="center">
          <template #default="{ row }">
            <span class="compact-question-text">{{ row.questions?.length || 0 }}题</span>
          </template>
        </el-table-column>
        <el-table-column label="使用统计" width="90" align="center">
          <template #default="{ row }">
            <template v-if="scaleStatsMap[row.id]">
              <el-tooltip placement="top">
                <template #content>
                  <div>已测次数：{{ scaleStatsMap[row.id].usage_count }}次</div>
                  <div v-if="scaleStatsMap[row.id].avg_duration > 0">
                    平均用时：{{ Math.floor(scaleStatsMap[row.id].avg_duration / 60) }}分{{ scaleStatsMap[row.id].avg_duration % 60 }}秒
                  </div>
                </template>
                <span class="compact-stats-text">已测 <strong>{{ scaleStatsMap[row.id].usage_count }}</strong> 次</span>
              </el-tooltip>
            </template>
            <span v-else class="compact-stats-none">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" align="right" fixed="right">
          <template #default="{ row }">
            <div class="compact-actions-cell">
              <div class="star-icon-wrapper" style="margin-right: 12px; display: inline-flex; align-items: center; cursor: pointer; flex-shrink: 0;" @click="handleToggleFavorite(row.id)">
                <el-icon :size="16" :style="{ color: favoriteStore.isFavorite(row.id) ? '#e6a23c' : '#c0c4cc' }">
                  <component :is="favoriteStore.isFavorite(row.id) ? 'StarFilled' : 'Star'" />
                </el-icon>
              </div>
              <el-button
                type="primary"
                size="small"
                style="flex-shrink: 0; width: 80px;"
                @click="startScale(row.id)"
              >
                开始测评
              </el-button>
              
              <el-dropdown trigger="click" :teleported="true">
                <el-button size="small" style="flex-shrink: 0; width: 80px; margin-left: 8px;">
                  更多操作
                  <el-icon class="el-icon--right"><More /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item @click="printBlankScale(row)">
                      <el-icon><Printer /></el-icon>
                      打印空白问卷
                    </el-dropdown-item>
                    <el-dropdown-item @click="exportAnonymizedScaleData(row.id)">
                      <el-icon><Download /></el-icon>
                      导出全部脱敏数据
                    </el-dropdown-item>
                    <el-dropdown-item @click="showScaleCategorySet(row)">
                      <el-icon><Setting /></el-icon>
                      设置分类
                    </el-dropdown-item>
                    <el-dropdown-item @click="$router.push({ path: '/data-analysis', query: { scaleId: row.id } })">
                      <el-icon><PieChart /></el-icon>
                      数据分析
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
        </el-table>

        <!-- 分页 -->
        <div style="margin-top: 16px; display: flex; justify-content: flex-end;">
          <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :page-sizes="[12, 24, 48, 100]"
            layout="total, sizes, prev, pager, next, jumper"
            :total="filteredScales.length"
            @size-change="currentPage = 1"
            @current-change="(val: number) => currentPage = val"
          />
        </div>
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

    <!-- 自定义分类管理 Dialog -->
    <el-dialog
      v-model="categoryManagerVisible"
      title="分类管理"
      width="900px"
      destroy-on-close
      @close="resetCategoryForm"
    >
      <div style="display: flex; gap: 24px;">
        <!-- 新增/编辑表单 -->
        <div style="width: 320px; border-right: 1px solid var(--el-border-color-lighter); padding-right: 20px; flex-shrink: 0;">
          <h4 style="margin-top: 0;">{{ categoryForm.id ? '编辑自定义分类' : '新建自定义分类' }}</h4>
          <el-form :model="categoryForm" label-position="top">
            <el-form-item label="分类名称" required>
              <!-- 显式绑定并且防止输入框自动填充被试等其他无关缓存 -->
              <el-input v-model="categoryForm.name" placeholder="请输入分类名称" autocomplete="off" />
            </el-form-item>
            <el-form-item label="分类颜色">
              <el-color-picker v-model="categoryForm.color" :predefine="['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#909399', '#9c27b0', '#009688']" />
            </el-form-item>
            <el-form-item label="排序权重">
              <el-input-number v-model="categoryForm.sort_order" :min="0" style="width: 100%;" />
            </el-form-item>
            
            <!-- 关联量表区块 -->
            <el-form-item label="关联量表">
              <div style="width: 100%; border: 1px solid var(--el-border-color-light); border-radius: 4px; padding: 8px; background: var(--el-fill-color-blank);">
                <el-input
                  v-model="categoryScaleSearchQuery"
                  placeholder="搜索量表名称或ID..."
                  size="small"
                  clearable
                  style="margin-bottom: 8px;"
                >
                  <template #prefix>
                    <el-icon><Search /></el-icon>
                  </template>
                </el-input>
                <div style="max-height: 180px; overflow-y: auto; padding-right: 4px;">
                  <el-checkbox-group v-model="selectedScaleIdsForCategory">
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                      <el-checkbox
                        v-for="scale in filteredScalesForCategorySelection"
                        :key="scale.id"
                        :value="scale.id"
                        style="margin-right: 0;"
                      >
                        <span style="font-size: 12px;">[{{ scale.id }}] {{ scale.name }}</span>
                      </el-checkbox>
                    </div>
                  </el-checkbox-group>
                  <div v-if="filteredScalesForCategorySelection.length === 0" style="text-align: center; font-size: 12px; color: var(--el-text-color-secondary); padding: 12px 0;">
                    无匹配量表
                  </div>
                </div>
              </div>
            </el-form-item>

            <el-form-item style="margin-top: 16px;">
              <el-button type="primary" @click="handleSaveCategory" style="width: 100%;">
                保存分类
              </el-button>
              <el-button v-if="categoryForm.id" @click="resetCategoryForm" style="width: 100%; margin-left: 0; margin-top: 8px;">
                取消编辑
              </el-button>
            </el-form-item>
          </el-form>
        </div>

        <!-- 已有分类列表 -->
        <div style="flex: 1; display: flex; flex-direction: column; gap: 20px;">
          <div>
            <h4 style="margin-top: 0; margin-bottom: 8px;">系统默认分类 (不可修改/删除)</h4>
            <div style="display: flex; flex-wrap: wrap; gap: 8px; padding: 8px; background: var(--el-fill-color-blank); border: 1px solid var(--el-border-color-lighter); border-radius: 6px;">
              <el-tag
                v-for="cat in categories"
                :key="cat.value"
                type="info"
                effect="plain"
                size="small"
                style="color: #909399; border-color: #e4e7ed;"
              >
                {{ cat.label }}
              </el-tag>
            </div>
          </div>
          <div>
            <h4 style="margin-top: 0; margin-bottom: 8px;">已有自定义分类</h4>
            <el-table :data="customCategories" height="280px" size="small">
              <el-table-column prop="name" label="分类名称" min-width="120">
                <template #default="{ row }">
                  <el-tag :style="{ color: row.color, borderColor: row.color }" effect="plain" size="small">
                    {{ row.name }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="sort_order" label="排序" width="65" align="center" />
              <el-table-column label="操作" width="140" align="center">
                <template #default="{ row }">
                  <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <el-button type="primary" size="small" link @click="handleEditCategory(row)">编辑</el-button>
                    <el-popconfirm title="确定删除该分类吗？" @confirm="handleDeleteCategory(row.id)">
                      <template #reference>
                        <el-button type="danger" size="small" link>删除</el-button>
                      </template>
                    </el-popconfirm>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </div>
    </el-dialog>

    <!-- 量表设置分类 Dialog -->
    <el-dialog
      v-model="scaleCategorySetVisible"
      :title="`设置量表分类: ${currentScaleName}`"
      width="450px"
    >
      <div style="padding: 10px 0;">
        <div style="margin-bottom: 16px; font-size: 14px; color: var(--el-text-color-regular);">
          请选择属于该量表的自定义分类：
        </div>
        
        <el-checkbox-group v-if="customCategories.length > 0" v-model="selectedCustomCategoryIds">
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <el-checkbox 
              v-for="cat in customCategories" 
              :key="cat.id" 
              :value="cat.id"
            >
              <el-tag :style="{ color: cat.color, borderColor: cat.color }" effect="plain" size="small">
                {{ cat.name }}
              </el-tag>
            </el-checkbox>
          </div>
        </el-checkbox-group>
        <div v-else style="text-align: center; padding: 20px 0; color: var(--el-text-color-secondary);">
          暂无自定义分类，请先点击页面右上角的「分类管理」进行创建。
        </div>
      </div>
      <template #footer>
        <el-button @click="scaleCategorySetVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSaveScaleCategories" :disabled="customCategories.length === 0">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.scale-list-view {
  max-width: 100%;
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

/* 表格全局与行高样式修复 */
:deep(.custom-scale-table .el-table__row) {
  height: 72px;
}

:deep(.custom-scale-table .el-table__cell) {
  padding: 0 !important;
}

.scale-name-cell {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  width: 100%;
  text-align: left;
}

.scale-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  width: 100%;
}

.scale-name-text {
  font-weight: bold;
  font-size: 14px;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: calc(100% - 70px); /* 留空间给“当前适用”标签 */
}

.applicability-tag {
  font-size: 10px;
  padding: 0 4px;
  height: 16px;
  line-height: 14px;
  flex-shrink: 0;
}

.scale-name-en {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}

/* 分类列紧凑样式 */
.compact-category-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  width: 100%;
}

.compact-cat-tag {
  font-size: 12px;
  padding: 0 4px;
  height: 18px;
  line-height: 16px;
  max-width: 64px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0 !important;
}

/* 题数列紧凑样式 */
.compact-question-text {
  font-size: 13px;
  color: var(--el-text-color-primary);
}

/* 使用统计紧凑样式 */
.compact-stats-text {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}

.compact-stats-none {
  font-size: 13px;
  color: var(--el-text-color-placeholder);
}

/* 操作列靠右紧凑样式 */
.compact-actions-cell {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
  padding-right: 8px;
  box-sizing: border-box;
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

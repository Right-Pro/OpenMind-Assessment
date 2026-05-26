<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useScaleStore } from '@/stores/scaleStore'
import type { ScaleDefinition, ScaleQuestion, ScaleDimension } from '@/types'

const scaleStore = useScaleStore()

// 所有的分类选项
const categories = [
  { label: '情绪/心境', value: 'mood' },
  { label: '人格/个性', value: 'personality' },
  { label: '精神病辅助筛查', value: 'psychiatric' },
  { label: '认知测试', value: 'cognitive' },
  { label: '筛查量表', value: 'screening' },
  { label: '其他类型', value: 'other' }
]

// 编辑器中的量表定义状态
const editingScale = ref<ScaleDefinition>({
  id: '',
  name: '',
  description: '',
  version: '1.0.0',
  category: 'mood',
  tags: [],
  questions: [],
  scoring: {
    type: 'sum',
    dimensions: []
  },
  interpretation: {
    type: 'cutoff',
    cutoffs: []
  },
  settings: {
    allowBacktrack: true,
    allowSkip: false,
    minAnsweredPercent: 1.0,
    randomizeOrder: false
  },
  reportTemplate: {
    title: '',
    sections: [
      { type: 'header' },
      { type: 'score_table' },
      { type: 'dimension_chart' },
      { type: 'interpretation' },
      { type: 'suggestion' },
      { type: 'raw_data' }
    ]
  }
})

// 中间题目编辑区状态
const currentQuestionIndex = ref(0)
const editingQuestion = ref<ScaleQuestion | null>(null)

// 维度配置
const newDimensionName = ref('')
const newDimensionQuestionIds = ref('')
const newDimensionFormula = ref('')

// 临时新建量表弹框
const showNewDialog = ref(false)
const newScaleForm = ref({
  id: '',
  name: '',
  category: 'mood' as 'mood' | 'personality' | 'psychiatric' | 'cognitive' | 'screening' | 'other',
  questionCount: 10
})

onMounted(async () => {
  await scaleStore.loadScales()
  if (scaleStore.scales.length > 0) {
    loadScale(scaleStore.scales[0])
  }
})

// 用 ElLoading 控制大文件加载体验
import { ElLoading } from 'element-plus'

// 编辑现有量表
function loadScale(scale: ScaleDefinition) {
  // 对于题目很多的量表（如 MMPI），加载时可能会有短暂卡顿，添加 ElLoading 提示
  const loading = ElLoading.service({
    lock: true,
    text: '正在加载并解析量表数据，请稍候...',
    background: 'rgba(0, 0, 0, 0.7)'
  })

  // 使用 setTimeout 确保 Loading UI 能够正常渲染出来
  setTimeout(() => {
    try {
      // 深拷贝，避免直接修改 store 中的引用
      editingScale.value = JSON.parse(JSON.stringify(scale))
      
      // 确保 options 列表、scoring 存在
      if (!editingScale.value.scoring) {
        editingScale.value.scoring = { type: 'sum', dimensions: [] }
      }
      if (!editingScale.value.scoring.dimensions) {
        editingScale.value.scoring.dimensions = []
      }
      if (!editingScale.value.settings) {
        editingScale.value.settings = {
          allowBacktrack: true,
          allowSkip: false,
          minAnsweredPercent: 1.0,
          randomizeOrder: false
        }
      }
      if (!editingScale.value.reportTemplate) {
        editingScale.value.reportTemplate = {
          title: editingScale.value.name + '测评报告',
          sections: [
            { type: 'header' },
            { type: 'score_table' },
            { type: 'dimension_chart' },
            { type: 'interpretation' },
            { type: 'suggestion' },
            { type: 'raw_data' }
          ]
        }
      }

      currentQuestionIndex.value = 0
      syncCurrentQuestion()
    } catch (err: any) {
      ElMessage.error('加载量表失败: ' + err.message)
    } finally {
      loading.close()
    }
  }, 50)
}

// 同步中间编辑区的当前题目
function syncCurrentQuestion() {
  const qList = editingScale.value.questions
  if (qList && qList.length > 0) {
    if (currentQuestionIndex.value >= qList.length) {
      currentQuestionIndex.value = qList.length - 1
    }
    if (currentQuestionIndex.value < 0) {
      currentQuestionIndex.value = 0
    }
    editingQuestion.value = qList[currentQuestionIndex.value]
  } else {
    editingQuestion.value = null
  }
}

// 导航到指定题
function prevQuestion() {
  if (currentQuestionIndex.value > 0) {
    currentQuestionIndex.value--
    syncCurrentQuestion()
  }
}

function nextQuestion() {
  if (currentQuestionIndex.value < editingScale.value.questions.length - 1) {
    currentQuestionIndex.value++
    syncCurrentQuestion()
  }
}

function selectQuestion(idx: number) {
  currentQuestionIndex.value = idx
  syncCurrentQuestion()
}

// 动态增删选项
function addOption() {
  if (!editingQuestion.value) return
  if (!editingQuestion.value.options) {
    editingQuestion.value.options = []
  }
  const score = editingQuestion.value.options.length
  editingQuestion.value.options.push({
    label: `选项 ${score + 1}`,
    value: score,
    score: score
  })
}

// 移除选项
function removeOption(optIndex: number) {
  if (!editingQuestion.value || !editingQuestion.value.options) return
  editingQuestion.value.options.splice(optIndex, 1)
}

// 添加选项预设（如 0-3 级，1-5 级等）
function applyOptionPreset(presetType: '0-3' | '1-5' | 'yes-no') {
  if (!editingQuestion.value) return
  if (presetType === '0-3') {
    editingQuestion.value.options = [
      { label: '没有或很少时间', value: 0, score: 0 },
      { label: '小部分时间', value: 1, score: 1 },
      { label: '相当多时间', value: 2, score: 2 },
      { label: '绝大部分或全部时间', value: 3, score: 3 }
    ]
  } else if (presetType === '1-5') {
    editingQuestion.value.options = [
      { label: '完全不符合', value: 1, score: 1 },
      { label: '比较不符合', value: 2, score: 2 },
      { label: '稍微符合', value: 3, score: 3 },
      { label: '比较符合', value: 4, score: 4 },
      { label: '完全符合', value: 5, score: 5 }
    ]
  } else if (presetType === 'yes-no') {
    editingQuestion.value.options = [
      { label: '是', value: 1, score: 1 },
      { label: '否', value: 0, score: 0 }
    ]
  }
}

// 一键复制当前题目的选项配置到所有题目
function copyOptionsToAllQuestions() {
  if (!editingQuestion.value || !editingQuestion.value.options) return
  
  ElMessageBox.confirm(
    '是否确定将当前题目的选项配置复制应用到该量表的所有题目？这会覆盖其他题目原有的选项。',
    '提示',
    { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' }
  ).then(() => {
    const optsCopy = JSON.parse(JSON.stringify(editingQuestion.value!.options))
    editingScale.value.questions.forEach(q => {
      q.options = JSON.parse(JSON.stringify(optsCopy))
    })
    ElMessage.success('选项已成功应用到所有题目')
  }).catch(() => {})
}

// 维度配置逻辑
function addDimension() {
  if (!newDimensionName.value.trim()) {
    ElMessage.warning('请输入维度名称')
    return
  }
  
  // 解析题号
  // 支持格式：1,2,3 或者 1-3 或者混合 1,2,4-6
  const qIds: (string | number)[] = []
  const parts = newDimensionQuestionIds.value.split(',')
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    if (trimmed.includes('-')) {
      const range = trimmed.split('-')
      const start = parseInt(range[0])
      const end = parseInt(range[1])
      if (!isNaN(start) && !isNaN(end) && start <= end) {
        for (let i = start; i <= end; i++) {
          qIds.push(i)
        }
      }
    } else {
      const idNum = parseInt(trimmed)
      if (!isNaN(idNum)) {
        qIds.push(idNum)
      } else {
        qIds.push(trimmed) // 支持字符串 ID
      }
    }
  }

  if (qIds.length === 0) {
    ElMessage.warning('未能成功解析题号列表，请检查输入格式')
    return
  }

  const dim: ScaleDimension = {
    name: newDimensionName.value.trim(),
    questionIds: qIds,
    formula: newDimensionFormula.value.trim() || undefined
  }

  if (!editingScale.value.scoring.dimensions) {
    editingScale.value.scoring.dimensions = []
  }
  editingScale.value.scoring.dimensions.push(dim)

  // 清空输入
  newDimensionName.value = ''
  newDimensionQuestionIds.value = ''
  newDimensionFormula.value = ''
  ElMessage.success('维度添加成功')
}

function removeDimension(index: number) {
  if (editingScale.value.scoring.dimensions) {
    editingScale.value.scoring.dimensions.splice(index, 1)
  }
}

// 创建新量表逻辑
function openNewScaleDialog() {
  newScaleForm.value = {
    id: '',
    name: '',
    category: 'mood',
    questionCount: 10
  }
  showNewDialog.value = true
}

function createNewScale() {
  const { id, name, category, questionCount } = newScaleForm.value
  if (!id || !name) {
    ElMessage.warning('量表 ID 和名称不能为空')
    return
  }
  
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    ElMessage.warning('量表 ID 只能是英文字母、数字、下划线或连字符')
    return
  }

  // 生成空题目框架
  const questions: ScaleQuestion[] = []
  for (let i = 1; i <= questionCount; i++) {
    questions.push({
      id: i,
      text: `题目 ${i} 的具体描述...`,
      options: [
        { label: '否', value: 0, score: 0 },
        { label: '是', value: 1, score: 1 }
      ]
    })
  }

  editingScale.value = {
    id,
    name,
    description: `${name}的量表说明描述...`,
    version: '1.0.0',
    category,
    tags: [category],
    questions,
    scoring: {
      type: 'sum',
      dimensions: []
    },
    interpretation: {
      type: 'cutoff',
      cutoffs: [
        { min: 0, max: questionCount, label: '正常', severity: 'none', color: '#67C23A', description: '处于正常范围' }
      ]
    },
    settings: {
      allowBacktrack: true,
      allowSkip: false,
      minAnsweredPercent: 1.0,
      randomizeOrder: false
    },
    reportTemplate: {
      title: `${name}测评报告`,
      sections: [
        { type: 'header' },
        { type: 'score_table' },
        { type: 'dimension_chart' },
        { type: 'interpretation' },
        { type: 'suggestion' },
        { type: 'raw_data' }
      ]
    }
  }

  currentQuestionIndex.value = 0
  syncCurrentQuestion()
  showNewDialog.value = false
  ElMessage.success('成功新建量表框架！')
}

// 保存量表
async function handleSaveScale() {
  if (!editingScale.value.id || !editingScale.value.name) {
    ElMessage.warning('量表唯一标识ID和名称不能为空')
    return
  }

  try {
    // Vue 3 Composition API 的 ref 在传递给 Electron IPC (基于 HTML5 Structured Clone 算法) 时，
    // 由于内部包含 Proxy 或复杂响应式引用，可能会引发 "An object could not be cloned." 错误。
    // 在传递前使用 JSON.parse(JSON.stringify(...)) 或 toRaw 将其克隆/还原为原生普通 JavaScript 对象。
    const rawScaleObj = JSON.parse(JSON.stringify(editingScale.value))
    const res = await window.electronAPI.saveScale(rawScaleObj)
    if (res.success) {
      ElMessage.success('量表 JSON 保存成功，且通过了 Schema 校验！')
      // 重新加载 Store 量表列表，实现热插拔/自动热加载更新
      await scaleStore.loadScales()
    } else {
      ElMessageBox.alert(res.message, '保存失败（校验未通过）', {
        type: 'error',
        confirmButtonText: '确定'
      })
    }
  } catch (err: any) {
    ElMessage.error('保存失败: ' + err.message)
  }
}
</script>

<template>
  <div class="scale-editor-view">
    <!-- 顶部控制条 -->
    <div class="editor-header">
      <div class="title-section">
        <h2>量表可视化编辑器</h2>
        <span class="sub-title">管理员专用量表 JSON 快速配置与编辑</span>
      </div>
      <div class="action-buttons">
        <el-button type="success" size="default" @click="openNewScaleDialog">
          <el-icon><Plus /></el-icon>
          新建量表
        </el-button>
        <el-button type="primary" size="default" @click="handleSaveScale">
          <el-icon><DocumentChecked /></el-icon>
          保存到文件
        </el-button>
      </div>
    </div>

    <!-- 三栏式布局区 -->
    <div class="editor-layout">
      <!-- 左侧：量表列表 -->
      <div class="layout-column left-col">
        <div class="col-header">
          <span>量表列表</span>
          <el-badge :value="scaleStore.scales.length" type="info" />
        </div>
        <div class="col-body scale-list-container scrollable-y">
          <div
            v-for="s in scaleStore.scales"
            :key="s.id"
            class="scale-item"
            :class="{ active: s.id === editingScale.id }"
            @click="loadScale(s)"
          >
            <div class="scale-name">{{ s.name }}</div>
            <div class="scale-id-tag">
              <el-tag size="small" type="info">{{ s.id }}</el-tag>
              <el-tag size="small" style="margin-left: 4px;" type="success">{{ s.questions.length }}题</el-tag>
            </div>
          </div>
        </div>
      </div>

      <!-- 中间：题目与基本配置编辑区 -->
      <div class="layout-column center-col">
        <div class="col-header">
          <span>量表配置 & 题目编辑</span>
        </div>
        <div class="col-body editor-scroller scrollable-y">
          <!-- 基本配置部分 -->
          <el-card shadow="never" class="section-card">
            <template #header>
              <span class="card-title">基本信息配置</span>
            </template>
            <el-form label-width="auto" size="small">
              <el-row :gutter="12">
                <el-col :span="12">
                  <el-form-item label="量表唯一ID" required>
                    <el-input v-model="editingScale.id" placeholder="如 PHQ-9" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="显示名称" required>
                    <el-input v-model="editingScale.name" placeholder="如 睡眠质量指数量表" />
                  </el-form-item>
                </el-col>
              </el-row>
              <el-row :gutter="12">
                <el-col :span="12">
                  <el-form-item label="英文名称">
                    <el-input v-model="editingScale.name_en" placeholder="Hamilton Rating Scale" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="版本号">
                    <el-input v-model="editingScale.version" placeholder="1.0.0" />
                  </el-form-item>
                </el-col>
              </el-row>
              <el-row :gutter="12">
                <el-col :span="12">
                  <el-form-item label="量表类型">
                    <el-select v-model="editingScale.category" style="width: 100%;">
                      <el-option
                        v-for="cat in categories"
                        :key="cat.value"
                        :label="cat.label"
                        :value="cat.value"
                      />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="计分模型类型">
                    <el-select v-model="editingScale.scoring.type" style="width: 100%;">
                      <el-option label="总分制 (Sum)" value="sum" />
                      <el-option label="平均分 (Average)" value="average" />
                      <el-option label="加权计分 (Weighted)" value="weighted" />
                      <el-option label="公式计算 (Formula)" value="formula" />
                      <el-option label="MMPI 专用" value="mmpi" />
                    </el-select>
                  </el-form-item>
                </el-col>
              </el-row>
              <el-form-item label="总分计算公式" v-if="editingScale.scoring.type === 'formula'">
                <el-input v-model="editingScale.scoring.formula" placeholder="如 (sum - 20) * 1.25" />
              </el-form-item>
              <el-form-item label="详细说明描述">
                <el-input
                  v-model="editingScale.description"
                  type="textarea"
                  :rows="2"
                  placeholder="量表指导语、使用说明与诊断界值简介"
                />
              </el-form-item>
            </el-form>
          </el-card>

          <!-- 作答规则控制卡片 -->
          <el-card shadow="never" class="section-card">
            <template #header>
              <span class="card-title">作答与控制设置</span>
            </template>
            <el-form label-width="auto" size="small">
              <el-row :gutter="12">
                <el-col :span="12">
                  <el-form-item label="允许返回上一题">
                    <el-switch v-model="editingScale.settings.allowBacktrack" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="允许跳过不答">
                    <el-switch v-model="editingScale.settings.allowSkip" />
                  </el-form-item>
                </el-col>
              </el-row>
              <el-row :gutter="12">
                <el-col :span="12">
                  <el-form-item label="限时时间(分钟)">
                    <el-input-number v-model="editingScale.settings.timeLimit" :min="0" placeholder="0为不限时" style="width: 100%;" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="最低作答比例">
                    <el-input-number v-model="editingScale.settings.minAnsweredPercent" :min="0" :max="1" :step="0.1" style="width: 100%;" />
                  </el-form-item>
                </el-col>
              </el-row>
            </el-form>
          </el-card>

          <!-- 题目单独编辑部分 -->
          <el-card shadow="never" class="section-card" v-if="editingQuestion">
            <template #header>
              <div class="question-header-bar">
                <span class="card-title">题目内容配置：第 {{ currentQuestionIndex + 1 }} / {{ editingScale.questions.length }} 题</span>
                <div class="preset-box">
                  <el-button size="small" plain @click="applyOptionPreset('0-3')">0-3级选项</el-button>
                  <el-button size="small" plain @click="applyOptionPreset('1-5')">1-5级选项</el-button>
                  <el-button size="small" plain @click="applyOptionPreset('yes-no')">是否选项</el-button>
                </div>
              </div>
            </template>

            <el-form label-width="auto" size="small">
              <el-form-item label="题干文本" required>
                <el-input v-model="editingQuestion.text" placeholder="请输入题目题干文本说明" />
              </el-form-item>
              <el-form-item label="补充子干">
                <el-input v-model="editingQuestion.subText" placeholder="针对本题的补充说明，如“请根据最近一周感受”" />
              </el-form-item>
              
              <el-row :gutter="12">
                <el-col :span="12">
                  <el-form-item label="反向计分">
                    <el-switch v-model="editingQuestion.reverse" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="所属维度因子">
                    <el-input v-model="editingQuestion.dimension" placeholder="如 躯体化 / 焦虑因子" />
                  </el-form-item>
                </el-col>
              </el-row>

              <!-- 选项列表配置 -->
              <div class="options-edit-section">
                <div class="section-sub-title">选项答案与计分规则</div>
                <div
                  v-for="(opt, oIdx) in editingQuestion.options"
                  :key="oIdx"
                  class="option-edit-row"
                >
                  <el-input v-model="opt.label" placeholder="选项文字标签，如“偶有”" style="flex: 2;" />
                  <el-input v-model="opt.value" placeholder="分值" style="flex: 1;" />
                  <el-input-number v-model="opt.score" placeholder="计分" style="width: 90px;" />
                  <el-button type="danger" circle size="small" @click="removeOption(oIdx)">
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </div>
                <div class="option-actions">
                  <el-button type="primary" plain size="small" @click="addOption">
                    <el-icon><Plus /></el-icon>
                    添加选项
                  </el-button>
                  <el-button type="warning" plain size="small" @click="copyOptionsToAllQuestions">
                    一键同步此选项到所有题目
                  </el-button>
                </div>
              </div>
            </el-form>

            <!-- 上一题下一题导航按钮 -->
            <div class="question-nav-buttons">
              <el-button-group>
                <el-button
                  type="primary"
                  :disabled="currentQuestionIndex === 0"
                  @click="prevQuestion"
                >
                  <el-icon><ArrowLeft /></el-icon>
                  上一题
                </el-button>
                <el-button
                  type="primary"
                  :disabled="currentQuestionIndex === editingScale.questions.length - 1"
                  @click="nextQuestion"
                >
                  下一题
                  <el-icon><ArrowRight /></el-icon>
                </el-button>
              </el-button-group>
            </div>
          </el-card>

          <!-- 题号导航网格 -->
          <el-card shadow="never" class="section-card" style="margin-bottom: 24px;">
            <template #header>
              <span class="card-title">题号快速跳转导航网格</span>
            </template>
            <div class="grid-nav-container">
              <div
                v-for="(q, idx) in editingScale.questions"
                :key="idx"
                class="nav-grid-cell"
                :class="{ current: idx === currentQuestionIndex }"
                @click="selectQuestion(idx)"
              >
                {{ idx + 1 }}
              </div>
            </div>
          </el-card>
        </div>
      </div>

      <!-- 右侧：分维度配置 -->
      <div class="layout-column right-col">
        <div class="col-header">
          <span>量表维度配置 (Dimensions)</span>
        </div>
        <div class="col-body right-col-scroller scrollable-y">
          <div class="add-dim-form">
            <h4>添加新维度</h4>
            <el-form label-position="top" size="small">
              <el-form-item label="维度/因子名称">
                <el-input v-model="newDimensionName" placeholder="如：躯体化因子" />
              </el-form-item>
              <el-form-item label="包含题号 (如 1,3-5,7)">
                <el-input v-model="newDimensionQuestionIds" placeholder="示例: 1,3,5 或 1-5" />
              </el-form-item>
              <el-form-item label="计分公式 (可选)">
                <el-input v-model="newDimensionFormula" placeholder="默认直接求和，或输入如 sum/5" />
              </el-form-item>
              <el-button type="primary" size="small" style="width: 100%;" @click="addDimension">
                <el-icon><Plus /></el-icon>
                添加维度
              </el-button>
            </el-form>
          </div>

          <el-divider style="margin: 16px 0;" />

          <div class="dim-list">
            <h4>已配置的维度 ({{ editingScale.scoring.dimensions?.length || 0 }})</h4>
            <div
              v-for="(dim, dIdx) in editingScale.scoring.dimensions"
              :key="dIdx"
              class="dim-item-card"
            >
              <div class="dim-item-header">
                <strong>{{ dim.name }}</strong>
                <el-button type="danger" link size="small" @click="removeDimension(dIdx)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
              <div class="dim-item-content">
                <div class="meta-row"><strong>公式：</strong>{{ dim.formula || '无（求和）' }}</div>
                <div class="meta-row font-secondary">
                  <strong>题号范围：</strong>{{ dim.questionIds.join(', ') }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 新建量表弹框对话框 -->
    <el-dialog
      v-model="showNewDialog"
      title="新建量表配置向导"
      width="440px"
      align-center
    >
      <el-form :model="newScaleForm" label-width="auto" size="small">
        <el-form-item label="量表唯一ID" required>
          <el-input v-model="newScaleForm.id" placeholder="只能使用英文/数字, 如 GAD-7" />
        </el-form-item>
        <el-form-item label="量表名称" required>
          <el-input v-model="newScaleForm.name" placeholder="量表中文名称" />
        </el-form-item>
        <el-form-item label="类型分组">
          <el-select v-model="newScaleForm.category" style="width: 100%;">
            <el-option
              v-for="cat in categories"
              :key="cat.value"
              :label="cat.label"
              :value="cat.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="预设题目数">
          <el-input-number v-model="newScaleForm.questionCount" :min="1" :max="1000" style="width: 100%;" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showNewDialog = false">取消</el-button>
        <el-button type="primary" @click="createNewScale">生成量表</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.scale-editor-view {
  display: flex;
  flex-direction: column;
  height: 100vh; /* 使用绝对的 100vh，这样可以自适应所有显示高度 */
  margin: -32px -40px; /* 抵消 .fluent-content-container 的 padding: 32px 40px */
  background: var(--app-bg, #f5f7fa);
  overflow: hidden;
  position: relative;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: var(--app-card, #fff);
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
}

.editor-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.sub-title {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.editor-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.layout-column {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--el-border-color);
  height: 100%;
  overflow: hidden;
}

.col-header {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color);
  font-weight: 600;
  font-size: 13px;
  flex-shrink: 0;
}

.col-body {
  flex: 1;
  overflow: hidden;
  padding: 16px;
}

.scrollable-y {
  overflow-y: auto;
  flex: 1;
}

/* 左侧：量表列表 */
.left-col {
  width: 240px;
  flex-shrink: 0;
  height: 100%;
}

.scale-list-container {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.scale-item {
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s;
}

.scale-item:hover {
  background: var(--el-fill-color-light);
}

.scale-item.active {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-5);
}

.scale-name {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 4px;
}

.scale-id-tag {
  display: flex;
  align-items: center;
}

/* 中间：编辑区 */
.center-col {
  flex: 1;
  min-width: 480px;
}

.editor-scroller {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-card {
  border-radius: 8px;
}

.card-title {
  font-weight: 600;
  font-size: 14px;
}

.question-header-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.preset-box {
  display: flex;
  gap: 6px;
}

.options-edit-section {
  border-top: 1px dashed var(--el-border-color);
  margin-top: 16px;
  padding-top: 16px;
}

.section-sub-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--el-text-color-regular);
}

.option-edit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.option-actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}

.question-nav-buttons {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}

.grid-nav-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
  gap: 6px;
}

.nav-grid-cell {
  height: 32px;
  border-radius: 4px;
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-blank);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  transition: all 0.2s;
}

.nav-grid-cell:hover {
  border-color: var(--el-color-primary);
}

.nav-grid-cell.current {
  background: var(--el-color-primary);
  border-color: var(--el-color-primary);
  color: #fff;
  font-weight: bold;
}

/* 右侧：维度配置 */
.right-col {
  width: 280px;
  flex-shrink: 0;
  height: 100%;
}

.right-col-scroller {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.add-dim-form h4,
.dim-list h4 {
  margin: 0 0 12px 0;
  font-size: 13px;
  font-weight: 600;
}

.dim-item-card {
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 8px;
  background: var(--el-fill-color-blank);
}

.dim-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-size: 13px;
}

.dim-item-content {
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.meta-row {
  margin-bottom: 4px;
}

.font-secondary {
  color: var(--el-text-color-secondary);
}

.editor-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
  margin-bottom: 0;
}

/* 暗色模式适配 */
.dark .editor-header,
.dark .scale-item:hover,
.dark .col-header,
.dark .dim-item-card {
  background: var(--fluent-subtle-fill-hover, #1a2636);
}

.dark .scale-item.active {
  background: var(--fluent-subtle-fill, var(--el-color-primary-light-8));
}
</style>

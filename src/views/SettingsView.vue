<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settingsStore'
import { useScaleStore } from '@/stores/scaleStore'
import { useUserStore } from '@/stores/userStore'
import { useAuthStore } from '@/stores/authStore'
import { usePackageStore } from '@/stores/packageStore'
import { ElMessage, ElMessageBox, ElLoading } from 'element-plus'
import * as XLSX from 'xlsx'

const router = useRouter()
const settingsStore = useSettingsStore()
const scaleStore = useScaleStore()
const userStore = useUserStore()
const authStore = useAuthStore()
const packageStore = usePackageStore()

// 操作员管理数据与状态
const operatorsList = ref<any[]>([])
const showAddOperatorDialog = ref(false)
const showResetPasswordDialog = ref(false)
const addOperatorForm = ref({
  username: '',
  name: '',
  password: '',
  role: 'operator'
})
const resetPasswordForm = ref({
  id: 0,
  username: '',
  password: ''
})

const unitForm = ref({
  name: settingsStore.unitName,
  desc: settingsStore.unitDesc
})

// 自动备份 Form
const autoBackupForm = ref({
  enabled: false,
  period: 'daily' as 'daily' | 'weekly',
  backupDir: '',
  keepCount: 7
})

// 数据库加密 Form
const isDbEncrypted = ref(false)
const encryptForm = ref({
  password: '',
  confirmPassword: ''
})
const changePasswordForm = ref({
  oldPassword: '',
  newPassword: '',
  confirmNewPassword: ''
})
const decryptForm = ref({
  password: ''
})

// 测评套餐表单与状态
const showAddPackageDialog = ref(false)
const editingPackageId = ref<number | null>(null)
const addPackageForm = ref({
  name: '',
  scaleIds: [] as string[]
})

function openAddPackageDialog() {
  editingPackageId.value = null
  addPackageForm.value = { name: '', scaleIds: [] }
  showAddPackageDialog.value = true
}

function openEditPackageDialog(row: any) {
  editingPackageId.value = row.id
  addPackageForm.value = {
    name: row.name,
    scaleIds: [...(row.scale_ids || row.scaleIds || [])]
  }
  showAddPackageDialog.value = true
}

onMounted(async () => {
  unitForm.value.name = settingsStore.unitName
  unitForm.value.desc = settingsStore.unitDesc

  // 加载量表
  await scaleStore.loadScales()

  // 初始化加载自动备份配置
  if (window.electronAPI) {
    const backupConfig = await window.electronAPI.getAutoBackupConfig()
    autoBackupForm.value = { ...backupConfig }

    const encryptConfig = await window.electronAPI.getDbEncryptionConfig()
    isDbEncrypted.value = encryptConfig.enabled

    // 加载套餐
    await packageStore.loadPackages()

    // 如果是 admin，加载操作员列表
    if (authStore.currentOperator?.role === 'admin') {
      await loadOperators()
    }
  }
})

async function handleAddPackage() {
  const { name, scaleIds } = addPackageForm.value
  if (!name) {
    ElMessage.warning('请输入套餐名称')
    return
  }
  if (scaleIds.length === 0) {
    ElMessage.warning('请选择至少一个量表')
    return
  }

  const id = editingPackageId.value ? editingPackageId.value : undefined
  const res = await packageStore.savePackage(name, scaleIds, id)
  if (res.success) {
    ElMessage.success(id ? '测评套餐修改成功' : '测评套餐添加成功')
    showAddPackageDialog.value = false
    addPackageForm.value = { name: '', scaleIds: [] }
    editingPackageId.value = null
  } else {
    ElMessage.error(res.error || (id ? '修改套餐失败' : '添加套餐失败'))
  }
}

async function handleDeletePackage(id: number) {
  try {
    await ElMessageBox.confirm('确定要删除该测评套餐吗？', '确认删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    const res = await packageStore.deletePackage(id)
    if (res.success) {
      ElMessage.success('套餐删除成功')
    } else {
      ElMessage.error(res.error || '删除失败')
    }
  } catch {}
}

async function loadOperators() {
  if (window.electronAPI) {
    operatorsList.value = await window.electronAPI.getOperators()
  }
}

async function handleAddOperator() {
  const { username, name, password, role } = addOperatorForm.value
  if (!username || !name || !password) {
    ElMessage.warning('请填写所有必填项')
    return
  }
  if (password.length < 6) {
    ElMessage.warning('密码长度至少为 6 位')
    return
  }

  try {
    const res = await window.electronAPI.addOperatorByAdmin(username, password, role, name)
    if (res.success) {
      ElMessage.success('操作员添加成功！')
      showAddOperatorDialog.value = false
      addOperatorForm.value = { username: '', name: '', password: '', role: 'operator' }
      await loadOperators()
    } else {
      ElMessage.error(res.error || '添加失败')
    }
  } catch (e: any) {
    ElMessage.error('添加失败: ' + e.message)
  }
}

async function handleDeleteOperator(row: any) {
  if (row.id === authStore.currentOperator?.id) {
    ElMessage.error('无法删除当前正在登录的账号！')
    return
  }

  try {
    await ElMessageBox.confirm(`确定要永久删除操作员账户 "${row.username}" (${row.name}) 吗？`, '删除确认', {
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
      type: 'warning'
    })

    const res = await window.electronAPI.deleteOperatorByAdmin(row.id)
    if (res.success) {
      ElMessage.success('操作员已成功删除！')
      await loadOperators()
    } else {
      ElMessage.error(res.error || '删除失败')
    }
  } catch {}
}

function openResetPasswordDialog(row: any) {
  resetPasswordForm.value = {
    id: row.id,
    username: row.username,
    password: ''
  }
  showResetPasswordDialog.value = true
}

async function handleResetPassword() {
  const { id, password } = resetPasswordForm.value
  if (!password) {
    ElMessage.warning('请输入新密码')
    return
  }
  if (password.length < 6) {
    ElMessage.warning('密码长度至少为 6 位')
    return
  }

  try {
    const res = await window.electronAPI.resetOperatorPasswordByAdmin(id, password)
    if (res.success) {
      ElMessage.success('密码重置成功！')
      showResetPasswordDialog.value = false
      resetPasswordForm.value = { id: 0, username: '', password: '' }
    } else {
      ElMessage.error(res.error || '重置失败')
    }
  } catch (e: any) {
    ElMessage.error('重置密码失败: ' + e.message)
  }
}

async function saveAutoBackupConfig() {
  if (window.electronAPI) {
    await window.electronAPI.saveAutoBackupConfig(JSON.parse(JSON.stringify(autoBackupForm.value)))
    ElMessage.success('自动备份设置已保存')
  }
}

async function selectBackupFolder() {
  if (window.electronAPI) {
    const { canceled, filePaths } = await window.electronAPI.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
    if (!canceled && filePaths.length > 0) {
      autoBackupForm.value.backupDir = filePaths[0]
      await saveAutoBackupConfig()
    }
  }
}

async function triggerManualAutoBackup() {
  if (window.electronAPI) {
    const loading = ElLoading.service({ text: '正在进行数据备份...' })
    const res = await window.electronAPI.triggerManualAutoBackup()
    loading.close()
    if (res.success) {
      ElMessage.success('数据备份完成！')
    } else {
      ElMessage.error('数据备份失败: ' + res.message)
    }
  }
}

async function enableEncryption() {
  if (!encryptForm.value.password) {
    ElMessage.warning('请输入加密密码')
    return
  }
  if (encryptForm.value.password !== encryptForm.value.confirmPassword) {
    ElMessage.warning('两次输入密码不一致')
    return
  }

  try {
    await ElMessageBox.confirm(
      '启用加密后，每次启动软件将默认校验安全密码（由系统秘钥进行安全验证），明文数据库文件将被物理删除以保护被试隐私。请务必牢记密码。是否继续？',
      '启用数据库加密',
      { confirmButtonText: '确定启用', cancelButtonText: '取消', type: 'warning' }
    )

    if (window.electronAPI) {
      const loading = ElLoading.service({ text: '正在对数据库进行加密，请稍后...' })
      const res = await window.electronAPI.enableDbEncryption(encryptForm.value.password)
      loading.close()
      if (res.success) {
        ElMessage.success('数据库已成功加密！')
        isDbEncrypted.value = true
        encryptForm.value.password = ''
        encryptForm.value.confirmPassword = ''
      } else {
        ElMessage.error('加密失败: ' + res.error)
      }
    }
  } catch {}
}

async function changePassword() {
  if (!changePasswordForm.value.oldPassword || !changePasswordForm.value.newPassword) {
    ElMessage.warning('请输入密码内容')
    return
  }
  if (changePasswordForm.value.newPassword !== changePasswordForm.value.confirmNewPassword) {
    ElMessage.warning('新密码与确认新密码不一致')
    return
  }

  if (window.electronAPI) {
    const loading = ElLoading.service({ text: '正在修改密码...' })
    const res = await window.electronAPI.changeDbPassword(
      changePasswordForm.value.oldPassword,
      changePasswordForm.value.newPassword
    )
    loading.close()
    if (res.success) {
      ElMessage.success('密码修改成功！')
      changePasswordForm.value.oldPassword = ''
      changePasswordForm.value.newPassword = ''
      changePasswordForm.value.confirmNewPassword = ''
    } else {
      ElMessage.error('密码修改失败: ' + res.error)
    }
  }
}

async function disableEncryption() {
  if (!decryptForm.value.password) {
    ElMessage.warning('请输入当前验证密码')
    return
  }

  try {
    await ElMessageBox.confirm(
      '停用加密后，数据库将恢复为明文存储，请知悉相关被试隐私风险。是否确认？',
      '停用数据库加密',
      { confirmButtonText: '确定停用', cancelButtonText: '取消', type: 'warning' }
    )

    if (window.electronAPI) {
      const loading = ElLoading.service({ text: '正在解密数据库...' })
      const res = await window.electronAPI.disableDbEncryption(decryptForm.value.password)
      loading.close()
      if (res.success) {
        ElMessage.success('数据库已成功恢复为明文存储。')
        isDbEncrypted.value = false
        decryptForm.value.password = ''
      } else {
        ElMessage.error('解密失败: ' + res.error)
      }
    }
  } catch {}
}

async function saveUnitInfo() {
  await settingsStore.setUnitInfo(unitForm.value.name, unitForm.value.desc)
  ElMessage.success('单位信息已保存')
}

async function handleLogoChange(file: any) {
  const rawFile = file.raw || file
  if (!rawFile) return

  // 限制图片格式为 png, jpg, jpeg
  const isValidFormat = ['image/png', 'image/jpeg', 'image/jpg'].includes(rawFile.type)
  if (!isValidFormat) {
    ElMessage.error('图片只能是 PNG 或 JPG/JPEG 格式!')
    return
  }

  // 限制图片大小 <= 500KB
  const isLt500K = rawFile.size / 1024 < 500
  if (!isLt500K) {
    ElMessage.error('图片大小不能超过 500KB!')
    return
  }

  const reader = new FileReader()
  reader.readAsDataURL(rawFile)
  reader.onload = async () => {
    const base64Str = reader.result as string
    await settingsStore.setUnitLogo(base64Str)
    ElMessage.success('单位 Logo 上传成功')
  }
  reader.onerror = () => {
    ElMessage.error('读取图片失败')
  }
}

async function handleDeleteLogo() {
  try {
    await ElMessageBox.confirm('确定要删除单位 Logo 吗？', '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await settingsStore.deleteUnitLogo()
    ElMessage.success('Logo 已删除')
  } catch {}
}

async function backupDatabase() {
  const result = await window.electronAPI.dbBackup()
  if (result.success) {
    ElMessage.success(`备份已保存: ${result.path}`)
  } else {
    ElMessage.error(result.message ? `备份失败: ${result.message}` : '备份取消')
  }
}

async function restoreDatabase() {
  try {
    await ElMessageBox.confirm(
      '恢复备份会覆盖当前所有的用户和测试记录。建议操作前先备份当前数据库。是否继续？',
      '恢复数据库备份',
      { confirmButtonText: '确认恢复', cancelButtonText: '取消', type: 'warning' }
    )

    // 保存恢复前选中的用户信息，用于恢复后匹配
    const oldUser = userStore.currentUser

    const result = await window.electronAPI.dbRestore()
    if (result.success) {
      ElMessage.success('数据库已成功恢复')
      // 恢复成功后，需要重新加载当前数据（比如重新加载设置和用户列表）
      await settingsStore.init()
      await userStore.loadUsers()

      // 智能匹配并还原选中的用户：
      // 1. 优先根据 ID 匹配
      // 2. 其次根据 姓名+性别 匹配
      // 3. 如果都匹配不上但数据库不为空，则默认选择恢复后的第一个用户，避免左下角为空
      let matchedUser = null
      if (oldUser) {
        matchedUser = userStore.users.find(u => u.id === oldUser.id)
        if (!matchedUser) {
          matchedUser = userStore.users.find(u => u.name === oldUser.name && u.gender === oldUser.gender)
        }
      }

      if (!matchedUser && userStore.users.length > 0) {
        matchedUser = userStore.users[0]
      }

      if (matchedUser) {
        userStore.setCurrentUser(matchedUser)
      } else {
        userStore.setCurrentUser(null)
      }
    } else {
      ElMessage.error(result.message ? `恢复失败: ${result.message}` : '已取消恢复')
    }
  } catch {
    // 取消或错误
  }
}

// 缓存的数据库物理路径，在界面挂载后加载显示给用户
const databasePhysicalPath = ref('加载中...')

onMounted(async () => {
  if (window.electronAPI && typeof window.electronAPI.getDatabasePath === 'function') {
    databasePhysicalPath.value = await window.electronAPI.getDatabasePath()
  } else {
    databasePhysicalPath.value = '纯前端本地模拟模式'
  }
})

// 清空所有数据：清除包括系统设置在内的所有数据，除了量表本身以外所有数据都删除，两次确认后自动重启
async function clearAllData() {
  try {
    await ElMessageBox.confirm(
      '确定要清空【所有数据】吗？此操作将清除所有被试记录、测试记录、管理员账号、系统设置以及数据库凭证加密信息，并自动关闭/重启程序进入全新配置状态！',
      '首次危险警告',
      { confirmButtonText: '下一步确认', cancelButtonText: '取消', type: 'warning' }
    )

    await ElMessageBox.confirm(
      '【终极二次确认】您正在删除包括系统配置、管理员账号、被试及其所有测评档案在内的全部本地数据库文件！请确保您已手动备份。继续此操作将立即删除数据并重启程序，是否确定？',
      '二次高危确认',
      { confirmButtonText: '彻底清空并重启', cancelButtonText: '取消', type: 'warning' }
    )
    
    if (window.electronAPI && typeof window.electronAPI.wipeAllData === 'function') {
      const res = await window.electronAPI.wipeAllData()
      if (res.success) {
        ElMessage.success('所有本地数据已彻底清除，程序正在重启...')
        setTimeout(() => {
          window.electronAPI.relaunchApp()
        }, 1500)
      } else {
        ElMessage.error('物理清空失败: ' + (res.message || '未知错误'))
      }
    } else {
      // 纯网页环境降级处理
      localStorage.clear()
      ElMessage.success('本地存储已全部清空，请手动刷新页面')
      setTimeout(() => {
        window.location.reload()
      }, 1000)
    }
  } catch {
    // 取消
  }
}

// 仅清除历史测评与预约记录：保留管理员/操作员账号、备份设置、系统配置，仅删除被试、测评和预约记录
async function clearTestingRecordsOnly() {
  try {
    await ElMessageBox.confirm(
      '确定要清除所有被试和测评记录吗？这会删除所有的被试信息、答题历史记录、以及预约提醒，但会【保留】您的管理员/操作员账号、自动备份设置、及单位信息等系统设置。',
      '清除测评数据确认',
      { confirmButtonText: '确认清除测评数据', cancelButtonText: '取消', type: 'warning' }
    )
    
    if (window.electronAPI && typeof window.electronAPI.wipeTestingData === 'function') {
      const res = await window.electronAPI.wipeTestingData()
      if (res.success) {
        userStore.setCurrentUser(null)
        await userStore.loadUsers()
        ElMessage.success('测评历史数据与被试记录清空成功！系统设置与账户已保留。')
      } else {
        ElMessage.error('清除测评数据失败: ' + (res.message || '未知错误'))
      }
    } else {
      localStorage.removeItem('local_users')
      localStorage.removeItem('local_tests')
      userStore.setCurrentUser(null)
      await userStore.loadUsers()
      ElMessage.success('测评历史数据已清空')
    }
  } catch {
    // 取消
  }
}

// 原始数据批量导出功能
async function exportRawData() {
  try {
    const totalCount = await window.electronAPI.getCompletedTestsCount()
    if (totalCount === 0) {
      ElMessage.warning('当前暂无任何已完成的测试记录可以导出。')
      return
    }

    await ElMessageBox.confirm(
      `即将导出所有测试的原始数据（共 ${totalCount} 条记录），文件可能较大。是否继续？`,
      '导出确认',
      {
        confirmButtonText: '开始导出',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    // 选择保存文件路径
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const defaultFilename = `OpenMind_RawData_${timestamp}.xlsx`

    const saveResult = await window.electronAPI.showSaveDialog({
      title: '导出测试原始数据',
      defaultPath: defaultFilename,
      filters: [{ name: 'Excel 工作表', extensions: ['xlsx'] }]
    })

    if (saveResult.canceled || !saveResult.filePath) {
      return
    }

    const loadingInstance = ElLoading.service({
      lock: true,
      text: '正在批量查询并拼装 Excel 原始矩阵中，请稍候...',
      background: 'rgba(0, 0, 0, 0.7)'
    })

    try {
      // 1. 分页加载全量数据，防止大吞吐量内存溢出
      const limit = 500
      const totalPages = Math.ceil(totalCount / limit)
      const allTestData: any[] = []

      for (let p = 0; p < totalPages; p++) {
        const batch = await window.electronAPI.getAllTestsForExport(p, limit)
        allTestData.push(...batch)
      }

      // 创建工作簿
      const wb = XLSX.utils.book_new()

      // 2. 组装第一张 Sheet: 测试汇总
      const summaryRows = allTestData.map(t => {
        let ageStr = '/'
        if (t.userBirthdate) {
          const birth = new Date(t.userBirthdate)
          const now = new Date()
          let calculatedAge = now.getFullYear() - birth.getFullYear()
          if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) {
            calculatedAge--
          }
          ageStr = String(calculatedAge >= 0 ? calculatedAge : 0)
        }

        let interpretationStr = '/'
        try {
          const res = JSON.parse(t.resultJson || '{}')
          interpretationStr = res.interpretation?.label || '/'
        } catch (_) {}

        return {
          '测试ID': t.id,
          '被试姓名': t.userName,
          '性别': t.userGender === 'male' ? '男' : t.userGender === 'female' ? '女' : '未指定',
          '出生日期': t.userBirthdate || '/',
          '计算年龄': ageStr,
          '量表名称': t.scaleName,
          '量表ID': t.scaleId,
          '原始分': t.rawScore,
          '标准分': t.stdScore,
          '测评结论': interpretationStr,
          '测试时间': t.createdAt,
          '用时(秒)': t.durationSeconds,
          '操作员': t.operatorName || '系统管理员'
        }
      })
      const summarySheet = XLSX.utils.json_to_sheet(summaryRows)
      XLSX.utils.book_append_sheet(wb, summarySheet, '测试汇总')

      // 3. 按量表 ID 分组组装 Sheet: 原始答案矩阵（宽表格式，对 SPSS 极度友好）
      const testsByScale: Record<string, any[]> = {}
      for (const t of allTestData) {
        if (!testsByScale[t.scaleId]) {
          testsByScale[t.scaleId] = []
        }
        testsByScale[t.scaleId].push(t)
      }

      for (const [scaleId, testsList] of Object.entries(testsByScale)) {
        // 获取该量表下所有测试出现过的 question_id，以确保表头宽度一致
        const questionIdSet = new Set<string>()
        testsList.forEach(t => {
          if (t.answers) {
            t.answers.forEach((a: any) => questionIdSet.add(a.question_id))
          }
        })
        // 排序 questionId 以形成 Q1, Q2, Q3 的完美次序
        const sortedQuestionIds = Array.from(questionIdSet).sort((a, b) => {
          const numA = parseInt(a.replace(/\D/g, ''))
          const numB = parseInt(b.replace(/\D/g, ''))
          if (!isNaN(numA) && !isNaN(numB)) return numA - numB
          return a.localeCompare(b)
        })

        const scaleMatrixRows = testsList.map(t => {
          let ageStr = '/'
          if (t.userBirthdate) {
            const birth = new Date(t.userBirthdate)
            const now = new Date()
            let calculatedAge = now.getFullYear() - birth.getFullYear()
            if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) {
              calculatedAge--
            }
            ageStr = String(calculatedAge >= 0 ? calculatedAge : 0)
          }

          // 核心元数据
          const rowData: Record<string, any> = {
            '测试ID': t.id,
            '姓名': t.userName,
            '性别': t.userGender === 'male' ? '男' : t.userGender === 'female' ? '女' : '未指定',
            '年龄': ageStr,
            '出生日期': t.userBirthdate || '/'
          }

          // 填充每个题目的答题原始选择分值
          const answerMap = new Map<string, number>()
          if (t.answers) {
            t.answers.forEach((a: any) => {
              answerMap.set(a.question_id, a.score)
            })
          }

          sortedQuestionIds.forEach(qId => {
            rowData[`Q_${qId}`] = answerMap.has(qId) ? answerMap.get(qId) : '/'
          })

          // 尾部追加总分/标准分/测评结论/时间
          let interpretationStr = '/'
          try {
            const res = JSON.parse(t.resultJson || '{}')
            interpretationStr = res.interpretation?.label || '/'
          } catch (_) {}

          rowData['总分'] = t.rawScore
          rowData['标准分'] = t.stdScore
          rowData['测评结论'] = interpretationStr
          rowData['测试时间'] = t.createdAt

          return rowData
        })

        const scaleSheet = XLSX.utils.json_to_sheet(scaleMatrixRows)
        // 限制 Sheet 命名长度不超过 31 字符（Excel 规范限制）
        const sheetName = scaleId.slice(0, 30)
        XLSX.utils.book_append_sheet(wb, scaleSheet, sheetName)
      }

      // 4. 将工作簿输出为 base64 数据并通过 IPC 让主进程安全写入磁盘
      const excelBase64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' })
      const writeResult = await window.electronAPI.saveBufferFile(saveResult.filePath, excelBase64)

      if (writeResult.success) {
        ElMessage.success(`导出成功！共导出 ${totalCount} 条测试记录`)
      } else {
        ElMessage.error('导出文件写入失败: ' + (writeResult.error || '未知错误'))
      }
    } catch (exportErr: any) {
      console.error(exportErr)
      ElMessage.error('拼装 Excel 数据出错: ' + exportErr.message)
    } finally {
      loadingInstance.close()
    }
  } catch (confirmErr) {
    // 用户取消
  }
}

function openScalesDir() {
  window.electronAPI.openScalesDir()
}

function goBack() {
  router.push('/')
}
</script>

<template>
  <div class="settings-view">
    <div class="page-header no-print">
      <div class="header-left">
        <el-button @click="goBack" circle>
          <el-icon><ArrowLeft /></el-icon>
        </el-button>
        <h2>系统设置</h2>
      </div>
    </div>

    <div class="settings-content">
      <!-- 权限限制提示：非 admin 仅展示只读和界面设置 -->
      <el-alert
        v-if="authStore.currentOperator?.role !== 'admin'"
        title="当前以 [普通操作员] 身份登录。系统级设置（自动备份、数据库加密、操作员管理、数据清空等）为只读或不可见状态，如需更改请联系管理员。"
        type="info"
        show-icon
        :closable="false"
        style="margin-bottom: 8px;"
      />

      <!-- 单位信息 -->
      <el-card class="settings-section">
        <template #header>
          <span>单位信息（用于报告页眉）</span>
        </template>
        <el-form :model="unitForm" label-width="100px">
          <el-form-item label="单位名称">
            <el-input v-model="unitForm.name" :disabled="authStore.currentOperator?.role !== 'admin'" placeholder="例如：某某心理咨询中心" />
          </el-form-item>
          <el-form-item label="单位简介">
            <el-input v-model="unitForm.desc" :disabled="authStore.currentOperator?.role !== 'admin'" type="textarea" rows="2" placeholder="简短介绍，显示在报告页眉" />
          </el-form-item>
          <el-form-item label="单位 Logo" v-if="authStore.currentOperator?.role === 'admin'">
            <div style="display: flex; align-items: center; gap: 16px;">
              <el-upload
                action=""
                :auto-upload="false"
                :show-file-list="false"
                :on-change="handleLogoChange"
                accept=".png,.jpg,.jpeg"
              >
                <el-button type="primary" size="small">上传 Logo</el-button>
              </el-upload>
              <div v-if="settingsStore.unitLogo" style="display: flex; align-items: center; gap: 12px;">
                <img :src="settingsStore.unitLogo" alt="Logo 预览" style="max-height: 40px; max-width: 150px; border: 1px solid var(--el-border-color); padding: 2px;" />
                <el-button type="danger" size="small" @click="handleDeleteLogo">删除</el-button>
              </div>
              <div v-else style="font-size: 12px; color: #909399;">
                未上传，将显示默认文字页眉
              </div>
            </div>
            <div style="font-size: 11px; color: #909399; margin-top: 4px; line-height: 1.4;">
              仅支持 PNG/JPG 格式，大小不超过 500KB，建议尺寸 200x60px（页眉左侧显示用）
            </div>
          </el-form-item>
          <el-form-item v-if="authStore.currentOperator?.role === 'admin'">
            <el-button type="primary" @click="saveUnitInfo">保存</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 界面设置 -->
      <el-card class="settings-section">
        <template #header>
          <span>界面设置</span>
        </template>
        <el-form label-width="180px">
          <el-form-item label="暗色模式">
            <el-switch
              :model-value="settingsStore.darkMode"
              @update:model-value="settingsStore.setDarkMode"
            />
          </el-form-item>
          <el-form-item label="字体大小">
            <el-radio-group
              :model-value="settingsStore.fontSize"
              @update:model-value="settingsStore.setFontSize"
            >
              <el-radio-button label="small">小</el-radio-button>
              <el-radio-button label="medium">中</el-radio-button>
              <el-radio-button label="large">大</el-radio-button>
              <el-radio-button label="xlarge">特大</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="显示题号">
            <el-switch
              :model-value="settingsStore.showQuestionNumber"
              @update:model-value="settingsStore.setShowQuestionNumber"
            />
          </el-form-item>
          <el-form-item label="答题页面背景">
            <el-radio-group
              :model-value="settingsStore.testPageBg"
              @update:model-value="settingsStore.setTestPageBg"
            >
              <el-radio-button label="default">默认灰色</el-radio-button>
              <el-radio-button label="eye">护眼绿色</el-radio-button>
              <el-radio-button label="contrast">高对比度</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="报告水印文字">
            <el-input
              :model-value="settingsStore.watermarkText"
              @input="(val: string) => settingsStore.setWatermarkText(val)"
              placeholder="请输入报告水印文字，留空则不显示"
              clearable
              style="max-width: 320px;"
            />
            <div class="setting-tip" style="font-size: 12px; color: #909399; margin-top: 4px; width: 100%;">
              留空时不显示水印。设置后将在测评结果页面及导出打印中以45度倾斜平铺显示。
            </div>
          </el-form-item>
          <el-form-item label="老年模式自动朗读">
            <el-switch
              :model-value="settingsStore.seniorTtsEnabled"
              @update:model-value="settingsStore.setSeniorTtsEnabled"
            />
          </el-form-item>
          <el-form-item label="自动朗读年龄阈值">
            <el-input-number
              :model-value="settingsStore.seniorTtsThreshold"
              :min="0"
              :max="120"
              @update:model-value="settingsStore.setSeniorTtsThreshold"
            />
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 测评套餐管理 (管理员/操作员可见) -->
      <el-card class="settings-section">
        <template #header>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>测评套餐管理</span>
            <el-button type="primary" size="small" @click="openAddPackageDialog">
              <el-icon><Plus /></el-icon> 新增套餐
            </el-button>
          </div>
        </template>
        <el-table :data="packageStore.packages" style="width: 100%">
          <el-table-column prop="name" label="套餐名称" width="180" />
          <el-table-column label="包含量表">
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
              <div style="display: flex; align-items: center; gap: 8px;">
                <el-button
                  type="text"
                  size="small"
                  @click="openEditPackageDialog(row)"
                >
                  编辑
                </el-button>
                <el-button
                  type="text"
                  size="small"
                  style="color: var(--el-color-danger);"
                  @click="handleDeletePackage(row.id)"
                >
                  删除
                </el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 添加测评套餐对话框 -->
      <el-dialog
        v-model="showAddPackageDialog"
        :title="editingPackageId ? '编辑测评套餐' : '新增测评套餐'"
        width="460px"
        align-center
      >
        <el-form :model="addPackageForm" label-width="90px">
          <el-form-item label="套餐名称" required>
            <el-input v-model="addPackageForm.name" placeholder="请输入套餐名称，如“入职心理筛查套餐”" />
          </el-form-item>
          <el-form-item label="选择量表" required>
            <el-select
              v-model="addPackageForm.scaleIds"
              multiple
              collapse-tags
              placeholder="选择量表 (可多选)"
              style="width: 100%;"
            >
              <el-option
                v-for="scale in scaleStore.scales"
                :key="scale.id"
                :label="scale.name"
                :value="scale.id"
              />
            </el-select>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showAddPackageDialog = false">取消</el-button>
          <el-button type="primary" @click="handleAddPackage">保存套餐</el-button>
        </template>
      </el-dialog>

      <!-- 量表管理 -->
      <el-card class="settings-section">
        <template #header>
          <span>量表浏览</span>
        </template>
        <div class="settings-actions">
          <el-button @click="openScalesDir">
            <el-icon><FolderOpened /></el-icon>
            打开量表目录
          </el-button>
          <el-button @click="scaleStore.loadScales()">
            <el-icon><Refresh /></el-icon>
            重新扫描量表
          </el-button>
          <el-text type="info" size="small">
            将 JSON 量表文件放入 scales 目录，点击重新扫描即可加载
          </el-text>
        </div>
      </el-card>

      <!-- 数据管理 -->
      <el-card class="settings-section">
        <template #header>
          <span>数据管理</span>
        </template>
        <div style="margin-bottom: 16px;">
          <el-alert
            title="本地数据存储目录"
            :description="`当前数据库物理存储位置: ${databasePhysicalPath}`"
            type="info"
            :closable="false"
            show-icon
          />
        </div>
        <div class="settings-actions">
          <el-button type="primary" @click="backupDatabase">
            <el-icon><Download /></el-icon>
            手动备份数据库
          </el-button>
          <el-button type="warning" :disabled="authStore.currentOperator?.role !== 'admin'" @click="restoreDatabase">
            <el-icon><Upload /></el-icon>
            手动还原备份文件
          </el-button>
          <el-button type="warning" plain :disabled="authStore.currentOperator?.role !== 'admin'" @click="clearTestingRecordsOnly">
            <el-icon><Delete /></el-icon>
            清空测评历史(保留管理员账户及配置)
          </el-button>
          <el-button type="danger" :disabled="authStore.currentOperator?.role !== 'admin'" @click="clearAllData">
            <el-icon><Delete /></el-icon>
            全新重置(删除数据库及账号配置并重启)
          </el-button>
          <el-button type="danger" plain @click="exportRawData">
            <el-icon><Download /></el-icon>
            导出全部原始数据
          </el-button>
        </div>
      </el-card>

      <!-- 定时自动备份 (管理员可见) -->
      <el-card class="settings-section" v-if="authStore.currentOperator?.role === 'admin'">
        <template #header>
          <span>自动备份设置</span>
        </template>
        <el-form label-width="120px">
          <el-form-item label="启用自动备份">
            <el-switch v-model="autoBackupForm.enabled" @change="saveAutoBackupConfig" />
          </el-form-item>
          <el-form-item label="备份周期">
            <el-radio-group v-model="autoBackupForm.period" :disabled="!autoBackupForm.enabled" @change="saveAutoBackupConfig">
              <el-radio label="daily">每天 (晚上 22:00)</el-radio>
              <el-radio label="weekly">每周 (周一晚上 22:00)</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="备份保留份数">
            <el-input-number v-model="autoBackupForm.keepCount" :min="1" :max="100" :disabled="!autoBackupForm.enabled" @change="saveAutoBackupConfig" />
          </el-form-item>
          <el-form-item label="备份目录">
            <div style="display: flex; gap: 8px; width: 100%;">
              <el-input v-model="autoBackupForm.backupDir" placeholder="默认 userData/backups/" disabled />
              <el-button type="primary" :disabled="!autoBackupForm.enabled" @click="selectBackupFolder">选择文件夹</el-button>
            </div>
          </el-form-item>
          <el-form-item>
            <el-button type="success" :disabled="!autoBackupForm.enabled" @click="triggerManualAutoBackup">立即备份一次</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 数据库加密设置 (管理员可见) -->
      <el-card class="settings-section" v-if="authStore.currentOperator?.role === 'admin'">
        <template #header>
          <span>数据库加密保护</span>
        </template>
        <el-alert
          title="安全提醒"
          description="请牢记数据库密码，密码丢失将无法恢复数据。启用加密前，建议您先手动备份一份数据库。"
          type="warning"
          :closable="false"
          show-icon
          style="margin-bottom: 12px;"
        />
        <el-form label-width="120px">
          <el-form-item label="加密保护状态">
            <el-tag :type="isDbEncrypted ? 'success' : 'info'">
              {{ isDbEncrypted ? '已启用加密' : '未启用加密 (明文)' }}
            </el-tag>
          </el-form-item>

          <!-- 启用加密 -->
          <template v-if="!isDbEncrypted">
            <el-form-item label="设置密码">
              <el-input v-model="encryptForm.password" type="password" show-password placeholder="请输入安全密码" />
            </el-form-item>
            <el-form-item label="确认密码">
              <el-input v-model="encryptForm.confirmPassword" type="password" show-password placeholder="请再次输入密码" />
            </el-form-item>
            <el-form-item>
              <el-button type="danger" @click="enableEncryption">启用加密</el-button>
            </el-form-item>
          </template>

          <!-- 修改密码 / 停用加密 -->
          <template v-else>
            <el-collapse style="border: none;">
              <el-collapse-item title="修改加密密码" name="change-pw">
                <el-form label-width="120px" style="margin-top: 10px;">
                  <el-form-item label="旧密码">
                    <el-input v-model="changePasswordForm.oldPassword" type="password" show-password placeholder="请输入当前密码" />
                  </el-form-item>
                  <el-form-item label="新密码">
                    <el-input v-model="changePasswordForm.newPassword" type="password" show-password placeholder="请输入新密码" />
                  </el-form-item>
                  <el-form-item label="确认新密码">
                    <el-input v-model="changePasswordForm.confirmNewPassword" type="password" show-password placeholder="请再次输入新密码" />
                  </el-form-item>
                  <el-form-item>
                    <el-button type="primary" @click="changePassword">保存新密码</el-button>
                  </el-form-item>
                </el-form>
              </el-collapse-item>
              <el-collapse-item title="停用加密保护" name="disable-encrypt">
                <el-form label-width="120px" style="margin-top: 10px;">
                  <el-form-item label="验证密码">
                    <el-input v-model="decryptForm.password" type="password" show-password placeholder="输入当前密码以解密" />
                  </el-form-item>
                  <el-form-item>
                    <el-button type="danger" plain @click="disableEncryption">停用加密</el-button>
                  </el-form-item>
                </el-form>
              </el-collapse-item>
            </el-collapse>
          </template>
        </el-form>
      </el-card>

      <!-- 操作员管理设置 (管理员可见) -->
      <el-card class="settings-section" v-if="authStore.currentOperator?.role === 'admin'">
        <template #header>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>操作员管理</span>
            <el-button type="primary" size="small" @click="showAddOperatorDialog = true">
              <el-icon><Plus /></el-icon> 添加操作员
            </el-button>
          </div>
        </template>

        <el-table :data="operatorsList" style="width: 100%">
          <el-table-column prop="username" label="用户名" />
          <el-table-column prop="name" label="姓名/代号" />
          <el-table-column prop="role" label="权限角色">
            <template #default="{ row }">
              <el-tag :type="row.role === 'admin' ? 'danger' : 'success'">
                {{ row.role === 'admin' ? '超级管理员' : '普通操作员' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="created_at" label="创建时间">
            <template #default="{ row }">
              {{ row.created_at ? new Date(row.created_at).toLocaleString() : '/' }}
            </template>
          </el-table-column>
          <el-table-column prop="last_login" label="最后登录时间">
            <template #default="{ row }">
              {{ row.last_login ? new Date(row.last_login).toLocaleString() : '从不' }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180">
            <template #default="{ row }">
              <div style="display: flex; gap: 12px; align-items: center;">
                <el-button type="text" size="small" @click="openResetPasswordDialog(row)">重置密码</el-button>
                <el-button
                  type="text"
                  size="small"
                  style="color: var(--el-color-danger);"
                  :disabled="row.id === authStore.currentOperator?.id"
                  @click="handleDeleteOperator(row)"
                >
                  删除
                </el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 添加操作员对话框 -->
      <el-dialog
        v-model="showAddOperatorDialog"
        title="添加操作员"
        width="420px"
        align-center
      >
        <el-form :model="addOperatorForm" label-width="80px">
          <el-form-item label="用户名" required>
            <el-input v-model="addOperatorForm.username" placeholder="英文、拼音或数字" />
          </el-form-item>
          <el-form-item label="姓名/名称" required>
            <el-input v-model="addOperatorForm.name" placeholder="测评师显示姓名" />
          </el-form-item>
          <el-form-item label="安全密码" required>
            <el-input v-model="addOperatorForm.password" type="password" show-password placeholder="请输入不少于 6 位的密码" />
          </el-form-item>
          <el-form-item label="角色权限">
            <el-radio-group v-model="addOperatorForm.role">
              <el-radio label="operator">普通操作员</el-radio>
              <el-radio label="admin">管理员</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showAddOperatorDialog = false">取消</el-button>
          <el-button type="primary" @click="handleAddOperator">确定添加</el-button>
        </template>
      </el-dialog>

      <!-- 重置操作员密码对话框 -->
      <el-dialog
        v-model="showResetPasswordDialog"
        :title="`重置操作员密码: ${resetPasswordForm.username}`"
        width="400px"
        align-center
      >
        <el-form :model="resetPasswordForm" label-width="80px">
          <el-form-item label="新密码" required>
            <el-input v-model="resetPasswordForm.password" type="password" show-password placeholder="请输入新的安全密码 (至少 6 位)" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showResetPasswordDialog = false">取消</el-button>
          <el-button type="primary" @click="handleResetPassword">保存密码</el-button>
        </template>
      </el-dialog>

      <!-- 隐私声明 -->
      <el-card class="settings-section">
        <template #header>
          <span>隐私与安全</span>
        </template>
        <el-alert
          title="本地存储声明"
          description="OpenMind Assessment 所有数据仅存储在您的本地设备，不上传任何服务器。量表文件、用户数据、测试记录均保存在应用数据目录中。"
          type="success"
          :closable="false"
          show-icon
        />
      </el-card>

      <!-- 版本信息 -->
      <el-card class="settings-section">
        <template #header>
          <span>关于</span>
        </template>
        <p><strong>OpenMind Assessment</strong> v1.0.0</p>
        <p>开源心理测评系统</p>
        <p>技术栈：Electron + Vue 3 + TypeScript + Element Plus + SQLite</p>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.page-header h2 {
  margin: 0;
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.dark :deep(.el-card) {
  background: var(--app-card, #16213e);
  color: var(--app-text, #e0e0e0);
}
</style>

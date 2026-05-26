<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useAppointmentStore, Appointment } from '@/stores/appointmentStore'
import { useUserStore } from '@/stores/userStore'
import { useScaleStore } from '@/stores/scaleStore'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'

const appointmentStore = useAppointmentStore()
const router = useRouter()
const userStore = useUserStore()
const scaleStore = useScaleStore()

const loading = ref(false)
const apptDialogVisible = ref(false)

const apptForm = ref({
  userId: undefined as number | undefined,
  scaleId: '',
  date: '',
  time: ''
})

onMounted(async () => {
  loading.value = true
  try {
    await appointmentStore.loadAppointments()
    await userStore.loadUsers()
    if (scaleStore.scales.length === 0) {
      await scaleStore.loadScales()
    }
  } catch (err: any) {
    ElMessage.error('加载预约列表失败: ' + err.message)
  } finally {
    loading.value = false
  }
})

function openAddAppt() {
  apptForm.value = {
    userId: undefined,
    scaleId: '',
    date: '',
    time: ''
  }
  apptDialogVisible.value = true
}

async function saveAppointment() {
  if (!apptForm.value.userId) {
    ElMessage.warning('请选择被试')
    return
  }
  if (!apptForm.value.scaleId) {
    ElMessage.warning('请选择量表')
    return
  }
  if (!apptForm.value.date || !apptForm.value.time) {
    ElMessage.warning('请选择日期和时间')
    return
  }

  try {
    const scheduledDateTime = new Date(`${apptForm.value.date}T${apptForm.value.time}`)
    if (isNaN(scheduledDateTime.getTime())) {
      ElMessage.warning('日期或时间格式不正确')
      return
    }

    await appointmentStore.addAppointment(
      apptForm.value.userId,
      apptForm.value.scaleId,
      scheduledDateTime.getTime()
    )
    ElMessage.success('添加预约成功')
    apptDialogVisible.value = false
  } catch (err: any) {
    ElMessage.error('添加预约失败: ' + err.message)
  }
}

async function handleComplete(appt: Appointment) {
  try {
    await appointmentStore.updateStatus(appt.id, 'completed')
    ElMessage.success('更新为已完成状态')
  } catch (err: any) {
    ElMessage.error('更新失败: ' + err.message)
  }
}

async function handleCancel(appt: Appointment) {
  try {
    await appointmentStore.updateStatus(appt.id, 'cancelled')
    ElMessage.success('预约已取消')
  } catch (err: any) {
    ElMessage.error('操作失败: ' + err.message)
  }
}

async function handleDelete(appt: Appointment) {
  try {
    await ElMessageBox.confirm('确定要物理删除此预约吗？此操作不可恢复。', '警告', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消'
    })
    await appointmentStore.deleteAppointment(appt.id)
    ElMessage.success('物理删除成功')
  } catch (err: any) {
    if (err !== 'cancel') {
      ElMessage.error('删除失败: ' + err.message)
    }
  }
}

function getStatusType(status: string) {
  switch (status) {
    case 'completed': return 'success'
    case 'cancelled': return 'info'
    default: return 'warning'
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'completed': return '已完成'
    case 'cancelled': return '已取消'
    default: return '待完成'
  }
}

async function startAppointmentTest(appt: Appointment) {
  // 1. 设置当前活动被试为预约指定的被试
  const targetUser = userStore.users.find(u => u.id === appt.userId)
  if (targetUser) {
    userStore.setCurrentUser(targetUser)
  } else {
    ElMessage.warning('未能找到该预约关联的被试档案！')
    return
  }

  // 2. 将预约状态更新为“已完成”，因为被试在此开始测试
  try {
    await appointmentStore.updateStatus(appt.id, 'completed')
  } catch (err: any) {
    console.error('更新预约状态失败:', err)
  }

  // 3. 跳转到答题测试页面
  ElMessage.success(`正在为被试 [${targetUser.name}] 开启 [${appt.scaleName || appt.scaleId}] 测试`)
  router.push(`/test/${appt.scaleId}`)
}

// 过期且 pending 的预约置顶展示
const sortedAppointments = computed(() => {
  const now = Date.now()
  return [...appointmentStore.appointments].sort((a, b) => {
    const isAExpiredPending = a.status === 'pending' && a.scheduledAt < now
    const isBExpiredPending = b.status === 'pending' && b.scheduledAt < now

    if (isAExpiredPending && !isBExpiredPending) return -1
    if (!isAExpiredPending && isBExpiredPending) return 1

    if (isAExpiredPending && isBExpiredPending) {
      // 都是过期且 pending，按照预约时间升序排列（最旧的在最上面）
      return a.scheduledAt - b.scheduledAt
    }

    // 否则保持原来在 Store 中的排序（创建时间倒序）
    return 0
  })
})

// 为过期且 pending 的预约行添加特定类名以标红显示
function tableRowClassName({ row }: { row: Appointment }) {
  const now = Date.now()
  if (row.status === 'pending' && row.scheduledAt < now) {
    return 'expired-pending-row'
  }
  return ''
}
</script>

<template>
  <div class="appointment-manager-view" v-loading="loading">
    <div class="page-header">
      <h2>预约管理</h2>
      <el-button type="primary" @click="openAddAppt">添加预约</el-button>
    </div>

    <el-card shadow="never" style="margin-top: 16px;">
      <el-table :data="sortedAppointments" :row-class-name="tableRowClassName" style="width: 100%" size="default">
        <el-table-column prop="userName" label="被试姓名" min-width="120" />
        <el-table-column prop="scaleName" label="预约量表" min-width="160" />
        <el-table-column label="预约执行时间" min-width="160">
          <template #default="{ row }">
            {{ new Date(row.scheduledAt).toLocaleString() }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)">
              {{ getStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="提示状态" width="120">
          <template #default="{ row }">
            <el-tag :type="row.reminderSent ? 'success' : 'info'" size="small">
              {{ row.reminderSent ? '已弹窗提醒' : '未提醒' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="320">
          <template #default="{ row }">
            <div style="display: flex; gap: 8px;">
              <el-button
                v-if="row.status === 'pending'"
                type="primary"
                size="small"
                @click="startAppointmentTest(row)"
              >
                进入测试
              </el-button>
              <el-button
                v-if="row.status === 'pending'"
                type="success"
                size="small"
                @click="handleComplete(row)"
              >
                完成
              </el-button>
              <el-button
                v-if="row.status === 'pending'"
                type="warning"
                size="small"
                plain
                @click="handleCancel(row)"
              >
                取消
              </el-button>
              <el-button type="danger" size="small" plain @click="handleDelete(row)">
                物理删除
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 添加预约弹窗 -->
    <el-dialog
      v-model="apptDialogVisible"
      title="新建预约任务"
      width="500px"
      append-to-body
    >
      <el-form :model="apptForm" label-width="100px">
        <el-form-item label="选择被试" required>
          <el-select v-model="apptForm.userId" placeholder="请选择被试" style="width: 100%;">
            <el-option
              v-for="user in userStore.users"
              :key="user.id"
              :label="user.name"
              :value="user.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="选择量表" required>
          <el-select v-model="apptForm.scaleId" placeholder="请选择量表" style="width: 100%;">
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
          <el-button type="primary" @click="saveAppointment">保存</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.appointment-manager-view {
  max-width: 1000px;
  margin: 0 auto;
  padding: 24px;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.page-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: bold;
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

/* 过期且 pending 预约的标红样式 */
:deep(.expired-pending-row) {
  background-color: #fef0f0 !important;
}
:deep(.expired-pending-row .el-table__cell) {
  color: #f56c6c !important;
}
:deep(.expired-pending-row .el-tag) {
  /* 确保表格行标红时，el-tag 也做相应的红框/红字突出显示 */
  border-color: #f56c6c !important;
  color: #f56c6c !important;
  background-color: #fef0f0 !important;
}
.dark :deep(.expired-pending-row) {
  background-color: rgba(245, 108, 108, 0.15) !important;
}
.dark :deep(.expired-pending-row .el-table__cell) {
  color: #f89898 !important;
}
.dark :deep(.expired-pending-row .el-tag) {
  border-color: #f89898 !important;
  color: #f89898 !important;
  background-color: rgba(245, 108, 108, 0.15) !important;
}
</style>

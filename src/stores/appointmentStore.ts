import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface Appointment {
  id: number
  userId: number
  scaleId: string
  scheduledAt: number // timestamp
  status: 'pending' | 'completed' | 'cancelled'
  createdAt: number
  reminderSent: number // 0 or 1
  userName?: string
  scaleName?: string
}

export const useAppointmentStore = defineStore('appointment', () => {
  const appointments = ref<Appointment[]>([])

  async function loadAppointments() {
    if (window.electronAPI) {
      // 联合查询以获取用户姓名，并根据需要查找量表名称
      const rows = await window.electronAPI.dbQuery(`
        SELECT a.*, u.name as userName
        FROM appointments a
        JOIN users u ON a.userId = u.id
        ORDER BY a.createdAt DESC
      `) as any[]

      // 加载量表以匹配名字
      const { scales } = await window.electronAPI.scanScales()

      // 引入套餐以支持展示套餐的名称
      const pRows = await window.electronAPI.getPackages()

      appointments.value = rows.map(r => {
        let displayScaleName = r.scaleId
        if (r.scaleId.startsWith('package:')) {
          const pkgId = parseInt(r.scaleId.replace('package:', ''))
          const matchedPkg = pRows.find((p: any) => p.id === pkgId)
          displayScaleName = matchedPkg ? `[套餐] ${matchedPkg.name}` : `[套餐] 未知套餐`
        } else {
          const matchedScale = scales.find((s: any) => s.id === r.scaleId)
          if (matchedScale) {
            displayScaleName = matchedScale.name
          }
        }

        return {
          id: r.id,
          userId: r.userId,
          scaleId: r.scaleId,
          scheduledAt: r.scheduledAt,
          status: r.status,
          createdAt: r.createdAt,
          reminderSent: r.reminderSent,
          userName: r.userName,
          scaleName: displayScaleName
        }
      })
    }
  }

  async function addAppointment(userId: number, scaleId: string, scheduledAt: number) {
    if (window.electronAPI) {
      const now = Date.now()
      await window.electronAPI.dbRun(`
        INSERT INTO appointments (userId, scaleId, scheduledAt, status, createdAt, reminderSent)
        VALUES (?, ?, ?, 'pending', ?, 0)
      `, [userId, scaleId, scheduledAt, now])
      await loadAppointments()
    }
  }

  async function updateStatus(id: number, status: 'pending' | 'completed' | 'cancelled') {
    if (window.electronAPI) {
      await window.electronAPI.dbRun(`
        UPDATE appointments SET status = ? WHERE id = ?
      `, [status, id])
      await loadAppointments()
    }
  }

  async function deleteAppointment(id: number) {
    if (window.electronAPI) {
      await window.electronAPI.dbRun(`
        DELETE FROM appointments WHERE id = ?
      `, [id])
      await loadAppointments()
    }
  }

  return {
    appointments,
    loadAppointments,
    addAppointment,
    updateStatus,
    deleteAppointment
  }
})

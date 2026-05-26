import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { User, TestHistory } from '@/types'

export const useUserStore = defineStore('user', () => {
  const users = ref<User[]>([])
  
  const currentUser = ref<User | null>(
    (() => {
      try {
        const u = localStorage.getItem('current_user')
        return u ? JSON.parse(u) : null
      } catch (e) {
        return null
      }
    })()
  )

  async function loadUsers() {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.dbQuery("SELECT * FROM users ORDER BY created_at DESC")
        users.value = result as User[]
      } else {
        const localUsersStr = localStorage.getItem('local_users') || '[]'
        users.value = JSON.parse(localUsersStr)
      }
    } catch (e) {
      console.error('Load users error:', e)
    }
  }

  async function addUser(user: Omit<User, 'id' | 'created_at'>): Promise<number> {
    if (window.electronAPI) {
      const result = await window.electronAPI.dbRun(
        "INSERT INTO users (name, gender, birthdate, contact, notes, tags) VALUES (?, ?, ?, ?, ?, ?)",
        [user.name, user.gender || null, user.birthdate || null, user.contact || null, user.notes || null, user.tags || '[]']
      ) as any
      await loadUsers()
      return result.lastInsertRowid as number
    } else {
      const localUsersStr = localStorage.getItem('local_users') || '[]'
      const localUsers = JSON.parse(localUsersStr)
      const newId = Date.now()
      const newUser = {
        id: newId,
        ...user,
        tags: user.tags || '[]',
        created_at: new Date().toISOString()
      }
      localUsers.unshift(newUser)
      localStorage.setItem('local_users', JSON.stringify(localUsers))
      await loadUsers()
      return newId
    }
  }

  async function updateUser(id: number, user: Partial<User>) {
    if (window.electronAPI) {
      const fields: string[] = []
      const values: any[] = []
      for (const [k, v] of Object.entries(user)) {
        if (k !== 'id' && k !== 'created_at') {
          fields.push(`${k} = ?`)
          values.push(k === 'tags' && typeof v === 'object' ? JSON.stringify(v) : v)
        }
      }
      values.push(id)
      await window.electronAPI.dbRun(
        `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
        values
      )
      await loadUsers()
    } else {
      const localUsersStr = localStorage.getItem('local_users') || '[]'
      let localUsers = JSON.parse(localUsersStr)
      localUsers = localUsers.map((u: any) => u.id === id ? { ...u, ...user } : u)
      localStorage.setItem('local_users', JSON.stringify(localUsers))
      await loadUsers()
    }

    // Update current user if it's the updated one
    if (currentUser.value?.id === id) {
      const updatedUser = users.value.find(u => u.id === id)
      if (updatedUser) {
        setCurrentUser(updatedUser)
      }
    }
  }

  async function deleteUser(id: number) {
    if (window.electronAPI) {
      await window.electronAPI.dbRun("DELETE FROM users WHERE id = ?", [id])
      await window.electronAPI.dbRun("DELETE FROM tests WHERE user_id = ?", [id])
      await loadUsers()
    } else {
      const localUsersStr = localStorage.getItem('local_users') || '[]'
      let localUsers = JSON.parse(localUsersStr)
      localUsers = localUsers.filter((u: any) => u.id !== id)
      localStorage.setItem('local_users', JSON.stringify(localUsers))
      
      const localTestsStr = localStorage.getItem('local_tests') || '[]'
      let localTests = JSON.parse(localTestsStr)
      localTests = localTests.filter((t: any) => t.user_id !== id)
      localStorage.setItem('local_tests', JSON.stringify(localTests))
      
      await loadUsers()
    }
    if (currentUser.value?.id === id) {
      setCurrentUser(null)
    }
  }

  async function getTestHistory(userId: number): Promise<TestHistory[]> {
    if (window.electronAPI) {
      const result = await window.electronAPI.dbQuery(
        "SELECT * FROM tests WHERE user_id = ? ORDER BY created_at DESC",
        [userId]
      )
      return result as TestHistory[]
    } else {
      const localTestsStr = localStorage.getItem('local_tests') || '[]'
      const localTests = JSON.parse(localTestsStr)
      // Filter by user_id and sort desc
      return localTests
        .filter((t: any) => Number(t.user_id) === Number(userId))
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    }
  }

  async function getAllTests(): Promise<TestHistory[]> {
    if (window.electronAPI) {
      const result = await window.electronAPI.dbQuery("SELECT * FROM tests ORDER BY created_at DESC")
      return result as TestHistory[]
    } else {
      const localTestsStr = localStorage.getItem('local_tests') || '[]'
      const localTests = JSON.parse(localTestsStr)
      return localTests.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    }
  }

  function setCurrentUser(user: User | null) {
    currentUser.value = user
    if (user) {
      localStorage.setItem('current_user', JSON.stringify(user))
    } else {
      localStorage.removeItem('current_user')
    }
  }

  return {
    users,
    currentUser,
    loadUsers,
    addUser,
    updateUser,
    deleteUser,
    getTestHistory,
    getAllTests,
    setCurrentUser
  }
})

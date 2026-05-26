import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface PackageDefinition {
  id: number
  name: string
  scaleIds: string[]
  scale_ids: string[] // 兼容前端组件使用的 scale_ids
  createdAt?: string
  created_at?: string // 兼容前端使用的 created_at
}

export const usePackageStore = defineStore('package', () => {
  const packages = ref<PackageDefinition[]>([])

  async function loadPackages() {
    if (window.electronAPI) {
      const rows = await window.electronAPI.getPackages()
      console.log('Loaded packages from main:', rows)
      packages.value = rows.map(r => {
        const parsedIds = JSON.parse(r.scaleIds || '[]')
        const rawTime = r.createdAt || r.created_at || r.createdat || r.createdTime
        return {
          id: r.id,
          name: r.name,
          scaleIds: parsedIds,
          scale_ids: parsedIds, // 双向绑定/兼容支持
          createdAt: rawTime,
          created_at: rawTime // 兼容前端使用的 created_at
        }
      })
    }
  }

  async function savePackage(name: string, scaleIds: string[], id?: number) {
    if (window.electronAPI) {
      const res = await window.electronAPI.savePackage(name, JSON.stringify(scaleIds), id)
      if (res.success) {
        await loadPackages()
      }
      return res
    }
    return { success: false, error: 'API not available' }
  }

  async function deletePackage(id: number) {
    if (window.electronAPI) {
      const res = await window.electronAPI.deletePackage(id)
      if (res.success) {
        await loadPackages()
      }
      return res
    }
    return { success: false, error: 'API not available' }
  }

  return {
    packages,
    loadPackages,
    savePackage,
    deletePackage
  }
})

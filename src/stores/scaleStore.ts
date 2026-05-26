import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ScaleDefinition } from '@/types'

export const useScaleStore = defineStore('scale', () => {
  const scales = ref<ScaleDefinition[]>([])
  const loadErrors = ref<any[]>([])
  const loading = ref(false)

  const enabledScales = computed(() => scales.value.filter(s => s._enabled !== false))

  async function loadScales() {
    loading.value = true
    try {
      const result = await window.electronAPI.scanScales()
      scales.value = result.scales.map((s: any) => ({ ...s, _enabled: true }))
      loadErrors.value = result.errors
    } catch (e: any) {
      loadErrors.value = [{ file: 'scan', error: e.message }]
    } finally {
      loading.value = false
    }
  }

  function getScaleById(id: string): ScaleDefinition | undefined {
    return scales.value.find(s => s.id === id)
  }

  function setScaleEnabled(id: string, enabled: boolean) {
    const scale = scales.value.find(s => s.id === id)
    if (scale) {
      scale._enabled = enabled
    }
  }

  async function importScale() {
    const result = await window.electronAPI.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (!result.canceled && result.filePaths.length > 0) {
      const res = await window.electronAPI.importScale(result.filePaths[0])
      if (res.success) {
        await loadScales()
      }
      return res
    }
    return { success: false, message: '未选择文件' }
  }

  return {
    scales,
    enabledScales,
    loadErrors,
    loading,
    loadScales,
    getScaleById,
    setScaleEnabled,
    importScale
  }
})

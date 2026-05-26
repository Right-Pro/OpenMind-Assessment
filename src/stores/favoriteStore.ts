import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useFavoriteStore = defineStore('favorite', () => {
  const favorites = ref<string[]>([])

  async function loadFavorites() {
    try {
      if (window.electronAPI) {
        favorites.value = await window.electronAPI.getFavorites()
      }
    } catch (e) {
      console.error('加载常用量表失败:', e)
    }
  }

  async function toggleFavorite(scaleId: string) {
    try {
      if (favorites.value.includes(scaleId)) {
        await window.electronAPI.removeFavorite(scaleId)
        favorites.value = favorites.value.filter(id => id !== scaleId)
        return { action: 'removed' as const, success: true }
      } else {
        await window.electronAPI.addFavorite(scaleId)
        favorites.value.push(scaleId)
        return { action: 'added' as const, success: true }
      }
    } catch (e) {
      console.error('切换收藏状态失败:', e)
      return { success: false }
    }
  }

  function isFavorite(scaleId: string) {
    return favorites.value.includes(scaleId)
  }

  return {
    favorites,
    loadFavorites,
    toggleFavorite,
    isFavorite
  }
})

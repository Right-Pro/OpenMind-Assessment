import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSettingsStore = defineStore('settings', () => {
  const unitLogo = ref(
    (() => {
      try {
        return localStorage.getItem('settings_unitLogo') || ''
      } catch (e) {
        return ''
      }
    })()
  )

  const darkMode = ref(
    (() => {
      try {
        return localStorage.getItem('settings_darkMode') === 'true'
      } catch (e) {
        return false
      }
    })()
  )
  
  const fontSize = ref<'small' | 'medium' | 'large' | 'xlarge'>(
    (() => {
      try {
        return (localStorage.getItem('settings_fontSize') as any) || 'medium'
      } catch (e) {
        return 'medium'
      }
    })()
  )

  const showQuestionNumber = ref(
    (() => {
      try {
        const val = localStorage.getItem('settings_showQuestionNumber')
        return val === null ? true : val === 'true'
      } catch (e) {
        return true
      }
    })()
  )

  const unitName = ref(
    (() => {
      try {
        return localStorage.getItem('settings_unitName') || ''
      } catch (e) {
        return ''
      }
    })()
  )

  const unitDesc = ref(
    (() => {
      try {
        return localStorage.getItem('settings_unitDesc') || ''
      } catch (e) {
        return ''
      }
    })()
  )

  const privacyAgreed = ref(
    (() => {
      try {
        return localStorage.getItem('settings_privacyAgreed') === 'true'
      } catch (e) {
        return false
      }
    })()
  )

  // 老年模式自动朗读相关设置
  const seniorTtsEnabled = ref(
    (() => {
      try {
        return localStorage.getItem('settings_seniorTtsEnabled') === 'true'
      } catch (e) {
        return false
      }
    })()
  )

  const seniorTtsThreshold = ref(
    (() => {
      try {
        const val = localStorage.getItem('settings_seniorTtsThreshold')
        return val ? Number(val) : 60
      } catch (e) {
        return 60
      }
    })()
  )

  const testPageBg = ref<'default' | 'eye' | 'contrast'>(
    (() => {
      try {
        return (localStorage.getItem('settings_testPageBg') as any) || 'default'
      } catch (e) {
        return 'default'
      }
    })()
  )

  const watermarkText = ref(
    (() => {
      try {
        return localStorage.getItem('settings_watermarkText') || ''
      } catch (e) {
        return ''
      }
    })()
  )

  async function init() {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.dbQuery("SELECT * FROM settings")
        const rows = result as any[]
        for (const row of rows) {
          switch (row.key) {
            case 'unitLogo':
              unitLogo.value = row.value
              localStorage.setItem('settings_unitLogo', unitLogo.value)
              break
            case 'darkMode':
              darkMode.value = row.value === 'true'
              localStorage.setItem('settings_darkMode', String(darkMode.value))
              break
            case 'showQuestionNumber':
              showQuestionNumber.value = row.value === 'true'
              localStorage.setItem('settings_showQuestionNumber', String(showQuestionNumber.value))
              break
            case 'unitName':
              unitName.value = row.value
              localStorage.setItem('settings_unitName', unitName.value)
              break
            case 'unitDesc':
              unitDesc.value = row.value
              localStorage.setItem('settings_unitDesc', unitDesc.value)
              break
            case 'privacyAgreed':
              privacyAgreed.value = row.value === 'true'
              localStorage.setItem('settings_privacyAgreed', String(privacyAgreed.value))
              break
            case 'seniorTtsEnabled':
              seniorTtsEnabled.value = row.value === 'true'
              localStorage.setItem('settings_seniorTtsEnabled', String(seniorTtsEnabled.value))
              break
            case 'seniorTtsThreshold':
              seniorTtsThreshold.value = Number(row.value) || 60
              localStorage.setItem('settings_seniorTtsThreshold', String(seniorTtsThreshold.value))
              break
            case 'testPageBg':
              testPageBg.value = row.value as any
              localStorage.setItem('settings_testPageBg', testPageBg.value)
              break
            case 'watermarkText':
              watermarkText.value = row.value
              localStorage.setItem('settings_watermarkText', watermarkText.value)
              break
          }
        }
      }
    } catch (e) {
      console.error('Settings init error:', e)
    }
  }

  async function saveSetting(key: string, value: string) {
    try {
      localStorage.setItem(`settings_${key}`, value)
      if (window.electronAPI) {
        await window.electronAPI.dbRun(
          "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
          [key, value]
        )
      }
    } catch (e) {
      console.error('Save setting error:', e)
    }
  }

  async function setDarkMode(val: boolean) {
    darkMode.value = val
    await saveSetting('darkMode', String(val))
  }

  async function setFontSize(val: 'small' | 'medium' | 'large' | 'xlarge') {
    fontSize.value = val
    await saveSetting('fontSize', val)
  }

  async function setShowQuestionNumber(val: boolean) {
    showQuestionNumber.value = val
    await saveSetting('showQuestionNumber', String(val))
  }

  async function setUnitInfo(name: string, desc: string) {
    unitName.value = name
    unitDesc.value = desc
    await saveSetting('unitName', name)
    await saveSetting('unitDesc', desc)
  }

  async function setPrivacyAgreed(val: boolean) {
    privacyAgreed.value = val
    await saveSetting('privacyAgreed', String(val))
  }

  async function setSeniorTtsEnabled(val: boolean) {
    seniorTtsEnabled.value = val
    await saveSetting('seniorTtsEnabled', String(val))
  }

  async function setSeniorTtsThreshold(val: number) {
    seniorTtsThreshold.value = val
    await saveSetting('seniorTtsThreshold', String(val))
  }

  async function setTestPageBg(val: 'default' | 'eye' | 'contrast') {
    testPageBg.value = val
    await saveSetting('testPageBg', val)
  }

  async function setWatermarkText(val: string) {
    watermarkText.value = val
    await saveSetting('watermarkText', val)
  }

  async function setUnitLogo(val: string) {
    unitLogo.value = val
    await saveSetting('unitLogo', val)
  }

  async function deleteUnitLogo() {
    unitLogo.value = ''
    await saveSetting('unitLogo', '')
  }

  const fontSizeClass = () => {
    const map: Record<string, string> = {
      small: 'fs-small',
      medium: 'fs-medium',
      large: 'fs-large',
      xlarge: 'fs-xlarge'
    }
    return map[fontSize.value] || 'fs-medium'
  }

  return {
    darkMode,
    fontSize,
    showQuestionNumber,
    unitName,
    unitDesc,
    privacyAgreed,
    seniorTtsEnabled,
    seniorTtsThreshold,
    testPageBg,
    watermarkText,
    unitLogo,
    init,
    setDarkMode,
    setFontSize,
    setShowQuestionNumber,
    setUnitInfo,
    setPrivacyAgreed,
    setSeniorTtsEnabled,
    setSeniorTtsThreshold,
    setTestPageBg,
    setWatermarkText,
    setUnitLogo,
    deleteUnitLogo,
    fontSizeClass
  }
})

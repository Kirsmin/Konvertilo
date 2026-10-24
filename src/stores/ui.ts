import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { JobStatus, ThemeMode } from '../types'

/**
 * 全局 UI 状态：主题与状态行（header 居中显示）。
 * progress 用于「下载引擎中」的进度条，done/total 用于「处理中(n/m)」。
 */
export const useUiStore = defineStore('ui', () => {
  const theme = ref<ThemeMode>('auto')
  const status = ref<JobStatus>('idle')
  const progress = ref(0)
  const done = ref(0)
  const total = ref(0)
  const histOpen = ref(false)
  const errorText = ref('')

  function toggleHistory() {
    histOpen.value = !histOpen.value
  }

  return {
    theme,
    status,
    progress,
    done,
    total,
    histOpen,
    errorText,
    toggleHistory,
  }
})

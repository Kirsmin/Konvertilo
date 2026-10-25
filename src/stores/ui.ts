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
  /** 本轮失败的条数，用于「错误 · 失败 n」提示 */
  const failed = ref(0)
  /** 本轮开始时间（ms），用于显示已用时间与预计剩余 */
  const startedAt = ref(0)
  const histOpen = ref(false)
  const errorText = ref('')
  /** 尺寸等非阻断提示，黄色面板展示，不影响继续转换 */
  const warnText = ref('')

  function toggleHistory() {
    histOpen.value = !histOpen.value
  }

  /** 关闭错误面板：清空文本并回到空闲态 */
  function dismissError() {
    errorText.value = ''
    if (status.value === 'error') status.value = 'idle'
  }

  function dismissWarn() {
    warnText.value = ''
  }

  return {
    theme,
    status,
    progress,
    done,
    total,
    failed,
    startedAt,
    histOpen,
    errorText,
    warnText,
    toggleHistory,
    dismissError,
    dismissWarn,
  }
})

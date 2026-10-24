import { onBeforeUnmount, ref } from 'vue'

/** 按钮文字短暂切换后自动还原，如「↓ 下载 -> ✓ 已下载」 */
export function useFlash(defaultText: string, flashText: string, ms = 900) {
  const text = ref(defaultText)
  let timer: ReturnType<typeof setTimeout> | null = null

  function flash() {
    if (timer !== null) clearTimeout(timer)
    text.value = flashText
    timer = setTimeout(() => {
      text.value = defaultText
      timer = null
    }, ms)
  }

  onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer)
  })

  return { text, flash }
}

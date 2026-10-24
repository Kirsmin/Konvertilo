import type { MediaType } from '../types'
import { formatDuration } from './format'

/**
 * 通过媒体元素读取时长；不支持的编码 / 读取失败时回退为 0'00"。
 * 不在服务端使用，仅浏览器。
 */
export function probeDuration(file: File, mediaType: MediaType): Promise<string> {
  return new Promise((resolve) => {
    const element = document.createElement(mediaType === 'Video' ? 'video' : 'audio')
    const url = URL.createObjectURL(file)
    let settled = false
    let timer: ReturnType<typeof setTimeout>

    const finish = (seconds: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      element.onloadedmetadata = null
      element.onerror = null
      element.removeAttribute('src')
      URL.revokeObjectURL(url)
      resolve(formatDuration(seconds))
    }

    timer = setTimeout(() => finish(0), 5_000)
    element.preload = 'metadata'
    element.onloadedmetadata = () => finish(element.duration)
    element.onerror = () => finish(0)
    element.src = url
  })
}

export async function probeDurationSafe(
  file: File,
  mediaType: MediaType,
): Promise<string> {
  try {
    return await probeDuration(file, mediaType)
  } catch {
    return `0'00"`
  }
}

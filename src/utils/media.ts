import type { MediaType } from '../types'
import { formatDuration } from './format'

/** 浏览器原生解码器读不出时长时的占位符（wma / ac3 / ts 等容器常见） */
export const UNKNOWN_DURATION = '—'

/**
 * 通过媒体元素读取时长；不支持的编码 / 读取失败时回退为「未知」。
 * 不能用 0'00" 兜底：那会让「读不出来」和「真的是 0 秒」混为一谈。
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
      resolve(Number.isFinite(seconds) && seconds > 0 ? formatDuration(seconds) : UNKNOWN_DURATION)
    }

    // 元数据通常几百毫秒内就能读到；5 秒还没响应说明这个容器浏览器解析不了
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
    return UNKNOWN_DURATION
  }
}

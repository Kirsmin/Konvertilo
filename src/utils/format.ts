import type { ConverterConfig } from '../types'

const KB = 1024
const MB = 1024 * 1024
const GB = 1024 * 1024 * 1024

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0KB'
  if (bytes < KB) return `${Math.max(1, Math.round(bytes))}B`
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / KB))}KB`
  if (bytes < GB) return `${Math.max(1, Math.round(bytes / MB))}MB`
  return `${(bytes / GB).toFixed(1)}GB`
}

export function formatDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return `${minutes}'${String(rest).padStart(2, '0')}"`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function absoluteTime(ts: number): string {
  const date = new Date(ts)
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`
}

/** 刚刚 / X分钟前 / X小时前 / 昨天 / 前天 / 周X / 上周 / 绝对时间 */
export function relativeTime(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts)
  const minute = 60_000
  const hour = 3_600_000
  const day = 86_400_000

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`
  if (diff < day) return `${Math.floor(diff / hour)}小时前`
  if (diff < 2 * day) return '昨天'
  if (diff < 3 * day) return '前天'
  if (diff < 7 * day) return `周${'日一二三四五六'[new Date(ts).getDay()]}`
  if (diff < 14 * day) return '上周'
  return absoluteTime(ts)
}

export function fileExtension(name: string): string {
  const match = /\.([^.]+)$/.exec(name)
  return match ? match[1].toLowerCase() : ''
}

export function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

export function replaceExtension(name: string, extension: string): string {
  return `${stripExtension(name)}.${extension.toLowerCase()}`
}

export function isFileAccepted(file: File, converter: ConverterConfig): boolean {
  const expectedMime = converter.from === 'Video' ? 'video/' : 'audio/'
  if (file.type.startsWith(expectedMime)) return true
  return converter.sourceExtensions.includes(fileExtension(file.name))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function clampProgress(value: number): number {
  return clamp(Math.round(Number(value) || 0), 0, 100)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 忽略权限异常，退回 textarea 方案
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const ok = document.execCommand('copy')
    textarea.remove()
    return ok
  } catch {
    return false
  }
}

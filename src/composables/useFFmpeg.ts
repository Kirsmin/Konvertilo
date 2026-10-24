import { computed, ref } from 'vue'
import type { FFmpeg } from '@ffmpeg/ffmpeg'
import { useUiStore } from '../stores/ui'
import { clampProgress, fileExtension } from '../utils/format'

type EngineState = 'idle' | 'loading' | 'ready' | 'error'

// wasm 核心超过 Cloudflare Pages 25MB 限制，改从 npmmirror CDN 拉取，
// 版本需与 package.json 中 @ffmpeg/core 保持一致。
// Vite 将 worker 构建为 module 类型，importScripts 不可用，
// 必须走 esm 构建（带 export default），umd 会报 "failed to import ffmpeg-core.js"。
const CORE_VERSION = '0.12.10'
const CORE_JS = `https://registry.npmmirror.com/@ffmpeg/core/${CORE_VERSION}/files/dist/esm/ffmpeg-core.js`
const CORE_WASM = `https://registry.npmmirror.com/@ffmpeg/core/${CORE_VERSION}/files/dist/esm/ffmpeg-core.wasm`

/** 模块级单例：整个应用只加载一次引擎 */
const state = ref<EngineState>('idle')
const progress = ref(0)
const error = ref('')
const loading = computed(() => state.value === 'loading')

let instance: FFmpeg | null = null
let loadPromise: Promise<void> | null = null
let coreObjectUrl = ''
let wasmObjectUrl = ''

function normalizeError(value: unknown): string {
  const detail = value instanceof Error ? value.message : String(value)
  return `ffmpeg-wasm: ${detail}`
}

function setProgress(value: number) {
  const next = clampProgress(value)
  progress.value = next
  useUiStore().progress = next
}

function rangeProgress(
  start: number,
  end: number,
  received: number,
  total: number,
): number {
  if (total <= 0) return start
  const ratio = Math.min(1, received / total)
  return Math.round(start + (end - start) * ratio)
}

interface DownloadProgress {
  received: number
  total: number
}

/**
 * 下载远程核心并生成 blob URL。
 *
 * 不用 @ffmpeg/util 的 toBlobURL：它的进度实现拿 Content-Length 校验收到的
 * 字节数，但 CDN 缓存命中后响应是 gzip/br 压缩的，Content-Length 是压缩后
 * 大小（跨域请求还读不到 Content-Encoding），校验必然失败；失败分支又会再次
 * 读取同一个 response，抛出 "Response.arrayBuffer: Body has already been consumed."。
 * 这里只消费一次响应体，进度按已收字节估算，不做长度相等校验。
 */
async function downloadBlobUrl(
  url: string,
  mimeType: string,
  onProgress?: (event: DownloadProgress) => void,
): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`下载核心失败：HTTP ${response.status} ${url}`)
  }

  const total = Number(response.headers.get('content-length') ?? 0)
  const reader = onProgress && total > 0 ? response.body?.getReader() : undefined

  let bytes: Uint8Array
  if (reader) {
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      chunks.push(value)
      received += value.byteLength
      onProgress?.({ received, total })
    }
    bytes = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer())
  }

  // 压缩响应的 Content-Length 是压缩后大小，只能判断是否少于预期（下载被截断）
  if (total > 0 && bytes.byteLength < total) {
    throw new Error(`下载核心不完整：${bytes.byteLength}/${total} ${url}`)
  }
  onProgress?.({ received: bytes.byteLength, total: bytes.byteLength })

  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  return URL.createObjectURL(new Blob([buffer], { type: mimeType }))
}

function releaseObjectUrls() {
  if (coreObjectUrl) {
    URL.revokeObjectURL(coreObjectUrl)
    coreObjectUrl = ''
  }
  if (wasmObjectUrl) {
    URL.revokeObjectURL(wasmObjectUrl)
    wasmObjectUrl = ''
  }
}

async function loadEngine(): Promise<void> {
  state.value = 'loading'
  error.value = ''

  const ui = useUiStore()
  const silent = ui.status === 'processing'
  if (!silent) {
    ui.errorText = ''
    ui.progress = 0
    ui.status = 'downloading'
  }
  setProgress(0)

  try {
    // 仅在真正需要时加载 ffmpeg 封装，首屏不包含任何 wasm 代码。
    const { FFmpeg: FFmpegCtor } = await import('@ffmpeg/ffmpeg')

    releaseObjectUrls()

    coreObjectUrl = await downloadBlobUrl(CORE_JS, 'text/javascript', (event) => {
      setProgress(rangeProgress(0, 4, event.received, event.total))
    })
    setProgress(4)

    wasmObjectUrl = await downloadBlobUrl(CORE_WASM, 'application/wasm', (event) => {
      setProgress(rangeProgress(4, 98, event.received, event.total))
    })
    setProgress(99)

    const ffmpeg = new FFmpegCtor()
    await ffmpeg.load({ coreURL: coreObjectUrl, wasmURL: wasmObjectUrl })
    instance = ffmpeg
    state.value = 'ready'
    setProgress(100)

    if (!silent && ui.status === 'downloading') {
      ui.status = 'idle'
    }
  } catch (reason) {
    state.value = 'error'
    error.value = normalizeError(reason)
    releaseObjectUrls()
    if (!silent) {
      ui.errorText = error.value
      ui.status = 'error'
    }
  }
}

/**
 * 选择文件后调用。单例 + 并发去重；失败后再次调用可重试。
 */
function ensureLoaded(): Promise<void> {
  if (state.value === 'ready' && instance) return Promise.resolve()
  if (loadPromise) return loadPromise
  loadPromise = loadEngine().finally(() => {
    loadPromise = null
  })
  return loadPromise
}

function getFFmpeg(): FFmpeg | null {
  return instance
}

export interface TranscodeOptions {
  file: File
  outputName: string
  args: string[]
  mimeType?: string
  onProgress?: (ratio: number) => void
  /** 中止信号：路由切换等场景取消当前转码 */
  signal?: AbortSignal
}

/**
 * 真实 wasm 转码：写入输入 -> exec -> 读回输出 -> 清理临时文件。
 */
export async function transcode(options: TranscodeOptions): Promise<Blob> {
  if (!instance || state.value !== 'ready') {
    throw new Error('ffmpeg.wasm 引擎尚未就绪')
  }
  if (options.signal?.aborted) {
    throw new DOMException('转码已中止', 'AbortError')
  }

  const { fetchFile } = await import('@ffmpeg/util')
  const extension = fileExtension(options.file.name) || 'input'
  const inputName = `input.${extension}`
  const onProgress = ({ progress: value }: { progress: number }) => {
    options.onProgress?.(Math.max(0, Math.min(1, value)))
  }
  instance.on('progress', onProgress)

  try {
    await instance.writeFile(inputName, await fetchFile(options.file))
    await instance.exec(['-i', inputName, ...options.args, options.outputName], undefined, {
      signal: options.signal,
    })
    const data = await instance.readFile(options.outputName)
    const bytes =
      typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    return new Blob([buffer], { type: options.mimeType ?? 'application/octet-stream' })
  } finally {
    instance.off('progress', onProgress)
    try {
      await instance.deleteFile(inputName)
    } catch {
      // 忽略清理失败
    }
    try {
      await instance.deleteFile(options.outputName)
    } catch {
      // 忽略清理失败
    }
  }
}

export function useFFmpeg() {
  return {
    state,
    loading,
    progress,
    error,
    ensureLoaded,
    getFFmpeg,
    transcode,
  }
}

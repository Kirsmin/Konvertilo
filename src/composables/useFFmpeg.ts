import { computed, ref } from 'vue'
import type { FFmpeg } from '@ffmpeg/ffmpeg'
import { useUiStore } from '../stores/ui'
import { clampProgress, fileExtension } from '../utils/format'

type EngineState = 'idle' | 'loading' | 'ready' | 'error'

// wasm 核心超过 Cloudflare Pages 25MB 限制，改从 npmmirror CDN 拉取，
// 版本需与 package.json 中 @ffmpeg/core 保持一致。
const CORE_VERSION = '0.12.10'
const CORE_JS = `https://registry.npmmirror.com/@ffmpeg/core/${CORE_VERSION}/files/dist/umd/ffmpeg-core.js`
const CORE_WASM = `https://registry.npmmirror.com/@ffmpeg/core/${CORE_VERSION}/files/dist/umd/ffmpeg-core.wasm`

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
    // 仅在真正需要时加载 ffmpeg 封装与 util，首屏不包含任何 wasm 代码。
    const [{ FFmpeg: FFmpegCtor }, { toBlobURL }] = await Promise.all([
      import('@ffmpeg/ffmpeg'),
      import('@ffmpeg/util'),
    ])

    releaseObjectUrls()

    coreObjectUrl = await toBlobURL(CORE_JS, 'text/javascript', true, (event) => {
      setProgress(rangeProgress(0, 4, event.received, event.total))
    })
    setProgress(4)

    wasmObjectUrl = await toBlobURL(CORE_WASM, 'application/wasm', true, (event) => {
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

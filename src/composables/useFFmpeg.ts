import { computed, ref } from 'vue'
import type { FFmpeg } from '@ffmpeg/ffmpeg'
import { useUiStore } from '../stores/ui'
import { clampProgress, fileExtension } from '../utils/format'
import { recommendedFileSize } from '../utils/limit'

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

/**
 * 核心只下载一次：blob URL 常驻页面生命周期。
 * 引擎崩溃后重建实例时可以直接复用，不必再拉 32MB。
 */
async function ensureCoreUrls() {
  if (coreObjectUrl && wasmObjectUrl) return

  coreObjectUrl = await downloadBlobUrl(CORE_JS, 'text/javascript', (event) => {
    setProgress(rangeProgress(0, 4, event.received, event.total))
  })
  setProgress(4)

  wasmObjectUrl = await downloadBlobUrl(CORE_WASM, 'application/wasm', (event) => {
    setProgress(rangeProgress(4, 98, event.received, event.total))
  })
  setProgress(99)
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

    await ensureCoreUrls()

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

/**
 * 销毁当前实例（wasm trap 之后实例已不可用）。
 * 核心 blob URL 保留，下一次 ensureLoaded 只会重新实例化，不会重新下载。
 */
function resetEngine() {
  if (instance) {
    try {
      instance.terminate()
    } catch {
      // 忽略终止失败
    }
  }
  instance = null
  state.value = 'idle'
  error.value = ''
  setProgress(0)
}

function isFatalWasmError(reason: unknown): boolean {
  const detail = reason instanceof Error ? reason.message : String(reason)
  return (
    detail.includes('memory access out of bounds') ||
    detail.includes('function signature mismatch') ||
    detail.includes('RuntimeError') ||
    detail.includes('unreachable')
  )
}

/** 文件超过设备能力时，ffmpeg / 浏览器给出的典型报错 */
const SIZE_FAILURE = new RegExp(
  [
    'File could not be read',
    'Cannot enlarge memory',
    'Array buffer allocation failed',
    'out of memory',
    'No space left on device',
    'Invalid (typed )?array length',
  ].join('|'),
  'i',
)

/** 把常见 ffmpeg 报错翻译成一句能看懂的话，原始日志仍附在后面 */
function friendlyFailure(log: string, code: number): string {
  if (log.includes('does not contain any stream')) {
    return '源文件里没有可用的流（例如视频没有音轨），无法完成该转换。'
  }
  if (log.includes('Invalid data found when processing input')) {
    return '无法识别这个文件，可能已损坏或容器不受支持。'
  }
  if (log.includes('Could not find tag for codec')) {
    return '目标容器不支持所选编码器，请换一个编码器再试。'
  }
  if (log.includes('No space left on device')) {
    return 'wasm 虚拟磁盘空间不足，文件可能过大。'
  }
  return `ffmpeg 返回失败（退出码 ${code}）。`
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
 *
 * 关键点：
 * - exec 返回的是退出码，非 0 必须当作失败，否则 ffmpeg 报错时会留下 0 字节 /
 *   半截文件，界面却显示「转换成功」；
 * - 收集 ffmpeg 日志尾部拼进错误信息，用户点「复制错误信息」就能拿到真正原因；
 * - wasm trap（内存越界等）之后实例状态不可靠，此时直接 reset，下一次自动重建，
 *   否则后续每次转换都可能静默失败。
 */
export async function transcode(options: TranscodeOptions): Promise<Blob> {
  const ffmpeg = instance
  if (!ffmpeg || state.value !== 'ready') {
    throw new Error('ffmpeg.wasm 引擎尚未就绪')
  }
  if (options.signal?.aborted) {
    throw new DOMException('转码已中止', 'AbortError')
  }

  const { fetchFile } = await import('@ffmpeg/util')
  const extension = fileExtension(options.file.name) || 'input'
  const inputName = `input.${extension}`
  const logs: string[] = []
  const onLog = ({ message }: { message: string }) => {
    logs.push(message)
    if (logs.length > 200) logs.shift()
    // 本地开发时把 ffmpeg 原始输出打到控制台，方便定位编码器/参数问题
    if (import.meta.env.DEV) console.debug('[ffmpeg]', message)
  }
  const onProgress = ({ progress: value }: { progress: number }) => {
    options.onProgress?.(Math.max(0, Math.min(1, value)))
  }
  const tail = () => logs.slice(-12).join('\n')

  ffmpeg.on('log', onLog)
  ffmpeg.on('progress', onProgress)

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(options.file))
    const code = await ffmpeg.exec(
      ['-i', inputName, ...options.args, options.outputName],
      undefined,
      { signal: options.signal },
    )
    if (code !== 0) {
      const log = tail()
      // 尺寸问题只给结论，日志里也就是一句 Code=-1，没有诊断价值
      if (SIZE_FAILURE.test(log)) {
        throw new Error('文件尺寸过大')
      }
      const hint = friendlyFailure(log, code)
      const lines = log.split('\n').length
      throw new Error(`${hint}\n--- ffmpeg 日志（末尾 ${lines} 行）---\n${log}`)
    }

    const data = await ffmpeg.readFile(options.outputName)
    const bytes =
      typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
    if (bytes.byteLength === 0) {
      const log = tail()
      throw new Error(`输出文件为空，转换没有真正完成。\n--- ffmpeg 日志 ---\n${log}`)
    }
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    return new Blob([buffer], { type: options.mimeType ?? 'application/octet-stream' })
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : String(reason)
    // 浏览器侧分配不出 ArrayBuffer 也归到尺寸问题
    if (!options.signal?.aborted && SIZE_FAILURE.test(detail)) {
      throw new Error('文件尺寸过大')
    }
    // 成功的 exec 也可能在收尾时打印 Aborted()，只对真正的 wasm trap 重建实例
    if (!options.signal?.aborted && isFatalWasmError(reason)) {
      resetEngine()
      if (options.file.size > recommendedFileSize()) {
        throw new Error('文件尺寸过大')
      }
      throw new Error(
        '引擎在这段素材上崩溃了（wasm 内存越界或编码器不可用）。' +
          '引擎已自动重置，可直接重试，或换一个编码器 / 更小的文件。',
      )
    }
    throw reason
  } finally {
    ffmpeg.off('progress', onProgress)
    ffmpeg.off('log', onLog)
    if (instance === ffmpeg) {
      try {
        await ffmpeg.deleteFile(inputName)
      } catch {
        // 忽略清理失败
      }
      try {
        await ffmpeg.deleteFile(options.outputName)
      } catch {
        // 忽略清理失败
      }
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
    resetEngine,
    getFFmpeg,
    transcode,
  }
}

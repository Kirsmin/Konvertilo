import { computed, ref } from 'vue'
import type { FFmpeg } from '@ffmpeg/ffmpeg'
import { useUiStore } from '../stores/ui'
import { clampProgress, fileExtension, formatDuration } from '../utils/format'
import { recommendedFileSize } from '../utils/limit'

type EngineState = 'idle' | 'loading' | 'ready' | 'error'

/**
 * wasm 核心超过 Cloudflare Pages 25MB 限制，改从 npmmirror CDN 拉取。
 * 版本号由 vite.config.ts 从 package.json 的 @ffmpeg/core 依赖注入，
 * 避免升级依赖后这里的硬编码悄悄漂移（旧核心 + 新封装 = 运行时白屏）。
 * Vite 将 worker 构建为 module 类型，importScripts 不可用，
 * 必须走 esm 构建（带 export default），umd 会报 "failed to import ffmpeg-core.js"。
 */
const CORE_VERSION = __FFMPEG_CORE_VERSION__

/**
 * 核心按「先镜像、后回退」的顺序下载：npmmirror 国内快，海外偶尔会慢到几十秒，
 * 这时自动换 jsDelivr / unpkg。任一源成功即可，全部失败才报错。
 */
interface Mirror {
  name: string
  base: (pkg: string) => string
}

const MIRRORS: Mirror[] = [
  {
    name: 'npmmirror',
    base: (pkg) => `https://registry.npmmirror.com/@ffmpeg/${pkg}/${CORE_VERSION}/files/dist/esm/`,
  },
  {
    name: 'jsdelivr',
    base: (pkg) => `https://cdn.jsdelivr.net/npm/@ffmpeg/${pkg}@${CORE_VERSION}/dist/esm/`,
  },
  {
    name: 'unpkg',
    base: (pkg) => `https://unpkg.com/@ffmpeg/${pkg}@${CORE_VERSION}/dist/esm/`,
  },
]

/**
 * 引擎档位：
 * - multi：@ffmpeg/core-mt（pthreads），编码/滤镜可以并行，实测 720p H.264 约快 2 倍；
 * - single：@ffmpeg/core，任何设备、任何环境都能跑。
 *
 * 多线程版依赖 SharedArrayBuffer，必须页面处于 cross-origin isolated
 * （响应头 COOP/COEP），因此还要按设备能力判断是否值得开启。
 */
type EngineMode = 'multi' | 'single'

/**
 * 线程数上限。core-mt 的 pthread 池只有 4 个槽位：实测 -threads 5 仍正常，
 * 6/8 会直接卡死（ffmpeg 默认按 32 个逻辑核开线程也必然卡死），
 * 所以这里固定夹到 4，并且**每次 exec 都必须显式传 -threads**。
 */
const MAX_THREADS = 4
/** 低于这些规格的设备不值得开多线程：线程一多，内存与调度反而拖慢 */
const MIN_CORES_FOR_MULTI = 4
const MIN_MEMORY_FOR_MULTI = 4

/**
 * 引擎实例的回收阈值：连续转码这么多条后主动销毁重建实例。
 * wasm32 的线性内存在大量异质素材（不同编码器/分辨率）转换后会严重碎片化，
 * 继续复用实例轻则内存暴涨、重则渲染进程 OOM 直接白屏（实测 34+ 条后必现），
 * 而核心 blob URL 常驻，重建实例只需重新实例化（秒级），比崩一次便宜得多。
 */
export const ENGINE_RECYCLE_AFTER = 8

interface EnginePlan {
  mode: EngineMode
  threads: number
}

/**
 * 按设备能力决定引擎档位与线程数：
 * - 浏览器不支持 SAB / 页面未隔离 → 单线程；
 * - 2 核或 2GB 内存的小设备 → 单线程（多线程只会抢资源）；
 * - 其余按「核数-1」与内存档位取小，夹在 2~4 之间。
 */
export function planEngine(): EnginePlan {
  const nav = navigator as Navigator & { deviceMemory?: number }
  const cores = nav.hardwareConcurrency ?? 2
  const memory = nav.deviceMemory ?? 4
  const isolated =
    typeof SharedArrayBuffer !== 'undefined' &&
    (globalThis as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true

  // 2GB 及以下的机型（多为入门手机）开多线程只会抢内存与 CPU，直接单线程
  if (!isolated || cores < MIN_CORES_FOR_MULTI || memory <= 2) {
    return { mode: 'single', threads: 1 }
  }

  const byCores = Math.min(MAX_THREADS, Math.max(1, cores - 1))
  const byMemory = memory < MIN_MEMORY_FOR_MULTI ? 2 : MAX_THREADS
  const threads = Math.max(2, Math.min(byCores, byMemory))
  return threads >= 2 ? { mode: 'multi', threads } : { mode: 'single', threads: 1 }
}

/** 核心初始化超时：加载卡住时宁可报错重试，也不让界面停在「下载引擎中」 */
const LOAD_TIMEOUT = 90_000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (reason) => {
        clearTimeout(timer)
        reject(reason)
      },
    )
  })
}

/** 首字节等待上限 / 传输停滞上限：超时就换源，不把用户晾在 0% */
const FIRST_BYTE_TIMEOUT = 15_000
const STALL_TIMEOUT = 20_000

/** 模块级单例：整个应用只加载一次引擎 */
const state = ref<EngineState>('idle')
const progress = ref(0)
const error = ref('')
const loading = computed(() => state.value === 'loading')

/**
 * 下载进度详情：百分比之外还给已下载体积与速度，便于用户判断要不要等。
 * indeterminate：CDN 返回的是压缩响应，Content-Length 是压缩后大小，
 * 解压后的字节数会超过它，此时总大小未知，进度条改为不定态（不要假装 98% 卡住）。
 */
const download = ref({ received: 0, total: 0, bps: 0, source: '', indeterminate: false })

/** 当前实际生效的引擎档位（加载失败会自动降级，所以运行时才能确定） */
const plan = ref<EnginePlan>(planEngine())
const mode = computed(() => plan.value.mode)
const threads = computed(() => plan.value.threads)

let instance: FFmpeg | null = null
let loadPromise: Promise<void> | null = null
let coreObjectUrl = ''
let wasmObjectUrl = ''
let workerObjectUrl = ''
/** 转换/探测进行中：避免同时占用同一份 MEMFS */
let busy = false
/** 当前实例已完成的 exec 次数：超过阈值后由转换层触发回收重建 */
let execsSinceBoot = 0
/** 引擎下载的中止控制器：用户点「取消」时中断所有镜像的 fetch */
let loadAbortController: AbortController | null = null

/** 引擎被 wasm trap 打崩、已经重置：调用方可以决定是否重试一次 */
export class EngineCrashedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineCrashedError'
  }
}

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
  bps: number
  indeterminate: boolean
}

/**
 * 下载单个 URL 并生成 blob URL。
 *
 * 不用 @ffmpeg/util 的 toBlobURL：它的进度实现拿 Content-Length 校验收到的
 * 字节数，但 CDN 缓存命中后响应是 gzip/br 压缩的，Content-Length 是压缩后
 * 大小（跨域请求还读不到 Content-Encoding），校验必然失败；失败分支又会再次
 * 读取同一个 response，抛出 "Response.arrayBuffer: Body has already been consumed."。
 * 这里只消费一次响应体，进度按已收字节估算，不做长度相等校验。
 */
/** 核心文件的 npm 包归属，用于查完整性哈希表 */
type CorePackage = 'core' | 'core-mt'

/**
 * 校验下载到的核心文件与构建期注入的 SHA-256 是否一致。
 * 三个 CDN 任一个被劫持/篡改都会在哈希这一层被拦下，换源重试；
 * 全部不符则整体报错，绝不让被篡改的 js/wasm 以 blob 形式执行。
 */
async function verifyCoreIntegrity(
  pack: CorePackage,
  file: CoreFile,
  bytes: Uint8Array,
): Promise<void> {
  const expected = __FFMPEG_CORE_INTEGRITY__?.[pack]?.[file]
  // 本地拿不到哈希表或环境不支持 WebCrypto 时跳过校验（不影响功能）
  if (!expected || !globalThis.crypto?.subtle) return
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  )
  const actual = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  if (actual !== expected) {
    throw new Error(`核心文件 ${file} 完整性校验失败（哈希不符），已丢弃该副本`)
  }
}

async function downloadOnce(
  url: string,
  mimeType: string,
  onProgress?: (event: DownloadProgress) => void,
  pack?: CorePackage,
  file?: CoreFile,
  signal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController()
  // 外部中止（用户点取消）与内部看门狗（超时）任一触发都中断下载
  const onExternalAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onExternalAbort, { once: true })
  }
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const armWatchdog = (ms: number) => {
    if (watchdog) clearTimeout(watchdog)
    watchdog = setTimeout(() => controller.abort(new Error('下载超时')), ms)
  }

  armWatchdog(FIRST_BYTE_TIMEOUT)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`下载核心失败：HTTP ${response.status}`)
    }
    armWatchdog(STALL_TIMEOUT)

    const total = Number(response.headers.get('content-length') ?? 0)
    const reader = response.body?.getReader()

    let bytes: Uint8Array
    if (reader) {
      const chunks: Uint8Array[] = []
      let received = 0
      let sampleAt = performance.now()
      let sampleBytes = 0
      let bps = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        armWatchdog(STALL_TIMEOUT)
        chunks.push(value)
        received += value.byteLength
        const now = performance.now()
        if (now - sampleAt >= 300) {
          // 指数平滑，避免数字乱跳
          bps = 0.7 * ((received - sampleBytes) / ((now - sampleAt) / 1000)) + 0.3 * bps
          sampleAt = now
          sampleBytes = received
        }
        onProgress?.({ received, total, bps, indeterminate: total > 0 && received > total })
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
      throw new Error(`下载核心不完整：${bytes.byteLength}/${total}`)
    }
    // 以 blob 执行前先核对 SHA-256：被篡改的核心在这一步被拦下
    if (pack && file) await verifyCoreIntegrity(pack, file, bytes)
    onProgress?.({
      received: bytes.byteLength,
      total: bytes.byteLength,
      bps: 0,
      indeterminate: false,
    })

    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    return URL.createObjectURL(new Blob([buffer], { type: mimeType }))
  } finally {
    if (watchdog) clearTimeout(watchdog)
    // 外部 listener 挂在调用方的 signal 上，不摘除会随下载次数累积泄漏
    signal?.removeEventListener('abort', onExternalAbort)
  }
}

type CoreFile = 'ffmpeg-core.js' | 'ffmpeg-core.wasm' | 'ffmpeg-core.worker.js'

/** 当前档位对应的 npm 包名 */
function corePackage(): CorePackage {
  return plan.value.mode === 'multi' ? 'core-mt' : 'core'
}

/** 依次尝试各镜像，返回第一个成功且通过完整性校验的 blob URL */
async function downloadWithFallback(
  file: CoreFile,
  mimeType: string,
  onProgress?: (event: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
  const pack = corePackage()
  let lastError: unknown = null
  for (const mirror of MIRRORS) {
    // 用户在镜像切换间隙点取消：不再发起新请求
    if (signal?.aborted) {
      throw new DOMException('下载已取消', 'AbortError')
    }
    const url = mirror.base(pack) + file
    try {
      const blobUrl = await downloadOnce(url, mimeType, onProgress, pack, file, signal)
      download.value.source = mirror.name
      return blobUrl
    } catch (reason) {
      lastError = reason
      if (import.meta.env.DEV) console.warn('[ffmpeg] 核心源失败，切换下一个：', url, reason)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('所有核心镜像均不可用')
}

/**
 * 核心只下载一次：blob URL 常驻页面生命周期。
 * 引擎崩溃后重建实例时可以直接复用，不必再拉 32MB。
 */
async function ensureCoreUrls(signal?: AbortSignal) {
  if (coreObjectUrl && wasmObjectUrl) return

  download.value = { received: 0, total: 0, bps: 0, source: '', indeterminate: false }
  coreObjectUrl = await downloadWithFallback('ffmpeg-core.js', 'text/javascript', (event) => {
    setProgress(rangeProgress(0, 3, event.received, event.total))
  }, signal)
  setProgress(3)

  wasmObjectUrl = await downloadWithFallback('ffmpeg-core.wasm', 'application/wasm', (event) => {
    download.value = {
      ...download.value,
      received: event.received,
      total: event.total,
      bps: event.bps,
      indeterminate: event.indeterminate,
    }
    setProgress(
      event.indeterminate
        ? 95
        : rangeProgress(3, 98, event.received, event.total),
    )
  })

  if (plan.value.mode === 'multi') {
    workerObjectUrl = await downloadWithFallback(
      'ffmpeg-core.worker.js',
      'text/javascript',
      (event) => {
        setProgress(rangeProgress(92, 98, event.received, event.total))
      },
      signal,
    )
  }
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

  // 本轮下载的中止信号：用户点「取消下载」时中断所有镜像请求
  const controller = new AbortController()
  loadAbortController = controller

  // 仅在真正需要时加载 ffmpeg 封装，首屏不包含任何 wasm 代码。
  const { FFmpeg: FFmpegCtor } = await import('@ffmpeg/ffmpeg')

  /** 按当前档位下载核心并实例化；多线程档位会额外下载 pthread worker */
  const boot = async (): Promise<FFmpeg> => {
    await ensureCoreUrls(controller.signal)
    const ffmpeg = new FFmpegCtor()
    // 初始化卡住（线程池异常、内存不足）时不要无限等待，超时就报错并允许降级/重试
    await withTimeout(
      ffmpeg.load({
        coreURL: coreObjectUrl,
        wasmURL: wasmObjectUrl,
        ...(plan.value.mode === 'multi' && workerObjectUrl
          ? { workerURL: workerObjectUrl }
          : {}),
      }),
      LOAD_TIMEOUT,
      '引擎初始化超时',
    )
    return ffmpeg
  }

  try {
    try {
      instance = await boot()
      // 新实例从零开始计数：回收阈值只对「同一实例连续转码」生效
      execsSinceBoot = 0
    } catch (reason) {
      // 用户主动取消：不记为错误，回到空闲态等待下次触发
      if (controller.signal.aborted) {
        state.value = 'idle'
        if (!silent && ui.status === 'downloading') ui.status = 'idle'
        return
      }
      // 多线程档位失败（镜像缺 worker、内存不足、浏览器不支持等）：
      // 丢掉 core-mt 的 blob，换回单线程核心重来一次，绝不让用户卡死在这里。
      if (plan.value.mode !== 'multi') throw reason
      if (import.meta.env.DEV) console.warn('[ffmpeg] 多线程核心不可用，降级单线程：', reason)
      plan.value = { mode: 'single', threads: 1 }
      coreObjectUrl = ''
      wasmObjectUrl = ''
      workerObjectUrl = ''
      setProgress(0)
      download.value = { received: 0, total: 0, bps: 0, source: '', indeterminate: false }
      instance = await boot()
    }

    state.value = 'ready'
    setProgress(100)
    if (!silent && ui.status === 'downloading') {
      ui.status = 'idle'
    }
  } catch (reason) {
    state.value = 'error'
    const detail = reason instanceof Error ? reason.message : String(reason)
    // 下载阶段网络失败时 reason 往往只有一句 "Failed to fetch"，补一句人话
    error.value = /fetch|network|HTTP/i.test(detail)
      ? `引擎核心下载失败（三个镜像都不可用）：${detail}。请检查网络后重试。`
      : normalizeError(reason)
    if (!silent) {
      ui.errorText = error.value
      ui.status = 'error'
    }
  } finally {
    loadAbortController = null
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

/**
 * 用户取消引擎下载：中断当前所有镜像请求。
 * loadEngine 会把状态退回空闲，不记为错误；下次 ensureLoaded 可重新下载。
 */
function cancelEngineLoad() {
  loadAbortController?.abort()
}

/**
 * 当前实例是否该回收重建了（连续转码过多，wasm 内存碎片化）。
 * 由转换层在任务间隙调用：true 时先 resetEngine() 再 ensureLoaded()，
 * 核心 blob URL 常驻，重建只重新实例化，通常几秒内完成。
 */
export function shouldRecycleEngine(): boolean {
  return execsSinceBoot >= ENGINE_RECYCLE_AFTER
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
    'Cannot enlarge memory',
    'Array buffer allocation failed',
    'out of memory',
    'No space left on device',
    'Invalid (typed )?array length',
    'allocation size overflow',
  ].join('|'),
  'i',
)

/**
 * 常见报错 → 一句能看懂的话。
 * 顺序有意义：越具体的规则排在越前面（如帧率不支持要先于笼统的 does not support）。
 */
const FRIENDLY_ERRORS: Array<[RegExp, string]> = [
  [
    /does not contain any stream/i,
    '源文件里没有可用的流（例如视频没有音轨），无法完成该转换。',
  ],
  [
    /File could not be read/i,
    '文件读取失败，可能已损坏、被加密或没有权限，无法处理。',
  ],
  [
    /Invalid data found when processing input/i,
    '无法识别这个文件，可能已损坏或容器不受支持。',
  ],
  [
    /Could not find tag for codec|codec not currently supported in container/i,
    '目标容器不支持所选编码器，请换一个编码器再试。',
  ],
  [
    /Could not write header/i,
    '目标容器无法写入所选编码器与参数的组合，请换一个编码器或目标格式。',
  ],
  [
    /does not support .*fps|frame rate.*not supported/i,
    '源素材的帧率不在该编码器支持的档位内（MPEG-1 仅支持 24/25/30 等标准帧率），请换一个编码器或先转成 25fps 素材。',
  ],
  [
    /Incompatible pixel format|pixel format .* is not supported|does not support .*pix/i,
    '源素材的像素格式不受该编码器支持，请换一个编码器再试。',
  ],
  [
    /Unknown encoder|Encoder not found|Encoder \(codec .*\) not found/i,
    '当前引擎不包含所选编码器，请换一个编码器再试。',
  ],
  [
    /bitrate too low|Bitrate .* not supported at|invalid bitrate/i,
    '当前码率低于该编码器对这段素材（声道数）的下限，请把质量调高一档再试。',
  ],
  [
    /Invalid value for crf|crf .*out of range/i,
    '该编码器的质量档位不支持这个值（VP8 的 CRF 最低为 4），请把质量调低一档再试。',
  ],
  [
    /Error while opening encoder|Could not open encoder/i,
    '编码器无法用当前参数初始化，请换一个编码器或目标格式。',
  ],
]

/** 把常见 ffmpeg 报错翻译成一句能看懂的话，原始日志仍附在后面 */
function friendlyFailure(log: string, code: number): string {
  for (const [pattern, message] of FRIENDLY_ERRORS) {
    if (pattern.test(log)) return message
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
 * 产物自检：退出码 0 并不等于产物可播放。
 * 典型例子是 qtrle 封装进 Matroska —— ffmpeg 正常收尾、文件非空，
 * 但流头缺少色彩空间信息，播放器与 ffprobe 都打不开。
 *
 * 实现上只做「解析头部」，不做真正的解码：
 * - 解析阶段就会暴露 qtrle-in-MKV 这类"打不开"的产物（ffprobe 同样在这一步失败）；
 * - core-mt 上第二次解码执行会死锁（pthread 池问题），解析式校验不受影响。
 */
const UNPLAYABLE_PATTERNS: RegExp[] = [
  /Unsupported colorspace/i,
  /Error while opening decoder/i,
  /could not find codec parameters/i,
  /Invalid data found/i,
  /Unknown decoder/i,
  /Unsupported codec/i,
  /moov atom not found/i,
  /does not contain any stream/i,
  /Error opening input file/i,
]

async function assertParsable(
  ffmpeg: FFmpeg,
  outputName: string,
  signal?: AbortSignal,
) {
  const lines: string[] = []
  const onLog = ({ message }: { message: string }) => {
    lines.push(message)
    if (lines.length > 40) lines.shift()
  }

  ffmpeg.on('log', onLog)
  try {
    // 只给 -i、不给输出文件：ffmpeg 必然以 "At least one output file" 退出，
    // 所以我们不看退出码，只看它解析出了什么错误。
    await ffmpeg.exec(['-v', 'error', '-threads', '1', '-i', outputName], undefined, {
      signal,
    })
  } catch (reason) {
    if (signal?.aborted) throw reason
    // 解析阶段的异常同样按产物不可用处理，下面统一看日志
  } finally {
    ffmpeg.off('log', onLog)
  }

  const text = lines.join('\n')
  const hit = UNPLAYABLE_PATTERNS.find((pattern) => pattern.test(text))
  if (!hit) return

  const detail = lines.filter((line) => line.trim()).slice(-6).join('\n')
  throw new Error(
    '产物校验失败：生成的文件无法被播放器解析，已丢弃而不是让你下载坏文件。\n' +
      '请换一个编码器或目标格式后重试。' +
      (detail
        ? `\n--- 校验日志（末尾 ${Math.max(1, detail.split('\n').length)} 行）---\n${detail}`
        : ''),
  )
}

/**
 * 真实 wasm 转码：写入输入 -> exec -> 校验产物 -> 读回输出 -> 清理临时文件。
 *
 * 关键点：
 * - exec 返回的是退出码，非 0 必须当作失败，否则 ffmpeg 报错时会留下 0 字节 /
 *   半截文件，界面却显示「转换成功」；
 * - 退出码 0 还要再校验一遍产物能不能被解析（assertParsable）；
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

  busy = true
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

    await assertParsable(ffmpeg, options.outputName, options.signal)

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
      throw new EngineCrashedError(
        '引擎在这段素材上崩溃了（wasm 内存越界或编码器不可用）。' +
          '引擎已自动重置，可直接重试，或换一个编码器 / 更小的文件。',
      )
    }
    throw reason
  } finally {
    busy = false
    execsSinceBoot += 1
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

/** 只有体积不大的文件才值得为了读时长整份塞进 MEMFS（否则先占一份内存） */
const PROBE_SIZE_LIMIT = 128 * 1024 * 1024

/**
 * 用引擎读一次文件头，补上浏览器原生解不出来的时长（wma / ac3 / ts / flv 等）。
 * ffmpeg 只给 -i 不给输出文件时会返回非 0，这是正常现象，只看日志里的 Duration。
 */
export async function probeMetadata(file: File): Promise<string | null> {
  const ffmpeg = instance
  if (!ffmpeg || state.value !== 'ready' || busy) return null
  if (file.size > PROBE_SIZE_LIMIT) return null

  busy = true
  const { fetchFile } = await import('@ffmpeg/util')
  const extension = fileExtension(file.name) || 'input'
  const inputName = `probe.${extension}`
  const logs: string[] = []
  const onLog = ({ message }: { message: string }) => {
    logs.push(message)
    if (logs.length > 80) logs.shift()
  }

  ffmpeg.on('log', onLog)
  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file))
    await ffmpeg.exec(['-hide_banner', '-threads', '1', '-i', inputName])
  } catch {
    // 读不了就当探测失败，不影响主流程
  } finally {
    ffmpeg.off('log', onLog)
    try {
      await ffmpeg.deleteFile(inputName)
    } catch {
      // 忽略清理失败
    }
    busy = false
  }

  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(logs.join('\n'))
  if (!match) return null
  const seconds =
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  return seconds > 0 ? formatDuration(seconds) : null
}

export function useFFmpeg() {
  return {
    state,
    loading,
    progress,
    error,
    download,
    mode,
    threads,
    ensureLoaded,
    resetEngine,
    cancelEngineLoad,
    shouldRecycleEngine,
    getFFmpeg,
    transcode,
    probeMetadata,
  }
}

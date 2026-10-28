import type { ConverterConfig, Task } from '../types'

const DEFAULT_CRF = 23
/** MPEG 系编码器的 qscale 取值范围（1 最好 / 31 最差） */
const QSCALE_MIN = 1
const QSCALE_MAX = 31
const CRF_MAX = 51

const MIME_BY_FORMAT: Record<string, string> = {
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ac3: 'audio/ac3',
  aiff: 'audio/aiff',
  wma: 'audio/x-ms-wma',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  gif: 'image/gif',
}

/** 目标格式对应的 MIME，用于真实输出 Blob */
export function mimeTypeForFormat(format: string): string {
  return MIME_BY_FORMAT[format.toLowerCase()] ?? 'application/octet-stream'
}

function parseCrf(quality: string): number {
  const match = /CRF\s+(\d+)/i.exec(quality)
  const crf = match ? Number.parseInt(match[1], 10) : Number.NaN
  if (!Number.isFinite(crf)) return DEFAULT_CRF
  return Math.min(CRF_MAX, Math.max(0, crf))
}

/**
 * 界面统一用 CRF 0-51 作为质量轴（0 最好），MPEG 系编码器不吃 CRF，
 * 按线性关系折算成 qscale 1-31（1 最好），保证「拉高质量 → 体积变大」单调可控。
 */
function crfToQscale(crf: number): number {
  const qscale = QSCALE_MIN + (crf / CRF_MAX) * (QSCALE_MAX - QSCALE_MIN)
  return Math.min(QSCALE_MAX, Math.max(QSCALE_MIN, Math.round(qscale)))
}

/** 无损 / PCM 编码器不接受码率，传 -b:a 只会得到一条「未使用」警告 */
const LOSSLESS_AUDIO_ENCODERS = new Set([
  'flac',
  'alac',
  'pcm_s16le',
  'pcm_s24le',
  'pcm_s32le',
  'pcm_f32le',
  'pcm_f64le',
  'pcm_alaw',
  'pcm_mulaw',
  'pcm_u8',
  'pcm_s16be',
  'pcm_s24be',
  'pcm_s32be',
  'pcm_f32be',
  'pcm_f64be',
  'pcm_s8',
])

/** 接受 -crf 的视频编码器（x264 / vpx 系） */
const CRF_ENCODERS = new Set(['libx264', 'libvpx'])

/**
 * 只接受 qscale 的视频编码器（MPEG 系）。
 * 这些编码器既没有 CRF，也不建议给固定码率：默认 qscale 更适合画质可控，
 * 因此把界面上的 CRF 档位折算成 -q:v。
 */
const QSCALE_ENCODERS = new Set([
  'mpeg1video',
  'mpeg2video',
  'mpeg4',
  'msmpeg4',
  'msmpeg4v2',
  'wmv2',
])

/** 无损 / 无压缩编码器：体积可能远大于源文件，界面上要提前说明 */
const LOSSLESS_VIDEO_ENCODERS = new Set([
  'ffv1',
  'huffyuv',
  'utvideo',
  'qtrle',
  'png',
  'rawvideo',
  'prores_ks',
  'prores_aw',
  'prores',
])

export function isLosslessVideoEncoder(encoder: string): boolean {
  return LOSSLESS_VIDEO_ENCODERS.has(encoder)
}

/** 需要显式转 yuv420p 的编码器：避免 10bit / 带 alpha 的源产出无法播放的文件 */
const YUV420P_ENCODERS = new Set([
  'libx264',
  'libvpx',
  'mpeg4',
  'mpeg1video',
  'mpeg2video',
])

/**
 * 各编码器的 CRF 下限。libvpx 的 -crf 取值范围是 4~63，
 * 界面上的 0~3 档给它会直接初始化失败（Invalid value for crf）。
 */
const CRF_FLOOR: Record<string, number> = { libvpx: 4 }

/**
 * 帧率档位受限的编码器。MPEG-1 只支持 23.976/24/25/29.97/30/50/59.94/60，
 * 源素材是 15fps 这类非标准帧率时编码器直接拒绝（MPEG-1/2 does not support 15/1 fps），
 * 所以在输出端统一归一到 25fps：时长不变，只做丢帧/补帧。
 */
const FPS_NORMALIZED_ENCODERS = new Map<string, number>([['mpeg1video', 25]])

/**
 * 视频→视频时的音频编码，按目标容器显式指定。
 * 不写 -c:a 时结果取决于 ffmpeg 对容器的默认映射，遇到特殊源流（ac3/mp3 直拷）
 * 容易产出浏览器播放不了的组合，这里固定成各容器最稳的选择。
 */
const AUDIO_ARGS_BY_CONTAINER: Record<string, string[]> = {
  MP4: ['-c:a', 'aac', '-b:a', '128k'],
  MOV: ['-c:a', 'aac', '-b:a', '128k'],
  MKV: ['-c:a', 'aac', '-b:a', '128k'],
  // 不用 libopus：该 wasm 构建里双声道 opus 会崩掉整个渲染进程
  WEBM: ['-c:a', 'libvorbis', '-b:a', '128k'],
  AVI: ['-c:a', 'libmp3lame', '-b:a', '192k'],
}

/**
 * 质量参数是否对该编码器生效。
 * 不生效时界面只显示静态文本（没有虚线下划线），避免给出无效选项。
 */
export function isQualityApplicable(
  converter: ConverterConfig,
  targetFormat: string,
  encoder: string,
): boolean {
  if (converter.to === 'Audio') return !LOSSLESS_AUDIO_ENCODERS.has(encoder)
  if (targetFormat === 'GIF') return false
  return CRF_ENCODERS.has(encoder) || QSCALE_ENCODERS.has(encoder)
}

/** 该编码器的质量下拉是否按 qscale 生效（用于界面提示与参数生成） */
export function usesQscale(encoder: string): boolean {
  return QSCALE_ENCODERS.has(encoder)
}

/**
 * 按转换器类型与任务参数生成 ffmpeg 参数（不含 -i 输入与输出名）。
 * - 视频->音频：丢弃视频流，按编码器 + 码率输出音频（无损编码器不带码率）
 * - 音频->音频：按编码器 + 码率转码
 * - 视频->视频：按编码器装配质量参数（CRF / qscale）+ 像素格式 + 帧率，
 *   并显式指定音频编码；目标为 GIF 时固定 gif 编码器，限制帧率与宽度
 *   （否则 6 秒 640x360 的 GIF 就有 3MB+）
 */
export interface EncodeOptions {
  /**
   * 线程数。多线程核心必须显式传：ffmpeg 默认会按逻辑核数（可能是 32）开线程，
   * 而 core-mt 的 pthread 池只有 4 个槽位，超过就会死锁。
   */
  threads?: number
}

export function buildFFmpegArgs(
  converter: ConverterConfig,
  task: Task,
  options: EncodeOptions = {},
): string[] {
  const threads = options.threads && options.threads > 1 ? options.threads : 0
  const withThreads = (args: string[]): string[] =>
    threads ? [...args, '-threads', String(threads)] : args

  if (converter.to === 'Audio') {
    const args = ['-c:a', task.encoder]
    if (!LOSSLESS_AUDIO_ENCODERS.has(task.encoder)) {
      args.push('-b:a', task.quality)
    }
    return withThreads(converter.from === 'Video' ? ['-vn', ...args] : args)
  }

  if (task.targetFormat === 'GIF') {
    // 只缩小不放大：320×180 这类小素材原来会被无端上采样到 480×270，
    // 体积变大、画质并无收益。min(480,iw) 保证宽不超过 480 且绝不放大。
    return withThreads([
      '-an',
      '-c:v',
      'gif',
      '-vf',
      "fps=12,scale='min(480,iw)':-1:flags=lanczos",
      '-loop',
      '0',
    ])
  }

  const args = ['-c:v', task.encoder]
  if (CRF_ENCODERS.has(task.encoder)) {
    const floor = CRF_FLOOR[task.encoder] ?? 0
    args.push('-crf', String(Math.max(floor, parseCrf(task.quality))))
    if (task.encoder === 'libvpx') {
      // VP8 的 -crf 只有在 -b:v 0（纯质量模式）下才真正生效，
      // 否则仍以默认码率为准，质量档位几乎是装饰品。
      args.push('-b:v', '0')
      // 默认 cpu-used=0 慢到 10 倍实时；2 档在画质几乎无差的前提下快 2~3 倍
      args.push('-deadline', 'good', '-cpu-used', '2')
    }
  } else if (QSCALE_ENCODERS.has(task.encoder)) {
    args.push('-q:v', String(crfToQscale(parseCrf(task.quality))))
  }
  if (YUV420P_ENCODERS.has(task.encoder)) {
    args.push('-pix_fmt', 'yuv420p')
  }
  const fps = FPS_NORMALIZED_ENCODERS.get(task.encoder)
  if (fps) {
    args.push('-r', String(fps))
  }
  const audioArgs = AUDIO_ARGS_BY_CONTAINER[task.targetFormat]
  if (audioArgs) {
    args.push(...audioArgs)
  }
  return withThreads(args)
}

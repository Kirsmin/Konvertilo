import type { ConverterConfig, Task } from '../types'

const DEFAULT_CRF = 23

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
  return Number.isFinite(crf) ? crf : DEFAULT_CRF
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

/** 主流编码器统一转 yuv420p，避免 10bit / 带 alpha 的源产出无法播放的文件 */
const YUV420P_ENCODERS = new Set(['libx264', 'libvpx', 'mpeg4'])

/**
 * 按转换器类型与任务参数生成 ffmpeg 参数（不含 -i 输入与输出名）。
 * - 视频->音频：丢弃视频流，按编码器 + 码率输出音频（无损编码器不带码率）
 * - 音频->音频：按编码器 + 码率转码
 * - 视频->视频：按编码器 + CRF 转码；目标为 GIF 时固定 gif 编码器，
 *   并限制帧率与宽度（否则 6 秒 640x360 的 GIF 就有 3MB+）
 */
export function buildFFmpegArgs(converter: ConverterConfig, task: Task): string[] {
  if (converter.to === 'Audio') {
    const args = ['-c:a', task.encoder]
    if (!LOSSLESS_AUDIO_ENCODERS.has(task.encoder)) {
      args.push('-b:a', task.quality)
    }
    return converter.from === 'Video' ? ['-vn', ...args] : args
  }

  if (task.targetFormat === 'GIF') {
    return [
      '-an',
      '-c:v',
      'gif',
      '-vf',
      'fps=12,scale=480:-1:flags=lanczos',
      '-loop',
      '0',
    ]
  }

  const args = ['-c:v', task.encoder, '-crf', String(parseCrf(task.quality))]
  if (YUV420P_ENCODERS.has(task.encoder)) {
    args.push('-pix_fmt', 'yuv420p')
  }
  return args
}

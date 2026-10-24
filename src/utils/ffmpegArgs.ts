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

/**
 * 按转换器类型与任务参数生成 ffmpeg 参数（不含 -i 输入与输出名）。
 * - 视频->音频：丢弃视频流，按编码器 + 码率输出音频
 * - 音频->音频：按编码器 + 码率转码
 * - 视频->视频：按编码器 + CRF 转码；目标为 GIF 时固定 gif 编码器、不加 CRF
 */
export function buildFFmpegArgs(converter: ConverterConfig, task: Task): string[] {
  if (converter.to === 'Audio') {
    const args = ['-c:a', task.encoder, '-b:a', task.quality]
    return converter.from === 'Video' ? ['-vn', ...args] : args
  }

  if (task.targetFormat === 'GIF') {
    return ['-c:v', 'gif']
  }
  return ['-c:v', task.encoder, '-crf', String(parseCrf(task.quality))]
}

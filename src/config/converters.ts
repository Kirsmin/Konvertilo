import type { ConverterConfig } from '../types'

/** Video-Audio 目标格式：与产品配置保持一致，顺序即下拉框顺序 */
export const VIDEO_AUDIO_TARGETS = [
  'MP3',
  'AAC',
  'M4A',
  'OGG',
  'OPUS',
  'FLAC',
  'WAV',
  'AC3',
  'AIFF',
  'WMA',
]

export const AUDIO_TARGETS = [...VIDEO_AUDIO_TARGETS]

export const VIDEO_TARGETS = ['MP4', 'WEBM', 'MKV', 'MOV', 'AVI', 'GIF']

/**
 * 质量选项使用 ffmpeg 真正接受的参数值：
 * - 音频：标准码率，对应 -b:a（也兼容各类编码器的 VBR 场景）
 * - 视频：libx264 / libx265 的完整 CRF 取值 0-51，对应 -crf
 */
export const AUDIO_QUALITIES = [
  '8k',
  '16k',
  '24k',
  '32k',
  '40k',
  '48k',
  '56k',
  '64k',
  '80k',
  '96k',
  '112k',
  '128k',
  '144k',
  '160k',
  '192k',
  '224k',
  '256k',
  '320k',
]

export const VIDEO_QUALITIES = Array.from({ length: 52 }, (_, crf) => `CRF ${crf}`)

/**
 * 编码器均取自 @ffmpeg/core 0.12.10 的实际构建（ffmpeg -encoders），
 * 并按目标容器归类，避免出现容器不支持的编码器。
 */
const AUDIO_ENCODERS_BY_TARGET: Record<string, string[]> = {
  MP3: ['libmp3lame'],
  AAC: ['aac'],
  M4A: ['aac', 'alac', 'ac3'],
  OGG: ['libvorbis', 'libopus', 'flac'],
  OPUS: ['libopus'],
  FLAC: ['flac'],
  WAV: [
    'pcm_s16le',
    'pcm_s24le',
    'pcm_s32le',
    'pcm_f32le',
    'pcm_f64le',
    'pcm_alaw',
    'pcm_mulaw',
    'pcm_u8',
  ],
  AC3: ['ac3', 'ac3_fixed'],
  AIFF: [
    'pcm_s16be',
    'pcm_s24be',
    'pcm_s32be',
    'pcm_f32be',
    'pcm_f64be',
    'pcm_s8',
    'pcm_u8',
    'pcm_alaw',
    'pcm_mulaw',
  ],
  WMA: ['wmav1', 'wmav2'],
}

const VIDEO_ENCODERS_BY_TARGET: Record<string, string[]> = {
  MP4: ['libx264', 'libx265', 'mpeg4', 'mpeg2video', 'mpeg1video', 'mjpeg'],
  WEBM: ['libvpx-vp9', 'libvpx'],
  MKV: [
    'libx264',
    'libx265',
    'libvpx-vp9',
    'libvpx',
    'mpeg4',
    'mpeg2video',
    'mpeg1video',
    'ffv1',
    'prores_ks',
    'mjpeg',
    'gif',
    'huffyuv',
    'utvideo',
    'qtrle',
    'png',
  ],
  MOV: [
    'libx264',
    'libx265',
    'prores_ks',
    'prores_aw',
    'prores',
    'mpeg4',
    'mpeg2video',
    'mpeg1video',
    'mjpeg',
    'qtrle',
    'png',
  ],
  AVI: [
    'libx264',
    'mpeg4',
    'mjpeg',
    'msmpeg4v2',
    'msmpeg4',
    'wmv2',
    'ffv1',
    'huffyuv',
    'utvideo',
    'rawvideo',
  ],
  GIF: ['gif'],
}

export const VIDEO_SOURCE_EXTENSIONS = [
  'mp4',
  'm4v',
  'avi',
  'mov',
  'mkv',
  'webm',
  'flv',
  'wmv',
  'ts',
  'mts',
  'm2ts',
  '3gp',
]

export const AUDIO_SOURCE_EXTENSIONS = [
  'mp3',
  'wav',
  'flac',
  'aac',
  'm4a',
  'ogg',
  'oga',
  'opus',
  'wma',
  'aiff',
  'aif',
  'ac3',
]

/**
 * 所有转换器集中定义。
 * 路由、标题、源/目标类型以及目标格式、参数、示例数据都由这里驱动。
 */
export const CONVERTERS: ConverterConfig[] = [
  {
    path: '/Video-Audio',
    name: 'Video-Audio',
    title: '视频->音频',
    from: 'Video',
    to: 'Audio',
    accept: 'video/*',
    sourceExtensions: VIDEO_SOURCE_EXTENSIONS,
    targetFormats: VIDEO_AUDIO_TARGETS,
    defaultTarget: 'MP3',
    qualities: AUDIO_QUALITIES,
    defaultQuality: '192k',
    encodersByTarget: AUDIO_ENCODERS_BY_TARGET,
    sampleTasks: [],
    sampleOutputs: [],
  },
  {
    path: '/Video-Video',
    name: 'Video-Video',
    title: '视频->视频',
    from: 'Video',
    to: 'Video',
    accept: 'video/*',
    sourceExtensions: VIDEO_SOURCE_EXTENSIONS,
    targetFormats: VIDEO_TARGETS,
    defaultTarget: 'WEBM',
    qualities: VIDEO_QUALITIES,
    defaultQuality: 'CRF 23',
    encodersByTarget: VIDEO_ENCODERS_BY_TARGET,
    sampleTasks: [],
    sampleOutputs: [],
  },
  {
    path: '/Audio-Audio',
    name: 'Audio-Audio',
    title: '音频->音频',
    from: 'Audio',
    to: 'Audio',
    accept: 'audio/*',
    sourceExtensions: AUDIO_SOURCE_EXTENSIONS,
    targetFormats: AUDIO_TARGETS,
    defaultTarget: 'MP3',
    qualities: AUDIO_QUALITIES,
    defaultQuality: '192k',
    encodersByTarget: AUDIO_ENCODERS_BY_TARGET,
    sampleTasks: [],
    sampleOutputs: [],
  },
]

export function getConverter(from: string, to: string): ConverterConfig | undefined {
  return CONVERTERS.find((item) => item.from === from && item.to === to)
}

export function getConverterByPath(path: string): ConverterConfig | undefined {
  return CONVERTERS.find((item) => item.path === path)
}

/** 目标格式对应的编码器选项 */
export function getEncodersForTarget(
  converter: ConverterConfig,
  targetFormat: string,
): string[] {
  return (
    converter.encodersByTarget[targetFormat] ??
    converter.encodersByTarget[converter.defaultTarget] ??
    []
  )
}

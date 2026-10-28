import type { ConverterConfig } from '../types'

/** Video-Audio 目标格式：与产品配置保持一致，顺序即下拉框顺序 */
export const VIDEO_AUDIO_TARGETS = [
  'MP3',
  'AAC',
  'M4A',
  'OGG',
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
 * - 视频：完整 CRF 取值 0-51，libx264 / libvpx 直接用 -crf，
 *   MPEG 系编码器按档位折算成 -q:v（1-31），无损编码器不适用
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
 * 音频编码器能接受的最低码率（kbps）。
 * 低于下限时 ffmpeg 在初始化阶段直接失败（wmav1/wmav2 需 ≥24k），
 * 或静默抬到自身下限（ac3 实际最低 32k，8k 档和 32k 档产物一样大）。
 * 质量下拉按此过滤，避免选出「选了就一定失败/一定被改写」的档位。
 *
 * libvorbis 的下限随声道数变化（单声道 32k / 双声道 48k，实测），
 * 界面上拿不到声道数，这里按最常见的双声道取值，宁可可选项少一点：
 * 多声道素材若仍不够，会得到「码率低于编码器下限」的明确提示。
 */
const AUDIO_ENCODER_MIN_KBPS: Record<string, number> = {
  libmp3lame: 8,
  aac: 8,
  libvorbis: 48,
  ac3: 32,
  ac3_fixed: 32,
  wmav1: 24,
  wmav2: 24,
}

/**
 * 编码器按目标容器归类，且只保留在 @ffmpeg/core 0.12.10（单线程 wasm）里
 * 实测可用的组合。以下编码器虽然出现在该构建的 ffmpeg -encoders 里，
 * 但实测不可用 / 产物无效，已剔除：
 * - libvpx-vp9：编码第 1 帧即 RuntimeError: memory access out of bounds
 *   （-threads 1 / -b:v 0 皆无效），任何容器都崩；
 * - libx265：不崩但极慢，2 秒 480x270 的素材编码超过 200 秒仍不结束；
 * - mjpeg：编码第 1 帧即 memory access out of bounds（MP4/MKV/MOV/AVI 均如此）；
 * - MKV + qtrle：ffmpeg 退出码 0 且文件正常生成，但 Matroska 里缺色彩空间信息，
 *   ffprobe / 播放器一律报 "Unsupported colorspace: 0 bits/sample?"，产物不可解码。
 *   MOV + qtrle 正常，因此只在 MKV 清单里剔除它（产物自检也会兜住同类问题）；
 * - libopus：单声道正常，**双声道素材 100% 让渲染进程崩溃**（64k/128k/192k、
 *   opus/ogg 容器均复现），整页白屏且已排队的任务与产物全部丢失，
 *   属于最严重的一类问题。因此 OPUS 目标格式下线，OGG 只保留 libvorbis / flac，
 *   视频→WEBM 的音频改用 libvorbis（WebM 规范允许，且不触发该崩溃）。
 * 备注：MKV + ffv1 偶发 wasm 内存越界（同素材重试可成功），转换层已加一次自动重试。
 */
const AUDIO_ENCODERS_BY_TARGET: Record<string, string[]> = {
  MP3: ['libmp3lame'],
  AAC: ['aac'],
  M4A: ['aac', 'alac', 'ac3'],
  OGG: ['libvorbis', 'flac'],
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
  MP4: ['libx264', 'mpeg4', 'mpeg2video', 'mpeg1video'],
  WEBM: ['libvpx'],
  MKV: [
    'libx264',
    'libvpx',
    'mpeg4',
    'mpeg2video',
    'mpeg1video',
    'ffv1',
    'prores_ks',
    'huffyuv',
    'utvideo',
    'png',
  ],
  MOV: [
    'libx264',
    'prores_ks',
    'prores_aw',
    'prores',
    'mpeg4',
    'mpeg2video',
    'mpeg1video',
    'qtrle',
    'png',
  ],
  AVI: [
    'libx264',
    'mpeg4',
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
 * 路由、标题、源/目标类型、目标格式、编码器清单与质量档位都由这里驱动。
 */
export const CONVERTERS: ConverterConfig[] = [
  {
    path: '/Video-Audio',
    name: 'Video-Audio',
    title: '视频→音频',
    from: 'Video',
    to: 'Audio',
    accept: 'video/*',
    sourceExtensions: VIDEO_SOURCE_EXTENSIONS,
    targetFormats: VIDEO_AUDIO_TARGETS,
    defaultTarget: 'MP3',
    qualities: AUDIO_QUALITIES,
    defaultQuality: '192k',
    encodersByTarget: AUDIO_ENCODERS_BY_TARGET,
  },
  {
    path: '/Video-Video',
    name: 'Video-Video',
    title: '视频→视频',
    from: 'Video',
    to: 'Video',
    accept: 'video/*',
    sourceExtensions: VIDEO_SOURCE_EXTENSIONS,
    targetFormats: VIDEO_TARGETS,
    defaultTarget: 'WEBM',
    qualities: VIDEO_QUALITIES,
    defaultQuality: 'CRF 23',
    encodersByTarget: VIDEO_ENCODERS_BY_TARGET,
  },
  {
    path: '/Audio-Audio',
    name: 'Audio-Audio',
    title: '音频→音频',
    from: 'Audio',
    to: 'Audio',
    accept: 'audio/*',
    sourceExtensions: AUDIO_SOURCE_EXTENSIONS,
    targetFormats: AUDIO_TARGETS,
    defaultTarget: 'MP3',
    qualities: AUDIO_QUALITIES,
    defaultQuality: '192k',
    encodersByTarget: AUDIO_ENCODERS_BY_TARGET,
  },
]

export function getConverter(from: string, to: string): ConverterConfig | undefined {
  return CONVERTERS.find((item) => item.from === from && item.to === to)
}

export function getConverterByPath(path: string): ConverterConfig | undefined {
  return CONVERTERS.find((item) => item.path === path)
}

/**
 * 视频编码器的 CRF 下限。FFmpeg 的 libvpx（VP8）-crf 合法范围是 4-63，
 * 界面上 0-3 档给它会在初始化阶段直接报 Invalid value for crf；
 * 按编码器约束过滤选项，而不是等到参数组装时再默默夹取。
 */
const VIDEO_ENCODER_MIN_CRF: Record<string, number> = {
  libvpx: 4,
}

/**
 * 某个编码器可用的质量档位：
 * - 音频：按编码器最低码率过滤（如 wmav1/wmav2 ≥ 24k、ac3 ≥ 32k）；
 * - 视频：按编码器 CRF 下限过滤（如 libvpx ≥ 4）。
 * 过滤发生在选项生成处，用户根本选不到「选了就一定失败」的档位。
 */
export function qualitiesForEncoder(
  converter: ConverterConfig,
  encoder: string,
): string[] {
  if (converter.to === 'Audio') {
    const min = AUDIO_ENCODER_MIN_KBPS[encoder] ?? 0
    if (min <= 0) return converter.qualities
    return converter.qualities.filter(
      (quality) => Number.parseInt(quality, 10) >= min,
    )
  }
  const minCrf = VIDEO_ENCODER_MIN_CRF[encoder] ?? 0
  if (minCrf <= 0) return converter.qualities
  return converter.qualities.filter((quality) => {
    const match = /CRF\s+(\d+)/i.exec(quality)
    return match ? Number.parseInt(match[1], 10) >= minCrf : true
  })
}

/** 换编码器/格式后把码率档位夹到有效范围内（保持不低于原档位） */
export function clampQualityForEncoder(
  converter: ConverterConfig,
  encoder: string,
  quality: string,
): string {
  const options = qualitiesForEncoder(converter, encoder)
  if (options.includes(quality) || options.length === 0) return quality
  const wanted = Number.parseInt(quality, 10)
  return (
    options.find((option) => Number.parseInt(option, 10) >= wanted) ??
    options[options.length - 1]
  )
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

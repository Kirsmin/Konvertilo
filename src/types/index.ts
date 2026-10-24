export type MediaType = 'Video' | 'Audio'

export type ThemeMode = 'auto' | 'light' | 'dark'

export type JobStatus = 'idle' | 'downloading' | 'error' | 'processing'

export interface SampleTask {
  name: string
  format: string
  size: string
  bytes: number
  duration: string
  quality: string
  encoder: string
  targetFormat: string
  outputName: string
}

export interface SampleOutput {
  name: string
  format: string
  duration: string
  size: string
  quality: string
  encoder: string
}

export interface ConverterConfig {
  /** 路由路径，形如 /Video-Audio */
  path: string
  /** 转换器标识名 */
  name: string
  /** 页面标题，形如 视频->音频 */
  title: string
  from: MediaType
  to: MediaType
  /** 文件选择框 accept 属性 */
  accept: string
  /** 可接受的源文件扩展名（不含点） */
  sourceExtensions: string[]
  /** 目标格式选项，顺序即界面顺序 */
  targetFormats: string[]
  defaultTarget: string
  /** 质量选项，均为 ffmpeg 实际接受的值（音频码率 / 视频 CRF） */
  qualities: string[]
  /** 默认质量，需存在于 qualities 中 */
  defaultQuality: string
  /** 每种目标格式可用的编码器，均来自当前 ffmpeg.wasm 构建 */
  encodersByTarget: Record<string, string[]>
  sampleTasks: SampleTask[]
  sampleOutputs: SampleOutput[]
}

export interface Task {
  id: number
  path: string
  name: string
  format: string
  bytes: number
  sizeLabel: string
  duration: string
  quality: string
  encoder: string
  targetFormat: string
  outputName: string
  outputNameTouched: boolean
  file?: File
}

export interface OutputItem {
  id: number
  path: string
  name: string
  format: string
  duration: string
  sizeLabel: string
  quality: string
  encoder: string
  /** 真实转换产物；示例数据无此字段，下载时走兜底提示 */
  blob?: Blob
}

export interface HistoryEntry {
  id: number
  ts: number
  showAbs: boolean
  inName: string
  inFmt: string
  outName: string
  outFmt: string
  dur: string
  from: string
  to: string
  path: string
}

export interface CompletedTask {
  task: Task
  /** transcode 返回的真实输出 */
  blob: Blob
}

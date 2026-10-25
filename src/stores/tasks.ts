import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  clampQualityForEncoder,
  getConverterByPath,
  getEncodersForTarget,
} from '../config/converters'
import { usePathSelection } from '../composables/useSelection'
import type { Task } from '../types'
import {
  fileExtension,
  formatSize,
  replaceExtension,
  sanitizeFilename,
} from '../utils/format'
import { probeDurationSafe } from '../utils/media'

/**
 * 输入任务队列。任务按转换器路径分组，切换转换器时互不干扰。
 */

/** 把输出名对齐到目标扩展名；没有扩展名时补上 */
function withExtension(name: string, extension: string): string {
  return fileExtension(name)
    ? replaceExtension(name, extension)
    : `${name}.${extension.toLowerCase()}`
}

/** 源文件名 → 默认输出名（净化后再对齐扩展名） */
function defaultOutputName(name: string, targetFormat: string): string {
  return withExtension(sanitizeFilename(name, 'output'), targetFormat)
}

export const useTasksStore = defineStore('tasks', () => {
  const tasks = ref<Task[]>([])
  const selection = usePathSelection(tasks)
  let nextId = 1

  const forPath = (path: string) => tasks.value.filter((task) => task.path === path)

  async function addFiles(path: string, files: File[]) {
    const converter = getConverterByPath(path)
    if (!converter || files.length === 0) return

    const durations = await Promise.all(
      files.map((file) => probeDurationSafe(file, converter.from)),
    )

    files.forEach((file, index) => {
      const target = converter.defaultTarget
      const extension = fileExtension(file.name)
      const encoder = getEncodersForTarget(converter, target)[0] ?? ''
      tasks.value.push({
        id: nextId++,
        path,
        name: file.name,
        format: extension ? extension.toUpperCase() : converter.from.toUpperCase(),
        bytes: file.size,
        sizeLabel: formatSize(file.size),
        duration: durations[index],
        quality: clampQualityForEncoder(converter, encoder, converter.defaultQuality),
        encoder,
        targetFormat: target,
        outputName: defaultOutputName(file.name, target),
        file,
      })
    })
  }

  function remove(id: number) {
    tasks.value = tasks.value.filter((task) => task.id !== id)
    selection.prune()
  }

  function updateTargetFormat(id: number, targetFormat: string) {
    const task = tasks.value.find((item) => item.id === id)
    if (!task) return
    task.targetFormat = targetFormat
    // 输出名必须跟着目标格式走：否则「改成 FLAC」后仍叫 xxx.mp3，
    // ffmpeg 会按扩展名选 mp3 封装器，直接产出 0 字节文件。
    task.outputName = withExtension(task.outputName, targetFormat)
    const converter = getConverterByPath(task.path)
    if (converter) {
      const encoders = getEncodersForTarget(converter, targetFormat)
      if (!encoders.includes(task.encoder)) {
        task.encoder = encoders[0] ?? task.encoder
      }
      // 编码器变了，码率档位要落回该编码器支持的范围（如 libvorbis 最低 32k）
      task.quality = clampQualityForEncoder(converter, task.encoder, task.quality)
    }
  }

  function updateQuality(id: number, quality: string) {
    const task = tasks.value.find((item) => item.id === id)
    if (task) task.quality = quality
  }

  function updateEncoder(id: number, encoder: string) {
    const task = tasks.value.find((item) => item.id === id)
    if (!task) return
    task.encoder = encoder
    const converter = getConverterByPath(task.path)
    if (converter) {
      task.quality = clampQualityForEncoder(converter, encoder, task.quality)
    }
  }

  /**
   * 改名：空输入回落到默认名（源名 + 目标格式），否则净化后写回。
   * 组件层一律以 store 里的 outputName 为准回显，避免 DOM 与状态不一致。
   */
  function renameOutput(id: number, name: string) {
    const task = tasks.value.find((item) => item.id === id)
    if (!task) return
    const cleaned = sanitizeFilename(name.trim(), '')
    // 扩展名一律对齐到目标格式：容器由扩展名决定，
    // 否则「目标 FLAC、名字 x.mp3」会真的产出 mp3，界面却显示 FLAC。
    task.outputName = cleaned
      ? withExtension(cleaned, task.targetFormat)
      : defaultOutputName(task.name, task.targetFormat)
  }

  /** 引擎探测出真实时长后回填（浏览器解不出来的容器） */
  function setDuration(id: number, duration: string) {
    const task = tasks.value.find((item) => item.id === id)
    if (task) task.duration = duration
  }

  function clearForPath(path: string) {
    tasks.value = tasks.value.filter((task) => task.path !== path)
    selection.prune()
  }

  return {
    tasks,
    forPath,
    selectedForPath: selection.selectedForPath,
    addFiles,
    toggleSelected: selection.toggle,
    allSelected: selection.allSelected,
    selectAll: selection.selectAll,
    clearSelectionForPath: selection.clearForPath,
    remove,
    updateTargetFormat,
    updateQuality,
    updateEncoder,
    renameOutput,
    setDuration,
    clearForPath,
  }
})

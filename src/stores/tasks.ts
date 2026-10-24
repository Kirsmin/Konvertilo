import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getConverterByPath, getEncodersForTarget } from '../config/converters'
import { usePathSelection, useSeededPaths } from '../composables/useSelection'
import type { Task } from '../types'
import { fileExtension, formatSize, replaceExtension } from '../utils/format'
import { probeDurationSafe } from '../utils/media'

/**
 * 输入任务队列。任务按转换器路径分组，切换转换器时互不干扰。
 */
export const useTasksStore = defineStore('tasks', () => {
  const tasks = ref<Task[]>([])
  const selection = usePathSelection(tasks)
  const markSeeded = useSeededPaths()
  let nextId = 1

  const forPath = (path: string) => tasks.value.filter((task) => task.path === path)

  function ensureSeeded(path: string) {
    const converter = getConverterByPath(path)
    if (!converter || !markSeeded(path)) return

    for (const sample of converter.sampleTasks) {
      tasks.value.push({
        id: nextId++,
        path,
        name: sample.name,
        format: sample.format,
        bytes: sample.bytes,
        sizeLabel: sample.size,
        duration: sample.duration,
        quality: sample.quality,
        encoder: sample.encoder,
        targetFormat: sample.targetFormat,
        outputName: sample.outputName,
        outputNameTouched: false,
      })
    }
  }

  async function addFiles(path: string, files: File[]) {
    const converter = getConverterByPath(path)
    if (!converter || files.length === 0) return

    const durations = await Promise.all(
      files.map((file) => probeDurationSafe(file, converter.from)),
    )

    files.forEach((file, index) => {
      const target = converter.defaultTarget
      const extension = fileExtension(file.name)
      tasks.value.push({
        id: nextId++,
        path,
        name: file.name,
        format: extension ? extension.toUpperCase() : converter.from.toUpperCase(),
        bytes: file.size,
        sizeLabel: formatSize(file.size),
        duration: durations[index],
        quality: converter.defaultQuality,
        encoder: getEncodersForTarget(converter, target)[0] ?? '',
        targetFormat: target,
        outputName: replaceExtension(file.name, target),
        outputNameTouched: false,
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
    if (!task.outputNameTouched) {
      task.outputName = replaceExtension(task.name, targetFormat)
    }
    const converter = getConverterByPath(task.path)
    if (converter) {
      const encoders = getEncodersForTarget(converter, targetFormat)
      if (!encoders.includes(task.encoder)) {
        task.encoder = encoders[0] ?? task.encoder
      }
    }
  }

  function updateQuality(id: number, quality: string) {
    const task = tasks.value.find((item) => item.id === id)
    if (task) task.quality = quality
  }

  function updateEncoder(id: number, encoder: string) {
    const task = tasks.value.find((item) => item.id === id)
    if (task) task.encoder = encoder
  }

  function renameOutput(id: number, name: string) {
    const task = tasks.value.find((item) => item.id === id)
    const next = name.trim()
    if (!task || !next) return
    task.outputName = next
    task.outputNameTouched = true
  }

  function clearForPath(path: string) {
    tasks.value = tasks.value.filter((task) => task.path !== path)
    selection.prune()
  }

  return {
    tasks,
    forPath,
    selectedForPath: selection.selectedForPath,
    ensureSeeded,
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
    clearForPath,
  }
})

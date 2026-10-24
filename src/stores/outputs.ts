import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getConverterByPath } from '../config/converters'
import { usePathSelection, useSeededPaths } from '../composables/useSelection'
import type { CompletedTask, OutputItem } from '../types'
import { formatSize } from '../utils/format'

/**
 * 输出列表。与任务队列一样按转换器路径分组。
 */
export const useOutputsStore = defineStore('outputs', () => {
  const items = ref<OutputItem[]>([])
  const selection = usePathSelection(items)
  const markSeeded = useSeededPaths()
  let nextId = 1

  const forPath = (path: string) => items.value.filter((item) => item.path === path)

  function ensureSeeded(path: string) {
    const converter = getConverterByPath(path)
    if (!converter || !markSeeded(path)) return
    for (const sample of converter.sampleOutputs) {
      items.value.push({
        id: nextId++,
        path,
        name: sample.name,
        format: sample.format,
        duration: sample.duration,
        sizeLabel: sample.size,
        quality: sample.quality,
        encoder: sample.encoder,
      })
    }
  }

  function completeTasks(completed: CompletedTask[]) {
    for (const item of completed) {
      const task = item.task
      items.value.unshift({
        id: nextId++,
        path: task.path,
        name: task.outputName,
        format: task.targetFormat.toUpperCase(),
        duration: task.duration,
        sizeLabel: formatSize(item.blob.size),
        quality: task.quality,
        encoder: task.encoder,
        blob: item.blob,
      })
    }
  }

  function removeSelected(path: string) {
    const selected = new Set(selection.selectedIds.value)
    items.value = items.value.filter(
      (item) => !(item.path === path && selected.has(item.id)),
    )
    selection.prune()
  }

  return {
    items,
    selectedIds: selection.selectedIds,
    forPath,
    ensureSeeded,
    completeTasks,
    toggleSelected: selection.toggle,
    allSelected: selection.allSelected,
    selectAll: selection.selectAll,
    removeSelected,
  }
})

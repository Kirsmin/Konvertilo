import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CompletedTask, OutputItem } from '../types'
import { usePathSelection } from '../composables/useSelection'
import { formatSize } from '../utils/format'

/**
 * 输出列表保留的最近条目数。
 * 产物 Blob 常驻内存（大文件一条就是几十上百 MB），必须设上限并主动淘汰，
 * 否则长时间批量转换会把标签页内存吃满。
 */
const MAX_OUTPUTS = 20

/**
 * 输出列表。与任务队列一样按转换器路径分组。
 */
export const useOutputsStore = defineStore('outputs', () => {
  const items = ref<OutputItem[]>([])
  const selection = usePathSelection(items)
  let nextId = 1

  const forPath = (path: string) => items.value.filter((item) => item.path === path)

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
    // 超出上限的最旧条目直接丢弃引用，交给 GC 释放 Blob
    if (items.value.length > MAX_OUTPUTS) {
      items.value = items.value.slice(0, MAX_OUTPUTS)
    }
    selection.prune()
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
    completeTasks,
    toggleSelected: selection.toggle,
    allSelected: selection.allSelected,
    selectAll: selection.selectAll,
    removeSelected,
  }
})

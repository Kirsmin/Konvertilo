import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CompletedTask, OutputItem } from '../types'
import { usePathSelection } from '../composables/useSelection'
import { formatSize } from '../utils/format'

/**
 * 输出列表默认保留的最近条目数。
 * 产物 Blob 常驻内存（大文件一条就是几十上百 MB），必须设上限并主动淘汰，
 * 否则长时间批量转换会把标签页内存吃满。
 * 可用 configureOutputLimit() 调整（站点级配置，如部署到内存更充裕的环境）。
 */
const DEFAULT_MAX_OUTPUTS = 20

/**
 * 输出列表。与任务队列一样按转换器路径分组。
 */
export const useOutputsStore = defineStore('outputs', () => {
  const items = ref<OutputItem[]>([])
  const selection = usePathSelection(items)
  let nextId = 1
  /** 当前输出上限，可被站点配置覆盖 */
  let maxOutputs = DEFAULT_MAX_OUTPUTS
  /** 最近一次淘汰的条数（completeTasks 时刷新），供 UI 显式提示 */
  let lastEvicted = 0

  const forPath = (path: string) => items.value.filter((item) => item.path === path)

  /** 站点级配置入口：调整输出列表上限（至少 1 条） */
  function configureOutputLimit(limit: number) {
    maxOutputs = Math.max(1, Math.floor(limit) || DEFAULT_MAX_OUTPUTS)
    if (items.value.length > maxOutputs) {
      items.value = items.value.slice(0, maxOutputs)
      selection.prune()
    }
  }

  /** 淘汰提示文案：上限与数量都明说，产物消失不再是静默行为 */
  function evictionNotice(count = lastEvicted): string {
    return `输出列表最多保留 ${maxOutputs} 条，最早的 ${count} 条已自动移除（产物只存在浏览器内存中，请需要时及时下载）。`
  }

  /** 完成一批任务；返回本次因超出上限被淘汰的条数 */
  function completeTasks(completed: CompletedTask[]): number {
    lastEvicted = 0
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
    if (items.value.length > maxOutputs) {
      lastEvicted = items.value.length - maxOutputs
      items.value = items.value.slice(0, maxOutputs)
    }
    selection.prune()
    return lastEvicted
  }

  function removeSelected(path: string) {
    const selected = new Set(selection.selectedIds.value)
    items.value = items.value.filter(
      (item) => !(item.path === path && selected.has(item.id)),
    )
    selection.prune()
  }

  /** 下载全部：按列表顺序逐个触发浏览器下载 */
  function downloadAll(path: string) {
    const targets = forPath(path)
    targets.forEach((item, index) => {
      setTimeout(() => {
        const url = URL.createObjectURL(item.blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = item.name
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }, index * 350)
    })
    return targets.length
  }

  return {
    items,
    selectedIds: selection.selectedIds,
    forPath,
    completeTasks,
    configureOutputLimit,
    evictionNotice,
    toggleSelected: selection.toggle,
    allSelected: selection.allSelected,
    selectAll: selection.selectAll,
    removeSelected,
    downloadAll,
  }
})

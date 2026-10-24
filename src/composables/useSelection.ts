import { ref, type Ref } from 'vue'

/**
 * 按转换器路径分组的多选逻辑，任务/输出列表共用。
 * 选中 id 与条目存于不同数组，条目增删后需调用 prune() 清理失效 id。
 */
export function usePathSelection<T extends { id: number; path: string }>(items: Ref<T[]>) {
  const selectedIds = ref<number[]>([])

  const isSelected = (id: number) => selectedIds.value.includes(id)

  const selectedForPath = (path: string) =>
    selectedIds.value.filter((id) => items.value.some((it) => it.id === id && it.path === path))

  const allSelected = (path: string) => {
    const list = items.value.filter((it) => it.path === path)
    return list.length > 0 && list.every((it) => isSelected(it.id))
  }

  function toggle(id: number) {
    if (!items.value.some((it) => it.id === id)) return
    selectedIds.value = isSelected(id)
      ? selectedIds.value.filter((x) => x !== id)
      : [...selectedIds.value, id]
  }

  function selectAll(path: string) {
    const ids = items.value.filter((it) => it.path === path).map((it) => it.id)
    if (!ids.length) return
    selectedIds.value = allSelected(path)
      ? selectedIds.value.filter((id) => !ids.includes(id))
      : [...new Set([...selectedIds.value, ...ids])]
  }

  function clearForPath(path: string) {
    const ids = new Set(items.value.filter((it) => it.path === path).map((it) => it.id))
    selectedIds.value = selectedIds.value.filter((id) => !ids.has(id))
  }

  function prune() {
    const alive = new Set(items.value.map((it) => it.id))
    selectedIds.value = selectedIds.value.filter((id) => alive.has(id))
  }

  return { selectedIds, isSelected, selectedForPath, allSelected, toggle, selectAll, clearForPath, prune }
}

/** 每个转换器路径只播种一次的登记簿（当前示例数据为空） */
export function useSeededPaths() {
  const seededPaths = ref<string[]>([])

  return function markSeeded(path: string): boolean {
    if (seededPaths.value.includes(path)) return false
    seededPaths.value.push(path)
    return true
  }
}

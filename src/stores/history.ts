import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { CompletedTask, HistoryEntry } from '../types'
import { formatSize } from '../utils/format'

const STORAGE_KEY = 'konvertilo.history.v1'

function normalizeEntry(value: unknown): HistoryEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  if (
    typeof entry.id !== 'number' ||
    typeof entry.ts !== 'number' ||
    typeof entry.inName !== 'string' ||
    typeof entry.inFmt !== 'string' ||
    typeof entry.outName !== 'string' ||
    typeof entry.outFmt !== 'string' ||
    typeof entry.dur !== 'string' ||
    typeof entry.from !== 'string' ||
    typeof entry.to !== 'string'
  ) {
    return null
  }
  return {
    id: entry.id,
    ts: entry.ts,
    showAbs: Boolean(entry.showAbs),
    inName: entry.inName,
    inFmt: entry.inFmt,
    outName: entry.outName,
    outFmt: entry.outFmt,
    dur: entry.dur,
    from: entry.from,
    to: entry.to,
    path: typeof entry.path === 'string' ? entry.path : '/Video-Audio',
  }
}

function loadEntries(): HistoryEntry[] {
  try {
    if (typeof window === 'undefined') return []
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => normalizeEntry(item))
      .filter((item): item is HistoryEntry => item !== null)
  } catch {
    return []
  }
}

function persistEntries(entries: HistoryEntry[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // localStorage 不可用 / 超出配额时静默忽略
  }
}

function maxId(entries: HistoryEntry[]): number {
  return entries.reduce((max, entry) => Math.max(max, entry.id), 0)
}

/**
 * 转换历史。localStorage 持久化，删除、相对时间切换也会同步保存。
 */
export const useHistoryStore = defineStore('history', () => {
  const entries = ref<HistoryEntry[]>(loadEntries())
  let nextId = maxId(entries.value) + 1

  watch(
    entries,
    (value) => {
      persistEntries(value)
    },
    { deep: true, immediate: true },
  )

  function addCompleted(completed: CompletedTask[]) {
    for (const item of completed) {
      const task = item.task
      entries.value.unshift({
        id: nextId++,
        ts: Date.now(),
        showAbs: false,
        inName: task.name,
        inFmt: task.format,
        outName: task.outputName,
        outFmt: task.targetFormat.toUpperCase(),
        dur: task.duration,
        from: task.sizeLabel,
        to: formatSize(item.blob.size),
        path: task.path,
      })
    }
  }

  function toggleShowAbs(id: number) {
    const entry = entries.value.find((item) => item.id === id)
    if (entry) entry.showAbs = !entry.showAbs
  }

  function remove(id: number) {
    entries.value = entries.value.filter((entry) => entry.id !== id)
  }

  return {
    entries,
    addCompleted,
    toggleShowAbs,
    remove,
  }
})

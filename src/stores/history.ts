import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { CompletedTask, HistoryEntry } from '../types'
import { formatSize } from '../utils/format'

const STORAGE_KEY = 'konvertilo.history.v1'
/** 历史条目上限：只存元数据，但无上限时 localStorage 迟早超配额 */
const MAX_HISTORY = 50
/** 超配额时保守保留的条数，保证还能写进去 */
const MIN_HISTORY = 10

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
      .slice(0, MAX_HISTORY)
  } catch {
    return []
  }
}

/** 写不进去（配额/隐私模式）时返回 false，由调用方决定降级策略 */
function persistEntries(entries: HistoryEntry[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
    return true
  } catch {
    return false
  }
}

function maxId(entries: HistoryEntry[]): number {
  return entries.reduce((max, entry) => Math.max(max, entry.id), 0)
}

/**
 * 转换历史。localStorage 持久化，删除、相对时间切换也会同步保存。
 * 写满配额时先砍半再试一次，仍然失败就把状态暴露给 UI，而不是静默丢数据。
 */
export const useHistoryStore = defineStore('history', () => {
  const entries = ref<HistoryEntry[]>(loadEntries())
  /** 浏览器存储不可写（配额已满 / 隐私模式），历史只能在本次会话内保留 */
  const storageBlocked = ref(false)
  let nextId = maxId(entries.value) + 1

  watch(
    entries,
    (value) => {
      if (persistEntries(value)) {
        storageBlocked.value = false
        return
      }
      const trimmed = value.slice(0, Math.max(MIN_HISTORY, Math.floor(value.length / 2)))
      if (trimmed.length < value.length && persistEntries(trimmed)) {
        storageBlocked.value = false
        entries.value = trimmed
        return
      }
      storageBlocked.value = true
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
    if (entries.value.length > MAX_HISTORY) {
      entries.value = entries.value.slice(0, MAX_HISTORY)
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
    storageBlocked,
    addCompleted,
    toggleShowAbs,
    remove,
  }
})

import { onBeforeUnmount, watch, type Ref } from 'vue'
import type { CompletedTask, ConverterConfig, Task } from '../types'
import { useTasksStore } from '../stores/tasks'
import { useOutputsStore } from '../stores/outputs'
import { useHistoryStore } from '../stores/history'
import { useUiStore } from '../stores/ui'
import { useFFmpeg } from './useFFmpeg'
import { buildFFmpegArgs, mimeTypeForFormat } from '../utils/ffmpegArgs'
import { clampProgress } from '../utils/format'

function describeError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function isAbort(reason: unknown): boolean {
  return (
    (reason instanceof DOMException && reason.name === 'AbortError') ||
    (reason instanceof Error && reason.name === 'AbortError')
  )
}

/**
 * 串行真实转换：逐任务调用 ffmpeg.wasm transcode。
 * 单任务失败记录错误并继续；成功的任务立即出队并写入输出与历史；
 * 路由切换 / 组件卸载时中止当前转码。
 */
export function useConversion(converter: Ref<ConverterConfig>) {
  const tasksStore = useTasksStore()
  const outputsStore = useOutputsStore()
  const historyStore = useHistoryStore()
  const ui = useUiStore()
  const { ensureLoaded, transcode, state: engineState, error: engineError } = useFFmpeg()

  let runToken = 0
  let abortController: AbortController | null = null

  function stop() {
    runToken += 1
    abortController?.abort()
    abortController = null
    if (ui.status === 'processing') {
      ui.status = 'idle'
    }
  }

  async function runTasks(tasks: Task[], token: number) {
    const failed: string[] = []

    for (const task of tasks) {
      if (!task.file) continue

      ui.progress = 0
      try {
        const blob = await transcode({
          file: task.file,
          outputName: task.outputName,
          args: buildFFmpegArgs(converter.value, task),
          mimeType: mimeTypeForFormat(task.targetFormat),
          signal: abortController?.signal,
          onProgress: (ratio) => {
            ui.progress = clampProgress(ratio * 100)
          },
        })

        if (token !== runToken) return
        const completed: CompletedTask = { task, blob }
        outputsStore.completeTasks([completed])
        historyStore.addCompleted([completed])
        tasksStore.remove(task.id)
        ui.done += 1
      } catch (reason) {
        if (isAbort(reason) || token !== runToken) return
        failed.push(`${task.name}：${describeError(reason)}`)
      }
    }

    if (failed.length) {
      ui.errorText = failed.join('\n')
    }
    ui.status = 'idle'
  }

  async function startConvert() {
    const tasks = tasksStore.forPath(converter.value.path)
    if (tasks.length === 0) return
    if (ui.status === 'processing' || ui.status === 'downloading') return

    const token = ++runToken
    ui.errorText = ''
    ui.status = 'processing'
    ui.done = 0
    ui.total = tasks.length
    ui.progress = 0

    // 引擎未就绪时先静默加载（保持处理中状态行）
    await ensureLoaded()
    if (token !== runToken) return

    // 引擎加载失败：任务保留，进入错误态以沿用「复制错误信息」
    if (engineState.value !== 'ready') {
      ui.errorText = engineError.value || 'ffmpeg.wasm 引擎加载失败'
      ui.status = 'error'
      return
    }

    abortController = new AbortController()
    await runTasks(tasks, token)
    abortController = null
  }

  // 路由切换（转换器变化）时中止当前转码
  watch(
    () => converter.value.path,
    () => stop(),
  )

  onBeforeUnmount(stop)

  return { startConvert, stop }
}

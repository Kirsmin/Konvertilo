import { onBeforeUnmount, watch, type Ref } from 'vue'
import type { CompletedTask, ConverterConfig, Task } from '../types'
import { useTasksStore } from '../stores/tasks'
import { useOutputsStore } from '../stores/outputs'
import { useHistoryStore } from '../stores/history'
import { useUiStore } from '../stores/ui'
import { EngineCrashedError, useFFmpeg } from './useFFmpeg'
import { buildFFmpegArgs, mimeTypeForFormat } from '../utils/ffmpegArgs'
import { clampProgress } from '../utils/format'

/** wasm trap 后自动重试的次数：ffv1 / 无损编码器偶发内存越界，重试一次通常就过 */
const CRASH_RETRY_LIMIT = 1

function describeError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function firstLine(message: string): string {
  return message.split('\n')[0].trim()
}

function isAbort(reason: unknown): boolean {
  return (
    (reason instanceof DOMException && reason.name === 'AbortError') ||
    (reason instanceof Error && reason.name === 'AbortError')
  )
}

interface StopOptions {
  /** 用户主动点「停止」时给一条可见反馈；路由切换等场景保持安静 */
  notify?: boolean
}

type TaskOutcome =
  | { status: 'done' }
  | { status: 'failed'; message: string }
  | { status: 'engine-down'; message: string }
  | { status: 'abort' }

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
  const {
    ensureLoaded,
    resetEngine,
    transcode,
    state: engineState,
    error: engineError,
    threads: engineThreads,
  } = useFFmpeg()

  let runToken = 0
  let abortController: AbortController | null = null

  /**
   * 中止当前批次。仅 abort 只会 reject 掉客户端 Promise，
   * 后台 worker 仍会把当前文件编码完，所以必须同时销毁实例。
   */
  function stop(options: StopOptions = {}) {
    const running = abortController !== null
    runToken += 1
    abortController?.abort()
    abortController = null
    if (running) resetEngine()
    ui.progress = 0
    ui.startedAt = 0
    if (ui.status === 'processing') {
      ui.status = 'idle'
    }
    if (options.notify) {
      const pending = tasksStore.forPath(converter.value.path).length
      ui.errorText = ''
      ui.warnText = pending
        ? `已停止。队列中还有 ${pending} 个任务未转换，再次点「开始转换」即可继续（引擎核心已缓存，重新准备通常只需几秒）。`
        : '已停止，队列中没有待转换的任务。'
    }
  }

  async function runOne(task: Task, token: number): Promise<TaskOutcome> {
    for (let attempt = 0; ; attempt += 1) {
      ui.progress = 0
      task.error = undefined
      try {
        const blob = await transcode({
          file: task.file as File,
          outputName: task.outputName,
          args: buildFFmpegArgs(converter.value, task, {
            threads: engineThreads.value,
          }),
          mimeType: mimeTypeForFormat(task.targetFormat),
          signal: abortController?.signal,
          onProgress: (ratio) => {
            ui.progress = clampProgress(ratio * 100)
          },
        })

        if (token !== runToken) return { status: 'abort' }
        const completed: CompletedTask = { task, blob }
        outputsStore.completeTasks([completed])
        historyStore.addCompleted([completed])
        tasksStore.remove(task.id)
        ui.done += 1
        return { status: 'done' }
      } catch (reason) {
        if (isAbort(reason) || token !== runToken) return { status: 'abort' }

        // 引擎被 wasm trap 打崩后已重置：重建实例并重试一次，
        // 无损编码器（如 MKV + ffv1）在 32 位地址空间里偶发越界，重试通常成功。
        if (reason instanceof EngineCrashedError && attempt < CRASH_RETRY_LIMIT) {
          await ensureLoaded()
          if (token !== runToken) return { status: 'abort' }
          if (engineState.value === 'ready') continue
        }

        const message = describeError(reason)
        task.error = firstLine(message)
        return engineState.value === 'ready'
          ? { status: 'failed', message }
          : { status: 'engine-down', message }
      }
    }
  }

  async function runTasks(tasks: Task[], token: number) {
    const failed: string[] = []

    for (const task of tasks) {
      if (!task.file) continue

      const outcome = await runOne(task, token)
      if (outcome.status === 'abort') return
      if (outcome.status === 'done') continue

      failed.push(`${task.name}: ${outcome.message}`)
      ui.failed = failed.length
      // 引擎已重置且重建失败：后面的任务不可能成功，直接给出明确提示
      if (outcome.status === 'engine-down') {
        failed.push('引擎已重置，剩余任务未执行，请重新点击开始转换。')
        break
      }
    }

    ui.startedAt = 0
    // 失败必须进入 error 态：status 回到 idle 时错误文本没有地方可显示
    if (failed.length) {
      ui.errorText = failed.join('\n')
      ui.warnText = ''
      ui.status = 'error'
      return
    }
    ui.status = 'idle'
  }

  /** ids 为空时转换整个队列；传入 id 时只重试指定任务 */
  async function startConvert(ids?: number[]) {
    const queued = tasksStore.forPath(converter.value.path)
    const tasks = ids ? queued.filter((task) => ids.includes(task.id)) : queued
    if (tasks.length === 0) return
    if (ui.status === 'processing' || ui.status === 'downloading') return

    const token = ++runToken
    ui.errorText = ''
    ui.warnText = ''
    ui.status = 'processing'
    ui.done = 0
    ui.failed = 0
    ui.total = tasks.length
    ui.progress = 0
    ui.startedAt = Date.now()

    // 引擎未就绪时先静默加载（保持处理中状态行）
    await ensureLoaded()
    if (token !== runToken) return

    // 引擎加载失败：任务保留，进入错误态以沿用「复制错误信息」
    if (engineState.value !== 'ready') {
      ui.errorText = engineError.value || 'ffmpeg.wasm 引擎加载失败'
      ui.warnText = ''
      ui.status = 'error'
      ui.startedAt = 0
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

  onBeforeUnmount(() => stop())

  return { startConvert, stop }
}

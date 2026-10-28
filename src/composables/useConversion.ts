import { onBeforeUnmount, watch, type Ref } from 'vue'
import type { CompletedTask, ConverterConfig, Task } from '../types'
import { useTasksStore } from '../stores/tasks'
import { useOutputsStore } from '../stores/outputs'
import { useHistoryStore } from '../stores/history'
import { useUiStore } from '../stores/ui'
import { EngineCrashedError, shouldRecycleEngine, useFFmpeg } from './useFFmpeg'
import { buildFFmpegArgs, mimeTypeForFormat } from '../utils/ffmpegArgs'
import { clampProgress } from '../utils/format'

/** wasm trap 后自动重试的次数：ffv1 / 无损编码器偶发内存越界，重试一次通常就过 */
const CRASH_RETRY_LIMIT = 1

/**
 * 动态 import / 内部资源加载失败时的典型报错模式。
 * 这些报错会把 https://…/assets/xxx.js 这类内部路径暴露给用户，
 * 统一翻译成一句人话；离线场景给出明确指引而不是一串 URL。
 */
const MODULE_LOAD_FAILURE =
  /failed to fetch dynamically imported module|error loading (?:dynamically )?imported module|importing a module script failed|failed to load module|dynamically imported module/i

/** 剥离报错里的内部路径与 URL（/assets/…、/Konvertilo/…、http(s)://…），只留可读信息 */
function sanitizeMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s)'"]+/gi, '')
    .replace(/(?:[\w.-]+\/)+[\w.-]*assets\/[\w.-]+/gi, '内部资源')
    .replace(/[(\[][^\n)]*(?:assets|Konvertilo)[^\n)]*[)\]]/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/（\s*）|\(\s*\)|：\s*$|: $/g, '')
    .trim()
}

function describeError(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : String(reason)
  if (MODULE_LOAD_FAILURE.test(raw)) {
    return navigator.onLine
      ? '首次转换需要的组件加载失败。请刷新页面重试；如果反复出现，请清除缓存后再试。'
      : '当前处于离线状态，首次转换需要的组件未能提前缓存。请联网后刷新页面，再开始转换。'
  }
  return sanitizeMessage(raw)
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

interface BatchContext {
  token: number
  /** 本批可执行任务总数：进度按 (已完成 + 当前文件进度) / 总数 累加，绝不每文件归零 */
  size: number
  /** 本批已完成的任务数 */
  completed: number
}

/**
 * 串行真实转换：逐任务调用 ffmpeg.wasm transcode。
 * 单任务失败记录错误并继续；成功的任务立即出队并写入输出与历史；
 * 路由切换 / 组件卸载时中止当前转码；
 * 同一实例连续转码过多时在任务间隙回收重建，避免 wasm 内存碎片化拖垮页面。
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

  /** 实例该回收时销毁重建（核心 blob 常驻，重建只重新实例化）。路由切换场景用。 */
  async function recycleEngineIfNeeded(): Promise<void> {
    if (!shouldRecycleEngine()) return
    resetEngine()
    await ensureLoaded()
  }

  async function runOne(
    task: Task,
    batch: BatchContext,
  ): Promise<TaskOutcome> {
    const token = batch.token
    for (let attempt = 0; ; attempt += 1) {
      task.error = undefined
      // 进度基线 = 已完成条数占比，当前文件的 ratio 只占 1/N 的权重
      const base = (batch.completed / batch.size) * 100
      ui.progress = clampProgress(base)
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
            ui.progress = clampProgress(base + (ratio * 100) / batch.size)
          },
        })

        if (token !== runToken) return { status: 'abort' }
        const completed: CompletedTask = { task, blob }
        const evicted = outputsStore.completeTasks([completed])
        historyStore.addCompleted([completed])
        tasksStore.remove(task.id)
        ui.done += 1
        batch.completed += 1
        ui.progress = clampProgress((batch.completed / batch.size) * 100)
        // 产物被上限淘汰时明确提示，而不是悄悄消失
        if (evicted > 0) {
          ui.warnText = outputsStore.evictionNotice(evicted)
        }
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
    // 没有文件的条目不参与转换，也不应拉低整体进度分母
    const runnable = tasks.filter((task) => task.file)
    const batch: BatchContext = { token, size: Math.max(1, runnable.length), completed: 0 }

    for (const task of runnable) {
      const outcome = await runOne(task, batch)
      if (outcome.status === 'abort') return
      if (outcome.status === 'done') {
        // 任务间隙检查实例寿命：同一实例连续转码过多就销毁重建，
        // 释放 wasm 线性内存，防止碎片化累积最终拖垮渲染进程
        if (shouldRecycleEngine()) {
          resetEngine()
          await ensureLoaded()
          if (token !== runToken) return
          if (engineState.value !== 'ready') {
            failed.push('引擎已重置，剩余任务未执行，请重新点击开始转换。')
            ui.failed = failed.length
            break
          }
        }
        continue
      }

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
    // 串行执行：同一时刻只允许一个批次（引擎单例，MEMFS 也不支持并发）
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

    try {
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
      try {
        await runTasks(tasks, token)
      } finally {
        abortController = null
      }
    } catch (reason) {
      // 任何未预期的异常都收敛为错误面板提示，绝不让整页崩溃白屏
      if (token !== runToken) return
      abortController = null
      ui.errorText = describeError(reason) || '转换过程出现未知错误'
      ui.warnText = ''
      ui.status = 'error'
      ui.startedAt = 0
    }
  }

  /**
   * 路由切换（转换器变化）时中止当前转码；
   * 同时检查实例寿命：上一转换器如果高强度用过引擎，先销毁释放内存，
   * 避免带着碎片化的 wasm 实例进入下一个转换器（实测会在此刻整页崩溃）。
   */
  watch(
    () => converter.value.path,
    () => {
      stop()
      void recycleEngineIfNeeded()
    },
  )

  onBeforeUnmount(() => stop())

  return { startConvert, stop }
}

const MB = 1024 * 1024
const GB = 1024 * MB

/** 超过推荐尺寸时的统一提示文案 */
export const OVERSIZE_HINT = '文件尺寸过大，当前设备可能无法处理，或者处理所需时间过长'

/**
 * 估算这台设备能安全处理的单个文件大小。
 *
 * wasm32 的地址空间最多 4GB，MEMFS 里要同时容纳输入与输出；
 * JS 侧 fetchFile 还会把输入再读一份，实际占用约为文件大小的 3 倍，
 * 所以按设备内存（或可用 JS 堆）的一小部分取值，再夹在 64MB ~ 1GB 之间。
 */
export function recommendedFileSize(): number {
  const nav = navigator as Navigator & { deviceMemory?: number }
  const heap = (performance as Performance & {
    memory?: { jsHeapSizeLimit: number }
  }).memory?.jsHeapSizeLimit

  const memory = nav.deviceMemory ?? 4
  const cores = navigator.hardwareConcurrency ?? 4

  const byMemory = memory * GB * 0.06
  const byHeap = heap ? heap * 0.12 : Number.POSITIVE_INFINITY
  // 核心数偏少的设备（多为低端机）再收紧一档
  const factor = cores <= 4 ? 0.8 : 1

  const estimate = Math.min(byMemory, byHeap) * factor
  return Math.round(Math.min(1 * GB, Math.max(64 * MB, estimate)))
}

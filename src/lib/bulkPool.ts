// Author: loop-R140
// Bounded-concurrency task pool shared by bulk chapter generation (方案侧/标书侧).
// Framework-agnostic and pure so scheduling semantics (dispatch-once, concurrency
// cap, cancel gate, per-task error isolation, monotonic progress) are unit-testable
// in isolation from React hooks.
export interface BulkPoolOptions {
  /** 任务总数，索引为 [0, total) */
  total: number
  /** 并发上限，实际取 min(concurrency, total)，至少 1 */
  concurrency: number
  /** 派发每个任务前检查；返回 true 则停止派发新任务（在途任务自然结束，不被中断） */
  isCancelled?: () => boolean
  /** 每个任务派发时回调一次；processed 为已派发任务数（含被 worker 内部跳过的），单调递增，用于驱动进度 */
  onTaskStart?: (idx: number, processed: number) => void
  /** 单个任务体；内部异常由池吞掉并转交 onTaskError，不影响其余任务 */
  runTask: (idx: number) => Promise<void>
  /** 任务体抛出且未被内部捕获时的兜底回调 */
  onTaskError?: (idx: number, err: unknown) => void
}

/**
 * 有限并发工作池：把 [0, total) 的索引任务分发给最多 min(concurrency, total) 个 worker。
 * 保证：每个 idx 恰好派发一次（除非取消导致未派发）；并发在途数严格不超过上限；
 * 单任务异常隔离；取消只拦截“尚未派发”的任务。total<=0 时不派发、直接返回 0。
 */
export async function runBulkPool(o: BulkPoolOptions): Promise<number> {
  const n = Number.isFinite(o.total) && o.total > 0 ? Math.floor(o.total) : 0
  if (n === 0) return 0
  const rawWidth = Number.isFinite(o.concurrency) ? Math.floor(o.concurrency) : 1
  const width = Math.max(1, Math.min(rawWidth || 1, n))
  let cursor = 0
  let processed = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      if (o.isCancelled?.()) return
      const idx = cursor++
      if (idx >= n) return
      processed += 1
      o.onTaskStart?.(idx, processed)
      try {
        await o.runTask(idx)
      } catch (err) {
        o.onTaskError?.(idx, err)
      }
    }
  }
  await Promise.all(Array.from({ length: width }, () => worker()))
  return processed
}

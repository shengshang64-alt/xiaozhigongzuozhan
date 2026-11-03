// ---------------------------------------------------------------------------
// R135 PPT 逐页生成韧性的纯函数核心（零副作用，可直接单测）：
// 分批生成失败隔离——单批调用抛错或返回空数组时自动重试 1 次，仍失败则该批标记
// 失败交调用方兜底（按大纲原位留标题占位），杜绝一批坏请求拖垮整单已付费生成。
// 口径与标书侧智能编排「单批失败重试 1 次后跳过（不让一批拖垮全局）」一致。
// ---------------------------------------------------------------------------

/** 单批默认尝试上限：首试 + 重试 1 次 = 2 */
const DEFAULT_MAX_ATTEMPTS = 2

export type GenerationRetryOptions<T> = {
  /** 尝试总次数上限（含首试），默认 2；小于 1 按 1 处理 */
  maxAttempts?: number
  /** 空结果判定：命中则本试作废并重试；末试仍空抛 emptyMessage */
  isEmptyResult?: (result: T) => boolean
  /** 全部尝试均为空结果时的提示文案（用户可见，不暴露内部字段） */
  emptyMessage?: string
}

/**
 * 单次生成调用的重试核心：全部尝试都抛错时重抛最后一个错误（保留网关/解析
 * 侧已本地化的中文文案）；末试「成功但为空」则抛 emptyMessage。
 */
export async function withGenerationRetry<T>(
  generate: (attempt: number) => Promise<T>,
  opts: GenerationRetryOptions<T> = {},
): Promise<T> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const isEmpty = opts.isEmptyResult ?? (() => false)
  let lastError: unknown = null
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await generate(attempt)
      if (!isEmpty(result)) return result
      lastError = null
    } catch (e) {
      lastError = e
    }
  }
  if (lastError !== null) throw lastError
  throw new Error(opts.emptyMessage ?? "生成未产出可用结果，请稍后重试")
}

export type BatchesRetryOptions<Batch, Item> = {
  /** 已切好的批次序列（串行执行，保持原批次顺序） */
  batches: Batch[][]
  /** 单批生成（抛错或返回空数组都算本试失败）；attempt 从 0 起 */
  generate: (batch: Batch[], attempt: number) => Promise<Item[]>
  /** 单批尝试上限（含首试），默认 2 */
  maxAttempts?: number
  /** 每批开始（含重试试次）回调，供调用方刷新进度文案 */
  onBatchStart?: (batchIndex: number, batchCount: number, attempt: number) => void
}

/**
 * 逐批串行执行 + 批内失败重试。返回长度 = 批次数，下标对齐原批次序：
 * null 表示该批重试后仍失败（由调用方决定占位/跳过等兜底形态），
 * 其余批次照常返回，不中途中断。
 */
export async function runBatchesWithRetry<Batch, Item>(
  opts: BatchesRetryOptions<Batch, Item>,
): Promise<(Item[] | null)[]> {
  const { batches, generate, onBatchStart } = opts
  const maxAttempts = Math.max(1, opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const results: (Item[] | null)[] = []
  for (let i = 0; i < batches.length; i += 1) {
    let got: Item[] | null = null
    for (let attempt = 0; attempt < maxAttempts && got === null; attempt += 1) {
      onBatchStart?.(i, batches.length, attempt)
      try {
        const items = await generate(batches[i], attempt)
        if (items.length) got = items
      } catch {
        got = null
      }
    }
    results.push(got)
  }
  return results
}

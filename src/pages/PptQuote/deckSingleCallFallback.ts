// ---------------------------------------------------------------------------
// 单发路径页数不足时的回退决策（2026-11-04）
//
// 实测问题：单发路径（≤10 页一次调用）要求 10 页，模型只返回 5 页——
//   上一轮加了「少于一半就重试」的判据，但 5 页恰好等于 ceil(10/2)=5，
//   `5 < 5` 为 false，**没有触发重试**，直接补了 5 页空占位。
//   用户拿到的册子一半是「待补充章节 N」，等于半成品。
//
// 结论：仅靠「补空占位」不够。占位页只该是最后兜底，正确顺序是：
//   ① 单发不足 → ② 回退到逐页生成（不稳但每页独立、可靠）→ ③ 仍失败才补占位。
//
// 本模块只做纯决策，便于单测；实际调用由 usePptQuote 执行。
// ---------------------------------------------------------------------------

/** 单发结果与目标的比对结论 */
export type SingleCallVerdict =
  /** 达到目标（≥ 目标页数），可直接采用 */
  | { action: "accept"; got: number }
  /** 差得不多（≥ 容差下限），可接受并补齐少量占位 */
  | { action: "pad"; got: number; missing: number }
  /** 差得太多，应该回退逐页生成重做 */
  | { action: "fallback"; got: number; missing: number }

/**
 * 判定单发结果该「直接采用 / 补少量占位 / 回退逐页生成」。
 *
 * @param got       模型实际返回的页数
 * @param target    目标页数
 * @param opts.toleranceRatio 允许「差多少比例」还用占位补齐（默认 0.2，即最多缺 20%）
 *
 * 阈值取舍：
 *   · 缺 1 页（10%）：补 1 页占位可接受，回退重做太浪费（整册重新生成要花钱）。
 *   · 缺一半（50%）：明显是模型偷懒/被截断，补 5 页占位等于半成品，必须回退。
 *   · 20% 是两者之间的折中：10 页容差 2 页（补 2 页占位可接受），
 *     6 页目标容差 1 页。
 */
export function decideSingleCallOutcome(
  got: number,
  target: number,
  opts?: { toleranceRatio?: number },
): SingleCallVerdict {
  const g = Math.max(0, Math.floor(Number(got) || 0))
  const t = Math.max(1, Math.floor(Number(target) || 1))
  if (g >= t) return { action: "accept", got: g }
  const missing = t - g
  const ratio = Math.max(0, Math.min(0.5, opts?.toleranceRatio ?? 0.2))
  // 容差页数至少给 1 页（否则 1 页的册子缺 1 页永远要回退，不现实）
  const tolerated = Math.max(1, Math.floor(t * ratio))
  if (missing <= tolerated) return { action: "pad", got: g, missing }
  return { action: "fallback", got: g, missing }
}

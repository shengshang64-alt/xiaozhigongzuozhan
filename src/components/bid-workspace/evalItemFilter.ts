// R134 模拟评标打分行筛选谓词（纯函数，可 node 单测）
// 原「低得分率」判定在汇总卡计数与表格行内联重复两处，收敛为单一真源；
// 新增「AI-人工分差」谓词与按原始下标筛选 helper，让汇总卡可点击把表格筛到弱项。

/** 打分项（谓词所需最小结构，兼容 AiReview / ManualReview 的真实类型） */
export interface EvalScoringItem {
  max_score: number
  ai_score: number
}

/** 人工打分项最小结构 */
export interface EvalManualItem {
  manual_score: number
}

/** 筛选模式：none=全部，low=低得分率项，gap=AI-人工分差≥阈值项 */
export type EvalRowFilter = "none" | "low" | "gap"

/** 低得分率判定：最高分 >0 且 AI 得分率 < 60%（max_score=0 避免除零，不计入低分） */
export function isLowScoreBidItem(item: EvalScoringItem): boolean {
  return item.max_score > 0 && item.ai_score / item.max_score < 0.6
}

/** 分差过大判定：人工已打分 (>0) 且 |AI 得分 - 人工得分| >= 阈值（默认 2 分） */
export function isGapBidItem(
  item: EvalScoringItem,
  manualItem: EvalManualItem | undefined,
  threshold = 2,
): boolean {
  if (!manualItem || manualItem.manual_score <= 0) return false
  return Math.abs(item.ai_score - manualItem.manual_score) >= threshold
}

/**
 * 按筛选模式返回命中的原始下标列表。下标与 aiReview.items / manualReview.items 对齐，
 * 绝不重排——表格内人工打分回调仍以原始 idx 定位，筛选后不会串行。
 */
export function filterEvalRowIndexes(
  items: EvalScoringItem[],
  manualItems: EvalManualItem[] | undefined,
  filter: EvalRowFilter,
): number[] {
  const out: number[] = []
  items.forEach((item, i) => {
    if (filter === "none") {
      out.push(i)
    } else if (filter === "low") {
      if (isLowScoreBidItem(item)) out.push(i)
    } else if (filter === "gap") {
      if (isGapBidItem(item, manualItems?.[i])) out.push(i)
    }
  })
  return out
}

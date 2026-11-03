import { calcTotal, sumLinesYuan, type ChecklistLine } from "./checklistTypes"

// ---------------------------------------------------------------------------
// 建设清单预算结构汇总：按分类小计 + 全局条目/外购计数（纯函数，无 JSX）
// 供 ChecklistDetailPanel 渲染分类小计行与底部汇总，金额口径复用 calcTotal 单一真源
// ---------------------------------------------------------------------------

export type CategorySummary = {
  category: string
  count: number
  subtotal: number
  externalCount: number
}

export type ChecklistTotals = {
  lineCount: number
  categoryCount: number
  externalCount: number
  total: number
}

/** 一组行的小计（元）：逐行精确到分后累加，口径与 calcTotal 单一真源（B9） */
export function subtotalOfLines(lines: ChecklistLine[]): number {
  return sumLinesYuan(lines)
}

/** 按 category 分组汇总勾选行，保留首次出现顺序；未勾选行剔除，空分类归「未分类」 */
export function summarizeChecklistCategories(lines: ChecklistLine[]): CategorySummary[] {
  const groups = new Map<string, ChecklistLine[]>()
  for (const l of lines ?? []) {
    if (l.checked === false) continue
    const key = l.category || "未分类"
    const arr = groups.get(key)
    if (arr) arr.push(l)
    else groups.set(key, [l])
  }
  // 小计按整数分一次算清，保证「各分类小计之和 === 合计」严格成立（B9）
  return Array.from(groups.entries()).map(([category, group]) => ({
    category,
    count: group.length,
    subtotal: sumLinesYuan(group),
    externalCount: group.filter((l) => l.source === "external").length,
  }))
}

/** 全局汇总：条目数/分类数/外购数/合计（total 复用 calcTotal，避免口径分叉） */
export function buildChecklistTotals(lines: ChecklistLine[]): ChecklistTotals {
  const cats = summarizeChecklistCategories(lines)
  return {
    lineCount: cats.reduce((s, c) => s + c.count, 0),
    categoryCount: cats.length,
    externalCount: cats.reduce((s, c) => s + c.externalCount, 0),
    total: calcTotal(lines),
  }
}

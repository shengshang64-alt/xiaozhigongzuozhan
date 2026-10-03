import { calcTotal, type ChecklistLine } from "./checklistTypes"

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

/** 一组行的小计（数量×单价 求和）；qty/unit_price 非法值按 0 计 */
export function subtotalOfLines(lines: ChecklistLine[]): number {
  return (lines ?? []).reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0)
}

/** 按 category 分组汇总勾选行，保留首次出现顺序；未勾选行剔除，空分类归「未分类」 */
export function summarizeChecklistCategories(lines: ChecklistLine[]): CategorySummary[] {
  const map = new Map<string, CategorySummary>()
  for (const l of lines ?? []) {
    if (l.checked === false) continue
    const key = l.category || "未分类"
    let cur = map.get(key)
    if (!cur) {
      cur = { category: key, count: 0, subtotal: 0, externalCount: 0 }
      map.set(key, cur)
    }
    cur.count += 1
    cur.subtotal += (Number(l.qty) || 0) * (Number(l.unit_price) || 0)
    if (l.source === "external") cur.externalCount += 1
  }
  return Array.from(map.values())
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

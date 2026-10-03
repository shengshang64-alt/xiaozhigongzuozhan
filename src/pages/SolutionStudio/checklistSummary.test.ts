import { describe, expect, it } from "vitest"
import type { ChecklistLine } from "./checklistTypes"
import { buildChecklistTotals, subtotalOfLines, summarizeChecklistCategories } from "./checklistSummary"

// ---------------------------------------------------------------------------
// 建设清单预算结构汇总纯函数：分类小计 / 全局条目·分类·外购计数
// 口径须与 calcTotal 一致（剔除未勾选行、qty×unit_price、空分类归未分类）
// ---------------------------------------------------------------------------

function line(over: Partial<ChecklistLine> = {}): ChecklistLine {
  return {
    line_id: "l-1",
    category: "医疗信息化",
    product_line: "",
    product_name: "互联网医院",
    module_name: "在线复诊",
    module_func: "",
    unit: "套",
    qty: 1,
    unit_price: 0,
    source: "company",
    rating_hits: [],
    remark: "",
    product_id: "p-1",
    checked: true,
    ...over,
  }
}

describe("subtotalOfLines", () => {
  it("数量×单价求和", () => {
    const items = [
      line({ line_id: "l1", qty: 2, unit_price: 1000 }),
      line({ line_id: "l2", qty: 3, unit_price: 500 }),
    ]
    expect(subtotalOfLines(items)).toBe(3500)
  })

  it("qty/unit_price 非法值（NaN/空串）按 0 计，空数组为 0", () => {
    const items = [line({ line_id: "l1", qty: Number.NaN, unit_price: 1000 }), line({ line_id: "l2", qty: 5, unit_price: undefined as unknown as number })]
    expect(subtotalOfLines(items)).toBe(0)
    expect(subtotalOfLines([])).toBe(0)
  })
})

describe("summarizeChecklistCategories", () => {
  it("按分类聚合小计与计数，保留首次出现顺序", () => {
    const items = [
      line({ line_id: "l1", category: "HIS", qty: 1, unit_price: 20000 }),
      line({ line_id: "l2", category: "LIS", qty: 2, unit_price: 5000 }),
      line({ line_id: "l3", category: "HIS", qty: 1, unit_price: 10000 }),
    ]
    const cats = summarizeChecklistCategories(items)
    expect(cats.map((c) => c.category)).toEqual(["HIS", "LIS"])
    expect(cats[0]).toEqual({ category: "HIS", count: 2, subtotal: 30000, externalCount: 0 })
    expect(cats[1]).toEqual({ category: "LIS", count: 1, subtotal: 10000, externalCount: 0 })
  })

  it("剔除未勾选行；空分类归「未分类」", () => {
    const items = [
      line({ line_id: "l1", category: "", qty: 1, unit_price: 800 }),
      line({ line_id: "l2", category: "EMR", qty: 1, unit_price: 900, checked: false }),
    ]
    const cats = summarizeChecklistCategories(items)
    expect(cats).toEqual([{ category: "未分类", count: 1, subtotal: 800, externalCount: 0 }])
  })

  it("统计各分类外购行数", () => {
    const items = [
      line({ line_id: "l1", category: "硬件", source: "external" }),
      line({ line_id: "l2", category: "硬件", source: "company" }),
      line({ line_id: "l3", category: "硬件", source: "external" }),
    ]
    const cats = summarizeChecklistCategories(items)
    expect(cats[0].externalCount).toBe(2)
    expect(cats[0].count).toBe(3)
  })
})

describe("buildChecklistTotals", () => {
  it("条目/分类/外购计数 + 合计与 calcTotal 口径一致", () => {
    const items = [
      line({ line_id: "l1", category: "HIS", qty: 1, unit_price: 20000 }),
      line({ line_id: "l2", category: "硬件", qty: 2, unit_price: 3000, source: "external" }),
      line({ line_id: "l3", category: "HIS", qty: 1, unit_price: 5000, checked: false }),
    ]
    const t = buildChecklistTotals(items)
    expect(t).toEqual({ lineCount: 2, categoryCount: 2, externalCount: 1, total: 26000 })
  })

  it("空清单/未勾选全部 → 全 0", () => {
    expect(buildChecklistTotals([])).toEqual({ lineCount: 0, categoryCount: 0, externalCount: 0, total: 0 })
    const items = [line({ line_id: "l1", qty: 4, unit_price: 999, checked: false })]
    expect(buildChecklistTotals(items)).toEqual({ lineCount: 0, categoryCount: 0, externalCount: 0, total: 0 })
  })

  it("null/undefined 入参安全（不抛异常）", () => {
    const t = buildChecklistTotals(undefined as unknown as ChecklistLine[])
    expect(t).toEqual({ lineCount: 0, categoryCount: 0, externalCount: 0, total: 0 })
  })
})

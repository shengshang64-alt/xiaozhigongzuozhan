import { describe, expect, it } from "vitest"
import { calcTotal, lineSubtotalYuan, sumLinesYuan, type ChecklistLine } from "./checklistTypes"
import { subtotalOfLines, summarizeChecklistCategories } from "./checklistSummary"

// ---------------------------------------------------------------------------
// B9 建设清单金额精确到分（与报价域 R034 的 money.ts 同口径）
//
// 旧写法 `qty * unit_price` 走二进制浮点：单价带 3 位以上小数（Excel 导入 / AI 生成
// 清单 / 手工输入都会出现）时，真值恰好落在半分处会被存成 …49999…，按分四舍五入少 1 分；
// 且 Excel 导出里「逐行小计 / 分类小计 / 合计」三条算路各自独立累加，会互相打架。
// 本组用例把修复后的口径钉死，并保留旧行为作回归对照。
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

/** 元 → 整数分（规避 1e-13 级二进制尾差） */
const centsOf = (yuan: number) => Math.round(yuan * 100)

const DEMO = [
  line({ line_id: "d1", category: "HIS", qty: 7, unit_price: 12345.678 }),
  line({ line_id: "d2", category: "HIS", qty: 3, unit_price: 9876.543 }),
  line({ line_id: "d3", category: "硬件", qty: 11, unit_price: 4321.005 }),
]

describe("建设清单金额精确到分（B9）", () => {
  it("单价带 3 位小数时逐行小计精确到分（旧浮点少 1 分）", () => {
    expect(lineSubtotalYuan(DEMO[0])).toBe(86419.75)
    expect(lineSubtotalYuan(DEMO[1])).toBe(29629.63)
    expect(lineSubtotalYuan(DEMO[2])).toBe(47531.06)
    // 旧写法：7 × 12345.678 的浮点值是 86419.746…，按分应为 .75
    expect(7 * 12345.678).not.toBe(86419.75)
  })

  it("合计 = 逐行精确到分后累加（旧实现 163580.43，真值 163580.44）", () => {
    expect(centsOf(calcTotal(DEMO))).toBe(16358044)
    // 旧实现对照：同一批数据少 1 分
    expect(centsOf(DEMO.reduce((s, l) => s + l.qty * l.unit_price, 0))).toBe(16358043)
  })

  it("Excel 导出三条算路一致：逐行小计之和 = 分类小计之和 = 合计", () => {
    const grand = calcTotal(DEMO)
    const lineSum = DEMO.reduce((s, l) => s + lineSubtotalYuan(l), 0)
    const catSum = summarizeChecklistCategories(DEMO).reduce((s, c) => s + c.subtotal, 0)
    expect(centsOf(lineSum)).toBe(centsOf(grand))
    expect(centsOf(catSum)).toBe(centsOf(grand))
    expect(summarizeChecklistCategories(DEMO).map((c) => c.subtotal)).toEqual([116049.38, 47531.06])
  })

  it("sumLinesYuan 与 subtotalOfLines 同口径，且支持未过滤入参", () => {
    expect(subtotalOfLines(DEMO)).toBe(sumLinesYuan(DEMO))
    expect(subtotalOfLines([])).toBe(0)
    expect(sumLinesYuan(undefined as unknown as ChecklistLine[])).toBe(0)
  })

  it("未勾选行剔除；NaN/空值按 0 计；空数组为 0", () => {
    const items = [
      line({ line_id: "l1", qty: 2, unit_price: 1000 }),
      line({ line_id: "l2", qty: 5, unit_price: 999, checked: false }),
      line({ line_id: "l3", qty: Number.NaN, unit_price: 1234 }),
      line({ line_id: "l4", qty: 3, unit_price: undefined as unknown as number }),
    ]
    expect(calcTotal(items)).toBe(2000)
    expect(calcTotal([])).toBe(0)
    expect(calcTotal(undefined as unknown as ChecklistLine[])).toBe(0)
  })

  it("口径不变（整数 / 2 位小数单价的结果与旧实现逐分一致）", () => {
    const items = [
      line({ line_id: "l1", category: "HIS", qty: 1, unit_price: 450000 }),
      line({ line_id: "l2", category: "HIS", qty: 2, unit_price: 380000.5 }),
      line({ line_id: "l3", category: "硬件", qty: 3, unit_price: 1234.56 }),
    ]
    const old = items.reduce((s, l) => s + l.qty * l.unit_price, 0)
    expect(centsOf(calcTotal(items))).toBe(centsOf(old))
    expect(calcTotal(items)).toBe(1213704.68)
  })
})

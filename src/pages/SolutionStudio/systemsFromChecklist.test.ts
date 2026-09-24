import { describe, expect, it } from "vitest"
import { systemsFromChecklist, type ChecklistLine } from "./checklistTypes"

// ---------------------------------------------------------------------------
// 方案向导系统清单：从 ChecklistLine[] 去重生成 product_name 列表
// 用于 NewSolutionWizard 的 systems 标签自动勾选 + AI 大纲 prompt 注入
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

describe("systemsFromChecklist", () => {
  it("按 product_name 去重 + 保留首次出现顺序", () => {
    const items = [
      line({ line_id: "l1", product_name: "EMR" }),
      line({ line_id: "l2", product_name: "LIS" }),
      line({ line_id: "l3", product_name: "EMR" }), // 重复 → 保留首次
      line({ line_id: "l4", product_name: "PACS" }),
    ]
    expect(systemsFromChecklist(items)).toEqual(["EMR", "LIS", "PACS"])
  })

  it("过滤 checked=false 的行：未勾选不进 systems", () => {
    const items = [
      line({ line_id: "l1", product_name: "EMR" }),
      line({ line_id: "l2", product_name: "LIS", checked: false }),
      line({ line_id: "l3", product_name: "PACS" }),
    ]
    expect(systemsFromChecklist(items)).toEqual(["EMR", "PACS"])
  })

  it("product_name 为空 / 仅空白 → 被丢弃", () => {
    const items = [
      line({ line_id: "l1", product_name: "" }),
      line({ line_id: "l2", product_name: "   " }),
      line({ line_id: "l3", product_name: "EMR" }),
    ]
    expect(systemsFromChecklist(items)).toEqual(["EMR"])
  })

  it("company + external 混合：不区分来源，一律进 systems", () => {
    const items = [
      line({ line_id: "l1", product_name: "EMR", source: "company" }),
      line({ line_id: "l2", product_name: "第三方硬件", source: "external" }),
    ]
    expect(systemsFromChecklist(items)).toEqual(["EMR", "第三方硬件"])
  })

  it("空数组 / null / undefined → 返回 []", () => {
    expect(systemsFromChecklist([])).toEqual([])
    expect(systemsFromChecklist(undefined as unknown as ChecklistLine[])).toEqual([])
    expect(systemsFromChecklist(null as unknown as ChecklistLine[])).toEqual([])
  })
})

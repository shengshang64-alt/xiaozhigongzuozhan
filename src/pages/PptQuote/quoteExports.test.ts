import { describe, expect, it } from "vitest"
import { QUOTE_EXPORT_HEADERS, quoteRowCells } from "./quoteExports"
import type { QuoteItem } from "./pptQuoteTypes"

// ---------------------------------------------------------------------------
// 报价导出表头与建设清单同构（10 列，防漂移）
// 参考：src/pages/SolutionStudio/checklistExports.ts · exportChecklistXlsx 里的 headers 数组
// ---------------------------------------------------------------------------

describe("QUOTE_EXPORT_HEADERS", () => {
  it("严格等于清单约定的 10 列（含「单价(元)/小计(元)」显式金额单位）", () => {
    expect(QUOTE_EXPORT_HEADERS).toEqual([
      "类别",
      "产品/系统",
      "模块",
      "来源",
      "数量",
      "单位",
      "单价(元)",
      "小计(元)",
      "评级关联",
      "备注",
    ])
  })

  it("与 exportChecklistXlsx 表头列数一致 + 逐列对齐（忽略金额单位后缀）", () => {
    // exportChecklistXlsx 的表头（源码位置：src/pages/SolutionStudio/checklistExports.ts · L190）
    const checklistHeaders = ["类别", "产品/系统", "模块", "来源", "数量", "单位", "单价", "小计", "评级关联", "备注"]
    expect(QUOTE_EXPORT_HEADERS).toHaveLength(checklistHeaders.length)
    const strip = (h: readonly string[]) => h.map((x) => x.replace(/\(元\)$/, ""))
    expect(strip(QUOTE_EXPORT_HEADERS)).toEqual(checklistHeaders)
  })
})

describe("quoteRowCells", () => {
  it("目录行：category / product_name / module_name 优先，source=company → 「我公司」", () => {
    const it: QuoteItem = {
      id: "i1",
      item_name: "旧名",
      spec: "旧规格",
      unit: "套",
      qty: 2,
      price: 5000,
      discount: 90,
      category: "医疗信息化",
      product_name: "互联网医院",
      module_name: "在线复诊",
      module_func: "图文/视频",
      source: "company",
      product_id: "p-1",
      rating_hits: ["电子病历-5 级"],
      remark: "含实施",
    }
    const row = quoteRowCells(it, "分组名")
    expect(row[0]).toBe("医疗信息化")
    expect(row[1]).toBe("互联网医院")
    expect(row[2]).toBe("在线复诊")
    expect(row[3]).toBe("我公司")
    expect(row[4]).toBe(2)
    expect(row[5]).toBe("套")
    expect(row[6]).toBe(5000)
    // 小计 = qty * price * discount%
    expect(row[7]).toBeCloseTo(9000, 2)
    expect(row[8]).toContain("电子病历-5 级")
    expect(row[9]).toBe("含实施")
  })

  it("老行兼容：无 category 时用传入分组名兜底，product_name 缺省取 item_name", () => {
    const legacy = {
      id: "i-legacy",
      item_name: "手写行项",
      spec: "规格说明",
      unit: "套",
      qty: 1,
      price: 1000,
      discount: 100,
    } as QuoteItem
    const row = quoteRowCells(legacy, "旧科目")
    expect(row[0]).toBe("旧科目")
    expect(row[1]).toBe("手写行项")
    expect(row[2]).toBe("规格说明") // module_name/module_func 都无 → 回退到 spec
    expect(row[3]).toBe("手工")
  })

  it("外购 source=external → 展示「外购」；rating_hits 缺失时显示「未指定评级目标」", () => {
    const ext = {
      id: "i-ext",
      item_name: "第三方硬件",
      spec: "",
      unit: "台",
      qty: 1,
      price: 8000,
      discount: 100,
      category: "硬件三方",
      source: "external",
    } as QuoteItem
    const row = quoteRowCells(ext, "硬件")
    expect(row[3]).toBe("外购")
    expect(row[8]).toBe("未指定评级目标")
  })
})

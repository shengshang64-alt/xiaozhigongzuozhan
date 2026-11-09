import { describe, expect, it } from "vitest"
import type { ChecklistLine } from "./checklistTypes"
import {
  formatAmountWan,
  mapRequirementSegments,
  parseRequirementSegments,
} from "./checklistTypes"
import {
  buildAmountBreakdown,
  buildChecklistSteps,
  classifyAmountBucket,
  formatBreakdownInline,
  recommendFromPeerChecklists,
  recommendFromRequirementText,
} from "./checklistSummary"

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

describe("parseRequirementSegments / mapRequirementSegments", () => {
  it("空原文得到空段", () => {
    expect(parseRequirementSegments("")).toEqual([])
    expect(parseRequirementSegments("   \n")).toEqual([])
  })

  it("按空行拆段", () => {
    const segs = parseRequirementSegments("第一段内容。\n\n第二段内容。")
    expect(segs).toHaveLength(2)
    expect(segs[0].text).toContain("第一段")
  })

  it("按产品名映射已映射/未映射/部分映射", () => {
    const raw = "建设 HIS 核心业务系统。\n\n另需互联网医院与等保。"
    const items = [
      line({ line_id: "a", product_name: "HIS 核心业务系统", module_name: "", checked: true }),
      line({ line_id: "b", product_name: "互联网医院", module_name: "", checked: false }),
    ]
    const mapped = mapRequirementSegments(raw, items)
    expect(mapped).toHaveLength(2)
    expect(mapped[0].mapping).toBe("mapped")
    expect(mapped[0].lineIds).toEqual(["a"])
    expect(mapped[1].mapping).toBe("partial")
    expect(mapped[1].lineIds).toEqual(["b"])
  })
})

describe("formatAmountWan", () => {
  it("元转万元一位小数", () => {
    expect(formatAmountWan(6980000)).toBe("698.0 万")
    expect(formatAmountWan(0)).toBe("0.0 万")
  })
})

describe("classifyAmountBucket / buildAmountBreakdown", () => {
  it("按关键字分到设备/软件/实施/服务/税", () => {
    expect(classifyAmountBucket(line({ category: "硬件设备", product_name: "服务器" }))).toBe("equipment")
    expect(classifyAmountBucket(line({ product_name: "HIS 核心" }))).toBe("software")
    expect(classifyAmountBucket(line({ category: "实施服务", product_name: "驻场实施" }))).toBe("implementation")
    expect(classifyAmountBucket(line({ product_name: "三年运维" }))).toBe("service")
    expect(classifyAmountBucket(line({ product_name: "增值税" }))).toBe("tax")
    expect(classifyAmountBucket(line({ category: "其它", product_name: "未知条目" }))).toBe("software")
  })

  it("只汇总勾选行，total 与未勾选无关", () => {
    const items = [
      line({ line_id: "1", category: "硬件设备", product_name: "服务器", qty: 1, unit_price: 100000, checked: true }),
      line({ line_id: "2", product_name: "HIS", qty: 1, unit_price: 200000, checked: true }),
      line({ line_id: "3", product_name: "互联网医院", qty: 1, unit_price: 50000, checked: false }),
    ]
    const b = buildAmountBreakdown(items)
    expect(b.equipment).toBe(100000)
    expect(b.software).toBe(200000)
    expect(b.total).toBe(300000)
    expect(formatBreakdownInline(b)).toContain("设备 10.0")
    expect(formatBreakdownInline(b)).toContain("软件 20.0")
  })
})

describe("buildChecklistSteps", () => {
  it("无原文时第一步为进行中", () => {
    const steps = buildChecklistSteps({ segmentCount: 0, lineCount: 0, checkedCount: 0, outlineGenerated: false })
    expect(steps[0].state).toBe("on")
    expect(steps[2].lockReason).toContain("系统清单")
  })

  it("有原文和清单行、未转大纲时第二步进行中", () => {
    const steps = buildChecklistSteps({ segmentCount: 4, lineCount: 9, checkedCount: 7, outlineGenerated: false })
    expect(steps[0].state).toBe("done")
    expect(steps[0].detail).toContain("4 段")
    expect(steps[1].state).toBe("on")
    expect(steps[1].detail).toBe("进行中 · 9 项已确认 7 项")
    expect(steps[2].state).toBe("todo")
    expect(steps[2].lockReason).toBe("")
  })

  it("已生成大纲时三步都完成", () => {
    const steps = buildChecklistSteps({ segmentCount: 2, lineCount: 3, checkedCount: 3, outlineGenerated: true })
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "done"])
  })
})

describe("recommendFromRequirementText / recommendFromPeerChecklists", () => {
  it("原文点名且清单未收录时给出真实理由，不编造演示句", () => {
    const recos = recommendFromRequirementText("需要上线 LIS 检验系统", [], [{ id: "p-lis", product_name: "LIS 检验系统" }])
    expect(recos).toHaveLength(1)
    expect(recos[0].text).toContain("LIS 检验系统")
  })

  it("原文为空则无推荐", () => {
    expect(recommendFromRequirementText("", [], [{ id: "p-lis", product_name: "LIS 检验系统" }])).toEqual([])
  })

  it("同类医院清单中的未列入系统会提示", () => {
    const current = { id: "c1", hospital: "顾县人民医院", items: [line({ product_name: "HIS" })] }
    const peers = [
      {
        id: "c2",
        checklist_name: "邻院清单",
        hospital: "顾县人民医院",
        items: [line({ line_id: "x", product_name: "PACS 影像系统" })],
      },
    ]
    const recos = recommendFromPeerChecklists(current, peers)
    expect(recos[0].text).toContain("PACS 影像系统")
    expect(recos[0].text).toContain("邻院清单")
  })
})

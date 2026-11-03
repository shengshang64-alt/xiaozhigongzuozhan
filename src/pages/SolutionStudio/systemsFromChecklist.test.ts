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

// ---------------------------------------------------------------------------
// R150：未匹配产品清单的建设范围必须进快照与大纲 prompt（真实招标来源清单不再整段丢失）
// ---------------------------------------------------------------------------

import { snapshotFromChecklist } from "./checklistTypes"
import { checklistScopeBlock } from "./solutionTypes"
import type { ChecklistRecord } from "./checklistTypes"

function rec(over: Partial<ChecklistRecord> = {}): ChecklistRecord {
  return {
    id: "ck-1",
    checklist_name: "【演练】测试清单",
    hospital: "三明市中西医结合医院",
    rating_targets: ["emr:5", "hpc:5B"],
    items: [],
    total_amount: 0,
    ...over,
  } as ChecklistRecord
}

describe("snapshotFromChecklist 未匹配需求条目（R150）", () => {
  it("无 product_name 的条目进 customer_requirements（module_name+module_func 合成）", () => {
    const r = rec({
      items: [
        { line_id: "l1", category: "智慧医疗", module_name: "一体化医院信息管理系统", module_func: "门急诊挂号系统、门诊医生工作站", checked: true },
        { line_id: "l2", category: "传承创新", module_name: "中医智能体质辨识", module_func: "", checked: true },
        { line_id: "l3", checked: true, module_name: "", module_func: "纯功能描述无名字" },
      ],
    } as Partial<ChecklistRecord>)
    const snap = snapshotFromChecklist(r)
    expect(snap.customer_requirements).toEqual([
      "一体化医院信息管理系统（门急诊挂号系统、门诊医生工作站）",
      "中医智能体质辨识",
      "纯功能描述无名字",
    ])
    expect(snap.company_systems).toEqual([])
  })

  it("已匹配条目（source=company+product_name）照旧进 company_systems，不重复进需求条目", () => {
    const r = rec({
      items: [
        { line_id: "l1", source: "company", product_name: "HIS", module_name: "门诊管理", module_func: "挂号收费", checked: true },
        { line_id: "l2", source: "external", product_name: "AI 辅诊", module_name: "", module_func: "", checked: true },
      ],
    } as Partial<ChecklistRecord>)
    const snap = snapshotFromChecklist(r)
    expect(snap.company_systems).toEqual(["HIS"])
    expect(snap.external_systems).toEqual(["AI 辅诊"])
    expect(snap.customer_requirements).toEqual([])
  })

  it("checked=false 的行不进任何通道", () => {
    const r = rec({
      items: [
        { line_id: "l1", module_name: "被取消的系统", module_func: "", checked: false },
      ],
    } as Partial<ChecklistRecord>)
    expect(snapshotFromChecklist(r).customer_requirements).toEqual([])
  })
})

describe("checklistScopeBlock 注入客户需求条目（R150）", () => {
  it("渲染编号需求条目并要求逐条覆盖", () => {
    const block = checklistScopeBlock({
      checklist_id: "ck-1",
      checklist_name: "【演练】测试清单",
      rating_targets: ["emr:5"],
      company_systems: [],
      external_systems: [],
      customer_requirements: ["一体化医院信息管理系统（门急诊挂号系统）", "中医智能体质辨识"],
    })
    expect(block).toContain("客户建设需求条目（共 2 条，逐条覆盖、不得遗漏、不得合并）")
    expect(block).toContain("1) 一体化医院信息管理系统（门急诊挂号系统）")
    expect(block).toContain("2) 中医智能体质辨识")
    expect(block).toContain("全部系统与客户建设需求条目")
  })

  it("旧快照无 customer_requirements 字段时兼容（回退占位说明）", () => {
    const block = checklistScopeBlock({
      checklist_id: "ck-0",
      checklist_name: "旧清单",
      rating_targets: [],
      company_systems: ["HIS"],
      external_systems: [],
    })
    expect(block).toContain("本清单无未匹配需求条目")
    expect(block).toContain("我公司承建系统：HIS")
  })
})

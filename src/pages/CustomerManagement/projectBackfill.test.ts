import { describe, expect, it } from "vitest"
import {
  BACKFILL_STAGE,
  backfillCounts,
  backfillCustomerNotes,
  hospitalCore,
  matchCustomers,
  matchHospitalName,
  MIN_HOSPITAL_CORE_LEN,
  normalizeHospitalName,
  previewProjectBackfill,
  type BackfillCustomerInput,
  type BackfillOpportunityInput,
  type BackfillProjectInput,
} from "./projectBackfill"

const customers: BackfillCustomerInput[] = [
  { id: "c1", hospital_name: "测试市第一人民医院" },
  { id: "c2", hospital_name: "测试县中医医院" },
]

describe("normalizeHospitalName / hospitalCore", () => {
  it("去掉首尾空白和中间空格", () => {
    expect(normalizeHospitalName("  测试市 第一人民医院  ")).toBe("测试市第一人民医院")
    expect(normalizeHospitalName("")).toBe("")
  })

  it("剥人民/中医/中心医院等尾缀，核心词足够长才可用于模糊匹配", () => {
    expect(hospitalCore("测试市第一人民医院")).toBe("测试市第一")
    expect(hospitalCore("测试县中医医院")).toBe("测试县")
    expect(hospitalCore("测试县中医院")).toBe("测试县")
    expect(hospitalCore("东市中心医院")).toBe("东市")
    expect(hospitalCore("东市中心医院").length).toBeLessThan(MIN_HOSPITAL_CORE_LEN)
  })
})

describe("matchHospitalName", () => {
  it("精确 trim 命中可自动应用", () => {
    expect(matchHospitalName("  测试市第一人民医院  ", "测试市第一人民医院")).toBe("exact")
  })

  it("去空格后相同视为 normalized，可自动应用", () => {
    expect(matchHospitalName("测试市 第一人民医院", "测试市第一人民医院")).toBe("normalized")
  })

  it("尾缀不同但核心词足够长时只标 fuzzy，不得当精确命中", () => {
    expect(matchHospitalName("测试市第一医院", "测试市第一人民医院")).toBe("fuzzy")
    expect(matchHospitalName("测试市第一中心医院", "测试市第一人民医院")).toBe("fuzzy")
  })

  it("核心词过短时不模糊命中，避免「东市中心医院」误撞「东市人民医院」", () => {
    expect(matchHospitalName("东市中心医院", "东市人民医院")).toBe("none")
    expect(hospitalCore("东市人民医院")).toBe("东市")
  })

  it("完全无关的名称不命中", () => {
    expect(matchHospitalName("测试市第一人民医院", "测试县中医医院")).toBe("none")
    expect(matchHospitalName("", "测试市第一人民医院")).toBe("none")
  })
})

describe("matchCustomers", () => {
  it("唯一精确命中", () => {
    const r = matchCustomers("测试市第一人民医院", customers)
    expect(r.kind).toBe("exact")
    expect(r.customers).toEqual([customers[0]])
  })

  it("多个模糊候选标为 fuzzy", () => {
    const r = matchCustomers("测试市第一医院", [
      { id: "a", hospital_name: "测试市第一人民医院" },
      { id: "b", hospital_name: "测试市第一中心医院" },
    ])
    expect(r.kind).toBe("fuzzy")
    expect(r.customers).toHaveLength(2)
  })
})

describe("previewProjectBackfill", () => {
  const projects: BackfillProjectInput[] = [
    { id: "b-new", source: "bid", name: "信息科升级", hospital: "测试市未建档医院" },
    { id: "b-link", source: "bid", name: "智慧医院一期", hospital: "测试市第一人民医院", opportunity_id: "" },
    { id: "b-done", source: "bid", name: "已挂接项目", hospital: "测试县中医医院", opportunity_id: "o1" },
    { id: "b-fuzzy", source: "bid", name: "模糊项目", hospital: "测试市第一医院" },
    { id: "b-deleted", source: "bid", name: "已删", hospital: "测试市未建档医院", deleted_at: "2026-11-01T00:00:00Z" },
    { id: "b-empty", source: "bid", name: "无名医院项目", hospital: "  " },
    { id: "s-link", source: "solution", name: "整体方案", hospital: "测试市第一人民医院" },
    { id: "q-link", source: "quote", name: "模块报价", hospital: "测试县中医医院", opportunity_id: "" },
  ]
  const opps: BackfillOpportunityInput[] = [
    { id: "o1", customer_id: "c2", opp_name: "已挂接项目", ref_type: "bid", ref_id: "b-done" },
  ]

  it("按分组切开：建档 / 挂商机 / 已对齐 / 待确认，并跳过已删和空名", () => {
    const preview = previewProjectBackfill(projects, customers, opps)
    const counts = backfillCounts(preview)
    expect(counts.create).toBe(1)
    expect(preview.create[0].project.id).toBe("b-new")
    expect(counts.aligned).toBe(1)
    expect(preview.aligned[0].project.id).toBe("b-done")
    expect(counts.pending).toBe(1)
    expect(preview.pending[0].project.id).toBe("b-fuzzy")
    expect(preview.pending[0].reason).toBe("fuzzy")
    expect(counts.skippedDeleted).toBe(1)
    expect(counts.skippedEmpty).toBe(1)
    const linkIds = preview.link.map((i) => i.project.id).sort()
    expect(linkIds).toEqual(["b-link", "q-link", "s-link"])
  })

  it("模糊项不得进入可自动应用的 create/link", () => {
    const preview = previewProjectBackfill(projects, customers, opps)
    expect(preview.create.every((i) => i.project.id !== "b-fuzzy")).toBe(true)
    expect(preview.link.every((i) => i.project.id !== "b-fuzzy")).toBe(true)
  })

  it("方案不能写回 opportunity_id，投标和报价可以", () => {
    const preview = previewProjectBackfill(projects, customers, opps)
    const sol = preview.link.find((i) => i.project.id === "s-link")
    const bid = preview.link.find((i) => i.project.id === "b-link")
    const quote = preview.link.find((i) => i.project.id === "q-link")
    expect(sol?.canWriteOpportunityId).toBe(false)
    expect(bid?.canWriteOpportunityId).toBe(true)
    expect(quote?.canWriteOpportunityId).toBe(true)
  })

  it("同名商机可复用", () => {
    const preview = previewProjectBackfill(
      [{ id: "b2", source: "bid", name: "智慧医院一期", hospital: "测试市第一人民医院" }],
      customers,
      [{ id: "o9", customer_id: "c1", opp_name: "智慧医院一期" }],
    )
    expect(preview.link).toHaveLength(1)
    expect(preview.link[0].reuseOpportunity?.id).toBe("o9")
  })

  it("阶段与备注口径固定", () => {
    expect(BACKFILL_STAGE.bid).toBe("bidding")
    expect(BACKFILL_STAGE.solution).toBe("solution")
    expect(BACKFILL_STAGE.quote).toBe("needs")
    expect(backfillCustomerNotes(["bid", "solution"])).toBe("来源：投标/方案回填")
  })
})

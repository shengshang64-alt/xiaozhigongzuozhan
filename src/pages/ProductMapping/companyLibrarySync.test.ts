import { describe, expect, it } from "vitest"
import type { CheckMapping, CheckProduct } from "@/pages/SolutionStudio/checklistTypes"
import {
  incomingPriceIsBlank,
  mergeIncomingProduct,
  planLibraryDedupe,
  planLibraryUpsert,
} from "./companyLibrarySync"

function mk(over: Partial<CheckProduct> & { id: string }): CheckProduct {
  return {
    is_builtin: false,
    in_company: true,
    category: "",
    product_line: "",
    product_name: "ONE-LINK-HIS",
    module_name: "门急诊挂号收费系统",
    module_func: "",
    description: "",
    charge_mode: "模块授权",
    unit_price: 0,
    status: "在售",
    rating_tags: {},
    ...over,
  }
}

describe("空价格不覆盖", () => {
  it("新表单价 0 且档位无价格 → 视为空，不覆盖已有价", () => {
    expect(incomingPriceIsBlank({ unit_price: 0, price_tier: [{ tier: "A类", price: 0 }] })).toBe(true)
    expect(incomingPriceIsBlank({ unit_price: 80000, price_tier: [] })).toBe(false)
    const existing = mk({ id: "old", unit_price: 120000, price_tier: [{ tier: "A类", price: 120000 }] })
    const patch = mergeIncomingProduct(existing, {
      unit_price: 0,
      price_tier: [{ tier: "A类", outpatient: "门诊量≥13000", price: 0 }],
      recommendation: "必选",
      rating_tags: { emr: ["病历五级"] },
    })
    expect(patch.unit_price).toBeUndefined()
    expect(patch.price_tier).toBeUndefined()
    expect(patch.recommendation).toBe("必选")
    expect(patch.rating_tags).toEqual({ emr: ["病历五级"] })
  })
})

describe("planLibraryUpsert", () => {
  it("同身份走更新，新身份走新增；行业种子不参与匹配", () => {
    const existing = [
      mk({ id: "keep", product_belong: "总部", category: "智慧医疗", unit_price: 5000 }),
      mk({
        id: "seed",
        in_company: false,
        is_builtin: true,
        product_name: "行业种子",
        module_name: "某某",
      }),
    ]
    const plan = planLibraryUpsert(existing, [
      { product_name: "ONE-LINK-HIS", module_name: "门急诊挂号收费系统", recommendation: "必选", unit_price: 0 },
      { product_name: "智能随访系统", module_name: "随访任务管理", unit_price: 0 },
    ])
    expect(plan.update).toBe(1)
    expect(plan.create).toBe(1)
    expect(plan.pricePreserved).toBe(1)
    expect(plan.items[0].existing?.id).toBe("keep")
  })

  it("同一轮导入出现两行相同身份时，不新建第二条", () => {
    const existing = [
      mk({ id: "keep", product_belong: "总部", category: "智慧医疗", module_category: "随访", product_name: "智能随访系统", module_name: "智能随访系统" }),
    ]
    const row = { product_name: "智能随访系统", module_name: "智能随访系统", module_category: "随访", recommendation: "可选", unit_price: 0 }
    const plan = planLibraryUpsert(existing, [row, { ...row, description: "重复行" }])
    expect(plan.update).toBe(1)
    expect(plan.create).toBe(0)
  })
})

describe("planLibraryDedupe", () => {
  it("保留更完整的一行，并把映射记忆改写到保留行；不碰行业种子", () => {
    const thin = mk({ id: "thin", category: "智慧医疗", product_name: "ONE-LINK-HIS", module_name: "胸痛中心" })
    const full = mk({
      id: "full",
      product_belong: "总部",
      category: "智慧医疗",
      product_name: "ONE-LINK-HIS",
      module_name: "胸痛中心",
      standard_name: "胸痛中心",
      recommendation: "可选",
      rating_tags: { emr: ["病历五级"] },
    })
    const seed = mk({
      id: "seed",
      in_company: false,
      is_builtin: true,
      product_name: "ONE-LINK-HIS",
      module_name: "胸痛中心",
    })
    const mappings: CheckMapping[] = [
      { id: "m1", customer_norm: "胸痛", company_product_name: "胸痛中心", product_id: "thin", hit_count: 2 },
    ]
    const plan = planLibraryDedupe([thin, full, seed], mappings)
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0].keep.id).toBe("full")
    expect(plan.retireIds).toEqual(["thin"])
    expect(plan.mappingRetargets).toEqual([{ mappingId: "m1", from: "thin", to: "full" }])
  })

  it("不同模块分类的同名模块不合并（电子签名）", () => {
    const a = mk({ id: "a", product_name: "院内移动诊疗系统", module_name: "电子签名", module_category: "移动医生" })
    const b = mk({ id: "b", product_name: "院内移动诊疗系统", module_name: "电子签名", module_category: "移动护理" })
    const plan = planLibraryDedupe([a, b], [])
    expect(plan.groups).toHaveLength(0)
    expect(plan.retireIds).toEqual([])
  })

  it("空分类历史行不得把不同产品线的电子签名桥接成一条", () => {
    const docs = mk({
      id: "docs",
      product_belong: "总部",
      product_name: "院内移动诊疗系统",
      module_name: "电子签名",
      module_category: "移动医生",
      standard_name: "电子签名",
      rating_tags: { emr: ["病历五级"] },
    })
    const nurse = mk({
      id: "nurse",
      product_belong: "总部",
      product_name: "院内移动诊疗系统",
      module_name: "电子签名",
      module_category: "移动护理",
      standard_name: "电子签名",
    })
    const leftover = mk({ id: "thin", product_name: "院内移动诊疗系统", module_name: "电子签名", module_category: "" })
    const leftover2 = mk({ id: "thin2", product_name: "院内移动诊疗系统", module_name: "电子签名", module_category: "" })
    const plan = planLibraryDedupe([docs, nurse, leftover, leftover2], [])
    expect(plan.retireIds).not.toContain("docs")
    expect(plan.retireIds).not.toContain("nurse")
    expect(plan.retireIds).toHaveLength(1)
    expect(["thin", "thin2"]).toContain(plan.retireIds[0])
  })

  it("只有一种非空分类时，空分类历史行并入该分类", () => {
    const full = mk({
      id: "full",
      product_belong: "总部",
      category: "智慧医疗",
      product_name: "ONE-LINK-HIS",
      module_name: "胸痛中心",
      module_category: "专科",
      standard_name: "胸痛中心",
      rating_tags: { emr: ["病历五级"] },
    })
    const thin = mk({ id: "thin", product_name: "ONE-LINK-HIS", module_name: "胸痛中心", module_category: "" })
    const plan = planLibraryDedupe([full, thin], [])
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0].keep.id).toBe("full")
    expect(plan.retireIds).toEqual(["thin"])
  })
})

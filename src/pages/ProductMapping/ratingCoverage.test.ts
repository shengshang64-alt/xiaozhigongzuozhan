/**
 * 2026-10-29 · 评级覆盖清单（按评级先筛 → 补客户要求 → 标注归属）行为网
 *
 * 对应用户三条需求：
 *   1) 有评级需求时，先按评级内容筛选，再把客户提到的要求补进去，并明确三方/公司/自定义；
 *   2) 评级必选项一定要体现；
 *   3) 没有的可不选（可选模块可过滤）。
 *
 * 「删掉实现即变红」：
 *   - 评级命中判定去掉 → 第 1、2 条变红
 *   - 「必选」强制带出逻辑去掉 → 第 3 条变红（可选过滤把必选也滤掉了）
 *   - 客户清单追加逻辑去掉 → 第 4 条变红
 *   - 归属判定去掉 → 第 5 条变红
 */
import { describe, expect, it } from "vitest"
import type { CheckProduct } from "@/pages/SolutionStudio/checklistTypes"
import {
  buildRatingCoverageRows,
  coverageStats,
  deliveryKindOf,
  productMatchesRating,
  productRatingText,
  ratingSelectionText,
  type RatingSelection,
} from "./ratingCoverage"

function mk(over: Partial<CheckProduct> & { id: string }): CheckProduct {
  return {
    is_builtin: false,
    in_company: true,
    category: "智慧医疗",
    product_line: "",
    product_name: "",
    module_name: "",
    module_func: "",
    description: "",
    charge_mode: "",
    unit_price: 0,
    status: "在售",
    rating_tags: {},
    ...over,
  } as CheckProduct
}

/** 电子病历 5 级必选模块 */
const EMR5_REQUIRED = mk({
  id: "p1",
  product_name: "ONE-LINK-EMR",
  module_name: "电子病历质量管理系统",
  module_category: "电子病历",
  recommendation: "必选",
  rating_tags: { emr: ["5", "6"] },
})
/** 电子病历 5 级可选模块 */
const EMR5_OPTIONAL = mk({
  id: "p2",
  product_name: "ONE-LINK-EMR",
  module_name: "病案首页质控系统",
  module_category: "智慧病案",
  recommendation: "可选",
  rating_tags: { emr: ["5"] },
})
/** 只支持 4 级的模块（不该出现在 5 级清单里） */
const EMR4_ONLY = mk({
  id: "p3",
  product_name: "ONE-LINK-EMR",
  module_name: "门诊电子病历系统",
  module_category: "电子病历",
  recommendation: "必选",
  rating_tags: { emr: ["4"] },
})
/** 三方产品 */
const THIRD = mk({
  id: "p4",
  category: "三方产品",
  product_name: "住院配液中心系统",
  module_name: "住院配液中心系统",
  rating_tags: {},
})
/** 客户清单命中、但无评级标签的公司模块 */
const CUSTOMER_ONLY = mk({
  id: "p5",
  product_name: "ONE-LINK-HIS",
  module_name: "门诊分诊排队叫号系统",
  module_category: "门诊管理",
  rating_tags: {},
})

const ROW = (p?: CheckProduct, raw = "某个客户条目", extra: Record<string, unknown> = {}) => ({
  raw,
  norm: raw,
  resolution: "company",
  product_id: p?.id ?? "",
  product: p ?? null,
  ...extra,
})

describe("评级命中判定", () => {
  it("1. 选中电子病历 5 级 → 只命中声明支持 5 级的模块", () => {
    const sel: RatingSelection = { emr: ["5"] }
    expect(productMatchesRating(EMR5_REQUIRED, sel)).toBe(true)
    expect(productMatchesRating(EMR5_OPTIONAL, sel)).toBe(true)
    expect(productMatchesRating(EMR4_ONLY, sel)).toBe(false)
  })

  it("1b. 未选任何评级 → 谁都不命中（不误筛）", () => {
    expect(productMatchesRating(EMR5_REQUIRED, {})).toBe(false)
  })

  it("1e. 真实库写法（中文原文）必须能命中标准码选择 —— 回归：曾因编码不一致导致命中 0 项", () => {
    // ONE-LINK 导入存的是列头原文（病历五级/互联互通四甲），不是 "5"/"4A"
    const realEmr = mk({ id: "r1", module_name: "门诊医生工作站", rating_tags: { emr: ["病历四级", "病历五级", "病历六级"] } })
    expect(productMatchesRating(realEmr, { emr: ["5"] })).toBe(true)
    expect(productMatchesRating(realEmr, { emr: ["6"] })).toBe(true)
    expect(productMatchesRating(realEmr, { emr: ["7"] })).toBe(false)

    const realHpc = mk({ id: "r2", module_name: "住院医生工作站", rating_tags: { hpc: ["互联互通四乙", "互联互通四甲", "互联互通五乙"] } })
    expect(productMatchesRating(realHpc, { hpc: ["4A"] })).toBe(true)
    expect(productMatchesRating(realHpc, { hpc: ["4B"] })).toBe(true)
    expect(productMatchesRating(realHpc, { hpc: ["5A"] })).toBe(false)

    const realSm = mk({ id: "r3", module_name: "护理病历系统", rating_tags: { sm: ["五级四甲", "六级四甲"] } })
    expect(productMatchesRating(realSm, { sm: ["3"] })).toBe(true)
  })

  it("1f. 评级文本展示不出现「电子病历病历五级」这类重复前缀", () => {
    const p = mk({ id: "t1", module_name: "M", rating_tags: { emr: ["病历四级", "病历五级"] } })
    const t = productRatingText(p)
    expect(t).toContain("电子病历")
    expect(t).not.toContain("电子病历病历")
    expect(t).toContain("4 级")
    expect(t).toContain("5 级")
  })

  it("1c. 产品声明「*」= 支持该体系全部档位", () => {
    const anyLevel = mk({ id: "x", module_name: "M", rating_tags: { emr: ["*"] } })
    expect(productMatchesRating(anyLevel, { emr: ["7"] })).toBe(true)
  })

  it("1d. 跨体系：选互联互通不影响电子病历判定", () => {
    const hpc = mk({ id: "h", module_name: "集成平台", rating_tags: { hpc: ["4A"] } })
    expect(productMatchesRating(hpc, { hpc: ["4A"] })).toBe(true)
    expect(productMatchesRating(hpc, { emr: ["5"] })).toBe(false)
  })
})

describe("评级覆盖清单构建", () => {
  it("2. 有评级时：评级命中的模块带出，未命中的不出现", () => {
    const out = buildRatingCoverageRows([EMR5_REQUIRED, EMR4_ONLY], [], { emr: ["5"] })
    const names = out.map((r) => r.moduleName)
    expect(names).toContain("电子病历质量管理系统")
    expect(names).not.toContain("门诊电子病历系统")
  })

  it("3. 评级必选项强制体现：即使关掉「含可选」，必选仍在", () => {
    const out = buildRatingCoverageRows([EMR5_REQUIRED, EMR5_OPTIONAL], [], { emr: ["5"] }, { includeOptional: false })
    const names = out.map((r) => r.moduleName)
    expect(names).toContain("电子病历质量管理系统") // 必选，必须留
    expect(names).not.toContain("病案首页质控系统") // 可选，被过滤
    expect(out.find((r) => r.moduleName === "电子病历质量管理系统")?.required).toBe(true)
  })

  it("3b. 默认包含可选模块（不过度裁剪）", () => {
    const out = buildRatingCoverageRows([EMR5_REQUIRED, EMR5_OPTIONAL], [], { emr: ["5"] })
    expect(out).toHaveLength(2)
    expect(out.filter((r) => r.source === "rating-required")).toHaveLength(1)
    expect(out.filter((r) => r.source === "rating-optional")).toHaveLength(1)
  })

  it("4. 客户清单提到的条目即使不在评级范围，也要追加进来", () => {
    const rows = [ROW(CUSTOMER_ONLY, "门诊分诊系统")]
    const out = buildRatingCoverageRows([EMR5_REQUIRED, CUSTOMER_ONLY], rows, { emr: ["5"] })
    const cust = out.filter((r) => r.source === "customer")
    expect(cust).toHaveLength(1)
    expect(cust[0].moduleName).toBe("门诊分诊排队叫号系统")
    expect(cust[0].customerItems).toEqual(["门诊分诊系统"])
    expect(cust[0].coveredByCustomer).toBe(true)
  })

  it("4b. 客户清单与评级重合时不重复成两行（评级优先）", () => {
    const rows = [ROW(EMR5_REQUIRED, "电子病历质控")]
    const out = buildRatingCoverageRows([EMR5_REQUIRED], rows, { emr: ["5"] })
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe("rating-required")
    expect(out[0].coveredByCustomer).toBe(true)
  })

  it("5. 归属判定：公司 / 三方 / 自定义", () => {
    expect(deliveryKindOf(EMR5_REQUIRED)).toBe("公司")
    expect(deliveryKindOf(THIRD)).toBe("三方")
    const rows = [ROW(undefined, "定制报表引擎", { customNames: ["自研报表引擎"] })]
    const out = buildRatingCoverageRows([EMR5_REQUIRED], rows, { emr: ["5"] })
    const custom = out.filter((r) => r.kind === "自定义")
    expect(custom).toHaveLength(1)
    expect(custom[0].moduleName).toBe("自研报表引擎")
  })

  it("6. 排序：评级必选 → 客户清单 → 评级可选 → 自定义", () => {
    const rows = [ROW(CUSTOMER_ONLY, "门诊分诊系统", {})]
    const out = buildRatingCoverageRows(
      [EMR5_REQUIRED, EMR5_OPTIONAL, CUSTOMER_ONLY],
      [...rows, ROW(undefined, "定制X", { customNames: ["自研X"] })],
      { emr: ["5"] },
    )
    const order = out.map((r) => (r.kind === "自定义" ? "custom" : r.source))
    expect(order.indexOf("rating-required")).toBeLessThan(order.indexOf("customer"))
    expect(order.indexOf("customer")).toBeLessThan(order.indexOf("rating-optional"))
    expect(order.indexOf("rating-optional")).toBeLessThan(order.indexOf("custom"))
  })

  it("7. 统计口径：必选数 / 三类归属 / 客户覆盖数", () => {
    const rows = [ROW(CUSTOMER_ONLY, "门诊分诊系统")]
    const out = buildRatingCoverageRows(
      [EMR5_REQUIRED, EMR5_OPTIONAL, CUSTOMER_ONLY, THIRD],
      [...rows, ROW(undefined, "定制Y", { customNames: ["自研Y"] })],
      { emr: ["5"] },
    )
    const st = coverageStats(out)
    expect(st.total).toBe(out.length)
    expect(st.required).toBeGreaterThanOrEqual(1)
    expect(st.company).toBeGreaterThanOrEqual(1)
    expect(st.custom).toBe(1)
  })

  it("8. 无评级选择时：只保留客户清单命中的条目（不乱塞全量目录）", () => {
    const rows = [ROW(CUSTOMER_ONLY, "门诊分诊系统")]
    const out = buildRatingCoverageRows([EMR5_REQUIRED, EMR5_OPTIONAL, CUSTOMER_ONLY], rows, {})
    expect(out).toHaveLength(1)
    expect(out[0].moduleName).toBe("门诊分诊排队叫号系统")
  })
})

describe("展示文本", () => {
  it("9. 评级选择文本可读", () => {
    expect(ratingSelectionText({ emr: ["5"], hpc: ["4A"] })).toContain("电子病历")
    expect(ratingSelectionText({ hpc: ["4A"] })).toContain("四级甲等")
    expect(ratingSelectionText({})).toBe("")
  })

  it("10. 产品评级文本可读（导出用）", () => {
    const t = productRatingText(EMR5_REQUIRED)
    expect(t).toContain("电子病历")
    expect(t).toContain("5 级")
  })
})

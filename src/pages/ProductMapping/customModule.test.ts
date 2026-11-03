/**
 * 2026-10-29 · 自定义模块（公司能做、但 ONE-LINK 产品清单里没有的条目）行为网
 *
 * 场景：客户清单里写的东西公司确实交付过，但公司标准清单里没有这一行。
 * 允许人工写一个自定义模块名，并且要能沉淀进映射记忆库、下次同类条目自动命中。
 *
 * 「删掉实现即变红」：
 *   - rowStatus 不认 customNames → 第 1、2 条变红（自定义行显示「无匹配」）
 *   - toCompareRows 不透传 custom_names → 第 3 条变红
 *   - backfillFromMappings 不恢复 custom_name → 第 4 条变红（下次同类条目不命中）
 */
import { describe, expect, it } from "vitest"
import type { CheckProduct, MatchRow } from "@/pages/SolutionStudio/checklistTypes"
import { backfillFromMappings, buildInitialRows, candidateLabel, rowStatus, toCompareRows } from "./mappingCore"

function mkProduct(over: Partial<CheckProduct> & { id: string }): CheckProduct {
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

function mkRow(over: Partial<MatchRow> & { row_id: string }): MatchRow {
  return {
    raw: "",
    norm: "",
    product_name: "",
    product_id: "",
    kind: "none",
    resolution: "company",
    ...over,
  } as MatchRow
}

const HIS = mkProduct({ id: "p1", product_name: "ONE-LINK-HIS", module_name: "门急诊挂号收费系统" })

describe("rowStatus · 自定义模块算「已命中」", () => {
  it("1. 只有自定义名、没有公司库行 → 状态是 custom（不是 none）", () => {
    expect(rowStatus({ kind: "none", resolution: "company", suggestion: null, product: null, customNames: ["自研接口适配"] })).toBe("custom")
  })

  it("2. 自定义名 + 公司库命中 → 仍判 custom（先让用户看到「有自定义成分」）", () => {
    expect(
      rowStatus({ kind: "mapping", resolution: "company", suggestion: null, product: HIS, customNames: ["自研接口适配"] }),
    ).toBe("custom")
  })

  it("2b. 空数组 / undefined 不影响原有判定（向后兼容）", () => {
    expect(rowStatus({ kind: "mapping", resolution: "company", suggestion: null, product: HIS, customNames: [] })).toBe("memory")
    expect(rowStatus({ kind: "none", resolution: "company", suggestion: null, product: null })).toBe("none")
    // 外购/忽略优先级高于自定义
    expect(rowStatus({ kind: "none", resolution: "external", suggestion: null, product: null, customNames: ["X"] })).toBe("external")
    expect(rowStatus({ kind: "none", resolution: "ignore", suggestion: null, product: null, customNames: ["X"] })).toBe("ignore")
  })
})

describe("toCompareRows · 自定义名透传到对照视图", () => {
  it("3. row.custom_names 变成 compareRow.customNames", () => {
    const rows = [mkRow({ row_id: "r1", norm: "自研接口适配", custom_names: ["自研接口适配", "定制报表"] })]
    const out = toCompareRows(rows, [HIS])
    expect(out[0].customNames).toEqual(["自研接口适配", "定制报表"])
  })

  it("3b. 无自定义时不产生该字段（避免空数组污染判定）", () => {
    const rows = [mkRow({ row_id: "r2", norm: "x" })]
    const out = toCompareRows(rows, [HIS])
    expect(out[0].customNames).toBeUndefined()
  })
})

describe("backfillFromMappings · 记忆库恢复自定义名", () => {
  it("4. 记忆里只有 custom_name（product_id 空）时，下次同类条目命中为自定义", () => {
    const rows = [mkRow({ row_id: "r1", norm: "自研接口适配", kind: "none" })]
    const mappings = [
      { customer_norm: "自研接口适配", company_product_name: "自研接口适配", product_id: "", custom_name: "自研接口适配" },
    ]
    const out = backfillFromMappings(rows, mappings, [HIS])
    expect(out[0].kind).toBe("mapping")
    expect(out[0].custom_names).toEqual(["自研接口适配"])
    expect(out[0].rule).toBe("memory")
  })

  it("4b. 记忆里公司库 pair 与自定义名并存 → 两者都恢复", () => {
    const rows = [mkRow({ row_id: "r1", norm: "门急诊挂号收费系统", kind: "none" })]
    const mappings = [
      { customer_norm: "门急诊挂号收费系统", company_product_name: "门急诊挂号收费系统", product_id: "p1" },
      { customer_norm: "门急诊挂号收费系统", company_product_name: "自研接口适配", product_id: "", custom_name: "自研接口适配" },
    ]
    const out = backfillFromMappings(rows, mappings, [HIS])
    expect(out[0].product_id).toBe("p1")
    expect(out[0].custom_names).toEqual(["自研接口适配"])
  })

  it("4c. 记忆里既解析不出产品、也没有自定义 → 保持原行不变（不产生假命中）", () => {
    const rows = [mkRow({ row_id: "r1", norm: "某个没有的东西", kind: "none" })]
    const mappings = [{ customer_norm: "某个没有的东西", company_product_name: "已删除的模块", product_id: "gone" }]
    const out = backfillFromMappings(rows, mappings, [HIS])
    expect(out[0].kind).toBe("none")
    expect(out[0].custom_names).toBeUndefined()
  })
})

describe("buildInitialRows · 起对照时恢复自定义名（回归：此前完全漏掉该分支）", () => {
  const mkInit = (mappings: { customer_norm: string; company_product_name: string; product_id: string; custom_name?: string }[]) =>
    buildInitialRows({
      norms: ["定制报表引擎"],
      products: [HIS],
      mappings,
      makeRowId: (() => {
        let n = 0
        return () => `row-${n++}`
      })(),
      labelOf: candidateLabel,
    })

  it("5. 记忆里只有 custom_name 时，起对照就直接恢复成自定义命中（不是无匹配）", () => {
    const out = mkInit([
      { customer_norm: "定制报表引擎", company_product_name: "自研报表引擎", product_id: "", custom_name: "自研报表引擎" },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe("mapping")
    expect(out[0].custom_names).toEqual(["自研报表引擎"])
    expect(rowStatus({ kind: out[0].kind, resolution: "company", suggestion: null, product: null, customNames: out[0].custom_names })).toBe("custom")
  })

  it("5b. 记忆里公司库 pair + 自定义名并存 → 两者都恢复", () => {
    const out = mkInit([
      { customer_norm: "定制报表引擎", company_product_name: "门急诊挂号收费系统", product_id: "p1" },
      { customer_norm: "定制报表引擎", company_product_name: "自研报表引擎", product_id: "", custom_name: "自研报表引擎" },
    ])
    expect(out[0].product_id).toBe("p1")
    expect(out[0].custom_names).toEqual(["自研报表引擎"])
  })

  it("5c. 无记忆时不受影响（走本地匹配/建议/无匹配原逻辑）", () => {
    const out = mkInit([])
    expect(out[0].custom_names).toBeUndefined()
    expect(out[0].kind).toBe("none")
  })
})

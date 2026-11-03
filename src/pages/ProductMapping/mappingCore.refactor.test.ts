import { describe, expect, it } from "vitest"
import type { CheckProduct } from "@/pages/SolutionStudio/checklistTypes"
import {
  buildInitialRows,
  candidateLabel,
  manualMappingWrites,
  rowProductIds,
  rowStatus,
  toCompareRows,
  type MappingCompareRow,
} from "./mappingCore"

// ---------------------------------------------------------------------------
// 2026-10-28 产品映射重构：匹配行携带「原表单元格 cells + 命中分数 score + 规则 rule」，
// 并有统一行状态口径 rowStatus（界面色块 / 筛选 / 导出共用一个真源）。
// ---------------------------------------------------------------------------

function mkProduct(p: Partial<CheckProduct> & { id: string }): CheckProduct {
  return {
    product_name: "",
    module_name: "",
    standard_name: "",
    product_belong: "",
    category: "",
    product_line: "",
    module_category: "",
    module_attr: "",
    coefficient: "",
    recommendation: "",
    price_tier: [],
    rating_tags: {},
    remark: "",
    ...p,
  } as unknown as CheckProduct
}

const LIB: CheckProduct[] = [mkProduct({ id: "p-gh", product_name: "ONE-LINK-HIS", module_name: "门急诊挂号收费系统" })]

let seq = 0
const makeRowId = () => `r${++seq}`

describe("buildInitialRows：cells / score / rule 透传", () => {
  it("本地自动命中：rule=exact、score=1、cells 保留", () => {
    const rows = buildInitialRows({
      norms: ["门急诊挂号收费系统"],
      raws: ["门急诊挂号收费系统"],
      cellsList: [["1", "门诊", "门急诊挂号收费系统"]],
      products: LIB,
      mappings: [],
      makeRowId,
      labelOf: candidateLabel,
    })
    expect(rows[0].kind).toBe("local")
    expect(rows[0].rule).toBe("exact")
    expect(rows[0].score).toBe(1)
    expect(rows[0].cells).toEqual(["1", "门诊", "门急诊挂号收费系统"])
  })

  it("记忆库命中：rule=memory、score=1", () => {
    const rows = buildInitialRows({
      norms: ["挂号收费"],
      products: LIB,
      mappings: [{ customer_norm: "挂号收费", company_product_name: "门急诊挂号收费系统", product_id: "p-gh" }],
      makeRowId,
      labelOf: candidateLabel,
    })
    expect(rows[0].kind).toBe("mapping")
    expect(rows[0].rule).toBe("memory")
    expect(rows[0].score).toBe(1)
  })

  it("无 cellsList 的行不挂 cells（粘贴/招标/方案来源兼容）", () => {
    const rows = buildInitialRows({
      norms: ["门急诊挂号收费系统"],
      products: LIB,
      mappings: [],
      makeRowId,
      labelOf: candidateLabel,
    })
    expect(rows[0].cells).toBeUndefined()
  })
})

describe("toCompareRows：cells/score/rule 继续向视图层透传", () => {
  it("命中行带分数与规则", () => {
    const rows = buildInitialRows({
      norms: ["门急诊挂号收费系统"],
      cellsList: [["a", "b"]],
      products: LIB,
      mappings: [],
      makeRowId,
      labelOf: candidateLabel,
    })
    const cmp = toCompareRows(rows, LIB)
    expect(cmp[0].cells).toEqual(["a", "b"])
    expect(cmp[0].rule).toBe("exact")
    expect(cmp[0].score).toBe(1)
    expect(cmp[0].product?.id).toBe("p-gh")
  })
})

describe("rowStatus：界面/导出统一状态口径", () => {
  const base: Pick<MappingCompareRow, "kind" | "resolution" | "suggestion" | "product"> = {
    kind: "none",
    resolution: "company",
    suggestion: null,
    product: null,
  }
  it("八态映射", () => {
    expect(rowStatus({ ...base, kind: "local", product: LIB[0] })).toBe("auto")
    expect(rowStatus({ ...base, kind: "mapping", product: LIB[0] })).toBe("memory")
    expect(rowStatus({ ...base, kind: "ai", product: LIB[0] })).toBe("ai")
    expect(rowStatus({ ...base, kind: "manual", product: LIB[0] })).toBe("manual")
    expect(rowStatus({ ...base, suggestion: { product_id: "p-gh", product_name: "", label: "x", score: 0.8, reason: "" } })).toBe("suggest")
    expect(rowStatus(base)).toBe("none")
    expect(rowStatus({ ...base, resolution: "external", product: LIB[0] })).toBe("external")
    expect(rowStatus({ ...base, resolution: "ignore" })).toBe("ignore")
  })
})

// ---------------------------------------------------------------------------
// 多对多（一对一 / 一对多 / 多对一）：product_ids 完整命中清单，首位为主干
// ---------------------------------------------------------------------------

const P_A = mkProduct({ id: "p-a", product_name: "ONE-LINK-HIS", module_name: "门急诊挂号收费系统" })
const P_B = mkProduct({ id: "p-b", product_name: "ONE-LINK-支付", module_name: "统一支付对账平台" })

describe("多对多：记忆库一对多恢复", () => {
  it("同一外部名沉淀两对 → 全部恢复，首条为主干", () => {
    const rows = buildInitialRows({
      norms: ["门诊收费"],
      products: [P_A, P_B],
      mappings: [
        { customer_norm: "门诊收费", company_product_name: "门急诊挂号收费系统", product_id: "p-a" },
        { customer_norm: "门诊收费", company_product_name: "统一支付对账平台", product_id: "p-b" },
      ],
      makeRowId,
      labelOf: candidateLabel,
    })
    expect(rows[0].kind).toBe("mapping")
    expect(rows[0].product_id).toBe("p-a")
    expect(rows[0].product_ids).toEqual(["p-a", "p-b"])
    const cmp = toCompareRows(rows, [P_A, P_B])
    expect(cmp[0].product?.id).toBe("p-a")
    expect(cmp[0].products?.map((x) => x.id)).toEqual(["p-a", "p-b"])
  })

  it("rowProductIds：product_ids 优先，缺省回落单 product_id", () => {
    expect(rowProductIds({ product_id: "p-a", product_ids: ["p-a", "p-b"] })).toEqual(["p-a", "p-b"])
    expect(rowProductIds({ product_id: "p-a" })).toEqual(["p-a"])
    expect(rowProductIds({ product_id: "" })).toEqual([])
  })
})

describe("多对多：人工确认按 pair 沉淀", () => {
  it("一对多行 → 每个命中模块各一条沉淀记录", () => {
    const writes = manualMappingWrites(
      [
        {
          row_id: "m1",
          raw: "门诊收费",
          norm: "门诊收费",
          product_name: "门急诊挂号收费系统",
          product_id: "p-a",
          product_ids: ["p-a", "p-b"],
          kind: "manual",
          resolution: "company",
        },
      ],
      [P_A, P_B],
    )
    expect(writes).toHaveLength(2)
    expect(writes.map((w) => w.productId)).toEqual(["p-a", "p-b"])
    expect(writes[0].productName).toBe("门急诊挂号收费系统")
    expect(writes[1].productName).toBe("统一支付对账平台")
  })

  it("未传 products 时主干回落 row.product_name（旧口径兼容）", () => {
    const writes = manualMappingWrites([
      {
        row_id: "m2",
        raw: "挂号",
        norm: "挂号",
        product_name: "门急诊挂号收费系统",
        product_id: "p-a",
        product_ids: ["p-a", "p-x"],
        kind: "manual",
        resolution: "company",
      },
    ])
    // p-x 无标签来源被跳过，主干保留
    expect(writes).toEqual([{ norm: "挂号", productName: "门急诊挂号收费系统", productId: "p-a" }])
  })
})

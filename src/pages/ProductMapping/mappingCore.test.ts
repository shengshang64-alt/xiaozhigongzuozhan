import { describe, expect, it } from "vitest"
import type { CheckProduct } from "@/pages/SolutionStudio/checklistTypes"
import {
  applyAiPairs,
  backfillFromMappings,
  buildInitialRows,
  candidateLabel,
  collectRowNotes,
  fieldText,
  manualMappingWrites,
  matchLocalProduct,
  parseMappingJson,
  similarity,
  toCompareRows,
} from "./mappingCore"

function mkProduct(over: Partial<CheckProduct> & { id: string }): CheckProduct {
  return {
    is_builtin: false,
    in_company: true,
    category: "智慧医疗",
    product_line: over.product_name ?? "",
    product_name: "",
    module_name: "",
    module_func: "",
    description: "",
    charge_mode: "模块授权",
    unit_price: 0,
    status: "在售",
    rating_tags: {},
    ...over,
  } as CheckProduct
}

const PRODUCTS: CheckProduct[] = [
  mkProduct({ id: "p1", product_name: "ONE-LINK-HIS", module_name: "门急诊挂号收费系统", standard_name: "业务结算与收费-门急诊挂号收费" }),
  mkProduct({ id: "p2", product_name: "ONE-LINK-EMR", module_name: "电子病历系统", standard_name: "电子病历" }),
  mkProduct({ id: "p3", product_name: "医院集成平台", module_name: "集成平台", coefficient: "门诊", module_attr: "系统建设", recommendation: "必选" }),
]

let seq = 0
const makeRowId = () => `r${++seq}`
const labelOf = candidateLabel

describe("matchLocalProduct", () => {
  it("精确/包含命中模块名", () => {
    expect(matchLocalProduct("电子病历系统", PRODUCTS)?.id).toBe("p2")
    expect(matchLocalProduct("集成平台", PRODUCTS)?.id).toBe("p3")
  })
  it("无相近条目返回 null", () => {
    expect(matchLocalProduct("完全不相关的东西啊啊", PRODUCTS)).toBeNull()
  })
})

describe("buildInitialRows", () => {
  it("映射精确命中优先于本地", () => {
    const rows = buildInitialRows({
      norms: ["电子病历"],
      products: PRODUCTS,
      mappings: [{ customer_norm: "电子病历", company_product_name: "电子病历系统", product_id: "p2" }],
      makeRowId,
      labelOf,
    })
    expect(rows[0].kind).toBe("mapping")
    expect(rows[0].product_id).toBe("p2")
  })
  it("本地模糊命中，未命中留空 none", () => {
    const rows = buildInitialRows({
      norms: ["挂号收费系统", "某某无关系统啊啊"],
      products: PRODUCTS,
      mappings: [],
      makeRowId,
      labelOf,
    })
    expect(rows[0].kind).toBe("local")
    expect(rows[0].product_id).toBe("p1")
    expect(rows[1].kind).toBe("none")
    expect(rows[1].product_id).toBe("")
  })
})

describe("applyAiPairs", () => {
  it("AI 只补未命中行：命中候选标签才落 ai，否则保持 none", () => {
    // 选一个本地不命中的客户条目（applyAiPairs 仅处理 kind==="none" 的行）
    const base = buildInitialRows({ norms: ["病历文书工作站"], products: PRODUCTS, mappings: [], makeRowId, labelOf })
    expect(base[0].kind).toBe("none")
    const out = applyAiPairs(base, [{ customer: "病历文书工作站", product: "电子病历系统" }], PRODUCTS, labelOf)
    expect(out[0].kind).toBe("ai")
    expect(out[0].product_id).toBe("p2")

    const base2 = buildInitialRows({ norms: ["无关系统"], products: PRODUCTS, mappings: [], makeRowId, labelOf })
    const out2 = applyAiPairs(base2, [{ customer: "无关系统", product: "不存在的产品" }], PRODUCTS, labelOf)
    expect(out2[0].kind).toBe("none")
  })
})

describe("backfillFromMappings", () => {
  it("AI 后仍未命中，映射库高相似回填", () => {
    const base = buildInitialRows({ norms: ["门急诊挂号收费"], products: PRODUCTS, mappings: [], makeRowId, labelOf })
    const noneRow = { ...base[0], kind: "none" as const, product_id: "", product_name: "" }
    const out = backfillFromMappings([noneRow], [{ customer_norm: "门急诊挂号收费系统", company_product_name: "ONE-LINK-HIS", product_id: "p1" }], PRODUCTS)
    expect(out[0].kind).toBe("mapping")
    expect(out[0].product_id).toBe("p1")
  })
})

describe("parseMappingJson", () => {
  it("容代码围栏，null/空 product → null，取 note", () => {
    const out = parseMappingJson(
      '这是结果:\n```json\n[{"customer":"电子病历系统","product":"电子病历","note":"含质控"},{"customer":"无关项","product":null,"note":"无对应"}]\n```',
    )
    expect(out).toHaveLength(2)
    expect(out[0].product).toBe("电子病历")
    expect(out[0].note).toBe("含质控")
    expect(out[1].product).toBeNull()
    expect(out[1].note).toBe("无对应")
  })
  it("非法 JSON / 空串返回空数组", () => {
    expect(parseMappingJson("")).toEqual([])
    expect(parseMappingJson("不是 json")).toEqual([])
  })
})

describe("collectRowNotes", () => {
  it("仅 AI 命中行且带 note 才收集", () => {
    const base = buildInitialRows({ norms: ["病历文书工作站"], products: PRODUCTS, mappings: [], makeRowId, labelOf })
    const aiRows = applyAiPairs(base, [{ customer: "病历文书工作站", product: "电子病历系统", note: "含医嘱闭环" }], PRODUCTS, labelOf)
    const notes = collectRowNotes(aiRows, [{ customer: "病历文书工作站", product: "电子病历系统", note: "含医嘱闭环" }])
    expect(notes[aiRows[0].row_id]).toBe("含医嘱闭环")
    expect(Object.keys(notes)).toHaveLength(1)
  })
})

describe("toCompareRows / manualMappingWrites / fieldText", () => {
  it("对照视图携入人工/AI 备注", () => {
    const rows = buildInitialRows({ norms: ["集成平台"], products: PRODUCTS, mappings: [], makeRowId, labelOf })
    const cmp = toCompareRows(rows, PRODUCTS, { [rows[0].row_id]: "一对多其余写备注" })
    expect(cmp[0].note).toBe("一对多其余写备注")
  })
  it("对照视图带出公司行，未命中 product 为 null", () => {
    const rows = buildInitialRows({ norms: ["集成平台", "无关系统啊啊"], products: PRODUCTS, mappings: [], makeRowId, labelOf })
    const cmp = toCompareRows(rows, PRODUCTS)
    expect(cmp[0].product?.id).toBe("p3")
    expect(cmp[1].product).toBeNull()
  })
  it("人工指定沉淀候选只取 manual+company", () => {
    const writes = manualMappingWrites([
      { row_id: "x", raw: "a", norm: "a", product_name: "集成平台", product_id: "p3", kind: "manual", resolution: "company" },
      { row_id: "y", raw: "b", norm: "b", product_name: "", product_id: "", kind: "none", resolution: "company" },
    ])
    expect(writes).toHaveLength(1)
    expect(writes[0].productId).toBe("p3")
  })
  it("fieldText 容错空值与缺字段", () => {
    expect(fieldText(null, "product_name")).toBe("")
    expect(fieldText(mkProduct({ id: "z", module_attr: "系统建设" }), "module_attr")).toBe("系统建设")
    expect(fieldText(mkProduct({ id: "z" }), "coefficient")).toBe("")
  })
})

describe("similarity / candidateLabel", () => {
  it("相同为 1，完全不同为低值", () => {
    expect(similarity("abc", "abc")).toBe(1)
    expect(similarity("", "abc")).toBe(0)
    expect(similarity("电子病历", "电子病历")).toBe(1)
  })
  it("候选标签：模块名 > 标准名 > 产品名", () => {
    expect(candidateLabel(mkProduct({ id: "z", product_name: "P", module_name: "M", standard_name: "S" }))).toBe("M")
    expect(candidateLabel(mkProduct({ id: "z", product_name: "P", standard_name: "S" }))).toBe("S")
    expect(candidateLabel(mkProduct({ id: "z", product_name: "P" }))).toBe("P")
  })
})

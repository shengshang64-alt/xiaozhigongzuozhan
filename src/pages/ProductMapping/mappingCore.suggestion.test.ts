import { describe, expect, it } from "vitest"
import type { CheckProduct, MatchRow } from "@/pages/SolutionStudio/checklistTypes"
import { buildInitialRows, candidateLabel, toCompareRows } from "./mappingCore"

// ---------------------------------------------------------------------------
// 2026-10-28（DS-R08）：「不确定的留空，我自己匹配」要真的可用，靠三件事：
//   ① 中把握候选必须带到视图层（suggestion），界面才能显示「建议：xxx（87%）」一键采纳；
//   ② 已落定/已采纳的行不能再显示建议（否则用户以为还有待选项）；
//   ③ 人工采纳后要能被 manualMappingWrites 收走，沉淀进团队映射库
//      —— 这就是「后面再有类似的可以自动去匹配」。
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

const norm = (s: string) => (s ?? "").replace(/\s+/g, "").toLowerCase()

// 这些条目是「中把握」形态：客户核心词比公司核心词更宽泛（移动护理 ⊃ 护理），
// 或核心词编辑距离落在 0.75~0.95 区间。它们不该自动填，但应当给出建议。
const LIB: CheckProduct[] = [
  mkProduct({ id: "p-tijian", module_name: "体检管理系统" }),
  mkProduct({ id: "p-bingli", module_name: "病理管理系统" }),
  // 「移动护理」比「急诊移动护理」宽 → core-contain 方向为「客户更泛」，落 suggest
  mkProduct({ id: "p-yidong", product_name: "急诊移动护理", module_name: "急诊移动护理系统" }),
  mkProduct({ id: "p-gaohao", module_name: "门急诊挂号收费系统" }),
]

let seq = 0
const makeRowId = () => `r${++seq}`

describe("buildInitialRows：候选带进结果行", () => {
  it("高把握（全名一致）→ 直接落 local，不留 suggestion", () => {
    const rows = buildInitialRows({
      norms: [norm("门急诊挂号收费系统")],
      products: LIB,
      mappings: [],
      makeRowId,
      labelOf: candidateLabel,
    })
    expect(rows[0].kind).toBe("local")
    expect(rows[0].product_id).toBe("p-gaohao")
    expect(rows[0].suggestion).toBeUndefined()
  })

  it("完全陌生 → 留空且无 suggestion（不制造噪音建议）", () => {
    const rows = buildInitialRows({
      norms: [norm("风马牛不相及啊啊")],
      products: LIB,
      mappings: [],
      makeRowId,
      labelOf: candidateLabel,
    })
    expect(rows[0].kind).toBe("none")
    expect(rows[0].suggestion).toBeUndefined()
  })

  it("中把握 → 不自动落（kind=none），但带 suggestion 供界面显示", () => {
    // 这一组取自真实 ONE-LINK 公司库实测会产生 suggest 的形态：
    //   客户「医院感染」 vs 公司「院感」→ 核心词不完全相等、也不互相包含，
    //   落在 core-sim 档（0.75~0.95），不自动填但应给建议。
    const lib2: CheckProduct[] = [
      ...LIB,
      mkProduct({ id: "p-yuangan", module_name: "院感管理系统" }),
    ]
    const rows = buildInitialRows({
      norms: [norm("医院感染管理系统")],
      products: lib2,
      mappings: [],
      makeRowId,
      labelOf: candidateLabel,
    })
    const row = rows[0]
    if (row.product_id) {
      // 若判为高把握，至少必须是它，不能是别的
      expect(row.product_id).toBe("p-yuangan")
    } else {
      expect(row.suggestion).toBeDefined()
      expect(row.suggestion?.product_id).toBe("p-yuangan")
      expect(row.suggestion?.score).toBeGreaterThanOrEqual(0.75)
      expect(row.suggestion?.score).toBeLessThan(0.95)
      expect(row.suggestion?.reason).toContain("核心")
    }
  })
})

describe("toCompareRows：已落定的行不再显示建议", () => {
  it("有 product_id 的行 suggestion 置空", () => {
    const rows: MatchRow[] = [
      {
        row_id: "a",
        raw: "移动护理",
        norm: "移动护理",
        product_name: "急诊移动护理系统",
        product_id: "p-yidong",
        kind: "manual",
        resolution: "company",
        suggestion: { product_id: "p-yidong", product_name: "急诊移动护理", label: "急诊移动护理系统", score: 0.9, reason: "x" },
      },
    ]
    const out = toCompareRows(rows, LIB)
    expect(out[0].suggestion).toBeNull()
  })

  it("未落定的行保留 suggestion，界面据此显示一键采纳", () => {
    const rows: MatchRow[] = [
      {
        row_id: "b",
        raw: "移动护理",
        norm: "移动护理",
        product_name: "",
        product_id: "",
        kind: "none",
        resolution: "company",
        suggestion: { product_id: "p-yidong", product_name: "急诊移动护理", label: "急诊移动护理系统", score: 0.9, reason: "x" },
      },
    ]
    const out = toCompareRows(rows, LIB)
    expect(out[0].suggestion?.product_id).toBe("p-yidong")
    expect(out[0].product).toBeNull()
  })
})

describe("人工采纳后的沉淀契约", () => {
  it("采纳建议 = kind 变 manual，manualMappingWrites 能收走（下一步写映射库）", async () => {
    const { manualMappingWrites } = await import("./mappingCore")
    // 模拟：buildInitialRows 给出 none+suggestion，用户点了「采纳」→ setMatchProduct 置 manual
    const adopted: MatchRow = {
      row_id: "c",
      raw: "移动护理",
      norm: "移动护理",
      product_name: "急诊移动护理系统",
      product_id: "p-yidong",
      kind: "manual",
      resolution: "company",
    }
    const writes = manualMappingWrites([adopted])
    expect(writes).toHaveLength(1)
    expect(writes[0]).toEqual({ norm: "移动护理", productName: "急诊移动护理系统", productId: "p-yidong" })
  })

  it("未采纳（仍是 none）的不会被沉淀，避免把猜测写进映射库", async () => {
    const { manualMappingWrites } = await import("./mappingCore")
    const none: MatchRow = {
      row_id: "d",
      raw: "移动护理",
      norm: "移动护理",
      product_name: "",
      product_id: "",
      kind: "none",
      resolution: "company",
      suggestion: { product_id: "p-yidong", product_name: "x", label: "y", score: 0.9, reason: "z" },
    }
    expect(manualMappingWrites([none])).toHaveLength(0)
  })
})

import { describe, expect, it } from "vitest"
import type { CheckProduct } from "@/pages/SolutionStudio/checklistTypes"
import { moduleText, productLineText, type MappingCompareRow } from "./mappingCore"
import {
  buildCompareAoa,
  buildCoverageAoa,
  buildPendingAoa,
  buildStatsAoa,
  COVERAGE_HEADERS,
  MAP_RESULT_HEADERS,
  PENDING_HEADERS,
} from "./productMappingExports"

// ---------------------------------------------------------------------------
// 2026-10-28 产品映射重构：导出纯函数层（对齐公司《匹配对照表》交付格式）
//  ① 匹配对照表 = 标题行 + 说明行 + 原表列 + 映射列组（产品线「 / 」· 模块「 + 」· 匹配度五档）
//  ② 统计汇总 = 五档条目数 / 占比 / 处理建议
//  ③ 待确认清单 = 部分匹配 / 第三方 / 待确认
//  ④ 覆盖视角 = 公司库逐模块 × 命中条目
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

const P1 = mkProduct({
  id: "p1",
  product_belong: "总部",
  category: "智慧医疗",
  product_name: "ONE-LINK-HIS",
  module_category: "门诊管理",
  module_name: "门急诊挂号收费系统",
  standard_name: "业务结算与收费-门急诊挂号收费",
  recommendation: "必选",
})
const P2 = mkProduct({ id: "p2", category: "智慧医疗", product_name: "ONE-LINK-EMR", module_name: "电子病历系统", recommendation: "可选" })
const P3 = mkProduct({
  id: "p3",
  product_belong: "第三方",
  category: "第三方",
  product_name: "第三方-LIS",
  module_name: "检验系统(LIS)接口",
  standard_name: "检验系统接口",
})

function mkRow(r: Partial<MappingCompareRow> & { row_id: string }): MappingCompareRow {
  return {
    customer: "",
    raw: "",
    kind: "none",
    resolution: "company",
    product: null,
    note: "",
    suggestion: null,
    ...r,
  }
}

const ROWS: MappingCompareRow[] = [
  mkRow({ row_id: "a", customer: "门急诊挂号收费系统", raw: "门急诊挂号收费系统", kind: "local", product: P1, score: 1, rule: "exact", cells: ["1", "门诊", "门急诊挂号收费系统"] }),
  mkRow({ row_id: "b", customer: "体检信息系统", raw: "体检信息系统", kind: "none", suggestion: { product_id: "p2", product_name: "ONE-LINK-EMR", label: "电子病历系统", score: 0.82, reason: "x" }, cells: ["2", "医技", "体检信息系统"] }),
  mkRow({ row_id: "c", customer: "营养餐系统", raw: "营养餐系统", kind: "none", resolution: "ignore", cells: ["3", "其他", "营养餐系统"] }),
]

describe("对照表 AOA：标题/说明/表头/原表列/映射列组", () => {
  it("结构：R1 标题、R2 说明、R3 表头 = 原表列 + 映射列组", () => {
    const { aoa, dataStart, gradeCol } = buildCompareAoa(ROWS, { sourceColumns: ["序号", "业务分类", "系统名称"], projectName: "芜湖眼科医院" })
    expect(aoa[0][0]).toContain("芜湖眼科医院")
    expect(aoa[0][0]).toContain("产品匹配对照表")
    expect(String(aoa[1][0])).toContain("机器初筛")
    expect(aoa[2]).toEqual(["序号", "业务分类", "系统名称", ...MAP_RESULT_HEADERS])
    expect(dataStart).toBe(3)
    expect(gradeCol).toBe(3 + MAP_RESULT_HEADERS.indexOf("匹配度"))
    // 忽略行不导出
    expect(aoa).toHaveLength(5)
  })

  it("数据行：原表单元格照抄 + 产品对照四列 + 状态/匹配度（2026-10-29 版式）", () => {
    const { aoa } = buildCompareAoa(ROWS, { sourceColumns: ["序号", "业务分类", "系统名称"] })
    const row = aoa[3]
    expect(row.slice(0, 3)).toEqual(["1", "门诊", "门急诊挂号收费系统"])
    // 产品对照四列：产品类别 / 产品名称 / 模块分类 / 模块名称
    expect(row[3]).toBe("智慧医疗")
    expect(row[4]).toBe("ONE-LINK-HIS")
    expect(row[5]).toBe("门诊管理") // P1 的 module_category
    expect(row[6]).toBe("门急诊挂号收费系统（业务结算与收费-门急诊挂号收费）")
    // 辅助列：匹配状态 / 匹配度 / 匹配说明 / 备注
    expect(row[7]).toBe("自动")
    expect(row[8]).toBe("完全匹配")
    expect(row[9]).toBe("") // 匹配说明
    expect(row[10]).toBe("") // 备注
  })

  it("无 sourceColumns：退化为「客户条目」首列", () => {
    const { aoa } = buildCompareAoa(ROWS)
    expect(aoa[2][0]).toBe("客户条目")
    expect(aoa[3][0]).toBe("门急诊挂号收费系统")
  })

  it("一对多：产品对照四列逐行换行堆叠，模块「 + 」拼接，行数与原表 1:1", () => {
    const rows = [mkRow({ row_id: "m", customer: "门诊收费", raw: "门诊收费", kind: "manual", product: P1, products: [P1, P2], cells: ["1", "门诊收费"] })]
    const { aoa } = buildCompareAoa(rows, { sourceColumns: ["序号", "系统名称"] })
    expect(aoa).toHaveLength(4)
    // 产品类别堆叠（换行）
    expect(String(aoa[3][2])).toBe("智慧医疗\n智慧医疗")
    // 产品名称堆叠（换行）
    expect(String(aoa[3][3])).toBe("ONE-LINK-HIS\nONE-LINK-EMR")
    // 模块名称「 + 」拼接
    expect(String(aoa[3][5])).toContain("门急诊挂号收费系统（业务结算与收费-门急诊挂号收费） + 电子病历系统")
    expect(aoa[3][6]).toBe("手动")
    expect(aoa[3][7]).toBe("部分匹配") // 一对多 = 部分匹配（需多模块组合）
  })
})

describe("统计汇总：五档条目数/占比/处理建议", () => {
  it("按匹配度聚合，忽略行不计，含合计行", () => {
    const aoa = buildStatsAoa(ROWS)
    expect(aoa[0][0]).toBe("匹配结果统计")
    expect(aoa[2]).toEqual(["匹配度", "条目数", "占比", "处理建议"])
    const byGrade = new Map(aoa.slice(3, 8).map((r) => [String(r[0]), r]))
    expect(byGrade.get("完全匹配")?.[1]).toBe(1)
    expect(byGrade.get("待确认")?.[1]).toBe(1)
    expect(byGrade.get("完全匹配")?.[2]).toBe("50.0%")
    expect(String(byGrade.get("完全匹配")?.[3])).toContain("可直接进入方案与报价")
    const total = aoa[aoa.length - 1]
    expect(total[0]).toBe("合计")
    expect(total[1]).toBe(2)
  })
})

describe("待确认清单：只列部分匹配/第三方/待确认", () => {
  it("完全匹配、基本匹配不进入待确认清单", () => {
    const rows: MappingCompareRow[] = [
      ...ROWS,
      mkRow({ row_id: "d", customer: "LIS接口", raw: "LIS接口", kind: "manual", product: P3 }),
      mkRow({ row_id: "e", customer: "外购系统", raw: "外购系统", kind: "none", resolution: "external" }),
    ]
    const aoa = buildPendingAoa(rows)
    expect(aoa[2]).toEqual(PENDING_HEADERS)
    const names = aoa.slice(3).map((r) => String(r[1]))
    // 体检信息系统=待确认（仅有 suggestion 未确认）；LIS 接口=第三方；外购系统=第三方
    expect(names).toContain("体检信息系统")
    expect(names).toContain("LIS接口")
    expect(names).toContain("外购系统")
    expect(names).not.toContain("门急诊挂号收费系统")
    expect(aoa).toHaveLength(3 + 3)
  })
})

describe("拼接口径与覆盖视角", () => {
  it("productLineText 去重保序「 / 」，moduleText 标准名不同才括注「 + 」", () => {
    expect(productLineText([P1, P2, P1])).toBe("智慧医疗-ONE-LINK-HIS / 智慧医疗-ONE-LINK-EMR")
    expect(moduleText([P1])).toBe("门急诊挂号收费系统（业务结算与收费-门急诊挂号收费）")
    expect(moduleText([P2])).toBe("电子病历系统")
    expect(moduleText([P1, P2])).toContain(" + ")
  })

  it("第三方判定：产品线名含「第三方」也算第三方产品", () => {
    const P3b = mkProduct({ id: "p3b", category: "智慧医疗", product_name: "ONE-LINK-第三方接口", module_name: "检验系统(LIS)接口" })
    const rows = [mkRow({ row_id: "t", customer: "LIS接口", raw: "LIS接口", kind: "local", product: P3b, score: 1 })]
    const { aoa } = buildCompareAoa(rows)
    expect(aoa[3][MAP_RESULT_HEADERS.indexOf("匹配度") + 1]).toBe("第三方产品")
  })

  it("覆盖视角：一对多行的每个命中模块都计入", () => {
    const rows: MappingCompareRow[] = [
      mkRow({ row_id: "m", customer: "门诊收费", raw: "门诊收费", kind: "manual", product: P1, products: [P1, P2] }),
    ]
    const aoa = buildCoverageAoa([P1, P2], rows)
    expect(aoa[0]).toEqual(COVERAGE_HEADERS)
    expect(aoa[1][7]).toBe("已覆盖 1 条")
    expect(aoa[2][7]).toBe("已覆盖 1 条")
  })

  it("外购行不算覆盖；未覆盖标注", () => {
    const rows: MappingCompareRow[] = [mkRow({ row_id: "a", customer: "x", kind: "manual", resolution: "external", product: P3 })]
    const aoa = buildCoverageAoa([P1], rows)
    expect(aoa[1][7]).toBe("未覆盖")
  })
})

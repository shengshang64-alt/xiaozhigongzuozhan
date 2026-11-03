import { describe, expect, it } from "vitest"
import type { CheckProduct } from "@/pages/SolutionStudio/checklistTypes"
import {
  AUTO_FILL_MIN,
  SUGGEST_MIN,
  scoreProductMatch,
  semanticCore,
  similarity,
} from "./mappingCore"

// ---------------------------------------------------------------------------
// 2026-10-28 产品对照改造（用户要求：「不确定的留空，我自己匹配」）
//
// 旧实现的问题（真实 ONE-LINK 公司库 549 行实测取证）：
//   只用编辑距离（阈值 0.6）+「包含即 0.9」，对中文语义无效——
//     「体检信息管理系统」→ 病理管理系统  0.75（共享「信息管理系统」，语义无关）
//     「移动护理信息系统」→ 超声管理系统  0.625
//     「医保结算清单管理系统」→ 医保对账管理系统 0.60
//   而正确答案「电子病历系统（EMR）」→ 电子病历系统对接 只有 0.545，反被判未命中。
//
// 新口径：先剥通用后缀得到语义核心词，再比核心词；分三档 auto/suggest/none，
// 只有 ≥0.95 才自动填，0.75~0.95 给候选，其余留空。
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

describe("semanticCore：剥离通用后缀取语义核心词", () => {
  it("剥掉「信息管理系统」这类无区分度后缀", () => {
    expect(semanticCore("体检信息管理系统")).toBe("体检")
    expect(semanticCore("移动护理信息系统")).toBe("移动护理")
    expect(semanticCore("输血管理系统")).toBe("输血")
    expect(semanticCore("门急诊挂号收费系统")).toBe("门急诊挂号收费")
  })

  it("括号里的英文缩写不计入中文核心词", () => {
    expect(semanticCore("电子病历系统（EMR）")).toBe("电子病历")
    expect(semanticCore("临床信息系统(CIS)")).toBe("临床")
  })

  it("核心词已是最短形态时保持不变，不会剥成空串", () => {
    expect(semanticCore("系统")).toBe("系统")
    expect(semanticCore("")).toBe("")
  })
})

describe("scoreProductMatch：不再把语义无关的条目硬配上", () => {
  // 真实公司库里存在这三条，旧实现在它们之间产生了错配
  const LIB: CheckProduct[] = [
    mkProduct({ id: "p-tijian", module_name: "体检管理系统", standard_name: "体检管理系统" }),
    mkProduct({ id: "p-bingli", module_name: "病理管理系统", standard_name: "病理信息管理系统" }),
    mkProduct({ id: "p-chaosheng", module_name: "超声管理系统", standard_name: "超声管理信息系统" }),
    mkProduct({ id: "p-gaizhang", module_name: "医保对账管理系统" }),
    mkProduct({ id: "p-guahao", module_name: "门急诊挂号收费系统", standard_name: "业务结算与收费-门急诊挂号收费" }),
    mkProduct({ id: "p-emr", module_name: "门诊电子病历系统", standard_name: "门急诊电子病历系统" }),
  ]

  it("「体检信息管理系统」命中体检，绝不落到病理/超声（旧实现错配的实证）", () => {
    const m = scoreProductMatch(norm("体检信息管理系统"), LIB)
    expect(m?.product.id).toBe("p-tijian")
    expect(m?.confidence).toBe("auto")
  })

  it("「医保结算清单管理系统」不与「医保对账管理系统」硬配（旧实现给 0.60 就认了）", () => {
    const m = scoreProductMatch(norm("医保结算清单管理系统"), LIB)
    // 要么留空，要么最多是候选，绝不能自动填
    if (m) expect(m.confidence).not.toBe("auto")
  })

  it("「输血管理系统」这种库里没有的，不命中「体检/病理/超声」任一（避免乱配）", () => {
    const m = scoreProductMatch(norm("输血管理系统"), LIB)
    if (m) {
      expect(["p-tijian", "p-bingli", "p-chaosheng"]).not.toContain(m.product.id)
    }
  })

  it("客户核心词完整落在公司核心词里 → 高把握自动填（挂号收费 ⊂ 门急诊挂号收费）", () => {
    const m = scoreProductMatch(norm("挂号收费系统"), LIB)
    expect(m?.product.id).toBe("p-guahao")
    expect(m?.confidence).toBe("auto")
  })

  it("全名完全一致 → 最高把握", () => {
    const m = scoreProductMatch(norm("门急诊挂号收费系统"), LIB)
    expect(m?.product.id).toBe("p-guahao")
    expect(m?.score).toBe(1)
    expect(m?.confidence).toBe("auto")
  })
})

describe("scoreProductMatch：产品线名不当匹配字段（张冠李戴修复）", () => {
  // 真实库形态：「急诊移动护理」是一条产品线，底下挂 病人管理/输液管理/文书管理 等模块。
  // 旧实现拿 product_name 去匹配，命中后展示的是「该产品线第一个模块」= 病人管理，属张冠李戴。
  const LIB: CheckProduct[] = [
    mkProduct({ id: "p-bingren", product_name: "急诊移动护理", module_name: "病人管理", standard_name: "病人管理" }),
    mkProduct({ id: "p-shuye", product_name: "急诊移动护理", module_name: "输液管理", standard_name: "输液管理" }),
    mkProduct({ id: "p-jiekou", product_name: "ONE-LINK-第三方接口", module_name: "住院移动护理接口", standard_name: "住院移动护理接口" }),
  ]

  it("「移动护理信息系统」不会因为产品线叫「急诊移动护理」就配到「病人管理」", () => {
    const m = scoreProductMatch(norm("移动护理信息系统"), LIB)
    expect(m?.product.id).not.toBe("p-bingren")
    expect(m?.product.id).not.toBe("p-shuye")
  })

  it("优先命中的是真正的模块/标准名（住院移动护理接口）", () => {
    const m = scoreProductMatch(norm("移动护理信息系统"), LIB)
    expect(m?.field).not.toBe("product_name")
  })

  it("模块名与标准名都为空时，才允许回落到产品线名", () => {
    const onlyLine: CheckProduct[] = [
      mkProduct({ id: "p-only", product_name: "移动护理系统", module_name: "", standard_name: "" }),
    ]
    const m = scoreProductMatch(norm("移动护理系统"), onlyLine)
    expect(m?.product.id).toBe("p-only")
    expect(m?.field).toBe("product_name")
  })
})

describe("三档把握度阈值契约", () => {
  it("自动填门槛 0.95、候选门槛 0.75，且自动必然在候选之上", () => {
    expect(AUTO_FILL_MIN).toBe(0.95)
    expect(SUGGEST_MIN).toBe(0.75)
    expect(AUTO_FILL_MIN).toBeGreaterThan(SUGGEST_MIN)
  })

  it("低于候选门槛的一律 none，不返回可落结果", () => {
    const LIB = [mkProduct({ id: "x", module_name: "完全不同的模块" })]
    const m = scoreProductMatch(norm("风马牛不相及啊啊"), LIB)
    expect(m).toBeNull()
  })
})

describe("similarity 仍保留供其他模块使用", () => {
  it("相同为 1，完全不同为低值", () => {
    expect(similarity("abc", "abc")).toBe(1)
    expect(similarity("abc", "xyz")).toBeLessThan(0.5)
  })
})

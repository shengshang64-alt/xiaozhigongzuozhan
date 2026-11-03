// R253 / Slice1（R-026）评分项结构化存储 场景自测
// 模拟一次三甲医院技术评分表整文 JSON 解析结果，验证：结构化抽取/声明总分解析/
// schema 自检/numberScoringItems 结构化优先 + 老文本回退/reportNeedsReparse 老数据标记。
import { describe, expect, it } from "vitest"
import {
  buildScoringStructured,
  parseDeclaredTotal,
  parseScoreWeights,
  scoringItemsFromStructured,
  selfCheckScoringTotal,
} from "./parseSchemas"
import {
  numberScoringItems,
  reportNeedsReparse,
  validateScoringSections,
  type ParseReport,
  type ParseSection,
} from "./bidTypes"

describe("R-026 评分项 JSON 结构化存储（R253）", () => {
  // 整文通道真实输出形态（tech_score JSON 契约），含一条名称「没有提及」应被丢弃
  const rawTech = {
    score_composition: "总分 100 分（技术 60 分、商务 40 分）",
    items: [
      { name: "总体方案设计", score: "30", criteria: "优：25-30分；良：18-24分", source: "第三章评标办法" },
      { name: "实施及运维", score: 30, criteria: "覆盖完整得满分", source: "第三章" },
      { name: "没有提及", score: 5, criteria: "x", source: "" },
    ],
  }

  it("parseDeclaredTotal 只认原文声明总分", () => {
    expect(parseDeclaredTotal("总分 100 分（技术 60 分、商务 40 分）")).toBe(100)
    expect(parseDeclaredTotal("总分：120 分")).toBe(120)
    expect(parseDeclaredTotal("没有提及")).toBeNull()
  })

  it("buildScoringStructured 抽 items + 声明总分，丢弃缺名项；非评分项/空 items 返回 undefined", () => {
    const b = buildScoringStructured("tech_score", rawTech)
    expect(b).toBeDefined()
    expect(b!.kind).toBe("scoring")
    expect(b!.declared_total).toBe(100)
    expect(b!.items).toHaveLength(2)
    expect(b!.items[0]).toMatchObject({ name: "总体方案设计", score: 30 })
    expect(buildScoringStructured("overview", rawTech)).toBeUndefined()
    expect(buildScoringStructured("tech_score", { items: [] })).toBeUndefined()
  })

  it("scoringItemsFromStructured 合并出处，口径对齐行文本", () => {
    const items = scoringItemsFromStructured(buildScoringStructured("tech_score", rawTech)!)
    expect(items[0].criteria).toContain("（出处：第三章评标办法）")
  })

  it("selfCheckScoringTotal：合计 60 ≠ 声明 100 报警；一致返回 null", () => {
    const b = buildScoringStructured("tech_score", rawTech)!
    expect(selfCheckScoringTotal(b)).toContain("≠")
    const ok = buildScoringStructured("tech_score", {
      score_composition: "总分 60 分",
      items: [
        { name: "A", score: "30", criteria: "x", source: "" },
        { name: "B", score: "30", criteria: "y", source: "" },
      ],
    })!
    expect(selfCheckScoringTotal(ok)).toBeNull()
  })

  it("分区口径：技术 90 + 价格 10 = 总分 100 不再误报（2026-10-22 真实项目实测）", () => {
    const comp = "本项目综合评分满分为 100 分，其中：技术资信分值占总分值的权重为 90%，价格分值占总分值的权重为 10%。"
    const tech = buildScoringStructured("tech_score", {
      score_composition: "总分 100 分（技术资信 90 分、价格 10 分）",
      items: [
        { name: "总体技术解决方案", score: "45", criteria: "", source: "" },
        { name: "实施与服务", score: "45", criteria: "", source: "" },
      ],
    })!
    // 商务分区在真实项目里常把全局那句总分构成抄进来，只有价格分一条
    const biz = buildScoringStructured("biz_score", {
      score_composition: comp,
      items: [{ name: "价格分", score: "10", criteria: "", source: "" }],
    })!
    expect(selfCheckScoringTotal(tech, "tech_score")).toBeNull()
    expect(selfCheckScoringTotal(biz, "biz_score")).toBeNull()
    // 同一份数据不传 key（旧口径）仍按总分比 → 会误报；这正是本次要修的地方
    expect(selfCheckScoringTotal(tech)).toContain("≠")
  })

  it("numberScoringItems 结构化优先、文本回退；reportNeedsReparse 标记缺结构的老数据", () => {
    const b = buildScoringStructured("tech_score", {
      score_composition: "总分 30 分",
      items: [{ name: "结构化项甲", score: "30", criteria: "标准", source: "第五章" }],
    })!
    const structuredReport: ParseReport = {
      scope: "full",
      sections: [
        { key: "tech_score", title: "技术评分要求", content: "旧文本项（10 分）：应被忽略", structured: b },
      ],
    }
    const items = numberScoringItems(structuredReport)
    expect(items[0].item).toBe("结构化项甲") // 读结构化，不读旧行文本
    expect(items[0].id).toBe("R1")
    expect(reportNeedsReparse(structuredReport.sections)).toBe(false)

    // 老数据（有评分文本、无 structured）：标记需重解析 + numberScoringItems 回退行文本
    const legacySections: ParseSection[] = [
      { key: "tech_score", title: "技术评分要求", content: "旧文本项（10 分）：标准" },
    ]
    expect(reportNeedsReparse(legacySections)).toBe(true)
    expect(numberScoringItems({ scope: "full", sections: legacySections })[0].item).toBe("旧文本项")
  })
})

// ---------------------------------------------------------------------------
// 2026-10-22（用户口径：先绘「得分地图」）
//   ① 总分构成原句要拆出技术/商务/价格权重，用于判断「胜负在哪」；
//   ② 解析后的声明总分**不得**被条目合计覆写——原文写多少就是多少，
//      否则用户看不到招标文件真实口径（旧逻辑把 100 改成 60，还改写了原句）。
// 反向验证（删实现即变红）：
//   · 删掉 parseScoreWeights 的商务/价格分支 → 用例①红；
//   · 把 validateScoringSections 里 `st.declared_total = actualSum` 加回去 → 用例②红。
// ---------------------------------------------------------------------------
describe("得分地图：权重拆分 + 声明总分保真（2026-10-22）", () => {
  it("① parseScoreWeights 只认原文明写的技术/商务/价格数字", () => {
    expect(parseScoreWeights("总分 100 分（技术 90 分、商务 0 分、价格 10 分）")).toEqual({
      tech: 90,
      biz: 0,
      price: 10,
      percent: false,
    })
    expect(parseScoreWeights("技术资信分 90 分，价格分 10 分")).toMatchObject({ tech: 90, price: 10, percent: false })
    expect(parseScoreWeights("技术 90%、价格 10%")).toEqual({ tech: 90, biz: null, price: 10, percent: true })
    // 只有总分、没有分项权重 → 不是权重块，返回 null（不臆造）
    expect(parseScoreWeights("总分 100 分")).toBeNull()
    expect(parseScoreWeights("没有提及")).toBeNull()
    expect(parseScoreWeights("")).toBeNull()
  })

  it("② validateScoringSections 保留声明总分，不被条目合计覆写", () => {
    const b = buildScoringStructured("tech_score", {
      score_composition: "总分 100 分（技术 90 分、价格 10 分）",
      items: [{ name: "总体方案", score: "60", criteria: "x", source: "第三章" }],
    })!
    const report: ParseReport = { scope: "full", sections: [{ key: "tech_score", title: "技术评分要求", content: "", structured: b }] }
    const r = validateScoringSections(report)
    // 声明值保真
    const st = report.sections[0].structured as { declared_total: number | null; score_composition: string }
    expect(st.declared_total).toBe(100)
    expect(st.score_composition).toContain("100 分")
    // 重算值单独记录，并给出告警（两张口径并列，而不是悄悄改掉一张）
    expect(r.sectionSums.tech_score).toBe(60)
    expect(r.mismatchWarnings[0]).toContain("60")
    // 2026-10-22 起按分区口径比：技术分区对「技术 90 分」，不再拿 90 去比全局 100
    expect(r.mismatchWarnings[0]).toContain("技术分区声明分 90")
  })
})

// ---------------------------------------------------------------------------
// 2026-10-22（用户反馈：采购清单解析要按表格体现）
// 落库行文本 → 表格：列按招标原表（序号/名称/规格型号/数量/单位/备注），全空列自动隐藏。
// ---------------------------------------------------------------------------
import { buildPurchaseListRows } from "./parseSchemas"

describe("采购清单按表格呈现（2026-10-22）", () => {
  it("① 名称/数量/备注 三列 → 序号自动补、数量与单位拆开、规格型号空列隐藏", () => {
    const t = buildPurchaseListRows([
      "名称：患者主索引｜数量：1套｜备注：经营要素平台",
      "名称：组织和人员主索引｜数量：1套｜备注：经营要素平台",
    ])
    expect(t).not.toBeNull()
    expect(t!.columns).toEqual(["序号", "名称", "数量", "单位", "备注"])
    expect(t!.rows[0]).toEqual(["1", "患者主索引", "1", "套", "经营要素平台"])
    expect(t!.rows[1][0]).toBe("2")
  })

  it("② 有规格型号时保留该列", () => {
    const t = buildPurchaseListRows([
      "名称：A 平台｜规格型号：支持 5000 并发｜数量：2 套｜备注：含三年质保",
      "名称：B 平台｜规格型号：国产数据库｜数量：1 套｜备注：",
    ])
    expect(t!.columns).toEqual(["序号", "名称", "规格型号/关键参数", "数量", "单位", "备注"])
    expect(t!.rows[0][2]).toBe("支持 5000 并发")
  })

  it("③ 不足两行有效数据 → null（交回普通行渲染，不硬套表格）", () => {
    expect(buildPurchaseListRows(["名称：只有一行｜数量：1套"])).toBeNull()
    expect(buildPurchaseListRows([])).toBeNull()
    expect(buildPurchaseListRows(["没有冒号的行", "也没有冒号"])).toBeNull()
  })
})

// R253 / Slice1（R-026）评分项结构化存储 场景自测
// 模拟一次三甲医院技术评分表整文 JSON 解析结果，验证：结构化抽取/声明总分解析/
// schema 自检/numberScoringItems 结构化优先 + 老文本回退/reportNeedsReparse 老数据标记。
import { describe, expect, it } from "vitest"
import {
  buildScoringStructured,
  parseDeclaredTotal,
  scoringItemsFromStructured,
  selfCheckScoringTotal,
} from "./parseSchemas"
import { numberScoringItems, reportNeedsReparse, type ParseReport, type ParseSection } from "./bidTypes"

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

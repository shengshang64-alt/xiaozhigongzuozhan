import { describe, expect, it } from "vitest"
import { estimateScores, buildCompareTakeaways, CAPABILITY_DIMS } from "./competitorScores"
import type { CompetitorRow } from "./competitorsCore"

function row(patch: Partial<CompetitorRow>): CompetitorRow {
  return {
    id: "r1",
    name: "测试竞品",
    software_copyrights: 300,
    positioning: "",
    products: "",
    strengths: "",
    weaknesses: "",
    summary: "",
    ai_evolution: "",
    xinchuang: "",
    certifications: "",
    customer_profile: "",
    regions: "",
    ...patch,
  } as CompetitorRow
}

describe("estimateScores · 启发式去饱和（R63/F20）", () => {
  it("短英文关键词按词边界匹配：maintenance 不再误命中 ai", () => {
    const r = row({ id: "t", software_copyrights: 10, summary: "系统维护 maintenance 服务保障能力" })
    const filler = row({ id: "f", software_copyrights: 5000 })
    const scores = estimateScores(r, [r, filler])
    const aiIdx = CAPABILITY_DIMS.indexOf("CDSS/AI")
    expect(scores[aiIdx]).toBe(2) // 无真实 AI 命中 → 基线（软著规模低于中位数无加成）
  })

  it("命中密度分级：单命中 3 分、全命中 5 分，不再 3 命中即满分", () => {
    const filler = row({ id: "f", software_copyrights: 5000 })
    const one = row({ id: "t1", software_copyrights: 10, summary: "布局大模型能力" })
    const s1 = estimateScores(one, [one, filler])
    const aiIdx = CAPABILITY_DIMS.indexOf("CDSS/AI")
    expect(s1[aiIdx]).toBe(3)
    const full = row({ id: "t2", software_copyrights: 10, summary: "cdss 临床决策 人工智能 大模型 ai 智能 知识库 全线布局" })
    const s2 = estimateScores(full, [full, filler])
    expect(s2[aiIdx]).toBe(5)
  })

  it("不同档案在同维度产生不同分（区分度）", () => {
    const a = row({ id: "a", summary: "大模型" })
    const b = row({
      id: "b",
      summary: "cdss 临床决策 人工智能 大模型 ai 智能 知识库",
      software_copyrights: 2000,
    })
    const scores = finalOfBoth(a, b)
    expect(scores[0][CAPABILITY_DIMS.indexOf("CDSS/AI")]).toBeLessThan(scores[1][CAPABILITY_DIMS.indexOf("CDSS/AI")])
  })

  it("价格竞争力维度行为不变：规模为零给中性 3，规模最大得分最低", () => {
    const small = row({ id: "s", software_copyrights: 0 })
    const big = row({ id: "b", software_copyrights: 5000 })
    const priceIdx = CAPABILITY_DIMS.length - 1
    expect(estimateScores(small, [small, big])[priceIdx]).toBe(3)
    expect(estimateScores(big, [small, big])[priceIdx]).toBeLessThan(3)
  })
})

function finalOfBoth(a: CompetitorRow, b: CompetitorRow): number[][] {
  return [estimateScores(a, [a, b]), estimateScores(b, [a, b])]
}


describe("buildCompareTakeaways · 对比重点速览（R71/F24）", () => {
  const mk = (name: string, scores: number[], copyrights: number, positioning: string) => ({ name, scores, copyrights, positioning })
  const self = mk("智业软件", [4, 3, 3, 4, 4, 4], 340, "区域型 HIS 厂商")
  const strong = mk("东软集团", [5, 5, 4, 3, 4, 2], 2860, "老牌全域 HIT 厂商，覆盖全国")
  const weak = mk("某小厂", [2, 2, 2, 2, 2, 5], 20, "本地化小团队")

  it("产出 领先/差距/头号威胁 三类结论", () => {
    const out = buildCompareTakeaways([self, strong, weak])
    expect(out.some((t) => t.kind === "gap" && t.text.includes("集成平台"))).toBe(true)
    expect(out.some((t) => t.kind === "threat" && t.text.includes("东软集团"))).toBe(true)
    expect(out.some((t) => t.kind === "lead")).toBe(true)
  })

  it("我方全维领先时无差距条目", () => {
    const best = mk("智业软件", [5, 5, 5, 5, 5, 5], 340, "")
    const out = buildCompareTakeaways([best, weak])
    expect(out.some((t) => t.kind === "gap")).toBe(false)
    expect(out.some((t) => t.kind === "lead")).toBe(true)
  })

  it("只有我方时返回空", () => {
    expect(buildCompareTakeaways([self])).toEqual([])
  })
})

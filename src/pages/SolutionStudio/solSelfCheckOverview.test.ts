import { describe, expect, it } from "vitest"
import { buildSelfCheckBriefText, buildSelfCheckOverview } from "./solSelfCheckOverview"
import { verdictFromTotal, type Chapter, type ChapterReviewScores, type ChapterSelfCheck } from "./solutionTypes"

function sc(total: number, scores: Partial<ChapterReviewScores>, issues: { dim: string; problem: string }[] = []): ChapterSelfCheck {
  const full: ChapterReviewScores = { coverage: 0, logic: 0, evidence: 0, feasibility: 0, writing: 0, ...scores }
  return {
    scores: full,
    total,
    verdict: verdictFromTotal(total),
    issues: issues.map((i) => ({ dim: i.dim, problem: i.problem, suggestion: "" })),
    checked_at: "2026-10-12T00:00:00.000Z",
  }
}

function ch(nodeId: string, title: string, content: string, selfCheck?: ChapterSelfCheck): Chapter {
  return { node_id: nodeId, title, sections: [], content, gen_status: "done", selfCheck }
}

describe("buildSelfCheckOverview", () => {
  it("空章节数组给出全零总览", () => {
    const ov = buildSelfCheckOverview([])
    expect(ov.totalChapters).toBe(0)
    expect(ov.bodyChapters).toBe(0)
    expect(ov.reviewedCount).toBe(0)
    expect(ov.avgTotal).toBe(0)
    expect(ov.weakestDim).toBeNull()
    expect(ov.reviewedRatio).toBe(0)
  })

  it("无正文的章计入 totalChapters 但不进自检候选池", () => {
    const ov = buildSelfCheckOverview([ch("a", "A", ""), ch("b", "B", "   ")])
    expect(ov.totalChapters).toBe(2)
    expect(ov.bodyChapters).toBe(0)
    expect(ov.pendingCount).toBe(0)
  })

  it("有正文未自检算 pendingCount", () => {
    const ov = buildSelfCheckOverview([ch("a", "A", "正文内容")])
    expect(ov.bodyChapters).toBe(1)
    expect(ov.reviewedCount).toBe(0)
    expect(ov.pendingCount).toBe(1)
    expect(ov.reviewedRatio).toBe(0)
  })

  it("混合结论：均分/分布/短板/待重写按规则重算", () => {
    const chapters = [
      ch("d", "直采章", "x", sc(90, { coverage: 18, logic: 18, evidence: 18, feasibility: 18, writing: 18 })),
      ch("r", "微调章", "y", sc(78, { coverage: 16, logic: 16, evidence: 15, feasibility: 16, writing: 15 })),
      ch("b", "重写章", "z", sc(60, { coverage: 12, logic: 12, evidence: 10, feasibility: 13, writing: 13 }, [
        { dim: "数据与案例支撑", problem: "缺量化指标" },
      ])),
    ]
    const ov = buildSelfCheckOverview(chapters)
    expect(ov.reviewedCount).toBe(3)
    expect(ov.verdictDist).toEqual({ direct: 1, review: 1, blocked: 1 })
    expect(ov.avgTotal).toBe(76)
    expect(ov.reviewedRatio).toBe(100)
    expect(ov.weakestDim?.key).toBe("evidence")
    expect(ov.rewriteList).toHaveLength(1)
    expect(ov.rewriteList[0].nodeId).toBe("b")
    expect(ov.topIssues[0]).toEqual({ dim: "数据与案例支撑", count: 1 })
  })

  it("存量 LLM 自报 verdict 被忽略，一律按 total 规则重算", () => {
    const stale: ChapterSelfCheck = { ...sc(95, { coverage: 19, logic: 19, evidence: 19, feasibility: 19, writing: 19 }), verdict: "blocked" }
    const ov = buildSelfCheckOverview([ch("a", "A", "x", stale)])
    expect(ov.verdictDist.direct).toBe(1)
    expect(ov.verdictDist.blocked).toBe(0)
  })

  it("高频问题按 dim 聚合降序，空 dim 归「综合」", () => {
    const chapters = [
      ch("a", "A", "x", sc(80, {}, [
        { dim: "文字规范", problem: "口语" },
        { dim: "逻辑结构", problem: "顺序乱" },
      ])),
      ch("b", "B", "y", sc(70, {}, [
        { dim: "文字规范", problem: "重复" },
        { dim: "", problem: "无维度" },
      ])),
    ]
    const ov = buildSelfCheckOverview(chapters)
    expect(ov.topIssues[0]).toEqual({ dim: "文字规范", count: 2 })
    expect(ov.topIssues.some((g) => g.dim === "综合" && g.count === 1)).toBe(true)
  })

  it("待重写清单按分数升序（最差在前）", () => {
    const chapters = [
      ch("a", "甲", "x", sc(65, {})),
      ch("b", "乙", "y", sc(50, {})),
      ch("c", "丙", "z", sc(58, {})),
    ]
    const ov = buildSelfCheckOverview(chapters)
    expect(ov.rewriteList.map((r) => r.nodeId)).toEqual(["b", "c", "a"])
  })

  it("buildSelfCheckBriefText 含关键统计且不抛异常", () => {
    const ov = buildSelfCheckOverview([ch("a", "A", "x", sc(60, {}, [{ dim: "需求覆盖", problem: "漏项" }]))])
    const txt = buildSelfCheckBriefText(ov)
    expect(txt).toContain("整本 AI 自检总览")
    expect(txt).toContain("建议重写章节")
    expect(txt.split("\n").length).toBeGreaterThan(2)
  })
})

// r277 切片4：评分策略建议卡 / 演示准备骨架——正反例与幂等
import { describe, it, expect } from "vitest"
import { scoringStrategySuggestions, buildDemoSkeleton, DEMO_SKELETON_MARK } from "./scoringStrategyCard"
import type { NumberedScoringItem } from "./bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

const item = (
  id: string, it: string, score: number, criteria: string, subjective: boolean,
): NumberedScoringItem => ({ id, item: it, score, criteria, category: "tech", isSubjective: subjective })

const ch = (content: string): Chapter =>
  ({ node_id: content.slice(0, 8), title: "t", sections: [], content, gen_status: "done" })

describe("scoringStrategySuggestions", () => {
  it("空评分项 → 空建议（老项目静默）", () => {
    expect(scoringStrategySuggestions([], [ch("任意正文")])).toEqual([])
  })
  it("质保维度命中且正文无升级承诺 → 出加分建议", () => {
    const s = scoringStrategySuggestions(
      [item("R1", "质保方案", 5, "免费质保期不低于3年，期满提供维保服务", true)],
      [ch("我方提供3年质保")],
    )
    expect(s.some((x) => x.kind === "enhance" && x.text.includes("质保期"))).toBe(true)
  })
  it("全文已含延长质保承诺 → 同维度不重复推（幂等）", () => {
    const s = scoringStrategySuggestions(
      [item("R1", "质保方案", 5, "免费质保期不低于3年", true)],
      [ch("我方承诺延长质保至6年")],
    )
    expect(s.filter((x) => x.text.includes("质保期")).length).toBe(0)
  })
  it("客观项要求截图且全文无挂载占位 → 证据挂载提醒", () => {
    const s = scoringStrategySuggestions(
      [item("R2", "功能实证", 3, "提供系统功能截图并加盖章", false)],
      [ch("完全满足相关要求")],
    )
    expect(s.some((x) => x.kind === "evidence" && x.text.includes("佐证材料：【待填写"))).toBe(true)
  })
  it("客观项已有【待填写：…】占位 → 不再推证据（已挂载路径）", () => {
    const s = scoringStrategySuggestions(
      [item("R2", "功能实证", 3, "提供系统功能截图", false)],
      [ch("佐证材料：【待填写：医保结算平台界面截图】")],
    )
    expect(s.filter((x) => x.kind === "evidence").length).toBe(0)
  })
  it("≤8 条且按分值降序", () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      item(`R${i + 1}`, `项${i + 1}`, i + 1, "含驻场与质保要求", true))
    const s = scoringStrategySuggestions(items, [ch("")])
    expect(s.length).toBeLessThanOrEqual(8)
    for (let i = 1; i < s.length; i++) expect(s[i - 1].score).toBeGreaterThanOrEqual(s[i].score)
  })
})

describe("buildDemoSkeleton", () => {
  it("骨架含标记/五大块/待填写占位与节点名", () => {
    const sk = buildDemoSkeleton("功能演示", 6, [{ title: "医保结算模块" }])
    expect(sk.startsWith(DEMO_SKELETON_MARK)).toBe(true)
    expect(sk).toContain("（6 分）")
    expect(sk).toContain("演示环境")
    expect(sk).toContain("备用录屏")
    expect(sk).toContain("答辩问答边界")
    expect(sk).toContain("【待填写：功能点】——「医保结算模块」")
  })
  it("分值 0 不显示分值、空节点列表留占位环节", () => {
    const sk = buildDemoSkeleton("演示", 0, [])
    expect(sk).not.toContain("（0 分）")
    expect(sk).toContain("1. 【待填写：演示环节】")
  })
})

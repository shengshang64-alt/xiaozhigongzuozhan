import { describe, expect, it } from "vitest"
import { buildScoreCheckup, uncoveredScoreTitles } from "./scoreCoverageCheckup"
import type { ParseReport } from "./bidTypes"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

/** 建阳区技术评分表 14 项（合计 53 分），行格式「名（N 分）：标准」与 bidTypes 抽取口径一致 */
const TECH_SCORE = [
  "总体设计方案（5 分）：根据采购需求对系统整体设计思路",
  "系统功能设计（5 分）：对各子系统功能设计详尽",
  "运行环境部署（2 分）：对部署拓扑结构等详细阐述",
  "硬件资源配置（2 分）：对各硬件参数配置齐全",
  "平台部署实施方案（5 分）：部署计划科学合理",
  "系统集成、接口（4 分）：接口设计能力完备",
  "实施方案（3 分）：项目实施组织与进度计划",
  "重保方案（2 分）：重大活动保障方案完整",
  "服务管理方案（4 分）：服务管理总体思路清晰",
  "售后服务方案（5 分）：报修受理及故障处理",
  "技术培训方案（2 分）：培训内容详实",
  "项目组织机构及管理人员配置（4 分）：机构健全人员合理",
  "项目优化措施（5 分）：优化建议明确具体",
  "项目重点难点及对策建议（5 分）：分析全面合理",
].join("\n")

function report(): ParseReport {
  return {
    scope: "full",
    sections: [
      { key: "tech_score", title: "技术评分", content: TECH_SCORE },
      { key: "biz_score", title: "商务评分", content: "" },
    ],
  } as ParseReport
}

function node(title: string, part: "biz" | "tech", description?: string): OutlineNode {
  return { id: title, title, children: [], part, description }
}

describe("R-025 评分覆盖体检", () => {
  it("无技术评分项时体检不呈现", () => {
    const ck = buildScoreCheckup([], { scope: "full", sections: [] } as ParseReport)
    expect(ck.hasScoring).toBe(false)
  })

  it("空大纲：技术总分 53、已落点 0、全部未落点", () => {
    const ck = buildScoreCheckup([], report())
    expect(ck.hasScoring).toBe(true)
    expect(ck.rows.length).toBe(14)
    expect(ck.techTotal).toBe(53)
    expect(ck.techLanded).toBe(0)
    expect(ck.techMissing).toBe(53)
    // 丢分大户在前（分值降序），售后服务/技术培训均在清单
    expect(ck.missingRows[0].score).toBe(5)
    expect(ck.missingRows.some((r) => r.name === "售后服务方案")).toBe(true)
    expect(ck.missingRows.some((r) => r.name === "技术培训方案")).toBe(true)
  })

  it("章节 [响应:Rx] 标注即算落点，落点/未落点分值随之前移", () => {
    // R10=售后服务方案(5)，R11=技术培训方案(2)；近义章节「项目重点难点及对策建议（含专家点评）」承接 R14
    const outline = [
      node("售后服务与故障处理", "tech", "响应评分要求 [响应:R10]"),
      node("技术培训", "tech", "[响应:R11]"),
      node("项目重点难点及对策建议（含专家点评）", "tech", "[响应:R14]"),
    ]
    const ck = buildScoreCheckup(outline, report())
    expect(ck.techLanded).toBe(12) // 5+2+5
    expect(ck.techMissing).toBe(41)
    const r10 = ck.rows.find((r) => r.id === "R10")
    expect(r10?.covered).toBe(true)
    expect(r10?.coveredBy).toContain("售后服务与故障处理")
    expect(ck.missingRows.some((r) => r.id === "R10")).toBe(false)
  })

  it("未落点标题去重保序，供一键补入", () => {
    const ck = buildScoreCheckup([], report())
    const titles = uncoveredScoreTitles(ck)
    expect(titles).toContain("总体设计方案")
    expect(titles).toContain("售后服务方案")
    expect(new Set(titles).size).toBe(titles.length)
  })
})

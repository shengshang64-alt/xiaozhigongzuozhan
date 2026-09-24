import { describe, expect, it } from "vitest"
import {
  buildOutlineChildrenMessages,
  buildBidOutlineMessages,
  buildScoringCoverageMatrix,
  classifySubjective,
  findUncoveredScoringIds,
  numberScoringItems,
  numberedScoringDetailLines,
  type NumberedScoringItem,
  type ParseReport,
} from "./bidTypes"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

// R31（prompt-matrix-02）：评分细项编号体系 + 大纲 [响应:Rx] 承接 + 覆盖矩阵的行为锈死网
// 锁死点：编号源唯一（大纲 prompt 与右栏面板同源）、承接只对技术项计分、全程本地零 AI

function reportOf(tech: string, biz = ""): ParseReport {
  return {
    scope: "full",
    sections: [
      { key: "tech_score", content: tech },
      { key: "biz_score", content: biz },
    ],
  } as unknown as ParseReport
}

function node(title: string, children: OutlineNode[] = [], description?: string): OutlineNode {
  return { id: `n-${title}`, title, children, ...(description ? { description } : {}) }
}

describe("classifySubjective（主客观分项）", () => {
  it("区间得分 / 评委评判词判为主观", () => {
    expect(classifySubjective({ item: "技术方案", score: 15, criteria: "优得13-15分，良得8-12分" })).toBe(true)
    expect(classifySubjective({ item: "实施能力", score: 6, criteria: "由评委横向比较酌情打分" })).toBe(true)
  })

  it("硬指标可核验项判为客观", () => {
    expect(classifySubjective({ item: "业绩", score: 5, criteria: "每个合同得1分，满分5分" })).toBe(false)
    expect(classifySubjective({ item: "参数响应", score: 3, criteria: "全部正偏离得满分" })).toBe(false)
  })
})

describe("numberScoringItems（稳定编号体系）", () => {
  it("技术 R1.. / 商务 B1.. 分别编号，与解析行序一致", () => {
    const items = numberScoringItems(
      reportOf("总体方案（15 分）：完整合理得满分\n本地化服务（5 分）：每网点1分", "同类业绩（10 分）：每个2分"),
    )
    expect(items.map((i) => i.id)).toEqual(["R1", "R2", "B1"])
    expect(items.map((i) => i.category)).toEqual(["tech", "tech", "biz"])
    expect(items[0].isSubjective).toBe(true)
    expect(items[2].isSubjective).toBe(false)
  })

  it("空报告返回空数组（编号链路静默降级）", () => {
    expect(numberScoringItems(null)).toEqual([])
  })
})

describe("numberedScoringDetailLines（prompt 注入行）", () => {
  it("行首带 [Rx] 编号 + 主客观标记 + 标准细则", () => {
    const items = numberScoringItems(reportOf("总体方案（15 分）：优得13-15分"))
    const line = numberedScoringDetailLines(items)
    expect(line).toBe("[R1] 总体方案（15 分）「主观」：优得13-15分")
  })

  it("标准缺失时诚实标注未解析，不编造", () => {
    const items = numberScoringItems(reportOf("驻场人员：2 分"))
    expect(numberedScoringDetailLines(items)).toContain("（评审标准细则未解析）")
  })
})

describe("buildScoringCoverageMatrix / findUncoveredScoringIds（承接覆盖矩阵，零 AI）", () => {
  const items = numberScoringItems(
    reportOf("总体方案（15 分）：完整得满分\n数据安全（8 分）：满足得8分", "业绩（10 分）：每个2分"),
  )

  it("叶子 [响应:Rx] 标注按编号归入承接标题，多编号/全角逗号/英文 Response 均可解析", () => {
    const outline = [
      node("技术部分", [
        node("总体架构章", [node("架构设计", [], "[响应:R1]"), node("安全设计", [], "[响应:R1，R2]")]),
        node("数据章", [node("Response 标注", [], "[Response:R2]")]),
      ]),
    ]
    const matrix = buildScoringCoverageMatrix(outline, items)
    expect(matrix).toHaveLength(2) // 商务项 B1 不进矩阵
    expect(matrix[0].coveredBy).toEqual(["架构设计", "安全设计"])
    expect(matrix[1].coveredBy).toEqual(["安全设计", "Response 标注"])
    expect(findUncoveredScoringIds(outline, items)).toEqual([])
  })

  it("未承接编号进入 uncovered；商务骨架章下的标注不计入", () => {
    const biz: OutlineNode = { ...node("商务章", [node("投标函", [], "[响应:R1]")]), part: "biz" }
    const outline = [biz, node("技术章", [node("报价说明", [], "无关描述")])]
    const matrix = buildScoringCoverageMatrix(outline, items)
    expect(matrix.every((e) => !e.coveredBy.length)).toBe(true)
    expect(findUncoveredScoringIds(outline, items)).toEqual(["R1", "R2"])
  })

  it("空大纲时全部技术评分项判为未承接（诚实暴露而非假绿）", () => {
    const uncovered = findUncoveredScoringIds([], items as NumberedScoringItem[])
    expect(uncovered).toEqual(["R1", "R2"])
  })
})

describe("R31 prompt 注入（编号评分项 ↔ 承接标注规则同源）", () => {
  it("整份大纲 prompt：编号细则行 + [响应:Rx] 承接规则 + 输出格式示例", () => {
    const msgs = buildBidOutlineMessages("智慧医院项目", "某医院", reportOf("总体方案（15 分）：优得13-15分"), false, 2)
    const all = msgs.map((m) => m.content).join("\n")
    expect(all).toContain("[R1] 总体方案（15 分）")
    expect(all).toContain("承接标注（R31）")
    expect(all).toContain("[响应:R1,R3]")
  })

  it("分步大纲 call2：编号注入 + 叶子承接规则；无评分项时规则静默", () => {
    const withScore = buildOutlineChildrenMessages("总体架构章", ["安全章"], reportOf("架构能力（10 分）：完整得满分"), {
      quota: 6,
      level: 2,
      sectionWords: 800,
    })
    const all = withScore.map((m) => m.content).join("\n")
    expect(all).toContain("[R1] 架构能力（10 分）")
    expect(all).toContain("承接标注（R31）")
    expect(all).toContain('"description":"[响应:R2,R5]"')

    const empty = buildOutlineChildrenMessages("总体架构章", [], reportOf(""), { quota: 6, level: 2, sectionWords: 800 })
    const emptyAll = empty.map((m) => m.content).join("\n")
    expect(emptyAll).not.toContain("承接标注（R31）")
    expect(emptyAll).not.toContain("[响应:")
  })
})

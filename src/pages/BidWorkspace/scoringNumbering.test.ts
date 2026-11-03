import { describe, expect, it } from "vitest"
import {
  buildOutlineChildrenMessages,
  buildBidOutlineMessages,
  buildScoringCoverageMatrix,
  classifySubjective,
  scoringItemMatchesLeaf,
  ensureSubjectiveScoringChapters,
  skippedFragmentsWithChildren,
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

// 2026-10-15 用户实测补的口径：覆盖矩阵原先只认 [响应:Rx] 机械标注，模型没写标注就报「评分项仍未承接」，
// 而大纲内容其实已按评分办法展开 → 用户以为"没按招标文件生成"。这里锁死新增的语义兜底：
// 没标注但标题/描述确实命中评分项名 → 视为承接（不再误报）；真没覆盖 → 照旧报红（不假绿）。
describe("评分项承接的语义兜底（零 AI，仅对没标注的项生效）", () => {
  const items2 = numberScoringItems(
    reportOf(["总体技术解决方案（5 分）：完整得满分", "售后服务与运维保障方案（5 分）：齐全得满分"].join("\n"), ""),
  )

  it("叶子标题就是评分项名（未写标注）→ 判为已承接", () => {
    const outline = [node("技术部分", [node("总体技术解决方案", [], "涵盖现状理解与架构设计"), node("售后服务与运维保障方案", [])])]
    expect(findUncoveredScoringIds(outline, items2)).toEqual([])
  })

  it("仅描述里命中评分项名（标题无关）也算承接", () => {
    const outline = [node("技术部分", [node("第5章 实施与保障", [], "本章对应总体技术解决方案的架构落地")])]
    expect(findUncoveredScoringIds(outline, items2)).toEqual(["R2"]) // R1 由描述命中，R2 仍未响应
  })

  it("标题/描述都没命中 → 仍报未承接（不假绿）", () => {
    const outline = [node("技术部分", [node("报价说明", [], "无关描述")])]
    expect(findUncoveredScoringIds(outline, items2)).toEqual(["R1", "R2"])
  })

  it("已有标注的项不被语义兜底追加承接者（两种口径不叠加）", () => {
    const outline = [node("技术部分", [node("总体技术解决方案", [], "[响应:R1]"), node("售后体系", [], "含总体技术解决方案字样")])]
    const matrix = buildScoringCoverageMatrix(outline, items2)
    expect(matrix.find((e) => e.item.id === "R1")?.coveredBy).toEqual(["总体技术解决方案"])
  })

  it("长句评分项不会被碰巧相似的短标题蒙混（阈值 = 名称长度一半）", () => {
    const longName = "对项目现状痛点需求及难点理解精准透彻并给出可落地的应对思路"
    expect(scoringItemMatchesLeaf(longName, "项目现状分析")).toBe(false)
    expect(scoringItemMatchesLeaf(longName, longName)).toBe(true)
  })
})

// 用户裁定（2026-10-15）：评分办法的主观材料必须在大纲里生成 + 生成前后不能出现"看得见却没建章"。
describe("主观评分项强制入纲 + 建章一致性守卫", () => {
  // 主观项判据见 classifySubjective：分档区间（得 3-5 分）或优良/合理/完整这类评议词
  const items3 = numberScoringItems(
    reportOf(
      ["技术方案（20 分）：优（15-20分）良（10-14分）一般（5-9分）", "类似项目业绩（10 分）：每提供一份合同得2分"].join("\n"),
      "",
    ),
  )

  it("未承接的主观项被补成技术章，并写回 [响应:Rx] 标注（补完即承接，口径自洽）", () => {
    const outline = [node("技术部分", [node("现有技术章", [], "与评分项无关")])]
    const { nodes, added } = ensureSubjectiveScoringChapters(outline, items3)

    expect(added).toEqual(["技术方案"]) // 业绩是客观项（材料件数计分），不补章
    const addedNode = nodes.find((n) => n.title === "技术方案")
    expect(addedNode).toBeTruthy()
    expect(addedNode?.description).toContain("[响应:R1]")
    expect(addedNode?.children).toEqual([])
    // 补完就应判为已承接（不会再出现"补了章还报未承接"）
    expect(findUncoveredScoringIds(nodes, items3)).toEqual([])
  })

  it("已承接的主观项不重复补章", () => {
    const outline = [node("技术部分", [node("技术方案", [], "已按评分办法展开")])]
    const { nodes, added } = ensureSubjectiveScoringChapters(outline, items3)
    expect(added).toEqual([])
    expect(nodes).toBe(outline) // 无补入时原引用返回，免多余重渲染
  })

  it("全部是客观项时不做任何补入（避免生成无意义正文）", () => {
    const objective = numberScoringItems(reportOf("投标报价（30 分）：满足招标文件要求得满分", ""))
    const outline = [node("技术部分", [node("无关章", [])])]
    expect(ensureSubjectiveScoringChapters(outline, objective).added).toEqual([])
  })

  it("skippedFragmentsWithChildren：只点名「被跳过且带小节」的节点（真章节被误跳的红色告警口径）", () => {
    const kept = node("保留章", [node("1.1", [])])
    const skippedPlain = node("交付地点", []) // 真碎片：光杆标题，不点名
    const skippedWithKids = node("质保期外运维及新增接口服务方案", [node("范围界定", []), node("实施机制", [])])
    const names = skippedFragmentsWithChildren([kept, skippedPlain, skippedWithKids], [kept])
    expect(names).toEqual(["质保期外运维及新增接口服务方案"])
  })
})

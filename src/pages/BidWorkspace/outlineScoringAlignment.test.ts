// 2026-10-22（用户口径：技术标大纲必须与评分办法一级评分项一一对应，禁止合并）
// 判据：覆盖 ≠ 对应。findUncoveredScoringIds 把「一章承接多个评分项」算绿，本模块单独判合并与缺章。
// 反向验证（删实现即变红）：
//   · 把 mergedChapters 的 `h.items.length >= 2` 改成 `>= 3` → 用例②红；
//   · 把 itemsWithoutChapter 的过滤去掉（把资信类也算缺章）→ 用例③红。
import { describe, expect, it } from "vitest"
import type { OutlineNode } from "../SolutionStudio/solutionTypes"
import {
  outlineChapterScoringAlignment,
  parseSubsystems,
  subsystemCoverage,
  type NumberedScoringItem,
  type ParseReport,
} from "./bidTypes"

const node = (title: string, children: string[] = []): OutlineNode =>
  ({ id: title, title, description: "", children: children.map((t) => ({ id: t, title: t, description: "", children: [] })) }) as OutlineNode

const item = (id: string, name: string, score: number): NumberedScoringItem =>
  ({ id, item: name, score, criteria: "", category: "tech", isSubjective: true }) as NumberedScoringItem

const ITEMS: NumberedScoringItem[] = [
  item("R1", "总体技术解决方案", 5),
  item("R2", "数据价值闭环核心能力设计", 5),
  item("R12", "类似项目业绩与案例", 10), // 资信类：落点在商务材料，不由技术章承接
]

describe("大纲 ↔ 评分项一一对应判据（2026-10-22）", () => {
  it("① 一个评分项一个章 → ok", () => {
    const r = outlineChapterScoringAlignment(
      [node("总体技术解决方案", ["现状与痛点"]), node("数据价值闭环核心能力设计", ["数据资产"])],
      ITEMS,
    )
    expect(r.techItemCount).toBe(3)
    expect(r.techChapterCount).toBe(2)
    expect(r.itemsWithoutChapter).toEqual([])
    expect(r.mergedChapters).toEqual([])
    expect(r.objectiveWithoutChapter.map((x) => x.id)).toEqual(["R12"])
    expect(r.ok).toBe(true)
  })

  it("② 两个评分项被揉进一章 → 判为合并章（这是用户明确否掉的形态）", () => {
    const r = outlineChapterScoringAlignment([node("总体技术解决方案与数据价值闭环核心能力设计")], ITEMS)
    expect(r.mergedChapters).toHaveLength(1)
    expect(r.mergedChapters[0].items.map((x) => x.id).sort()).toEqual(["R1", "R2"])
    expect(r.ok).toBe(false)
  })

  it("③ 方案类评分项没有章 → 缺章；资信类不算缺章", () => {
    const r = outlineChapterScoringAlignment([node("总体技术解决方案")], ITEMS)
    expect(r.itemsWithoutChapter.map((x) => x.id)).toEqual(["R2"])
    expect(r.objectiveWithoutChapter.map((x) => x.id)).toEqual(["R12"])
    expect(r.ok).toBe(false)
  })

  it("④ 没有技术评分项时不臆断（避免无评分办法的项目每次告警）", () => {
    const r = outlineChapterScoringAlignment([node("任意章")], [])
    expect(r.ok).toBe(false)
    expect(r.techItemCount).toBe(0)
    expect(r.itemsWithoutChapter).toEqual([])
    expect(r.mergedChapters).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2026-10-22（用户反馈：最基础的招标文件要求都没对齐）
//   真实库实测：招标第三章定制软件开发清单解析出 45 个子系统，大纲标题命中 0 个。
//   本判据负责把这件事变成可见的数字，而不是靠人眼翻 283 个节点。
// ---------------------------------------------------------------------------
describe("采购需求子系统落点覆盖（2026-10-22）", () => {
  const report = (content: string): ParseReport =>
    ({ scope: "full", sections: [{ key: "req_structure", title: "采购需求结构", content, status: "ok", snippet: "" }] }) as ParseReport

  it("① 子系统清单逐行解析", () => {
    expect(parseSubsystems(report("实验室信息系统\n· 输血管理信息系统\n\nOA 系统"))).toEqual([
      "实验室信息系统",
      "输血管理信息系统",
      "OA 系统",
    ])
  })

  it("② 小节命中即算覆盖；未命中的必须点名", () => {
    const rep = report("实验室信息系统\n输血管理信息系统\n院感监测管理系统")
    const outline: OutlineNode[] = [node("详细技术方案", ["实验室信息系统（LIS）", "输血管理信息系统"])]
    const c = subsystemCoverage(rep, outline)
    expect(c.total).toBe(3)
    expect(c.coveredCount).toBe(2)
    expect(c.missing).toEqual(["院感监测管理系统"])
  })

  it("③ 没有任何子系统清单时返回 0/0，不臆断", () => {
    expect(subsystemCoverage({ scope: "full", sections: [] } as ParseReport, [node("x")])).toEqual({
      total: 0,
      coveredCount: 0,
      missing: [],
    })
  })
})

// ---------------------------------------------------------------------------
// 2026-10-23（用户要求：方案型条款要有地方写）
// ---------------------------------------------------------------------------
import { ensureProposalClauseSections } from "./bidTypes"

describe("方案型实质性条款补节（2026-10-23）", () => {
  it("挂到「参数响应」章下，标题去掉 ★ 与编号", () => {
    const outline = [node("重点参数响应情况", [])]
    const r = ensureProposalClauseSections(outline, ["★8. 系统集成、培训\n（1）系统集成实施服务…"])
    expect(r.added).toEqual(["系统集成、培训"])
    expect(r.nodes[0].children?.[0]?.title).toBe("系统集成、培训")
  })

  it("没有参数响应章时新建顶层章承载", () => {
    const r = ensureProposalClauseSections([node("总体技术解决方案")], ["★9. 数据互通互联、数据质量提升\n（1）…"])
    expect(r.nodes.map((n) => n.title)).toContain("方案型实质性条款响应")
    expect(r.added).toEqual(["数据互通互联、数据质量提升"])
  })

  it("已有同名节不重复补；空标题不补", () => {
    const outline = [node("重点参数响应情况", ["系统集成、培训"])]
    expect(ensureProposalClauseSections(outline, ["★8. 系统集成、培训"]).added).toEqual([])
    expect(ensureProposalClauseSections(outline, ["★"]).added).toEqual([])
  })
})

// 2026-10-23：演示类评分项由现场演示计分，不要求有章节
describe("演示项不参与一一对应考核", () => {
  it("⑤ 演示项无章不算缺章，ok 仍为 true", () => {
    const items: NumberedScoringItem[] = [
      item("R1", "总体技术解决方案", 5),
      item("R2", "包01 演示1", 4),
    ]
    const r = outlineChapterScoringAlignment([node("总体技术解决方案")], items)
    expect(r.itemsWithoutChapter).toEqual([])
    expect(r.techItemCount).toBe(2)
    expect(r.ok).toBe(true)
  })
})

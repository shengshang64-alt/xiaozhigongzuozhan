// Q28 切片G：编排配图补齐的纯函数口径锁死（缺图判定 / 单图解析校验 / 提示词契约 / 图位锚点）
import { describe, expect, it } from "vitest"
import {
  applyFigureAnchors,
  buildFigureBackfillMessages,
  collectFigureBackfillTargets,
  collectFigurePlacements,
  figureAnchorLine,
  isPlanSatisfied,
  parseFigureBackfill,
  type FigureBackfillPlan,
} from "./figureBackfill"
import type { BidOrchestration, LeafOrchestration, OrchestrationFigureType } from "../bidTypes"
import type { Chapter, FigureSpec, OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

/** 编排叶子：图型 + 图名（+ 可选图注），其余字段取编排择优后的固定形态 */
function planLeaf(type: OrchestrationFigureType, title: string, caption?: string): LeafOrchestration {
  return {
    figure: {
      needed: true,
      selected: true,
      priority: 3,
      type,
      title,
      reason: "编排判定该节需要配图",
      ...(caption ? { caption } : {}),
    },
  }
}

function node(id: string, title: string, children: OutlineNode[] = []): OutlineNode {
  return { id, title, children }
}

function mermaid(title: string, caption?: string): FigureSpec {
  return { type: "mermaid", title, code: "flowchart TD\n A-->B", ...(caption ? { caption } : {}) }
}

function flowFigure(title: string): FigureSpec {
  return { type: "flow", title, steps: [{ name: "甲" }, { name: "乙" }, { name: "丙" }] }
}

// 造「章 → 节 → 叶」三层最小树：节标题即 Chapter.sections 里的字符串
function makeFixture() {
  const outline: OutlineNode[] = [
    node("ch1", "总体设计方案", [
      node("s1", "总体设计思路", [node("l1", "思路要点")]),
      node("s2", "架构与技术路线", [node("l2", "分层架构")]),
      node("s3", "已配图的节", [node("l3", "集成关系")]),
      node("s4", "AI 位图节", [node("l4", "机房实景")]),
    ]),
    node("ch2", "商务资质", [node("s9", "资质响应", [node("l9", "证照")])]),
  ]
  const orch: BidOrchestration = {
    leaves: {
      l1: planLeaf("flow", "实施流程图", "图示阶段衔接"),
      l2: planLeaf("architecture", "技术架构分层图"),
      l3: planLeaf("mermaid", "集成关系图", "呈现调用关系"),
      l4: planLeaf("ai", "机房实景"),
      l9: planLeaf("flow", "商务流程"),
    },
    generated_at: "2026-10-07T00:00:00.000Z",
  }
  const chapters: Chapter[] = [
    {
      node_id: "ch1",
      title: "总体设计方案",
      gen_status: "done",
      sections: ["总体设计思路", "架构与技术路线", "已配图的节", "AI 位图节"],
      content: "1.1 总体设计思路 本项目以评促建……\n\n1.2 架构与技术路线 分层解耦……",
      figures: [mermaid("系统间调用关系", "呈现调用关系")],
    },
    { node_id: "ch2", title: "商务资质", part: "biz", gen_status: "done", sections: ["资质响应"], content: "x", figures: [] },
  ]
  return { outline, orch, chapters }
}

describe("Q28 切片G collectFigureBackfillTargets 缺图判定", () => {
  it("只挑编排选中且尚未落库的本地图型，跳过商务章与 AI 位图", () => {
    const { outline, orch, chapters } = makeFixture()
    const got = collectFigureBackfillTargets(orch, outline, chapters)
    expect(got.map((t) => [t.nodeId, t.sectionTitle, t.plan.type])).toEqual([
      ["ch1", "总体设计思路", "flow"],
      ["ch1", "架构与技术路线", "architecture"],
    ])
    expect(got[0].excerpt).toContain("本项目以评促建")
  })

  it("未编排 / 编排不覆盖该节时不补图（老项目行为不变）", () => {
    const { outline, chapters } = makeFixture()
    expect(collectFigureBackfillTargets(null, outline, chapters)).toEqual([])
    const empty: BidOrchestration = { leaves: {}, generated_at: "" }
    expect(collectFigureBackfillTargets(empty, outline, chapters)).toEqual([])
  })

  it("同章同名图只补一张，limit 生效", () => {
    const { outline, orch, chapters } = makeFixture()
    expect(collectFigureBackfillTargets(orch, outline, chapters, { limit: 1 })).toHaveLength(1)
  })

  it("同一节下多个叶子各选一张图 → 逐张补齐（节级合并只取 1 张，顶不住全文 35 张名额）", () => {
    const outline = [node("chA", "章一", [node("sA", "第一节", [node("la", "叶子一"), node("lb", "叶子二")])])]
    const orch: BidOrchestration = { leaves: { la: planLeaf("flow", "流程甲"), lb: planLeaf("architecture", "架构乙") }, generated_at: "" }
    const chapters: Chapter[] = [{ node_id: "chA", title: "章一", gen_status: "done", sections: ["第一节"], content: "第一节 正文……", figures: [] }]
    const got = collectFigureBackfillTargets(orch, outline, chapters)
    expect(got.map((t) => [t.sectionTitle, t.plan.title])).toEqual([["第一节", "流程甲"], ["第一节", "架构乙"]])
    expect(collectFigurePlacements(orch, outline, chapters)).toEqual([])
  })

  it("节标题在大纲里找不到（编排后重排过大纲）→ 既不补图也不落位，行为与旧 covered=false 一致", () => {
    const { orch } = makeFixture()
    const outline = [node("ch1", "总体设计方案", [node("sX", "已被改名的小节", [node("l1", "思路要点")])])]
    const chapters: Chapter[] = [
      { node_id: "ch1", title: "总体设计方案", gen_status: "done", sections: ["总体设计思路"], content: "x", figures: [] },
    ]
    expect(collectFigureBackfillTargets(orch, outline, chapters)).toEqual([])
    expect(collectFigurePlacements(orch, outline, chapters)).toEqual([])
  })
})

describe("Q28 切片G isPlanSatisfied 已落库判定", () => {
  const plan: FigureBackfillPlan = { type: "mermaid", title: "集成关系图", caption: "呈现调用关系" }

  it("图名精确命中", () => {
    expect(isPlanSatisfied([flowFigure("集成关系图")], plan)).toBe(true)
  })

  it("图注命中也算已出图（生成链路会把 title 改写成同义说法）", () => {
    expect(isPlanSatisfied([mermaid("系统间调用关系", "呈现调用关系")], plan)).toBe(true)
  })

  it("过短图名只做精确等值，不做包含匹配", () => {
    expect(isPlanSatisfied([flowFigure("架构图")], { type: "architecture", title: "架构图" })).toBe(true)
    expect(isPlanSatisfied([flowFigure("总体技术架构分层图")], { type: "architecture", title: "架构图" })).toBe(false)
  })

  it("无图可判定时为 false", () => {
    expect(isPlanSatisfied([], plan)).toBe(false)
    expect(isPlanSatisfied(undefined, plan)).toBe(false)
  })
})

describe("Q28 切片G parseFigureBackfill 严格解析", () => {
  it("架构图：层名 + ≥2 模块，title/caption 以编排计划为准", () => {
    const plan: FigureBackfillPlan = { type: "architecture", title: "技术架构分层图", caption: "呈现分层" }
    const raw = '```json\n{"type":"architecture","title":"模型自己改的名","layers":[{"name":"感知层","modules":["采集","网关"]},{"name":"应用层","modules":["门诊","住院"]}]}\n```'
    expect(parseFigureBackfill(raw, plan)).toEqual({
      type: "architecture",
      title: "技术架构分层图",
      caption: "呈现分层",
      layers: [
        { name: "感知层", modules: ["采集", "网关"] },
        { name: "应用层", modules: ["门诊", "住院"] },
      ],
    })
  })

  it("元素不足即弃图：架构少于两层、流程少于三步、界面示意无主区块", () => {
    expect(parseFigureBackfill('{"layers":[{"name":"a","modules":["x","y"]}]}', { type: "architecture", title: "T" })).toBeNull()
    expect(parseFigureBackfill('{"steps":[{"name":"a"},{"name":"b"}]}', { type: "flow", title: "T" })).toBeNull()
    expect(parseFigureBackfill('{"sidebar":["菜单"]}', { type: "demo", title: "T" })).toBeNull()
  })

  it("mermaid 校验首行声明，gantt 只收 gantt 源码且统一落 mermaid 型", () => {
    expect(parseFigureBackfill('{"code":"flowchart TD\\n A[\\"开始\\"] --> B[\\"结束\\"]"}', { type: "mermaid", title: "T" })).toEqual({
      type: "mermaid",
      title: "T",
      code: 'flowchart TD\n A["开始"] --> B["结束"]',
    })
    expect(parseFigureBackfill('{"code":"graph LR\\n A-->B"}', { type: "mermaid", title: "T" })).not.toBeNull()
    expect(parseFigureBackfill('{"code":"flowchart TD\\n A-->B"}', { type: "gantt", title: "T" })).toBeNull()
    expect(parseFigureBackfill('{"code":"gantt\\ndateFormat YYYY-MM-DD\\nsection 一期\\n任务 :a1, 2026-01-01, 30d"}', { type: "gantt", title: "T" })?.type).toBe("mermaid")
  })

  it("非 JSON / 缺图名一律弃图，绝不产出坏图", () => {
    expect(parseFigureBackfill("抱歉，我无法生成配图", { type: "flow", title: "T" })).toBeNull()
    expect(parseFigureBackfill('{"steps":[{"name":"a"},{"name":"b"},{"name":"c"}]}', { type: "flow", title: "  " })).toBeNull()
  })
})

describe("Q28 切片G buildFigureBackfillMessages 提示词契约", () => {
  it("system 带图型契约与固定图名，user 带项目/章/节与正文摘录", () => {
    const msgs = buildFigureBackfillMessages({
      projectName: "13",
      chapterTitle: "总体设计方案",
      sectionTitle: "总体设计思路",
      plan: { type: "flow", title: "实施流程图", caption: "图示阶段衔接" },
      excerpt: "本项目分三期实施……",
    })
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe("system")
    expect(msgs[0].content).toContain("流程图")
    expect(msgs[0].content).toContain("实施流程图")
    expect(msgs[0].content).toContain("图示阶段衔接")
    expect(msgs[1].content).toContain("总体设计思路")
    expect(msgs[1].content).toContain("本项目分三期实施")
  })

  it("摘录为空时明确禁止编造数值", () => {
    const msgs = buildFigureBackfillMessages({ projectName: "13", chapterTitle: "x", sectionTitle: "y", plan: { type: "demo", title: "T" }, excerpt: "" })
    expect(msgs[1].content).toContain("摘录为空")
  })
})

describe("Q28 切片G collectFigurePlacements 已落库图位", () => {
  it("按图注命中已落库图，图名用库内实际标题（模型改写后也能落位）", () => {
    const { outline, orch, chapters } = makeFixture()
    expect(collectFigurePlacements(orch, outline, chapters)).toEqual([
      { nodeId: "ch1", chapterTitle: "总体设计方案", sectionTitle: "已配图的节", figureTitle: "系统间调用关系" },
    ])
  })

  it("无图 / 未编排 / 商务章一律不出落位计划", () => {
    const { outline, orch, chapters } = makeFixture()
    expect(collectFigurePlacements(orch, outline, [])).toEqual([])
    expect(collectFigurePlacements(null, outline, chapters)).toEqual([])
    const noFig = chapters.map((c) => ({ ...c, figures: [] }))
    expect(collectFigurePlacements(orch, outline, noFig)).toEqual([])
  })
})

// 真实正文行结构（实测项目13）：「3.1 节名」独立成行，段间空行分隔
const DOC = ["1.1 总体设计思路", "", "本项目以评促建，分三期实施。", "", "1.2 架构与技术路线", "", "分层解耦，前后端分离。"].join("\n")
const SECS = ["总体设计思路", "架构与技术路线"]

describe("Q28 切片G applyFigureAnchors 图位锚点", () => {
  const p = { nodeId: "ch1", chapterTitle: "总体设计方案", sectionTitle: "总体设计思路", figureTitle: "实施流程图" }

  it("标记插在本节末尾、下一节标题之前，并与导出器正则对齐", () => {
    const got = applyFigureAnchors(DOC, SECS, [p])
    const lines = got.split("\n")
    expect(lines).toContain(figureAnchorLine("实施流程图"))
    expect(lines.indexOf(figureAnchorLine("实施流程图"))).toBe(4)
    expect(lines[3]).toBe("")
    expect(lines[5]).toBe("")
    expect(lines[6]).toBe("1.2 架构与技术路线")
    // 与 bidFiles 的 /^【图[:：](.+?)】$/ 同口径（标题精确匹配才能命中图）
    expect(/^【图[:：](.+?)】$/.exec(lines[4]?.trim())?.[1]).toBe("实施流程图")
    // 只增标记行：原有正文行一行不少、一字不改
    const kept = got.split("\n").filter((l) => !/^【图：/.test(l.trim()) && l.trim() !== "")
    expect(kept).toEqual(DOC.split("\n").filter((l) => l.trim() !== ""))
  })

  it("幂等：同图名重复补齐不叠标记；一节多图各自一行", () => {
    const once = applyFigureAnchors(DOC, SECS, [p])
    expect(applyFigureAnchors(once, SECS, [p])).toBe(once)
    expect(once.split(figureAnchorLine("实施流程图")).length - 1).toBe(1)
    const two = applyFigureAnchors(DOC, SECS, [p, { ...p, sectionTitle: "架构与技术路线", figureTitle: "技术架构分层图" }])
    expect(two.split("\n").filter((l) => /^【图：/.test(l.trim()))).toEqual([figureAnchorLine("实施流程图"), figureAnchorLine("技术架构分层图")])
  })

  it("最后一节的图落到文末；节名在正文找不到则不动正文", () => {
    const last = applyFigureAnchors(DOC, SECS, [{ ...p, sectionTitle: "架构与技术路线", figureTitle: "技术架构分层图" }])
    expect(last.split("\n").slice(-2)).toEqual([figureAnchorLine("技术架构分层图"), ""])
    const miss = applyFigureAnchors(DOC, ["总体设计思路"], [{ ...p, sectionTitle: "不存在的小节" }])
    expect(miss).toBe(DOC)
  })

  it("空正文 / 空图名 / 无计划时原样返回", () => {
    expect(applyFigureAnchors("", ["x"], [p])).toBe("")
    expect(applyFigureAnchors(DOC, ["总体设计思路"], [{ ...p, figureTitle: "  " }])).toBe(DOC)
    expect(applyFigureAnchors(DOC, ["总体设计思路"], [])).toBe(DOC)
  })
})

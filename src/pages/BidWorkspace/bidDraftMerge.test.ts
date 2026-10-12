// ---------------------------------------------------------------------------
// R235：底稿增量三段式匹配与合并计划引擎单测（environment=node，纯函数零 DOM）。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import {
  buildMergePlan,
  decideAction,
  matchOutlineToDraft,
  normalizeTitle,
  parseDraftHtml,
  titleSimilarity,
  type DraftChapter,
  type OutlineTarget,
} from "./bidDraftMerge"

const mk = (title: string, content = "正文"): DraftChapter => ({ title, content })

describe("normalizeTitle", () => {
  it("剥离阿拉伯 / 中文 / 带圈编号并去标点空白", () => {
    expect(normalizeTitle("1. 项目实施方案")).toBe("项目实施方案")
    expect(normalizeTitle("第三章 售后服务")).toBe("售后服务")
    expect(normalizeTitle("（二）公司资质、荣誉！").length).toBeGreaterThan(0)
    expect(normalizeTitle("①报价一览表")).toBe("报价一览表")
  })
  it("全角空格与半角空格一并去除", () => {
    expect(normalizeTitle("技\u3000术 方 案")).toBe("技术方案")
  })
})

describe("titleSimilarity", () => {
  it("归一相等为 1，包含关系为 0.85，无关低于阈值", () => {
    expect(titleSimilarity("2.技术方案", "技术方案")).toBe(1)
    expect(titleSimilarity("技术方案", "技术方案及偏离说明")).toBe(0.85)
    expect(titleSimilarity("项目实施方案", "售后服务承诺")).toBeLessThan(0.6)
  })
})

describe("matchOutlineToDraft 三段式", () => {
  const drafts = [mk("第一章 技术方案"), mk("商务响应"), mk("项目实施")]
  it("精确命中优先并直接短路", () => {
    const m = matchOutlineToDraft("技术方案", drafts)
    expect(m.stage).toBe("exact")
    expect(m.confidence).toBe(1)
    expect(m.index).toBe(0)
  })
  it("相似命中为 fuzzy", () => {
    const m = matchOutlineToDraft("技术方案及偏离说明", drafts)
    expect(m.stage).toBe("fuzzy")
    expect(m.index).toBe(0)
  })
  it("低于阈值判 none", () => {
    const m = matchOutlineToDraft("完全不相关的标题", drafts)
    expect(m.stage).toBe("none")
    expect(m.index).toBe(null)
  })
  it("exclude 使已认领章不复用", () => {
    const m = matchOutlineToDraft("技术方案", drafts, new Set([0]))
    expect(m.index).not.toBe(0)
  })
})

describe("decideAction", () => {
  it("未命中：偏离表补表，其余自动生成", () => {
    expect(decideAction("deviation", { index: null, stage: "none", confidence: 0 })).toBe("append-deviation")
    expect(decideAction("technical", { index: null, stage: "none", confidence: 0 })).toBe("generate-missing")
  })
  it("命中：技术/偏离为参考重写，商务/架构保留不动", () => {
    const hit = { index: 0, stage: "exact", confidence: 1 } as const
    expect(decideAction("technical", hit)).toBe("draft-as-reference")
    expect(decideAction("business", hit)).toBe("keep-draft")
    expect(decideAction("architecture", hit)).toBe("keep-draft")
  })
})

describe("buildMergePlan", () => {
  const outline: OutlineTarget[] = [
    { id: "o1", title: "技术方案", kind: "technical" },
    { id: "o2", title: "商务响应", kind: "business" },
    { id: "o3", title: "偏离表", kind: "deviation" },
    { id: "o4", title: "售后服务承诺", kind: "technical" },
  ]
  const drafts = [mk("技术方案"), mk("商务响应（含资质）"), mk("多余的独立报价说明")]
  const plan = buildMergePlan(outline, drafts)

  it("逐节点给出动作与命中", () => {
    expect(plan.items[0].action).toBe("draft-as-reference")
    expect(plan.items[0].stage).toBe("exact")
    expect(plan.items[1].action).toBe("keep-draft")
    expect(plan.items[2].action).toBe("append-deviation")
    expect(plan.items[3].action).toBe("generate-missing")
  })
  it("统计与 extras 对齐：命中不复用、未认领进 extras", () => {
    expect(plan.stats.total).toBe(4)
    expect(plan.stats.reference).toBe(1)
    expect(plan.stats.keep).toBe(1)
    expect(plan.stats.deviation).toBe(1)
    expect(plan.stats.generate).toBe(1)
    // 下标 0/1 被前两个节点认领，2（多余报价说明）无人认领
    expect(plan.extras).toEqual([2])
  })
})

describe("parseDraftHtml", () => {
  it("以 h1/h2 为章边界切分并去标签", () => {
    const chapters = parseDraftHtml(
      "<h1>技术方案</h1><p>第一段</p><p>第二段</p><h2>商务响应</h2><p>资质&amp;荣誉</p>",
    )
    expect(chapters.length).toBe(2)
    expect(chapters[0].title).toBe("技术方案")
    expect(chapters[0].content).toContain("第一段")
    expect(chapters[1].title).toBe("商务响应")
    expect(chapters[1].content).toBe("资质&荣誉")
  })
  it("无标题整段作单章；空输入返回空数组", () => {
    const one = parseDraftHtml("<p>只有一段正文</p>")
    expect(one.length).toBe(1)
    expect(one[0].content).toBe("只有一段正文")
    expect(parseDraftHtml("   ")).toEqual([])
  })
})

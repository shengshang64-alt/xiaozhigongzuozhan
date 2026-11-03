import { describe, expect, it, vi } from "vitest"
import {
  DeckOutlineSchema,
  ChartDataSchema,
  TableDataSchema,
  safeParse,
  SLIDE_KINDS,
} from "./deckSchema"
import { buildSlideContentMessages, buildDeckBatchMessages, normalizeSlidePlan, inferKindFromTitle } from "./pptQuoteTypes"
import { generateSlidesByPage, layoutOfKind, contentToSlide } from "./deckPageGen"
import { suggestReshape } from "./deckReshape"
import type { Slide } from "./pptQuoteTypes"

// ---------------------------------------------------------------------------
// 阶段 1 验收测试（2026-10-30）
//
// 对应需求里明确指出的 5 个问题，逐条证明已修复：
//   ① 大纲 role/intent/kind/sourceRefs 完整传递
//   ② buildDeckBatchMessages 不再用 bullets 作统一示例
//   ③ 删除"视觉页必须 60%"硬配额，禁止编造数据
//   ④ Schema 校验 + 单页重试（不再依赖 parseJsonLoose 硬吞）
//   ⑤ reshape 只出建议，不自动改语义
// ---------------------------------------------------------------------------

const ctx = {
  deckType: "planning" as const,
  topic: "遂溪县中医院信息化汇报",
  audience: "院领导",
  keyPoints: "",
  materialText: "年门诊量 42 万人次，编制床位 300 张",
}

// ===========================================================================
// ① 大纲字段传递
// ===========================================================================
describe("问题①：大纲字段完整传递到逐页生成", () => {
  it("normalizeSlidePlan 保留 role/kind/sourceRefs/estimatedContent（原实现只留 title/intent）", () => {
    const raw = {
      slides: [
        {
          id: "o1",
          title: "以 5 级病历为锚点重塑数据底座",
          role: "context",
          intent: "建立现状共识",
          kind: "kpi",
          sourceRefs: [{ chunkId: "c1", materialName: "可研报告.docx", excerpt: "年门诊量 42 万" }],
          estimatedContent: 80,
        },
      ],
    }
    const plan = normalizeSlidePlan(raw, 10)
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({
      id: "o1",
      kind: "kpi",
      role: "context",
      intent: "建立现状共识",
      estimatedContent: 80,
    })
    expect(plan[0].sourceRefs).toHaveLength(1)
    expect(plan[0].sourceRefs?.[0].chunkId).toBe("c1")
  })

  it("缺 kind 时按标题推断，而不是退回 bullets", () => {
    expect(inferKindFromTitle("总体技术架构分层设计", 3, 10)).toBe("architecture")
    expect(inferKindFromTitle("项目交付流程与阶段", 4, 10)).toBe("flow")
    expect(inferKindFromTitle("现状与目标对照表", 5, 10)).toBe("table")
    expect(inferKindFromTitle("随便一个论述标题", 6, 10)).toBe("bullets")
  })

  it("结构信号优先于位置：单页大纲里「实施路径」不被误判成封面", () => {
    expect(inferKindFromTitle("实施路径与步骤", 0, 1)).toBe("flow")
  })

  it("kind 给了非法值 → 推断兜底，不丢整页", () => {
    const plan = normalizeSlidePlan({ slides: [{ title: "实施路径与步骤", kind: "timeline" }] }, 3)
    expect(plan).toHaveLength(1)
    expect(plan[0].kind).toBe("flow")
  })

  it("逐页提示词里带上既定 kind 与素材引用", () => {
    const plan = {
      id: "o1",
      title: "一体化数据底座是过 5 级的先决条件",
      intent: "讲架构",
      kind: "architecture" as const,
      role: "answer" as const,
      sourceRefs: [{ chunkId: "c1", materialName: "可研报告.docx", excerpt: "三套字典不统一", kind: "content" as const }],
    }
    const msgs = buildSlideContentMessages(ctx, plan, ["封面", plan.title])
    const sys = msgs[0].content
    expect(sys).toContain('kind="architecture"')
    expect(sys).toContain("不得改回 bullets")
    expect(sys).toContain("可研报告.docx")
    // user 侧带素材片段
    expect(msgs[1].content).toContain("三套字典不统一")
  })
})

// ===========================================================================
// ② 不再用 bullets 统一示例
// ===========================================================================
describe("问题②：批生成示例按 kind 区分", () => {
  it("architecture 页的示例是 architecture，不是 bullets", () => {
    const plan = [{ id: "a", title: "分层架构", intent: "", kind: "architecture" as const }]
    const sys = buildDeckBatchMessages(ctx, plan, ["分层架构"])[0].content
    expect(sys).toContain('kind="architecture" 的示例')
    expect(sys).toContain('"architecture":{"layers"')
    // 不应把 bullets 作为统一示例强加
    expect(sys).not.toContain('"layout":"bullets"')
  })

  it("chart 页的示例带 chart 结构与数据来源", () => {
    const plan = [{ id: "b", title: "年度指标趋势", intent: "", kind: "chart" as const }]
    const sys = buildDeckBatchMessages(ctx, plan, ["年度指标趋势"])[0].content
    expect(sys).toContain('"chart":{"type":"bar"')
    expect(sys).toContain("dataSource")
  })
})

// ===========================================================================
// ③ 无硬配额 + 禁止编造
// ===========================================================================
describe("问题③：去掉硬配额，改为内容驱动 + 禁止编造", () => {
  it("提示词不再出现「视觉页至少 N 页 / 60%」这类配额", () => {
    const plan = [{ id: "a", title: "t", intent: "", kind: "bullets" as const }]
    const sys = buildDeckBatchMessages(ctx, plan, ["t"])[0].content
    expect(sys).not.toMatch(/视觉页.*至少\s*\d+\s*页/)
    expect(sys).not.toMatch(/60%/)
  })

  it("提示词明确禁止编造，并要求缺数据时输出待补充", () => {
    const plan = [{ id: "a", title: "t", intent: "", kind: "bullets" as const }]
    const sys = buildDeckBatchMessages(ctx, plan, ["t"])[0].content
    expect(sys).toContain("禁止编造")
    expect(sys).toContain("待补充")
    expect(sys).toContain("不要为了")
  })

  it("chart/kpi 页在提示词里被明确要求「没可靠数字就别生成图表」", () => {
    const plan = {
      id: "a",
      title: "关键指标",
      intent: "",
      kind: "chart" as const,
    }
    const sys = buildSlideContentMessages(ctx, plan, ["关键指标"])[0].content
    expect(sys).toContain("素材里没有可靠数字时")
  })
})

// ===========================================================================
// ④ Schema 校验 + 单页重试
// ===========================================================================
describe("问题④：Schema 校验与单页失败隔离", () => {
  it("大纲缺 kind → 校验失败并指出字段路径", () => {
    const r = safeParse(DeckOutlineSchema, { slides: [{ id: "a", title: "标题" }] })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.issues[0].path).toBe("slides.0.kind")
      expect(r.message).toContain("页面类型必须是")
    }
  })

  it("图表类目数与数值数不一致 → 校验失败并指出是第几组", () => {
    const r = safeParse(ChartDataSchema, {
      type: "bar",
      categories: ["2024", "2025", "2026"],
      series: [{ name: "s", data: [1, 2] }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0].path).toBe("series.0.data")
  })

  it("表格行长度与列数不一致 → 校验失败并指出第几行", () => {
    const r = safeParse(TableDataSchema, { columns: ["a", "b"], rows: [["1", "2"], ["3"]] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0].path).toBe("rows.1")
  })

  it("单页生成：一页失败只重试该页，不影响其他页", async () => {
    const plan = [
      { id: "p1", title: "第一页", intent: "", kind: "bullets" as const },
      { id: "p2", title: "第二页", intent: "", kind: "bullets" as const },
      { id: "p3", title: "第三页", intent: "", kind: "bullets" as const },
    ]
    const calls: string[] = []
    const callLlm = vi.fn(async (msgs: { role: string; content: unknown }[]) => {
      const sys = String(msgs[0].content ?? "")
      // 从「本页任务】只生成第 N 页「标题」」里取标题
      const m = /只生成第 \d+ 页「([^」]+)」/.exec(sys)
      const title = m?.[1] ?? "?"
      calls.push(title)
      // 第二页永远返回非法结构 → 触发重试后失败
      if (title === "第二页") return JSON.stringify({ slides: [{ title: "x" }] })
      return JSON.stringify({
        slides: [{ id: title, title, kind: "bullets", bullets: ["要点一", "要点二"], notes: "讲稿" }],
      })
    })
    const results = await generateSlidesByPage({
      plan,
      allTitles: plan.map((p) => p.title),
      concurrency: 1,
      maxAttempts: 2,
      buildMessages: (p) => [{ role: "system", content: `只生成第 1 页「${p.title}」` }],
      callLlm,
    })
    expect(results).toHaveLength(3)
    expect(results[0].slide).toBeTruthy()
    expect(results[1].slide).toBeNull() // 第二页失败
    expect(results[2].slide).toBeTruthy() // 第三页不受影响
    // 第二页被重试了 2 次
    expect(calls.filter((c) => c === "第二页")).toHaveLength(2)
  })

  it("kind 与大纲不一致时以大纲为准，并记入 pendingFields", () => {
    const plan = { id: "p1", title: "分层架构页", intent: "", kind: "architecture" as const }
    const content = {
      id: "p1",
      title: "分层架构页",
      kind: "bullets" as const, // 模型偷懒改回 bullets
      bullets: ["a", "b"],
      notes: "",
      imageHint: "",
      sourceRefs: [],
      pendingFields: [],
    }
    const slide = contentToSlide(content, plan)
    expect(slide.layout).toBe("image-right") // 按 architecture 该走的布局
    expect(slide.pendingFields?.some((p) => p.includes("原计划为 architecture"))).toBe(true)
  })
})

// ===========================================================================
// ⑤ reshape 只出建议
// ===========================================================================
describe("问题⑤：reshape 只出建议，不自动改语义", () => {
  const mk = (p: Partial<Slide> & { title: string; bullets: string[] }): Slide => ({
    id: p.title,
    notes: "",
    ...p,
  })

  it("suggestReshape 返回建议但不修改原数组", () => {
    const slides = [
      mk({ title: "关键指标", bullets: ["病历完整率 82%", "医嘱闭环率 65%", "影像调阅率 40%"] }),
    ]
    const before = JSON.stringify(slides)
    const suggestions = suggestReshape(slides)
    expect(JSON.stringify(slides)).toBe(before) // 原数据未被改动
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions[0].suggestedKind).toBeTruthy()
    expect(suggestions[0].reason).toBeTruthy()
  })

  it("已有视觉形态的页不给建议", () => {
    const slides = [
      mk({
        title: "已有图表",
        bullets: [],
        chart: { type: "bar", title: "t", categories: ["a", "b"], series: [{ name: "s", data: [1, 2] }] },
      }),
    ]
    expect(suggestReshape(slides)).toHaveLength(0)
  })
})

// ===========================================================================
// 附：kind/layout 映射完整性
// ===========================================================================
describe("kind → layout 映射覆盖全部类型", () => {
  it("每个 kind 都有确定的布局", () => {
    for (const k of SLIDE_KINDS) {
      expect(layoutOfKind(k)).toBeTruthy()
    }
    expect(layoutOfKind("kpi")).toBe("kpi")
    expect(layoutOfKind("chart")).toBe("chart")
    expect(layoutOfKind("architecture")).toBe("image-right")
    expect(layoutOfKind("section")).toBe("section")
  })
})

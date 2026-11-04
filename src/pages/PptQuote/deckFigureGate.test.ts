// ---------------------------------------------------------------------------
// 配图能力门单测（2026-11-04，D 项）
//
// 钉住用户约束：「Key 可能为空或余额不足——缺图时必须兜底，别卡死，别静默。」
// 重点不是"能不能搜到图"，而是**没有能力时不要发起远程请求**这一件事。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import type { Slide } from "./pptQuoteTypes"
import type { SlideVisualPlan, VisualType } from "./deckVisualPlan"
import {
  detectFigureCapability,
  figureCapabilityNotice,
  planFigureActions,
  summarizeFigurePlan,
  type FigureProbe,
} from "./deckFigureGate"

function slide(title: string, extra: Partial<Slide> = {}): Slide {
  return { id: title, title, bullets: [], notes: "", ...extra }
}

function vp(page: number, visualType: VisualType, query = "查询词"): SlideVisualPlan {
  return { page, visualType, purpose: "p", placement: "right", query, reason: "r", hasSource: false }
}

const NO_KEY: FigureProbe = { searchKey: () => "", aiConfigured: () => false }
const SEARCH_ONLY: FigureProbe = { searchKey: () => "pk-xxx", aiConfigured: () => false }
const BOTH: FigureProbe = { searchKey: () => "pk-xxx", aiConfigured: () => true }
const AI_ONLY: FigureProbe = { searchKey: () => "", aiConfigured: () => true }

describe("detectFigureCapability · 能力探测", () => {
  it("全无 Key：两项都不可用，reason 是中文且指明去哪配", () => {
    const cap = detectFigureCapability(NO_KEY, "pexels", "search+ai")
    expect(cap.search.ok).toBe(false)
    expect(cap.ai.ok).toBe(false)
    expect(cap.search.reason).toContain("Pexels")
    expect(cap.search.reason).toContain("API Key")
    expect(cap.ai.reason).toContain("AI 生图")
  })

  it("只有搜图 Key：搜图可用、生图不可用", () => {
    const cap = detectFigureCapability(SEARCH_ONLY, "pixabay", "search+ai")
    expect(cap.search.ok).toBe(true)
    expect(cap.ai.ok).toBe(false)
    expect(cap.search.reason).toContain("Pixabay")
  })

  it("mode=search 时 AI 一律视为未开启（不误报未配置）", () => {
    const cap = detectFigureCapability(BOTH, "unsplash", "search")
    expect(cap.ai.ok).toBe(false)
    expect(cap.ai.reason).toContain("未开启")
  })

  it("Key 只有空白字符 → 视为未配置（不拿空格当 Key）", () => {
    const cap = detectFigureCapability({ searchKey: () => "   ", aiConfigured: () => false }, "pexels", "search")
    expect(cap.search.ok).toBe(false)
  })
})

describe("planFigureActions · 每页动作", () => {
  const slides = [
    slide("封面"),
    slide("痛点：数据孤岛"),
    slide("一体化平台架构"),
    slide("未来智慧医院场景"),
    slide("已有图片的页", { image: "data:image/png;base64,xx" }),
    slide("产品界面"),
  ]
  const plan = [
    vp(1, "none"),
    vp(2, "stockPhoto", "医院门诊大厅"),
    vp(3, "vectorDiagram"),
    vp(4, "aiIllustration", "智慧医院未来场景"),
    vp(5, "stockPhoto"),
    vp(6, "productScreenshot"),
  ]

  it("全无 Key：不发起任何远程请求，需要位图的页走 fallback", () => {
    const cap = detectFigureCapability(NO_KEY, "pexels", "search+ai")
    const r = planFigureActions({ slides, visualPlan: plan, mode: "search+ai", capability: cap })
    expect(r.remoteCount).toBe(0)
    // 第 2 页（实拍）与第 4 页（AI 插画）走兜底；第 5 页已有图、第 6 页只能用上传截图
    expect(r.actions.filter((a) => a.action === "fallback").length).toBe(2)
    expect(r.actions.filter((a) => a.action === "skip").length).toBe(4) // 1/3/5/6 页
    expect(r.canProceed).toBe(true) // 还能给出兜底计划，不算失败
  })

  it("mode=off：全部 skip，一页都不试", () => {
    const cap = detectFigureCapability(BOTH, "pexels", "off")
    const r = planFigureActions({ slides, visualPlan: plan, mode: "off", capability: cap })
    expect(r.remoteCount).toBe(0)
    expect(r.fallbackCount).toBe(0)
    expect(r.actions.every((a) => a.action === "skip")).toBe(true)
  })

  it("只有搜图 Key：AI 插画页降级为搜图（不是失败）", () => {
    const cap = detectFigureCapability(SEARCH_ONLY, "pexels", "search+ai")
    const r = planFigureActions({ slides, visualPlan: plan, mode: "search+ai", capability: cap })
    const aiPage = r.actions.find((a) => a.index === 3)
    expect(aiPage?.action).toBe("search")
    expect(aiPage?.reason).toContain("降级")
  })

  it("只有生图 Key：实拍页 fallback，插画页走 ai", () => {
    const cap = detectFigureCapability(AI_ONLY, "pexels", "search+ai")
    const r = planFigureActions({ slides, visualPlan: plan, mode: "search+ai", capability: cap })
    expect(r.actions.find((a) => a.index === 3)?.action).toBe("ai")
    expect(r.actions.find((a) => a.index === 1)?.action).toBe("fallback")
  })

  it("已有图片 / 无需配图 / 自绘图示 / 产品界面 一律 skip 且原因可读", () => {
    const cap = detectFigureCapability(BOTH, "pexels", "search+ai")
    const r = planFigureActions({ slides, visualPlan: plan, mode: "search+ai", capability: cap })
    for (const idx of [0, 2, 4, 5]) {
      const a = r.actions.find((x) => x.index === idx)
      expect(a?.action).toBe("skip")
      expect(a?.reason.length).toBeGreaterThan(0)
    }
    expect(r.actions.find((a) => a.index === 5)?.reason).toContain("上传截图")
  })

  it("fallback 页不带 query（不进搜图队列）", () => {
    const cap = detectFigureCapability(NO_KEY, "pexels", "search+ai")
    const r = planFigureActions({ slides, visualPlan: plan, mode: "search+ai", capability: cap })
    for (const a of r.actions.filter((x) => x.action === "fallback")) expect(a.query).toBe("")
  })

  it("maxPages 上限生效：拦截的页按 skip 记账，不算失败", () => {
    const many = Array.from({ length: 20 }, (_, i) => slide(`页${i}`))
    const manyPlan = many.map((_, i) => vp(i + 1, "stockPhoto"))
    const cap = detectFigureCapability(SEARCH_ONLY, "pexels", "search")
    const r = planFigureActions({ slides: many, visualPlan: manyPlan, mode: "search", capability: cap, maxPages: 5 })
    expect(r.remoteCount).toBe(5)
    expect(r.actions.filter((a) => /超过单次自动配图上限/.test(a.reason)).length).toBe(15)
  })

  it("无视觉计划的页 skip（不按标题瞎搜）", () => {
    const cap = detectFigureCapability(BOTH, "pexels", "search")
    const r = planFigureActions({ slides: [slide("无计划页")], visualPlan: [], mode: "search", capability: cap })
    expect(r.actions[0].action).toBe("skip")
    expect(r.remoteCount).toBe(0)
  })
})

describe("summarizeFigurePlan / figureCapabilityNotice · 人话提示", () => {
  it("摘要给出搜图/插画/兜底页数，不出现英文错误码", () => {
    const cap = detectFigureCapability(SEARCH_ONLY, "pexels", "search+ai")
    const actions = planFigureActions({
      slides: [slide("a"), slide("b")],
      visualPlan: [vp(1, "stockPhoto"), vp(2, "aiIllustration")],
      mode: "search+ai",
      capability: cap,
    }).actions
    const text = summarizeFigurePlan(actions, cap, "search+ai")
    expect(text).toContain("配图计划")
    expect(text).toMatch(/搜图/)
    expect(text).not.toMatch(/Error|undefined|null/)
  })

  it("两项都缺 → 一句人话说明不联网配图、用系统图示兜底、去哪配", () => {
    const cap = detectFigureCapability(NO_KEY, "pexels", "search+ai")
    const notice = figureCapabilityNotice(cap, "search+ai")
    expect(notice).toContain("系统图示")
    expect(notice).toContain("API Key")
  })

  it("能力齐全 / 模式关闭 → 不需要提示（空串）", () => {
    expect(figureCapabilityNotice(detectFigureCapability(BOTH, "pexels", "search+ai"), "search+ai")).toBe("")
    expect(figureCapabilityNotice(detectFigureCapability(NO_KEY, "pexels", "off"), "off")).toBe("")
  })

  it("只缺 AI 生图 → 说明可退回搜图（不阻断）", () => {
    const notice = figureCapabilityNotice(detectFigureCapability(SEARCH_ONLY, "pexels", "search+ai"), "search+ai")
    expect(notice).toContain("搜图")
  })
})

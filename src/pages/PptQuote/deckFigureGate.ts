// ---------------------------------------------------------------------------
// 配图能力门（2026-11-04，D 项）
//
// 用户约束原文：「硅基生图/搜图 Key 可能为空或余额不足——缺图时必须 reshape/自绘兜底，
// 日志写清原因，UI 给一句人话提示。」
//
// 原实现的问题（实测）：
//   · runAutoFigure 无论有没有 Key 都逐页发起搜图/生图请求，缺 Key 时 12 页各失败一次，
//     日志里 12 条同样的 "未配置 Pexels API Key"，用户只看到最后一条；
//   · AI 生图未配置时同样逐页试，每页都要等一次网络往返（超时叠起来像卡死）；
//   · 失败的页既没有图、也没被标记"该走系统图示兜底"，用户以为功能坏了。
//
// 本模块只做**决策**（纯函数，不调 API、不写 DOM）：先问"有没有能力"，再排"每页怎么办"，
// 最后给一句人话。执行仍由 usePptQuote 的 runAutoFigure 按这份计划跑。
// ---------------------------------------------------------------------------

import type { Slide } from "./pptQuoteTypes"
import type { SlideVisualPlan, VisualType } from "./deckVisualPlan"

/** 配图模式（与向导开关一致） */
export type FigureMode = "off" | "search" | "search+ai"

/** 单项能力：ok=false 时 reason 必须是能直接给用户看的中文 */
export interface FigureCapabilityItem {
  ok: boolean
  /** 能力名（用于文案，如「图库」「AI 生图」） */
  label: string
  reason: string
}

export interface FigureCapability {
  search: FigureCapabilityItem & { provider: string }
  ai: FigureCapabilityItem
}

/** 每页的配图动作 */
export type FigureAction = "skip" | "search" | "ai" | "fallback"

export interface FigurePageAction {
  /** 0 基页序（与 slides 数组对齐） */
  index: number
  /** 1 基页码（展示用） */
  page: number
  title: string
  action: FigureAction
  /** 搜索/生图用的 query（fallback/skip 时为空串） */
  query: string
  /** 为什么是这个动作（中文，可审计） */
  reason: string
}

export interface FigurePlan {
  actions: FigurePageAction[]
  /** 实际会发起远程请求的页数（search + ai） */
  remoteCount: number
  /** 改走系统图示/整形兜底的页数 */
  fallbackCount: number
  /** 一句话人话摘要（可直接 toast） */
  summary: string
  /** 能力门本身是否允许继续（两项都不可用时给出提示后直接返回） */
  canProceed: boolean
}

/** 探测依赖（注入以便单测，不直接读 localStorage） */
export interface FigureProbe {
  /** 图库 Key（空串=未配置） */
  searchKey: (provider: string) => string
  /** AI 生图是否已配置 */
  aiConfigured: () => boolean
}

/** 图库 provider 的中文名（提示文案用） */
const PROVIDER_LABEL: Record<string, string> = {
  pexels: "Pexels",
  unsplash: "Unsplash",
  pixabay: "Pixabay",
}

/**
 * 探测当前配图能力。
 *
 * 口径：Key 为空 = 该能力不可用（余额不足只能在真正调用时才知道，那种情况由调用方
 * catch 后记原因，本函数不假装能探测余额）。
 */
export function detectFigureCapability(probe: FigureProbe, provider: string, mode: FigureMode): FigureCapability {
  const key = (probe.searchKey(provider) || "").trim()
  const searchOk = Boolean(key)
  const aiOn = mode === "search+ai"
  const aiOk = aiOn && probe.aiConfigured()
  return {
    search: {
      ok: searchOk,
      label: "图库搜图",
      provider,
      reason: searchOk
        ? `已配置 ${PROVIDER_LABEL[provider] ?? provider} Key`
        : `未配置 ${PROVIDER_LABEL[provider] ?? provider} API Key（逐页编辑 → API Key 面板可填）`,
    },
    ai: {
      ok: aiOk,
      label: "AI 生图",
      reason: aiOn
        ? aiOk
          ? "已配置 AI 生图"
          : "AI 生图未配置（只影响抽象概念页，其余页仍走搜图）"
        : "AI 生图未开启（当前模式不生成插画）",
    },
  }
}

/** 这些 visualType 需要真实位图；其余（自绘图示/图表/不配图）不需要远程请求 */
function needsBitmap(t: VisualType): boolean {
  return t === "stockPhoto" || t === "aiIllustration" || t === "companyAsset" || t === "productScreenshot"
}

/**
 * 按能力与视觉计划排出每页动作。
 *
 * 规则（宁可跳过，不可瞎试）：
 *   · mode=off → 全 skip（不自动配图，用户逐页手动）
 *   · 已有 image → skip（不动用户已有的图）
 *   · visualType=none/vectorDiagram/chart → skip（系统自绘/图表已自带视觉，配照片反而干扰）
 *   · productScreenshot → skip 并说明"只能用上传截图"（AI 生图被硬拦截，搜图也搜不到真界面）
 *   · aiIllustration：AI 可用 → ai；AI 不可用但搜图可用 → search（降级）；都不可用 → fallback
 *   · stockPhoto/companyAsset：搜图可用 → search；否则 → fallback
 *   · fallback = 不做远程请求，交给 reshape/系统图示兜底（页面仍有版面结构，不是空白）
 */
/**
 * 单次自动配图的页数上限（按册大小自适应）。
 *
 * 2026-11-04 实测调整：原实现硬编码 12 页。而解析用户磁盘上 9 份真实公司 PPT 后发现，
 * 真实方案汇报是「每页 2.6 张图、含图页占 82%」（蚌埠医科大学一附院 123 页里 103 页有图；
 * 安医阜阳 115 页里 96 页有图）。12 页上限意味着 100 页的册子里只有 12% 的页能配上图，
 * 其余全是纯文字——这正是"生成出来不像公司稿、不够图文并茂"的直接原因。
 *
 * 新口径：小册（≤20 页）全配；大册按「目标含图页比例」推算，但保留硬上限防一次跑太久。
 *   · 上限的存在是必要的（每页一次远程请求，100 页 × 2s = 3 分钟以上）；
 *   · 但上限不该低到把"图文并茂"这个产品目标直接废掉。
 * 真实稿 82% 含图页是无法在一次批量里全做到的（且有些页本就该用自绘图示），
 * 这里按 50% 起步、封顶 60 页，兼顾观感与耗时。
 */
export function autoFigurePageBudget(slideCount: number): number {
  const n = Math.max(0, Math.floor(Number(slideCount) || 0))
  if (n <= 20) return n // 小册全配（含封面/章节页会自动 skip）
  // 大册：按 50% 比例，封顶 60 页
  return Math.min(60, Math.max(12, Math.ceil(n * 0.5)))
}

export function planFigureActions(input: {
  slides: Slide[]
  visualPlan: SlideVisualPlan[]
  mode: FigureMode
  capability: FigureCapability
  /** 最多给多少页配图；不传则按 autoFigurePageBudget(slides.length) 自适应 */
  maxPages?: number
}): FigurePlan {
  const { slides, visualPlan, mode, capability } = input
  const maxPages = input.maxPages ?? autoFigurePageBudget(slides.length)
  const planByPage = new Map(visualPlan.map((p) => [p.page - 1, p]))
  const actions: FigurePageAction[] = []

  for (let i = 0; i < slides.length; i += 1) {
    const s = slides[i]
    const p = planByPage.get(i)
    const page = i + 1
    const title = s?.title ?? ""

    const push = (action: FigureAction, reason: string, query = ""): void => {
      actions.push({ index: i, page, title, action, query, reason })
    }

    if (mode === "off") {
      push("skip", "自动配图已关闭")
      continue
    }
    if (!p) {
      push("skip", "该页不在视觉计划内")
      continue
    }
    if (s.image) {
      push("skip", "该页已有图片")
      continue
    }
    if (!needsBitmap(p.visualType)) {
      push("skip", `${p.visualType === "none" ? "该页无需配图" : "该页用系统自绘图示/图表，不需要位图"}`)
      continue
    }
    if (p.visualType === "productScreenshot") {
      push("skip", "真实产品界面只能用上传截图，不搜图也不生图")
      continue
    }

    const query = (p.query || s.title || "").trim()
    // 排队上限：超出不记账（避免用户以为"这页失败了"）
    if (actions.filter((a) => a.action === "search" || a.action === "ai").length >= maxPages) {
      push("skip", `超过单次自动配图上限 ${maxPages} 页`)
      continue
    }

    if (p.visualType === "aiIllustration") {
      if (capability.ai.ok) {
        push("ai", "抽象概念页走 AI 插画", query)
      } else if (capability.search.ok) {
        push("search", `${capability.ai.reason}，已降级为搜图`, query)
      } else {
        push("fallback", `${capability.ai.reason}；${capability.search.reason}，改走系统图示兜底`)
      }
      continue
    }

    // stockPhoto / companyAsset：公司素材页搜图命中本地素材库优先，失败也不阻断
    if (capability.search.ok) {
      push("search", `按视觉计划搜图（${capability.search.reason}）`, query)
    } else {
      push("fallback", `${capability.search.reason}，改走系统图示兜底`)
    }
  }

  const remoteCount = actions.filter((a) => a.action === "search" || a.action === "ai").length
  const fallbackCount = actions.filter((a) => a.action === "fallback").length
  const canProceed = remoteCount > 0 || fallbackCount > 0
  return {
    actions,
    remoteCount,
    fallbackCount,
    canProceed,
    summary: summarizeFigurePlan(actions, capability, mode),
  }
}

/** 把计划压成一句人话（可直接 toast；不写英文错误码） */
export function summarizeFigurePlan(
  actions: FigurePageAction[],
  capability: FigureCapability,
  mode: FigureMode,
): string {
  if (mode === "off") return "自动配图已关闭，逐页手动选图"
  const search = actions.filter((a) => a.action === "search").length
  const ai = actions.filter((a) => a.action === "ai").length
  const fallback = actions.filter((a) => a.action === "fallback").length
  const skip = actions.filter((a) => a.action === "skip" && /无需配图|自绘图示/.test(a.reason)).length
  const bits: string[] = []
  if (search) bits.push(`${search} 页搜图`)
  if (ai) bits.push(`${ai} 页 AI 插画`)
  if (fallback) {
    const bySearch = capability.search.ok ? "" : "（缺图库 Key）"
    const byAi = capability.ai.ok ? "" : "（缺 AI 生图）"
    bits.push(`${fallback} 页改走系统图示兜底${bySearch || byAi}`)
  }
  if (skip) bits.push(`${skip} 页自带图示无需配图`)
  if (!bits.length) return "没有需要配图的页"
  return `配图计划：${bits.join("，")}`
}

/**
 * 缺 Key 时给用户的**一句人话**（UI 直接 toast，不含英文错误码）。
 * 返回空串表示不需要提示（能力齐全）。
 */
export function figureCapabilityNotice(capability: FigureCapability, mode: FigureMode): string {
  if (mode === "off") return ""
  if (capability.search.ok && (mode !== "search+ai" || capability.ai.ok)) return ""
  if (!capability.search.ok && mode === "search+ai" && !capability.ai.ok) {
    return "还没配置图库 Key 和 AI 生图 Key：本次不联网配图，页面用系统图示（架构/流程/图表）兜底。可在「逐页编辑 → API Key 面板」填写后重试。"
  }
  if (!capability.search.ok) {
    return `还没配置图库 Key：搜索结果会为空，页面用系统图示兜底。可在「逐页编辑 → API Key 面板」填写 ${PROVIDER_LABEL[capability.search.provider] ?? capability.search.provider} Key 后重试。`
  }
  return "AI 生图还没配置：抽象概念页会退回搜图，不影响生成。可在「逐页编辑 → AI 生图」里配置模型与 Key。"
}

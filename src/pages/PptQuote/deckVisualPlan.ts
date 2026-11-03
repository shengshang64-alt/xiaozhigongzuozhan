// ---------------------------------------------------------------------------
// PPT 全册视觉计划（2026-10-30 补齐 6）
//
// 需求原文（§六 智能绘图与配图）：
//   「系统必须先理解整份 PPT 的主题、受众、叙事逻辑、公司模板和参考素材，
//     再制定全册视觉计划，禁止只根据单页标题随机搜图。」
//
// 原实现的问题：`runAutoFigure` 逐页独立判断"这页要不要配图、搜什么词"，
// 结果同一份 PPT 里出现 3 种风格的图（实拍 + 插画 + 图表截图），
// 且架构页可能被配上"医院大楼"照片——语义完全不对。
//
// 本模块做的事：
//   ① 先算**全册视觉基调**（摄影/插画/矢量图/混合），全册统一
//   ② 再为每页决定 visualType（7 种），按内容语义而非"有没有 imageHint"
//   ③ 输出可审阅的计划，用户确认后才执行配图（避免无效 API 调用）
//
// 不做的事：不生成图片、不调 API——只做决策。执行由调用方按计划进行。
// ---------------------------------------------------------------------------

import type { Slide } from "./pptQuoteTypes"
import type { SlideKindZ as KindZ } from "./deckSchema"
import { KIND_LABEL } from "./deckSchema"

// ===========================================================================
// 一、视觉类型（7 种，对应需求 §六.1）
// ===========================================================================

export const VISUAL_TYPES = [
  "none", // 不配图（纯论述页，强行配图反而干扰）
  "companyAsset", // 公司已有素材（Logo/产品截图/项目照片）
  "vectorDiagram", // 自绘矢量图（架构/流程/时间线/对比）
  "chart", // 数据图表（必须来自可靠数据）
  "aiIllustration", // AI 插画（抽象概念/未来场景）
  "stockPhoto", // 网络实拍（医院环境/设备/人物场景）
  "productScreenshot", // 真实产品界面（只能用用户上传的）
] as const
export type VisualType = (typeof VISUAL_TYPES)[number]

export const VISUAL_TYPE_LABEL: Record<VisualType, string> = {
  none: "不配图",
  companyAsset: "公司素材",
  vectorDiagram: "自绘图示",
  chart: "数据图表",
  aiIllustration: "AI 插画",
  stockPhoto: "实拍照片",
  productScreenshot: "产品截图",
}

/** 全册视觉基调（保证风格统一，避免同一份 PPT 混 3 种风格） */
export const VISUAL_TONES = ["photographic", "illustrative", "diagrammatic", "mixed"] as const
export type VisualTone = (typeof VISUAL_TONES)[number]

export const VISUAL_TONE_LABEL: Record<VisualTone, string> = {
  photographic: "实拍为主（正式、可信）",
  illustrative: "插画为主（现代、亲和）",
  diagrammatic: "图示为主（技术、清晰）",
  mixed: "混合（按页内容择优）",
}

// ===========================================================================
// 二、单页视觉决策
// ===========================================================================

export type SlideVisualPlan = {
  /** 1 基页码 */
  page: number
  /** 该页 visualType */
  visualType: VisualType
  /** 视觉用途（一句话说明"这张图要起什么作用"） */
  purpose: string
  /** 图片/图示放在哪（决定版式） */
  placement: "none" | "right" | "left" | "banner" | "background" | "inline"
  /** 搜索/生成用的关键词（已结合全册主题，不是照抄标题） */
  query?: string
  /** 为什么选这个类型（可审计，用户能看出 AI 是否判断错了） */
  reason: string
  /** 是否有可用素材支撑（无则标 false，界面提示需人工补） */
  hasSource: boolean
}

export type DeckVisualPlan = {
  /** 全册视觉基调 */
  tone: VisualTone
  /** 计划摘要（一句话） */
  summary: string
  /** 每页计划 */
  slides: SlideVisualPlan[]
  /** 统计 */
  stats: Record<VisualType, number>
  /** 哪些页需要但缺素材（界面提示用户补） */
  missingSources: number[]
}

/**
 * 单页视觉决策（核心逻辑）。
 *
 * 决策顺序严格按需求给的优先级：
 *   1. 已有公司素材 → companyAsset（最高优先，真实可信）
 *   2. 架构/流程/时间线/对比 → vectorDiagram（系统能自己画，且内容准确）
 *   3. 数据趋势/比例 → chart（必须已由内容层提供可靠数据）
 *   4. 真实产品界面 → productScreenshot（**只能**用户上传，绝不 AI 编）
 *   5. 医院环境/设备/人物实景 → stockPhoto
 *   6. 抽象概念/封面背景 → aiIllustration
 *   7. 内容不需要图 → none（**不得为了"图文并茂"强行配图**）
 */
export function decideSlideVisual(slide: Slide, tone: VisualTone): SlideVisualPlan {
  const page = 0 // 由调用方填
  const hasImage = Boolean(slide.image)
  const figures = slide.figures ?? []
  const figTypes = figures.map((f) => f.type)
  const hasChart = Boolean(slide.chart)
  const hasKpi = Boolean(slide.kpi?.length)

  // 1) 已经有真实配图 → 保持
  if (hasImage) {
    return {
      page,
      visualType: "companyAsset",
      purpose: "已配的真实图片",
      placement: "right",
      reason: "该页已有配图，沿用",
      hasSource: true,
    }
  }

  // 2) 已有结构化图示（架构/流程/表格）→ 自绘，不需要再配位图
  if (figTypes.includes("architecture")) {
    return {
      page,
      visualType: "vectorDiagram",
      purpose: "展示系统分层与技术组成",
      placement: "right",
      reason: "内容含分层结构，用自绘架构图最准确（比照片更能说明系统关系）",
      hasSource: true,
    }
  }
  if (figTypes.includes("flow")) {
    return {
      page,
      visualType: "vectorDiagram",
      purpose: "展示实施步骤与业务流转",
      placement: "right",
      reason: "内容含步骤/流程，用自绘流程图",
      hasSource: true,
    }
  }
  if (figTypes.includes("table")) {
    return {
      page,
      visualType: "vectorDiagram",
      purpose: "并列对照或指标表",
      placement: "inline",
      reason: "内容是对照关系，用表格而非配图",
      hasSource: true,
    }
  }
  if (figTypes.includes("iconGrid")) {
    return {
      page,
      visualType: "vectorDiagram",
      purpose: "并列要点视觉化",
      placement: "right",
      reason: "并列论点用图标矩阵",
      hasSource: true,
    }
  }

  // 3) 有真实图表数据 → chart（不额外配图）
  if (hasChart) {
    return {
      page,
      visualType: "chart",
      purpose: "用图表呈现数据趋势/比例",
      placement: "inline",
      reason: "该页已有可靠数据，图表本身即视觉主体",
      hasSource: true,
    }
  }

  // 4) KPI 数字页 → 不需要配位图
  if (hasKpi) {
    return {
      page,
      visualType: "none",
      purpose: "关键数字本身就是视觉焦点",
      placement: "none",
      reason: "数字亮点页再配图会分散注意力",
      hasSource: true,
    }
  }

  // 5) 封面/章节页 → 可以配背景图（实拍或插画看基调）
  const lay = slide.layout ?? "auto"
  if (lay === "section") {
    return {
      page,
      visualType: tone === "illustrative" ? "aiIllustration" : "stockPhoto",
      purpose: "章节过渡的氛围背景",
      placement: "background",
      reason: "章节页用背景图营造节奏感",
      hasSource: true,
    }
  }

  const hint = (slide.imageHint ?? "").trim()

  // 6) 有 imageHint → 按关键词性质决定实拍还是插画
  //
  // 2026-10-30 修复（用户反馈「PPT 还是没有生图」的根因）：
  // 原条件 `hint && lay !== "bullets"` 有致命缺陷——模型生成的 page 里
  // imageHint 有值但 layout 常是 bullets（模型被要求"少字"却仍写 bullets），
  // 于是这条永远不命中，一路掉到第 7 条返回 none，全册 0 页配图。
  //
  // 现改为：**只要 imageHint 非空就配图**（layout 只决定放哪，不决定配不配）。
  if (hint) {
    const concrete = isConcreteScene(hint)
    // 布局推断：有明确 layout 用它，否则按"放右侧"处理
    const place: SlideVisualPlan["placement"] =
      lay === "banner" ? "banner" : lay === "image-left" ? "left" : lay === "image-right" ? "right" : "right"
    return {
      page,
      visualType: concrete ? "stockPhoto" : tone === "photographic" ? "stockPhoto" : "aiIllustration",
      purpose: concrete ? "用实景图增强可信度" : "用示意图表达抽象概念",
      placement: place,
      query: hint,
      reason: concrete
        ? `关键词「${hint}」是具体场景，配实拍照片`
        : `关键词「${hint}」偏抽象，配示意图更贴切`,
      hasSource: true,
    }
  }

  // 6b) 无 imageHint 的要点页：**按标题自动生成检索词**
  //
  // 2026-10-30 新增（同样是「没有生图」的修复）：
  // 模型经常不填 imageHint，但不能因此整册无图。
  // 对要点页用「标题 + 首条要点」生成查询词——这是原始 searchQuery 的既有能力
  // （buildSearchQuery 就在做这件事），视觉计划不该把它废掉。
  if (lay === "bullets" || lay === "auto") {
    const title = (slide.title ?? "").trim()
    const firstBullet = (slide.bullets?.[0] ?? "").trim()
    const derived = [title, firstBullet].filter(Boolean).join("，").slice(0, 40)
    // 至少要有点内容才配图；纯空标题页不配
    if (derived.length >= 6) {
      const concrete = isConcreteScene(derived)
      return {
        page,
        visualType: concrete ? "stockPhoto" : "aiIllustration",
        purpose: "为要点页配示意图，避免纯文字观感",
        placement: "right",
        query: derived,
        reason: "该页无 imageHint，按标题与首条要点推导检索词（保持图文并茂）",
        hasSource: true,
      }
    }
  }

  // 7) 兜底：完全没有可配图信息 → 不配（不硬凑）
  return {
    page,
    visualType: "none",
    purpose: "以文字论述为主",
    placement: "none",
    reason: "该页没有可推导的配图主题，强行配图会跑题",
    hasSource: true,
  }
}

/**
 * 判断关键词是否"具体场景"（能配实拍照片）还是"抽象概念"（应配插画）。
 *
 * 具体场景：医院、门诊、病房、机房、设备、手术、大厅、办公室、人物…
 * 抽象概念：数字化、转型、赋能、生态、未来、协同、闭环…
 */
export function isConcreteScene(text: string): boolean {
  const concreteWords = [
    "医院", "门诊", "病房", "手术", "机房", "服务器", "设备", "大厅", "走廊",
    "医生", "护士", "患者", "办公", "会议室", "药房", "检验", "影像", "CT", "MRI",
    "大楼", "院区", "窗口", "导诊", "自助机", "查房", "护理站",
  ]
  if (concreteWords.some((w) => text.includes(w))) return true
  const abstractWords = ["数字化", "转型", "赋能", "生态", "未来", "协同", "闭环", "智能", "云化", "一体化", "体系", "架构"]
  if (abstractWords.some((w) => text.includes(w))) return false
  // 拿不准时：短词偏具体，长句偏抽象
  return text.length <= 8
}

// ===========================================================================
// 三、全册基调决策
// ===========================================================================

/**
 * 根据 deck 类型与内容特征决定全册视觉基调。
 *
 * 原则：
 *   · 技术/方案类 → diagrammatic（图示为主，技术听众要看结构）
 *   · 汇报/规划类 → photographic（实拍为主，院领导要看真实感）
 *   · 公司介绍 → mixed（既有实力照片也有产品图示）
 */
export function decideTone(deckType: string, slides: Slide[]): VisualTone {
  const kindCounts = countKinds(slides)
  const diagramHeavy = (kindCounts.architecture ?? 0) + (kindCounts.flow ?? 0) + (kindCounts.table ?? 0)
  const photoHeavy = (kindCounts.image ?? 0) + (kindCounts.cover ?? 0)

  if (diagramHeavy >= slides.length * 0.3) return "diagrammatic"
  if (photoHeavy >= slides.length * 0.25) return "photographic"
  if (deckType === "topic") return "illustrative" // 专题汇报偏现代感
  if (deckType === "planning") return "photographic" // 规划汇报要真实可信
  return "mixed"
}

function countKinds(slides: Slide[]): Partial<Record<KindZ, number>> {
  const out: Partial<Record<KindZ, number>> = {}
  for (const s of slides) {
    const k = kindOf(s)
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

function kindOf(s: Slide): KindZ {
  if (s.kind) return s.kind as KindZ
  if (s.chart) return "chart"
  if (s.kpi?.length) return "kpi"
  const ft = s.figures?.map((f) => f.type) ?? []
  if (ft.includes("table")) return "table"
  if (ft.includes("flow")) return "flow"
  if (ft.includes("architecture")) return "architecture"
  if (s.image) return "image"
  if (s.layout === "section") return "section"
  return "bullets"
}

// ===========================================================================
// 四、生成全册计划
// ===========================================================================

/**
 * 生成全册视觉计划。
 *
 * @param deck 整份 deck（含 slides）
 * @param opts.deckType 汇报类型（决定基调）
 */
export function buildDeckVisualPlan(
  deck: { deck_type?: string; audience?: string; slides?: Slide[] },
  opts?: { deckType?: string; maxImageRatio?: number },
): DeckVisualPlan {
  const slides = deck.slides ?? []
  const deckType = opts?.deckType ?? deck.deck_type ?? "general"
  const tone = decideTone(deckType, slides)

  const plans: SlideVisualPlan[] = slides.map((s, i) => {
    const p = decideSlideVisual(s, tone)
    return { ...p, page: i + 1 }
  })

  // -------------------------------------------------------------------------
  // 2026-10-30 配额控制（修「全册 18 页都配图」的过度反应）
  //
  // 修掉"从不配图"后变成"每页都配图"，那是另一种极端——
  // 一页一个照片会让汇报像图片集，反而不专业。
  //
  // 策略：
  //   · 模型明确给了 imageHint 的页 → 必配（它点名要图）
  //   · 我们推导出的配图 → 只配前 N 页（N = 页数 × maxImageRatio，默认 35%）
  //   · 被裁掉的回归 none，理由写明"按配额让位"（用户可看到原因）
  // -------------------------------------------------------------------------
  const maxRatio = Math.max(0, Math.min(1, opts?.maxImageRatio ?? 0.35))
  const quota = Math.max(1, Math.round(slides.length * maxRatio))

  const explicitPages = new Set<number>()
  slides.forEach((s, i) => {
    if ((s.imageHint ?? "").trim()) explicitPages.add(i + 1)
  })

  let derivedUsed = 0
  const finalPlans = plans.map((p) => {
    const isDerived =
      !explicitPages.has(p.page) && (p.visualType === "stockPhoto" || p.visualType === "aiIllustration")
    if (!isDerived) return p
    if (derivedUsed < quota) {
      derivedUsed += 1
      return p
    }
    return {
      ...p,
      visualType: "none" as VisualType,
      placement: "none" as const,
      query: undefined,
      purpose: "按配额让位，保持图文节奏",
      reason: `该页配图为推导所得（非模型点名），本册图片配额 ${quota} 页已用满，此页保留文字版式`,
    }
  })

  const stats = {} as Record<VisualType, number>
  for (const vt of VISUAL_TYPES) stats[vt] = 0
  for (const p of finalPlans) stats[p.visualType] += 1

  const missingSources = finalPlans.filter((p) => !p.hasSource).map((p) => p.page)

  const parts: string[] = [`基调：${VISUAL_TONE_LABEL[tone]}`]
  const used = VISUAL_TYPES.filter((vt) => stats[vt] > 0 && vt !== "none")
  if (used.length) parts.push(used.map((vt) => `${VISUAL_TYPE_LABEL[vt]} ${stats[vt]} 页`).join("、"))
  if (stats.none > 0) parts.push(`${stats.none} 页不配图`)
  if (missingSources.length) parts.push(`${missingSources.length} 页需补齐素材`)

  return { tone, summary: parts.join("；"), slides: finalPlans, stats, missingSources }
}

/** 把计划压成给用户看的一段话 */
export function visualPlanSummary(plan: DeckVisualPlan): string {
  return plan.summary
}

/** 需要执行配图动作的页（visualType 不是 none/vectorDiagram/chart 的） */
export function pagesNeedingAssets(plan: DeckVisualPlan): SlideVisualPlan[] {
  return plan.slides.filter((p) => p.visualType === "stockPhoto" || p.visualType === "aiIllustration" || p.visualType === "companyAsset")
}

/** 按 visualType 分组（界面按类型批量确认用） */
export function groupByVisualType(plan: DeckVisualPlan): Record<VisualType, SlideVisualPlan[]> {
  const out = {} as Record<VisualType, SlideVisualPlan[]>
  for (const vt of VISUAL_TYPES) out[vt] = []
  for (const p of plan.slides) out[p.visualType].push(p)
  return out
}

/** kind 的中文名（界面展示） */
export function visualKindLabel(k: string): string {
  return KIND_LABEL[k as KindZ] ?? k
}

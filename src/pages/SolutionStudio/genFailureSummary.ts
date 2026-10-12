// ---------------------------------------------------------------------------
// R282（delivery-p0-02 根因定位环 · 闭合 r280-generror-visibility 挂账）：
// R280 已把失败原因逐章落库（Chapter.genError），但只在大纲树红点 tooltip 一处可读——
// 整本多章同时失败时，用户要逐章悬停才知道是不是同一件事，仍答不了「模型通道/超时/额度」哪一类。
// 本模块把散落的一行行原因汇成「按归类聚合 + 逐章点名 + 单因占比」的摘要，
// 纯本地判定、零 AI 零费用、不写库：与交付前体检同口径——只报不拦。
// ---------------------------------------------------------------------------

import { BLANK_OUTPUT_REASON } from "./genFailureNote"
import type { Chapter } from "./solutionTypes"

/** 失败归因分类：对应交付链排查的几条通道，channel/quota/timeout 直接指向可执行的下一步 */
export type GenFailureCategory = "blank" | "timeout" | "channel" | "quota" | "parse" | "network" | "other"

export const GEN_FAILURE_CATEGORY_LABEL: Record<GenFailureCategory, string> = {
  blank: "模型空产出",
  timeout: "响应超时",
  channel: "模型通道/鉴权",
  quota: "额度/费用受限",
  parse: "产出解析失败",
  network: "网络异常",
  other: "其他异常",
}

/** 归类优先级：同一句原因可能同时命中多个关键字，按处置指向性从强到弱排（超时>额度>通道>解析>网络） */
const CATEGORY_PATTERNS: [GenFailureCategory, RegExp][] = [
  ["timeout", /timeout|timed?\s*out|超时|deadline|读取超时|连接超时/i],
  ["quota", /quota|insufficient|rate.?limit|余额|额度|欠费|用量上限|too many request|\b429\b/i],
  ["channel", /unauthorized|forbidden|invalid (api|token|key)|鉴权|未登录|无权限|模型不存在|渠道|\b(401|403|500|502|503|504)\b/],
  ["parse", /解析|json|parse|格式不合法|截断/i],
  ["network", /network|fetch failed|failed to fetch|econn|enotfound|eai_again|socket|连接失败|断网/i],
]

/** 旧记录（R280 之前失败未留痕）的兜底口径：大纲树 tooltip 与归因摘要共用同一句，避免一处一个说法 */
export const LEGACY_GEN_ERROR_NOTE = "旧记录未留存原因"

/** 单条原因归一化：去首尾空白、折叠内部空白，避免「同一原因因换行/空格差异被拆成多组」 */
export function normalizeGenError(reason: string | undefined | null): string {
  return (reason ?? "").replace(/\s+/g, " ").trim()
}

/**
 * 按关键字归因（纯判定，不做猜测）：空产出优先（含 R280 无原因的旧记录）；
 * 识别不出的一律 other，宁可归到「其他异常」由人看原文，也不硬塞进某个通道造成误判。
 */
export function classifyGenFailure(reason: string | undefined | null): GenFailureCategory {
  const text = normalizeGenError(reason)
  if (!text || text === BLANK_OUTPUT_REASON || text.includes("空产出") || text.includes("空正文")) return "blank"
  for (const [category, re] of CATEGORY_PATTERNS) {
    if (re.test(text)) return category
  }
  return "other"
}

/** 同因组内点名到章的上限：超出只列前 N 章并置 truncated，防整本大失败时把卡片撑爆 */
const MAX_CHAPTERS_PER_CAUSE = 8

export type GenFailureChapter = {
  nodeId: string
  title: string
  /** 落库原始原因（已归一化）；空串 = R280 之前的旧记录未留痕 */
  reason: string
  category: GenFailureCategory
}

export type GenFailureCauseGroup = {
  category: GenFailureCategory
  /** 归类中文名（驱动文案用） */
  label: string
  /** 组内代表原因原文（取组内首次出现的那句）；旧记录组为 LEGACY_GEN_ERROR_NOTE */
  detail: string
  count: number
  chapters: GenFailureChapter[]
  /** 组内点名是否被截断 */
  truncated: boolean
}

export type GenFailureSummary = {
  /** 是否存在生成失败章（驱动卡片归因区块与「一键重试失败章」按钮） */
  failedCount: number
  causes: GenFailureCauseGroup[]
  /** 首组占全部失败章的比例（0-100 取整）；仅 ≥2 章时有归因意义，否则 0 */
  dominantRatio: number
  /** 单因主导提示：全部失败章都落在同一归类时给出该归类，否则 null */
  allSameCause: GenFailureCategory | null
}

/**
 * 失败章归因摘要（纯函数，不碰 AI、不写库）：
 * 先按归类聚合（回答「属哪一类」），同归类内再按归一化原因分组（回答「是不是同一件事」），
 * 组按章数降序、并列时按归类名排，保证「最可能的根因」永远排第一。
 */
export function summarizeGenFailures(chapters: Chapter[] | undefined | null): GenFailureSummary {
  const list = chapters ?? []
  const entries = list
    .map((c, i) => ({
      nodeId: String(c.node_id ?? ""),
      title: (c.title ?? "").trim() || `第${i + 1}章`,
      reason: normalizeGenError(c.genError),
      category: classifyGenFailure(c.genError),
      status: c.gen_status,
    }))
    .filter((c) => c.status === "failed")

  // 中间累加形状（items 逐章累积，最终再映射为输出类型 GenFailureCauseGroup 的 chapters）
  type CauseAcc = {
    category: GenFailureCategory
    label: string
    detail: string
    count: number
    items: GenFailureChapter[]
  }
  const merged = new Map<string, CauseAcc>()
  for (const e of entries) {
    const detail = e.reason || LEGACY_GEN_ERROR_NOTE
    const key = `${e.category}|${detail}`
    const exist = merged.get(key)
    if (exist) {
      exist.count += 1
      exist.items.push({ nodeId: e.nodeId, title: e.title, reason: e.reason, category: e.category })
    } else {
      merged.set(key, {
        category: e.category,
        label: GEN_FAILURE_CATEGORY_LABEL[e.category],
        detail,
        count: 1,
        items: [{ nodeId: e.nodeId, title: e.title, reason: e.reason, category: e.category }],
      })
    }
  }

  const sorted = Array.from(merged.values()).sort((a, b) =>
    a.count === b.count ? a.category.localeCompare(b.category) : b.count - a.count,
  )
  const causes: GenFailureCauseGroup[] = sorted.map((g) => {
    const truncated = g.items.length > MAX_CHAPTERS_PER_CAUSE
    return {
      category: g.category,
      label: g.label,
      detail: g.detail,
      count: g.items.length,
      chapters: g.items.slice(0, MAX_CHAPTERS_PER_CAUSE),
      truncated,
    }
  })

  const failedCount = entries.length
  const dominant = causes.length ? causes[0].count : 0
  const allSameCause = failedCount >= 2 && causes.length === 1 ? causes[0].category : null
  return {
    failedCount,
    causes,
    dominantRatio: failedCount >= 2 ? Math.round((dominant / failedCount) * 100) : 0,
    allSameCause,
  }
}

/**
 * 归因摘要的纯文本口径：供「复制失败原因」按钮与整改笔记使用。
 * 逐章点名沿用「章名」风格但按归类分组，先结论后细节；末尾给单因主导的排查建议。
 */
export function buildGenFailureText(summary: GenFailureSummary): string {
  if (!summary.failedCount) return "生成失败归因：没有失败的章节。"
  const lines: string[] = [`生成失败归因：共 ${summary.failedCount} 章失败（本地判定，零费用）`, ""]
  for (const g of summary.causes) {
    lines.push(`【${g.label}】${g.count} 章 · ${g.detail}`)
    for (const c of g.chapters) {
      lines.push(`  - ${c.title}`)
    }
    if (g.truncated) lines.push(`  - 等共 ${g.count} 章`)
    lines.push("")
  }
  if (summary.allSameCause) {
    lines.push(`全部失败章同属「${GEN_FAILURE_CATEGORY_LABEL[summary.allSameCause]}」，建议先排查该通道再整本重试。`)
  }
  return lines.join("\n").trim()
}

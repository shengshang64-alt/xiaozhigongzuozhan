// ---------------------------------------------------------------------------
// R162：客户建设需求条目的「落位核验」。
// R155 把清单条目按章注入生成 prompt（要求逐条回应、不得默默丢弃），但生成之后
// 没有任何机制验证正文是否真的逐条落地——本模块补上这条验证回路：纯本地逐字命中
// 判定（零 AI、零费用、零 collection），条目→要点分段直接复用 R155 路由的分段器
// requirementTitleSegments，保证「注入时怎么拆」与「核验时怎么查」是同一口径。
// 判定分两级：大纲级（章标题+小节名）与正文级（章 content），产出四态
// full/partial/outline/missing。逐字未命中只说明「正文里没出现这个说法」，
// 可能是换了表述，因此展示层始终是「待人工确认」而不是断言漏写。
// 实机取证（演练方案 66 条条目）另暴露一个反向风险：被大批条目共用的模板套话
// （「服务类」「详见第七章技术参数要求」）命中一次就把整片条目升为部分落实，
// 因此这类「泛化要点」不参与判定，只保留各条自己的特征词参与核对。
// ---------------------------------------------------------------------------

import { requirementTitleSegments, type Chapter } from "./solutionTypes"

/** 四态落位等级：正文全命中 / 正文部分命中 / 只在大纲标题命中 / 全程未见 */
export type RequirementCoverageLevel = "full" | "partial" | "outline" | "missing"

export const REQUIREMENT_COVERAGE_LABEL: Record<RequirementCoverageLevel, string> = {
  full: "全部落实",
  partial: "部分落实",
  outline: "仅在大纲",
  missing: "未落实",
}

/** 严重度排序（列表排序、筛选标签、待补清单分组共用，避免两套口径） */
export const REQUIREMENT_COVERAGE_ORDER: RequirementCoverageLevel[] = ["missing", "outline", "partial", "full"]

/** 单条条目最多取 8 个要点参与判定，防超长功能描述把「全命中」门槛抬到不可达 */
const MAX_KEYS_PER_ITEM = 8

/**
 * 泛化要点（模板词）判定门槛：条目数不足此值时样本太小，区分不出模板词与特征词，
 * 一律不降权（保持小清单下「逐字没出现就是没出现」的原口径）。
 */
const BOILERPLATE_MIN_ITEMS = 6

/** 命中章引用（跳转用）：title 已兜底，空标题回退「第 N 章」 */
export type RequirementCoverageHit = { nodeId: string; title: string }

export type RequirementCoverageRow = {
  /** 条目在清单快照 customer_requirements 里的下标（原序可回溯，也用作列表 key） */
  index: number
  /** 条目原文 */
  item: string
  /** 参与逐字核对的要点（R155 同源分段器产出，去泛词后长度≥2；分不出段则整条原文兜底） */
  keys: string[]
  level: RequirementCoverageLevel
  /** 正文命中其中任一要点的章（按章序） */
  bodyChapters: RequirementCoverageHit[]
  /** 大纲标题/小节名命中其中任一要点的章（按章序） */
  outlineChapters: RequirementCoverageHit[]
  /** 正文里没找到的要点（level=full 时为空） */
  missingKeys: string[]
}

export type RequirementCoverageResult = {
  total: number
  counts: Record<RequirementCoverageLevel, number>
  /** 需要人看一眼的条数（未落实 + 仅在大纲 + 部分落实） */
  pending: number
  /** 已按严重度排序（REQUIREMENT_COVERAGE_ORDER 在前，同级按清单原序） */
  rows: RequirementCoverageRow[]
  /** 本次被降权的模板词（展示层据此说明「为什么这些词没算进核对」） */
  boilerplateKeys: string[]
  /** 有正文的章数（为 0 时未命中只代表「正文还没写」，展示层据此改措辞） */
  generatedChapters: number
  chapterCount: number
}

function normalizeText(value: string): string {
  return (value ?? "").replace(/\s+/g, "")
}

function emptyCounts(): Record<RequirementCoverageLevel, number> {
  return { full: 0, partial: 0, outline: 0, missing: 0 }
}

/** 条目 → 参与核对的要点：与 R155 章级路由同一分段器（按标点与「与/及」拆分、去泛词） */
export function requirementMatchKeys(item: string): string[] {
  const keys = requirementTitleSegments(item).filter((k) => k.length >= 2)
  if (!keys.length) {
    const whole = normalizeText(item)
    return whole.length >= 2 ? [whole] : []
  }
  return keys.slice(0, MAX_KEYS_PER_ITEM)
}

/**
 * 逐条判定落位等级。条目只要在全书任一章正文出现即算「说过」（跨章合并）：
 * 审计对象是方案整体是否回应客户，不是单章自洽，与标书侧覆盖审计同口径。
 */
export function auditRequirementCoverage(
  reqLines: string[] | undefined,
  chapters: Chapter[] | undefined,
): RequirementCoverageResult {
  const items = (reqLines ?? []).map((raw) => String(raw ?? "").trim()).filter(Boolean)
  const chapterList = (chapters ?? []).filter((c) => c && typeof c.node_id === "string")
  const counts = emptyCounts()
  const generated = chapterList.filter((c) => normalizeText(c.content).length > 0).length
  if (!items.length) {
    return {
      total: 0,
      counts,
      pending: 0,
      rows: [],
      boilerplateKeys: [],
      generatedChapters: generated,
      chapterCount: chapterList.length,
    }
  }

  const haystack = chapterList.map((c, i) => ({
    nodeId: c.node_id,
    label: (c.title ?? "").trim() || `第 ${i + 1} 章`,
    body: normalizeText(c.content ?? ""),
    outline: normalizeText(`${c.title ?? ""} ${(c.sections ?? []).join(" ")}`),
  }))

  // 先按整份清单统计要点出现频次：被超过 1/3 条目共用的要点是模板套话而非特征信息，
  // 命中一次就大面积升格，故排除；条目不足 BOILERPLATE_MIN_ITEMS 条时不做此降权。
  const keySets = items.map((item) => requirementMatchKeys(item))
  const boilerplateKeys: string[] = []
  if (items.length >= BOILERPLATE_MIN_ITEMS) {
    const docFreq = new Map<string, number>()
    for (const keys of keySets) {
      for (const k of new Set(keys)) docFreq.set(k, (docFreq.get(k) ?? 0) + 1)
    }
    for (const [k, n] of docFreq) if (n * 3 > items.length) boilerplateKeys.push(k)
  }
  const boiler = new Set(boilerplateKeys)

  const rows: RequirementCoverageRow[] = items.map((item, index) => {
    // 某条目的要点若全是模板词（本身没有特征信息），整条回退原要点，宁可保守不误判
    const allKeys = keySets[index]
    const kept = allKeys.filter((k) => !boiler.has(k))
    const keys = kept.length ? kept : allKeys
    const bodyChapters: RequirementCoverageHit[] = []
    const outlineChapters: RequirementCoverageHit[] = []
    const hitKeys = new Set<string>()
    for (const h of haystack) {
      const bodyHits = keys.filter((k) => h.body.includes(k))
      if (bodyHits.length) {
        bodyChapters.push({ nodeId: h.nodeId, title: h.label })
        bodyHits.forEach((k) => hitKeys.add(k))
      }
      if (keys.some((k) => h.outline.includes(k))) {
        outlineChapters.push({ nodeId: h.nodeId, title: h.label })
      }
    }
    const missingKeys = keys.filter((k) => !hitKeys.has(k))
    let level: RequirementCoverageLevel
    if (!keys.length) level = "missing"
    else if (!missingKeys.length) level = "full"
    else if (hitKeys.size) level = "partial"
    else if (outlineChapters.length) level = "outline"
    else level = "missing"
    counts[level] += 1
    return { index, item, keys, level, bodyChapters, outlineChapters, missingKeys }
  })

  rows.sort(
    (a, b) =>
      REQUIREMENT_COVERAGE_ORDER.indexOf(a.level) - REQUIREMENT_COVERAGE_ORDER.indexOf(b.level) ||
      a.index - b.index,
  )

  return {
    total: items.length,
    counts,
    pending: items.length - counts.full,
    rows,
    boilerplateKeys: boilerplateKeys.sort(),
    generatedChapters: generated,
    chapterCount: chapterList.length,
  }
}

/**
 * 待补清单文本（复制用，卡片按钮与剪贴板共用单一来源）：只收未全落实的三档，
 * 每档给出条数与「正文未见要点」；全部落实时返回空串（调用方不渲染按钮）。
 */
export function buildRequirementPendingText(result: RequirementCoverageResult): string {
  const blocks: string[] = []
  for (const level of REQUIREMENT_COVERAGE_ORDER) {
    if (level === "full") continue
    const rows = result.rows.filter((r) => r.level === level)
    if (!rows.length) continue
    const lines = rows.map((r) => {
      const missing = r.missingKeys.length ? `（正文未见要点：${r.missingKeys.join("、")}）` : ""
      return `- ${r.item}${missing}`
    })
    blocks.push(`【${REQUIREMENT_COVERAGE_LABEL[level]} ${rows.length} 条】\n${lines.join("\n")}`)
  }
  if (!blocks.length) return ""
  return `【客户建设需求条目待补清单】共 ${result.pending} / ${result.total} 条\n${blocks.join("\n")}`
}

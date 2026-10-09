// ---------------------------------------------------------------------------
// R195：★ 实质性技术条款的「正文自动核对」。
// 覆盖矩阵此前只有人工标注的 未覆盖/已覆盖/不适用 三态，没有任何机制验证已生成的投标
// 正文是否真的逐条回应了技术参数条款。本模块补上这条本地验证回路：对 kind==="star"
// 的条款做逐字命中判定（零 AI、零费用、零 collection、零 pb_hooks），四态结构、排序与
// 模板词降权完全沿用 R162 方案侧 requirementCoverage，要点分段直接复用 R155 的
// requirementTitleSegments，保证「注入时怎么拆」与「核对时怎么查」是同一把尺子。
// 只核 ★ 技术参数条款：废标/资格/符合性多为投标文件形式与资质要求，本就不在技术正文
// 逐字出现，纳入只会制造「未回应」噪音。逐字未命中只说明「正文里没出现这个说法」，
// 可能换了表述，因此展示层始终是「待人工确认」的提示，不覆盖、不替代人工标注的状态，
// 与「编造嫌疑未清零禁止导出」维持「只报告不拦截」的既定裁定同口径。
// ---------------------------------------------------------------------------

import { requirementTitleSegments, type Chapter } from "../SolutionStudio/solutionTypes"
import type { ComplianceRow } from "./complianceMatrix"

/** 四态落位等级：正文全命中 / 正文部分命中 / 只在章节标题命中 / 正文全程未见 */
export type ComplianceCoverageLevel = "full" | "partial" | "outline" | "missing"

export const COMPLIANCE_COVERAGE_LABEL: Record<ComplianceCoverageLevel, string> = {
  full: "正文已回应",
  partial: "正文部分回应",
  outline: "仅在章节标题",
  missing: "正文未见",
}

/** 严重度排序（汇总、筛选、待核对清单分组共用，避免两套口径） */
export const COMPLIANCE_COVERAGE_ORDER: ComplianceCoverageLevel[] = ["missing", "outline", "partial", "full"]

/** 单条条款最多取 8 个要点参与判定，防超长参数句把「全命中」门槛抬到不可达 */
const MAX_KEYS_PER_CLAUSE = 8

/** 模板词降权门槛：条款数不足此值时样本太小，区分不出模板词与特征词，一律不降权 */
const BOILERPLATE_MIN_ROWS = 6

function normalizeText(value: string): string {
  return (value ?? "").replace(/\s+/g, "")
}

function emptyCounts(): Record<ComplianceCoverageLevel, number> {
  return { full: 0, partial: 0, outline: 0, missing: 0 }
}

/** 条款 → 参与核对的要点：与方案侧同用 R155 分段器，去泛词后长度≥2，分不出则整条兜底 */
export function clauseMatchKeys(text: string): string[] {
  const keys = requirementTitleSegments(text).filter((k) => k.length >= 2)
  if (!keys.length) {
    const whole = normalizeText(text)
    return whole.length >= 2 ? [whole] : []
  }
  return keys.slice(0, MAX_KEYS_PER_CLAUSE)
}

/** 命中章引用（跳转/展示用）：title 已兜底，空标题回退「第 N 章」 */
export type ComplianceCoverageHit = { nodeId: string; title: string }

export type ComplianceCoverageRow = {
  id: string
  /** 参与逐字核对的要点（去泛词后长度≥2；分不出段则整条原文兜底） */
  keys: string[]
  level: ComplianceCoverageLevel
  /** 正文命中其中任一要点的章（按章序） */
  bodyChapters: ComplianceCoverageHit[]
  /** 章节标题/小节名命中其中任一要点的章（按章序） */
  outlineChapters: ComplianceCoverageHit[]
  /** 正文里没找到的要点（level=full 时为空） */
  missingKeys: string[]
}

export type ComplianceCoverageResult = {
  /** 参与核对的 ★ 条款条数 */
  total: number
  counts: Record<ComplianceCoverageLevel, number>
  /** 全部要点命中的条数（level=full） */
  responded: number
  /** 需要人看一眼的条数（未全命中：partial + outline + missing） */
  pending: number
  /** 按行 id 索引的逐条结果（仅含 ★ 行；其余 kind 不在此表） */
  byRow: Record<string, ComplianceCoverageRow>
  /** 本次被降权的模板词（展示层据此说明「为什么这些词没算进核对」） */
  boilerplateKeys: string[]
  /** 有正文的章数（为 0 时未命中只代表「正文还没写」，展示层据此改措辞） */
  generatedChapters: number
  chapterCount: number
}

/**
 * 逐条判定 ★ 条款在投标正文里的落位等级。条款要点只要在任一章正文出现即算「说过」
 * （跨章合并）——审计对象是标书整体是否回应招标要求，不是单章自洽，与方案侧落位核验同口径。
 * 非 ★ 条款不参与判定，byRow 里不出现，展示层自然不挂提示。
 */
export function auditComplianceCoverage(
  rows: ComplianceRow[],
  chapters: Chapter[] | undefined,
): ComplianceCoverageResult {
  const counts = emptyCounts()
  const chapterList = (chapters ?? []).filter((c) => c && typeof c.node_id === "string")
  const generated = chapterList.filter((c) => normalizeText(c.content).length > 0).length
  const starRows = (rows ?? []).filter((r) => r && r.kind === "star")
  const byRow: Record<string, ComplianceCoverageRow> = {}

  if (!starRows.length) {
    return {
      total: 0,
      counts,
      responded: 0,
      pending: 0,
      byRow,
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

  // 先按整片 ★ 条款统计要点出现频次：被超过 1/3 条款共用的要点是模板套话而非特征信息，
  // 命中一次就大面积升格，故排除；条款不足 BOILERPLATE_MIN_ROWS 条时不做此降权。
  const keySets = starRows.map((r) => clauseMatchKeys(r.text))
  const boilerplateKeys: string[] = []
  if (starRows.length >= BOILERPLATE_MIN_ROWS) {
    const docFreq = new Map<string, number>()
    for (const keys of keySets) {
      for (const k of new Set(keys)) docFreq.set(k, (docFreq.get(k) ?? 0) + 1)
    }
    for (const [k, n] of docFreq) if (n * 3 > starRows.length) boilerplateKeys.push(k)
  }
  const boiler = new Set(boilerplateKeys)

  for (let idx = 0; idx < starRows.length; idx++) {
    const r = starRows[idx]
    // 某条款的要点若全是模板词（本身没有特征信息），整条回退原要点，宁可保守不误判
    const allKeys = keySets[idx]
    const kept = allKeys.filter((k) => !boiler.has(k))
    const keys = kept.length ? kept : allKeys
    const bodyChapters: ComplianceCoverageHit[] = []
    const outlineChapters: ComplianceCoverageHit[] = []
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
    let level: ComplianceCoverageLevel
    if (!keys.length) level = "missing"
    else if (!missingKeys.length) level = "full"
    else if (hitKeys.size) level = "partial"
    else if (outlineChapters.length) level = "outline"
    else level = "missing"
    counts[level] += 1
    byRow[r.id] = { id: r.id, keys, level, bodyChapters, outlineChapters, missingKeys }
  }

  return {
    total: starRows.length,
    counts,
    responded: counts.full,
    pending: starRows.length - counts.full,
    byRow,
    boilerplateKeys: boilerplateKeys.sort(),
    generatedChapters: generated,
    chapterCount: chapterList.length,
  }
}

/**
 * 待核对清单文本（复制用，卡片按钮与剪贴板共用单一来源）：只收未全命中三档，
 * 每档给出条数与「正文未见要点」；全部命中时返回空串（调用方不渲染按钮）。
 * 口径同 R162 buildRequirementPendingText。
 */
export function buildCompliancePendingText(
  result: ComplianceCoverageResult,
  rows: ComplianceRow[],
): string {
  const textById = new Map((rows ?? []).map((r) => [r.id, r.text]))
  const blocks: string[] = []
  for (const level of COMPLIANCE_COVERAGE_ORDER) {
    if (level === "full") continue
    const entries = Object.values(result.byRow).filter((e) => e.level === level)
    if (!entries.length) continue
    const lines = entries.map((e) => {
      const missing = e.missingKeys.length ? `（正文未见要点：${e.missingKeys.join("、")}）` : ""
      const raw = (textById.get(e.id) ?? "").trim()
      const short = raw.length > 80 ? `${raw.slice(0, 80)}…` : raw
      return `- ${short}${missing}`
    })
    blocks.push(`【${COMPLIANCE_COVERAGE_LABEL[level]} ${entries.length} 条】\n${lines.join("\n")}`)
  }
  if (!blocks.length) return ""
  return `【★ 技术条款正文待核对清单】共 ${result.pending} / ${result.total} 条\n${blocks.join("\n")}`
}

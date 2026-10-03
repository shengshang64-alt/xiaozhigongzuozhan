// ---------------------------------------------------------------------------
// T18（2026-09-30）文本审计纯模块（易标 rejection-check 的错别字/逻辑谬误两路移植）：
//  - 分段：超限文本按章节（内部模式）或自然边界（外部模式）切段，每段一次独立 AI 调用；
//  - 错别字位置回填校验（易标 findVerifiedTypoPosition 口径）：AI 报告的 wrongText 必须
//    「在原文中真实存在」才算有效（excerpt 定位优先，回退 wrongText 首次命中），杜绝模型幻觉；
//  - 摘录重建与行号定位（createVerifiedTypoExcerpt / createLineLocationHint 口径）；
//  - 净化去重：跨段去重（同章+同错字+同位置 / 同章+同标题+同理由）。
// 纯函数零依赖，不 import bidTypes（避免环；行号/切片在此自包含）。
// ---------------------------------------------------------------------------

/** 审计对象：内部模式=各章正文；外部模式=外部投标文件全文单块 */
export type AuditDoc = { id: string; title: string; content: string }

/** 错别字一条 */
export type TypoFinding = {
  docId: string
  docTitle: string
  wrongText: string
  correctText: string
  /** 程序重建的可信摘录（wrongText ± 60 字，截断保护） */
  excerpt: string
  reason: string
  /** 原文行号（1 起） */
  line: number
  /** 原文字符偏移 */
  position: number
}

/** 逻辑谬误一条 */
export type LogicFinding = {
  docId: string
  docTitle: string
  title: string
  originalText: string
  locationHint: string
  fallacyReason: string
  suggestion: string
}

const TYPO_EXCERPT_RADIUS = 60
const MAX_TYPO_FINDINGS = 60
const MAX_LOGIC_FINDINGS = 60

function asText(v: unknown): string {
  return String(v ?? "").trim()
}

/** 单文档切段（段长上限 + 偏移追踪）：与 tenderSplit 不同——这里要保每段在原文中的起止偏移，供位置校验 */
export function splitAuditDoc(doc: AuditDoc, segmentLimit: number): { text: string; start: number }[] {
  const src = doc.content ?? ""
  if (src.length <= segmentLimit) return [{ text: src, start: 0 }]
  const out: { text: string; start: number }[] = []
  let pos = 0
  while (pos < src.length) {
    let end = Math.min(src.length, pos + segmentLimit)
    if (end < src.length) {
      // 自然边界回退：段尾 20% 窗口内找最后一个换行/句号
      const window = src.slice(Math.max(pos, end - Math.round(segmentLimit * 0.2)), end)
      const nl = Math.max(window.lastIndexOf("\n"), window.lastIndexOf("。"))
      if (nl > 0) end = Math.max(pos + 1, Math.max(pos, end - Math.round(segmentLimit * 0.2)) + nl + 1)
    }
    out.push({ text: src.slice(pos, end), start: pos })
    pos = end
  }
  return out
}

/**
 * 错别字位置回填校验（易标 findVerifiedTypoPosition 口径）：
 * excerpt 含 wrongText → 取 excerpt 命中处；否则回退 wrongText 首次命中；都找不到 → -1（丢弃该条）。
 * 段模式（segText 非空）优先在段内定位并按 segStart 还原偏移；非段模式（默认）直接全文定位。
 */
export function findVerifiedTypoPosition(content: string, wrongText: string, excerpt: string, segStart = 0, segText = ""): number {
  if (!wrongText) return -1
  if (segText) {
    const segment = segText
    if (excerpt) {
      const at = segment.indexOf(excerpt)
      const inExcerpt = excerpt.indexOf(wrongText)
      if (at >= 0 && inExcerpt >= 0) return segStart + at + inExcerpt
    }
    const wrongAt = segment.indexOf(wrongText)
    if (wrongAt >= 0) return segStart + wrongAt
  }
  if (excerpt) {
    const at = content.indexOf(excerpt)
    const inExcerpt = excerpt.indexOf(wrongText)
    if (at >= 0 && inExcerpt >= 0) return at + inExcerpt
  }
  return content.indexOf(wrongText)
}

/** 程序重建摘录（易标 createVerifiedTypoExcerpt 口径：wrongText ± 60 字；简化无 HTML 标签保护——正文是纯文本） */
export function buildVerifiedExcerpt(content: string, position: number, wrongText: string): string {
  const start = Math.max(0, position - TYPO_EXCERPT_RADIUS)
  const end = Math.min(content.length, position + wrongText.length + TYPO_EXCERPT_RADIUS)
  return content.slice(start, end).trim()
}

/** 行号定位（易标 createLineLocationHint 口径） */
export function lineAt(content: string, position: number): number {
  return content.slice(0, Math.max(0, position)).split(/\r\n|\r|\n/).length
}

export type RawTypoItem = Record<string, unknown>

/**
 * AI 输出 → 已验证错别字清单（净化 + 位置校验 + 跨段去重）。
 * 段模式：segStart/segText 传入时位置校验优先段内（配合 splitAuditDoc 使用）。
 */
export function sanitizeTypoFindings(
  rawText: string,
  doc: AuditDoc,
  opts?: { segStart?: number; segText?: string },
): TypoFinding[] {
  let data: unknown
  try {
    data = JSON.parse(rawText)
  } catch {
    // 宽松提取：首个 { 到末个 }
    const t = rawText ?? ""
    const s = t.indexOf("{")
    const e = t.lastIndexOf("}")
    if (s < 0 || e <= s) return []
    try {
      data = JSON.parse(t.slice(s, e + 1))
    } catch {
      return []
    }
  }
  const rec = (data && typeof data === "object" ? data : {}) as Record<string, unknown>
  const arr = Array.isArray(data) ? data : Array.isArray(rec.findings) ? rec.findings : Array.isArray(rec.items) ? rec.items : []
  const segStart = opts?.segStart ?? 0
  const segText = opts?.segText ?? ""
  const out: TypoFinding[] = []
  const seen = new Set<string>()
  for (const it of arr.slice(0, 40)) {
    const r = (it ?? {}) as Record<string, unknown>
    const wrongText = asText(r.wrongText ?? r.wrong_text ?? r.wrong ?? r.typo).slice(0, 60)
    const correctText = asText(r.correctText ?? r.correct_text ?? r.correct ?? r.suggestion).slice(0, 60)
    const excerptRaw = asText(r.originalExcerpt ?? r.original_excerpt ?? r.excerpt ?? r.context)
    const reason = asText(r.reason ?? r.riskReason ?? r.detail) || "疑似错别字，请结合原文复核。"
    if (!wrongText || !correctText || wrongText === correctText) continue
    const position = findVerifiedTypoPosition(doc.content, wrongText, excerptRaw, segStart, segText)
    if (position < 0) continue
    const key = `${wrongText}\u0000${correctText}\u0000${position}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      docId: doc.id,
      docTitle: doc.title,
      wrongText,
      correctText,
      excerpt: buildVerifiedExcerpt(doc.content, position, wrongText),
      reason,
      line: lineAt(doc.content, position),
      position,
    })
    if (out.length >= MAX_TYPO_FINDINGS) break
  }
  return out
}

/** AI 输出 → 逻辑谬误清单（净化 + 去重；不做位置强校验——谬误常跨多处原文，摘录供人工定位） */
export function sanitizeLogicFindings(rawText: string, doc: AuditDoc): LogicFinding[] {
  let data: unknown
  try {
    data = JSON.parse(rawText)
  } catch {
    const t = rawText ?? ""
    const s = t.indexOf("{")
    const e = t.lastIndexOf("}")
    if (s < 0 || e <= s) return []
    try {
      data = JSON.parse(t.slice(s, e + 1))
    } catch {
      return []
    }
  }
  const rec = (data && typeof data === "object" ? data : {}) as Record<string, unknown>
  const arr = Array.isArray(data) ? data : Array.isArray(rec.findings) ? rec.findings : Array.isArray(rec.issues) ? rec.issues : []
  const out: LogicFinding[] = []
  const seen = new Set<string>()
  for (const it of arr.slice(0, 40)) {
    const r = (it ?? {}) as Record<string, unknown>
    const title = asText(r.title ?? r.summary).slice(0, 80)
    const originalText = asText(r.originalText ?? r.original_text ?? r.evidence) || "未提供明确原文摘录，请结合位置线索复核。"
    const locationHint = asText(r.locationHint ?? r.location_hint ?? r.location) || "未明确具体位置，请结合原文摘录复核。"
    const fallacyReason = asText(r.fallacyReason ?? r.fallacy_reason ?? r.reason)
    const suggestion = asText(r.suggestion ?? r.recommendation) || "请结合上下文人工复核后修改。"
    if (!title || !fallacyReason) continue
    const key = `${title}\u0000${fallacyReason}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ docId: doc.id, docTitle: doc.title, title, originalText, locationHint, fallacyReason, suggestion })
    if (out.length >= MAX_LOGIC_FINDINGS) break
  }
  return out
}

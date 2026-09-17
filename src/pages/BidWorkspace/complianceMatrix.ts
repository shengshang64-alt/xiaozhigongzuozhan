import type { ParseReport } from "./bidTypes"

// ---------------------------------------------------------------------------
// R005（B-1 阶段一）：实质性条款覆盖矩阵——从解析报告本地推导，零 AI 费用。
// 评分办法 ↔ 响应章节的映射由既有偏离表（response_map）负责，本矩阵只管
// ★/▲ 条款、废标项、资格要求（[强制]）、符合性检查的「覆盖状态」追踪。
// 进度按项目存 localStorage（与方案导出页面格式 ssFmt 同模式），后续可迁 PB json 字段。
// ---------------------------------------------------------------------------

export type ComplianceKind = "star" | "void" | "qual" | "comp"

export const COMPLIANCE_KIND_LABEL: Record<ComplianceKind, string> = {
  star: "★/▲ 条款",
  void: "废标风险项",
  qual: "资格要求",
  comp: "符合性检查",
}

export type ComplianceRowStatus = "open" | "covered" | "na"

export const COMPLIANCE_STATUS_LABEL: Record<ComplianceRowStatus, string> = {
  open: "未覆盖",
  covered: "已覆盖",
  na: "不适用",
}

export type ComplianceRow = {
  /** 稳定 id：kind + 条款文本散列（报告重解析后仍能对上已标注进度） */
  id: string
  kind: ComplianceKind
  text: string
  mandatory: boolean
}

export type ComplianceProgress = {
  status: ComplianceRowStatus
  /** 响应章节（如「3.2 系统安全设计」） */
  ref: string
  note: string
}

export type ComplianceProgressMap = Record<string, ComplianceProgress>

const TRUNCATION_NOTE = /^…另有 \d+ 条未列出$/

function hashId(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function rowId(kind: ComplianceKind, text: string): string {
  return `${kind}:${hashId(text.replace(/\s+/g, "").slice(0, 120))}`
}

function linesOf(report: ParseReport | null | undefined, key: string): string[] {
  const section = report?.sections?.find((s) => s.key === key)
  if (!section?.content) return []
  return section.content
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/** 从解析报告推导矩阵行（纯函数；同文本去重，截断提示行不算条款） */
export function buildComplianceRows(report: ParseReport | null | undefined): ComplianceRow[] {
  const rows: ComplianceRow[] = []
  const seen = new Set<string>()
  const push = (kind: ComplianceKind, raw: string, mandatory: boolean) => {
    const text = raw.replace(/^[-•*]\s*/, "").trim()
    if (!text || TRUNCATION_NOTE.test(text)) return
    const id = rowId(kind, text)
    if (seen.has(id)) return
    seen.add(id)
    rows.push({ id, kind, text, mandatory })
  }
  for (const line of linesOf(report, "star_clauses")) push("star", line, true)
  for (const line of linesOf(report, "void_items")) push("void", line, true)
  for (const line of linesOf(report, "qualification")) {
    const mandatory = line.includes("[强制]") || line.includes("［强制］")
    push("qual", line.replace(/^\[?［?强制\]?］?\s*[:：]?\s*/, ""), mandatory)
  }
  for (const line of linesOf(report, "compliance")) push("comp", line, false)
  return rows
}

// ------------------------------ 进度持久化（localStorage，按项目隔离） ------------------------------

const KEY_PREFIX = "bid_matrix_"

function normalizeProgressMap(raw: unknown): ComplianceProgressMap {
  if (!raw || typeof raw !== "object") return {}
  const out: ComplianceProgressMap = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const r = (v ?? {}) as Record<string, unknown>
    const status = r.status === "covered" || r.status === "na" ? r.status : "open"
    out[id] = { status, ref: String(r.ref ?? ""), note: String(r.note ?? "") }
  }
  return out
}

export function readComplianceProgress(projectId: string): ComplianceProgressMap {
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + projectId)
    if (!raw) return {}
    return normalizeProgressMap(JSON.parse(raw))
  } catch {
    return {}
  }
}

export function writeComplianceProgress(projectId: string, map: ComplianceProgressMap): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + projectId, JSON.stringify(map))
  } catch {
    /* 隐私模式 / 配额超：静默降级为仅本次会话生效 */
  }
}

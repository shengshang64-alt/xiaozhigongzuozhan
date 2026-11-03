import { sectionText, type ParseReport } from "./bidTypes"

// ---------------------------------------------------------------------------
// R25（A3 / bid-checklist-01）：交卷前逐项目合规清单——从解析报告本地推导，零 AI 费用。
// 依据「响应文件要求」(response_req：格式/签字盖章/装订/份数/递交) 与
// 「资格性审查」(qualification：[强制] 资质文件) 两分区逐条生成清单，交卷前逐项人工确认是否备齐。
// 与交卷体检互补，合成三合一就绪度：排版=format_report、内容=实质响应覆盖审计、形式=本清单。
// 进度按项目存 localStorage（与 complianceMatrix 的 bid_matrix_ 同模式），零后端零 collection。
// ---------------------------------------------------------------------------

export type ChecklistKind = "format" | "qual"

export const CHECKLIST_KIND_LABEL: Record<ChecklistKind, string> = {
  format: "形式与签章要求",
  qual: "资格与资质文件",
}

/** 单项确认状态：done=已备齐、na=本项目不适用；缺省即 pending（待确认） */
export type ChecklistState = "done" | "na"

export type ChecklistRow = {
  /** 稳定 id：kind + 条款文本散列（报告重解析后仍能对上已确认进度） */
  id: string
  kind: ChecklistKind
  text: string
  mandatory: boolean
}

export type ChecklistProgressMap = Record<string, ChecklistState>

const TRUNCATION_NOTE = /^…另有 \d+ 条未列出$/

/** 形式要件里判定为强制的关键词：份数/密封/签章/装订等漏一项即可能废标 */
const FORMAT_MANDATORY = /必须|须|应|不得|严禁|加盖|盖章|签字|签署|密封|装订|份数|正本|副本|原件|胶装/

function hashId(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function rowId(kind: ChecklistKind, text: string): string {
  return `${kind}:${hashId(text.replace(/\s+/g, "").slice(0, 120))}`
}

function linesOf(report: ParseReport | null | undefined, key: string): string[] {
  const content = sectionText(report ?? null, key)
  if (!content) return []
  return content
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/** 从解析报告推导清单行（纯函数；同文本去重，截断提示行不算要求项） */
export function buildChecklistRows(report: ParseReport | null | undefined): ChecklistRow[] {
  const rows: ChecklistRow[] = []
  const seen = new Set<string>()
  const push = (kind: ChecklistKind, raw: string, mandatory: boolean) => {
    const text = raw.replace(/^[-•*]\s*/, "").replace(/^\d+[.、]\s*/, "").trim()
    if (!text || TRUNCATION_NOTE.test(text)) return
    const id = rowId(kind, text)
    if (seen.has(id)) return
    seen.add(id)
    rows.push({ id, kind, text, mandatory })
  }
  for (const line of linesOf(report, "response_req")) push("format", line, FORMAT_MANDATORY.test(line))
  for (const line of linesOf(report, "qualification")) {
    const mandatory = line.includes("[强制]") || line.includes("［强制］")
    push("qual", line.replace(/^\[?［?强制\]?］?\s*[:：]?\s*/, ""), mandatory)
  }
  return rows
}

/** 汇总就绪度：待确认数、其中强制项数、分类计数 */
export function summarizeChecklist(rows: ChecklistRow[], progress: ChecklistProgressMap) {
  const pending = rows.filter((r) => !progress[r.id])
  const mandatoryPending = pending.filter((r) => r.mandatory)
  return {
    total: rows.length,
    pending: pending.length,
    mandatoryPending: mandatoryPending.length,
    done: rows.filter((r) => progress[r.id] === "done").length,
    na: rows.filter((r) => progress[r.id] === "na").length,
    formatCount: rows.filter((r) => r.kind === "format").length,
    qualCount: rows.filter((r) => r.kind === "qual").length,
  }
}

// ------------------------------ 进度持久化（localStorage，按项目隔离） ------------------------------

const KEY_PREFIX = "bid_checklist_"

function normalizeProgressMap(raw: unknown): ChecklistProgressMap {
  if (!raw || typeof raw !== "object") return {}
  const out: ChecklistProgressMap = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === "done" || v === "na") out[id] = v
  }
  return out
}

export function readChecklistProgress(projectId: string): ChecklistProgressMap {
  if (!projectId) return {}
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + projectId)
    if (!raw) return {}
    return normalizeProgressMap(JSON.parse(raw))
  } catch {
    return {}
  }
}

export function writeChecklistProgress(projectId: string, map: ChecklistProgressMap): void {
  if (!projectId) return
  try {
    window.localStorage.setItem(KEY_PREFIX + projectId, JSON.stringify(map))
  } catch {
    /* 隐私模式 / 配额超：静默降级为仅本次会话生效 */
  }
}

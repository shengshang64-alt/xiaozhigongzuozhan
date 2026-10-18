// ---------------------------------------------------------------------------
// R56（B27）：「大纲生成不出来」必须留下一条可诊断的原因
//
// 为什么要有这个模块（P0-3 的真实读数，2026-10-16 对真实库 pb_data/data.db 只读盘点，25 个项目）：
//   · 9 个项目从未产出大纲（bid_outline = []），stage 分布 8×pending_parse + 1×composing；
//   · 这 9 个的招标原文全部 ≥103,474 字，而 <10 万字的 4 个在用项目 0 失败；
//   · 但失败路径原本只有一句 toast（handleLlmError）——关掉 toast 证据就没了，
//     所以「大文件是否致败」长期悬置，也无法区分「用户从没点过」与「点了但失败」。
//
// 本模块把一次「失败」或「被拦」变成一条结构化记录（纯函数、零 DOM、零模型），
// 由调用方写入既有的 bid_stage_snapshots 通道——该通道实测已同时承载可恢复快照与事件留痕：
// 255 条真实记录里有 3 条 chapter 事件行 payload 为空（{}），并不含可恢复成果。
//
// 设计口径（刻意如此，不是遗漏）：
//   · 不做「同一原因只记一次」的长期去重——重复失败本身就是要留的证据（「反复出现」是模型侧
//     问题的判据），只对手抖连点做 5 秒窗口抑制（见 shouldRecordOutlineDiag）；
//   · 不记录招标原文/解析正文的任何片段，只记规模与键名（payload 走网络，且不必要）。
// ---------------------------------------------------------------------------

import { SNAPSHOT_DIAG_KEY } from "./bidTypes"
import { missingCriticalSectionTitles, parsedContentChars } from "./parseCoverage"
import type { ParseReport } from "./bidTypes"

/** 失败/拦截的分类。blocked_* 是「预检拦下、根本没发起模型调用」，其余是「发起后失败」。 */
export type OutlineDiagKind =
  | "blocked_no_report"
  | "blocked_dependency"
  | "blocked_critical"
  | "auth"
  | "empty_reply"
  | "non_json"
  | "json_parse"
  | "empty_outline"
  | "timeout"
  | "network"
  | "model_api"
  | "unknown"

/** 各分类的默认中文原因（分类器给的更具体时会覆盖） */
export const OUTLINE_DIAG_REASON: Record<OutlineDiagKind, string> = {
  blocked_no_report: "尚未完成招标文件 AI 解析",
  blocked_dependency: "大纲依赖的解析项为空",
  blocked_critical: "关键解析项缺失",
  auth: "登录状态失效",
  empty_reply: "模型返回空内容",
  non_json: "模型未按 JSON 返回（返回了散文/推理过程）",
  json_parse: "模型返回的大纲 JSON 无法解析",
  empty_outline: "模型返回的大纲为空（无任何章节）",
  timeout: "模型请求超时",
  network: "网络/网关错误",
  model_api: "模型侧拒绝（限流 / 额度 / 服务异常）",
  unknown: "未识别的失败原因",
}

export type OutlineDiag = {
  kind: OutlineDiagKind
  /** 给人看的一句话原因 */
  reason: string
  /** 原始报文的截断版（排障用；不含正文） */
  detail: string
  /** ISO 时间 */
  at: string
  durationMs: number
  /** 招标原文 UTF-16 字数（与 JS String.length 同口径） */
  tenderChars: number
  /** 解析产物非空白字符合计（与覆盖率分子的口径一致） */
  parseChars: number
  /** 关键解析项缺项 key（拦截时非空） */
  criticalMissing: string[]
  criticalMissingTitles: string[]
  /** 解析覆盖率百分比（只作诊断证据，不参与放行判定） */
  coveragePct: number | null
  /** 是否走了长标书分步生成 */
  staged: boolean
  outlineLevel: number
  leafGoal: number
  /** 是「重新生成」还是首次生成 */
  hasDraft: boolean
}

/** 手抖连点抑制窗口：同一原因在 5 秒内只记一条；超过则如实记录（重复失败是证据） */
export const OUTLINE_DIAG_DEDUPE_MS = 5000

const DETAIL_MAX = 200

/** 字数展示：≥1 万转「万字」（大纲/招标的规模讨论一律用万字，便于与审计文档对齐） */
export function formatCharCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 字"
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万字`
  return `${Math.round(n)} 字`
}

/**
 * 把抛出的异常归到可诊断的一类。
 *
 * 判据来源都是本仓真实报文（不是想象的文案）：
 *   · withJsonRepair：「模型未按 JSON 格式返回（本次返回的是非结构化文本，如「…」…）」/「…（本次返回的是空内容）」
 *   · runGenerateOutline：「大纲格式解析失败，请重试」/「分步大纲未产出技术章，请重试」/
 *     「大纲生成结果为空，未产出任何章节，请重试…」
 *   · AuthRequiredError 是 useBidWorkspace 内部的类（不在本模块里），故按 name 判定，
 *     避免为一条日志把模块级私有类提成公共依赖。
 */
export function classifyOutlineFailure(e: unknown): { kind: OutlineDiagKind; reason: string; detail: string } {
  const err = e instanceof Error ? e : null
  const msg = (err ? err.message : String(e ?? "")).trim()
  const detail = msg.slice(0, DETAIL_MAX)
  const kindOf = (kind: OutlineDiagKind, reason?: string): { kind: OutlineDiagKind; reason: string; detail: string } => ({
    kind,
    reason: reason ?? OUTLINE_DIAG_REASON[kind],
    detail,
  })

  if (err?.name === "AuthRequiredError" || /登录|未登录|登录状态|unauthor/i.test(msg)) return kindOf("auth")
  if (/超时|timeout|timed ?out|ETIMEDOUT|aborted/i.test(msg)) return kindOf("timeout")
  // 先认 withJsonRepair 的两条专门报文，它们比泛化的「JSON」判据更具体
  if (/模型未按 JSON 格式返回/.test(msg)) return kindOf(/空内容/.test(msg) ? "empty_reply" : "non_json")
  if (/大纲格式解析失败|无法解析|解析失败/.test(msg)) return kindOf("json_parse")
  if (/结果为空|未产出任何章节|未产出技术章|为空/.test(msg)) return kindOf("empty_outline")
  if (/429|限流|频率|额度|余额|quota|rate ?limit|并发/i.test(msg)) return kindOf("model_api")
  if (/网络|Failed to fetch|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|502|503|504|网关/i.test(msg)) return kindOf("network")
  return kindOf("unknown")
}

export type OutlineDiagInput = {
  kind: OutlineDiagKind
  /** 覆盖默认原因（拦截类需要带清单） */
  reason?: string
  detail?: string
  /** 本次尝试的起始时间，用于算用时 */
  startedAt?: number
  /** 记录时刻（测试可注入） */
  at?: number
  report: ParseReport | null
  tenderChars: number
  criticalMissing?: string[]
  coveragePct?: number | null
  staged?: boolean
  outlineLevel?: number
  leafGoal?: number
  hasDraft?: boolean
}

/** 组装一条诊断记录（纯函数） */
export function buildOutlineDiag(input: OutlineDiagInput): OutlineDiag {
  const atMs = input.at ?? Date.now()
  const criticalMissing = input.criticalMissing ?? []
  const kind = input.kind
  const reason = input.reason ?? OUTLINE_DIAG_REASON[kind]
  return {
    kind,
    reason,
    detail: (input.detail ?? "").slice(0, DETAIL_MAX),
    at: new Date(atMs).toISOString(),
    durationMs: Math.max(0, atMs - (input.startedAt ?? atMs)),
    tenderChars: Math.max(0, input.tenderChars ?? 0),
    parseChars: parsedContentChars(input.report?.sections ?? []),
    criticalMissing,
    // 中文清单与 missingCriticalSections 同一判据（R56 修：此前用 missingSectionTitles 会印出空名单）
    criticalMissingTitles: criticalMissing.length ? missingCriticalSectionTitles(input.report, criticalMissing) : [],
    coveragePct: input.coveragePct ?? null,
    staged: input.staged ?? false,
    outlineLevel: input.outlineLevel ?? 0,
    leafGoal: input.leafGoal ?? 0,
    hasDraft: input.hasDraft ?? false,
  }
}

/** 供工作记录列表显示的一行摘要（label，≤200 字由写入方截断） */
export function outlineDiagLabel(d: OutlineDiag): string {
  const prefix = d.kind.startsWith("blocked") ? "大纲生成被拦" : "大纲生成失败"
  const bits = [`招标 ${formatCharCount(d.tenderChars)}`]
  if (d.criticalMissingTitles.length) bits.push(`判缺 ${d.criticalMissingTitles.join("、")}`)
  if (d.staged) bits.push("分步生成")
  return `${prefix}：${d.reason}（${bits.join(" · ")}）`
}

/** 供「查看」弹窗显示的证据行（含用时与覆盖率，便于判「是不是大文件拖垮的」） */
export function describeOutlineDiag(d: OutlineDiag): string {
  const bits = [
    `原因：${d.reason}`,
    `规模：招标 ${formatCharCount(d.tenderChars)} / 解析产物 ${formatCharCount(d.parseChars)}`,
    `设置：${d.outlineLevel > 0 ? `${d.outlineLevel} 级目录` : "级数自动"} / 目标叶子 ${d.leafGoal || "—"} / ${d.hasDraft ? "重新生成" : "首次生成"}${d.staged ? " / 分步生成" : ""}`,
    `用时：${(d.durationMs / 1000).toFixed(1)}s`,
  ]
  if (d.coveragePct != null) bits.push(`解析覆盖率：${d.coveragePct}%（只作证据，不参与放行）`)
  if (d.criticalMissingTitles.length) bits.push(`判缺解析项：${d.criticalMissingTitles.join("、")}`)
  if (d.detail) bits.push(`原始报文：${d.detail}`)
  return bits.join("\n")
}

/** 两条诊断是否同因（不去重时间，只比原因与缺项） */
export function isSameOutlineDiag(a: OutlineDiag | null, b: OutlineDiag | null): boolean {
  if (!a || !b) return false
  return a.kind === b.kind && a.reason === b.reason && a.criticalMissing.join(",") === b.criticalMissing.join(",")
}

/**
 * 是否写入这条记录：同因且距上一条 < 5 秒 → 视为连点，丢弃；
 * 其余一律写入（跨会话/隔一会儿再撞同一堵墙，是「反复出现」的证据，不能吞）。
 */
export function shouldRecordOutlineDiag(prev: OutlineDiag | null, next: OutlineDiag): boolean {
  if (!prev || !isSameOutlineDiag(prev, next)) return true
  const dt = Date.parse(next.at) - Date.parse(prev.at)
  return !(Number.isFinite(dt) && dt >= 0 && dt < OUTLINE_DIAG_DEDUPE_MS)
}

/** 从快照 payload 里读回诊断记录（写入方写的是 { diag: OutlineDiag }） */
export function parseOutlineDiag(payload: Record<string, unknown> | null | undefined): OutlineDiag | null {
  const raw = payload?.[SNAPSHOT_DIAG_KEY]
  if (!raw || typeof raw !== "object") return null
  const d = raw as Partial<OutlineDiag>
  if (typeof d.kind !== "string" || typeof d.reason !== "string") return null
  return {
    kind: d.kind as OutlineDiagKind,
    reason: d.reason,
    detail: typeof d.detail === "string" ? d.detail : "",
    at: typeof d.at === "string" ? d.at : "",
    durationMs: Number(d.durationMs) || 0,
    tenderChars: Number(d.tenderChars) || 0,
    parseChars: Number(d.parseChars) || 0,
    criticalMissing: Array.isArray(d.criticalMissing) ? (d.criticalMissing as string[]) : [],
    criticalMissingTitles: Array.isArray(d.criticalMissingTitles) ? (d.criticalMissingTitles as string[]) : [],
    coveragePct: typeof d.coveragePct === "number" ? d.coveragePct : null,
    staged: d.staged === true,
    outlineLevel: Number(d.outlineLevel) || 0,
    leafGoal: Number(d.leafGoal) || 0,
    hasDraft: d.hasDraft === true,
  }
}

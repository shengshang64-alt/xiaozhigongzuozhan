import { bidOpenDateDay } from "@/lib/bidOpenDay"
import { daysUntilLocalDay, findGateRecord, type BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"

/** UX-v2 列表七步短名（与原型 bid/list.html 一致；完成判据仍走 stepDoneForList + 大纲/正文拆分） */
export const UX_LIST_STEPS: { step: number; title: string }[] = [
  { step: 1, title: "招标导入" },
  { step: 2, title: "AI 解析" },
  { step: 3, title: "大纲编制" },
  { step: 4, title: "正文编写" },
  { step: 5, title: "查重检查" },
  { step: 6, title: "模拟评标" },
  { step: 7, title: "组卷导出" },
]

export const UX_STEP_CIRCLE = ["", "①", "②", "③", "④", "⑤", "⑥", "⑦"] as const

export type StepDoneFn = (step: number, proj: BidProjectRecord) => boolean

export function hasOutlineStruct(proj: BidProjectRecord): boolean {
  return (proj.bid_outline?.length ?? 0) > 0 || (proj.bid_chapters ?? []).some((c) => (c.title ?? "").trim().length > 0)
}

export function hasDraftContent(proj: BidProjectRecord): boolean {
  return (proj.bid_chapters ?? []).some((c) => (c.content ?? "").trim().length > 0)
}

export function outlineGateConfirmed(proj: BidProjectRecord): boolean {
  return Boolean(findGateRecord(proj.stage_gates, "outline")?.confirmed_at)
}

/** 无大纲，或有大纲但未确认且尚未开写正文 */
export function isStuckOnOutline(proj: BidProjectRecord): boolean {
  if (!hasOutlineStruct(proj)) return true
  return !hasDraftContent(proj) && !outlineGateConfirmed(proj)
}

export function uxStepDone(step: number, proj: BidProjectRecord, stepDoneForList: StepDoneFn): boolean {
  switch (step) {
    case 1:
      return stepDoneForList(1, proj)
    case 2:
      return stepDoneForList(2, proj)
    case 3:
      return !isStuckOnOutline(proj)
    case 4:
      // 有正文但尚未进入查重/后续环节时，当前步仍是「④ 正文编写」
      return stepDoneForList(4, proj)
    case 5:
      return stepDoneForList(4, proj)
    case 6:
      return stepDoneForList(6, proj)
    case 7:
      return stepDoneForList(7, proj)
    default:
      return false
  }
}

export function currentUxStep(proj: BidProjectRecord, stepDoneForList: StepDoneFn): number {
  for (const s of UX_LIST_STEPS) {
    if (!uxStepDone(s.step, proj, stepDoneForList)) return s.step
  }
  return UX_LIST_STEPS.length
}

export function uxStepCaption(proj: BidProjectRecord, stepDoneForList: StepDoneFn): string {
  const n = currentUxStep(proj, stepDoneForList)
  const title = UX_LIST_STEPS[n - 1]?.title ?? ""
  return `${UX_STEP_CIRCLE[n] ?? n} ${title}`.trim()
}

export function cardCtaLabel(proj: BidProjectRecord, stepDoneForList: StepDoneFn): string {
  const days = daysUntilLocalDay(proj.bid_open_date)
  const opened = days !== null && days < 0
  const pending = !proj.bid_result || proj.bid_result === "pending"
  if (opened && pending) return "回填结果 →"
  const ux = currentUxStep(proj, stepDoneForList)
  if (ux === 3) return "去确认大纲 →"
  if (ux === 4) return "继续编写 →"
  return "继续 →"
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function parseTs(raw: string): Date | null {
  const s = (raw ?? "").trim()
  if (!s) return null
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T"))
  return Number.isNaN(d.getTime()) ? null : d
}

/** 脚注时间：回填场景优先开标日，否则 updated / created / 开标日 */
export function cardFootTime(proj: Pick<BidProjectRecord, "updated" | "created" | "bid_open_date">, cta: string, now = new Date()): string {
  if (cta.startsWith("回填结果")) {
    const day = bidOpenDateDay(proj.bid_open_date)
    if (day) return `开标 ${day.length >= 10 ? day.slice(5) : day}`
  }
  const upd = parseTs(proj.updated ?? "")
  if (upd) {
    const hm = `${pad2(upd.getHours())}:${pad2(upd.getMinutes())}`
    const sameDay =
      upd.getFullYear() === now.getFullYear() && upd.getMonth() === now.getMonth() && upd.getDate() === now.getDate()
    if (sameDay) return `最近编辑 ${hm}`
    return `最近编辑 ${upd.getFullYear()}-${pad2(upd.getMonth() + 1)}-${pad2(upd.getDate())}`
  }
  const created = parseTs(proj.created ?? "")
  if (created) {
    return `${created.getFullYear()}-${pad2(created.getMonth() + 1)}-${pad2(created.getDate())} 建`
  }
  const day = bidOpenDateDay(proj.bid_open_date)
  if (day) return `开标 ${day.length >= 10 ? day.slice(5) : day}`
  return ""
}

export function parseBudgetToWan(raw: string): number | null {
  const t = (raw ?? "").replace(/,/g, "").replace(/，/g, "").trim()
  if (!t) return null
  const wan = t.match(/(\d+(?:\.\d+)?)\s*万/)
  if (wan) {
    const n = Number(wan[1])
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const yuan = t.match(/(\d+(?:\.\d+)?)\s*元/)
  if (yuan) {
    const n = Number(yuan[1])
    return Number.isFinite(n) && n > 0 ? n / 10000 : null
  }
  return null
}

/** 仅从解析报告「预算金额：」真字段取值；没有则 null，调用方不要写成 0 */
export function projectBudgetWan(proj: Pick<BidProjectRecord, "parse_report">): number | null {
  const text = (proj.parse_report?.sections ?? []).map((s) => s.content ?? "").join("\n")
  const m = text.match(/预算金额[：:]\s*([^\n]+)/)
  if (!m) return null
  return parseBudgetToWan(m[1])
}

export function formatBudgetPhrase(proj: Pick<BidProjectRecord, "parse_report">): string | null {
  const wan = projectBudgetWan(proj)
  if (wan == null) return null
  return `预算 ${wan.toFixed(1)} 万`
}

export function draftCharCount(proj: Pick<BidProjectRecord, "bid_chapters">): number {
  return (proj.bid_chapters ?? []).reduce((n, c) => n + (c.content ?? "").replace(/\s/g, "").length, 0)
}

export function stageBadgeClass(label: string, stage: string): string {
  if (label.includes("大纲") || label.includes("待确认")) return "bg-amber-50 text-amber-800"
  if (stage === "evaluated" || label.includes("已评标")) return "bg-violet-50 text-violet-800"
  if (stage === "composing" || stage === "checking" || label.includes("编制")) return "bg-sky-50 text-sky-800"
  return "bg-muted text-muted-foreground"
}

export function archiveResultView(proj: Pick<BidProjectRecord, "bid_result" | "lost_reason">): {
  text: string
  tone: "green" | "red" | "gray" | "neutral"
} {
  if (proj.bid_result === "won") return { text: "中标", tone: "green" }
  if (proj.bid_result === "lost") {
    if (/废标/.test(proj.lost_reason ?? "")) return { text: "废标", tone: "gray" }
    return { text: "未中标", tone: "red" }
  }
  return { text: "待回填", tone: "neutral" }
}

export function cardBarPercent(
  chapter: { done: number; total: number },
  stepsDone: number,
  stuckOnOutline: boolean,
): { pct: number; amber: boolean } {
  if (chapter.total > 0) {
    const pct = Math.round((chapter.done / chapter.total) * 100)
    return { pct, amber: stuckOnOutline || chapter.done < chapter.total / 2 }
  }
  const pct = Math.round((Math.max(0, Math.min(7, stepsDone)) / 7) * 100)
  return { pct, amber: stuckOnOutline }
}

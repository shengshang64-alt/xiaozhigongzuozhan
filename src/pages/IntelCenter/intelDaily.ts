// 今日工作队列（2026-11-02）：确定性优先级与截止日解析，零 AI 费用。
// 规则只负责「谁先处理」，不替用户判真假；每条推荐都带可解释理由。
import { isIntelFutureDate } from "./intelDateQuality"
import type { IntelItemRow } from "./useIntelCenter"

export type IntelDeadlineKind = "overdue" | "today" | "week" | "later" | "none"

export function parseIntelDeadline(value: string, now = new Date()): Date | null {
  const s = String(value || "").trim()
  if (!s) return null
  const m = s.match(/(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})日?(?:\s*(\d{1,2})[:：时](\d{1,2})?)?/)
  if (!m) return null
  const hasTime = m[4] !== undefined
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const h = hasTime ? Number(m[4]) : 23
  const mi = hasTime ? Number(m[5] ?? 0) : 59
  const date = new Date(y, mo - 1, d, h, mi, 0, 0)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null
  // 没有明确时间的截止日按当天 23:59 处理，避免当天上午就误报已逾期
  void now
  return date
}

export function intelDeadlineKind(value: string, now = new Date()): IntelDeadlineKind {
  const ts = parseIntelDeadline(value, now)
  if (!ts) return "none"
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startTomorrow = startToday + 86400000
  if (ts.getTime() < startToday) return "overdue"
  if (ts.getTime() < startTomorrow) return "today"
  if (ts.getTime() <= startToday + 7 * 86400000) return "week"
  return "later"
}

function itemTime(item: IntelItemRow): number {
  const raw = item.published_at || item.created || ""
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : 0
}

function score(item: IntelItemRow, now: Date, focused: boolean): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []
  const type = item.item_type || "media"
  score += type === "bid" ? 45 : type === "policy" ? 30 : type === "competitor" ? 20 : 10
  if (type === "bid") reasons.push("招标中标")
  else if (type === "policy") reasons.push("政策")
  else if (type === "competitor") reasons.push("竞品")

  const urgency = intelDeadlineKind(item.structured?.deadline ?? "", now)
  if (urgency === "today") {
    score += 100
    reasons.unshift("今天截止")
  } else if (urgency === "overdue") {
    score += 85
    reasons.unshift("截止已过")
  } else if (urgency === "week") {
    score += 70
    reasons.unshift("7天内截止")
  }

  if (focused) {
    score += 40
    reasons.push("关注方向")
  }
  if (item.structured?.buyer) score += 5
  if (item.structured?.code) score += 5
  if (item.summary) score += 3
  if ((item.duplicate_count ?? 1) > 1) {
    score += 3
    reasons.push("多源印证")
  }

  const ageDays = Math.max(0, (now.getTime() - itemTime(item)) / 86400000)
  if (ageDays <= 1) {
    score += 20
    reasons.push("24小时新入")
  } else if (ageDays <= 3) score += 12
  else if (ageDays <= 7) score += 6
  return { score, reasons: reasons.slice(0, 3) }
}

export interface DailyIntelSelection {
  top: IntelItemRow[]
  deadlines: IntelItemRow[]
  pendingCount: number
}

export function selectDailyIntel(
  items: IntelItemRow[],
  now = new Date(),
  focusedOf: (item: IntelItemRow) => boolean = () => false,
  limit = 10,
): DailyIntelSelection {
  const pending = items.filter((it) => (it.my_status || it.item_status || "pending") === "pending")
  const ranked = pending
    .filter((it) => !isIntelFutureDate(it.published_at, now))
    .map((it) => {
      const r = score(it, now, focusedOf(it))
      return { item: { ...it, priority_reason: r.reasons }, score: r.score, time: itemTime(it) }
    })
    .sort((a, b) => b.score - a.score || b.time - a.time)

  const deadlines = pending
    .filter((it) => {
      const ts = parseIntelDeadline(it.structured?.deadline ?? "", now)
      if (!ts) return false
      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      // 临期窗口：已逾期不超过 7 天 ~ 未来 7 天；过老的截止不制造无效警报
      return ts.getTime() >= startToday - 7 * 86400000 && ts.getTime() <= startToday + 7 * 86400000
    })
    .sort((a, b) => {
      const ta = parseIntelDeadline(a.structured?.deadline ?? "", now)?.getTime() ?? 0
      const tb = parseIntelDeadline(b.structured?.deadline ?? "", now)?.getTime() ?? 0
      return ta - tb
    })

  return { top: ranked.slice(0, limit).map((r) => r.item), deadlines, pendingCount: pending.length }
}

/** 周报选材：近 7 天高分待办 + 临期 + 已确认高价值条目；忽略与异常未来日期永不入选 */
export function selectWeeklyIntelItems(
  items: IntelItemRow[],
  now = new Date(),
  focusedOf: (item: IntelItemRow) => boolean = () => false,
  limit = 20,
): IntelItemRow[] {
  const cutoff = now.getTime() - 7 * 86400000
  const recent = items.filter((it) => {
    if ((it.my_status || it.item_status) === "ignored") return false
    if (isIntelFutureDate(it.published_at, now)) return false
    return itemTime(it) >= cutoff
  })
  const daily = selectDailyIntel(recent, now, focusedOf, Math.min(15, limit))
  const confirmed = recent
    .filter((it) => (it.my_status || it.item_status) === "confirmed")
    .sort((a, b) => itemTime(b) - itemTime(a))
    .slice(0, 5)
  const seen = new Set<string>()
  const out: IntelItemRow[] = []
  for (const it of [...daily.top, ...daily.deadlines, ...confirmed]) {
    if (seen.has(it.id)) continue
    seen.add(it.id)
    out.push(it)
    if (out.length >= limit) break
  }
  return out
}

// ISO-string -> display-string date formatters (R114 single source of truth).
// Author: loop-R114
// "Render a stored ISO timestamp for humans" was re-implemented four parallel
// ways across three modules:
//   - customerTypes.fmtDateTime   -> "YYYY-MM-DD HH:MM", unparsable -> iso.slice(0,10)
//   - customerTypes.fmtDate       -> "YYYY-MM-DD",        unparsable -> iso.slice(0,10)
//   - useIntelCenter.fmtIntelTime -> byte-for-byte clone of fmtDateTime
//   - QaGapPanel.formatTime       -> "YYYY-MM-DD HH:MM" but unparsable -> "" (the odd one)
// R112's dateStamp.ts only covered Date-object input (localDateStamp); the
// ISO-string entry points above were never unified and had already drifted on
// the invalid branch. The pure-date rendering here delegates to localDateStamp
// so the calendar logic stays in exactly one place; datetime appends local HH:MM.
// R117: raw new Date(x).toLocaleString("zh-CN") stamps (check/audit/
// export/review times, 11 sites) and zh-CN slash dates (export dates,
// default quote name, 30-day session fallback) bypassed this source and
// rendered "2026/10/2 15:04:05". They now go through formatDateTime(
// Display)/localDateStamp; whole-app datetime display drops seconds.

import { localDateStamp } from "./dateStamp"

/** Local `YYYY-MM-DD HH:MM` from a Date object. Invalid Date -> "". */
export function formatDateTime(d: Date): string {
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${localDateStamp(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Local `YYYY-MM-DD` from an ISO string. Empty -> "", unparsable -> first 10 chars. */
export function formatDateDisplay(iso: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return localDateStamp(d)
}

/** Local `YYYY-MM-DD HH:MM` from an ISO string. Empty -> "", unparsable -> first 10 chars. */
export function formatDateTimeDisplay(iso: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return formatDateTime(d)
}

/**
 * Compact list-row stamp `M/D HH:MM` (no year, no seconds, 24h local).
 * R164: the list panels (Deck/Quote/SolutionListPanel/ChapterScoreCard) each
 * re-implemented `toLocaleString("zh-CN", { month/day: "numeric", hour/minute:
 * "2-digit" })`; two of them skipped the NaN guard and leaked "Invalid Date".
 * Byte-identical to the legacy output for valid input (month/day unpadded,
 * hour 24h two-digit), "" for empty/unparsable. Single source now.
 */
export function formatShortDateTime(iso: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

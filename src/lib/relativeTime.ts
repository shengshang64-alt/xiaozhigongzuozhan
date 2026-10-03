// Relative-time display helper (R108 single source of truth).
// Author: loop-R108
// The "刚刚 / X 分钟前 / X 小时前" core was previously copy-pasted (with drifting
// >=1-day branches and different absolute fallbacks) across SessionListPanel,
// StageHistoryPanel, knowledge/DocListPanel and hooks/useActivityFeed.
// This centralizes the shared arithmetic + guards; the >=1-day rendering is
// delegated to a caller-supplied handler so each page keeps its exact wording.

/** Decides how to render a timestamp older than 24 hours. */
export type AfterDayHandler = (date: Date, diffMs: number, day: number) => string

/**
 * Format an ISO timestamp as a Chinese relative-time string.
 * Shared core: <1min -> 刚刚, <1h -> X 分钟前, <24h -> X 小时前.
 * Beyond 24h the output is delegated to `afterDay` (defaults to "X 天前").
 */
export function formatRelativeTime(iso: string, afterDay?: AfterDayHandler): string {
  if (!iso) return ""
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const diff = Date.now() - t
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const day = Math.floor(diff / 86_400_000)
  if (afterDay) return afterDay(new Date(t), diff, day)
  return `${day} 天前`
}

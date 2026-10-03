// Single source of truth for money display across the app (R113).
// Author: loop-R113
// Before this module the quote domain (formatMoney in pptQuoteTypes.ts,
// fixed 2 decimals) and the solution-checklist domain (fmtMoney in
// checklistTypes.ts, maximumFractionDigits only, no minimum) were two
// parallel implementations: the same 1234 yuan rendered as "1,234.00" in
// quotes but "1,234" in checklists. Both domains now share this one
// implementation through same-named re-exports, so every call site keeps
// working unchanged while the rounding convention can only be defined here.
//
// Convention: zh-CN grouping + always exactly 2 decimal places (financial
// display standard; totals align vertically in tables). Non-finite input
// degrades to zero instead of throwing. The "¥" symbol stays at call sites
// because layouts vary between "¥1,234.00" and "¥ 1,234.00" spacing.
//
// R118 (money-bypass-sites-01): formatCount below is the sibling
// convention for count-type numbers (rows/items/characters):
// zh-CN grouping pinned (a bare toLocaleString() followed the runtime
// default locale, so the same count rendered differently on en-US vs
// de-DE browsers), natural precision up to 3 decimals, no forced .00.

/** Format a yuan amount with zh-CN grouping and exactly 2 decimals. */
export function formatMoney(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  return v.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Format a count-type number (rows, items, characters) with pinned
 * zh-CN grouping and natural precision (up to 3 decimals, matching the
 * legacy bare toLocaleString() default). Author: loop-R118.
 */
export function formatCount(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  return v.toLocaleString("zh-CN", { maximumFractionDigits: 3 })
}

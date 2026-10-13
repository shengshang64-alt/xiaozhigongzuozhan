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

// ---------------------------------------------------------------------------
// R34 报价金额精确到分（quote-total-cent）
//
// 旧的 `Math.round(qty*price*(disc/100)*100)/100` 在「真值恰好半分」处系统性少 1 分：
// 15 × 599,729.21 × 90% 的十进制定值是 8,096,344.335 元，应按四舍五入得 .34，
// 但二进制浮点把它存成 8,096,344.334999999…，×100 后是 .4999… → Math.round 得 .33。
// 200,000 组真实量级随机用例里 8.3% 的行项踩中此偏差。而客户侧的 Excel ROUND、
// 计算器与人工复核都会给 .34——报价单出现两套数字，属被质疑/废标级风险（R281 同口径）。
//
// 口径：每个因子按最多 6 位小数取整为「微元」整数，用 BigInt 精确相乘后在分位做
// 远离零舍入。因子数量不限，中间量不再经过二进制浮点，故结果与手算逐分一致。
// ---------------------------------------------------------------------------

/** 定点缩放位数：单价/数量在本域内不会细于 1e-6 元，超出部分按四舍五入截断 */
const MICRO = 1_000_000

/** 若干因子相乘，精确舍入（远离零）到分，返回整数分。非有限值按 0 计。 */
export function productCents(factors: number[]): number {
  let num = 1n
  let den = 1n
  let neg = false
  for (const f of factors) {
    const v = Number.isFinite(f) ? f : 0
    if (v === 0) return 0
    if (v < 0) neg = !neg
    num *= BigInt(Math.round(Math.abs(v) * MICRO))
    den *= BigInt(MICRO)
  }
  // cents = num·100/den；远离零舍入 = floor(num·100/den + 1/2) = floor((num·200 + den) / 2den)
  const cents = Number((num * 200n + den) / (2n * den))
  return neg ? -cents : cents
}

/** 整数分 → 元（分位以内为精确除法，仅 1e-13 量级的二进制尾差，显示与比较都不受影响）。 */
export function centsToYuan(cents: number): number {
  const c = Number.isFinite(cents) ? cents : 0
  return c / 100
}

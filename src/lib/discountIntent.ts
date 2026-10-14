// ---------------------------------------------------------------------------
// R40（backlog B8 折扣语义歧义入口）：「折扣(%)」写法歧义判定的单一真源。
//
// 本域口径：discount 表示「按原价的百分之多少计价」，90 = 打 9 折（见 normalizeDiscount）。
// 但业务同事手填时习惯直接写「折」：想打 9 折就填 9，甚至填 0.9。同一个数字因此有两种读法，
// 相差 10~100 倍，而它直接乘进每一行金额 —— 填 0.9 到底是「按 0.9% 计价」还是「按 90% 计价」，
// 机器不能替用户决定。
//
// 旧处置是静默钳位（行内 NumCell min=1）：填 0.9 被悄悄改成 1（金额只剩 1%），填 3 原样按 3%
// 落库，用户只看到小计「变小了」，不知道钱错了。金额悄悄错属最高危，故本模块只判定、不换算、
// 不钳位、不写库：把判定收敛成一处纯函数，由入口层（QuoteEditor + DiscountIntentDialog）交回
// 用户确认，由盘点层（scanAmbiguousDiscounts / 报价交付体检）只报告不拦截。
//
// 纪律（勿改）：
//  - ≤0 / 缺省 / 非有限值属 R285 的「视为原价 100」，不是写法歧义，一律返回 null。
//  - 纯函数零依赖，可脱离 UI 与后端单测（本机 vitest environment=node）。
// ---------------------------------------------------------------------------

/** 低于此百分比的填写值一律视为歧义写法：医院项目不会按原价 5% 以内成交 */
export const DISCOUNT_AMBIGUOUS_BELOW = 5

/** 一种读法。pct 可直接落进 discount 字段，caption/meaning 用来把差别说成人话 */
export type DiscountReading = {
  pct: number
  caption: string
  meaning: string
}

export type DiscountAmbiguity = {
  /** 定点化后的原始填写值（不改语义，只消二进制尾差） */
  raw: number
  /** 字面读法：用户填的就是百分比 */
  percent: DiscountReading
  /** 习惯读法：用户填的是「几折」（1 ~ 4.9）或「零点几」（0 ~ 1） */
  habit: DiscountReading
  /** 两种读法相差几倍（10 或 100），点给用户看 */
  ratio: number
}

/** 定点化：消除 0.9 * 100 = 90.00000000000001 之类的尾差 —— 金额口径必须是干净数字 */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * 判定填写值是否有「按 % 还是按 折」歧义；无歧义返回 null，调用方按原口径直接落值。
 * 0 < raw < 5 判为歧义：raw < 1 按「零点几写成了小数」（0.9 即 9 折 = 按 90% 计），
 * 1 ≤ raw < 5 按「几折」（3 即 3 折 = 按 30% 计）。
 */
export function discountAmbiguity(raw: number | null | undefined): DiscountAmbiguity | null {
  if (raw == null || !Number.isFinite(raw)) return null
  if (raw <= 0) return null
  if (raw >= DISCOUNT_AMBIGUOUS_BELOW) return null
  const pct = round2(raw)
  const habitPct = raw < 1 ? round2(raw * 100) : round2(raw * 10)
  if (!(habitPct > 0) || habitPct > 100) return null
  const zhe = raw < 1 ? String(round2(raw * 10)) : String(pct)
  return {
    raw: pct,
    percent: {
      pct,
      caption: `按 ${String(pct)}% 计价`,
      meaning: `每一百元只收 ${String(pct)} 元`,
    },
    habit: {
      pct: habitPct,
      caption: `按 ${String(habitPct)}% 计价（${zhe} 折）`,
      meaning: `每一百元收 ${String(habitPct)} 元`,
    },
    ratio: round2(habitPct / pct),
  }
}

/** 只要布尔判定（盘点、交付体检用），不关心两种读法细节 */
export function isAmbiguousDiscount(raw: number | null | undefined): boolean {
  return discountAmbiguity(raw) !== null
}

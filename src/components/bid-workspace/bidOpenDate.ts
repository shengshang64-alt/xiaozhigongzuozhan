/** R198（§3.5）：开标时间补录与倒计时共用的纯逻辑。
 * 天数口径 = **本地日历日差值**（今天开标 = 0，昨天 = -1），可注入基准时刻以便单测，
 * 且不依赖任何后端 / React。
 *
 * R68：解析口径统一到 `src/lib/bidOpenDay.ts`。旧实现用 `Date.parse(iso)` + `Math.ceil`，
 * 对 date-only 串走 UTC 零点（= 当地 08:00），于是**每天 00:00–08:00 都多算一天**：
 * 开标当天凌晨显示「距开标 1 天」而不是「今日开标」，2026-12-01 在 07:59 说 32 天、
 * 08:00 变 31 天（倒计时在早上 8 点跳）。同一时刻首页卡（R67 已改本地零点）说「剩 31 天」，
 * 这里说「距开标 32 天」——同一屏两个答案。 */
import { bidOpenDayMs, daysUntilLocalDay } from "@/lib/bidOpenDay"

export { bidOpenDateDay } from "@/lib/bidOpenDay"

export type BidOpenTone = "missing" | "past" | "urgent" | "normal"

export type BidOpenDateStatus = {
  daysLeft: number | null
  tone: BidOpenTone
  /** 展示文案：如「距开标 5 天」「已过期 2 天」「未登记开标时间」 */
  label: string
}

/** iso 为空 / 非法 → missing；否则按剩余**日历日**分档（past <0、今日 0、urgent ≤7 < normal）。
 *  nowMs 默认当前时间，测试可注入。 */
export function bidOpenDateStatus(iso: string | null | undefined, nowMs: number = Date.now()): BidOpenDateStatus {
  if (!iso || !String(iso).trim()) return { daysLeft: null, tone: "missing", label: "未登记开标时间" }
  const daysLeft = daysUntilLocalDay(iso, nowMs)
  if (daysLeft === null) return { daysLeft: null, tone: "missing", label: "开标日期无效" }
  if (daysLeft < 0) return { daysLeft, tone: "past", label: `已过期 ${Math.abs(daysLeft)} 天` }
  if (daysLeft === 0) return { daysLeft, tone: "past", label: "今日开标" }
  if (daysLeft <= 7) return { daysLeft, tone: "urgent", label: `距开标 ${daysLeft} 天` }
  return { daysLeft, tone: "normal", label: `距开标 ${daysLeft} 天` }
}

/** 用户输入归一：合法 yyyy-mm-dd 原样返回；空白返回空串（表示清除）；格式或日期非法返回 null。 */
export function normalizeBidOpenDateInput(value: string): string | null {
  const v = (value || "").trim()
  if (!v) return ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  return Number.isNaN(bidOpenDayMs(v)) ? null : v
}

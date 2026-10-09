/** R198（§3.5）：开标时间补录与倒计时共用的纯逻辑。
 * 天数口径与 PipelineStepper.daysUntilOpen 完全一致（Math.ceil 天、≤0 已过期、≤7 紧急），
 * 但集中在此、可注入基准时刻以便单测，且不依赖任何后端 / React。 */
export type BidOpenTone = "missing" | "past" | "urgent" | "normal"

export type BidOpenDateStatus = {
  daysLeft: number | null
  tone: BidOpenTone
  /** 展示文案：如「距开标 5 天」「已过期 2 天」「未登记开标时间」 */
  label: string
}

const MS_PER_DAY = 86_400_000

/** iso 为空 / 非法 → missing；否则按剩余天数分档（past ≤0 < urgent ≤7 < normal）。nowMs 默认当前时间，测试可注入。 */
export function bidOpenDateStatus(iso: string | null | undefined, nowMs: number = Date.now()): BidOpenDateStatus {
  if (!iso) return { daysLeft: null, tone: "missing", label: "未登记开标时间" }
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return { daysLeft: null, tone: "missing", label: "开标日期无效" }
  const daysLeft = Math.ceil((t - nowMs) / MS_PER_DAY)
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
  return Number.isFinite(Date.parse(v)) ? v : null
}

// 发布日期异常复核（2026-11-02）：只标记，不静默删除或改值。
import { localDateStamp } from "@/lib/dateStamp"

/** 超过明天（留 1 天时区容差）的发布日视为异常；无日期不算异常 */
export function isIntelFutureDate(value: string, now = new Date()): boolean {
  const day = String(value || "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const tomorrow = new Date(now.getTime() + 86400000)
  return day > localDateStamp(tomorrow)
}

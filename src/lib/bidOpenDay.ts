// 开标日期（bid_open_date）的**唯一解析口径**（R68）。
//
// 为什么单独成文件：这个字段在库里同时存在两种历史格式，而全仓有四处消费者各写一套解析：
//   - `2026-12-01`（新建/补录表单写入，date-only）
//   - `2026-12-01 00:00:00.000Z`（招标解析与旧版写入，PocketBase 的日期时间串）
//
// 两种格式都被当成「日历日」，但 `Date.parse` / `new Date()` 对 date-only 串走的是 **UTC 零点**，
// 在 UTC+8 下等于当地 08:00。后果不是「解析失败」而是「**每天 00:00–08:00 多算一天**」：
//   2026-10-31 当天 01:00 实测 `bidOpenDateStatus("2026-10-31")` → 「距开标 1 天」（应为「今日开标」）；
//   2026-12-01 在 07:59 说「32 天」，到 08:00 变成「31 天」——倒计时在早上 8 点跳，不在零点跳。
// 同一天首页卡（R67 已改本地零点）说「剩 31 天」、标书工作台说「距开标截止 32 天」，同一屏两个答案。
//
// 所以：**一律取前 10 位（年月日）按本地零点重建**，再做「本地日历日」差值。全仓只此一份。
//
// 红线自查：纯函数，不碰 React / 后端 / 数据；不改 bidTypes.ts 与 useBidWorkspace.ts。

import { localDateStamp } from "./dateStamp"

export const MS_PER_DAY = 86_400_000

/**
 * 开标日期 → **当地零点**毫秒；无法识别返回 NaN。
 *
 * 只取前 10 位（年月日）按本地零点重建，date-only 与 PB 日期时间串同口径；月份/日越界
 * （如 2026-13-01）会被 Date 顺延成别的日子，所以做一次回读校验，越界一律判为无法识别。
 */
export function bidOpenDayMs(raw: string | null | undefined): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? "").trim())
  if (!m) return NaN
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const d = new Date(year, month - 1, day)
  if (Number.isNaN(d.getTime())) return NaN
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return NaN
  return d.getTime()
}

/** 开标日期 → 展示用 `YYYY-MM-DD`（绝不把库里的日期时间串直接打到界面上）；无法识别返回空串。 */
export function bidOpenDateDay(raw: string | null | undefined): string {
  const ms = bidOpenDayMs(raw)
  if (Number.isNaN(ms)) return ""
  return localDateStamp(new Date(ms))
}

/** 某个时刻所在**当地日历日**的零点毫秒。 */
export function localDayStartMs(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * 距开标还有几个**日历日**（今天开标 = 0，昨天开标 = -1）；无法识别返回 null。
 * @param nowMs 基准时刻（测试可注入固定时钟）
 */
export function daysUntilLocalDay(raw: string | null | undefined, nowMs: number = Date.now()): number | null {
  const day = bidOpenDayMs(raw)
  if (Number.isNaN(day)) return null
  return Math.round((day - localDayStartMs(nowMs)) / MS_PER_DAY)
}

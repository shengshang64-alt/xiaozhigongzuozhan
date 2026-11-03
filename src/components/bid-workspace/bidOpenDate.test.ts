import { describe, expect, it } from "vitest"
import { bidOpenDateDay, bidOpenDateStatus, normalizeBidOpenDateInput } from "./bidOpenDate"
import { countMatches, sourceText } from "@/testing/hookSources"

// 固定基准时刻，避免依赖真实时钟（2026-10-08T00:00:00Z）
const now = Date.parse("2026-10-08T00:00:00Z")
const day = (n: number) => new Date(now + n * 86_400_000).toISOString().slice(0, 10)
/** 当地时刻构造（不经过 UTC 串，避免测试自己踩 UTC 坑） */
const atLocal = (y: number, m: number, d: number, h: number, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()

describe("bidOpenDateStatus", () => {
  it("空值 / undefined → missing 未登记", () => {
    expect(bidOpenDateStatus("", now).tone).toBe("missing")
    expect(bidOpenDateStatus(undefined, now).tone).toBe("missing")
  })
  it("非法日期串 → missing 且 daysLeft 为 null", () => {
    const r = bidOpenDateStatus("not-a-date", now)
    expect(r.tone).toBe("missing")
    expect(r.daysLeft).toBeNull()
  })
  it("未来 >7 天 → normal，label 含剩余天数", () => {
    const r = bidOpenDateStatus(day(20), now)
    expect(r.tone).toBe("normal")
    expect(r.daysLeft).toBe(20)
    expect(r.label).toContain("20")
  })
  it("≤7 天（3 天）→ urgent", () => {
    expect(bidOpenDateStatus(day(3), now).tone).toBe("urgent")
  })
  it("过去 2 天 → past，label 含绝对天数", () => {
    const r = bidOpenDateStatus(day(-2), now)
    expect(r.tone).toBe("past")
    expect(r.label).toContain("2")
  })
  it("今日开标（0 天）→ past 今日开标", () => {
    const r = bidOpenDateStatus(day(0), now)
    expect(r.tone).toBe("past")
    expect(r.label).toBe("今日开标")
  })
})

// R68：倒计时「每天 00:00–08:00 多算一天」的回归网。
// 旧实现 Date.parse(date-only) 走 UTC 零点 = 当地 08:00，于是开标当天凌晨说「距开标 1 天」，
// 2026-12-01 在 07:59 说 32 天、08:00 变 31 天（倒计时在早上 8 点跳，不在零点跳）。
describe("bidOpenDateStatus · 本地日历日口径（R68）", () => {
  it("开标当天 00:00–08:00 一律「今日开标」，不显示「距开标 1 天」", () => {
    for (const [h, mi] of [[0, 1], [0, 30], [1, 0], [7, 59]] as const) {
      const r = bidOpenDateStatus("2026-10-31", atLocal(2026, 10, 31, h, mi))
      expect(r.label, `${h}:${mi}`).toBe("今日开标")
      expect(r.daysLeft).toBe(0)
    }
  })

  it("同一天的任意时刻给出同一个天数（不再在早上 8 点跳变）", () => {
    const morning = bidOpenDateStatus("2026-12-01", atLocal(2026, 10, 31, 0, 30))
    const noon = bidOpenDateStatus("2026-12-01", atLocal(2026, 10, 31, 12, 0))
    const night = bidOpenDateStatus("2026-12-01", atLocal(2026, 10, 31, 23, 0))
    expect([morning.daysLeft, noon.daysLeft, night.daysLeft]).toEqual([31, 31, 31])
  })

  it("PocketBase 日期时间串与 date-only 同口径", () => {
    const at = atLocal(2026, 10, 31, 1, 0)
    expect(bidOpenDateStatus("2026-12-01 00:00:00.000Z", at).label).toBe(
      bidOpenDateStatus("2026-12-01", at).label,
    )
    expect(bidOpenDateStatus("2026-12-01 00:00:00.000Z", at).daysLeft).toBe(31)
  })

  it("开标日次日的 00:30 才是「已过期 1 天」", () => {
    expect(bidOpenDateStatus("2026-10-30", atLocal(2026, 10, 31, 0, 30)).label).toBe("已过期 1 天")
    expect(bidOpenDateStatus("2026-10-30", atLocal(2026, 10, 30, 23, 59)).label).toBe("今日开标")
  })
})

describe("bidOpenDateDay · 展示口径", () => {
  it("PB 日期时间串 → YYYY-MM-DD（不再直出 00:00:00.000Z）", () => {
    expect(bidOpenDateDay("2026-12-01 00:00:00.000Z")).toBe("2026-12-01")
    expect(bidOpenDateDay("2026-12-01")).toBe("2026-12-01")
  })
  it("空 / 非法 → 空串", () => {
    expect(bidOpenDateDay("")).toBe("")
    expect(bidOpenDateDay(undefined)).toBe("")
    expect(bidOpenDateDay("2026-13-01")).toBe("")
    expect(bidOpenDateDay("not-a-date")).toBe("")
  })
})

describe("补录条接线（源码哨兵）", () => {
  const bar = sourceText("src/components/bid-workspace/BidOpenDateBar.tsx")

  it("展示与编辑值都经过 bidOpenDateDay，不再把库里的原始串直接渲染", () => {
    expect(bar).toContain("const saved = bidOpenDateDay(savedRaw)")
    expect(countMatches(bar, /const saved = proj\?\.bid_open_date/g)).toBe(0)
  })

  it("倒计时走 bidOpenDateStatus（与首页卡同一个解析真源）", () => {
    expect(countMatches(bar, /bidOpenDateStatus\(/g)).toBe(1)
    expect(bar).toContain('from "@/components/bid-workspace/bidOpenDate"')
  })
})

describe("normalizeBidOpenDateInput", () => {
  it("空白 → 空串（表示清除）", () => {
    expect(normalizeBidOpenDateInput("")).toBe("")
    expect(normalizeBidOpenDateInput("   ")).toBe("")
  })
  it("合法 ISO 日期原样返回", () => {
    expect(normalizeBidOpenDateInput("2026-10-20")).toBe("2026-10-20")
  })
  it("非 yyyy-mm-dd 分隔 → null", () => {
    expect(normalizeBidOpenDateInput("2026/10/20")).toBeNull()
    expect(normalizeBidOpenDateInput("13-45-99")).toBeNull()
  })
  it("格式合规但日期非法（月份越界）→ null", () => {
    expect(normalizeBidOpenDateInput("2026-13-01")).toBeNull()
  })
})

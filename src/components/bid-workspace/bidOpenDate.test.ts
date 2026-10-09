import { describe, expect, it } from "vitest"
import { bidOpenDateStatus, normalizeBidOpenDateInput } from "./bidOpenDate"

// 固定基准时刻，避免依赖真实时钟（2026-10-08T00:00:00Z）
const now = Date.parse("2026-10-08T00:00:00Z")
const day = (n: number) => new Date(now + n * 86_400_000).toISOString().slice(0, 10)

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

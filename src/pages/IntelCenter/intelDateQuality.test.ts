import { describe, expect, it } from "vitest"
import { isIntelFutureDate } from "./intelDateQuality"

describe("情报发布日期异常复核", () => {
  const now = new Date("2026-11-02T12:00:00+08:00")

  it("远未来发布日标记为异常", () => {
    expect(isIntelFutureDate("2027-04-29", now)).toBe(true)
    expect(isIntelFutureDate("2026-11-04T08:00:00Z", now)).toBe(true)
  })

  it("今天/明天容差与历史日期不误报；无日期不算异常", () => {
    expect(isIntelFutureDate("2026-11-02", now)).toBe(false)
    expect(isIntelFutureDate("2026-11-03", now)).toBe(false)
    expect(isIntelFutureDate("2026-10-01", now)).toBe(false)
    expect(isIntelFutureDate("", now)).toBe(false)
  })
})

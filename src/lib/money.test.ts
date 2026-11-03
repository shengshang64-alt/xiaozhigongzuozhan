// Author: loop-R113
// zh-CN grouping uses U+002C commas in Node ICU; assert exact strings to
// pin the convention, not just the shape.
import { describe, expect, it } from "vitest"

import { formatCount, formatMoney } from "./money"

describe("formatMoney", () => {
  it("renders zh-CN grouping with exactly 2 decimals", () => {
    expect(formatMoney(1234)).toBe("1,234.00")
    expect(formatMoney(1234567.891)).toBe("1,234,567.89")
    expect(formatMoney(0.5)).toBe("0.50")
  })

  it("handles negatives and zero", () => {
    expect(formatMoney(0)).toBe("0.00")
    expect(formatMoney(-98765.4)).toBe("-98,765.40")
  })

  it("degrades non-finite input to zero instead of throwing", () => {
    expect(formatMoney(Number.NaN)).toBe("0.00")
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("0.00")
    // undefined sneaks in through loose callers typed as number at the edge
    expect(formatMoney(undefined as unknown as number)).toBe("0.00")
  })
})

describe("formatCount (R118)", () => {
  it("groups zh-CN with natural precision, no forced decimals", () => {
    expect(formatCount(1234)).toBe("1,234")
    expect(formatCount(0)).toBe("0")
    expect(formatCount(1234.5)).toBe("1,234.5")
  })

  it("caps fractional digits at 3 (legacy bare toLocaleString parity)", () => {
    expect(formatCount(1234.5678)).toBe("1,234.568")
  })

  it("degrades non-finite input to zero", () => {
    expect(formatCount(Number.NaN)).toBe("0")
    expect(formatCount(Infinity)).toBe("0")
  })
})

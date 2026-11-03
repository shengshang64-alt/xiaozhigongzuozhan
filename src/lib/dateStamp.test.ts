// Author: loop-R112
// Dates are built from LOCAL components (new Date(y, m, d)), so the expected
// strings are timezone-independent while still pinning the exact format.
import { describe, expect, it } from "vitest"

import { localDateCompact, localDateStamp } from "./dateStamp"

describe("localDateStamp", () => {
  it("formats a local date as YYYY-MM-DD with zero padding", () => {
    // month index 9 => October; single-digit day => padded
    expect(localDateStamp(new Date(2026, 9, 1))).toBe("2026-10-01")
    expect(localDateStamp(new Date(2026, 0, 5))).toBe("2026-01-05")
  })

  it("renders the LOCAL calendar day, not the UTC day", () => {
    // A local midnight-hour date must keep its local date regardless of how
    // toISOString() would shift it across the UTC boundary.
    const d = new Date(2026, 9, 1, 0, 30)
    expect(localDateStamp(d)).toBe("2026-10-01")
  })

  it("defaults to today's local date", () => {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, "0")
    expect(localDateStamp()).toBe(
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    )
  })
})

describe("localDateCompact", () => {
  it("formats a local date as YYYYMMDD without separators", () => {
    expect(localDateCompact(new Date(2026, 9, 1))).toBe("20261001")
    expect(localDateCompact(new Date(2026, 0, 5))).toBe("20260105")
  })
})

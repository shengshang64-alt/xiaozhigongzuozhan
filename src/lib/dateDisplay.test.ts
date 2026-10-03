// Author: loop-R114
// ISO date-time strings without a trailing "Z" are parsed as LOCAL time, so the
// expected strings below hold in any timezone while still pinning the format.
import { describe, expect, it } from "vitest"

import { formatDateDisplay, formatDateTime, formatDateTimeDisplay } from "./dateDisplay"

describe("formatDateDisplay", () => {
  it("renders YYYY-MM-DD with zero padding", () => {
    expect(formatDateDisplay("2026-01-05T03:04:00")).toBe("2026-01-05")
    expect(formatDateDisplay("2026-10-01T00:30:00")).toBe("2026-10-01")
  })
  it("returns empty string for empty input", () => {
    expect(formatDateDisplay("")).toBe("")
  })
  it("falls back to the first 10 chars for unparsable input", () => {
    expect(formatDateDisplay("2026-13-45T99:99:00")).toBe("2026-13-45")
    expect(formatDateDisplay("garbage-value")).toBe("garbage-va")
  })
})

describe("formatDateTimeDisplay", () => {
  it("renders YYYY-MM-DD HH:MM in local time with padding", () => {
    expect(formatDateTimeDisplay("2026-01-05T03:04:00")).toBe("2026-01-05 03:04")
    expect(formatDateTimeDisplay("2026-12-31T23:59:00")).toBe("2026-12-31 23:59")
  })
  it("returns empty string for empty input", () => {
    expect(formatDateTimeDisplay("")).toBe("")
  })
  it("falls back to the first 10 chars for unparsable input (unified with fmtDate)", () => {
    expect(formatDateTimeDisplay("not-a-timestamp")).toBe("not-a-time")
  })
})

describe("formatDateTime", () => {
  it("renders a Date object as local YYYY-MM-DD HH:MM (R117, seconds dropped)", () => {
    expect(formatDateTime(new Date(2026, 0, 5, 3, 4, 5))).toBe("2026-01-05 03:04")
    expect(formatDateTime(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31 23:59")
  })
  it("returns empty string for Invalid Date", () => {
    expect(formatDateTime(new Date("nope"))).toBe("")
  })
})

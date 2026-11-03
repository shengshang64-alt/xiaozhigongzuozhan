import { afterEach, describe, expect, it, vi } from "vitest"
import { formatRelativeTime } from "./relativeTime"
import { localDateStamp } from "./dateStamp"

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0)
vi.spyOn(Date, "now").mockReturnValue(NOW)
afterEach(() => vi.clearAllMocks())

// build an ISO string `ms` before the frozen NOW
const mk = (ms: number) => new Date(NOW - ms).toISOString()

// battery spanning every tier and both sides of the 30-day cutoff
const BATTERY = [
  10_000, 59_000, 90_000, 5 * 60_000, 59 * 60_000, 61 * 60_000,
  5 * 3_600_000, 23 * 3_600_000, 25 * 3_600_000, DAY, 2 * DAY,
  5 * DAY, 29 * DAY, 30 * DAY + 1, 100 * DAY, 400 * DAY,
]

describe("relativeTime shared core", () => {
  it("renders the three sub-day tiers exactly", () => {
    expect(formatRelativeTime(mk(10_000))).toBe("刚刚")
    expect(formatRelativeTime(mk(5 * 60_000))).toBe("5 分钟前")
    expect(formatRelativeTime(mk(5 * 3_600_000))).toBe("5 小时前")
  })
  it("defaults the >=1-day branch to unbounded X 天前", () => {
    expect(formatRelativeTime(mk(2 * DAY))).toBe("2 天前")
    expect(formatRelativeTime(mk(400 * DAY))).toBe("400 天前")
  })
  it("guards empty and invalid input", () => {
    expect(formatRelativeTime("")).toBe("")
    expect(formatRelativeTime("not-a-date")).toBe("")
  })
})

// ---- verbatim originals (pre-R108) as behavior oracles ----
function refSession(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const diff = Date.now() - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return "刚刚"
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  // R117: the >30d branch intentionally moved from the zh-CN slash
  // format to the app-wide dash single source; other tiers verbatim.
  return localDateStamp(new Date(t))
}

function refDoc(iso: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return "刚刚"
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 30) return `${diffDay} 天前`
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function refFeed(iso: string): string {
  if (!iso) return ""
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const diff = Date.now() - t
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const d = new Date(t)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

// ---- afterDay configs used by the migrated call sites ----
const sessionCfg = (d: Date, _diff: number, day: number) =>
  day < 30 ? `${day} 天前` : localDateStamp(d)

const docCfg = (d: Date, _diff: number, day: number) =>
  day < 30
    ? `${day} 天前`
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

const feedCfg = (d: Date) => {
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

describe("relativeTime byte-identity vs pre-R108 originals", () => {
  it("SessionListPanel output unchanged (>30d follows R117 dash format)", () => {
    for (const ms of [...BATTERY, 0]) {
      const iso = mk(ms)
      expect(formatRelativeTime(iso, sessionCfg)).toBe(refSession(iso))
    }
    expect(formatRelativeTime("", sessionCfg)).toBe(refSession(""))
  })
  it("knowledge DocListPanel output unchanged", () => {
    for (const ms of [...BATTERY, 0]) {
      const iso = mk(ms)
      expect(formatRelativeTime(iso, docCfg)).toBe(refDoc(iso))
    }
  })
  it("useActivityFeed output unchanged", () => {
    for (const ms of BATTERY) {
      const iso = mk(ms)
      expect(formatRelativeTime(iso, feedCfg)).toBe(refFeed(iso))
    }
  })
})

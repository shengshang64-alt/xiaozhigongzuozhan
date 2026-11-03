// 首页「投标节点 · 未来 60 天」卡的纯逻辑回归网（R67）。
//
// 缺陷背景（2026-10-30 实机取证）：库里 bid_open_date 存的是 PocketBase 日期时间串
// "2026-12-01 00:00:00.000Z"，旧实现把它拼成 "...ZT00:00:00" → Invalid Date → 项目被
// `continue` 静默跳过。实测 19 个可见项目里 3 个有开标时间，3 个全部被跳过，卡片恒显示
// 「未来 60 天没有开标项目」，而其中「【UI测试】中医院信息化建设项目」距开标 32 天。
import { describe, expect, it } from "vitest"
import { BID_NODE_HORIZON_DAYS, bidOpenDayMs, buildBidNodeLists, type BidNodeRow } from "./bidNodesLogic"

/** 固定时钟：2026-10-30 当地零点（与实机取证同一天） */
const TODAY = new Date(2026, 9, 30).getTime()

function row(patch: Partial<BidNodeRow> & { id: string }): BidNodeRow {
  return { project_name: "项目" + patch.id, ...patch }
}

describe("bidOpenDayMs · 开标日期解析（两种历史格式同口径）", () => {
  it("PocketBase 日期时间串（库里实际格式）→ 当地零点", () => {
    const ms = bidOpenDayMs("2026-12-01 00:00:00.000Z")
    expect(Number.isNaN(ms)).toBe(false)
    const d = new Date(ms)
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 12, 1])
    expect(d.getHours()).toBe(0)
    expect(d.getMinutes()).toBe(0)
  })

  it("date-only 串（新建表单写入）→ 同一个零点", () => {
    expect(bidOpenDayMs("2026-12-01")).toBe(bidOpenDayMs("2026-12-01 00:00:00.000Z"))
  })

  it("带前后空白的串也能认", () => {
    expect(bidOpenDayMs("  2026-12-01  ")).toBe(bidOpenDayMs("2026-12-01"))
  })

  it("空值 / 垃圾串 → NaN", () => {
    expect(Number.isNaN(bidOpenDayMs(""))).toBe(true)
    expect(Number.isNaN(bidOpenDayMs(null))).toBe(true)
    expect(Number.isNaN(bidOpenDayMs("not-a-date"))).toBe(true)
    expect(Number.isNaN(bidOpenDayMs("2026/12/01"))).toBe(true)
  })

  it("月份/日越界不会被 Date 顺延成别的日子", () => {
    expect(Number.isNaN(bidOpenDayMs("2026-13-01"))).toBe(true)
    expect(Number.isNaN(bidOpenDayMs("2026-02-30"))).toBe(true)
  })
})

describe("buildBidNodeLists · 未来 N 天开标项目", () => {
  it("回归主案：库里日期时间格式的项目必须出现在卡里（旧实现这里是 0 条）", () => {
    const rows = [row({ id: "a", project_name: "【UI测试】中医院信息化建设项目", bid_open_date: "2026-12-01 00:00:00.000Z" })]
    const { upcoming } = buildBidNodeLists(rows, TODAY)
    expect(upcoming).toHaveLength(1)
    expect(upcoming[0]).toMatchObject({ id: "a", date: "2026-12-01", daysLeft: 32 })
  })

  it("date-only 格式同样生效（两种写法不得一个进一个不进）", () => {
    const rows = [row({ id: "b", bid_open_date: "2026-12-01" })]
    expect(buildBidNodeLists(rows, TODAY).upcoming.map((n) => n.daysLeft)).toEqual([32])
  })

  it("已开标（过去日期）不进卡", () => {
    const rows = [
      row({ id: "c", bid_open_date: "2026-10-14 00:00:00.000Z" }),
      row({ id: "d", bid_open_date: "2026-10-29" }),
    ]
    expect(buildBidNodeLists(rows, TODAY).upcoming).toEqual([])
  })

  it("今天开标（0 天）要进卡", () => {
    expect(buildBidNodeLists([row({ id: "e", bid_open_date: "2026-10-30 00:00:00.000Z" })], TODAY).upcoming).toEqual([
      { id: "e", title: "项目e", hospital: "", date: "2026-10-30", daysLeft: 0 },
    ])
  })

  it("60 天边界进、61 天出", () => {
    const inEdge = new Date(2026, 9, 30 + BID_NODE_HORIZON_DAYS)
    const outEdge = new Date(2026, 9, 30 + BID_NODE_HORIZON_DAYS + 1)
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const rows = [
      row({ id: "in", bid_open_date: iso(inEdge) }),
      row({ id: "out", bid_open_date: iso(outEdge) }),
    ]
    expect(buildBidNodeLists(rows, TODAY).upcoming.map((n) => n.id)).toEqual(["in"])
  })

  it("多项目按剩余天数升序", () => {
    const rows = [
      row({ id: "late", bid_open_date: "2026-12-20 00:00:00.000Z" }),
      row({ id: "soon", bid_open_date: "2026-11-02 00:00:00.000Z" }),
      row({ id: "mid", bid_open_date: "2026-11-20" }),
    ]
    expect(buildBidNodeLists(rows, TODAY).upcoming.map((n) => n.id)).toEqual(["soon", "mid", "late"])
  })

  it("展示日期只给 YYYY-MM-DD，不把库里的时间串打到界面上", () => {
    const { upcoming } = buildBidNodeLists([row({ id: "f", bid_open_date: "2026-12-01 00:00:00.000Z" })], TODAY)
    expect(upcoming[0].date).toBe("2026-12-01")
  })

  it("无法识别的开标日期既不进卡、也不被当成「未填」（不误导用户去补录）", () => {
    const rows = [row({ id: "g", bid_open_date: "2026/12/01", stage: "composing" })]
    const { upcoming, missing } = buildBidNodeLists(rows, TODAY)
    expect(upcoming).toEqual([])
    expect(missing).toEqual([])
  })
})

describe("buildBidNodeLists · 未填开标时间的补录提醒", () => {
  it("进行中的项目进 missing，归档项目不进", () => {
    const rows = [
      row({ id: "m1", bid_open_date: "", stage: "composing" }),
      row({ id: "m2", bid_open_date: "   ", stage: "pending_parse" }),
      row({ id: "arch", bid_open_date: "", stage: "archived" }),
    ]
    expect(buildBidNodeLists(rows, TODAY).missing.map((r) => r.id)).toEqual(["m1", "m2"])
  })

  it("stage 为空的项目不提醒（历史数据无阶段信息，提示会变成噪音）", () => {
    expect(buildBidNodeLists([row({ id: "nostage", bid_open_date: "" })], TODAY).missing).toEqual([])
  })
})

describe("buildBidNodeLists · 回收站项目一律不出现", () => {
  it("deleted_at 有值的项目既不算开标也不算待补录", () => {
    const rows = [
      row({ id: "del1", bid_open_date: "2026-12-01 00:00:00.000Z", deleted_at: "2026-10-29 10:00:00.000Z" }),
      row({ id: "del2", bid_open_date: "", stage: "composing", deleted_at: "2026-10-29 10:00:00.000Z" }),
    ]
    expect(buildBidNodeLists(rows, TODAY)).toEqual({ upcoming: [], missing: [] })
  })
})

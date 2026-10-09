import { describe, expect, it } from "vitest"
import {
  buildActiveWork,
  countActiveWork,
  formatActiveWorkBreakdown,
  isBidActive,
  type ActiveWorkSourceRows,
} from "./activeWork"

const empty: ActiveWorkSourceRows = { bids: [], solutions: [], decks: [], quotes: [] }

describe("buildActiveWork", () => {
  it("聚合四个工作台进行中条目并按更新时间倒序", () => {
    const items = buildActiveWork({
      bids: [{ id: "b1", project_name: "海沧标书", hospital: "海沧医院", stage: "composing", updated: "2026-10-01T00:00:00Z" }],
      solutions: [{ id: "s1", solution_name: "智慧病房方案", hospital: "天好医院", doc_status: "generating", updated: "2026-10-05T00:00:00Z" }],
      decks: [{ id: "d1", deck_name: "院领导汇报", audience: "院领导", doc_status: "draft", updated: "2026-10-03T00:00:00Z" }],
      quotes: [{ id: "q1", quote_name: "一期报价", ref_name: "海沧项目", updated: "2026-10-02T00:00:00Z" }],
    })
    expect(items.map((i) => i.key)).toEqual(["solution_s1", "deck_d1", "quote_q1", "bid_b1"])
    expect(items[0].route).toBe("/solution-studio?solution=s1")
    expect(items[1].route).toBe("/ppt-quote?deck=d1")
    expect(items.find((i) => i.kind === "bid")?.statusLabel).toBe("编制中")
  })

  it("过滤已结束条目：已归档 / 软删除标书、已完成方案与 PPT 不入选", () => {
    const items = buildActiveWork({
      bids: [
        { id: "b1", stage: "archived", updated: "2026-10-06T00:00:00Z" },
        { id: "b2", deleted_at: "2026-10-06T00:00:00Z", updated: "2026-10-06T00:00:00Z" },
        { id: "b3", project_name: "在制", stage: "checking", updated: "2026-10-06T00:00:00Z" },
      ],
      solutions: [{ id: "s1", doc_status: "done", updated: "2026-10-06T00:00:00Z" }],
      decks: [{ id: "d1", doc_status: "done", updated: "2026-10-06T00:00:00Z" }],
      quotes: [],
    })
    expect(items.map((i) => i.key)).toEqual(["bid_b3"])
  })

  it("缺省状态按进行中处理，缺省名称回退占位文案", () => {
    const items = buildActiveWork({ ...empty, bids: [{ id: "b1", updated: "2026-10-01T00:00:00Z" }] })
    expect(items[0].name).toBe("未命名标书项目")
    expect(items[0].statusLabel).toBe("进行中")
  })

  it("报价条目把关联名称写入副标题", () => {
    const items = buildActiveWork({
      ...empty,
      quotes: [{ id: "q1", quote_name: "报价A", ref_name: "三明医院", updated: "2026-10-01T00:00:00Z" }],
    })
    expect(items[0].subtitle).toBe("关联 三明医院")
  })

  it("总数超过上限时截断到 12 条", () => {
    const bids = Array.from({ length: 20 }, (_, i) => ({
      id: `b${i}`,
      stage: "composing",
      updated: `2026-10-01T00:00:${String(i).padStart(2, "0")}Z`,
    }))
    const items = buildActiveWork({ ...empty, bids })
    expect(items.length).toBe(12)
  })

  it("空源返回空数组（供只读卡显示空态引导）", () => {
    expect(buildActiveWork(empty)).toEqual([])
  })

  it("isBidActive：软删除与归档判否", () => {
    expect(isBidActive({ id: "x", stage: "composing" })).toBe(true)
    expect(isBidActive({ id: "x", archived: true })).toBe(false)
  })
})

describe("countActiveWork / formatActiveWorkBreakdown", () => {
  it("统计进行中总数与分工作台明细，与聚合卡口径一致", () => {
    const rows: ActiveWorkSourceRows = {
      bids: [
        { id: "b1", stage: "composing" },
        { id: "b2", stage: "archived" },
        { id: "b3", deleted_at: "2026-10-06T00:00:00Z" },
        { id: "b4", stage: "checking" },
      ],
      solutions: [{ id: "s1", doc_status: "done" }, { id: "s2", doc_status: "partial" }],
      decks: [{ id: "d1", doc_status: "draft" }, { id: "d2", doc_status: "done" }],
      quotes: [{ id: "q1" }, { id: "q2" }, { id: "q3" }],
    }
    const s = countActiveWork(rows)
    expect(s.byKind).toEqual({ bid: 2, solution: 1, deck: 1, quote: 3 })
    expect(s.total).toBe(7)
  })

  it("总数不受单卡 12 展示上限截断（真实口径）", () => {
    const bids = Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, stage: "composing" }))
    expect(countActiveWork({ bids, solutions: [], decks: [], quotes: [] }).total).toBe(20)
    expect(buildActiveWork({ bids, solutions: [], decks: [], quotes: [] }).length).toBe(12)
  })

  it("明细串跳过 0 项并按标书/方案/PPT/报价固定顺序拼接", () => {
    expect(formatActiveWorkBreakdown({ bid: 3, solution: 0, deck: 2, quote: 1 })).toBe("标书 3 · PPT 2 · 报价 1")
  })

  it("空源总数为 0、明细为空串", () => {
    const s = countActiveWork({ bids: [], solutions: [], decks: [], quotes: [] })
    expect(s.total).toBe(0)
    expect(formatActiveWorkBreakdown(s.byKind)).toBe("")
  })
})

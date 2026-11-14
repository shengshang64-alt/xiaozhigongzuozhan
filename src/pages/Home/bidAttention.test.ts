import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { todayStartMs } from "./homeLayout"
import {
  buildBidAttention,
  isPendingBidResult,
  type BidAttentionRow,
} from "./bidAttention"

const TODAY_START = todayStartMs(new Date(2026, 10, 14, 15, 30).getTime()) // 2026-11-14

function row(over: Partial<BidAttentionRow> & { id: string }): BidAttentionRow {
  return {
    project_name: over.project_name ?? `项目${over.id}`,
    stage: "composing",
    ...over,
  }
}

describe("isPendingBidResult", () => {
  it("空和待定算未登记，中标/失单不算", () => {
    expect(isPendingBidResult("")).toBe(true)
    expect(isPendingBidResult("pending")).toBe(true)
    expect(isPendingBidResult("won")).toBe(false)
    expect(isPendingBidResult("lost")).toBe(false)
  })
})

describe("buildBidAttention", () => {
  it("未来开标进入距开标，按剩余天数升序", () => {
    const { upcoming } = buildBidAttention(
      [
        row({ id: "far", bid_open_date: "2026-12-01 00:00:00.000Z", project_name: "较远" }),
        row({ id: "near", bid_open_date: "2026-11-17 00:00:00.000Z", project_name: "较近" }),
        row({ id: "today", bid_open_date: "2026-11-14 00:00:00.000Z", project_name: "今天" }),
      ],
      TODAY_START,
    )
    expect(upcoming.map((x) => x.id)).toEqual(["today", "near", "far"])
    expect(upcoming[0].daysLeft).toBe(0)
    expect(upcoming[1].daysLeft).toBe(3)
    expect(upcoming[2].href).toBe("/bid-workspace?project=far")
  })

  it("开标已过且结果为空或待定 → 待回填；已登记中标/失单不再出现", () => {
    const { pendingResults, upcoming } = buildBidAttention(
      [
        row({ id: "empty", bid_open_date: "2026-11-01 00:00:00.000Z", bid_result: "", project_name: "未登" }),
        row({ id: "pend", bid_open_date: "2026-10-01 00:00:00.000Z", bid_result: "pending", project_name: "待定" }),
        row({ id: "won", bid_open_date: "2026-10-01 00:00:00.000Z", bid_result: "won", stage: "evaluated" }),
      ],
      TODAY_START,
    )
    expect(pendingResults.map((x) => x.id)).toEqual(["pend", "empty"])
    expect(pendingResults[0].daysLeft).toBeLessThan(pendingResults[1].daysLeft!)
    expect(upcoming.map((x) => x.id)).toEqual([])
    expect(pendingResults.find((x) => x.id === "won")).toBeUndefined()
  })

  it("编制中且未归档算还没写完；已评标、已归档不算；可给出已写章节", () => {
    const { incomplete } = buildBidAttention(
      [
        row({
          id: "writing",
          bid_open_date: "2026-12-01 00:00:00.000Z",
          bid_chapters: [{ content: "有正文" }, { content: "  " }, { content: "" }],
        }),
        row({ id: "eval", stage: "evaluated", bid_open_date: "2026-12-01 00:00:00.000Z" }),
        row({ id: "arch", stage: "composing", archived: true, bid_open_date: "2026-12-01 00:00:00.000Z" }),
        row({ id: "parse", stage: "pending_parse", bid_chapters: [] }),
      ],
      TODAY_START,
    )
    expect(incomplete.map((x) => x.id)).toEqual(["writing", "parse"])
    expect(incomplete[0].chapterLine).toBe("已写 1/3 章")
    expect(incomplete[1].chapterLine).toBe("尚未建章")
    expect(incomplete[1].stageLabel).toBe("待解析")
  })

  it("开标已过仍在编制：同时出现在待回填和还没写完", () => {
    const out = buildBidAttention(
      [row({ id: "late", bid_open_date: "2026-04-09 00:00:00.000Z", stage: "composing", bid_result: "" })],
      TODAY_START,
    )
    expect(out.pendingResults.map((x) => x.id)).toEqual(["late"])
    expect(out.incomplete.map((x) => x.id)).toEqual(["late"])
    expect(out.upcoming).toEqual([])
  })

  it("已删除的项目三组都不进；无开标日的编制中只进还没写完", () => {
    const out = buildBidAttention(
      [
        row({ id: "del", deleted_at: "2026-11-01", bid_open_date: "2026-11-20 00:00:00.000Z" }),
        row({ id: "nodate", stage: "checking", bid_open_date: "" }),
      ],
      TODAY_START,
    )
    expect(out.upcoming).toEqual([])
    expect(out.pendingResults).toEqual([])
    expect(out.incomplete.map((x) => x.id)).toEqual(["nodate"])
    expect(out.incomplete[0].daysLeft).toBeNull()
    expect(out.incomplete[0].stageLabel).toBe("检查中")
  })
})

describe("BidAttentionBoard 加载态", () => {
  it("加载时用三列骨架，不再只闪一句「正在读取投标项目…」", () => {
    const src = readFileSync(fileURLToPath(new URL("../../components/home/BidAttentionBoard.tsx", import.meta.url)), "utf-8")
    expect(src).toContain("animate-pulse")
    expect(src).toContain('aria-label="标书要事加载中"')
    expect(src).toContain("距开标")
    expect(src).toContain("还没写完")
    expect(src).toContain("待回填结果")
    expect(src).not.toContain("正在读取投标项目")
  })
})

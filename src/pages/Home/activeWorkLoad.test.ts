// R302 取数编排单测（close r281-active-work-per-entity-cap）：注入假 get 断言四件事——
//  1) list 路由回显的 totalItems 被真正读进 totals（旧实现只看 items，服务端总数被丢弃，
//     才有「最多 30×4 的取样下限被说成真实总数」）；
//  2) perPage / sort / 用户参数按旧语义原样拼进路径，取数请求形态不变；
//  3) 单卡返回 null（pbJsonGet 失败语义）或抛错都降级为空数组 + 未知总数(-1)，不阻塞首页；
//  4) 编排结果直接串到 countActiveWork 的截断判定，形成端到端口径闭环。
// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { countActiveWork, loadActiveWork } from "./activeWork"

const envelope = (n: number, total?: number) => ({
  items: Array.from({ length: n }, (_, i) => ({ id: `${i}`, stage: "composing" })),
  totalItems: total,
})

describe("loadActiveWork 读服务端总数", () => {
  it("四个集合的 totalItems 全部进 totals、items 进 rows", async () => {
    const get = vi.fn(async () => envelope(2, 137))
    const { rows, totals } = await loadActiveWork(get, "local-user", 30)
    expect(rows.bids.length).toBe(2)
    expect(rows.quotes.length).toBe(2)
    expect(totals).toEqual({ bid: 137, solution: 137, deck: 137, quote: 137 })
    expect(get).toHaveBeenCalledTimes(4)
  })

  it("路径带 perPage=样本量、sort=-updated 与编码后的用户 id（四条请求同构）", async () => {
    const seen: string[] = []
    const { totals } = await loadActiveWork(async (p) => {
      seen.push(p)
      return { items: [] }
    }, "a b/c", 30)
    expect(seen.length).toBe(4)
    expect(seen[0]).toContain("rh_user_id=a%20b%2Fc")
    expect(seen.every((p) => p.includes("perPage=30") && p.includes("sort=-updated"))).toBe(true)
    expect(seen.some((p) => p.includes("/api/bid_projects"))).toBe(true)
    expect(seen.some((p) => p.includes("/api/ppt_decks"))).toBe(true)
    expect(totals.bid).toBe(-1)
  })

  it("get 返回 null（pbJsonGet 的失败语义）→ 空数组 + 全 -1，不判截断", async () => {
    const { rows, totals } = await loadActiveWork(async () => null, "u", 30)
    expect(rows).toEqual({ bids: [], solutions: [], decks: [], quotes: [] })
    expect(totals).toEqual({ bid: -1, solution: -1, deck: -1, quote: -1 })
    expect(countActiveWork(rows, totals).exact).toBe(true)
  })

  it("get 抛错也逐卡降级，首页不被单卡异常拖崩", async () => {
    const get = async (path: string) => {
      if (path.includes("bid_projects")) throw new Error("boom")
      return envelope(1, 1)
    }
    const { rows, totals } = await loadActiveWork(get, "u", 30)
    expect(rows.bids).toEqual([])
    expect(totals.bid).toBe(-1)
    expect(totals.quote).toBe(1)
  })

  it("totalItems 非法（字符串 / 负数）按未知处理", async () => {
    const { totals } = await loadActiveWork(async () => ({ items: [], totalItems: "-1" }), "u", 30)
    expect(totals.bid).toBe(-1)
  })

  it("串到计数：样本 30 / 全库 137 → 标书计数判为下限，界面据此补「+」", async () => {
    const get = async (path: string) => (path.includes("bid_projects") ? envelope(30, 137) : envelope(1, 1))
    const { rows, totals } = await loadActiveWork(get, "u", 30)
    const s = countActiveWork(rows, totals)
    expect(s.truncated.bid).toBe(true)
    expect(s.exact).toBe(false)
  })
})

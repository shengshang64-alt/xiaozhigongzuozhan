import { describe, expect, it } from "vitest"
import { buildWinLossReview } from "./winLossReview"
import type { CustomerRow, OpportunityRow } from "./customerTypes"

// R29（test-net-01）：赢单/丢单复盘纯聚合的行为锈死网
// 锁死点：R28 运行时坐实的 Pareto 计数/占比/累计与分客群 join 口径
const opp = (patch: Partial<OpportunityRow> & { id: string; stage: string }): OpportunityRow =>
  ({ customer_id: "", opp_name: patch.id, lost_reason: "", ...patch }) as OpportunityRow

const cust = (id: string, hospital_type: string): CustomerRow =>
  ({ id, hospital_name: `医院${id}`, hospital_type }) as CustomerRow

describe("buildWinLossReview", () => {
  const rows = [
    opp({ id: "a", stage: "lost", customer_id: "c1", lost_reason: "【价格因素】低价 8%" }),
    opp({ id: "b", stage: "lost", customer_id: "c1", lost_reason: "【价格因素】" }),
    opp({ id: "c", stage: "lost", customer_id: "c2", lost_reason: "友商关系深" }),
    opp({ id: "d", stage: "lost", customer_id: "c2", lost_reason: "" }),
    opp({ id: "e", stage: "won", customer_id: "c1" }),
    opp({ id: "f", stage: "won", customer_id: "c2" }),
    opp({ id: "g", stage: "bidding", customer_id: "c1" }),
    opp({ id: "h", stage: "solution", customer_id: "c2" }),
  ]
  const customers = [cust("c1", "综合医院"), cust("c2", "中医院")]

  it("终态过滤与胜率：非终态不参与", () => {
    const r = buildWinLossReview(rows, customers)
    expect(r.decidedCount).toBe(6)
    expect(r.won).toBe(2)
    expect(r.lost).toBe(4)
    expect(r.winRate).toBe(33)
  })

  it("Pareto 按计数降序、占比与累计百分比正确、类别前缀提取", () => {
    const r = buildWinLossReview(rows, customers)
    expect(r.lostReasonPareto.map((x) => x.reason)).toEqual(["价格因素", "未填写原因", "友商关系深"])
    expect(r.lostReasonPareto[0]).toMatchObject({ count: 2, pct: 50, cumPct: 50 })
    expect(r.lostReasonPareto[2].cumPct).toBe(100)
  })

  it("分客群按 hospital_type join，含每群胜率", () => {
    const r = buildWinLossReview(rows, customers)
    const c1 = r.segmentWinRates.find((s) => s.segment === "综合医院")
    const c2 = r.segmentWinRates.find((s) => s.segment === "中医院")
    expect(c1).toMatchObject({ won: 1, lost: 2, winRate: 33 })
    expect(c2).toMatchObject({ won: 1, lost: 2, winRate: 33 })
  })

  it("找不到客户档案的商机归「未知类型」（分页未加载客户的诚实口径）", () => {
    const r = buildWinLossReview([opp({ id: "x", stage: "lost", customer_id: "ghost" })], customers)
    expect(r.segmentWinRates).toEqual([{ segment: "未知类型", won: 0, lost: 1, winRate: 0 }])
  })

  it("空终态：winRate null 且不除零", () => {
    const r = buildWinLossReview([opp({ id: "y", stage: "lead" })], customers)
    expect(r).toMatchObject({ decidedCount: 0, won: 0, lost: 0, winRate: null })
    expect(r.lostReasonPareto).toEqual([])
    expect(r.segmentWinRates).toEqual([])
  })

  it("partial 透传", () => {
    expect(buildWinLossReview(rows, customers, { partial: true }).partial).toBe(true)
    expect(buildWinLossReview(rows, customers).partial).toBe(false)
  })
})

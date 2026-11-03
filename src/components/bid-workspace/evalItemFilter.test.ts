import { describe, it, expect } from "vitest"
import { filterEvalRowIndexes, isGapBidItem, isLowScoreBidItem } from "./evalItemFilter"

describe("isLowScoreBidItem 低得分率单一真源", () => {
  it("得分率 <60% 且最高分 >0 → true", () => {
    expect(isLowScoreBidItem({ max_score: 10, ai_score: 5 })).toBe(true)
    expect(isLowScoreBidItem({ max_score: 10, ai_score: 5.9 })).toBe(true)
  })
  it("得分率 >=60% → false", () => {
    expect(isLowScoreBidItem({ max_score: 10, ai_score: 6 })).toBe(false)
    expect(isLowScoreBidItem({ max_score: 10, ai_score: 10 })).toBe(false)
  })
  it("最高分 0 不计入低分（避免除零）", () => {
    expect(isLowScoreBidItem({ max_score: 0, ai_score: 0 })).toBe(false)
  })
})

describe("isGapBidItem AI-人工分差", () => {
  it("人工已打分且分差 >=2 → true", () => {
    expect(isGapBidItem({ max_score: 10, ai_score: 8 }, { manual_score: 5 })).toBe(true)
    expect(isGapBidItem({ max_score: 10, ai_score: 8 }, { manual_score: 6 })).toBe(true)
  })
  it("分差 <2 → false", () => {
    expect(isGapBidItem({ max_score: 10, ai_score: 8 }, { manual_score: 7 })).toBe(false)
  })
  it("人工未打分 (0) 或缺失 → false", () => {
    expect(isGapBidItem({ max_score: 10, ai_score: 8 }, { manual_score: 0 })).toBe(false)
    expect(isGapBidItem({ max_score: 10, ai_score: 8 }, undefined)).toBe(false)
  })
})

describe("filterEvalRowIndexes 保留原始下标", () => {
  const items = [
    { max_score: 10, ai_score: 3 }, // 0 低分，与人工 8 差 5
    { max_score: 10, ai_score: 9 }, // 1 非低分，与人工 9 差 0
    { max_score: 10, ai_score: 4 }, // 2 低分，与人工 4 差 0
  ]
  const manual = [{ manual_score: 8 }, { manual_score: 9 }, { manual_score: 4 }]
  it("none 返回全部原始下标", () => {
    expect(filterEvalRowIndexes(items, manual, "none")).toEqual([0, 1, 2])
  })
  it("low 只保留低分项 0、2", () => {
    expect(filterEvalRowIndexes(items, manual, "low")).toEqual([0, 2])
  })
  it("gap 只保留分差 >=2 的项 0", () => {
    expect(filterEvalRowIndexes(items, manual, "gap")).toEqual([0])
  })
  it("manual 缺省时 gap 返回空且不抛", () => {
    expect(filterEvalRowIndexes(items, undefined, "gap")).toEqual([])
  })
})

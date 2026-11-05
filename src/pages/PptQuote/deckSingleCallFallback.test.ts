// ---------------------------------------------------------------------------
// 单发页数不足的回退决策单测（2026-11-04）
//
// 实测缺陷：要 10 页、模型返回 5 页 → 上一轮判据 `got < ceil(10/2)` 即 `5 < 5` 为 false，
// **没触发重试**，直接补 5 页「待补充章节」，用户拿到半成品册子。
//
// 本文件钉住三档处置：够 → 采用；缺一点 → 补占位；缺太多 → 回退逐页重做。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import { decideSingleCallOutcome } from "./deckSingleCallFallback"

describe("decideSingleCallOutcome · 单发结果处置", () => {
  it("达到或超过目标 → 直接采用", () => {
    expect(decideSingleCallOutcome(10, 10)).toEqual({ action: "accept", got: 10 })
    expect(decideSingleCallOutcome(12, 10)).toEqual({ action: "accept", got: 12 })
  })

  it("只缺一点（≤20%）→ 补占位（不值得整册重做烧钱）", () => {
    // 10 页目标容差 2 页：缺 1、缺 2 都补占位
    expect(decideSingleCallOutcome(9, 10)).toEqual({ action: "pad", got: 9, missing: 1 })
    expect(decideSingleCallOutcome(8, 10)).toEqual({ action: "pad", got: 8, missing: 2 })
  })

  it("缺太多（>20%）→ 回退逐页生成（不许拿半本占位糊弄）", () => {
    // 这条就是实测撞到的：10 页只回 5 页
    const v = decideSingleCallOutcome(5, 10)
    expect(v.action).toBe("fallback")
    if (v.action === "fallback") expect(v.missing).toBe(5)
    expect(decideSingleCallOutcome(3, 10).action).toBe("fallback")
    expect(decideSingleCallOutcome(1, 10).action).toBe("fallback")
  })

  it("小目标也至少有 1 页容差（不许 3 页册缺 1 页就回退）", () => {
    expect(decideSingleCallOutcome(2, 3)).toEqual({ action: "pad", got: 2, missing: 1 })
    expect(decideSingleCallOutcome(1, 2)).toEqual({ action: "pad", got: 1, missing: 1 })
  })

  it("0 页 → 必须回退（不能给一本空册子）", () => {
    expect(decideSingleCallOutcome(0, 10).action).toBe("fallback")
  })

  it("脏入参不炸", () => {
    expect(decideSingleCallOutcome(Number.NaN, 10).action).toBe("fallback")
    expect(decideSingleCallOutcome(-3, 10).action).toBe("fallback")
    expect(decideSingleCallOutcome(5, 0).action).toBe("accept") // target<=0 按 1 处理，5>=1
  })

  it("容差比例传 0 时下限仍为 1 页（否则任何不足都回退，成本过高）", () => {
    // 注意：这是**有意**的下限设计——toleranceRatio 只调上限，不能压到 0 页容差，
    // 否则「3 页册缺 1 页」都会触发整册重做（重新花一次钱），不划算。
    const v = decideSingleCallOutcome(9, 10, { toleranceRatio: 0 })
    expect(v.action).toBe("pad")
    if (v.action === "pad") expect(v.missing).toBe(1)
    // 缺 2 页时（超出 1 页容差）才回退
    expect(decideSingleCallOutcome(8, 10, { toleranceRatio: 0 }).action).toBe("fallback")
  })
})

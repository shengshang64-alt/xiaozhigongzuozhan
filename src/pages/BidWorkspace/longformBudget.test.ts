// R191：长文分块规划的口径锁定（数值来自 2026-10-06 本地网关红线实测）。
import { describe, expect, it } from "vitest"
import {
  LONGFORM_CALL_MAX_CHARS,
  LONGFORM_CALL_MAX_TOKENS,
  longformCallTokens,
  planLongformChunks,
  shouldDisableThinking,
  stripDuplicateSectionHead,
} from "./longformBudget"

describe("planLongformChunks（把必超时的单次大目标拆成红线内可完成的小目标）", () => {
  it("实测场景：单小节 5409 字 → 拆 3 块，每块不超上限且总量守恒", () => {
    const plan = planLongformChunks(5409)
    expect(plan.length).toBe(3)
    expect(plan.every((c) => c <= LONGFORM_CALL_MAX_CHARS)).toBe(true)
    expect(plan.reduce((a, b) => a + b, 0)).toBe(5409)
  })
  it("实测场景：一键补齐缺口 47900 字 → 单次操作最多 6 块（不假装一次补完）", () => {
    const plan = planLongformChunks(47900)
    expect(plan.length).toBe(6)
    expect(plan.reduce((a, b) => a + b, 0)).toBe(LONGFORM_CALL_MAX_CHARS * 6)
  })
  it("小目标单块原样（≤ 上限不拆，行为与现状一致）", () => {
    expect(planLongformChunks(800)).toEqual([800])
    expect(planLongformChunks(LONGFORM_CALL_MAX_CHARS)).toEqual([LONGFORM_CALL_MAX_CHARS])
  })
  it("末块过小并入前块，不为几十次字符再发一次请求", () => {
    expect(planLongformChunks(2300)).toEqual([2300])
    expect(planLongformChunks(4100)).toEqual([2000, 2100])
  })
  it("0 / 负数 / 非数 → 空计划（调用方据此不发请求）", () => {
    expect(planLongformChunks(0)).toEqual([])
    expect(planLongformChunks(-500)).toEqual([])
    expect(planLongformChunks(NaN)).toEqual([])
  })
  it("可覆盖单次上限与块数上限（供不同链路按需节流）", () => {
    expect(planLongformChunks(6000, { maxCharsPerCall: 1200, maxChunks: 2 })).toEqual([1200, 1200])
  })
})

describe("longformCallTokens / shouldDisableThinking", () => {
  it("2000 字块换算为 4096 以下的 token 档，绝不请求实测必超时的 8192 档", () => {
    const t = longformCallTokens(2000)
    expect(t).toBeGreaterThan(0)
    expect(t).toBeLessThanOrEqual(LONGFORM_CALL_MAX_TOKENS)
    expect(t).toBeLessThan(8192)
  })
  it("小请求保留 token 下限，超大请求封顶在安全档", () => {
    expect(longformCallTokens(100)).toBe(1024)
    expect(longformCallTokens(50000)).toBe(LONGFORM_CALL_MAX_TOKENS)
  })
  it("R192 口径：长文块一律首调关思考（实测开思考的 1409 字尾块返回空回复中断补齐）", () => {
    expect(shouldDisableThinking(400)).toBe(true)
    expect(shouldDisableThinking(800)).toBe(true)
    expect(shouldDisableThinking(2000)).toBe(true)
    expect(shouldDisableThinking(0)).toBe(false)
  })
})

describe("stripDuplicateSectionHead（同小节分次拼接不重复标题行）", () => {
  it("带编号的同名标题行被去掉，正文从下一行开始", () => {
    const raw = "3.2 总体建设方案\n医院信息化建设需要…"
    expect(stripDuplicateSectionHead(raw, "3.2", "总体建设方案")).toBe("医院信息化建设需要…")
  })
  it("无编号但正文同名标题行同样去掉", () => {
    expect(stripDuplicateSectionHead("总体建设方案\n正文", "", "总体建设方案")).toBe("正文")
  })
  it("标题行编号不同/是小节名的其它内容不误删", () => {
    expect(stripDuplicateSectionHead("3.3 实施进度计划\n正文", "3.2", "总体建设方案")).toBe("3.3 实施进度计划\n正文")
    expect(stripDuplicateSectionHead("本小节承接总体建设方案的落地路径\n正文", "3.2", "总体建设方案")).toContain("本小节承接")
  })
  it("整串只有标题行 → 空串（调用方按空产出跳过，不落库空块）", () => {
    expect(stripDuplicateSectionHead("3.2 总体建设方案", "3.2", "总体建设方案")).toBe("")
  })
  it("空输入与非名字段安全", () => {
    expect(stripDuplicateSectionHead("", "3.2", "总体建设方案")).toBe("")
    expect(stripDuplicateSectionHead("正文", "3.2", "")).toBe("正文")
  })
})

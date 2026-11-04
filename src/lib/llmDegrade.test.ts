import { describe, expect, it } from "vitest"
import { planTimeoutDegrade } from "./llmDegrade"
import { PERSONAL_TIMEOUT_MSG, TIMEOUT_RETRY_MIN_TOKENS } from "./modelGateway"

describe("planTimeoutDegrade · 什么时候不降级", () => {
  it("首调成功：完全不降级（不浪费一次请求）", () => {
    const p = planTimeoutDegrade(true, undefined, 8192)
    expect(p.retry).toBe(false)
    expect(p.budgets).toEqual([])
    expect(p.reason).toContain("无需降级")
  })

  it("非超时失败（内容审核）：不盲目重试，避免重复计费", () => {
    const p = planTimeoutDegrade(false, "内容审核未通过，请调整措辞后重试", 8192)
    expect(p.retry).toBe(false)
    expect(p.budgets).toEqual([])
    expect(p.reason).toContain("不盲目重试")
  })

  it("余额/鉴权类失败同样不重试", () => {
    for (const err of ["insufficient balance", "401 unauthorized", "模型不存在"]) {
      expect(planTimeoutDegrade(false, err, 8192).retry).toBe(false)
    }
  })

  it("首调预算已在下限：再折是空转，不重试", () => {
    const p = planTimeoutDegrade(false, PERSONAL_TIMEOUT_MSG, TIMEOUT_RETRY_MIN_TOKENS)
    expect(p.retry).toBe(false)
    expect(p.budgets).toEqual([])
    expect(p.reason).toContain("下限")
  })

  it("预算比下限还小（脏入参）也不重试、不出负数", () => {
    for (const b of [0, -100, Number.NaN]) {
      const p = planTimeoutDegrade(false, "timeout", b)
      expect(p.retry).toBe(false)
    }
  })
})

describe("planTimeoutDegrade · 降级阶梯的数字", () => {
  it("8192 起步：折半到下限为止，序列严格递减且末档不低于下限", () => {
    const p = planTimeoutDegrade(false, PERSONAL_TIMEOUT_MSG, 8192)
    expect(p.retry).toBe(true)
    expect(p.budgets.length).toBeGreaterThan(0)
    expect(p.budgets[0]).toBe(4096)
    for (let i = 1; i < p.budgets.length; i++) {
      expect(p.budgets[i]!).toBeLessThanOrEqual(p.budgets[i - 1]!)
    }
    expect(p.budgets.every((b) => b >= TIMEOUT_RETRY_MIN_TOKENS)).toBe(true)
    expect(p.budgets[p.budgets.length - 1]).toBe(TIMEOUT_RETRY_MIN_TOKENS)
  })

  it("服务端超时串（英文）也认：Upstream request timed out", () => {
    expect(planTimeoutDegrade(false, "Upstream request timed out after 300s", 4096).retry).toBe(true)
  })

  it("阶梯有上限保护：异常巨大的预算也不会规划出几十次请求（每次都是真钱）", () => {
    const p = planTimeoutDegrade(false, "timeout", 10_000_000)
    expect(p.retry).toBe(true)
    expect(p.budgets.length).toBeLessThanOrEqual(8)
  })

  it("reason 是中文人话，带具体档位，可直接进日志", () => {
    const p = planTimeoutDegrade(false, PERSONAL_TIMEOUT_MSG, 8192)
    expect(p.reason).toMatch(/[一-鿿]/)
    expect(p.reason).toContain("4096")
  })
})

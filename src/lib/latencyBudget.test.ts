// R180：按模型实测延迟自适应首轮预算的单测（锁契约防重构回退）
import { beforeEach, describe, expect, it } from "vitest"
import { TIMEOUT_RETRY_MIN_TOKENS, nextDegradedBudget } from "@/lib/modelGateway"
import {
  SAFE_LATENCY_MS,
  noteKnownGoodBudget,
  observeModelCall,
  resetModelLatencyRecords,
  suggestInitialBudget,
} from "@/lib/latencyBudget"

describe("latencyBudget（R180 自适应首轮预算）", () => {
  beforeEach(() => {
    resetModelLatencyRecords()
  })

  it("安全窗编码红线经验值：低于 120s 网关上限且留足余量", () => {
    expect(SAFE_LATENCY_MS).toBeGreaterThanOrEqual(90_000)
    expect(SAFE_LATENCY_MS).toBeLessThan(120_000)
  })

  it("无证据模型原样放行：预算不动且不关思考（行为与 R177 后一致）", () => {
    expect(suggestInitialBudget("personal:cfg-a|glm-4.6", 4096)).toEqual({
      tokens: 4096,
      disableThinking: false,
    })
  })

  it("首次超时无已知档：下一轮从折半档起步并同步关思考", () => {
    observeModelCall("m1", 150_000, "timeout")
    const s = suggestInitialBudget("m1", 4096)
    expect(s.tokens).toBe(nextDegradedBudget(4096))
    expect(s.disableThinking).toBe(true)
  })

  it("有已知可用档：直接从验证档起步，不再首调交超时税", () => {
    observeModelCall("m1", 150_000, "timeout")
    noteKnownGoodBudget("m1", 2048)
    const s = suggestInitialBudget("m1", 4096)
    expect(s.tokens).toBe(2048)
    expect(s.disableThinking).toBe(true)
  })

  it("请求不高于已知档：不压缩也不关思考", () => {
    observeModelCall("m1", 150_000, "timeout")
    noteKnownGoodBudget("m1", 2048)
    const s = suggestInitialBudget("m1", 2048)
    expect(s.tokens).toBe(2048)
    expect(s.disableThinking).toBe(false)
  })

  it("2048 及以下小档请求（解析类）永不被降级：下限护栏", () => {
    observeModelCall("m1", 150_000, "timeout")
    observeModelCall("m1", 150_000, "timeout")
    const s = suggestInitialBudget("m1", 1024)
    expect(s.tokens).toBe(1024)
    expect(s.disableThinking).toBe(false)
    expect(TIMEOUT_RETRY_MIN_TOKENS).toBe(2048)
  })

  it("贴红线慢证据同样预降级；随后快成功解除慢标并回到原样放行", () => {
    observeModelCall("m1", SAFE_LATENCY_MS, "success")
    expect(suggestInitialBudget("m1", 4096).disableThinking).toBe(true)
    observeModelCall("m1", 30_000, "success")
    const s = suggestInitialBudget("m1", 4096)
    expect(s.tokens).toBe(4096)
    expect(s.disableThinking).toBe(false)
  })

  it("超时证据随快成功释放，但已验证档保留：同档请求不回退交超时税", () => {
    observeModelCall("m1", 150_000, "timeout")
    noteKnownGoodBudget("m1", 2048)
    observeModelCall("m1", 40_000, "success")
    const s = suggestInitialBudget("m1", 4096)
    expect(s.tokens).toBe(2048)
    expect(s.disableThinking).toBe(true)
  })

  it("已知档只升不降：更大档验证后上调，小档成功不回拉保守位", () => {
    noteKnownGoodBudget("m1", 2048)
    noteKnownGoodBudget("m1", 4096)
    expect(suggestInitialBudget("m1", 4096).tokens).toBe(4096)
    noteKnownGoodBudget("m1", 2048)
    expect(suggestInitialBudget("m1", 4096).tokens).toBe(4096)
  })

  it("不同模型互不影响：慢模型证据不污染快模型首调", () => {
    observeModelCall("slow-model", 150_000, "timeout")
    expect(suggestInitialBudget("fast-model", 4096).tokens).toBe(4096)
  })

  it("reset 后全部证据清零", () => {
    observeModelCall("m1", 150_000, "timeout")
    resetModelLatencyRecords()
    expect(suggestInitialBudget("m1", 4096)).toEqual({ tokens: 4096, disableThinking: false })
  })
})

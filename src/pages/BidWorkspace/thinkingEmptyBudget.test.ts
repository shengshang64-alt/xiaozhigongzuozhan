// Q28 切片E：推理模型「开思考 → 空正文」证据位（首调直接关思考，预算档位不动）
import { beforeEach, describe, expect, it } from "vitest"
import {
  noteThinkingEmptyReply,
  observeModelCall,
  resetModelLatencyRecords,
  suggestInitialBudget,
} from "@/lib/latencyBudget"

describe("thinkingEmpty 证据位（不再逐次白烧空回复）", () => {
  beforeEach(() => {
    resetModelLatencyRecords()
  })

  it("无证据模型原样放行：预算不动且不关思考", () => {
    expect(suggestInitialBudget("m0", 8192)).toEqual({ tokens: 8192, disableThinking: false })
  })

  it("置位后同模型首调直接关思考，但输出预算不缩水", () => {
    noteThinkingEmptyReply("m1")
    expect(suggestInitialBudget("m1", 8192)).toEqual({ tokens: 8192, disableThinking: true })
  })

  it("按模型隔离：其他模型不受该证据影响", () => {
    noteThinkingEmptyReply("slow-model")
    expect(suggestInitialBudget("fast-model", 4096).disableThinking).toBe(false)
    expect(suggestInitialBudget("slow-model", 4096).disableThinking).toBe(true)
  })

  it("小档请求（解析类）同样只关思考不动预算", () => {
    noteThinkingEmptyReply("m2")
    expect(suggestInitialBudget("m2", 1024)).toEqual({ tokens: 1024, disableThinking: true })
  })

  it("既有超时降级路径不变：仍按折半档起步 + 关思考", () => {
    observeModelCall("m3", 150_000, "timeout")
    const s = suggestInitialBudget("m3", 4096)
    expect(s.tokens).toBe(2048)
    expect(s.disableThinking).toBe(true)
  })

  it("reset 清空证据位（会话内模型重配无需调用）", () => {
    noteThinkingEmptyReply("m4")
    expect(suggestInitialBudget("m4", 4096).disableThinking).toBe(true)
    resetModelLatencyRecords()
    expect(suggestInitialBudget("m4", 4096).disableThinking).toBe(false)
  })
})

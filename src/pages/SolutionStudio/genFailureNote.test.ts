import { describe, expect, it } from "vitest"
import { BLANK_OUTPUT_REASON, GEN_ERROR_MAX_LEN, describeGenFailure } from "./genFailureNote"

describe("describeGenFailure（R280 失败原因落库前置归一）", () => {
  it("Error 带换行 → 折叠为单行", () => {
    expect(describeGenFailure(new Error("模型通道\n超时\rfailed"), "生成异常")).toBe("模型通道 超时 failed")
  })

  it("超长 message → 截断到上限", () => {
    const long = new Error("x".repeat(GEN_ERROR_MAX_LEN + 40))
    expect(describeGenFailure(long, "生成异常")).toHaveLength(GEN_ERROR_MAX_LEN)
  })

  it("空 message 的 Error → 落回 fallback（保证落库永远可读）", () => {
    expect(describeGenFailure(new Error("   "), "正文生成失败")).toBe("正文生成失败")
  })

  it("字符串异常（fetch 非 200 时常见）→ 原样可用", () => {
    expect(describeGenFailure("insufficient balance", "生成异常")).toBe("insufficient balance")
  })

  it("非 Error 非字符串（对象/null/undefined）→ 落回 fallback 而非 [object Object]", () => {
    expect(describeGenFailure({ code: 500 }, "生成异常")).toBe("生成异常")
    expect(describeGenFailure(null, "生成异常")).toBe("生成异常")
    expect(describeGenFailure(undefined, "生成异常")).toBe("生成异常")
  })

  it("空产出文案与单章 toast 口径一致", () => {
    expect(BLANK_OUTPUT_REASON).toBe("模型返回空正文")
  })

  // 2026-11-04：上限从 60 提到 120 的原因必须可执行复现，否则后人会按「60 也够」改回去。
  it("超时文案的处置建议必须完整落库（101 字不得被截）", () => {
    // 真实长度取自 modelGateway.ts 的 PERSONAL_TIMEOUT_MSG（71 字），此处用更长的构造句覆盖边界
    const timeoutMsg = "该模型本次响应超时（网关单次请求上限约 300 秒，偏慢的模型或超长小节容易触发）。请在顶部切换到响应更快的已配置模型后重试，或改为逐章分次生成。"
    expect(timeoutMsg.length).toBeGreaterThan(60)
    expect(timeoutMsg.length).toBeLessThanOrEqual(GEN_ERROR_MAX_LEN)
    const stored = describeGenFailure(new Error(timeoutMsg), "生成异常")
    expect(stored).toBe(timeoutMsg)
    // 最关键的处置建议必须还在
    expect(stored).toContain("逐章分次生成")
  })
})

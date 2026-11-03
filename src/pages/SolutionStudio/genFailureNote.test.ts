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
})

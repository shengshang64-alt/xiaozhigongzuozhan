import { describe, expect, it } from "vitest"
import { LLM_ERROR_ZH, localizeLlmError } from "./llmError"

describe("localizeLlmError 共享口径", () => {
  it("空值 / 空串 / 纯空白都落到中文兜底", () => {
    expect(localizeLlmError()).toBe("AI 调用失败，请稍后重试")
    expect(localizeLlmError("")).toBe("AI 调用失败，请稍后重试")
    expect(localizeLlmError("   ")).toBe("AI 调用失败，请稍后重试")
    expect(localizeLlmError(undefined, { generic: "生成失败，请稍后重试" })).toBe("生成失败，请稍后重试")
  })

  it("已收录错误码返回中文文案，且不会把内部码本身透出", () => {
    const cases: Array<[string, string]> = [
      ["timeout", "超时"],
      ["not_found", "网络"],
      ["rh_login_required", "登录"],
      ["insufficient_balance", "余额"],
      ["user_cancelled", "取消"],
    ]
    for (const [code, keyword] of cases) {
      const zh = localizeLlmError(code)
      expect(zh).toContain(keyword)
      expect(zh).not.toContain(code)
    }
  })

  it("未收录的裸英文码 / 英文句子一律替换为 generic，不透传原文", () => {
    expect(localizeLlmError("some_new_internal_code")).toBe("AI 调用失败，请稍后重试")
    expect(localizeLlmError("HTTP 500")).toBe("AI 调用失败，请稍后重试")
    expect(localizeLlmError("upstream model failed")).toBe("AI 调用失败，请稍后重试")
    expect(
      localizeLlmError("rate_limit_exceeded", { generic: "AI 摘要失败，请稍后重试" }),
    ).toBe("AI 摘要失败，请稍后重试")
  })

  it("后端已拼好的可读中文详情串直接透出，保留真实原因", () => {
    const detail = "个人模型请求超时（可能网络波动或服务重启），请重试或切换平台内置模型"
    expect(localizeLlmError(detail)).toBe(detail)
    expect(localizeLlmError("内容审核未通过，请调整措辞后重试")).toContain("内容审核未通过")
  })

  it("模块 copy 只覆写差异项，未覆写的键回落共享基表", () => {
    const copy: Record<string, string> = { rh_login_required: "请先登录 RunningHub 后再使用小智" }
    expect(localizeLlmError("rh_login_required", { copy })).toBe("请先登录 RunningHub 后再使用小智")
    expect(localizeLlmError("insufficient_balance", { copy })).toBe(LLM_ERROR_ZH.insufficient_balance)
  })

  it("copy 优先级高于基表，同一错误码可以按页面措辞分化", () => {
    const base = localizeLlmError("rh_login_required")
    const custom = localizeLlmError("rh_login_required", { copy: { rh_login_required: "该操作当前不可用" } })
    expect(custom).toBe("该操作当前不可用")
    expect(base).not.toBe(custom)
  })

  it("共享基表覆盖网关全部错误码，新增码不会漏网", () => {
    expect(Object.keys(LLM_ERROR_ZH).sort()).toEqual(
      ["insufficient_balance", "not_found", "rh_login_required", "timeout", "user_cancelled"].sort(),
    )
    for (const zh of Object.values(LLM_ERROR_ZH)) {
      expect(zh).toMatch(/[一-鿿]/)
    }
  })
})

describe("mapAssistantLlmError 走共享口径", () => {
  it("小智专属措辞保留，未收录码落小智兜底串", async () => {
    const { mapAssistantLlmError } = await import("./assistantCore")
    expect(mapAssistantLlmError("rh_login_required")).toBe("请先登录 RunningHub 后再使用小智")
    expect(mapAssistantLlmError("timeout")).toContain("小智处理超时")
    expect(mapAssistantLlmError("brand_new_code")).toBe("小智这轮回答失败了，请稍后重试")
    expect(mapAssistantLlmError()).toBe("小智这轮回答失败了，请稍后重试")
  })
})

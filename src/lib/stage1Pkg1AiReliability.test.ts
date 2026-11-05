/** @vitest-environment jsdom */
/**
 * 阶段 1 · 包 1（AI 可靠性）回归网。
 *
 * 钉住四件事，每一件都对应一条**实测过的**半残事实，而不是想象出来的规则：
 *
 *  ① 平台通道「确定性失败」必须**立即**如实返回，不能掉进 10 分钟轮询后被改写成「超时」。
 *     缺陷形态：llm.pb.js 上游 503 时返回 502 + 中文 message 且任务已标 failed，但
 *     callLlmWithFallback 原先只要非 2xx 就 initialFailed → 200×3s 轮询 → 最后统一报
 *     `error: "timeout"`。用户等十分钟，被告诉一个假原因。
 *  ② 502/503 这类失败文案必须是人话且可执行（含状态码与下一步），且**不外泄内部错误码**。
 *  ③ 方案大纲失败必须说清「是什么 + 该做什么」，且确定性失败（鉴权 / 未配置）不引导重试。
 *
 * 说明：④「未配置模型不推荐」是 DOM 断言，受 vitest 默认 node 环境所限单独成文，
 * 见同目录 stage1Pkg1ModelSelect.test.tsx。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
// llm.ts 的 buildHeaders() 会读 pb.authStore.token —— mock 必须提供该形状，
// 否则同步抛错会被外层 catch 吞成 initialFailed，进而掉进 200×3s 轮询（正是本包要修的那种症状）。
vi.mock("@/lib/pb", () => ({
  getPocketBaseUrl: () => "http://pb.test",
  pb: { authStore: { token: "" } },
}))
vi.mock("@/lib/rhLogin", () => ({
  vibexAuthHeaders: () => ({}),
  decodeRhToken: () => null,
  isLocalDeployHost: () => false,
  getAuthHeaders: () => ({}),
}))
vi.mock("@/lib/auth", () => ({ getAuthHeaders: () => ({}) }))
vi.mock("@/lib/llmCache", () => ({ llmCacheGet: async () => null, llmCacheSet: async () => {} }))

import { callLlmWithFallback, platformFailureResult } from "./llm"

// fetch 响应桩：只提供本函数用到的字段
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

beforeEach(() => {
  vi.unstubAllGlobals()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("① 平台通道确定性失败：快速如实返回，不再空转 10 分钟轮询", () => {
  it("上游 503（网关包成 502 + 英文 message）→ 立刻返回人话，且不进入轮询", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(502, { error: "llm_failed", message: "LLM HTTP 503 upstream busy" }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const started = Date.now()
    const r = await callLlmWithFallback("gpt-5.5", { messages: [{ role: "user", content: "hi" }] })
    const elapsed = Date.now() - started

    expect(r.ok).toBe(false)
    // 关键断言：不再是 "timeout"（那才是十分钟后的假原因）
    expect(r.error).not.toBe("timeout")
    expect(r.error).toContain("503")
    expect(r.error).toContain("繁忙")
    // 只发了首跳一次；进了 poll 循环就会 ≥3s 且多次 fetch
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(elapsed).toBeLessThan(3000)
  })

  it("网关 412 → 需要登录，不轮询", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(412, { error: "rh_login_required" }))
    vi.stubGlobal("fetch", fetchMock)
    const r = await callLlmWithFallback("gpt-5.5", { messages: [{ role: "user", content: "hi" }] })
    expect(r.needsLogin).toBe(true)
    expect(r.error).toBe("rh_login_required")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("成功响应的正文与 usage 原样透传（本次改动不碰成功路径）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, { ok: true, status: "success", text: "你好", model: "gpt-5.5", usage: { total: 7 } }),
      ),
    )
    const r = await callLlmWithFallback("gpt-5.5", { messages: [{ role: "user", content: "hi" }] })
    expect(r.ok).toBe(true)
    expect(r.text).toBe("你好")
    expect(r.usage).toEqual({ total: 7 })
  })
})

describe("② 失败文案：人话 + 可执行 + 不泄内部码", () => {
  it("服务端已拼好中文时原样透出，不吞真实原因", () => {
    const r = platformFailureResult(502, {
      error: "llm_failed",
      message: "模型服务繁忙（HTTP 503），通常稍等几秒重试即可，不是配置错误",
    })
    expect(r?.error).toBe("模型服务繁忙（HTTP 503），通常稍等几秒重试即可，不是配置错误")
  })

  it("只有英文原文时归一成中文，且带状态码与处置建议", () => {
    const r = platformFailureResult(502, { error: "llm_failed", message: "LLM HTTP 503 upstream unavailable" })
    expect(r?.error).toContain("503")
    expect(r?.error).toContain("重试")
    expect(r?.error).toMatch(/[\u4e00-\u9fff]/)
  })

  it("429 说得清是限流，并给「稍后重试 / 换模型」两个出口", () => {
    const r = platformFailureResult(429, { message: "rate limited" })
    expect(r?.error).toContain("限流")
    expect(r?.error).toContain("429")
  })

  it("5xx 未识别时兜底也不外泄内部错误码", () => {
    const r = platformFailureResult(500, { error: "some_internal_code", message: "boom" })
    expect(r?.error).not.toContain("some_internal_code")
    expect(r?.error).toMatch(/[\u4e00-\u9fff]/)
  })

  it("2xx 返回 null（成功路径不归一）", () => {
    expect(platformFailureResult(200, { ok: true })).toBeNull()
    expect(platformFailureResult(204, {})).toBeNull()
  })
})

describe("③ 方案大纲失败：说清是什么 + 该做什么", () => {
  it("空大纲不再误报成「格式解析失败」", async () => {
    const { classifyOutlineFail } = await import("@/pages/SolutionStudio/outlineFailure")
    expect(classifyOutlineFail(new Error("模型返回的 JSON 中没有任何有效章节（大纲为空）"))).toBe("empty_outline")
    expect(classifyOutlineFail(new Error("大纲格式解析失败"))).toBe("parse")
  })

  it("超时给「换更快模型 / 分次生成」的出口且可重试", async () => {
    const { outlineFailCopy } = await import("@/pages/SolutionStudio/outlineFailure")
    const c = outlineFailCopy(
      new Error("该模型本次响应超时（网关单次请求上限约 300 秒）。请在顶部切换到响应更快的已配置模型后重试"),
    )
    expect(c.kind).toBe("timeout")
    expect(c.text).toContain("重试")
    expect(c.retryable).toBe(true)
  })

  it("鉴权 / 未配置模型是确定性失败：给出正确动作且不引导重试", async () => {
    const { outlineFailCopy } = await import("@/pages/SolutionStudio/outlineFailure")
    const auth = outlineFailCopy(new Error("请先登录后再使用 AI"))
    expect(auth.kind).toBe("auth")
    expect(auth.retryable).toBe(false)

    const noModel = outlineFailCopy(new Error("未配置任何可用模型，请到「模型配置」添加通道"))
    expect(noModel.kind).toBe("no_model")
    expect(noModel.retryable).toBe(false)
    expect(noModel.text).toContain("模型配置")
  })

  it("旧文案「，可直接重试」不再被无条件附加到确定性失败上", async () => {
    const { outlineFailCopy } = await import("@/pages/SolutionStudio/outlineFailure")
    const text = outlineFailCopy(new Error("请先登录后再使用 AI")).text
    expect(text).not.toContain("可直接重试")
  })

  it("额度/限流不会被「解析失败」抢走归因", async () => {
    const { classifyOutlineFail } = await import("@/pages/SolutionStudio/outlineFailure")
    expect(classifyOutlineFail(new Error("接口返回异常（HTTP 429）：接口限流或余额不足"))).toBe("quota")
  })
})

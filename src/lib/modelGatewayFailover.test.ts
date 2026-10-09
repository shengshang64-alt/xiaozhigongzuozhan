// ---------------------------------------------------------------------------
// R203（docs/13 §3.3）接线级验证：chatViaGateway 撞账号级失败时真的换一路通道再发一次。
// 决策内核由 ./modelFailover.test.ts 锁口径；本文件锁「封装层接线」——stub fetch 逐字
// 复现 pocketbase/pb_hooks/model_gateway.pb.js doChat 的真实返回，断言出站顺序、结果改判、
// 可见提示与「不回退」边界（超时留给 R177/R180 降级阶梯、平台通道不跨源、缓存路径同样回退）。
// ---------------------------------------------------------------------------
import { beforeEach, describe, expect, it, vi } from "vitest"
import { toast } from "sonner"
import { callLlmWithFallback } from "@/lib/llm"
import {
  chatViaGateway,
  type GatewayConfig,
  type ModelRef,
} from "./modelGateway"
import { resetChannelCooling, resetFailoverNotice } from "./modelFailover"

const hoisted = vi.hoisted(() => ({
  posts: [] as Array<{ config_id: string; model: string; disable_thinking?: boolean }>,
  cache: new Map<string, unknown>(),
}))

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }))
vi.mock("@/lib/pb", () => ({ getPocketBaseUrl: () => "http://pb.test" }))
vi.mock("@/lib/rhLogin", () => ({
  vibexAuthHeaders: () => ({}),
  decodeRhToken: () => null,
  isLocalDeployHost: () => false,
}))
vi.mock("@/lib/llm", () => ({
  callLlmWithFallback: vi.fn(async () => ({
    ok: true,
    status: "success",
    text: "平台正文",
    model: "gpt-5.5",
  })),
}))
vi.mock("@/lib/llmCache", () => ({
  llmCacheGet: async (_userId: string | null, identity: string) =>
    hoisted.cache.has(identity) ? (hoisted.cache.get(identity) as never) : null,
  llmCacheSet: async (_userId: string | null, identity: string, value: unknown) => {
    hoisted.cache.set(identity, value)
  },
}))

const RATE_LIMIT_MSG = "所配置模型的接口限流或余额不足（HTTP 429），请稍后重试或切换模型"
const TIMEOUT_MSG = "请求超时，对方接口未在限定时间内返回，可稍后重试或切换模型"
const AUTH_MSG = "认证失败，请检查所配置模型的 API Key 是否有效"
const UNAVAILABLE_MSG = "所配置模型的服务暂时不可用（HTTP 503），请稍后重试"

const CONFIGS: GatewayConfig[] = [
  {
    id: "c1",
    config_name: "通道一",
    base_url: "https://a.test/v1",
    api_key_masked: "sk-****",
    has_key: true,
    models: [{ id: "deepseek-chat", enabled: true }],
    default_model: "",
    is_platform: false,
    last_check_status: "",
    last_check_error: "",
    last_checked_at: "",
    created: "",
    updated: "",
  },
  {
    id: "c2",
    config_name: "通道二",
    base_url: "https://b.test/v1",
    api_key_masked: "sk-****",
    has_key: true,
    models: [{ id: "glm-4.5", enabled: true }],
    default_model: "glm-4.5",
    is_platform: false,
    last_check_status: "",
    last_check_error: "",
    last_checked_at: "",
    created: "",
    updated: "",
  },
]

const REF_C1: ModelRef = { source: "personal", configId: "c1", configName: "通道一", modelId: "deepseek-chat" }
const MSGS = [{ role: "user" as const, content: "写一段小结" }]

/** 当前用例下 /chat 的应答：按 config_id 分流，逐条对齐网关真实文案 */
let chatResponder: (body: { config_id: string; model: string }) => unknown

const jsonRes = (data: unknown) => ({ ok: true, status: 200, json: async () => data })

beforeEach(() => {
  hoisted.posts.length = 0
  hoisted.cache.clear()
  vi.mocked(toast.info).mockClear()
  vi.mocked(callLlmWithFallback).mockClear()
  // 内核的会话冷却登记与提示去重窗是模块级状态：逐例复位，用例之间互不污染
  resetChannelCooling()
  resetFailoverNotice()
  // modelGateway 的个人通道出站用 window.setTimeout 兜底超时；node 环境补一个最小替身
  Object.defineProperty(globalThis, "window", {
    value: {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (t: unknown) => clearTimeout(t as NodeJS.Timeout),
      location: { hostname: "127.0.0.1" },
    },
    configurable: true,
    writable: true,
  })
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith("/api/model-gw/configs")) return jsonRes({ ok: true, items: CONFIGS })
      if (u.endsWith("/api/model-gw/chat")) {
        const body = JSON.parse(String(init?.body)) as { config_id: string; model: string }
        hoisted.posts.push({ config_id: body.config_id, model: body.model })
        return jsonRes(chatResponder(body))
      }
      throw new Error("unexpected request: " + u)
    }),
  )
})

describe("chatViaGateway 通道级自动回退（接线）", () => {
  it("所选通道撞 429：自动换备用通道再发一次，结果改判并带 actualModelRefKey，提示一次", async () => {
    chatResponder = (body) =>
      body.config_id === "c1"
        ? { ok: false, code: "upstream_error", message: RATE_LIMIT_MSG }
        : { ok: true, text: "通道二正文", model: body.model }

    const r = await chatViaGateway({ modelRef: REF_C1, messages: MSGS, page: "unit-test" })

    expect(r).toMatchObject({ ok: true, status: "success", text: "通道二正文" })
    expect(r.actualModelRefKey).toBe("personal:c2:glm-4.5")
    expect(hoisted.posts).toEqual([
      { config_id: "c1", model: "deepseek-chat" },
      { config_id: "c2", model: "glm-4.5" },
    ])
    expect(toast.info).toHaveBeenCalledTimes(1)
    const msg = String(vi.mocked(toast.info).mock.calls[0][0])
    expect(msg).toContain("通道一 · deepseek-chat")
    expect(msg).toContain("备用通道「通道二 · glm-4.5」")
    expect(msg).toContain("顶部模型选择器")
  })

  it("超时不回退（留给标书侧 R177/R180 降级阶梯）：只出一枪且不提示", async () => {
    chatResponder = () => ({ ok: false, code: "upstream_error", message: TIMEOUT_MSG })

    const r = await chatViaGateway({ modelRef: REF_C1, messages: MSGS, page: "unit-test" })

    expect(r.ok).toBe(false)
    expect(r.error).toContain("超时")
    expect(r.actualModelRefKey).toBeUndefined()
    expect(hoisted.posts).toHaveLength(1)
    expect(toast.info).not.toHaveBeenCalled()
  })

  it("备用通道也不可用：原样透出用户所选通道的首调真实原因，不打扰用户", async () => {
    chatResponder = (body) => ({
      ok: false,
      code: "upstream_error",
      message: body.config_id === "c1" ? AUTH_MSG : UNAVAILABLE_MSG,
    })

    const r = await chatViaGateway({ modelRef: REF_C1, messages: MSGS, page: "unit-test" })

    expect(r).toMatchObject({ ok: false, error: AUTH_MSG })
    expect(r.actualModelRefKey).toBeUndefined()
    expect(hoisted.posts).toHaveLength(2)
    expect(toast.info).not.toHaveBeenCalled()
  })

  it("平台内置通道失败绝不跨源改用个人通道（不静默花用户的钱）", async () => {
    vi.mocked(callLlmWithFallback).mockResolvedValueOnce({
      ok: false,
      status: "failed",
      text: "",
      error: "insufficient_balance",
    })

    const r = await chatViaGateway({ modelRef: null, messages: MSGS, page: "unit-test" })

    expect(r.ok).toBe(false)
    expect(callLlmWithFallback).toHaveBeenCalledTimes(1)
    expect(hoisted.posts).toHaveLength(0)
    expect(toast.info).not.toHaveBeenCalled()
  })

  it("cacheable 路径同样具备回退，且写回缓存的是改判后的结果（二次命中不再出站）", async () => {
    chatResponder = (body) =>
      body.config_id === "c1"
        ? { ok: false, code: "upstream_error", message: RATE_LIMIT_MSG }
        : { ok: true, text: "通道二正文", model: body.model }
    const opts = { modelRef: REF_C1, messages: MSGS, page: "unit-test", cacheable: true }

    const first = await chatViaGateway(opts)
    expect(first.actualModelRefKey).toBe("personal:c2:glm-4.5")
    expect(hoisted.posts).toHaveLength(2)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(hoisted.cache.size).toBe(1)

    const second = await chatViaGateway(opts)
    expect(second).toMatchObject({ ok: true, text: "通道二正文" })
    expect(hoisted.posts).toHaveLength(2)
  })

  it("R208：个人配置不可用（fallback_to_platform）先换健康个人通道，绝不直连平台", async () => {
    chatResponder = (body) =>
      body.config_id === "c1"
        ? { ok: false, code: "fallback_to_platform", message: "个人配置不可用" }
        : { ok: true, text: "通道二正文", model: body.model }

    const r = await chatViaGateway({ modelRef: REF_C1, messages: MSGS, page: "unit-test" })

    expect(r).toMatchObject({ ok: true, status: "success", text: "通道二正文" })
    expect(r.actualModelRefKey).toBe("personal:c2:glm-4.5")
    expect(hoisted.posts).toEqual([
      { config_id: "c1", model: "deepseek-chat" },
      { config_id: "c2", model: "glm-4.5" },
    ])
    expect(callLlmWithFallback).not.toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalledTimes(1)
  })

  it("R208：个人配置全部不可用且无健康候选时，云端落平台兜底（保证生成不中断）", async () => {
    chatResponder = () => ({ ok: false, code: "fallback_to_platform", message: "个人配置不可用" })

    const r = await chatViaGateway({ modelRef: REF_C1, messages: MSGS, page: "unit-test" })

    expect(r).toMatchObject({ ok: true, text: "平台正文" })
    expect(hoisted.posts).toHaveLength(2)
    expect(callLlmWithFallback).toHaveBeenCalledTimes(1)
  })
})

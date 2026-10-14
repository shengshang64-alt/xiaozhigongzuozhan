// ---------------------------------------------------------------------------
// R39b：网关失败归因。此前「fetch 抛错」与「有 HTTP 响应但正文非网关契约」共用
// 同一个 catch，一律输出「网络异常，请稍后重试」——真因（状态码 / 异常原文）被抹平。
// 本文件锁两件事：① 两类语义分别成文并把可读摘要带回来；② 「网络异常 / 服务异常」
// 两个锚点必须继续被 @/lib/modelFailover 归为 unavailable（可自动换通道）——
// 改文案却不改分类就是静默破坏回退策略，故这里跨模块联测。
// ---------------------------------------------------------------------------
import { beforeEach, describe, expect, it, vi } from "vitest"
import { GW_FAIL_DETAIL_CHARS, gwFetchFailMessage, listGatewayConfigs } from "./modelGateway"
import { classifyCallFailure, isFailoverEligible } from "./modelFailover"

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }))
vi.mock("@/lib/pb", () => ({ getPocketBaseUrl: () => "http://pb.test" }))
vi.mock("@/lib/rhLogin", () => ({
  vibexAuthHeaders: () => ({}),
  decodeRhToken: () => null,
  isLocalDeployHost: () => false,
}))
vi.mock("@/lib/llm", () => ({ callLlmWithFallback: vi.fn() }))
vi.mock("@/lib/llmCache", () => ({ llmCacheGet: async () => null, llmCacheSet: async () => {} }))

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("R39b gwFetchFailMessage（纯函数：两类语义不再共用一句文案）", () => {
  it("fetch 抛错：保留「网络异常」锚点，并把异常原文带出来", () => {
    const msg = gwFetchFailMessage({ kind: "thrown", error: new TypeError("Failed to fetch") })
    expect(msg).toBe("网络异常，请稍后重试（Failed to fetch）")
  })

  it("抛出的不是 Error（字符串）同样带出；无 message 时退回 Error.name", () => {
    expect(gwFetchFailMessage({ kind: "thrown", error: "socket hang up" })).toContain("socket hang up")
    expect(gwFetchFailMessage({ kind: "thrown", error: new Error("") })).toBe("网络异常，请稍后重试（Error）")
  })

  it("拿不到任何可读信息时不编造：原样退回既有文案", () => {
    expect(gwFetchFailMessage({ kind: "thrown", error: undefined })).toBe("网络异常，请稍后重试")
    expect(gwFetchFailMessage({ kind: "thrown", error: null })).toBe("网络异常，请稍后重试")
  })

  it("异常原文单行化并截到上限，不把整段堆栈/HTML 灌进 UI", () => {
    const msg = gwFetchFailMessage({ kind: "thrown", error: new Error(`第一行\n\t第二行 ${"E".repeat(400)}`) })
    expect(msg).toContain("第一行 第二行")
    expect(msg).not.toContain("\n")
    expect(msg).toContain(`${"E".repeat(GW_FAIL_DETAIL_CHARS - 10)}`)
    expect(msg.endsWith("…）")).toBe(true)
  })

  it("有响应但正文不合契约：非 2xx 给状态码，2xx 沿用「返回格式异常」", () => {
    expect(gwFetchFailMessage({ kind: "response", status: 500, ok: false })).toBe("服务异常（HTTP 500），请稍后重试")
    expect(gwFetchFailMessage({ kind: "response", status: 400, ok: false })).toBe("服务异常（HTTP 400），请稍后重试")
    expect(gwFetchFailMessage({ kind: "response", status: 200, ok: true })).toBe("返回格式异常")
  })

  it("两个锚点仍被 modelFailover 判为 unavailable（可自动换通道）——文案即契约", () => {
    for (const msg of [
      gwFetchFailMessage({ kind: "thrown", error: new TypeError("Failed to fetch") }),
      gwFetchFailMessage({ kind: "thrown", error: undefined }),
      gwFetchFailMessage({ kind: "response", status: 502, ok: false }),
      "网络异常，请稍后重试",
      "服务异常（HTTP 500），请稍后重试",
    ]) {
      expect(classifyCallFailure(msg)).toBe("unavailable")
      expect(isFailoverEligible(classifyCallFailure(msg))).toBe(true)
    }
  })
})

describe("R39b gwFetch 接线（stub fetch，走真实出站路径）", () => {
  it("fetch 抛错（网关进程没起 / 本机断网）：ok:false + 带真因的「网络异常」", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch")
      }),
    )
    const r = await listGatewayConfigs()
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.message).toBe("网络异常，请稍后重试（Failed to fetch）")
  })

  it("网关 500 且正文不是 JSON（Go panic / HTML 错误页）：透出状态码而不是「网络异常」", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON")
        },
      })),
    )
    const r = await listGatewayConfigs()
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.message).toBe("服务异常（HTTP 500），请稍后重试")
    expect(classifyCallFailure(r.ok === false ? r.message : "")).toBe("unavailable")
  })

  it("200 且正文合契约：原样透传，不受本次改动影响", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, items: [] }) })),
    )
    const r = await listGatewayConfigs()
    expect(r.ok).toBe(true)
    expect(r.ok === true && r.items).toEqual([])
  })
})

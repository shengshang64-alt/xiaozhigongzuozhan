// R170 (r130-price-preview-404)：previewAigcPrice 在本地部署域必须短路返回 { ok: false }，
// 不发起 fetch（消除浏览器 console 原生 404 噪音，端点补齐受"本地部署不碰 pb_hooks"红线约束）；
// 线上域行为不变，仍走 fetch。契约"从不 throw"在两条路径上都要成立。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const isLocalDeployHost = vi.fn()
const getPocketBaseUrl = vi.fn(() => "/__pb")

vi.mock("@/lib/pb", () => ({
  pb: { authStore: { token: null } },
  getPocketBaseUrl: () => getPocketBaseUrl(),
  pbAuthHeader: () => ({}),
}))
vi.mock("@/lib/auth", () => ({ getAuthHeaders: () => ({}) }))
vi.mock("@/lib/rhLogin", () => ({
  isLocalDeployHost: () => isLocalDeployHost(),
}))

import { previewAigcPrice } from "./aigc"

const fetchMock = vi.fn()

beforeEach(() => {
  isLocalDeployHost.mockReset()
  getPocketBaseUrl.mockReset().mockReturnValue("/__pb")
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("previewAigcPrice 本地部署短路（R170）", () => {
  it("本地部署域：不发起 fetch，直接返回 ok:false 且带跳过说明", async () => {
    isLocalDeployHost.mockReturnValue(true)

    const r = await previewAigcPrice("nano-banana-pro", { prompt: "x" })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(r.ok).toBe(false)
    expect(r.message).toContain("已跳过预估")
  })

  it("线上域：照常发起 fetch，命中端点返回 ok:true", async () => {
    isLocalDeployHost.mockReturnValue(false)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, priceText: "约 0.5 CNY" }),
    })

    const r = await previewAigcPrice("nano-banana-pro", { prompt: "x" })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("/api/aigc/price-preview")
    expect(init.method).toBe("POST")
    expect(r).toEqual({ ok: true, priceText: "约 0.5 CNY" })
  })

  it("线上域端点 404：归一 ok:false，不 throw（既有契约不变）", async () => {
    isLocalDeployHost.mockReturnValue(false)
    fetchMock.mockResolvedValue({ ok: false, status: 404 })

    const r = await previewAigcPrice("nano-banana-pro", { prompt: "x" })

    expect(r.ok).toBe(false)
    expect(r.message).toBe("HTTP 404")
  })

  it("线上域网络异常：catch 分支归一 ok:false，不 throw", async () => {
    isLocalDeployHost.mockReturnValue(false)
    fetchMock.mockRejectedValue(new Error("network down"))

    const r = await previewAigcPrice("nano-banana-pro", { prompt: "x" })

    expect(r.ok).toBe(false)
    expect(r.message).toBe("network down")
  })
})

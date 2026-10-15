import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const BASE = "http://pb.test"
vi.mock("@/lib/pb", () => ({ getPocketBaseUrl: () => BASE }))
vi.mock("@/lib/rhLogin", () => ({ vibexAuthHeaders: () => ({ Authorization: "Bearer t" }) }))

import { pbJsonGet, pbJsonRequest } from "./pbJson"

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const okJson = (data: unknown) => ({ ok: true, status: 200, json: async () => data })
const errStatus = (status: number) => ({ ok: false, status, json: async () => ({}) })

describe("pbJsonGet (silent)", () => {
  it("returns parsed json and assembles base+path + auth headers", async () => {
    fetchMock.mockResolvedValue(okJson({ items: [1] }))
    const r = await pbJsonGet<{ items: number[] }>("/api/x?a=1")
    expect(r).toEqual({ items: [1] })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/api/x?a=1`)
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", Authorization: "Bearer t" })
  })
  it("returns null on non-ok", async () => {
    fetchMock.mockResolvedValue(errStatus(404))
    expect(await pbJsonGet("/api/x")).toBeNull()
  })
  it("returns null on network throw", async () => {
    fetchMock.mockRejectedValue(new Error("boom"))
    expect(await pbJsonGet("/api/x")).toBeNull()
  })
})

describe("pbJsonRequest (throwing)", () => {
  it("returns parsed json on ok", async () => {
    fetchMock.mockResolvedValue(okJson({ a: 1 }))
    expect(await pbJsonRequest<{ a: number }>("/api/y")).toEqual({ a: 1 })
  })
  it("throws HTTP <status> without httpStatus by default", async () => {
    fetchMock.mockResolvedValue(errStatus(500))
    const e = (await pbJsonRequest("/api/y").catch((x) => x)) as Error & { httpStatus?: number }
    expect(e.message).toBe("HTTP 500")
    expect(e.httpStatus).toBeUndefined()
  })
  it("attaches err.httpStatus when exposeHttpStatus is set", async () => {
    fetchMock.mockResolvedValue(errStatus(409))
    const e = (await pbJsonRequest("/api/y", undefined, { exposeHttpStatus: true }).catch((x) => x)) as Error & {
      httpStatus?: number
    }
    expect(e.message).toBe("HTTP 409")
    expect(e.httpStatus).toBe(409)
  })
  it("spreads init and lets caller headers override auth", async () => {
    fetchMock.mockResolvedValue(okJson(null))
    await pbJsonRequest("/api/z", { method: "POST", body: "{}", headers: { Authorization: "Bearer override" } })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe("POST")
    expect(init.body).toBe("{}")
    expect(init.headers.Authorization).toBe("Bearer override")
    expect(init.headers["Content-Type"]).toBe("application/json")
  })
})

// R56（2026-10-15 1MB 保存失败事故）：错误原因必须能传到 UI。
// 事故链：PB 返回字段级校验错误 → 旧实现只留 "HTTP 400" → UI 只弹「保存失败，请检查网络后重试」
// → 用户以为是网络问题去刷新，白丢一整天。这里锁住错误信息的保真口径。
describe("pbJsonRequest · 错误原因保真（R56）", () => {
  const errBody = (status: number, body: unknown) => ({ ok: false, status, json: async () => body })

  it("字段级 message 优先（PB 超长校验的真实形状）", async () => {
    fetchMock.mockResolvedValue(
      errBody(400, {
        status: 400,
        message: "Failed to update record.",
        data: { bid_chapters: { code: "validation_invalid_json", message: "The maximum allowed JSON size is 1048576 bytes." } },
      }),
    )
    const e = (await pbJsonRequest("/api/bid_projects/x").catch((x) => x)) as Error
    expect(e.message).toContain("HTTP 400")
    expect(e.message).toContain("bid_chapters")
    expect(e.message).toContain("maximum allowed JSON size")
  })

  it("无字段级错误时用顶层 message", async () => {
    fetchMock.mockResolvedValue(errBody(403, { status: 403, message: "只有创建者可以修改" }))
    const e = (await pbJsonRequest("/api/x").catch((x) => x)) as Error
    expect(e.message).toBe("HTTP 403 · 只有创建者可以修改")
  })

  it("非 JSON body / 空 data 时退回纯状态码（向后兼容，不留半截文案）", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error("not json") } })
    expect(((await pbJsonRequest("/api/x").catch((x) => x)) as Error).message).toBe("HTTP 502")
    fetchMock.mockResolvedValue(errBody(400, { status: 400, message: "", data: {} }))
    expect(((await pbJsonRequest("/api/x").catch((x) => x)) as Error).message).toBe("HTTP 400")
  })
})

describe("saveFailureReason（R56）", () => {
  it("透出服务端原因，超长截断；非 Error 也能读；空值给兜底", async () => {
    const { saveFailureReason } = await import("./pbJson")
    expect(saveFailureReason(new Error("HTTP 400 · bid_chapters: The maximum allowed JSON size is 1048576 bytes."))).toContain("maximum allowed JSON size")
    expect(saveFailureReason(new Error("Failed to fetch"))).toBe("Failed to fetch") // 网络层错误原样透出，便于区分服务端拒绝
    expect(saveFailureReason("字符串错误")).toBe("字符串错误")
    expect(saveFailureReason(null)).toBe("未知原因")
    expect(saveFailureReason(new Error("x".repeat(300))).length).toBe(161)
  })
})

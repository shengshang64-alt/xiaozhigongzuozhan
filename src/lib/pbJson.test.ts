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

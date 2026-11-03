// R115 regression lock: competitorsCore.compFetch and kbQa.qaFetch used to be
// private clones of the R109 single-source helper `pbJsonRequest`. They now
// delegate to it. These tests pin the observable contract that must survive the
// delegation: base+path assembly, the Content-Type + vibex auth header merge,
// and the `HTTP <status>` throw that carries err.httpStatus (exposeHttpStatus).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const BASE = "http://pb.test"
vi.mock("@/lib/pb", () => ({ getPocketBaseUrl: () => BASE }))
vi.mock("@/lib/rhLogin", () => ({ vibexAuthHeaders: () => ({ Authorization: "Bearer t" }) }))

import { createCompetitor, listCompetitors } from "@/pages/Competitors/competitorsCore"
import { createKbQaPair, listKbQaPairs } from "@/lib/kbQa"

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const okJson = (data: unknown) => ({ ok: true, status: 200, json: async () => data })
const errStatus = (status: number) => ({ ok: false, status, json: async () => ({}) })

describe("competitorsCore delegates to pbJsonRequest", () => {
  it("POST create assembles base+path and merges auth header", async () => {
    fetchMock.mockResolvedValue(okJson({ id: "c1", name: "X" }))
    await createCompetitor({ name: "X" })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/api/competitors`)
    expect(init.method).toBe("POST")
    expect(init.body).toBe(JSON.stringify({ name: "X" }))
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", Authorization: "Bearer t" })
  })

  it("HTTP error carries httpStatus (exposeHttpStatus preserved)", async () => {
    fetchMock.mockResolvedValue(errStatus(409))
    const e = (await createCompetitor({ name: "X" }).catch((x) => x)) as Error & { httpStatus?: number }
    expect(e.message).toBe("HTTP 409")
    expect(e.httpStatus).toBe(409)
  })

  it("listCompetitors paginates and stops on a short page", async () => {
    fetchMock.mockResolvedValue(okJson({ items: [{ id: "a", name: "A" }], perPage: 200 }))
    const rows = await listCompetitors()
    expect(rows).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain("/api/competitors?page=1&perPage=200")
  })
})

describe("kbQa delegates to pbJsonRequest", () => {
  it("POST create assembles base+path and merges auth header", async () => {
    fetchMock.mockResolvedValue(okJson({ id: "q1", question: "Q", answer: "A" }))
    await createKbQaPair({
      rh_user_id: "u",
      question: "Q",
      answer: "A",
      category: "c",
      status: "approved",
      source: "manual",
      visibility: "personal",
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/api/kb_qa_pairs`)
    expect(init.method).toBe("POST")
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", Authorization: "Bearer t" })
  })

  it("HTTP error carries httpStatus (exposeHttpStatus preserved)", async () => {
    fetchMock.mockResolvedValue(errStatus(500))
    const e = (await createKbQaPair({
      rh_user_id: "u",
      question: "Q",
      answer: "A",
      category: "c",
      status: "approved",
      source: "manual",
      visibility: "personal",
    }).catch((x) => x)) as Error & { httpStatus?: number }
    expect(e.message).toBe("HTTP 500")
    expect(e.httpStatus).toBe(500)
  })

  it("listKbQaPairs stops on a short page", async () => {
    fetchMock.mockResolvedValue(okJson({ items: [{ id: "q", question: "Q", answer: "A" }], perPage: 200 }))
    const rows = await listKbQaPairs()
    expect(rows).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

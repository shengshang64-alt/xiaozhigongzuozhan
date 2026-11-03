// ---------------------------------------------------------------------------
// kbCore.test.ts —— listKbDocs 翻页收敛单测（kb-docs-pagination-loop）。
// 用假 fetch 模拟服务端把 perPage 钳到 200 并回显 totalItems，断言：
//  1) 首页即末页（含空库）只发 1 个请求（旧实现按满批并发多发 2 个越界空页）；
//  2) 中小库按 totalItems 精确停在最后一页，不再请求越界空页；
//  3) 超大库按 totalItems 收敛到真实末页，且不越安全上限；拼接顺序与页数逐字正确。
// 仅测纯翻页逻辑，不触真实网络/DB。
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { listKbDocs, type KbDocRow } from "./kbCore"

vi.mock("@/lib/pb", () => ({ getPocketBaseUrl: () => "http://localhost:8000" }))
vi.mock("@/lib/rhLogin", () => ({ vibexAuthHeaders: () => ({}) }))

const SERVER_PER_PAGE = 200

function mkRow(i: number): KbDocRow {
  return {
    id: `d${i}`,
    rh_user_id: "u1",
    title: `t${i}`,
    folder_path: "",
    content: "",
    doc_format: "md",
    visibility: "team",
    summary: "",
    keywords: [],
    source_file_name: `f${i}`,
    uploader_name: "",
    created: "",
    updated: "",
  }
}

/** 安装假服务端：按 page/perPage 切片返回，perPage 钳到 200，回显 totalItems；记录被请求的页号 */
function installFakeServer(total: number, requested: number[]) {
  const impl = vi.fn(async (input: unknown) => {
    const u = new URL(String(input))
    const page = Number(u.searchParams.get("page") || "1")
    const perReq = Number(u.searchParams.get("perPage") || "50")
    const perPage = Math.min(perReq, SERVER_PER_PAGE)
    requested.push(page)
    const start = (page - 1) * perPage
    const count = Math.max(0, Math.min(perPage, total - start))
    const items = Array.from({ length: count }, (_, k) => mkRow(start + k))
    return { ok: true, json: async () => ({ items, page, perPage, totalItems: total }) }
  })
  vi.stubGlobal("fetch", impl)
  return impl
}

beforeEach(() => {
  requested = []
})
afterEach(() => {
  vi.unstubAllGlobals()
})

let requested: number[] = []

describe("listKbDocs · 翻页收敛（kb-docs-pagination-loop）", () => {
  it("空库：只发 1 个请求，返回空数组", async () => {
    installFakeServer(0, requested)
    const rows = await listKbDocs({ slim: true })
    expect(rows).toEqual([])
    expect(requested).toEqual([1])
  })

  it("单页（150 < 200）：只发 1 个请求（旧实现会并发多发越界空页）", async () => {
    installFakeServer(150, requested)
    const rows = await listKbDocs({ slim: true })
    expect(rows.length).toBe(150)
    expect(requested).toEqual([1])
  })

  it("中小库（250）：按 totalItems 精确停在第 2 页，不请求第 3 页", async () => {
    installFakeServer(250, requested)
    const rows = await listKbDocs({ slim: true })
    expect(rows.length).toBe(250)
    expect(Math.max(...requested)).toBe(2)
    expect(new Set(requested).size).toBe(requested.length) // 无重复页
  })

  it("大库（6423）：逐页取全、末页恰为 33、拼接顺序正确、无越界空页", async () => {
    installFakeServer(6423, requested)
    const rows = await listKbDocs({ slim: true })
    expect(rows.length).toBe(6423)
    expect(Math.max(...requested)).toBe(33)
    expect(requested).not.toContain(34)
    // 顺序与去重：页号集合应为 1..33，且结果 id 严格递增（保序）
    expect([...new Set(requested)].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 33 }, (_, i) => i + 1),
    )
    for (let i = 1; i < rows.length; i++) {
      expect(Number(rows[i].id.slice(1))).toBeGreaterThan(Number(rows[i - 1].id.slice(1)))
    }
  })

  it("onBatch 首批（单页）即回调快照，渐进直显更快", async () => {
    installFakeServer(500, requested)
    const seen: number[] = []
    await listKbDocs({ slim: true, onBatch: (acc) => seen.push(acc.length) })
    expect(seen[0]).toBe(200) // 第一页到齐即回调，无需等满 3 页
  })
})

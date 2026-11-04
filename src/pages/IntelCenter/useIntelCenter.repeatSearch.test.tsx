/** @vitest-environment jsdom */
/**
 * 情报中心「重复搜索」回归网（2026-11-04 P1 假空态）。
 *
 * 用户必撞路径：搜一次关键词 → 不满意 → **再点一次「搜索」**。
 * 旧实现 submitSearch 先 setPage(1) + setItemList([]) + setSearchText(同词)：
 * 页码本来就是 1、关键词也没变 → effect 依赖一项都没变 → 不会重新请求，
 * 而列表已被清空，于是界面永远停在「当前筛选条件下暂无情报」，
 * 可顶部「情报总数」还是上一次的 31——用户看到的是「搜索把库搜空了」。
 *
 * 本文件钉住：
 *  ① 同一关键词连点两次搜索，必须发两次请求且列表仍非空（不能停在假空态）；
 *  ② 搜索确实换了词时，请求带的新 q 参数正确；
 *  ③ 清空筛选后能重新拉回列表（其它路径不许回归）。
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const state = {
    /** 每次 /api/intel/items 请求的完整 query 串（按调用顺序） */
    itemQueries: [] as string[],
  }
  return state
})

function itemRow(id: string) {
  return {
    id,
    title: `情报 ${id}`,
    content_snippet: "片段",
    summary: "",
    item_type: "bid",
    item_status: "pending",
    my_status: "pending",
    region: "安徽",
    source_id: "s1",
    source_name: "测试源",
    url: "https://example.com/" + id,
    published_at: "2026-11-01",
    created: "2026-11-01 00:00:00.000Z",
    updated: "2026-11-01 00:00:00.000Z",
    tags: [],
    visibility: "public",
    added_by: "crawl",
    structured: null,
  }
}

vi.mock("@/lib/pb", () => ({ getPocketBaseUrl: () => "" }))
vi.mock("@/lib/rhLogin", () => ({
  decodeRhToken: () => ({ sub: "local-user" }),
  vibexAuthHeaders: () => ({ "X-Rh-User-Id": "local-user" }),
}))
vi.mock("sonner", () => ({ toast: { error: () => {}, info: () => {}, success: () => {}, warning: () => {} } }))
vi.mock("@/hooks/useCostConfirm", () => ({ useCostConfirm: () => ({ runWithCostConfirm: (_fn: () => void) => {} }) }))

vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>()
  return {
    ...actual,
    useNavigate: () => () => {},
  }
})

beforeEach(() => {
  h.itemQueries.length = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes("/api/intel/items")) {
        const qs = u.split("?")[1] ?? ""
        h.itemQueries.push(qs)
        const page = Number(new URLSearchParams(qs).get("page") ?? "1")
        const items = page === 1 ? [itemRow("a"), itemRow("b")] : []
        return new Response(
          JSON.stringify({ ok: true, items, page, perPage: 10, totalItems: 2, allTags: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      if (u.includes("/api/intel/sources")) {
        return new Response(JSON.stringify({ ok: true, items: [] }), { status: 200 })
      }
      if (u.includes("/api/intel/prefs")) {
        return new Response(JSON.stringify({ ok: true, prefs: null }), { status: 200 })
      }
      if (u.includes("/api/intel_stars")) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function mount() {
  const { useIntelCenter } = await import("./useIntelCenter")
  const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>
  const r = renderHook(() => useIntelCenter(), { wrapper })
  await waitFor(() => expect(r.result.current.itemList.length).toBeGreaterThan(0))
  return r
}

describe("情报中心重复搜索不再把列表搜成假空态", () => {
  it("同一关键词连点两次「搜索」：发两次请求，列表仍非空", async () => {
    const r = await mount()
    const afterMount = h.itemQueries.length

    act(() => r.result.current.setSearchInput("中医医院"))
    act(() => r.result.current.submitSearch())
    await waitFor(() => expect(h.itemQueries.length).toBe(afterMount + 1))
    await waitFor(() => expect(r.result.current.itemList.length).toBeGreaterThan(0))
    const afterFirst = h.itemQueries.length

    // 关键动作：同一关键词再点一次
    act(() => r.result.current.submitSearch())
    await waitFor(() => expect(h.itemQueries.length).toBe(afterFirst + 1))
    await waitFor(() => expect(r.result.current.itemList.length).toBeGreaterThan(0))
    expect(r.result.current.itemList.map((x) => x.id)).toEqual(["a", "b"])
  })

  it("换关键词搜索：请求带的新 q 生效", async () => {
    const r = await mount()
    act(() => r.result.current.setSearchInput("智慧医院"))
    act(() => r.result.current.submitSearch())
    await waitFor(() => expect(h.itemQueries.some((q) => q.includes("q="))).toBe(true))
    const last = h.itemQueries[h.itemQueries.length - 1]
    expect(decodeURIComponent(last)).toContain("q=智慧医院")
  })

  it("清空筛选后能重新拉回列表", async () => {
    const r = await mount()
    act(() => r.result.current.setSearchInput("不存在的词"))
    act(() => r.result.current.submitSearch())
    // searchText 不在 hook 返回面里，只能从「请求是否带上 q」侧证搜索已生效
    await waitFor(() => expect(h.itemQueries.some((q) => decodeURIComponent(q).includes("q=不存在的词"))).toBe(true))
    const before = h.itemQueries.length
    act(() => r.result.current.clearFilters())
    await waitFor(() => expect(h.itemQueries.length).toBeGreaterThan(before))
    await waitFor(() => expect(r.result.current.itemList.length).toBeGreaterThan(0))
    // 清空后最后一次请求不应再带 q
    const last = decodeURIComponent(h.itemQueries[h.itemQueries.length - 1])
    expect(last).not.toContain("q=")
  })
})

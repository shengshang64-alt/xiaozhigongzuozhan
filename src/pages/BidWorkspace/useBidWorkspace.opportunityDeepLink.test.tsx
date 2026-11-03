/** @vitest-environment jsdom */
/**
 * 2026-10-28（DS-R05）：客户管理 → 标书工作台「关联投标」空态跳转的深链契约。
 *
 * 背景：商机详情「关联投标」空态原先只有一句静态说明「在标书工作中关联本商机后…」，
 * **没有任何可点入口**——用户被提示去标书工作台，却在商机里找不到路，只能自己切页面、
 * 再从 160 个客户/33 个项目里重新找回本商机。流程断在这里。
 *
 * 修法：空态加一条 `去标书工作台新建` 链接，带
 *   ?opportunity=<商机 id>&hospital=<客户医院名>
 * 标书工作台消费后打开新建对话框并把医院/商机预置好，创建即落 opportunity_id（回流就有数据）。
 *
 * 本文件只守两条用户能感知的契约（与 R57/R58 同一旁路纪律：只 mock 网络/提示/路由）：
 *   ① 深链带 opportunity + hospital → 新建对话框打开，且医院、商机预置到位；
 *   ② 同一 URL 重复渲染不重复消费（ref 存已消费值，避免每次渲染重复弹窗）。
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const state = {
    calls: [] as { path: string; method: string; body: Record<string, unknown> | null }[],
    toasts: [] as string[],
    /** 商机下拉的候选（loadOppOptions 拉的内容）；深链要预选的就是它 */
    opp: { id: "opp1", customer_name: "厦门市杏林医院", opp_name: "杏林医保自费传送改造", stage: "bidding" },
  }
  return state
})

vi.mock("@/lib/pbJson", () => ({
  pbJsonRequest: async (path: string, init?: RequestInit) => {
    const method = String(init?.method ?? "GET").toUpperCase()
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    h.calls.push({ path, method, body })
    if (method !== "GET") return { id: "rec-echo", ...(body ?? {}) }
    // 商机下拉候选
    if (/^\/api\/opportunities/.test(path)) return { items: [h.opp], totalItems: 1, page: 1, perPage: 200 }
    // 项目列表：空列表，确保走的是「新建」而不是「打开既有」
    if (/^\/api\/bid_projects\?/.test(path)) return { items: [], totalItems: 0, page: 1, perPage: 200 }
    return { items: [], totalItems: 0, page: 1, perPage: 200 }
  },
  saveFailureReason: (e: unknown) => String(e),
}))

vi.mock("sonner", () => {
  const rec = (m: unknown) => {
    h.toasts.push(String(m))
  }
  return { toast: Object.assign(rec, { success: rec, error: rec, warning: rec, info: rec, message: rec, loading: rec }) }
})

import { useBidWorkspace } from "./useBidWorkspace"

const wrapperWith = (url: string) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  )
  Wrapper.displayName = "Wrapper"
  return Wrapper
}

beforeEach(() => {
  h.calls.length = 0
  h.toasts.length = 0
})

afterEach(() => {
  cleanup()
})

describe("客户管理 → 标书工作台 ?opportunity= 深链", () => {
  it("① 带 opportunity + hospital → 打开新建对话框，医院与商机预置到位", async () => {
    const view = renderHook(() => useBidWorkspace(), {
      wrapper: wrapperWith("/?opportunity=opp1&hospital=%E5%8E%A6%E9%97%A8%E5%B8%82%E6%9D%8F%E6%9E%97%E5%8C%BB%E9%99%A2"),
    })
    await waitFor(() => expect(view.result.current.newDialogOpen).toBe(true))
    expect(view.result.current.formHospital).toBe("厦门市杏林医院")
    expect(view.result.current.formOpportunityId).toBe("opp1")
  })

  it("② 只有 opportunity 没有 hospital → 仍预置商机，医院留空不报错", async () => {
    const view = renderHook(() => useBidWorkspace(), {
      wrapper: wrapperWith("/?opportunity=opp1"),
    })
    await waitFor(() => expect(view.result.current.newDialogOpen).toBe(true))
    expect(view.result.current.formHospital).toBe("")
    expect(view.result.current.formOpportunityId).toBe("opp1")
  })

  it("③ 无 opportunity 参数 → 不自动弹新建对话框（普通进入工作台不被劫持）", async () => {
    const view = renderHook(() => useBidWorkspace(), { wrapper: wrapperWith("/") })
    // 给微任务与首拉留出时间，确认没有被误触发
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(view.result.current.newDialogOpen).toBe(false)
  })

  it("④ 同一 URL 重复渲染不重复消费（ref 已记录，不会把用户手动清掉的表单又填回去）", async () => {
    const view = renderHook(() => useBidWorkspace(), {
      wrapper: wrapperWith("/?opportunity=opp1&hospital=%E5%8E%A6%E9%97%A8%E5%B8%82%E6%9D%8F%E6%9E%97%E5%8C%BB%E9%99%A2"),
    })
    await waitFor(() => expect(view.result.current.newDialogOpen).toBe(true))
    // 模拟用户手动改了医院（同 URL 下不应被深链再次覆盖）
    await act(async () => {
      view.result.current.setFormHospital("用户手改的医院")
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(view.result.current.formHospital).toBe("用户手改的医院")
    expect(view.result.current.formOpportunityId).toBe("opp1")
  })
})

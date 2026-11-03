/** @vitest-environment jsdom */
/**
 * 2026-10-28（DS-R06）：商机 → 方案工作室「去方案工作室新建」深链契约。
 *
 * 背景：产品本来就支持「商机关联方案」——新建方案向导第 2 步有「关联商机（可选）」下拉，
 * 创建成功后 confirmOutline 会 PATCH opportunities.ref_type/ref_id/ref_name，
 * 商机详情就能显示「关联方案：xxx」并跳转。能力全在，**但商机详情里没有任何入口能走过去**：
 * 用户想「从这条商机做一份方案」时，只能自己切页面、手动新建、再在下拉里翻出这条商机。
 * 与 DS-R05 的标书线同一个断点，故补同款深链 ?opportunity=<id>&hospital=<医院名>。
 *
 * 本文件守三条用户能感知的契约（旁路纪律同 R57/R58/R05：只 mock 网络/提示/路由）：
 *   ① 带 opportunity + hospital → 新建向导打开，商机与医院预置到位；
 *   ② 只有 opportunity 没有 hospital → 商机仍预置，医院留空不报错；
 *   ③ 无 opportunity 参数 → 不自动弹向导（普通进入方案工作室不被劫持）。
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  return {
    calls: [] as { path: string; method: string }[],
    toasts: [] as string[],
  }
})

vi.mock("@/lib/pbJson", () => ({
  pbJsonRequest: async (path: string, init?: RequestInit) => {
    const method = String(init?.method ?? "GET").toUpperCase()
    h.calls.push({ path, method })
    if (method !== "GET") return { id: "rec-echo" }
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

import { useSolutionStudio } from "./useSolutionStudio"

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

describe("商机 → 方案工作室 ?opportunity= 深链", () => {
  it("① 带 opportunity + hospital → 向导打开，商机与医院预置到位", async () => {
    const view = renderHook(() => useSolutionStudio(), {
      wrapper: wrapperWith("/?opportunity=opp1&hospital=%E5%8E%A6%E9%97%A8%E5%B8%82%E6%9D%8F%E6%9E%97%E5%8C%BB%E9%99%A2"),
    })
    await waitFor(() => expect(view.result.current.wizardOpen).toBe(true))
    expect(view.result.current.formHospital).toBe("厦门市杏林医院")
    expect(view.result.current.formOpportunityId).toBe("opp1")
  })

  it("② 只有 opportunity 没有 hospital → 商机仍预置，医院留空", async () => {
    const view = renderHook(() => useSolutionStudio(), {
      wrapper: wrapperWith("/?opportunity=opp1"),
    })
    await waitFor(() => expect(view.result.current.wizardOpen).toBe(true))
    expect(view.result.current.formHospital).toBe("")
    expect(view.result.current.formOpportunityId).toBe("opp1")
  })

  it("③ 无 opportunity 参数 → 不自动弹向导", async () => {
    const view = renderHook(() => useSolutionStudio(), { wrapper: wrapperWith("/") })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(view.result.current.wizardOpen).toBe(false)
  })
})

/** @vitest-environment jsdom */
/**
 * R82 · 主观分确认「静默丢弃」回归网（S12 部署缺口的行为面）。
 *
 * 实测背景（2026-11-08，真实 PB 127.0.0.1:7000）：
 *   `subjective_confirmations` 列在运行中的库里**不存在**（hook 已改、服务未重启，addField 迁移没跑）。
 *   对该字段发 PATCH 时，PocketBase **不报错、返回 200**，但响应体里没有这个字段 → 字段被静默丢弃。
 *   旧实现走 `updateProject(..., { quiet: true })` 乐观更新：界面立刻显示「已确认」，
 *   用户刷新后全部消失，且全程没有任何提示。
 *
 * 本文件把「不许假装成功」钉成契约：
 *   ① 响应体不含该字段 → 必须 toast.error 明确告知「未生效」；
 *   ② 响应体含该字段   → 不许误报错误（防过度告警）；
 *   ③ 请求失败         → 仍由 persistProject 的既有错误路径处理。
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const state = {
    calls: [] as { path: string; method: string; body: Record<string, unknown> | null }[],
    toasts: [] as string[],
    /** true = 模拟「PB 无此列」：PATCH 返回 200 但响应体不含 subjective_confirmations */
    dropField: true,
    project: {
      id: "p1",
      rh_user_id: "local-user",
      project_name: "测试项目",
      tender_no: "",
      hospital: "",
      bid_open_date: "",
      stage: "composing",
      tender_text: "",
      parse_config: null,
      bid_outline: [],
      bid_chapters: [],
      archived: false,
      deleted_at: "",
      created: "2026-11-08 09:00:00.000Z",
      updated: "2026-11-08 09:00:00.000Z",
    } as Record<string, unknown>,
  }
  return state
})

vi.mock("@/lib/pbJson", () => ({
  pbJsonRequest: async (path: string, init?: RequestInit) => {
    const method = String(init?.method ?? "GET").toUpperCase()
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    h.calls.push({ path, method, body })
    if (method !== "GET") {
      // 模拟 PB「列不存在」：把该字段从回显里摘掉（与真实实测行为一致）
      const echo: Record<string, unknown> = { id: "rec-echo", ...(body ?? {}) }
      if (h.dropField) delete echo.subjective_confirmations
      return echo
    }
    if (/^\/api\/bid_projects\?/.test(path)) return { items: [h.project], totalItems: 1, page: 1, perPage: 200 }
    if (/^\/api\/bid_projects\/[^?]+$/.test(path)) return h.project
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

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={["/?project=p1"]}>{children}</MemoryRouter>
)

async function mountWithProject() {
  const view = renderHook(() => useBidWorkspace(), { wrapper })
  await waitFor(() => expect(view.result.current.activeProject?.id).toBe("p1"))
  return view
}

const patches = () => h.calls.filter((c) => c.method === "PATCH" && c.path === "/api/bid_projects/p1")

beforeEach(() => {
  h.calls.length = 0
  h.toasts.length = 0
  h.dropField = true
})
afterEach(cleanup)

describe("R82 主观分确认：服务端未建列时不许假装成功", () => {
  it("响应体缺该字段 → 发出 PATCH 且明确 toast 告知「未生效」", async () => {
    const { result } = await mountWithProject()
    await act(async () => {
      result.current.setSubjectiveConfirmation("R1", { confirmed: true, strategy: "写量化承诺" })
      // 等待 persistChain 走完
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 50))
    })

    const patch = patches()
    expect(patch.length, "必须真的发出 PATCH").toBeGreaterThanOrEqual(1)
    expect(patch[0].body).toHaveProperty("subjective_confirmations")
    const hits = h.toasts.filter((t) => t.includes("未生效"))
    expect(hits.length, `应提示「未生效」，实际 toasts=${JSON.stringify(h.toasts)}`).toBeGreaterThanOrEqual(1)
    // 文案要能让用户照着做
    expect(hits[0]).toMatch(/重启 PocketBase|建列/)
  })

  it("响应体含该字段 → 不误报错误（防过度告警）", async () => {
    h.dropField = false
    const { result } = await mountWithProject()
    await act(async () => {
      result.current.setSubjectiveConfirmation("R1", { confirmed: true })
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(patches().length).toBeGreaterThanOrEqual(1)
    expect(h.toasts.filter((t) => t.includes("未生效")).length).toBe(0)
  })

  it("乐观更新仍即时生效：勾选后本地状态已带上 confirmed", async () => {
    const { result } = await mountWithProject()
    await act(async () => {
      result.current.setSubjectiveConfirmation("R1", { confirmed: true, strategy: "策略 A" })
      await new Promise((r) => setTimeout(r, 50))
    })
    const conf = result.current.activeProject?.subjective_confirmations?.R1
    expect(conf?.confirmed).toBe(true)
    expect(conf?.strategy).toBe("策略 A")
  })
})

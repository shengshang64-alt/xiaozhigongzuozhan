/** @vitest-environment jsdom */
/**
 * 小智对话「采纳」下拉的失败态（2026-11-04，R69 同类缺陷的第 5~8 处）。
 *
 * 缺陷形态：SkillAdoptRow 加载客户列表失败时 `setCustomers([])` + toast，
 * 下拉里随即显示「还没有客户，先到客户管理新建」——把网络/鉴权失败说成了业务空态。
 * 用户会去客户管理看一眼（发现客户明明有），或者干脆放弃这个功能。
 *
 * 本文件钉住：
 *  ① 加载失败 → 显示「客户列表没加载出来（不是没有客户）」；
 *  ② 真的没有客户（200 且 0 条）→ 仍显示原「还没有客户，先到客户管理新建」；
 *  ③ 加载中 → 显示「客户加载中…」，不误报空也不误报失败。
 *
 * 注：该组件只在 skillName ∈ ADOPTABLE 时渲染，测试相应选择一个可采纳技能名。
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { MemoryRouter } from "react-router-dom"
import type { ReactNode } from "react"

const responses = vi.hoisted(() => ({ queue: [] as Array<() => Promise<Response>> }))

vi.mock("@/lib/pb", () => ({ getPocketBaseUrl: () => "" }))
vi.mock("@/lib/rhLogin", () => ({ vibexAuthHeaders: () => ({ "X-Rh-User-Id": "local-user" }) }))
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, info: () => {}, warning: () => {} }) }))

import { SkillAdoptRow } from "./ChatStream"

afterEach(() => {
  cleanup()
  responses.queue.length = 0
  vi.unstubAllGlobals()
})

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const make = responses.queue.shift()
      if (!make) return new Response(JSON.stringify({ items: [] }), { status: 200 })
      return make()
    }),
  )
}

const wrap = (ui: ReactNode) => <MemoryRouter>{ui}</MemoryRouter>

/** 打开采纳下拉（点「存为客户跟进记录」） */
function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: /存为客户跟进记录/ }))
}

describe("小智对话采纳：客户列表加载失败不能显示成「还没有客户」", () => {
  it("加载失败 → 提示「没加载出来（不是没有客户）」", async () => {
    responses.queue.push(async () => {
      throw new Error("network down")
    })
    installFetch()
    render(wrap(<SkillAdoptRow skillName="写客户跟进邮件" content="跟进内容" />))
    openPicker()
    await waitFor(() => expect(screen.getByText(/客户列表没加载出来/)).toBeInTheDocument())
    expect(screen.queryByText(/还没有客户，先到客户管理新建/)).toBeNull()
  })

  it("真的没有客户（200 且 0 条）→ 仍走原「还没有客户」文案", async () => {
    responses.queue.push(
      async () => new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    )
    installFetch()
    render(wrap(<SkillAdoptRow skillName="写客户跟进邮件" content="跟进内容" />))
    openPicker()
    await waitFor(() => expect(screen.getByText("还没有客户，先到客户管理新建")).toBeInTheDocument())
    expect(screen.queryByText(/客户列表没加载出来/)).toBeNull()
  })

  it("加载中显示「客户加载中…」，不误报空也不误报失败", async () => {
    let release: (r: Response) => void = () => {}
    responses.queue.push(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve
        }),
    )
    installFetch()
    render(wrap(<SkillAdoptRow skillName="写客户跟进邮件" content="跟进内容" />))
    openPicker()
    await waitFor(() => expect(screen.getByText(/客户加载中/)).toBeInTheDocument())
    expect(screen.queryByText(/客户列表没加载出来/)).toBeNull()
    release(new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } }))
  })
})

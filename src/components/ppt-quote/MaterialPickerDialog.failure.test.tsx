/** @vitest-environment jsdom */
/**
 * 素材选择器「加载失败 ≠ 库里没有」（2026-11-04 巡检）。
 *
 * 缺陷形态：拉取 /api/materials 失败时 catch 静默吞掉、只把 loaded 置 true，
 * 界面于是显示「素材库为空或未命中 —— 可先到「素材库」页导入」。
 * 用户会以为库里真没素材，实际是请求挂了——两者的下一步完全不同（去补素材 vs 点重试）。
 *
 * 本文件守三条：
 *  ① 失败时显示「素材没加载出来（不是「库里没有」）」+ 技术原因 + 重试按钮；
 *  ② 真·空库（请求成功但 0 条）仍走原来的「素材库为空或未命中」文案，不许出现失败态；
 *  ③ 重试成功后失败态消失、图片出现。
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"

const state = vi.hoisted(() => ({ responses: [] as Array<() => unknown> }))

vi.mock("@/lib/pb", () => ({ getPocketBaseUrl: () => "" }))
vi.mock("@/lib/rhLogin", () => ({ vibexAuthHeaders: () => ({ "X-Rh-User-Id": "local-user" }) }))

import { MaterialPickerDialog } from "./MaterialPickerDialog"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const make = state.responses.shift()
      if (!make) return new Response(JSON.stringify({ items: [], totalItems: 0 }), { status: 200 })
      const r = make() as { status?: number; body: unknown }
      return new Response(JSON.stringify(r.body), {
        status: r.status ?? 200,
        headers: { "Content-Type": "application/json" },
      })
    }),
  )
}

function renderDialog() {
  return render(<MaterialPickerDialog open onOpenChange={() => {}} onPick={async () => true} />)
}

describe("素材选择器：加载失败不能伪装成空库", () => {
  it("请求 500 → 显示「素材没加载出来（不是「库里没有」）」+ 技术原因 + 重试", async () => {
    state.responses = [() => ({ status: 500, body: { message: "materials db locked" } })]
    installFetch()
    renderDialog()

    await waitFor(() => expect(screen.getByText(/素材没加载出来/)).toBeInTheDocument())
    expect(screen.getByText(/materials db locked/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument()
    // 关键：不许出现「库里为空」的误导文案
    expect(screen.queryByText(/素材库为空或未命中/)).toBeNull()
  })

  it("真·空库（200 且 0 条）→ 仍走原「素材库为空或未命中」，不出现失败态", async () => {
    state.responses = [() => ({ status: 200, body: { items: [], totalItems: 0 } })]
    installFetch()
    renderDialog()

    await waitFor(() => expect(screen.getByText(/素材库为空或未命中/)).toBeInTheDocument())
    expect(screen.queryByText(/素材没加载出来/)).toBeNull()
  })

  it("失败后重试成功 → 失败态消失，图片出现", async () => {
    state.responses = [
      () => ({ status: 500, body: { message: "网络抖动" } }),
      () => ({
        status: 200,
        body: {
          totalItems: 1,
          items: [
            { id: "m1", name: "医院走廊", category: "场景", source: "upload", thumb_data: "" },
          ],
        },
      }),
    ]
    installFetch()
    renderDialog()

    await waitFor(() => expect(screen.getByText(/素材没加载出来/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: /重试/ }))
    await waitFor(() => expect(screen.getByText("医院走廊")).toBeInTheDocument())
    expect(screen.queryByText(/素材没加载出来/)).toBeNull()
  })
})

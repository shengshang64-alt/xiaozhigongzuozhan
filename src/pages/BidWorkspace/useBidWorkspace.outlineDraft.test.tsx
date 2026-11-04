/** @vitest-environment jsdom */
/**
 * 大纲草稿恢复的**行为网**（2026-11-04，审计 P1 修复的回归钉）。
 *
 * 纯函数 `outlineDraft.test.ts` 已钉住判定口径；本文件钉的是「它真的接到了 hook 上」——
 * 因为这一环的失败方式是**静默**的：草稿被删掉、界面不报错、用户只看到新大纲消失了。
 *
 * 用户必撞路径（旧代码在这里删草稿）：
 *   已有确认大纲的项目 → 再点一次「生成大纲」→ 新大纲还没确认 → 按 F5 →
 *   新大纲消失、localStorage 键被删、全程无提示。
 *
 * 本文件守三条：
 *  ① 库里大纲 A + 草稿 B（不一致）→ 打开项目必须恢复 B 并提示；
 *  ② 草稿与库里大纲逐字一致 → 清草稿（残渣），且不提示「已恢复」；
 *  ③ 库里无大纲 + 有草稿 → 恢复（2026-11-03 的老行为不许回归）。
 */
import { cleanup, renderHook, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const DRAFT_PREFIX = "xz.bid.outlineDraft."

const h = vi.hoisted(() => {
  const state = {
    toasts: [] as string[],
    // 项目上「已确认」的大纲：两章
    project: {
      id: "p1",
      rh_user_id: "local-user",
      name: "大纲草稿行为网项目",
      status: "active",
      parse_report: { scope: "full", sections: [] },
      bid_outline: [
        { id: "n1", title: "第1章 已有大纲甲", children: [] },
        { id: "n2", title: "第2章 已有大纲乙", children: [] },
      ],
      bid_chapters: [],
      tender_text: "招标原文",
      created: "2026-11-01 09:00:00.000Z",
      updated: "2026-11-01 09:00:00.000Z",
    } as Record<string, unknown>,
  }
  return state
})

vi.mock("@/lib/pbJson", () => ({
  pbJsonRequest: async (path: string) => {
    if (/^\/api\/bid_projects\/[^?]+$/.test(path)) return h.project
    if (path.startsWith("/api/bid_projects?")) return { items: [h.project], totalItems: 1, page: 1, perPage: 200 }
    return { items: [], totalItems: 0, page: 1, perPage: 200 }
  },
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

async function mount() {
  const view = renderHook(() => useBidWorkspace(), { wrapper })
  await waitFor(() => expect(view.result.current.activeProject?.id).toBe("p1"))
  return view
}

beforeEach(() => {
  h.toasts.length = 0
  localStorage.clear()
})
afterEach(cleanup)

describe("大纲草稿恢复：不一致的新草稿不能被当成残渣删掉", () => {
  it("库里有大纲 + 草稿是新的未确认稿 → 恢复草稿并提示尚未确认", async () => {
    const draft = [
      { id: "d1", title: "第1章 重新生成的新大纲", children: [] },
      { id: "d2", title: "第2章 新增章", children: [] },
    ]
    localStorage.setItem(DRAFT_PREFIX + "p1", JSON.stringify(draft))
    const { result } = await mount()

    // ① 内存里必须换成草稿（不是库里的旧大纲）
    expect(result.current.outlineDraft.map((n) => n.id)).toEqual(["d1", "d2"])
    // ② 必须告诉用户「这是未确认的稿」
    expect(h.toasts.some((t) => t.includes("已恢复上次未确认的大纲草稿"))).toBe(true)
    // ③ 草稿键必须还在（用户还没确认，下次刷新还要能恢复）
    expect(localStorage.getItem(DRAFT_PREFIX + "p1")).toBeTruthy()
  })

  it("草稿与库里大纲逐字一致 → 视为已入库，清掉草稿且不提示恢复", async () => {
    const persisted = h.project.bid_outline as unknown[]
    localStorage.setItem(DRAFT_PREFIX + "p1", JSON.stringify(persisted))
    const { result } = await mount()

    expect(h.toasts.some((t) => t.includes("已恢复"))).toBe(false)
    // 清残渣：键要没了
    await waitFor(() => expect(localStorage.getItem(DRAFT_PREFIX + "p1")).toBeNull())
    // outlineDraft 是「临时编辑稿」：已入库就没有待编辑稿，故为空；
    // 已确认的大纲仍在 activeProject.bid_outline（界面按需回退读它）
    expect(result.current.outlineDraft).toEqual([])
    expect((result.current.activeProject?.bid_outline ?? []).map((n) => n.id)).toEqual(["n1", "n2"])
  })

  it("库里没有大纲 + 有草稿 → 恢复（2026-11-03 老行为不许回归）", async () => {
    h.project.bid_outline = []
    const draft = [{ id: "d1", title: "唯一的草稿章", children: [] }]
    localStorage.setItem(DRAFT_PREFIX + "p1", JSON.stringify(draft))
    const { result } = await mount()

    expect(result.current.outlineDraft.map((n) => n.id)).toEqual(["d1"])
    expect(h.toasts.some((t) => t.includes("已恢复上次未确认的大纲草稿"))).toBe(true)
    h.project.bid_outline = [
      { id: "n1", title: "第1章 已有大纲甲", children: [] },
      { id: "n2", title: "第2章 已有大纲乙", children: [] },
    ]
  })
})

describe("大纲草稿：脏数据与无草稿", () => {
  it("没有草稿 → 不提示恢复、不崩，已确认大纲仍在项目上", async () => {
    const { result } = await mount()
    expect(result.current.outlineDraft).toEqual([])
    expect((result.current.activeProject?.bid_outline ?? []).map((n) => n.id)).toEqual(["n1", "n2"])
    expect(h.toasts.some((t) => t.includes("已恢复"))).toBe(false)
  })

  it("草稿是坏 JSON → 不崩，不提示恢复", async () => {
    localStorage.setItem(DRAFT_PREFIX + "p1", "{不是 JSON")
    const { result } = await mount()
    expect(result.current.outlineDraft).toEqual([])
    expect((result.current.activeProject?.bid_outline ?? []).map((n) => n.id)).toEqual(["n1", "n2"])
  })
})

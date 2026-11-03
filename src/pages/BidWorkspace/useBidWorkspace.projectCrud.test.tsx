/** @vitest-environment jsdom */
/**
 * God Hook 行为网 · 项目 CRUD 簇（R58 · B32「行为网按簇扩展」第一簇）。
 *
 * R57 铺了第一张行为网（挂载契约 / 只读边界 / 计费确认 / 大纲失败诊断 + 快照恢复判据），
 * 但 371 个句柄里「项目管理」这一簇（新建 / 重命名 / 软删回收 / 归档 / 彻底删除）仍只有源码
 * grep 覆盖。本文件按 R57 报出的顺序（项目 CRUD → 章节生成/正文精修 → 体检与评标 → 导出）
 * 补第一簇，守五条**用户能感知**的契约：
 *   ① 新建项目：填名 → POST 落库（带 rh_user_id / stage=pending_parse）→ 列表出现 → 自动打开；
 *      空名 → 只提示、一分钱不花（零写请求）；
 *   ② 重命名：updateProject 改 project_name → PATCH 落库 + 当前项目同步；
 *   ③ 软删 → 还原：软删写 deleted_at、还原清空 deleted_at（回收站 30 天契约）；
 *   ④ 归档 → 取消归档：归档写 archived:true、取消写 archived:false（归档只读硬锁的数据面）；
 *   ⑤ 彻底删除：DELETE 落库 + 从列表移除 + 按项目名提示。
 *
 * 与 R57 同一套旁路纪律：只 mock `pbJsonRequest` 网络 / `sonner` 提示 / `MemoryRouter` 路由，
 * 不 mock 任何业务逻辑，零 AI、不触网。
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const state = {
    calls: [] as { path: string; method: string; body: Record<string, unknown> | null }[],
    toasts: [] as string[],
    /** 列表接口返回的既有项目（id=p1），新建/软删/归档/彻底删除都在它周围做文章 */
    project: {
      id: "p1",
      rh_user_id: "local-user",
      project_name: "测试项目",
      tender_no: "",
      hospital: "",
      bid_open_date: "",
      stage: "pending_parse",
      tender_text: "",
      parse_report: null,
      parse_config: null,
      bid_outline: [],
      bid_chapters: [],
      archived: false,
      deleted_at: "",
      created: "2026-10-20 09:00:00.000Z",
      updated: "2026-10-20 09:00:00.000Z",
    } as Record<string, unknown>,
  }
  return state
})

vi.mock("@/lib/pbJson", () => ({
  pbJsonRequest: async (path: string, init?: RequestInit) => {
    const method = String(init?.method ?? "GET").toUpperCase()
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    h.calls.push({ path, method, body })
    if (method !== "GET") return { id: "rec-echo", ...(body ?? {}) }
    if (/^\/api\/bid_projects\?/.test(path)) return { items: [h.project], totalItems: 1, page: 1, perPage: 200 }
    // 深链 ?project=p1 冷启动列表未到位时走单条 GET 兜底打开（与 R57 行为网同一契约）
    if (/^\/api\/bid_projects\/[^?]+$/.test(path)) return h.project
    return { items: [], totalItems: 0, page: 1, perPage: 200 }
  },
  // 错误路径才用；正常路径不触发，但 mock 成真实现可防「误触错误分支时 throw undefined」假红
  saveFailureReason: (e: unknown) => String(e),
}))

vi.mock("sonner", () => {
  const rec = (m: unknown) => {
    h.toasts.push(String(m))
  }
  return { toast: Object.assign(rec, { success: rec, error: rec, warning: rec, info: rec, message: rec, loading: rec }) }
})

import { useBidWorkspace } from "./useBidWorkspace"
import type { BidProjectRecord } from "./bidTypes"

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>
const deepLinkWrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={["/?project=p1"]}>{children}</MemoryRouter>
)

/** 深链打开 p1，等到 activeProject 就位（重命名/软删/归档/删除都跑在「有项目」的真实前置上）。 */
async function mountWithProject() {
  const view = renderHook(() => useBidWorkspace(), { wrapper: deepLinkWrapper })
  await waitFor(() => expect(view.result.current.activeProject?.id).toBe("p1"))
  return view
}

const writes = () => h.calls.filter((c) => c.method !== "GET")
const patchCalls = (id: string) => h.calls.filter((c) => c.method === "PATCH" && c.path === `/api/bid_projects/${id}`)

beforeEach(() => {
  h.calls.length = 0
  h.toasts.length = 0
  h.project.project_name = "测试项目"
  h.project.archived = false
  h.project.deleted_at = ""
})
afterEach(() => {
  cleanup()
})

describe("R58（B32）项目 CRUD 行为网", () => {
  it("新建项目：填名 → POST 落库 + 列表出现 + 自动打开 + 成功提示", async () => {
    const { result } = renderHook(() => useBidWorkspace(), { wrapper })
    act(() => {
      result.current.setFormProjectName("  新建标书项目  ")
    })
    await act(async () => {
      await result.current.createProject()
    })
    const post = h.calls.find((c) => c.method === "POST" && c.path === "/api/bid_projects")
    expect(post, "createProject 必须真的 POST /api/bid_projects").toBeTruthy()
    expect(post?.body).toMatchObject({
      rh_user_id: "local-user",
      project_name: "新建标书项目", // 首尾空格已 trim
      stage: "pending_parse",
    })
    // 落库后：列表出现 + 自动打开为当前项目 + 一句可照做的提示
    expect(result.current.projects.some((p) => p.project_name === "新建标书项目")).toBe(true)
    expect(result.current.activeProject?.project_name).toBe("新建标书项目")
    expect(h.toasts.join("\n")).toContain("已创建")
  })

  it("新建项目：空名 → 只提示、零写请求（一分钱不花）", async () => {
    const { result } = renderHook(() => useBidWorkspace(), { wrapper })
    act(() => {
      result.current.setFormProjectName("   ")
    })
    await act(async () => {
      await result.current.createProject()
    })
    expect(h.toasts.join("\n")).toContain("请填写项目名称")
    expect(writes(), "空名新建不应发任何写请求").toEqual([])
  })

  it("重命名：updateProject 改 project_name → PATCH 落库 + 当前项目同步", async () => {
    const { result } = await mountWithProject()
    act(() => {
      result.current.updateProject({ project_name: "改名后的项目" })
    })
    await waitFor(() => expect(patchCalls("p1").length).toBeGreaterThan(0))
    const patch = patchCalls("p1")[0]
    expect(patch.body?.project_name).toBe("改名后的项目")
    expect(result.current.activeProject?.project_name).toBe("改名后的项目")
  })

  it("软删 → 还原：软删写 deleted_at，还原清空 deleted_at（回收站 30 天契约）", async () => {
    const { result } = await mountWithProject()
    const target = result.current.activeProject as BidProjectRecord
    await act(async () => {
      await result.current.softDeleteProject(target)
    })
    const soft = patchCalls("p1").at(-1)
    expect(soft?.body?.deleted_at, "软删必须写非空 deleted_at").toBeTruthy()
    expect(h.toasts.join("\n")).toContain("已移入回收站")

    await act(async () => {
      await result.current.restoreProject(target)
    })
    const restore = patchCalls("p1").at(-1)
    expect(restore?.body?.deleted_at).toBe("")
    expect(h.toasts.join("\n")).toContain("已还原")
  })

  it("归档 → 取消归档：归档写 archived:true，取消写 archived:false", async () => {
    const { result } = await mountWithProject()
    const target = result.current.activeProject as BidProjectRecord
    await act(async () => {
      await result.current.setProjectArchived(target, true)
    })
    expect(patchCalls("p1").at(-1)?.body?.archived).toBe(true)
    expect(h.toasts.join("\n")).toContain("已归档")

    await act(async () => {
      await result.current.setProjectArchived(target, false)
    })
    expect(patchCalls("p1").at(-1)?.body?.archived).toBe(false)
    expect(h.toasts.join("\n")).toContain("已取消归档")
  })

  it("彻底删除：DELETE 落库 + 从列表移除 + 按项目名提示", async () => {
    const { result } = await mountWithProject()
    const target = result.current.activeProject as BidProjectRecord
    await act(async () => {
      await result.current.deleteProject(target)
    })
    const del = h.calls.find((c) => c.method === "DELETE" && c.path === "/api/bid_projects/p1")
    expect(del, "彻底删除必须真的 DELETE /api/bid_projects/{id}").toBeTruthy()
    expect(result.current.projects.some((p) => p.id === "p1")).toBe(false)
    expect(h.toasts.join("\n")).toContain("测试项目")
    expect(h.toasts.join("\n")).toContain("已彻底删除")
  })
})

/** @vitest-environment jsdom */
/**
 * God Hook 行为网 · 章节正文精修簇（R59 · B32「行为网按簇扩展」第二簇的正文精修半边）。
 *
 * R57 铺第一张行为网（挂载契约 / 只读边界 / 计费确认 / 大纲失败诊断），R58 补项目 CRUD 簇；
 * 本文件按 R57 报出的扩展顺序（项目 CRUD → 章节生成/正文精修 → 体检与评标 → 导出）做第二簇的
 * **正文精修**半边——「章节生成」半边依赖 LLM（generateChapterContent 打网关），不在本文件的
 * 三旁路纪律内（只 mock 网络 / 提示条 / 路由，不 mock 业务逻辑），留给后续专做。
 *
 * 守五条**用户能感知**的契约：
 *   ① 正文编辑自动保存：选中章 → 打字 → 1s 防抖 → PATCH 落库，且只动目标章、不误改兄弟章与标题；
 *   ② 正文一经人工改动，成稿期算出的两类本地标记（丢字 sanity / 版式 proseLint）立即作废
 *      ——R55 在 sanityJumpWiring.test.ts 里用「读源码 + 正则」钉过这条，这里是**行为级**首钉；
 *   ③ 正文没真的变化就不落库（flushEditingContent 的 content 判据，避免每次进入都写一次）；
 *   ④ 归档项目正文编辑被静默拦截（blockIfArchived silent：状态不变、零写请求、不弹提示）；
 *   ⑤ 章节生成把 gen_status 置 generating 是**本地态**、不落库（updateProject {persist:false}）。
 *
 * 与 R57/R58 同一套旁路纪律：只 mock `pbJsonRequest` 网络 / `sonner` 提示 / `MemoryRouter` 路由，
 * 不 mock 任何业务逻辑，零 AI、不触网。
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const freshChapters = () => [
    { node_id: "c1", title: "第一章 项目理解", sections: ["1.1 项目背景"], content: "原始正文", gen_status: "done" as const },
    { node_id: "c2", title: "第二章 技术方案", sections: ["2.1 总体架构"], content: "第二章原文", gen_status: "done" as const },
  ]
  const state = {
    calls: [] as { path: string; method: string; body: Record<string, unknown> | null }[],
    toasts: [] as string[],
    /** 列表/单条接口返回的既有项目（id=p1），带两个已成稿技术章（gen_status=done，不触发 openProject 的中断复位） */
    project: {
      id: "p1",
      rh_user_id: "local-user",
      project_name: "正文精修测试项目",
      tender_no: "",
      hospital: "",
      bid_open_date: "",
      stage: "composing",
      tender_text: "字".repeat(1000),
      parse_report: null,
      parse_config: null,
      bid_outline: [{ id: "n1", title: "第一章 项目理解", children: [] }],
      bid_chapters: freshChapters(),
      archived: false,
      deleted_at: "",
      created: "2026-10-21 09:00:00.000Z",
      updated: "2026-10-21 09:00:00.000Z",
    } as Record<string, unknown>,
    freshChapters,
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
    // 深链 ?project=p1 冷启动列表未到位时走单条 GET 兜底打开（与 R57/R58 同一契约）
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

/** 深链打开 p1，等到 activeProject 就位（后续编辑都跑在「有项目 + 有章节」的真实前置上）。 */
async function mountWithProject() {
  const view = renderHook(() => useBidWorkspace(), { wrapper })
  await waitFor(() => expect(view.result.current.activeProject?.id).toBe("p1"))
  return view
}

const writes = () => h.calls.filter((c) => c.method !== "GET")
const patchCalls = () => h.calls.filter((c) => c.method === "PATCH" && c.path === "/api/bid_projects/p1")
const chapterFrom = (patchBody: Record<string, unknown> | null, nodeId: string) =>
  ((patchBody?.bid_chapters ?? []) as Array<Record<string, unknown>>).find((c) => c.node_id === nodeId)

beforeEach(() => {
  h.calls.length = 0
  h.toasts.length = 0
  h.project.archived = false
  h.project.bid_chapters = h.freshChapters()
  localStorage.clear()
})
afterEach(() => {
  cleanup()
})

describe("R59（B32 第二簇）章节正文精修行为网", () => {
  it("正文编辑自动保存：选中章 → 打字 → 1s 防抖 → PATCH 落库，只动目标章、不误改兄弟章与标题", async () => {
    const { result } = await mountWithProject()
    act(() => {
      result.current.selectChapter("c1")
    })
    expect(result.current.activeChapterId).toBe("c1")
    expect(result.current.editingContent).toBe("原始正文")

    act(() => {
      result.current.setEditingContent("人工修订后的正文")
    })
    await waitFor(() => expect(patchCalls().length).toBeGreaterThan(0), { timeout: 3000 })

    const body = patchCalls().at(-1)?.body ?? null
    const c1 = chapterFrom(body, "c1")
    const c2 = chapterFrom(body, "c2")
    expect(c1?.content, "编辑的正文必须真的落库").toBe("人工修订后的正文")
    expect(c1?.title, "标题不得被正文编辑误改").toBe("第一章 项目理解")
    expect(c2?.content, "兄弟章不得被正文编辑误改").toBe("第二章原文")
    // 本地状态同步：编辑器里的章内容跟着变
    expect(result.current.activeChapter?.content).toBe("人工修订后的正文")
  })

  it("正文一经人工改动，丢字/版式标记立即作废（R55 契约第一次行为级钉住）", async () => {
    // 给 c1 塞满成稿期才会出现的本地标记：丢字 + 版式 lint + 严重度
    const chapters = h.project.bid_chapters as Array<Record<string, unknown>>
    chapters[0].sanityWarning = "疑似丢字"
    chapters[0].sanityFirstHit = { offset: 3, excerpt: "文" }
    chapters[0].proseLintWarning = "AI 套话"
    chapters[0].proseLintFirstHit = { offset: 0, excerpt: "原" }
    chapters[0].proseLintSeverity = "style"

    const { result } = await mountWithProject()
    act(() => {
      result.current.selectChapter("c1")
    })
    act(() => {
      result.current.setEditingContent("人工修订后的正文")
    })
    await waitFor(() => expect(patchCalls().length).toBeGreaterThan(0), { timeout: 3000 })

    const body = patchCalls().at(-1)?.body ?? null
    const c1 = chapterFrom(body, "c1")
    expect(c1?.content).toBe("人工修订后的正文")
    // JSON.stringify 会丢掉值为 undefined 的键：标记必须从落库的章节里整个消失（否则下次生成/重写前它仍锚在旧正文上）
    expect("sanityWarning" in (c1 ?? {}), "sanityWarning 必须随正文作废").toBe(false)
    expect("proseLintWarning" in (c1 ?? {}), "proseLintWarning 必须随正文作废").toBe(false)
    expect("proseLintSeverity" in (c1 ?? {}), "proseLintSeverity 必须随正文作废").toBe(false)
    // 本地状态同样清空
    expect(result.current.activeChapter?.sanityWarning).toBeUndefined()
    expect(result.current.activeChapter?.proseLintWarning).toBeUndefined()
    expect(result.current.activeChapter?.proseLintSeverity).toBeUndefined()
  })

  it("正文没真的变化就不落库（进入章节不动笔，不产生写请求）", async () => {
    const { result } = await mountWithProject()
    act(() => {
      result.current.selectChapter("c1")
    })
    // 与章内容完全相同：flushEditingContent 的 content 判据应当拦住这次写
    act(() => {
      result.current.setEditingContent("原始正文")
    })
    await new Promise((r) => setTimeout(r, 1200))
    expect(writes(), `正文未变却产生了写请求：${JSON.stringify(writes())}`).toEqual([])
  })

  it("归档项目正文编辑被静默拦截：状态不变、零写请求、不弹提示", async () => {
    h.project.archived = true
    const { result } = await mountWithProject()
    act(() => {
      result.current.selectChapter("c1")
    })
    act(() => {
      result.current.setEditingContent("试图改动")
    })
    // 静默拦截：编辑态原样不动（blockIfArchived(true) 在写 editingContentRef 之前就返回了）
    expect(result.current.editingContent).toBe("原始正文")
    await new Promise((r) => setTimeout(r, 1200))
    expect(writes(), "归档项目不得产生任何写请求").toEqual([])
    // silent=true：不弹「已归档项目为只读」这类提示（逐键 setter 不该刷屏）
    expect(h.toasts.join("\n")).not.toContain("只读")
  })

  it("章节生成把 gen_status 置 generating 是本地态、不落库（updateProject {persist:false}）", async () => {
    const { result } = await mountWithProject()
    act(() => {
      result.current.updateProject(
        {
          bid_chapters: result.current.activeProject!.bid_chapters.map((c) =>
            c.node_id === "c1" ? { ...c, gen_status: "generating" as const, genError: "" } : c,
          ),
        },
        { persist: false },
      )
    })
    expect(writes(), "persist:false 的生成占位不得落库").toEqual([])
    expect(
      result.current.activeProject!.bid_chapters.find((c) => c.node_id === "c1")?.gen_status,
    ).toBe("generating")
  })
})

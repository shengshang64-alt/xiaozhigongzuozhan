/** @vitest-environment jsdom */
/**
 * God Hook 行为网 · 体检与评标簇（R60 · B32「行为网按簇扩展」第三簇）。
 *
 * R57 铺第一张行为网（挂载契约 / 只读边界 / 计费确认 / 大纲失败诊断），R58 补项目 CRUD，
 * R59 补正文精修。本文件按 B32 报出的扩展顺序（… → 正文精修 → 体检与评标 → 导出）做第三簇，
 * 且只做**不依赖 LLM**的预检与本地路径——「交卷体检 / 模拟评标」的成功路径要打网关（多路 LLM），
 * 不在三旁路纪律内（只 mock 网络 / 提示条 / 路由，不 mock 业务逻辑），留给后续专做。
 *
 * 守六条**用户能感知**的契约：
 *   ① 交卷体检先弹费用确认；未确认取消 → 不体检、不落库（一次体检 = 覆盖审计 + 事实核对 +
 *      逐章护栏，是整站最贵的单次操作之一，计费红线）；
 *   ② 模拟评标先弹费用确认（三路 3 次调用）；取消 → 不评标、不落库；
 *   ③ 确认体检但投标无正文 → 给一句能照做的原因，且不发起任何写请求（预检在 LLM 之前，不白烧钱）；
 *   ④ 确认评标但缺评分项 → 给一句能照做的原因，且不发起任何写请求（预检在 LLM 之前）；
 *   ⑤ 人工打分表按评分办法**本地生成**（零 AI、零费用确认），落 manual_review；
 *   ⑥ 归档项目上体检 / 评标 / 打分表三条入口全被只读硬锁拦下（安全语义：不写 ai_review /
 *      submission_check / manual_review，不是「禁用按钮」而是「点了也不落库」）。
 *
 * 与 R57/R58/R59 同一套旁路纪律：只 mock `pbJsonRequest` 网络 / `sonner` 提示 / `MemoryRouter` 路由，
 * 不 mock 任何业务逻辑，零 AI、不触网。
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  /** 含 3 个评分项（40/30/20）的解析报告：initManualReview 的正向路径与评标预检都依赖它 */
  const scoringReport = () => ({
    scope: "full",
    sections: [
      {
        key: "tech_score",
        title: "技术评分要求",
        content: "项目理解（40分）：对项目背景与建设目标的理解程度\n技术方案（30分）：总体架构与实施路线",
        status: "ok",
      },
      { key: "biz_score", title: "商务评分要求", content: "售后服务承诺（20分）：质保期与响应时限的承诺", status: "ok" },
    ],
  })
  const chapterWithBody = () => [
    { node_id: "c1", title: "第一章 项目理解", sections: ["1.1 项目背景"], content: "已编制的投标正文", gen_status: "done" as const },
  ]
  const state = {
    calls: [] as { path: string; method: string; body: Record<string, unknown> | null }[],
    toasts: [] as string[],
    /** 固定引用：mock 在请求时读 h.project，测试用 Object.assign 复位（不复位引用） */
    project: {} as Record<string, unknown>,
  }
  const freshProject = (): Record<string, unknown> => ({
    id: "p1",
    rh_user_id: "local-user",
    project_name: "体检评标测试项目",
    tender_no: "",
    hospital: "",
    bid_open_date: "",
    stage: "composing",
    tender_text: "字".repeat(1000),
    parse_report: scoringReport(),
    parse_config: null,
    bid_outline: [],
    bid_chapters: chapterWithBody(),
    archived: false,
    deleted_at: "",
    created: "2026-10-21 09:00:00.000Z",
    updated: "2026-10-21 09:00:00.000Z",
  })
  Object.assign(state.project, freshProject())
  return { ...state, scoringReport, chapterWithBody, freshProject }
})

vi.mock("@/lib/pbJson", () => ({
  pbJsonRequest: async (path: string, init?: RequestInit) => {
    const method = String(init?.method ?? "GET").toUpperCase()
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    h.calls.push({ path, method, body })
    if (method !== "GET") return { id: "rec-echo", ...(body ?? {}) }
    if (/^\/api\/bid_projects\?/.test(path)) return { items: [h.project], totalItems: 1, page: 1, perPage: 200 }
    // 深链 ?project=p1 冷启动列表未到位时走单条 GET 兜底打开（与 R57/R58/R59 同一契约）
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

/** 深链打开 p1，等到 activeProject 就位（后续入口都跑在「有项目」的真实前置上）。 */
async function mountWithProject() {
  const view = renderHook(() => useBidWorkspace(), { wrapper })
  await waitFor(() => expect(view.result.current.activeProject?.id).toBe("p1"))
  return view
}

const writes = () => h.calls.filter((c) => c.method !== "GET")
const patchCalls = () => h.calls.filter((c) => c.method === "PATCH" && c.path === "/api/bid_projects/p1")

beforeEach(() => {
  h.calls.length = 0
  h.toasts.length = 0
  Object.assign(h.project, h.freshProject())
  localStorage.clear() // 计费「今日已确认」标记必须逐用例干净（用例①/②依赖它弹出确认框）
})
afterEach(() => {
  cleanup()
})

describe("R60（B32 第三簇）体检与评标行为网：计费确认 / 预检 / 归档只读", () => {
  it("交卷体检先弹费用确认；取消 → 不体检、不落库（一次体检是多路 LLM，计费红线）", async () => {
    const { result } = await mountWithProject()
    act(() => {
      result.current.startSubmissionCheck()
    })
    // 访客自付费形态（本机 visitorPaysForAi=true）必须先弹确认，而不是直接开跑
    expect(result.current.costConfirm.costConfirmOpen).toBe(true)
    expect(result.current.costConfirm.costConfirmPriceText).toContain("交卷前")
    expect(writes()).toEqual([])
    act(() => {
      result.current.costConfirm.cancelCostConfirm()
    })
    expect(result.current.costConfirm.costConfirmOpen).toBe(false)
    expect(writes(), "取消后仍然发了请求").toEqual([])
  })

  it("模拟评标先弹费用确认（三路 3 次调用）；取消 → 不评标、不落库", async () => {
    const { result } = await mountWithProject()
    act(() => {
      result.current.startAiReview()
    })
    expect(result.current.costConfirm.costConfirmOpen).toBe(true)
    expect(result.current.costConfirm.costConfirmPriceText).toContain("三路评标")
    expect(writes()).toEqual([])
    act(() => {
      result.current.costConfirm.cancelCostConfirm()
    })
    expect(result.current.costConfirm.costConfirmOpen).toBe(false)
    expect(writes(), "取消后仍然发了请求").toEqual([])
  })

  it("确认体检但投标无正文：给一句能照做的原因，零写请求（预检在 LLM 之前，不白烧钱）", async () => {
    h.project.bid_chapters = []
    const { result } = await mountWithProject()
    act(() => {
      result.current.startSubmissionCheck()
    })
    await act(async () => {
      result.current.costConfirm.confirmCostAction()
    })
    expect(h.toasts.join("\n")).toContain("投标文件还没有正文")
    expect(h.toasts.join("\n")).toContain("再做交卷体检")
    // 预检命中即返回：不落 submission_check、不写任何快照
    expect(writes(), `无正文体检却产生了写请求：${JSON.stringify(writes())}`).toEqual([])
  })

  it("确认评标但缺评分项：给一句能照做的原因，零写请求（预检在 LLM 之前）", async () => {
    h.project.parse_report = null
    const { result } = await mountWithProject()
    act(() => {
      result.current.startAiReview()
    })
    await act(async () => {
      result.current.costConfirm.confirmCostAction()
    })
    expect(h.toasts.join("\n")).toContain("该评标依赖「技术评分要求 / 商务评分要求」解析项")
    expect(h.toasts.join("\n")).toContain("勾选并解析")
    expect(writes(), `缺评分项评标却产生了写请求：${JSON.stringify(writes())}`).toEqual([])
  })

  it("人工打分表按评分办法本地生成（零 AI、零费用确认）：落 manual_review", async () => {
    const { result } = await mountWithProject()
    // 零费用确认：initManualReview 不是 AI 调用，不该弹计费框
    act(() => {
      result.current.initManualReview()
    })
    expect(result.current.costConfirm.costConfirmOpen).toBe(false)
    await waitFor(() => expect(patchCalls().length).toBeGreaterThan(0))
    const body = patchCalls().at(-1)?.body ?? null
    const mr = body?.manual_review as { items: Array<Record<string, unknown>>; total_score: number } | undefined
    expect(mr, "打分表必须落 manual_review").toBeDefined()
    expect(mr?.total_score).toBe(0)
    expect(mr?.items.length).toBe(3)
    expect(mr?.items[0]).toMatchObject({ scoring_item: "项目理解", max_score: 40, manual_score: 0, comment: "" })
    expect(h.toasts.join("\n")).toContain("人工打分表已按评分办法生成")
  })

  it("归档项目上体检 / 评标 / 打分表三条入口全被只读硬锁拦下：零写请求", async () => {
    h.project.archived = true
    const { result } = await mountWithProject()
    act(() => {
      result.current.startAiReview()
      result.current.startSubmissionCheck()
      result.current.initManualReview()
    })
    // 三条入口都被 blockIfArchived 拦下：不弹计费框、不落 ai_review / submission_check / manual_review
    expect(result.current.costConfirm.costConfirmOpen).toBe(false)
    expect(writes(), `归档项目却产生了写请求：${JSON.stringify(writes())}`).toEqual([])
    // 三条入口各给一句「只读」提示（不是静默吞掉，也不是「禁用」）
    expect(h.toasts.filter((t) => t.includes("已归档项目为只读")).length).toBe(3)
  })
})

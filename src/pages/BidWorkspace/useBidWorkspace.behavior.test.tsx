/** @vitest-environment jsdom */
/**
 * God Hook 的**第一张行为网**（R57 · 审计三稿 §3.1）。
 *
 * 为什么需要它：这个 hook 是 9,828 行 / 500 KB、返回 371 个句柄的「God Hook」，而在此文件之前
 * 全仓 271 个测试文件里 `renderHook` 出现 **0 次**——它的真实回归网只有十几处源码 grep 哨兵
 * （钉字符串与正则，不钉行为）。本文件按审计给的路线起步：只旁路三个东西
 * （`pbJsonRequest` 网络、`sonner` 提示条、`MemoryRouter` 路由上下文），**不 mock 业务逻辑**
 * （计费弹窗、项目加载、快照写入全部跑真实实现），零 AI、不触网。
 *
 * 第一批守三条**用户能感知**的契约，其中前两条此前只有源码 grep，第三条是计费红线：
 *   ① 挂载契约：根文件把各簇句柄逐项列出（搬簇不得让页面拿到 undefined），且挂载/打开项目全程只读；
 *   ② 计费契约：点「生成大纲」先弹费用确认；**未确认就取消 → 不生成、不落库**（一分钱不花）；
 *      确认后才真跑（这是 vibex 计费契约要求的「用户触发证据」写法）；
 *   ③ R56（B27）失败可诊断：确认后因「还没做 AI 解析」而失败时，要落一条 stage=outline 的
 *      结构化诊断留痕 + 给用户一句能照做的原因，而不是静默什么都不发生；
 *      并且这类**没有成果的留痕行**点「恢复」必须被拒绝（不写库、不谎报成功）——用一条真成果行
 *      做正向对照，证明这层断言真的看得见「恢复动作」（否则就是真空断言）。
 *
 * 反向验证（R57 报告记录）：删 `recordOutlineDiag` 的 pre-flight 调用 → 用例④红；
 * 删 `restoreSnapshot` 里的 `isRestorableSnapshot` 守卫 → 用例⑤第一段红。
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const state = {
    calls: [] as { path: string; method: string; body: Record<string, unknown> | null }[],
    toasts: [] as string[],
    /** 唯一被「载入」的项目：没有 parse_report（= 还没做 AI 解析），正是 blocked_no_report 的前置条件 */
    project: {
      id: "p1",
      rh_user_id: "local-user",
      name: "R57 行为网测试项目",
      status: "active",
      parse_report: null,
      bid_outline: [],
      bid_chapters: [],
      tender_text: "",
      created: "2026-10-16 09:00:00.000Z",
      updated: "2026-10-16 09:00:00.000Z",
    } as Record<string, unknown>,
  }
  return state
})

vi.mock("@/lib/pbJson", () => ({
  pbJsonRequest: async (path: string, init?: RequestInit) => {
    const method = String(init?.method ?? "GET").toUpperCase()
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    h.calls.push({ path, method, body })
    if (method !== "GET") return { id: "rec-behavior", ...(body ?? {}) }
    // 深链 ?project=p1 冷启动时列表还没到位，会走「单条 GET 兜底打开」分支（见 hook 内注释），
    // 所以单条记录也必须能返回；否则只会得到一句「项目不存在或无权访问」。
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
import type { StageSnapshotRow } from "./bidTypes"

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={["/?project=p1"]}>{children}</MemoryRouter>
)

/** 挂载并等到深链 `?project=p1` 真的被消费（activeProject 就位），后续行为才跑在「有项目」的真实前置上。 */
async function mountWithProject() {
  const view = renderHook(() => useBidWorkspace(), { wrapper })
  await waitFor(() => expect(view.result.current.activeProject?.id).toBe("p1"))
  return view
}

const writes = () => h.calls.filter((c) => c.method !== "GET")
const snapshotPost = () => h.calls.find((c) => c.method === "POST" && c.path === "/api/bid_stage_snapshots")

function snapshotRow(over: Partial<StageSnapshotRow>): StageSnapshotRow {
  return {
    id: "s1",
    rh_user_id: "local-user",
    project_id: "p1",
    stage: "outline",
    label: "快照",
    payload: null,
    created: "2026-10-16 10:00:00.000Z",
    updated: "2026-10-16 10:00:00.000Z",
    ...over,
  }
}

beforeEach(() => {
  h.calls.length = 0
  h.toasts.length = 0
  localStorage.clear() // 计费「今日已确认」标记必须逐用例干净（用例③/④依赖它区分两条分支）
})
afterEach(() => {
  cleanup()
})

describe("R57 God Hook 行为网：挂载契约与只读边界", () => {
  it("挂载即返回完整句柄：根文件把各簇句柄逐项列出（搬簇不得让页面拿到 undefined）", async () => {
    const { result } = await mountWithProject()
    const handle = result.current as unknown as Record<string, unknown>
    // 句柄总量：审计基线 371。给下限而非钉死数字——搬簇允许增减，但不允许「列漏一大堆」。
    expect(Object.keys(handle).length).toBeGreaterThanOrEqual(350)
    // 抽查跨越各簇的句柄（大纲 / 章节 / 快照 / 项目 / 计费），任一缺失都会让对应面板静默失效
    for (const key of [
      "generateOutline",
      "confirmOutline",
      "outlineDraft",
      "generateChapter",
      "activeChapter",
      "restoreSnapshot",
      "stageHistory",
      "loadStageHistory",
      "snapshotBusyId",
      "activeProject",
      "projects",
      "updateProject",
      "costConfirm",
    ]) {
      expect(handle[key], `返回句柄缺 ${key}`).toBeDefined()
    }
  })

  it("挂载 + 打开项目全程只读：不发任何写请求（加载不得偷偷落库）", async () => {
    await mountWithProject()
    await waitFor(() => expect(snapshotPost()).toBeUndefined())
    expect(writes(), `挂载/打开项目出现了写请求：${JSON.stringify(writes())}`).toEqual([])
    // 只读对面也得真的读过（否则上面的「没写」可能只是「什么都没跑」）
    expect(h.calls.some((c) => c.method === "GET" && c.path.startsWith("/api/bid_projects?"))).toBe(true)
  })
})

describe("R57 God Hook 行为网：计费确认与大纲失败可诊断", () => {
  it("点生成大纲先弹费用确认；取消 → 不生成、不落库（一分钱不花）", async () => {
    const { result } = await mountWithProject()
    act(() => {
      result.current.generateOutline()
    })
    // 访客自付费形态（本机 visitorPaysForAi=true）必须先弹确认，而不是直接开跑
    expect(result.current.costConfirm.costConfirmOpen).toBe(true)
    expect(result.current.costConfirm.costConfirmPriceText).toContain("大纲")
    expect(writes()).toEqual([])
    act(() => {
      result.current.costConfirm.cancelCostConfirm()
    })
    expect(result.current.costConfirm.costConfirmOpen).toBe(false)
    expect(writes(), "取消后仍然发了请求").toEqual([])
    expect(snapshotPost()).toBeUndefined()
  })

  it("确认费用后：无解析报告时落一条诊断留痕 + 给用户可读原因（R56 行为，第一次由行为而非源码钉住）", async () => {
    const { result } = await mountWithProject()
    act(() => {
      result.current.generateOutline()
    })
    expect(result.current.costConfirm.costConfirmOpen).toBe(true)
    await act(async () => {
      result.current.costConfirm.confirmCostAction() // 真实确认路径（不是 mock 出来的放行）
    })
    await waitFor(() => expect(snapshotPost()).toBeTruthy())
    const body = snapshotPost()?.body ?? {}
    expect(body.stage).toBe("outline")
    expect(body.project_id).toBe("p1")
    // 留痕里必须带结构化诊断（「工作记录」里点开就能看到当时的原因）
    expect((body.payload as Record<string, unknown>).diag).toMatchObject({ kind: "blocked_no_report" })
    // 留痕的 label 由 outlineDiagLabel() 写成「大纲生成被拦：<原因>」（面板另给「大纲诊断」徽标），
    // 即 label 本身就要带人话原因，而不是一个「诊断」二字了事的占位。
    expect(String(body.label)).toContain("大纲生成被拦")
    expect(String(body.label)).toContain("尚未完成招标文件 AI 解析")
    // 同时要给用户一句能照做的原因
    expect(h.toasts.join("\n")).toContain("请先完成招标文件 AI 解析")
  })
})

describe("R58（B28）行为网：关键项缺失时，有纲不硬拦、无纲仍硬拦", () => {
  /** 缺 void_items（完整档请求了它）+ 三个大纲硬依赖项齐全 → 关键项门禁判缺 1 项 */
  const reportMissingVoid = () => ({
    scope: "full",
    sections: [
      { key: "tech_score", title: "技术评分要求", content: "技术评分项 40 分", status: "ok" },
      { key: "response_req", title: "响应文件要求", content: "响应文件组成与份数", status: "ok" },
      { key: "biz_score", title: "商务评分要求", content: "商务评分项 20 分", status: "ok" },
    ],
  })
  const outline = [{ id: "n1", title: "第一章 项目理解", children: [] }]

  /** 每个用例都从干净的项目基线出发（h.project 是模块级共享状态，用完必须还原） */
  function withProject(patch: Record<string, unknown>) {
    const before = { ...h.project }
    Object.assign(h.project, patch)
    return () => {
      for (const k of Object.keys(patch)) if (!(k in before)) delete h.project[k]
      Object.assign(h.project, before)
    }
  }

  it("已有非空大纲：不 toast 硬拦，改二次确认；取消后弹窗关闭且一分钱不花（零写请求）", async () => {
    const restore = withProject({
      tender_text: "字".repeat(60000),
      parse_report: reportMissingVoid(),
      parse_config: { scope: "full", extra_keys: ["void_items"], star_clauses: true, channel: "whole" },
      bid_outline: outline,
    })
    try {
      const { result } = await mountWithProject()
      act(() => {
        result.current.generateOutline()
      })
      await act(async () => {
        result.current.costConfirm.confirmCostAction()
      })
      // 弹窗必须真的出现（不是只 setter 没读取方的死状态），且文案点明「覆盖」
      await waitFor(() => expect(result.current.outlineCriticalConfirmOpen).toBe(true))
      expect(result.current.outlineCriticalConfirmText).toContain("覆盖现有大纲")
      expect(result.current.outlineCriticalConfirmText).toContain("投标文件目录要求")
      // 不得再出现旧的硬拦提示
      expect(h.toasts.join("\n")).not.toContain("关键解析项缺失")
      expect(writes(), "弹窗阶段不得产生任何写请求").toEqual([])

      // 默认动作是取消：取消后不生成、不落库，弹窗关闭
      act(() => {
        result.current.cancelGenerateOutlineCritical()
      })
      expect(result.current.outlineCriticalConfirmOpen).toBe(false)
      expect(writes(), "取消后仍然发了请求").toEqual([])
      expect(snapshotPost()).toBeUndefined()
    } finally {
      restore()
    }
  })

  it("无大纲：保持硬拦（真拦截不得一起放掉）——只提示、不发写请求", async () => {
    const restore = withProject({
      tender_text: "字".repeat(60000),
      parse_report: reportMissingVoid(),
      parse_config: { scope: "full", extra_keys: ["void_items"], star_clauses: true, channel: "whole" },
      bid_outline: [],
    })
    try {
      const { result } = await mountWithProject()
      act(() => {
        result.current.generateOutline()
      })
      await act(async () => {
        result.current.costConfirm.confirmCostAction()
      })
      expect(result.current.outlineCriticalConfirmOpen).toBe(false)
      expect(h.toasts.join("\n")).toContain("关键解析项缺失")
      expect(h.toasts.join("\n")).toContain("投标文件目录要求")
      // 硬拦 + 诊断留痕（R56 既有行为，见本文件用例④：拦住时必须落一条 stage=outline 诊断快照）：
      // 只允许那一次诊断快照 POST，绝不可开始生成、绝不可改动项目本身（这才是「真拦截没被放掉」）。
      expect(writes().every((c) => c.path === "/api/bid_stage_snapshots")).toBe(true)
      expect(h.calls.some((c) => c.method === "PATCH" && c.path.includes("/api/bid_projects/p1"))).toBe(false)
    } finally {
      restore()
    }
  })
})

describe("R57 God Hook 行为网：快照恢复的成果判据", () => {
  it("失败诊断行点恢复：拒绝且不写库；真成果行照常恢复（正向对照）", async () => {
    const { result } = await mountWithProject()

    // ① 诊断留痕行：没有可恢复的成果 —— 拒绝，且不进入忙碌态
    const diagRow = snapshotRow({
      id: "s-diag",
      label: "大纲诊断 · 未解析",
      payload: { diag: { kind: "blocked_no_report", label: "大纲诊断", at: "2026-10-16 10:00:00" } },
    })
    const before = h.calls.length
    await act(async () => {
      await result.current.restoreSnapshot(diagRow, true)
    })
    expect(h.calls.slice(before).filter((c) => c.method !== "GET")).toEqual([])
    expect(result.current.snapshotBusyId).toBeFalsy() // 初始态是 ""，只断言「没进入忙碌」
    expect(h.toasts.join("\n")).toContain("不含可恢复的成果")

    // ② 正向对照：真成果行（payload.outline 非空）必须真的发起恢复写请求
    const realRow = snapshotRow({
      id: "s-real",
      label: "大纲 2 章",
      payload: { outline: [{ id: "n1", title: "第一章 项目理解" }, { id: "n2", title: "第二章 技术方案" }] },
    })
    await act(async () => {
      await result.current.restoreSnapshot(realRow, false)
    })
    await waitFor(() =>
      expect(h.calls.some((c) => c.method === "PATCH" && c.path.includes("/api/bid_projects/p1"))).toBe(true),
    )
  })
})

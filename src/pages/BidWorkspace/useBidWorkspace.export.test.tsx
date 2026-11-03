/** @vitest-environment jsdom */
/**
 * God Hook 行为网 · 导出簇（R61 · B32「行为网按簇扩展」第四簇）。
 *
 * R57 铺第一张行为网（挂载契约 / 只读边界 / 计费确认 / 大纲失败诊断），R58 补项目 CRUD，
 * R59 补正文精修，R60 补体检与评标（预检半边）。B32 报出的扩展顺序是「… → 正文精修 →
 * 体检与评标 → 导出」，本文件做最后一簇「导出」，且只做**不依赖 LLM**的路径——导出本身
 * 就是「把本地已有产物落成 Word」，不需要打模型网关，天然落在三旁路纪律内。
 *
 * 守七条**用户能感知**的契约：
 *   ① 导出投标文件：投标无正文 → 给一句能照做的原因、不导出（预检在动态 import 之前，
 *      不白加载 docx + pdf worker 重依赖）；
 *   ② 导出投标文件：有正文 → exportBidDocx(cur) 恰一次 + exportBusy 流转 + 成功提示；
 *   ③ 导出投标文件：资质硬拦截（localStorage qual_hard_block=1 + 过期证书）→ 阻断、不导出；
 *   ④ 导出技术偏离表：无偏离表 → 给原因、不导出；
 *   ⑤ 导出技术偏离表：有偏离表 → exportDeviationDocx(cur) 恰一次 + 提示；
 *   ⑥ 全套导出：交卷闸门未确认 → 给「还有 N 个」原因、零导出；
 *   ⑦ 全套导出：五闸门全确认 → 按序导出已就绪五件（bid→deviation→parse→dup_void→eval）。
 *
 * 与 R57/R58/R59/R60 同一套旁路纪律，但多一个旁路：`./bidFiles` 是导出侧的「输出汇」——
 * 它只被动态 import（注释 R147 写明它连带 docx + pdf worker 重依赖，故按需加载），其内部
 * 逐字节正确性已由 bidFiles.test.ts 覆盖。此处 mock 它只为记录「谁被调用、以什么顺序、传了
 * 哪个项目」，与被 mock 的 `pbJsonRequest`（网络汇）同一性质——被测对象仍是 hook 的导出接线
 * （预检 / busy 流转 / 提示 / 顺序），不是 docx 生成本身。
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const state = {
    calls: [] as { path: string; method: string; body: Record<string, unknown> | null }[],
    toasts: [] as string[],
    exports: [] as { fn: string; kind?: string; projectId?: string }[],
    /** 资质核验接口返回的告警列表（默认空 = 无风险；硬拦截用例里塞过期证书） */
    qualAlerts: [] as Array<Record<string, unknown>>,
    project: {} as Record<string, unknown>,
  }
  const chapterWithBody = () => [
    { node_id: "c1", title: "第一章 项目理解", sections: ["1.1 项目背景"], content: "已编制的投标正文", gen_status: "done" as const },
  ]
  /** 一条新格式偏离表行：normalizeDeviationTable 认 clause_text 即产出 row */
  const deviationTableRaw = () => ({
    split_dim: "system",
    rows: [{ clause_id: "d1", clause_no: "1.1", clause_text: "招标要求：系统应支持 XXX", response_level: "full" }],
  })
  const allGatesConfirmed = () => ({
    gates: ["parse", "outline", "compose", "check", "eval"].map((gate) => ({
      gate,
      confirmed_at: "2026-10-21 09:00:00.000Z",
      notes: "",
      forced: false,
    })),
  })
  const freshProject = (): Record<string, unknown> => ({
    id: "p1",
    rh_user_id: "local-user",
    project_name: "导出测试项目",
    tender_no: "",
    hospital: "",
    bid_open_date: "",
    stage: "composing",
    tender_text: "字".repeat(1000),
    parse_report: null,
    parse_config: null,
    bid_outline: [],
    bid_chapters: chapterWithBody(),
    response_map: null,
    dup_report: null,
    void_check: null,
    ai_review: null,
    manual_review: null,
    stage_gates: { gates: [] },
    archived: false,
    deleted_at: "",
    created: "2026-10-21 09:00:00.000Z",
    updated: "2026-10-21 09:00:00.000Z",
  })
  Object.assign(state.project, freshProject())
  return { ...state, freshProject, chapterWithBody, deviationTableRaw, allGatesConfirmed }
})

vi.mock("@/lib/pbJson", () => ({
  pbJsonRequest: async (path: string, init?: RequestInit) => {
    const method = String(init?.method ?? "GET").toUpperCase()
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    h.calls.push({ path, method, body })
    if (method !== "GET") return { id: "rec-echo", ...(body ?? {}) }
    if (/^\/api\/qual_certs\/summary/.test(path)) return { alerts: h.qualAlerts }
    if (/^\/api\/bid_projects\?/.test(path)) return { items: [h.project], totalItems: 1, page: 1, perPage: 200 }
    // 深链 ?project=p1 冷启动列表未到位时走单条 GET 兜底打开（与 R57/R58/R59/R60 同一契约）
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

vi.mock("./bidFiles", () => ({
  exportBidDocx: async (p: { id?: string }) => {
    h.exports.push({ fn: "exportBidDocx", projectId: p?.id })
  },
  exportReportDocx: async (kind: string, p: { id?: string }) => {
    h.exports.push({ fn: "exportReportDocx", kind, projectId: p?.id })
  },
  exportDeviationDocx: async (p: { id?: string }) => {
    h.exports.push({ fn: "exportDeviationDocx", projectId: p?.id })
  },
}))

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

const exports = () => h.exports

beforeEach(() => {
  h.calls.length = 0
  h.toasts.length = 0
  h.exports.length = 0
  h.qualAlerts.length = 0
  Object.assign(h.project, h.freshProject())
  localStorage.clear() // 资质硬拦截开关（qual_hard_block）必须逐用例干净
})
afterEach(() => {
  cleanup()
})

describe("R61（B32 第四簇）导出行为网：预检 / 成功路径 / 顺序 / 资质硬拦截", () => {
  it("导出投标文件：无正文 → 给原因、不导出（预检在动态 import 之前，不白加载 docx 重依赖）", async () => {
    h.project.bid_chapters = []
    const { result } = await mountWithProject()
    await act(async () => {
      await result.current.exportBidWord()
    })
    expect(h.toasts.join("\n")).toContain("还没有任何正文内容")
    expect(exports(), "无正文却调了导出器").toEqual([])
    expect(result.current.exportBusy).toBe("")
  })

  it("导出投标文件：有正文 → exportBidDocx 恰一次 + busy 流转 + 成功提示", async () => {
    const { result } = await mountWithProject()
    await act(async () => {
      await result.current.exportBidWord()
    })
    expect(exports()).toEqual([{ fn: "exportBidDocx", projectId: "p1" }])
    expect(h.toasts.join("\n")).toContain("投标文件 Word 已导出")
    expect(result.current.exportBusy).toBe("")
  })

  it("导出投标文件：资质硬拦截（qual_hard_block=1 + 过期证书）→ 阻断、不导出", async () => {
    localStorage.setItem("qual_hard_block", "1")
    h.qualAlerts = [{ cert_name: "医疗器械经营许可证", bucket: "expired", valid_to: "2026-10-20" }]
    const { result } = await mountWithProject()
    await act(async () => {
      await result.current.exportBidWord()
    })
    expect(h.toasts.join("\n")).toContain("已阻断导出")
    expect(exports(), "资质硬拦截下仍调了导出器").toEqual([])
  })

  it("导出技术偏离表：无偏离表 → 给原因、不导出", async () => {
    const { result } = await mountWithProject()
    await act(async () => {
      await result.current.exportDeviationWord()
    })
    expect(h.toasts.join("\n")).toContain("还没有技术偏离表")
    expect(exports(), "无偏离表却调了导出器").toEqual([])
  })

  it("导出技术偏离表：有偏离表 → exportDeviationDocx 恰一次 + 提示", async () => {
    h.project.response_map = h.deviationTableRaw()
    const { result } = await mountWithProject()
    await act(async () => {
      await result.current.exportDeviationWord()
    })
    expect(exports()).toEqual([{ fn: "exportDeviationDocx", projectId: "p1" }])
    expect(h.toasts.join("\n")).toContain("技术偏离表 Word 已导出")
  })

  it("全套导出：交卷闸门未确认 → 给「还有 N 个」原因、零导出", async () => {
    const { result } = await mountWithProject()
    await act(async () => {
      await result.current.exportAllDocs()
    })
    expect(h.toasts.join("\n")).toContain("还有 5 个交卷闸门未确认")
    expect(exports(), "闸门未确认却调了导出器").toEqual([])
  })

  it("全套导出：五闸门全确认 → 按序导出已就绪五件（bid→deviation→parse→dup_void→eval）", async () => {
    h.project.stage_gates = h.allGatesConfirmed()
    h.project.response_map = h.deviationTableRaw()
    h.project.parse_report = { scope: "full", sections: [] }
    h.project.dup_report = { items: [] }
    h.project.void_check = { items: [{ clause: "不得出现废标情形" }] }
    h.project.ai_review = { items: [{ scoring_item: "项目理解", max_score: 40 }] }
    const { result } = await mountWithProject()
    await act(async () => {
      await result.current.exportAllDocs()
    })
    expect(exports()).toEqual([
      { fn: "exportBidDocx", projectId: "p1" },
      { fn: "exportDeviationDocx", projectId: "p1" },
      { fn: "exportReportDocx", kind: "parse", projectId: "p1" },
      { fn: "exportReportDocx", kind: "dup_void", projectId: "p1" },
      { fn: "exportReportDocx", kind: "eval", projectId: "p1" },
    ])
    expect(h.toasts.join("\n")).toContain("全套投标文档已导出")
  })
})

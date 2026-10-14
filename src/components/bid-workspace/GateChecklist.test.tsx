/** @vitest-environment jsdom */
/**
 * R42 · UI 回归网（第四张）：交卷闸门卡 GateChecklist
 *
 * 守的是「交卷前必须留痕」这条纪律 —— 它直接决定一套标书能不能导出：
 *  - 条件未满足**只能强制放行**，且备注必填（按钮 disabled 直到填了字），不能静默点过；
 *  - 条件满足可确认，备注可选；
 *  - 确认后必须看得见「已确认 / 强制放行」+ 时间 + 备注原文；重置要二次确认；
 *  - 废标检查还有 critical 未核销时必须出提示（只提示、不拦确认）；
 *  - 五闸门仅拦「全套导出」，卡面要明说单份文档随时可导（避免误以为整站锁死）。
 *
 * 「删掉实现即变红」：把「留痕放行」按钮的 disabled={!cond.met && !noteDraft.trim()} 去掉
 * → 第 6 条变红；把重置按钮直接接 resetGate（不走二次确认）→ 第 8/9 条变红。
 *
 * 环境：per-file `@vitest-environment jsdom`，不动全局 node 环境。
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { GateChecklist } from "./GateChecklist"
import type { GateKind } from "@/pages/BidWorkspace/bidTypes"

afterEach(cleanup)

type Props = Parameters<typeof GateChecklist>[0]

function record(gate: GateKind, over: Partial<{ confirmed_at: string; notes: string; forced: boolean }> = {}) {
  return { gate, confirmed_at: "2026-10-14T08:00:00.000Z", notes: "", forced: false, ...over }
}

/** 五闸门条件全不满足的项目 */
function project(over: Record<string, unknown> = {}) {
  return {
    stage_gates: { gates: [] as ReturnType<typeof record>[] },
    parse_report: null,
    bid_outline: [],
    bid_chapters: [],
    dup_report: null,
    void_check: null,
    submission_check: null,
    ai_review: null,
    ...over,
  } as unknown as NonNullable<Props["activeProject"]>
}

/** 五闸门条件全满足的项目 */
function projectAllMet(over: Record<string, unknown> = {}) {
  return project({
    parse_report: { summary: "x" },
    bid_outline: [{ id: "o1", title: "技术方案" }],
    bid_chapters: [{ id: "c1", title: "技术方案", content: "正文" }],
    dup_report: { items: [] },
    void_check: { items: [] },
    submission_check: { items: [{ id: "i1" }], format_report: { hits: [] } },
    ai_review: { summary: "x" },
    ...over,
  })
}

function setup(over: Partial<Props> = {}) {
  const confirmGate = vi.fn()
  const resetGate = vi.fn()
  const props = {
    activeProject: project(),
    confirmGate: confirmGate as unknown as Props["confirmGate"],
    resetGate: resetGate as unknown as Props["resetGate"],
    voidCriticalUnresolved: 0,
    ...over,
  } as Props
  render(<GateChecklist {...props} />)
  return { confirmGate, resetGate }
}

/** 取某个闸门所在的那一行 */
function row(label: string) {
  const el = screen.getByText(label).closest("li")
  if (!el) throw new Error(`找不到闸门行：${label}`)
  return within(el as HTMLElement)
}

describe("GateChecklist · 交卷闸门卡（留痕纪律回归网）", () => {
  it("1. 没有项目时不渲染", () => {
    setup({ activeProject: null })
    expect(screen.queryByText(/交卷闸门/)).toBeNull()
  })

  it("2. 初始：已确认 0/5，五道全是「强制放行」，并写明各自缺什么", () => {
    setup()
    expect(screen.getByText("已确认 0/5")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "强制放行" })).toHaveLength(5)
    expect(screen.getByText("还没有 AI 解析报告")).toBeInTheDocument()
    expect(screen.getByText("还没有确认过投标文件大纲")).toBeInTheDocument()
  })

  it("3. 条件满足的闸门给的是「确认闸门」而不是「强制放行」", () => {
    setup({ activeProject: project({ parse_report: { summary: "x" } }) })
    expect(row("招标解析").getByRole("button", { name: "确认闸门" })).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "强制放行" })).toHaveLength(4)
  })

  it("4. 条件满足时备注可选：不填也能确认（留痕为空）", () => {
    const { confirmGate } = setup({ activeProject: project({ parse_report: { summary: "x" } }) })
    fireEvent.click(row("招标解析").getByRole("button", { name: "确认闸门" }))
    const confirm = row("招标解析").getByRole("button", { name: "确认" })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    expect(confirmGate).toHaveBeenCalledWith("parse", "", false)
  })

  it("5. 条件满足时填了备注会一起留痕", () => {
    const { confirmGate } = setup({ activeProject: project({ parse_report: { summary: "x" } }) })
    fireEvent.click(row("招标解析").getByRole("button", { name: "确认闸门" }))
    fireEvent.change(row("招标解析").getByPlaceholderText(/备注（可选）/), {
      target: { value: "已核对评分办法" },
    })
    fireEvent.click(row("招标解析").getByRole("button", { name: "确认" }))
    expect(confirmGate).toHaveBeenCalledWith("parse", "已核对评分办法", false)
  })

  it("6. 未满足只能强制放行，且备注必填：空备注时按钮禁用，填了才放行", () => {
    const { confirmGate } = setup()
    fireEvent.click(row("大纲确认").getByRole("button", { name: "强制放行" }))
    const release = row("大纲确认").getByRole("button", { name: "留痕放行" })
    expect(release).toBeDisabled()
    fireEvent.change(row("大纲确认").getByPlaceholderText(/强制放行必须填写备注/), {
      target: { value: "客户口头确认按老版大纲" },
    })
    expect(release).toBeEnabled()
    fireEvent.click(release)
    expect(confirmGate).toHaveBeenCalledWith("outline", "客户口头确认按老版大纲", true)
  })

  it("7. 取消收起备注输入，不落任何值", () => {
    const { confirmGate } = setup()
    fireEvent.click(row("大纲确认").getByRole("button", { name: "强制放行" }))
    fireEvent.click(row("大纲确认").getByRole("button", { name: "取消" }))
    expect(confirmGate).not.toHaveBeenCalled()
    expect(row("大纲确认").getByRole("button", { name: "强制放行" })).toBeInTheDocument()
  })

  it("8. 已确认：显示徽标/备注原文/重置；重置要二次确认才真重置", () => {
    const { resetGate } = setup({
      activeProject: project({ stage_gates: { gates: [record("parse", { notes: "已核对评分办法" })] } }),
    })
    expect(screen.getByText("已确认 1/5")).toBeInTheDocument()
    expect(row("招标解析").getByText(/备注：已核对评分办法/)).toBeInTheDocument()
    fireEvent.click(row("招标解析").getByRole("button", { name: /重置/ }))
    expect(resetGate).not.toHaveBeenCalled()
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText("重置该闸门？")).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "重置" }))
    expect(resetGate).toHaveBeenCalledWith("parse")
  })

  it("9. 重置弹窗点取消 → 确认记录不动", () => {
    const { resetGate } = setup({
      activeProject: project({ stage_gates: { gates: [record("parse")] } }),
    })
    fireEvent.click(row("招标解析").getByRole("button", { name: /重置/ }))
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "取消" }))
    expect(resetGate).not.toHaveBeenCalled()
    expect(row("招标解析").getByText("已确认")).toBeInTheDocument()
  })

  it("10. 强制放行的记录要能一眼看出来（可追溯）", () => {
    setup({
      activeProject: project({
        stage_gates: { gates: [record("outline", { notes: "口头确认", forced: true })] },
      }),
    })
    expect(row("大纲确认").getByText("强制放行")).toBeInTheDocument()
    expect(row("大纲确认").getByText(/备注：口头确认/)).toBeInTheDocument()
  })

  it("11. 废标检查还有 critical 未核销 → 出提示（只提示、不拦确认）", () => {
    const { confirmGate } = setup({ voidCriticalUnresolved: 3 })
    expect(screen.getByText(/废标检查还有 3 条 critical 未核销/)).toBeInTheDocument()
    fireEvent.click(row("检查体检").getByRole("button", { name: "强制放行" }))
    fireEvent.change(row("检查体检").getByPlaceholderText(/强制放行必须填写备注/), {
      target: { value: "已人工核销完" },
    })
    fireEvent.click(row("检查体检").getByRole("button", { name: "留痕放行" }))
    expect(confirmGate).toHaveBeenCalledWith("check", "已人工核销完", true)
  })

  it("12. 五闸门齐全：徽标转 success，底部「仅拦全套导出」提示消失", () => {
    setup({
      activeProject: projectAllMet({
        stage_gates: {
          gates: [
            record("parse"),
            record("outline"),
            record("compose"),
            record("check"),
            record("eval"),
          ],
        },
      }),
    })
    expect(screen.getByText("已确认 5/5")).toBeInTheDocument()
    expect(screen.queryByText(/单份文档随时可导/)).toBeNull()
  })

  it("13. 未满五闸时必须说清楚「只拦全套导出」，别让人以为整站锁死", () => {
    setup()
    expect(screen.getByText(/单份文档随时可导/)).toBeInTheDocument()
  })

  it("14. 公司红线自查默认收起，展开后给出过程红线清单", () => {
    setup()
    expect(screen.queryByText(/串标五禁止/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /公司投标红线自查/ }))
    expect(screen.getByText(/串标五禁止/)).toBeInTheDocument()
  })
})

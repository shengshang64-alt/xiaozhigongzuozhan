/** @vitest-environment jsdom */
/**
 * R50（P0-3 长文可见性）UI 回归网：偏离表面板必须把「本次没看到」的行摆到人眼前。
 *
 * 守的是 P0-3 的存在理由——**不可见 ≠ 未响应**，但也绝不能在面板上静默通过：
 *  - 行级：整行淡黄底 + 响应程度列「待人工核对」角标（标题里写明为什么）；
 *  - 组级：分组头显示该组待核对条数；
 *  - 汇总级：统计卡出现「待人工核对」并给出核对指引；
 *  - 反噪音：没有待核对行时以上三处都不出现（否则天天亮黄会让人无视）。
 * 断的是可见性行为，不是「渲染不抛错」。
 */
import { afterEach, describe, expect, it, vi } from "vitest"

// 旁路依赖：技能选择器读 PocketBase 技能池，与本文件的可见性断言无关，直接置空
vi.mock("@/components/common/SkillPicker", () => ({ SkillPickerFor: () => null }))
import { cleanup, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { DeviationPanel } from "./DeviationPanel"
import type { DeviationRow, DeviationStats, DeviationTable } from "@/pages/BidWorkspace/bidTypes"

afterEach(cleanup)

const rowOf = (over: Partial<DeviationRow> = {}): DeviationRow =>
  ({
    clause_id: "c1",
    clause_text: "投标人须提供三年免费质保",
    source: "招标技术要求",
    response_node: "第五章 售后服务",
    response_level: "full",
    response_summary: "已承诺三年免费质保",
    bid_ref: "",
    ...over,
  }) as DeviationRow

function panel(rows: DeviationRow[], alignment?: DeviationTable["alignment"]) {
  const table = { split_dim: "system", rows, generated_at: "2026-10-15T00:00:00.000Z", ...(alignment ? { alignment } : {}) } as DeviationTable
  const st: DeviationStats = {
    total: rows.length,
    full: rows.filter((r) => r.response_level === "full").length,
    partial: rows.filter((r) => r.response_level === "partial").length,
    deviation: rows.filter((r) => r.response_level === "deviation").length,
    needs_review: rows.filter((r) => r.needs_review === true).length,
  }
  const props = {
    clauseGranularity: "system",
    setClauseGranularity: () => {},
    deviationClauseCount: rows.length,
    mapLoading: false,
    generateDeviationTable: () => {},
    deviationTable: table,
    deviationSummary: st,
    doneChapterCount: 3,
    jumpToResponseNode: () => {},
    exportDeviationWord: () => {},
    exportBusy: "",
    deviationSkills: {},
    techParamCoverage: { hasParams: false },
    addUncoveredTechParamsToOutline: () => {},
  } as unknown as Parameters<typeof DeviationPanel>[0]
  return render(<DeviationPanel {...props} />)
}

const INVISIBLE = rowOf({
  response_level: "partial",
  response_node: "未找到响应",
  response_summary: "本次注入范围内无可见证据，需人工核对未注入部分",
  needs_review: true,
})

describe("P0-3 §8 偏离表面板：待人工核对必须看得见", () => {
  it("待核对行：行内角标 + 分组计数 + 统计卡 + 顶部核对指引四处齐全", () => {
    panel([INVISIBLE, rowOf({ clause_id: "c2" })])
    // 行内角标 + 统计卡标签同名，故用 all 断言至少两处
    expect(screen.getAllByText("待人工核对").length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText("待人工核对 1 条")).toBeInTheDocument()
    expect(screen.getByText("待核对 1 条")).toBeInTheDocument()
  })

  it("角标带原因说明（title），不只给一个黄点", () => {
    panel([INVISIBLE, rowOf({ clause_id: "c2" })])
    expect(screen.getByTitle(/没有可定位的响应证据/)).toBeInTheDocument()
  })

  it("兜底口径在面板上可见：说明该条为何被判部分响应", () => {
    panel([INVISIBLE, rowOf({ clause_id: "c2" })])
    expect(screen.getByText("本次注入范围内无可见证据，需人工核对未注入部分")).toBeInTheDocument()
  })

  it("没有待核对行时不亮黄（反噪音）：角标 / 计数 / 指引全部不出现", () => {
    panel([rowOf({ response_level: "partial", response_summary: "已承诺两年质保" })])
    expect(screen.queryByText("待人工核对")).toBeNull()
    expect(screen.queryByText("待核对 1 条")).toBeNull()
    expect(screen.queryByTitle(/没有可定位的响应证据/)).toBeNull()
  })

  it("只提示不阻断：待核对行存在时导出按钮照常可用", () => {
    panel([INVISIBLE])
    expect(screen.getByRole("button", { name: /导出偏离表/ })).toBeEnabled()
  })
})

/**
 * R52（2026-10-15 用户裁定）：① 偏离表一定要原文响应；② 招标要求与响应材料一一对应、方便专家查。
 * 面板必须把这两条的结论摆出来，而不是让人自己数行数、自己去正文找原句。
 */
describe("R52 偏离表面板：原文响应 + 一一对应", () => {
  it("响应列渲染投标文件原文摘录（新口径 response_text），列名点明是原文", () => {
    panel([rowOf({ response_text: "我方承诺提供三年免费质保，质保期内 7×24 小时响应", response_summary: "" })])
    expect(screen.getByText("响应内容（投标文件原文）")).toBeInTheDocument()
    expect(screen.getByText("我方承诺提供三年免费质保，质保期内 7×24 小时响应")).toBeInTheDocument()
  })

  it("存量数据（只有 response_summary）仍渲染在同一列，不出现空列", () => {
    panel([rowOf({ response_summary: "已承诺三年质保" })])
    expect(screen.getByText("已承诺三年质保")).toBeInTheDocument()
  })

  it("非原文行给「非原文」角标并给改法说明（原文响应是硬要求）", () => {
    panel([rowOf({ response_text: "已按要求提供完善售后服务体系", not_verbatim: true })])
    expect(screen.getByText("非原文")).toBeInTheDocument()
    expect(screen.getByText(/非原文响应 1 条/)).toBeInTheDocument()
    expect(screen.getByTitle(/改回正文原句/)).toBeInTheDocument()
  })

  it("原文行不打非原文角标（反噪音）", () => {
    panel([rowOf({ response_text: "我方承诺提供三年免费质保", response_summary: "" })])
    expect(screen.queryByText("非原文")).toBeNull()
  })

  it("一一对应结论直接显示（招标要求 N 条 ↔ 响应 N 行）", () => {
    panel([rowOf(), rowOf({ clause_id: "c2" })], { clause_count: 2, row_count: 2, missing: [], duplicated: [] })
    expect(screen.getByText(/招标要求 2 条 ↔ 响应 2 行/)).toBeInTheDocument()
    expect(screen.getByText(/一一对应/)).toBeInTheDocument()
  })

  it("未完全对应时点名缺行 / 重复行（存量表无 alignment 字段则不显示，不猜）", () => {
    panel([rowOf(), rowOf()], { clause_count: 2, row_count: 2, missing: ["c2"], duplicated: ["c1"] })
    expect(screen.getByText(/未对上：缺 1 行 \/ 重复 1 行/)).toBeInTheDocument()
    cleanup()
    panel([rowOf()])
    expect(screen.queryByText(/条 ↔ 响应/)).toBeNull()
  })

  it("原文响应计数按「已核对」条数给出（待核对行不计入分母）", () => {
    panel([rowOf({ response_text: "我方承诺提供三年免费质保", response_summary: "" }), INVISIBLE])
    expect(screen.getByText(/原文响应 1\/1/)).toBeInTheDocument()
  })

  it("条款原编号优先展示，本表内部 id 退居其下（专家按原编号对回招标文件）", () => {
    panel([rowOf({ clause_no: "5.3.2", clause_id: "c12" })])
    expect(screen.getByText("5.3.2")).toBeInTheDocument()
    expect(screen.getByText("c12")).toBeInTheDocument()
  })
})

import { describe, expect, it } from "vitest"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"
import {
  archiveResultView,
  cardBarPercent,
  cardCtaLabel,
  cardFootTime,
  currentUxStep,
  draftCharCount,
  formatBudgetPhrase,
  parseBudgetToWan,
  stageBadgeClass,
  uxStepCaption,
} from "./bidListCardModel"

function proj(over: Partial<BidProjectRecord> = {}): BidProjectRecord {
  return {
    id: "p1",
    rh_user_id: "u",
    project_name: "测试项目",
    tender_no: "ZB-1",
    hospital: "市一院",
    bid_open_date: "",
    stage: "composing",
    tender_text: "招标正文",
    tender_files: [],
    parse_report: { scope: "key", sections: [{ key: "overview", title: "概览", content: "预算金额：286万", human_edited: false, status: "ok" }] },
    parse_config: null,
    bid_outline: [],
    bid_chapters: [],
    response_map: null,
    dup_report: null,
    void_check: null,
    ai_review: null,
    manual_review: null,
    opportunity_id: "",
    bid_result: "",
    bid_amount: null,
    lost_reason: "",
    result_synced_at: "",
    target_pages: null,
    outline_level: 0,
    figures_enabled: false,
    clause_granularity: "clause",
    section_words: null,
    gen_options: {} as BidProjectRecord["gen_options"],
    global_facts: "",
    orchestration: null,
    max_figures: null,
    compilation_basis_extra: null,
    basis_style: "",
    format_settings: null,
    format_check_items: [],
    ref_template_text: "",
    ref_materials_text: "",
    identity_words: "",
    bid_source_mode: "internal",
    bid_external_text: "",
    bid_defense: {} as BidProjectRecord["bid_defense"],
    submission_check: null,
    stage_gates: { gates: [] },
    archived: false,
    deleted_at: "",
    created: "2026-11-06 10:00:00",
    updated: "2026-11-09 09:42:00",
    ...over,
  } as BidProjectRecord
}

const stepDone = (step: number, rec: BidProjectRecord): boolean => {
  if (step === 1) return (rec.tender_text ?? "").trim().length > 0
  if (step === 2) return !!rec.parse_report
  if (step === 3) return rec.bid_chapters.some((c) => (c.content ?? "").trim().length > 0)
  if (step === 4) return !!rec.dup_report
  if (step === 5) return !!rec.void_check
  if (step === 6) return !!rec.ai_review
  if (step === 7) return rec.stage === "archived"
  return false
}

describe("parseBudgetToWan / formatBudgetPhrase", () => {
  it("有预算金额则显示 X.X 万，没有则省略", () => {
    expect(parseBudgetToWan("286万")).toBe(286)
    expect(parseBudgetToWan("1,680,000元")).toBe(168)
    expect(parseBudgetToWan("")).toBeNull()
    expect(formatBudgetPhrase(proj())).toBe("预算 286.0 万")
    expect(formatBudgetPhrase(proj({ parse_report: null }))).toBeNull()
  })
})

describe("ux step + CTA", () => {
  it("无大纲时当前步为 ③ 大纲编制，CTA 去确认大纲", () => {
    const rec = proj({ bid_outline: [], bid_chapters: [] })
    expect(uxStepCaption(rec, stepDone)).toBe("③ 大纲编制")
    expect(cardCtaLabel(rec, stepDone)).toBe("去确认大纲 →")
    expect(currentUxStep(rec, stepDone)).toBe(3)
  })

  it("有大纲且已写正文时当前步为 ④ 正文编写，CTA 继续编写", () => {
    const rec = proj({
      bid_outline: [{ id: "n1", title: "第一章", children: [] }],
      bid_chapters: [{ node_id: "c1", title: "第一章", content: "正文一段", sections: [], gen_status: "done" } as BidProjectRecord["bid_chapters"][number]],
    })
    expect(uxStepCaption(rec, stepDone)).toBe("④ 正文编写")
    expect(cardCtaLabel(rec, stepDone)).toBe("继续编写 →")
  })

  it("已开标且结果待回填时 CTA 为回填结果", () => {
    const rec = proj({ bid_open_date: "2000-01-01", bid_result: "pending" })
    expect(cardCtaLabel(rec, stepDone)).toBe("回填结果 →")
  })
})

describe("cardFootTime / draftCharCount / badges", () => {
  it("今天的 updated 显示最近编辑时分", () => {
    const now = new Date(2026, 10, 9, 12, 0, 0) // month is 0-indexed: 10 = Nov
    expect(cardFootTime(proj({ updated: "2026-11-09 09:42:00" }), "继续编写 →", now)).toBe("最近编辑 09:42")
  })

  it("回填 CTA 优先开标日", () => {
    expect(cardFootTime(proj({ bid_open_date: "2026-11-04" }), "回填结果 →")).toBe("开标 11-04")
  })

  it("字数只统计正文真源", () => {
    expect(draftCharCount(proj())).toBe(0)
    expect(draftCharCount(proj({ bid_chapters: [{ content: "甲乙丙丁 戊" } as BidProjectRecord["bid_chapters"][number]] }))).toBe(5)
  })

  it("阶段色：编制中蓝 / 大纲待确认琥珀 / 已评标紫", () => {
    expect(stageBadgeClass("编制中", "composing")).toContain("sky")
    expect(stageBadgeClass("大纲待确认", "composing")).toContain("amber")
    expect(stageBadgeClass("已评标", "evaluated")).toContain("violet")
  })

  it("归档结果徽标：中标/未中标/废标/待回填", () => {
    expect(archiveResultView({ bid_result: "won", lost_reason: "" }).text).toBe("中标")
    expect(archiveResultView({ bid_result: "lost", lost_reason: "价格偏高" }).text).toBe("未中标")
    expect(archiveResultView({ bid_result: "lost", lost_reason: "【废标】资格不符" }).tone).toBe("gray")
    expect(archiveResultView({ bid_result: "", lost_reason: "" }).text).toBe("待回填")
  })

  it("进度条在无章节时按完成步数/7", () => {
    expect(cardBarPercent({ done: 0, total: 0 }, 2, true)).toEqual({ pct: 29, amber: true })
    expect(cardBarPercent({ done: 11, total: 11 }, 7, false)).toEqual({ pct: 100, amber: false })
  })
})

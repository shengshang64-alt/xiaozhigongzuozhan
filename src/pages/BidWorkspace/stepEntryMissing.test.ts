// 2026-11-14：按 UX-v2 新七步重写步骤准入
import { describe, expect, it } from "vitest"
import {
  emptyStageGates,
  stepEntryMissing,
  submissionGatesConfirmed,
  submissionGatesUnconfirmedCount,
  type ParseReport,
} from "./bidTypes"

const chapter = (content: string) => ({
  node_id: "c1",
  title: "技术方案",
  sections: [] as string[],
  content,
  gen_status: content.trim() ? ("done" as const) : ("pending" as const),
})

function reportOk(): ParseReport {
  const keys = [
    "overview",
    "tech_score",
    "project_info",
    "purchaser_info",
    "delivery_req",
    "response_req",
    "qualification",
    "compliance",
    "void_items",
    "biz_score",
    "bid_outline_req",
  ]
  return { scope: "full", sections: keys.map((key) => ({ key, title: key, content: "有内容".repeat(5) })) } as unknown as ParseReport
}

describe("stepEntryMissing 新七步准入", () => {
  it("无项目时不允许跳到第 2 步及以后", () => {
    expect(stepEntryMissing(1, null)).toBe("")
    expect(stepEntryMissing(4, null)).toContain("打开一个投标项目")
  })

  it("第 2 步需要招标文本，文案指向解析确认", () => {
    expect(stepEntryMissing(2, { tender_text: "" })).toContain("导入招标")
    expect(stepEntryMissing(2, { tender_text: "招标正文" })).toBe("")
  })

  it("第 4 步只要求已确认大纲（有章节清单即可，不要求已经有正文）", () => {
    expect(stepEntryMissing(4, { parse_report: reportOk(), bid_chapters: [chapter("")] })).toBe("")
    expect(stepEntryMissing(4, { parse_report: reportOk(), bid_chapters: [] })).toContain("确认大纲")
  })

  it("第 5 步需要至少 1 章正文，文案指向偏离表而不是检查环节", () => {
    expect(stepEntryMissing(5, { bid_chapters: [chapter("")] })).toContain("偏离表")
    expect(stepEntryMissing(5, { bid_chapters: [chapter("已完成的正文章节")] })).toBe("")
  })

  it("第 6 步有正文即可进入，不必先有查重或废标报告", () => {
    expect(stepEntryMissing(6, { bid_chapters: [chapter("已完成的正文章节")] })).toBe("")
    expect(stepEntryMissing(6, { bid_chapters: [chapter("")], dup_report: undefined, void_check: undefined })).toContain("交卷自查")
  })

  it("第 6 步仅有偏离表也可以进入", () => {
    const proj = {
      bid_chapters: [],
      response_map: {
        split_dim: "system",
        generated_at: "2026-11-14T00:00:00.000Z",
        rows: [{ clause_text: "支持国产数据库", response_level: "full" }],
      },
    }
    expect(stepEntryMissing(6, proj)).toBe("")
    expect(stepEntryMissing(7, proj)).toBe("")
  })
})

describe("交卷闸门不含模拟评标", () => {
  it("四道交卷闸门齐了即可，缺 eval 不算未确认", () => {
    const gates = {
      gates: (["parse", "outline", "compose", "check"] as const).map((gate) => ({
        gate,
        confirmed_at: "2026-11-14T00:00:00.000Z",
        notes: "",
        forced: false,
      })),
    }
    expect(submissionGatesConfirmed(gates)).toBe(true)
    expect(submissionGatesUnconfirmedCount(gates)).toBe(0)
    expect(submissionGatesConfirmed(emptyStageGates())).toBe(false)
  })
})

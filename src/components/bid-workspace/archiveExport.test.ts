import { describe, expect, it } from "vitest"
import { archiveCardGuidance, type ArchiveExportKey, type ArchiveProjLite } from "./archiveExport"
import { PIPELINE_STEPS } from "@/pages/BidWorkspace/bidTypes"

const empty: ArchiveProjLite = {
  bid_chapters: [],
  response_map: null,
  parse_report: null,
  dup_report: null,
  void_check: null,
  ai_review: null,
}
const label = (s: number) => PIPELINE_STEPS.find((x) => x.step === s)?.label ?? ""
const KEYS: ArchiveExportKey[] = ["bid", "deviation", "parse", "check", "eval"]

describe("archiveCardGuidance", () => {
  it("全空项目：五张导出卡均未就绪", () => {
    for (const k of KEYS) expect(archiveCardGuidance(k, empty).ready).toBe(false)
  })

  it("bid：任一章节有非空正文才就绪，出路指向第 3 步且步骤名取自流程条", () => {
    expect(archiveCardGuidance("bid", { ...empty, bid_chapters: [{ content: "   " }] }).ready).toBe(false)
    const g = archiveCardGuidance("bid", { ...empty, bid_chapters: [{ content: "正文内容" }] })
    expect(g.ready).toBe(true)
    expect(g.step).toBe(3)
    expect(g.goLabel).toBe(label(3))
    expect(g.missingHint).toContain("投标文件编制")
  })

  it("deviation：偏离表有行才就绪，出路指向第 3 步", () => {
    expect(archiveCardGuidance("deviation", { ...empty, response_map: { rows: [] } }).ready).toBe(false)
    const g = archiveCardGuidance("deviation", { ...empty, response_map: { rows: [{ x: 1 }] } })
    expect(g.ready).toBe(true)
    expect(g.step).toBe(3)
  })

  it("parse → 第 2 步；check（查重或废标任一命中即就绪）→ 第 4 步；eval → 第 6 步", () => {
    const parse = archiveCardGuidance("parse", { ...empty, parse_report: {} })
    expect(parse.ready).toBe(true)
    expect(parse.step).toBe(2)

    expect(archiveCardGuidance("check", { ...empty, dup_report: {} }).ready).toBe(true)
    expect(archiveCardGuidance("check", { ...empty, void_check: {} }).ready).toBe(true)
    expect(archiveCardGuidance("check", empty).ready).toBe(false)
    expect(archiveCardGuidance("check", { ...empty, dup_report: {} }).step).toBe(4)

    const evalg = archiveCardGuidance("eval", { ...empty, ai_review: {} })
    expect(evalg.ready).toBe(true)
    expect(evalg.step).toBe(6)
    expect(evalg.missingHint).toContain("模拟评标")
  })

  it("每张未就绪卡的 goLabel 都等于对应步骤在流程条中的真实名称（不漂移）", () => {
    for (const k of KEYS) {
      const g = archiveCardGuidance(k, empty)
      expect(g.goLabel).toBe(label(g.step))
      expect(g.missingHint.length).toBeGreaterThan(4)
    }
  })
})

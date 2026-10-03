// Author: loop-R121
// deckLint 此前 0 独立单测。本轮新增 missing_title / duplicate_title 两条自检规则，
// 并补齐既有 6 条规则的回归用例，锁定导出前自检行为。
import { describe, expect, it } from "vitest"

import { lintDeck, lintSummaryText, type DeckLintIssue } from "./deckLint"
import type { Slide } from "./pptQuoteTypes"

function mk(over: Partial<Slide> = {}): Slide {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: over.title ?? "",
    bullets: over.bullets ?? [],
    notes: over.notes ?? "",
    ...over,
  }
}

const find = (issues: DeckLintIssue[], code: string) => issues.find((i) => i.code === code)

describe("lintDeck", () => {
  it("returns empty for an empty deck", () => {
    expect(lintDeck([])).toEqual([])
  })

  it("flags an empty content page", () => {
    const issues = lintDeck([mk({ title: "有内容的页", bullets: ["要点一二"] }), mk({})])
    const empty = find(issues, "empty_page")
    expect(empty).toBeTruthy()
    expect(empty?.page).toBe(2)
  })

  it("does not flag an empty section divider page", () => {
    const issues = lintDeck([mk({ title: "第一章", bullets: ["x"], layout: "section" }), mk({ layout: "section" })])
    expect(find(issues, "empty_page")).toBeFalsy()
  })

  it("flags too many bullets", () => {
    const bullets = Array.from({ length: 7 }, (_, i) => `要点${i + 1}`)
    expect(find(lintDeck([mk({ title: "标题结论句", bullets })]), "too_many_bullets")).toBeTruthy()
  })

  it("flags an overlong single bullet", () => {
    const long = "这".repeat(45)
    const issues = lintDeck([mk({ title: "标题结论句", bullets: [long] })])
    const lb = find(issues, "long_bullet")
    expect(lb).toBeTruthy()
    expect(lb?.level).toBe("info")
  })

  it("flags chart data length mismatched with categories", () => {
    const slide = mk({
      title: "季度营收对比走势",
      chart: { type: "bar", categories: ["Q1", "Q2", "Q3"], series: [{ name: "营收", data: [1, 2] }] } as Slide["chart"],
    })
    expect(find(lintDeck([slide]), "chart_len_mismatch")).toBeTruthy()
  })

  it("flags a noun-label title", () => {
    expect(find(lintDeck([mk({ title: "项目背景", bullets: ["内容"] })]), "noun_title")).toBeTruthy()
  })

  it("flags a whole deck without any visual page", () => {
    const deck = Array.from({ length: 4 }, () => mk({ title: "唯一的结论句标题", bullets: ["要点"] }))
    expect(find(lintDeck(deck), "no_visual")).toBeTruthy()
  })

  it("flags a long whole-text deck without any image page", () => {
    const deck = Array.from({ length: 6 }, (_, i) =>
      mk({ title: `结论标题${i}`, bullets: ["要点"], chart: { type: "bar", categories: ["a"], series: [{ data: [1] }] } as Slide["chart"] }),
    )
    expect(find(lintDeck(deck), "no_image")).toBeTruthy()
  })

  it("deduplicates and caps output at 6 issues", () => {
    const deck = Array.from({ length: 12 }, () => mk({ title: "标题", bullets: Array.from({ length: 8 }, (_, i) => `${i}`) }))
    expect(lintDeck(deck).length).toBeLessThanOrEqual(6)
  })

  // ---- R121 new rules ----
  it("R121: flags a content page missing a title", () => {
    const issues = lintDeck([mk({ title: "", bullets: ["有正文却没有标题"] })])
    const mt = find(issues, "missing_title")
    expect(mt).toBeTruthy()
    expect(mt?.level).toBe("info")
    expect(mt?.page).toBe(1)
  })

  it("R121: does not flag missing title on a section page", () => {
    expect(find(lintDeck([mk({ title: "", bullets: ["章节内容"], layout: "section" })]), "missing_title")).toBeFalsy()
  })

  it("R121: does not flag missing title on a truly empty page (empty_page wins)", () => {
    const issues = lintDeck([mk({})])
    expect(find(issues, "missing_title")).toBeFalsy()
    expect(find(issues, "empty_page")).toBeTruthy()
  })

  it("R121: flags duplicate titles across content pages", () => {
    const deck = [mk({ id: "a", title: "整体解决方案", bullets: ["x"] }), mk({ id: "b", title: "另一页", bullets: ["y"] }), mk({ id: "c", title: "整体解决方案", bullets: ["z"] })]
    const dup = find(lintDeck(deck), "duplicate_title")
    expect(dup).toBeTruthy()
    expect(dup?.level).toBe("warn")
    expect(dup?.page).toBe(3)
    expect(dup?.msg).toContain("1、3")
  })

  it("R121: duplicate detection normalizes case and inner whitespace", () => {
    const deck = [mk({ title: "Overview  Report", bullets: ["x"] }), mk({ title: "overview report ", bullets: ["y"] })]
    expect(find(lintDeck(deck), "duplicate_title")).toBeTruthy()
  })

  it("R121: does not treat section pages or empty titles as duplicates", () => {
    const deck = [mk({ title: "", bullets: ["x"] }), mk({ title: "章节", layout: "section" }), mk({ title: "章节", layout: "section" })]
    expect(find(lintDeck(deck), "duplicate_title")).toBeFalsy()
  })

  it("R121: unique titles produce no duplicate issue", () => {
    const deck = [mk({ title: "结论A句", bullets: ["x"] }), mk({ title: "结论B句", bullets: ["y"] })]
    expect(find(lintDeck(deck), "duplicate_title")).toBeFalsy()
  })
})

describe("lintSummaryText", () => {
  it("counts warn and info separately", () => {
    const issues: DeckLintIssue[] = [
      { level: "warn", page: 1, code: "a", msg: "" },
      { level: "info", page: 2, code: "b", msg: "" },
      { level: "info", page: 3, code: "c", msg: "" },
    ]
    expect(lintSummaryText(issues)).toBe("1 处需注意，2 处可优化")
  })

  it("returns the all-clear message for an empty list", () => {
    expect(lintSummaryText([])).toBe("未发现结构问题")
  })
})

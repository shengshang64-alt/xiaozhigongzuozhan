// Author: loop-R121
// deckLint 此前 0 独立单测。本轮新增 missing_title / duplicate_title 两条自检规则，
// 并补齐既有 6 条规则的回归用例，锁定导出前自检行为。
import { describe, expect, it } from "vitest"

import { findPlaceholderLeftovers, groupIssuesByPage, lintDeck, lintSummaryText, type DeckLintIssue } from "./deckLint"
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

  // ---- R277 模板/占位残留检测 ----
  it("R277: flags XX-style redaction leftover in a bullet", () => {
    const issues = lintDeck([mk({ title: "建设目标", bullets: ["为XX医院部署一体化平台"] })])
    const pl = find(issues, "placeholder_leftover")
    expect(pl).toBeTruthy()
    expect(pl?.level).toBe("warn")
    expect(pl?.page).toBe(1)
    expect(pl?.msg).toContain("XX")
  })

  it("R277: flags 待补充 keyword leftover", () => {
    expect(find(lintDeck([mk({ title: "实施方案", bullets: ["具体里程碑待补充"] })]), "placeholder_leftover")).toBeTruthy()
  })

  it("R277: flags double-brace template variable leftover", () => {
    expect(find(lintDeck([mk({ title: "{{项目名称}}建设方案", bullets: ["要点"] })]), "placeholder_leftover")).toBeTruthy()
  })

  it("R277: scans speaker notes too", () => {
    const issues = lintDeck([mk({ title: "总结页", bullets: ["已完成要点"], notes: "此处填写讲稿" })])
    expect(find(issues, "placeholder_leftover")).toBeTruthy()
  })

  it("R277: clean content produces no placeholder issue", () => {
    const issues = lintDeck([mk({ title: "三院区统一云平台方案", bullets: ["年门诊量180万人次"] })])
    expect(find(issues, "placeholder_leftover")).toBeFalsy()
  })

  it("R277: placeholder warning is prioritized ahead of structural warns when capped", () => {
    const deck = Array.from({ length: 12 }, (_, i) =>
      mk({ title: `结论${i}`, bullets: Array.from({ length: 8 }, (_, n) => `要${n}`) }),
    )
    deck[8] = mk({ title: "第9页结论", bullets: ["为XX医院部署"] })
    const issues = lintDeck(deck)
    expect(issues.length).toBeLessThanOrEqual(6)
    expect(find(issues, "placeholder_leftover")).toBeTruthy()
  })
})

describe("findPlaceholderLeftovers", () => {
  it("命中 XX 打码、待补充关键词、双花括号变量", () => {
    expect(findPlaceholderLeftovers("XX医院")).toContain("XX")
    expect(findPlaceholderLeftovers("内容待补充")).toContain("待补充")
    expect(findPlaceholderLeftovers("{{公司名称}}").length).toBeGreaterThan(0)
  })

  it("正常内容不误报、返回空数组", () => {
    expect(findPlaceholderLeftovers("三院区统一云平台")).toEqual([])
    expect(findPlaceholderLeftovers("")).toEqual([])
  })

  it("同一关键词多页重复出现只回一条（去重）", () => {
    expect(findPlaceholderLeftovers("待补充待补充").length).toBe(1)
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
describe("groupIssuesByPage（R166 编辑期常驻自检的页级聚合）", () => {
  it("同页 warn 优先于 info，页码原样保留", () => {
    const issues: DeckLintIssue[] = [
      { level: "info", page: 1, code: "long_bullet", msg: "" },
      { level: "warn", page: 1, code: "too_many_bullets", msg: "" },
      { level: "info", page: 2, code: "noun_title", msg: "" },
    ]
    const m = groupIssuesByPage(issues)
    expect(m.get(1)).toBe("warn")
    expect(m.get(2)).toBe("info")
    expect(m.size).toBe(2)
  })

  it("整份级问题聚合到 page 0", () => {
    const m = groupIssuesByPage([{ level: "warn", page: 0, code: "no_visual", msg: "" }])
    expect(m.get(0)).toBe("warn")
    expect(m.size).toBe(1)
  })

  it("空清单聚合为空 Map", () => {
    expect(groupIssuesByPage([]).size).toBe(0)
  })
})

// R56（2026-10-15 用户反馈「PPT 不能画图」实测驱动）：结构化图示覆盖按比例自检。
// 实测触发场景：真实 deck 7 页里只有 1 页带架构图——旧规则只在 visualPages===0 时报，
// 这种"有图但极少"的状况既不提示也不修，用户体感就是"不能画图"。
describe("lintDeck · 结构化图示覆盖不足（R56）", () => {
  const fig = (title: string): Slide =>
    mk({
      title,
      bullets: ["要点"],
      figures: [{ type: "architecture", title: "系统架构", layers: [{ name: "接入层", modules: ["网关"] }] } as NonNullable<Slide["figures"]>[number]],
    })

  it("7 页仅 1 页带结构图 → 报 few_figures（真实 deck 的形状）", () => {
    const deck = [
      fig("一体化平台消除数据孤岛"),
      ...Array.from({ length: 6 }, (_, i) => mk({ title: `结论${i}`, bullets: ["要点一二"] })),
    ]
    const hit = find(lintDeck(deck), "few_figures")
    expect(hit?.level).toBe("warn")
    expect(hit?.msg).toContain("1 页带结构图")
  })

  it("覆盖达标（4 页 2 图 = 1/3）不报；少于 4 页不参与判定", () => {
    const ok = [fig("架构"), fig("流程"), mk({ title: "结论一", bullets: ["要点"] }), mk({ title: "结论二", bullets: ["要点"] })]
    expect(find(lintDeck(ok), "few_figures")).toBeUndefined()
    const tiny = [fig("架构"), mk({ title: "结论", bullets: ["要点"] })]
    expect(find(lintDeck(tiny), "few_figures")).toBeUndefined()
  })

  it("chart/kpi 不计入图示覆盖（口径分开：那两类是数据可视与找图，另有规则）", () => {
    const deck = [
      mk({ title: "营收", bullets: ["要点"], chart: { type: "bar", categories: ["Q1"], series: [{ data: [1] }] } as Slide["chart"] }),
      mk({ title: "指标", bullets: ["要点"], kpi: [{ label: "覆盖", value: "12" }] as Slide["kpi"] }),
      mk({ title: "结论一", bullets: ["要点"] }),
      mk({ title: "结论二", bullets: ["要点"] }),
    ]
    expect(find(lintDeck(deck), "few_figures")).toBeTruthy()
  })
})

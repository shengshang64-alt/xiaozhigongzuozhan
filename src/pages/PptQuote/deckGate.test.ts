import { describe, expect, it } from "vitest"
import { gateExport, lintDeck, groupIssuesByPage, lintSummaryText } from "./deckLint"
import type { Slide } from "./pptQuoteTypes"

// ---------------------------------------------------------------------------
// 阶段 4 验收测试：导出质量门禁
//
// 对应需求（用户第 6 条 + 七、质量门禁）：
//   · lintDeck 发现严重问题时不得直接导出，必须支持定位、修复和重新检查
//   · 严重问题包括：空页面、占位符、XX医院、数据无来源、图表数据不匹配
//   · 严重问题必须阻止导出，并显示「页码 + 问题 + 修复按钮」
// ---------------------------------------------------------------------------

function mk(p: Partial<Slide> & { title: string }): Slide {
  return { id: p.title, bullets: p.bullets ?? [], notes: p.notes ?? "", ...p }
}

describe("lintDeck：严重问题升级为 error", () => {
  it("空白页 → error", () => {
    const issues = lintDeck([mk({ title: "有内容", bullets: ["要点"] }), mk({ title: "空页", bullets: [] })])
    const hit = issues.find((i) => i.code === "empty_page")
    expect(hit).toBeTruthy()
    expect(hit!.level).toBe("error")
    expect(hit!.page).toBe(2)
  })

  it("占位符残留（XX医院 / 待补充）→ error", () => {
    const issues = lintDeck([mk({ title: "XX医院信息化建设方案", bullets: ["待补充：投资额"] })])
    const hit = issues.find((i) => i.code === "placeholder_leftover")
    expect(hit).toBeTruthy()
    expect(hit!.level).toBe("error")
    expect(hit!.msg).toContain("必须替换")
  })

  it("图表数据点数与类目数不一致 → error", () => {
    const issues = lintDeck([
      mk({
        title: "指标趋势",
        chart: { type: "bar", title: "t", categories: ["a", "b", "c"], series: [{ name: "s", data: [1, 2] }] },
      }),
    ])
    const hit = issues.find((i) => i.code === "chart_len_mismatch")
    expect(hit).toBeTruthy()
    expect(hit!.level).toBe("error")
  })

  it("一般问题仍是 warn/info（不误伤）", () => {
    const issues = lintDeck([mk({ title: "方案概述", bullets: ["a", "b"] })])
    expect(issues.every((i) => i.level !== "error")).toBe(true)
  })
})

describe("gateExport：阻断语义", () => {
  it("有 error → 拦截，并给出页码与摘要", () => {
    const slides = [
      mk({ title: "正常的页", bullets: ["要点一", "要点二"] }),
      mk({ title: "空页", bullets: [] }),
    ]
    const r = gateExport(slides)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.blocking.length).toBeGreaterThan(0)
      expect(r.blocking.some((i) => i.page === 2)).toBe(true)
      expect(r.summary).toContain("必须")
      expect(r.summary).toContain("第 2 页")
    }
  })

  it("只有 warn/info → 放行", () => {
    const slides = [mk({ title: "方案概述", bullets: ["a", "b"] })]
    const r = gateExport(slides)
    expect(r.ok).toBe(true)
  })

  it("可附加外部错误（如模板版式缺失）并参与阻断", () => {
    const slides = [mk({ title: "正常页", bullets: ["a", "b"] })]
    const r = gateExport(slides, [
      { level: "error", page: 1, code: "missing_template_layout", msg: "第 1 页在模板里没有找到对应版式" },
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.blocking[0].code).toBe("missing_template_layout")
  })

  it("阻断清单按页码排序，便于逐页修", () => {
    const slides = [
      mk({ title: "空1", bullets: [] }),
      mk({ title: "正常", bullets: ["a", "b"] }),
      mk({ title: "空3", bullets: [] }),
    ]
    const r = gateExport(slides)
    if (!r.ok) {
      const pages = r.blocking.map((i) => i.page)
      expect(pages).toEqual([...pages].sort((a, b) => a - b))
    }
  })
})

describe("辅助函数：级别聚合与摘要", () => {
  it("groupIssuesByPage 优先取最高级别（error > warn > info）", () => {
    const byPage = groupIssuesByPage([
      { level: "info", page: 1, code: "a", msg: "" },
      { level: "error", page: 1, code: "b", msg: "" },
      { level: "warn", page: 2, code: "c", msg: "" },
    ])
    expect(byPage.get(1)).toBe("error")
    expect(byPage.get(2)).toBe("warn")
  })

  it("lintSummaryText 把 error 单独报出来", () => {
    const s = lintSummaryText([
      { level: "error", page: 1, code: "a", msg: "" },
      { level: "warn", page: 2, code: "b", msg: "" },
      { level: "info", page: 3, code: "c", msg: "" },
    ])
    expect(s).toContain("必须修复")
    expect(s).toContain("需注意")
    expect(s).toContain("可优化")
  })
})

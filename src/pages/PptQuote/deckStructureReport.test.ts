// ---------------------------------------------------------------------------
// 结构自检报告单测（2026-11-04，E 项）
//
// 钉住：空页能报、声明要画图却没画的能报、纯文字比例的边界准确，
// 且摘要是一句**人能读懂**的话（不是英文错误码、不是一堆字段名）。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import type { Slide } from "./pptQuoteTypes"
import { buildStructureReport, reportToastLine } from "./deckStructureReport"

function slide(title: string, extra: Partial<Slide> = {}): Slide {
  return { id: title, title, bullets: [], notes: "", ...extra }
}

function textSlide(title: string, n = 3): Slide {
  return slide(title, { bullets: Array.from({ length: n }, (_, i) => `要点${i + 1}`) })
}

function archSlide(title: string): Slide {
  return slide(title, {
    kind: "architecture",
    figures: [
      {
        type: "architecture",
        title,
        layers: [
          { name: "业务层", modules: ["HIS", "EMR"] },
          { name: "数据层", modules: ["数据仓", "主索引"] },
        ],
      },
    ],
  })
}

function flowSlide(title: string): Slide {
  return slide(title, {
    kind: "flow",
    figures: [{ type: "flow", title, steps: [{ name: "一期" }, { name: "二期" }, { name: "三期" }] }],
  })
}

function kpiSlide(title: string): Slide {
  return slide(title, { kind: "kpi", kpi: [{ value: "5级", label: "电子病历" }, { value: "3级", label: "智慧服务" }] })
}

describe("buildStructureReport · 空页与缺图", () => {
  it("空页被报出来并附带页码", () => {
    const r = buildStructureReport([slide("封面"), slide("空页"), textSlide("有内容页"), slide("致谢")])
    expect(r.emptyPages).toEqual([2])
    expect(r.ok).toBe(false)
    expect(r.detailLines.join("\n")).toContain("空白页")
  })

  it("声明 kind=architecture 却没画图 → 进 noFigurePages", () => {
    const r = buildStructureReport([slide("封面"), slide("平台架构", { kind: "architecture", bullets: ["层A", "层B"] }), slide("致谢")])
    expect(r.noFigurePages).toEqual([2])
    expect(r.summaryLine).toContain("缺图示")
  })

  it("声明 kind=flow/table 同理；有 figures 的不算缺", () => {
    const r = buildStructureReport([slide("封面"), flowSlide("分期路径"), archSlide("总体架构"), slide("致谢")])
    expect(r.noFigurePages).toEqual([])
    expect(r.figurePages).toBe(2)
  })

  it("空页判定不含 section 章节过渡页（本来就只有大字标题）", () => {
    const r = buildStructureReport([slide("封面"), slide("第一部分", { layout: "section" }), textSlide("内容"), slide("致谢")])
    expect(r.emptyPages).toEqual([])
  })
})

describe("buildStructureReport · 纯文字比例", () => {
  function deckWithTextOnly(textCount: number, totalContent = 6): Slide[] {
    return [
      slide("封面"),
      ...Array.from({ length: textCount }, (_, i) => textSlide(`文字页${i}`)),
      ...Array.from({ length: Math.max(0, totalContent - textCount) }, (_, i) => archSlide(`架构页${i}`)),
      slide("致谢"),
    ]
  }

  it("纯文字 2/6 → 比例 33%，超过 30% 判不达标", () => {
    const r = buildStructureReport(deckWithTextOnly(2, 6))
    expect(r.textOnlyPages).toBe(2)
    expect(r.textOnlyRatio).toBeCloseTo(1 / 3, 5)
    expect(r.missingQuota.join()).toContain("纯文字")
    expect(r.ok).toBe(false)
  })

  it("纯文字 1/6 → 比例 17%，达标", () => {
    const r = buildStructureReport(deckWithTextOnly(1, 6))
    expect(r.textOnlyRatio).toBeLessThan(0.3)
    expect(r.missingQuota.join()).not.toContain("纯文字")
  })
})

describe("buildStructureReport · 页型配额", () => {
  it("全是文字页的大册：架构/流程/对照全缺，逐条写清", () => {
    const r = buildStructureReport([slide("封面"), ...Array.from({ length: 8 }, (_, i) => textSlide(`页${i}`)), slide("致谢")])
    expect(r.missingQuota.join()).toContain("架构")
    expect(r.missingQuota.join()).toContain("流程")
    expect(r.missingQuota.join()).toContain("KPI/对照")
  })

  it("架构+流程+KPI 齐全的 10 页册：配额项不再出现在 missingQuota", () => {
    const r = buildStructureReport([
      slide("封面"),
      archSlide("总体架构"),
      flowSlide("分期路径"),
      kpiSlide("关键指标"),
      textSlide("现状1"),
      textSlide("现状2"),
      textSlide("保障1"),
      textSlide("保障2"),
      slide("致谢"),
    ])
    const missing = r.missingQuota.join()
    expect(missing).not.toContain("架构")
    expect(missing).not.toContain("流程")
    expect(missing).not.toContain("KPI/对照")
    // 8 内容页里 4 页纯文字 = 50% > 30% → 仍会有纯文字项
    expect(missing).toContain("纯文字")
  })

  it("小册子（3 页）不套用大册配额，不产生无意义的缺页告警", () => {
    const r = buildStructureReport([slide("封面"), textSlide("内容"), slide("致谢")])
    expect(r.missingQuota).toEqual([])
    expect(r.ok).toBe(true)
  })

  it("kinds 分布统计正确（含 iconGrid 等图示类型）", () => {
    const r = buildStructureReport([
      slide("封面"),
      archSlide("架构"),
      slide("矩阵", { figures: [{ type: "iconGrid", title: "t", items: [{ label: "a" }, { label: "b" }, { label: "c" }] }] }),
      slide("致谢"),
    ])
    expect(r.kinds.architecture).toBe(1)
    expect(r.kinds.iconGrid).toBe(1)
    expect(r.kinds.cover).toBe(1)
  })
})

describe("summaryLine / reportToastLine · 人话", () => {
  it("摘要非空、含关键数字、不含英文错误码", () => {
    const r = buildStructureReport([slide("封面"), textSlide("a"), textSlide("b"), textSlide("c"), slide("致谢")])
    expect(r.summaryLine.length).toBeGreaterThan(0)
    expect(r.summaryLine).toContain("纯文字")
    expect(r.summaryLine).not.toMatch(/undefined|null|Error/)
    expect(r.summaryLine.length).toBeLessThanOrEqual(80)
  })

  it("达标时摘要说通过，且 toast 给不出负面影响", () => {
    const r = buildStructureReport([
      slide("封面"),
      archSlide("架构"),
      flowSlide("流程"),
      kpiSlide("指标"),
      textSlide("论述"),
      slide("致谢"),
    ])
    expect(r.ok).toBe(true)
    expect(r.summaryLine).toContain("通过")
    expect(reportToastLine(r)).toContain("导出")
  })

  it("不达标时 toast 给出可执行建议（补空白页/补图示/改纯文字）", () => {
    const r = buildStructureReport([slide("封面"), slide("空页"), slide("平台架构", { kind: "architecture" }), slide("致谢")])
    const line = reportToastLine(r)
    expect(line).toContain("结构自检")
    expect(line).toMatch(/建议/)
  })

  it("空册不崩，返回空 toast", () => {
    const r = buildStructureReport([])
    expect(r.totalPages).toBe(0)
    expect(reportToastLine(r)).toBe("")
  })
})

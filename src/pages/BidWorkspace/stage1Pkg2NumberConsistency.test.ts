/**
 * 阶段 1 · 包 2（标书稳定）致命数字回归网。
 *
 * 钉住的缺陷（2026-11-05 实测复现，不是推演）：
 *   同一份解析报告里「评分项满分之和」有**两条读取口径**并存：
 *     · `numberScoringItems()` → structured 优先（R-026 正式形态）；
 *     · `scoringItemsFromReport()` → 纯行文本正则。
 *   只要行文本里出现「小计（40 分）」这类非评分项的分值行，正则就把它当独立评分项重复计入。
 *   实测：同一报告前者 3 条 / 100 分，后者 4 条 / 140 分。
 *   而 `scoringItemsFromReport` 是全站「满分之和」的唯一来源（模拟评标分母、价格分测算、
 *   得分地图、章节评分分配），于是同一屏同时出现「满分 140」与「招标满分 100」——
 *   正是 D6 §5「数字诚实：同一概念同一屏前后一致」明令禁止的形态。
 *
 * 修复：`scoringItemsFromReport` 改为与 `numberScoringItems` 共用 `scoringItemsFromSection`
 * （structured 优先、行文本兜底），一条评分项只可能被数到一次。
 */
import { describe, expect, it } from "vitest"
import { numberScoringItems, scoringItemsFromReport, type ParseReport } from "./bidTypes"

const sum = (items: { score: number }[]): number => items.reduce((a, b) => a + (Number(b.score) || 0), 0)

/** 结构化通道报告 + 行文本里混入「小计」行（真实标书解析产物里极常见） */
function reportWithSubtotalLine(): ParseReport {
  return {
    sections: [
      {
        key: "tech_score",
        title: "技术评分",
        content: [
          "T1 方案（40 分）：完整性",
          "小计（40 分）：上述两项",
          "T2 服务（30 分）：响应速度",
          "T3 培训（30 分）：课时安排",
        ].join("\n"),
        structured: {
          kind: "scoring",
          items: [
            { name: "T1 方案", score: 40, criteria: "完整性" },
            { name: "T2 服务", score: 30, criteria: "响应速度" },
            { name: "T3 培训", score: 30, criteria: "课时安排" },
          ],
        },
      },
    ],
  } as unknown as ParseReport
}

/** 只有行文本、没有 structured 的老数据（必须保持原有行为，不许因本次修复而读不到） */
function legacyTextOnlyReport(): ParseReport {
  return {
    sections: [
      {
        key: "tech_score",
        title: "技术评分",
        content: ["T1 方案（40 分）：完整性", "T2 服务（30 分）：响应速度"].join("\n"),
      },
    ],
  } as unknown as ParseReport
}

describe("评分项满分之和：两条口径必须同源（致命数字不打架）", () => {
  it("结构化报告含「小计」行时，两条口径条数与合计一致（此前 4 条/140 vs 3 条/100）", () => {
    const r = reportWithSubtotalLine()
    const viaReport = scoringItemsFromReport(r)
    const viaNumbered = numberScoringItems(r)

    expect(viaReport.length).toBe(viaNumbered.length)
    expect(sum(viaReport)).toBe(sum(viaNumbered))
    // 满分之和必须是合同口径的 100，而不是把「小计」重复计入后的 140
    expect(sum(viaReport)).toBe(100)
    // 「小计」不能作为一条评分项出现
    expect(viaReport.some((it) => it.item.includes("小计"))).toBe(false)
  })

  it("只有行文本的老数据仍然读得到（structured 缺失时回退不变）", () => {
    const it = scoringItemsFromReport(legacyTextOnlyReport())
    expect(it.map((x) => x.item)).toEqual(["T1 方案", "T2 服务"])
    expect(sum(it)).toBe(70)
  })

  it("空报告 / null 一律返回空数组，不编造", () => {
    expect(scoringItemsFromReport(null)).toEqual([])
    expect(scoringItemsFromReport({ sections: [] } as unknown as ParseReport)).toEqual([])
  })

  it("技术分与商务分合并计入，且与编号口径等价（编号按 tech→biz 顺序）", () => {
    const r = {
      sections: [
        {
          key: "tech_score",
          title: "技术评分",
          content: "T1（60 分）：x",
          structured: { kind: "scoring", items: [{ name: "T1", score: 60, criteria: "x" }] },
        },
        {
          key: "biz_score",
          title: "商务评分",
          content: "B1（40 分）：y",
          structured: { kind: "scoring", items: [{ name: "B1", score: 40, criteria: "y" }] },
        },
      ],
    } as unknown as ParseReport
    const viaReport = scoringItemsFromReport(r)
    const viaNumbered = numberScoringItems(r)
    expect(viaReport.length).toBe(2)
    expect(sum(viaReport)).toBe(100)
    expect(sum(viaNumbered)).toBe(100)
  })
})

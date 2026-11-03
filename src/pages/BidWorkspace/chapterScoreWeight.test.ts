// 2026-10-25（A7）：篇幅按评分项分值分配的判定口径
import { describe, expect, it } from "vitest"
import {
  chapterScoreWeights,
  chapterWordBudgets,
  scoreCoverage,
  scoreTiltFactor,
  SCORE_COVERAGE_MIN,
  SCORE_TILT,
} from "./bidTypes"

const four = ["一", "二", "三", "四"]

describe("chapterScoreWeights：评分项分值归集到章", () => {
  it("同名评分项落到对应章；未匹配的（价格分/客观分）不参与", () => {
    const w = chapterScoreWeights(
      [{ title: "总体技术解决方案" }, { title: "培训方案" }],
      [
        { item: "总体技术解决方案", score: 20, category: "tech" },
        { item: "培训方案", score: 8, category: "tech" },
        { item: "投标报价", score: 30, category: "tech" },
      ],
    )
    expect(w).toEqual([20, 8])
  })

  it("合并章：一个章承接多个评分项 → 分值累加", () => {
    const w = chapterScoreWeights(
      [{ title: "质量保障与测评验收方案" }],
      [
        { item: "质量保障方案", score: 6, category: "tech" },
        { item: "测评验收方案", score: 4, category: "tech" },
      ],
    )
    expect(w).toEqual([10])
  })

  it("商务分与非 tech 分不参与篇幅分配", () => {
    const w = chapterScoreWeights(
      [{ title: "售后服务" }],
      [
        { item: "售后服务", score: 9, category: "tech" },
        { item: "同类业绩", score: 10, category: "biz" },
      ],
    )
    expect(w).toEqual([9])
  })

  it("无评分项 / 空章表 → 全 0（调用方据此保持旧口径）", () => {
    expect(chapterScoreWeights([{ title: "培训方案" }], [])).toEqual([0])
    expect(chapterScoreWeights([], [{ item: "培训方案", score: 10 }])).toEqual([])
    expect(chapterScoreWeights(null, null)).toEqual([])
  })

  it("分值为 0 或负数不算（不参与归一化分母）", () => {
    const w = chapterScoreWeights(
      [{ title: "培训方案" }, { title: "应急方案" }],
      [
        { item: "培训方案", score: 0 },
        { item: "应急方案", score: -3 },
      ],
    )
    expect(w).toEqual([0, 0])
  })

  it("评分项只等于大纲叶子标题时，回溯到所属章（真实例：「系统架构」对不上章名「总体架构设计」）", () => {
    const outline = [
      { title: "总体架构设计", children: [{ title: "系统架构" }, { title: "采用技术及支持标准" }] },
      { title: "详细功能方案", children: [{ title: "功能清单" }] },
    ]
    const w = chapterScoreWeights(
      [{ title: "总体架构设计" }, { title: "详细功能方案" }],
      [
        { item: "系统架构", score: 8 },
        { item: "采用技术及支持标准", score: 8 },
      ],
      outline as never,
    )
    expect(w).toEqual([16, 0])
  })

  it("覆盖不足（< SCORE_COVERAGE_MIN）→ 全 0，宁可均分也不错误削薄", () => {
    const w = chapterScoreWeights(
      [{ title: "甲方案" }, { title: "乙方案" }, { title: "丙方案" }, { title: "丁方案" }],
      [{ item: "甲方案", score: 20 }],
    )
    expect(SCORE_COVERAGE_MIN).toBeGreaterThan(0.25)
    expect(w).toEqual([0, 0, 0, 0])
  })
})

describe("scoreCoverage：覆盖率按技术章算", () => {
  it("商务骨架章不计入分母", () => {
    const chapters = [{ title: "培训方案" }, { title: "开标一览表", part: "biz" }]
    expect(scoreCoverage(chapters, [10, 0])).toBe(1)
  })

  it("无技术章 → 0；空权重 → 0", () => {
    expect(scoreCoverage([{ title: "开标一览表", part: "biz" }], [10])).toBe(0)
    expect(scoreCoverage([{ title: "培训方案" }], [])).toBe(0)
  })
})

describe("scoreTiltFactor：权重乘子", () => {
  it("无最高分或本章 0 分 → 1（不加权）", () => {
    expect(scoreTiltFactor(0, 20)).toBe(1)
    expect(scoreTiltFactor(20, 0)).toBe(1)
  })

  it("满分章 → 1+SCORE_TILT；四分之一分章 → 1+SCORE_TILT/4", () => {
    expect(scoreTiltFactor(20, 20)).toBeCloseTo(1 + SCORE_TILT, 6)
    expect(scoreTiltFactor(5, 20)).toBeCloseTo(1 + SCORE_TILT / 4, 6)
  })
})

describe("chapterWordBudgets：接入分值后按分倾斜、总量不变", () => {
  const chapters = [
    { title: "总体技术解决方案", sections: four },
    { title: "培训方案", sections: four },
  ]

  it("不传分值 → 与旧口径逐字一致（两章均分）", () => {
    expect(chapterWordBudgets(chapters, 10)).toEqual([4750, 4750])
  })

  it("传全 0 分值 → 与不传逐字一致（存量项目行为不变）", () => {
    expect(chapterWordBudgets(chapters, 10, 950, true, [0, 0])).toEqual(chapterWordBudgets(chapters, 10))
  })

  it("20 分章 vs 5 分章：高分写厚、低分写薄，总预算不变", () => {
    const flat = chapterWordBudgets(chapters, 10)
    const tilted = chapterWordBudgets(chapters, 10, 950, true, [20, 5])
    expect(tilted[0]).toBeGreaterThan(flat[0])
    expect(tilted[1]).toBeLessThan(flat[1])
    expect(tilted[0]).toBe(5700)
    expect(tilted[1]).toBe(3800)
    expect(tilted[0] + tilted[1]).toBe(flat[0] + flat[1])
  })

  it("商务骨架章仍不占预算（分值为 0 且 part=biz）", () => {
    const budgets = chapterWordBudgets(
      [...chapters, { title: "开标一览表", sections: four, part: "biz" }],
      10,
      950,
      true,
      [20, 5, 30],
    )
    expect(budgets[2]).toBe(0)
  })
})

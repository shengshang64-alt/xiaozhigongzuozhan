// R35 benchmark-price-score-01：价格分测算引擎单测
// 语料取自本仓已有真实招标文件复述行（bidFormatCheck.test.ts:318、
// parseUnclearClean.test.ts:47、prompts/tenderStructure.test.ts:126）
// 与财库〔2011〕181号规定的政府采购价格分标准口径。
import { describe, expect, it } from "vitest"
import type { ScoringItem } from "./bidTypes"
import type { PriceLimits } from "./priceScoreModel"
import {
  checkPriceValidity,
  findPriceScoringItem,
  fullScoreTargetPrice,
  parsePriceFormula,
  priceScoreLadder,
  scorePrice,
} from "./priceScoreModel"

/** 181 号标准口径：最低有效报价为基准价，比值法计分 */
const RATIO_LOWEST =
  "满足招标文件要求且投标价格最低的投标报价为评标基准价，其价格分为满分。其他投标人的价格分统一按照下列公式计算：投标报价得分＝（评标基准价/投标报价）×价格权值×100"

/** 真实招标文件复述行：公式自带满分后缀 */
const RATIO_X30 = "投标价格分（30 分）：（评标基准价/投标报价）×30"

/** 偏差扣分法：算术平均下浮 3% 为基准价，高于扣 0.5/1%，低于扣 0.3/1% */
const DEV_TEXT =
  "以所有有效投标报价的算术平均值下浮3%为评标基准价，投标报价等于评标基准价的得满分；每高于评标基准价1%扣0.5分，每低于评标基准价1%扣0.3分，扣完为止"

const TRIMMED_TEXT =
  "各有效投标报价去掉一个最高报价和一个最低报价后的算术平均值下浮5%为评标基准价，投标报价等于评标基准价得满分30分，每偏离1%扣0.5分"

const ratioLowest = parsePriceFormula(RATIO_LOWEST, 30)
const dev = parsePriceFormula(DEV_TEXT, 30)

describe("parsePriceFormula · 识别可复算口径", () => {
  it("181 号标准句识别为比值法 + 最低价基准", () => {
    expect(ratioLowest.ok).toBe(true)
    if (!ratioLowest.ok) return
    expect(ratioLowest.formula).toMatchObject({
      kind: "ratio",
      basis: "lowest",
      fullScore: 30,
      floatPct: 0,
    })
  })

  it("公式尾部 ×30 与分值列一致时取分值列满分", () => {
    const r = parsePriceFormula(RATIO_X30.replace("（评标基准价", "最低投标报价为基准价（评标基准价"), 30)
    expect(r.ok).toBe(true)
  })

  it("全角 ＝／×％（） 与多余空格不影响识别", () => {
    const r = parsePriceFormula("最低价 为 评标基准价，报价得分　＝　（ 评标基准价 ／ 投标报价 ） × 30", 30)
    expect(r.ok).toBe(true)
  })

  it("偏差扣分法识别出双向费率与 3% 下浮", () => {
    expect(dev.ok).toBe(true)
    if (!dev.ok) return
    expect(dev.formula).toMatchObject({
      kind: "deviation",
      basis: "average",
      floatPct: 3,
      deductPerPctHigh: 0.5,
      deductPerPctLow: 0.3,
    })
  })

  it("去极值口径优先于普通平均口径命中", () => {
    const r = parsePriceFormula(TRIMMED_TEXT, 30)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.formula).toMatchObject({ basis: "trimmed_average", floatPct: 5, deductPerPctHigh: 0.5, deductPerPctLow: 0.5 })
  })

  it("扣分句子正反序（先低于后高于）都识别", () => {
    const r = parsePriceFormula(
      "有效投标报价算术平均值为评标基准价，每低于评标基准价1%扣0.3分，每高于评标基准价1%扣0.5分，等于基准价得满分30分",
      30,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.formula.deductPerPctHigh).toBe(0.5)
    expect(r.formula.deductPerPctLow).toBe(0.3)
  })
})

describe("parsePriceFormula · 认不出就不算（不静默给数）", () => {
  it("孤立公式行未标明基准价确定方式 → 拒绝测算", () => {
    const r = parsePriceFormula("投标报价得分＝（评标基准价/投标报价）×10％×100", 10)
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("评标基准价") })
  })

  it("非比值非偏差的口径（评标基准价×95% 满分档）→ 拒绝测算", () => {
    const r = parsePriceFormula("投标报价不高于评标基准价的得满分，高于基准价的每项扣 1 分", 30)
    expect(r.ok).toBe(false)
  })

  it("按元计扣分（每高于 1 万元扣 0.5 分）不当作按百分比口径", () => {
    const r = parsePriceFormula(
      "有效投标报价算术平均值为评标基准价，每高于基准价1万元扣0.5分，每低于基准价1万元扣0.3分，满分30分",
      30,
    )
    expect(r.ok).toBe(false)
  })

  it("公式隐含满分与分值列冲突时要求复核，不擅自取一个", () => {
    const r = parsePriceFormula("最低投标报价为评标基准价，得分＝（评标基准价/投标报价）×30", 10)
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("不一致") })
  })

  it("空评分标准 / 满分缺失 / 公式无乘数 → 按不同原因拒绝测算", () => {
    expect(parsePriceFormula("", 30).ok).toBe(false)
    // 「×价格权值×100」满分由分值列给出；分值列为 0 时公式也推不出满分
    expect(parsePriceFormula(RATIO_LOWEST, 0).ok).toBe(false)
    expect(parsePriceFormula(RATIO_LOWEST, 30).ok).toBe(true)
    expect(parsePriceFormula("最低投标报价为基准价，得分按投标报价与基准价之比计算", 0).ok).toBe(false)
  })
})

describe("scorePrice · 比值法", () => {
  it("报价 120 万、最低对手 100 万、满分 30 → 得 25 分", () => {
    if (!ratioLowest.ok) throw new Error("前置失败")
    const r = scorePrice(ratioLowest.formula, 120, [100, 150])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.baseline).toBe(100)
    expect(r.result.score).toBe(25)
    expect(r.result.gap).toBe(5)
    expect(r.result.baselineNote).toContain("最低有效报价")
  })

  it("我方即最低报价 → 满分且不因比值 >1 而超分", () => {
    if (!ratioLowest.ok) throw new Error("前置失败")
    const r = scorePrice(ratioLowest.formula, 90, [100, 120])
    expect(r.ok && r.result.score === 30).toBe(true)
    expect(r.ok && r.result.gap === 0).toBe(true)
  })

  it("平均值基准下报价低于基准价 → 封顶满分", () => {
    const f = parsePriceFormula("所有有效投标报价的算术平均值为评标基准价，投标报价得分＝（评标基准价/投标报价）×30", 30)
    expect(f.ok).toBe(true)
    if (!f.ok) return
    const r = scorePrice(f.formula, 800, [1000, 1200])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.baseline).toBe(1000)
    expect(r.result.score).toBe(30)
  })
})

describe("scorePrice · 偏差扣分法", () => {
  it("高于基准价 15.98% → 按 0.5 分/1% 扣分（自身报价参与均价）", () => {
    if (!dev.ok) throw new Error("前置失败")
    // 报价池 [100,200,180] 均值 160，下浮 3% ⇒ 基准 155.2；偏差 (180-155.2)/155.2＝15.98%
    const r = scorePrice(dev.formula, 180, [100, 200])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const expectedDev = ((180 - 160 * 0.97) / (160 * 0.97)) * 100
    expect(r.result.baseline).toBeCloseTo(155.2, 2)
    expect(r.result.deviationPct).toBeCloseTo(15.98, 2)
    expect(r.result.score).toBeCloseTo(30 - expectedDev * 0.5, 1)
    expect(r.result.score).toBeLessThan(30)
  })

  it("无下浮时偏差为零的报价得满分", () => {
    const f = parsePriceFormula("所有有效投标报价的算术平均值为评标基准价，等于基准价得满分30分，每高于基准价1%扣0.5分，每低于基准价1%扣0.3分", 30)
    expect(f.ok).toBe(true)
    if (!f.ok) return
    const r = scorePrice(f.formula, 200, [100, 300])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.baseline).toBe(200)
    expect(r.result.score).toBe(30)
    expect(r.result.gap).toBe(0)
  })

  it("扣分超满分 → 扣完为止取 0，不出现负分", () => {
    const f = parsePriceFormula("所有有效投标报价的算术平均值为评标基准价，每低于基准价1%扣1分，每高于基准价1%扣1分，满分30分", 30)
    expect(f.ok).toBe(true)
    if (!f.ok) return
    const r = scorePrice(f.formula, 100, [200, 300])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.score).toBe(0)
    expect(r.result.gap).toBe(30)
  })

  it("去极值口径样本不足 3 家 → 拒绝测算", () => {
    if (!dev.ok) throw new Error("前置失败")
    const trimmed = parsePriceFormula(TRIMMED_TEXT, 30)
    expect(trimmed.ok).toBe(true)
    if (!trimmed.ok) return
    const r = scorePrice(trimmed.formula, 120, [100])
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("样本不足") })
  })
})

describe("scorePrice · 入参去污", () => {
  it("缺对手报价时不给分（价格分是相对分）", () => {
    if (!ratioLowest.ok) throw new Error("前置失败")
    expect(scorePrice(ratioLowest.formula, 120, [])).toEqual({
      ok: false,
      reason: expect.stringContaining("参照"),
    })
  })

  it("我方报价非法 / 对手报价含脏值一律按无效剔除", () => {
    if (!ratioLowest.ok) throw new Error("前置失败")
    expect(scorePrice(ratioLowest.formula, 0, [100]).ok).toBe(false)
    expect(scorePrice(ratioLowest.formula, Number.NaN, [100]).ok).toBe(false)
    const r = scorePrice(ratioLowest.formula, 120, [100, -50, Number.NaN, 0, 150])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.baseline).toBe(100)
  })

  it("得分按分位精确舍入，不吃二进制浮点尾差", () => {
    if (!ratioLowest.ok) throw new Error("前置失败")
    const r = scorePrice(ratioLowest.formula, 1152, [1000, 1500])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 1000/1152×30 = 26.041666… → 26.04
    expect(r.result.score).toBe(26.04)
  })
})

describe("priceScoreLadder · 报价敏感性阶梯", () => {
  it("每档重算基准价：降到最低对手价即拿满分", () => {
    if (!ratioLowest.ok) throw new Error("前置失败")
    const r = priceScoreLadder(ratioLowest.formula, 120, [100, 150], [-20, -10, 0])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.steps.map((s) => s.price)).toEqual([96, 108, 120])
    expect(r.steps.map((s) => s.score)).toEqual([30, 27.78, 25])
    expect(r.steps.map((s) => s.delta)).toEqual([5, 2.78, 0])
  })

  it("阶梯表跳过测算不出的档位，不塞假数", () => {
    if (!dev.ok) throw new Error("前置失败")
    const r = priceScoreLadder(dev.formula, 180, [100, 200], [0, 5])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.steps).toHaveLength(2)
    expect(r.steps[0].delta).toBe(0)
  })
})

describe("fullScoreTargetPrice · 拿满价格分的报价临界", () => {
  it("最低价基准：临界价＝最低对手报价，并给出降价幅度", () => {
    if (!ratioLowest.ok) throw new Error("前置失败")
    const t = fullScoreTargetPrice(ratioLowest.formula, 120, [100, 150])
    expect(t).toEqual({ price: 100, cutPct: 16.67, note: expect.stringContaining("不高于最低对手报价"), invalidReason: null })
  })

  it("比值法均价基准：临界价即含自身后的均价，代回测算恰为满分", () => {
    const f = parsePriceFormula("所有有效投标报价的算术平均值为评标基准价，投标报价得分＝（评标基准价/投标报价）×30", 30)
    expect(f.ok).toBe(true)
    if (!f.ok) return
    const t = fullScoreTargetPrice(f.formula, 300, [100, 140])
    expect(t?.price).toBe(120)
    const r = scorePrice(f.formula, 120, [100, 140])
    expect(r.ok && r.result.score).toBe(30)
  })

  it("偏差法含下浮时求解自洽不动点，代回测算满分", () => {
    if (!dev.ok) throw new Error("前置失败")
    const t = fullScoreTargetPrice(dev.formula, 300, [100, 200])
    expect(t).not.toBeNull()
    const price = t!.price
    const r = scorePrice(dev.formula, price, [100, 200])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Math.abs(r.result.deviationPct ?? 99)).toBeLessThan(0.02)
  })

  it("去极值口径无闭式解 → 返回 null 交给阶梯试算", () => {
    const trimmed = parsePriceFormula(TRIMMED_TEXT, 30)
    expect(trimmed.ok).toBe(true)
    if (!trimmed.ok) return
    expect(fullScoreTargetPrice(trimmed.formula, 120, [100, 150, 200, 90])).toBeNull()
  })
})

describe("checkPriceValidity · 报价区间守护（真实语料 .diag/r50_tender.txt：限价 2500 万、低于 45% 无效）", () => {
  const LIMITS: PriceLimits = { maxPrice: 25_000_000, minValidRatioPct: 45 }

  it("超过最高限价 / 低于 45% 地板价分别给出原因，区间内为 null", () => {
    expect(checkPriceValidity(25_000_000, LIMITS)).toBeNull()
    expect(checkPriceValidity(25_000_001, LIMITS)).toContain("超过最高限价")
    expect(checkPriceValidity(11_250_000, LIMITS)).toBeNull()
    expect(checkPriceValidity(11_249_000, LIMITS)).toContain("低于最高限价的 45%")
    expect(checkPriceValidity(1, undefined)).toBeNull()
  })

  it("地板价按分位精确计算（2500 万 × 45% ＝ 1125 万）", () => {
    expect(checkPriceValidity(11_250_000 - 0.01, LIMITS)).toContain("11250000.00")
  })

  it("拿满分的临界价可能正是废标价 → 打警示而不是隐藏", () => {
    if (!ratioLowest.ok) throw new Error("前置失败")
    const t = fullScoreTargetPrice(ratioLowest.formula, 25_000_000, [10_000_000, 24_000_000], LIMITS)
    expect(t).not.toBeNull()
    expect(t!.price).toBe(10_000_000)
    expect(t!.invalidReason).toContain("低于最高限价的 45%")
  })

  it("阶梯表逐档标注无效原因，分数照常给出但不冒充建议", () => {
    const f = parsePriceFormula(RATIO_LOWEST, 10)
    expect(f.ok).toBe(true)
    if (!f.ok) return
    const r = priceScoreLadder(f.formula, 25_000_000, [20_000_000, 24_000_000], [-60, -40, 0, 10], LIMITS)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.steps.map((s) => s.price)).toEqual([10_000_000, 15_000_000, 25_000_000, 27_500_000])
    expect(r.steps.map((s) => s.score)).toEqual([10, 10, 8, 7.27])
    expect(r.steps.map((s) => s.invalidReason)).toEqual([
      expect.stringContaining("低于最高限价的 45%"),
      null,
      null,
      expect.stringContaining("超过最高限价"),
    ])
  })
})

describe("findPriceScoringItem · 从评分项里取价格分", () => {
  const items: ScoringItem[] = [
    { item: "技术方案", score: 20, criteria: "优秀得 20 分，良好得 10 分" },
    { item: "投标价格分", score: 30, criteria: RATIO_LOWEST },
  ]

  it("命中价格分项并识别口径，跳过非价格项", () => {
    const hit = findPriceScoringItem(items)
    expect(hit?.item.item).toBe("投标价格分")
    expect(hit?.formula.kind).toBe("ratio")
  })

  it("只有价格分项但公式不可复算 → 返回 null（不当成已测算）", () => {
    expect(findPriceScoringItem([{ item: "价格分", score: 30, criteria: "按国家有关规定执行" }])).toBeNull()
    expect(findPriceScoringItem([])).toBeNull()
  })
})

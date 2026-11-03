// R38（B12）价格分测算接 UI —— 视图模型单测（纯函数，零 DOM）
// 钉四件事：①手输金额的合法写法与单位歧义（不猜换算）；②对手报价清单的分隔语义
// （千分位 vs 逗号分隔）；③六个阶段的分流与「没出数就一个数字都不给」；
// ④得分/临界价/阶梯与 R35-R36 算法层逐分一致（语料取自本仓真实招标文件复述行）。
import { describe, expect, it } from "vitest"
import type { ScoringItem } from "./bidTypes"
import {
  buildPriceScoreView,
  fmtPriceText,
  fmtScore,
  parseMoneyInput,
  parsePriceListInput,
  LADDER_PCTS,
} from "./priceScoreBrief"

/** 财库〔2011〕181号标准口径：最低有效报价为基准价，比值法计分 */
const RATIO_181 =
  "满足招标文件要求且投标价格最低的投标报价为评标基准价，其价格分为满分。其他投标人的价格分统一按照下列公式计算：投标报价得分＝（评标基准价/投标报价）×价格权值×100"

/** 偏差扣分法：算术平均下浮 3% 为基准价，高于扣 0.5/1%，低于扣 0.3/1% */
const DEV_AVG_FLOAT3 =
  "以所有有效投标报价的算术平均值下浮3%为评标基准价，投标报价等于评标基准价的得满分；每高于评标基准价1%扣0.5分，每低于评标基准价1%扣0.3分，扣完为止"

/** 去极值平均：我方报价自身可能就是被剔掉的极值，临界价无闭式解 */
const TRIMMED =
  "各有效投标报价去掉一个最高报价和一个最低报价后的算术平均值下浮5%为评标基准价，投标报价等于评标基准价得满分30分，每偏离1%扣0.5分"

/** 真实语料里的废标条款（.diag/r50_tender.txt：低于最高限价 45% 按无效投标处理） */
const FACTS_LIMIT_2500 = ["最高限价：2500万元", "预算金额：2500万元"]

const item = (name: string, score: number, criteria: string): ScoringItem => ({ item: name, score, criteria })

const baseInput = (over: Partial<Parameters<typeof buildPriceScoreView>[0]> = {}) => ({
  items: [item("价格分", 30, RATIO_181)],
  factLines: [] as string[],
  ourPriceText: "",
  competitorText: "",
  ceilingText: "",
  minValidRatioText: "",
  ...over,
})

describe("parseMoneyInput · 手输金额的合法写法", () => {
  it("万/万元/亿/元 四种单位与千分位、货币前缀都归一到元", () => {
    expect(parseMoneyInput("1200万")).toEqual({ value: 12_000_000, error: null })
    expect(parseMoneyInput("1,200.5万元")).toEqual({ value: 12_005_000, error: null })
    expect(parseMoneyInput("1.2亿")).toEqual({ value: 120_000_000, error: null })
    expect(parseMoneyInput("24500000")).toEqual({ value: 24_500_000, error: null })
    expect(parseMoneyInput("￥2500万元")).toEqual({ value: 25_000_000, error: null })
  })

  it("空串是「未填」而不是「填错」，两者在 UI 上是不同提示", () => {
    expect(parseMoneyInput("")).toEqual({ value: null, error: null })
    expect(parseMoneyInput("   ")).toEqual({ value: null, error: null })
  })

  it("无单位一律按元如实计算，不做「看着像万元」的猜测换算", () => {
    expect(parseMoneyInput("1000")).toEqual({ value: 1000, error: null })
  })

  it("写法不成 / 非正数 → 报错并回显原文，不返回一个凑合的数", () => {
    expect(parseMoneyInput("两千万").error).toContain("无法识别")
    expect(parseMoneyInput("1200w").error).toContain("无法识别")
    expect(parseMoneyInput("0").error).toContain("正数")
    // 负号不在合法写法里，走「无法识别」分支；显式 0 才是「非正数」
    expect(parseMoneyInput("-1万").error).toContain("无法识别")
  })
})

describe("parsePriceListInput · 对手报价清单", () => {
  it("千分位逗号归一为单个金额", () => {
    expect(parsePriceListInput("1,200,000")).toEqual({ prices: [1_200_000], rejected: [] })
    expect(parsePriceListInput("3,000万元")).toEqual({ prices: [30_000_000], rejected: [] })
  })

  it("换行 / 分号 / 顿号都是分隔符，同一行两个整千数按两个报价处理", () => {
    expect(parsePriceListInput("1200万\n1500万").prices).toEqual([12_000_000, 15_000_000])
    expect(parsePriceListInput("1200万; 1500万").prices).toEqual([12_000_000, 15_000_000])
    expect(parsePriceListInput("1200万、1500万").prices).toEqual([12_000_000, 15_000_000])
    expect(parsePriceListInput("1200,1500").prices).toEqual([1200, 1500])
  })

  it("认不出的条目逐条回传，不静默丢掉参照样本", () => {
    const r = parsePriceListInput("2480万\n待开标\n1200万")
    expect(r.prices).toEqual([24_800_000, 12_000_000])
    expect(r.rejected).toEqual(["待开标"])
  })
})

describe("buildPriceScoreView · 阶段分流（没出数就一个数字都不给）", () => {
  it("没有评分办法 → no-scoring", () => {
    const v = buildPriceScoreView(baseInput({ items: [] }))
    expect(v.phase).toBe("no-scoring")
    expect(v.formula).toBeNull()
    expect(v.result).toBeNull()
  })

  it("有评分办法但抽不到价格分项 → no-price-item，并说明共几项", () => {
    const v = buildPriceScoreView(baseInput({ items: [item("技术方案", 40, "按优、良、一般分档打分")] }))
    expect(v.phase).toBe("no-price-item")
    expect(v.note).toContain("1 个评分项")
  })

  it("价格分项存在但口径认不出 → unrecognized，逐项给原因且不代猜", () => {
    const v = buildPriceScoreView(
      baseInput({ items: [item("价格分", 30, "投标报价不高于评标基准价的得满分，高于基准价的每项扣 1 分")] }),
    )
    expect(v.phase).toBe("unrecognized")
    expect(v.formula).toBeNull()
    expect(v.result).toBeNull()
    expect(v.steps).toEqual([])
    expect(v.candidates[0].reason).toContain("可机械复算")
  })

  it("公式隐含满分与分值列冲突 → 要求复核评分表，不擅自取一个", () => {
    const v = buildPriceScoreView(
      baseInput({ items: [item("价格分", 10, "最低投标报价为评标基准价，得分＝（评标基准价/投标报价）×30")] }),
    )
    expect(v.phase).toBe("unrecognized")
    expect(v.candidates[0].reason).toContain("不一致")
  })

  it("报价样本不足以去极值 → not-computable，沿用算法层的人话原因", () => {
    const v = buildPriceScoreView(
      baseInput({
        items: [item("价格分", 30, TRIMMED)],
        ourPriceText: "1000万",
        competitorText: "1200万",
      }),
    )
    expect(v.phase).toBe("not-computable")
    expect(v.note).toContain("样本不足 3 家")
    expect(v.result).toBeNull()
  })

  it("我方报价 / 对手报价缺失 → await-input，并点名对手报价必须手填", () => {
    const noOurs = buildPriceScoreView(baseInput())
    expect(noOurs.phase).toBe("await-input")
    expect(noOurs.note).toContain("我方投标报价")

    const noRivals = buildPriceScoreView(baseInput({ ourPriceText: "2400万" }))
    expect(noRivals.phase).toBe("await-input")
    expect(noRivals.note).toContain("中标金额")
    expect(noRivals.result).toBeNull()
  })

  it("多个价格分项时跳过认不出的那项，选中可复算的口径", () => {
    const v = buildPriceScoreView(
      baseInput({
        items: [
          item("价格分", 30, "报价得分按投标报价与基准价之比计算，具体以现场核定为准"),
          item("投标报价得分", 10, RATIO_181),
        ],
        ourPriceText: "2400万",
        competitorText: "2500万\n2300万",
      }),
    )
    expect(v.formula?.name).toBe("投标报价得分")
    expect(v.candidates).toHaveLength(2)
  })
})

describe("buildPriceScoreView · 比值法（181 号口径）逐分对齐算法层", () => {
  const v = buildPriceScoreView(
    baseInput({ ourPriceText: "2400万", competitorText: "2500万\n2300万" }),
  )

  it("基准价＝最低有效报价，得分按基准价/报价折算，分差同步", () => {
    expect(v.phase).toBe("computed")
    expect(v.result?.baseline).toBe(23_000_000)
    expect(v.result?.score).toBe(28.75)
    expect(v.result?.gap).toBe(1.25)
    expect(v.result?.deviationPct).toBeNull()
  })

  it("拿满分的临界价＝最低对手报价，并给出降幅", () => {
    expect(v.target?.price).toBe(23_000_000)
    expect(v.target?.cutPct).toBe(4.17)
    expect(v.target?.invalidReason).toBeNull()
    expect(v.target?.text).toContain("较现价低 4.17%")
  })

  it("阶梯 8 档且现价档唯一", () => {
    expect(v.steps).toHaveLength(LADDER_PCTS.length)
    expect(v.steps.filter((s) => s.isAnchor)).toHaveLength(1)
    expect(v.steps.find((s) => s.isAnchor)?.delta).toBe(0)
  })

  it("口径卡把「基准价口径 + 满分」写成一句人话供核对", () => {
    expect(v.formula?.basisLabel).toBe("最低有效报价为基准价")
    expect(v.formula?.plainNote).toContain("临界价已含下浮率")
    expect(v.formula?.raw).toContain("评标基准价/投标报价")
  })
})

describe("buildPriceScoreView · 偏差法（均价＋下浮）自身报价拖动基准价", () => {
  const v = buildPriceScoreView(
    baseInput({
      items: [item("价格分", 30, DEV_AVG_FLOAT3)],
      ourPriceText: "1200万",
      competitorText: "1000万\n1400万",
    }),
  )

  it("基准价含 3% 下浮，偏差率与扣分逐分对上", () => {
    expect(v.phase).toBe("computed")
    expect(v.result?.baseline).toBeCloseTo(11_640_000, 2)
    expect(v.result?.deviationPct).toBe(3.09)
    expect(v.result?.score).toBe(28.45)
    expect(v.result?.gap).toBe(1.55)
  })

  it("临界价解自洽不动点（含下浮、含自身报价拉动），不是对手算术平均", () => {
    expect(v.target?.price).toBeCloseTo(11_467_980.3, 2)
    expect(v.target?.note).toContain("已含下浮")
  })

  it("去极值口径不出临界价，改由阶梯兜底并说明原因", () => {
    const t = buildPriceScoreView(
      baseInput({
        items: [item("价格分", 30, TRIMMED)],
        ourPriceText: "1200万",
        competitorText: "1000万\n1300万\n1400万",
      }),
    )
    expect(t.phase).toBe("computed")
    expect(t.target).toBeNull()
    expect(t.steps.length).toBeGreaterThan(0)
  })
})

describe("buildPriceScoreView · 废标区间守护与天花板取数", () => {
  it("事实表限价 2500 万 + 低于 45% 无效：临界价踩进无效标区间时点破", () => {
    const v = buildPriceScoreView(
      baseInput({
        factLines: FACTS_LIMIT_2500,
        ourPriceText: "2000万",
        competitorText: "1000万\n2400万",
        minValidRatioText: "45",
      }),
    )
    expect(v.ceiling).toEqual({ value: 25_000_000, src: "最高限价/控制价", fromInput: false })
    expect(v.minValidRatioPct).toBe(45)
    expect(v.target?.price).toBe(10_000_000)
    expect(v.target?.invalidReason).toContain("无效投标")
    // 现价阶梯各档都远在地板之上，守护只针对「建议价」，不乱贴标签
    expect(v.steps.every((s) => s.invalidReason === null)).toBe(true)
  })

  it("人工填写的限价优先于事实表，来源标签如实改成「人工填写」", () => {
    const v = buildPriceScoreView(
      baseInput({ factLines: FACTS_LIMIT_2500, ceilingText: "3000万", ourPriceText: "2000万", competitorText: "1000万" }),
    )
    expect(v.ceiling).toEqual({ value: 30_000_000, src: "人工填写", fromInput: true })
  })

  it("无效标比例越界 → 报格式错，不静默当成不校验", () => {
    const v = buildPriceScoreView(baseInput({ minValidRatioText: "450" }))
    expect(v.minValidRatioError).toContain("0-100")
    expect(v.minValidRatioPct).toBeNull()
  })

  it("报价不足限价 1% 时点破单位歧义，但仍按所填单位如实计算", () => {
    const v = buildPriceScoreView(
      baseInput({ factLines: FACTS_LIMIT_2500, ourPriceText: "1200", competitorText: "1000万\n1200万" }),
    )
    expect(v.ourPrice).toBe(1200)
    expect(v.unitHint).toContain("疑似把「万元」按「元」填写")
    expect(v.phase).toBe("computed")
  })
})

// R64：此前 checkPriceValidity 只挂在「建议价」与阶梯上，现价自身不校验，于是出现
// 「现价 800 万 < 限价 45%（1125 万）会废标，面板却给满分 30 并写『无需再降』」的自相矛盾。
describe("R64 · 现价自身的报价有效性（废标价拿满分没有意义）", () => {
  it("现价低于无效标比例：置 ourPriceInvalid，且建议价文案不再说「无需再降」", () => {
    const v = buildPriceScoreView(
      baseInput({
        factLines: FACTS_LIMIT_2500,
        ourPriceText: "800万",
        competitorText: "1200万\n1500万",
        minValidRatioText: "45",
      }),
    )
    // 事实：这个报价确实会被判无效
    expect(v.ourPriceInvalid).toContain("低于最高限价的 45%")
    expect(v.ourPriceInvalid).toContain("无效投标")
    // 且它的价格分仍然是满分——正是「满分 + 废标」这对矛盾要被点破
    expect(v.result?.score).toBe(30)
    expect(v.target?.text).toContain("先解决废标")
    expect(v.target?.text).not.toContain("无需再降")
    // 阶梯里现价那一档本来就标了无效，两者不得各说各话
    const anchor = v.steps.find((s) => s.isAnchor)
    expect(anchor?.invalidReason).toContain("无效投标")
  })

  it("现价超最高限价：同样置 ourPriceInvalid（超限价也是废标）", () => {
    const v = buildPriceScoreView(
      baseInput({ factLines: FACTS_LIMIT_2500, ourPriceText: "2600万", competitorText: "1200万\n1500万" }),
    )
    expect(v.ourPriceInvalid).toContain("超过最高限价")
    expect(v.target?.text).toContain("先解决废标")
  })

  it("现价合法时不误报：门槛之上照旧给「已拿满价格分」", () => {
    const v = buildPriceScoreView(
      baseInput({
        factLines: FACTS_LIMIT_2500,
        ourPriceText: "1200万",
        competitorText: "1500万\n1800万",
        minValidRatioText: "45",
      }),
    )
    expect(v.ourPriceInvalid).toBeNull()
    expect(v.target?.text).toContain("已拿满价格分")
  })

  it("没限价可校验时不出判定（门槛填了但没有天花板 → 无法算地板，不乱贴废标标签）", () => {
    const v = buildPriceScoreView(
      baseInput({ factLines: [], ourPriceText: "800万", competitorText: "1200万\n1500万", minValidRatioText: "45" }),
    )
    expect(v.minValidRatioPct).toBe(45)
    expect(v.ourPriceInvalid).toBeNull()
  })
})

describe("金额与分值回显", () => {
  it("万元为主读法、括号内给到分的元值", () => {
    expect(fmtPriceText(25_000_000)).toBe("2,500.00 万元（25,000,000.00 元）")
    expect(fmtPriceText(1234.5)).toBe("1,234.50 元")
    expect(fmtPriceText(0)).toBe("—")
  })

  it("分值最多 2 位并去尾零", () => {
    expect(fmtScore(28.75)).toBe("28.75")
    expect(fmtScore(30)).toBe("30")
    expect(fmtScore(1.0999)).toBe("1.1")
  })
})

// ---------------------------------------------------------------------------
// R35（benchmark-price-score-01）价格分确定性测算
//
// 对标来源：BidMaster-Pro README「招标解读 → 评分矩阵：自动生成评分细则对照表」
// 「投标检查 → 价格合理性：分析报价逻辑和竞争性」（github.com/guangshu100/BidMaster-Pro）。
// 我们缺什么：解析环节已把价格分公式**完整抄录**进评分项 criteria 原文
// （prompts/wholeParse.ts:149 明确要求「价格评分只给公式时公式完整抄录」，
// scoreItemsScan.ts:41 已按 price 类目分型），但全库检索 priceScore/价格得分计算零命中——
// 公式进了库却从不参与复算。报价工作室给出总价后，没有任何一处能回答
// 「这个报价拿多少价格分、离满分差几分、要拿满分最多能报多少」。
// docs/10-GitHub开源补强选型报告.md:291 早评估过用 hyperformula 承担测算，
// 结论是 GPL 许可 + 测算逻辑简单应自研；本轮落地自研这一步（零新依赖）。
//
// 口径纪律（与 R034 折扣歧义、R-0285 同一脉：不静默给错数）：
// 只认能被机械复算的两类口径（比值法 ratio / 偏差扣分法 deviation）。
// 公式认不出、评标基准价的确定方式没标明、偏差费率不齐、没有对手报价做参照——
// 一律返回 ok:false + 人话原因，绝不猜一个数冒充招标文件的结论。
// 价格分是**相对分**，缺参照系就没有可算的答案，这一点写死在入口校验里。
// ---------------------------------------------------------------------------

import type { ScoringItem } from "./bidTypes"
import { centsToYuan, productCents } from "@/lib/money"

/** 评标基准价的确定方式 */
export type PriceBasis = "lowest" | "average" | "trimmed_average"

/** 已识别的价格分公式 */
export type PriceScoreFormula = {
  /** ratio＝（基准价/投标报价）×满分；deviation＝等于基准价得满分，按偏差率扣分 */
  kind: "ratio" | "deviation"
  basis: PriceBasis
  /** 基准价口径的人话名，用于给用户核对是不是招标文件的意思 */
  basisLabel: string
  /** 基准价下浮率（%）；「平均值下浮 3% 为基准价」里的 3；无下浮为 0 */
  floatPct: number
  /** 价格分满分 */
  fullScore: number
  /** 偏差法：报价每高于基准价 1% 扣的分值 */
  deductPerPctHigh: number | null
  /** 偏差法：报价每低于基准价 1% 扣的分值 */
  deductPerPctLow: number | null
  /** 公式原文，供用户逐项核对 */
  raw: string
}

export type PriceFormulaParse =
  | { ok: true; formula: PriceScoreFormula }
  | { ok: false; reason: string }

export type PriceScoreResult = {
  baseline: number
  baselineNote: string
  score: number
  /** 满分与实际得分之差 */
  gap: number
  /** 偏差法的报价偏差率（%），比值法为 null */
  deviationPct: number | null
}

export type PriceStep = { price: number; score: number; delta: number; invalidReason: string | null }

/**
 * 招标文件对报价区间的硬约束（拿满分要降到的价，可能正好踩进无效标区间——
 * 真实语料：.diag/r50_tender.txt「投标报价＜采购项目最高限价×45%」按无效投标处理）。
 * 数值由调用方从招标文件带入（本模块不做文本识别），缺省即不校验。
 */
export type PriceLimits = {
  /** 最高限价 / 采购预算（元）；报价超过即无效 */
  maxPrice?: number
  /** 低于最高限价该比例即按无效标处理（%），如 45 */
  minValidRatioPct?: number
}

/** 报价是否落在招标文件允许的有效期内；无效时给人话原因 */
export function checkPriceValidity(price: number, limits?: PriceLimits): string | null {
  if (!limits || !(price > 0)) return null
  const max = Number.isFinite(limits.maxPrice) ? limits.maxPrice! : null
  if (max != null && price > max) return `超过最高限价 ${max.toFixed(2)} 元，按无效投标处理`
  const pct = Number.isFinite(limits.minValidRatioPct) ? limits.minValidRatioPct! : null
  if (max != null && pct != null) {
    const floor = centsToYuan(productCents([max, pct / 100]))
    if (price < floor) return `低于最高限价的 ${pct}%（${floor.toFixed(2)} 元），按无效投标处理`
  }
  return null
}

/** 全角符号归一：招标文件里 ＝ ／ × ％ （） 与半角混用，不归一会漏识别 */
function normalizeFormulaText(text: string): string {
  return text
    .replace(/[＝]/g, "=")
    .replace(/[／]/g, "/")
    .replace(/[×]/g, "x")
    .replace(/[％]/g, "%")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, "")
}

const BASIS_RULES: { basis: PriceBasis; label: string; re: RegExp }[] = [
  {
    basis: "trimmed_average",
    label: "去掉最高/最低报价后取算术平均",
    re: /(剔除|去掉)[^。；;]{0,20}最高[^。；;]{0,20}(剔除|去掉)?[^。；;]{0,20}最低[^。；;]{0,30}(算术)?平均|每个有效报价(去掉|剔除)一个最高价和一个最低价/,
  },
  {
    basis: "lowest",
    label: "最低有效报价为基准价",
    re: /报价最低|最低(的)?(有效)?(投标)?报价|最低价[^。；;]{0,12}(为|作|即)[^。；;]{0,12}基准价/,
  },
  {
    basis: "average",
    label: "有效投标报价算术平均",
    re: /(所有|各|全部)?[^。；;]{0,12}(有效)?投标?报价[^。；;]{0,16}(算术)?平均|平均(投标)?报价|报价(算术)?平均值/,
  },
]

/** 识别评标基准价口径；认不出返回 null（宁可不算） */
function detectBasis(text: string): { basis: PriceBasis; label: string } | null {
  for (const rule of BASIS_RULES) {
    if (rule.re.test(text)) return { basis: rule.basis, label: rule.label }
  }
  return null
}

/** 「算术平均值下浮 3% 为基准价」里的下浮率；无则 0 */
function detectFloatPct(text: string): number {
  const m = text.match(/(?:下浮|优惠率|让利比例?|浮动率?)[^0-9%]{0,6}(\d+(?:\.\d+)?)%/)
  return m ? Number(m[1]) : 0
}

const RE_RATIO_FORMULA = /=\(?评标基准价\/(投标报价|投标人报价|评标价|投标价)\)?|评标基准价\/(投标报价|投标人报价|投标价)/

/** 「×价格权值×100」的满分由评分表分值列给出，公式里推不出来；其余按公式尾部乘数认定 */
function detectImpliedFullScore(text: string): number | null {
  if (/权值/.test(text)) return null
  const w = text.match(/x(\d+(?:\.\d+)?)%x100/)
  if (w) return Number(w[1])
  const f = text.match(/x(\d+(?:\.\d+)?)$/)
  return f ? Number(f[1]) : null
}

const RE_DEDUCT_TWO =
  /每(高于|超过|大于)[^0-9%]{0,10}(\d+(?:\.\d+)?)%[^0-9分]{0,8}(扣|减|倒扣)[^0-9]{0,6}(\d+(?:\.\d+)?)分.{0,20}每(低于|小于|不足)[^0-9%]{0,10}(\d+(?:\.\d+)?)%[^0-9分]{0,8}(扣|减)[^0-9]{0,6}(\d+(?:\.\d+)?)分|每(低于|小于|不足)[^0-9%]{0,10}(\d+(?:\.\d+)?)%[^0-9分]{0,8}(扣|减)[^0-9]{0,6}(\d+(?:\.\d+)?)分.{0,20}每(高于|超过|大于)[^0-9%]{0,10}(\d+(?:\.\d+)?)%[^0-9分]{0,8}(扣|减)[^0-9]{0,6}(\d+(?:\.\d+)?)分/

const RE_DEDUCT_SYMMETRIC = /每(?:偏离|偏差|增加|减少|变动)[^0-9%]{0,6}(\d+(?:\.\d+)?)%[^0-9分]{0,8}(?:扣|减|倒扣)[^0-9]{0,6}(\d+(?:\.\d+)?)分/

function detectDeductRates(text: string): { high: number; low: number } | null {
  const two = text.match(RE_DEDUCT_TWO)
  if (two) {
    const groups = two.slice(1)
    // 每个「每高于 1% 扣 0.5 分」子句占 4 个捕获组（关键字/阈值/动词/扣分），
    // 正则两分支互为镜像，故按关键字定位再取第 4 位的扣分，不依赖组序
    const hiIdx = groups.findIndex((g) => g != null && /高于|超过|大于/.test(g))
    const loIdx = groups.findIndex((g) => g != null && /低于|小于|不足/.test(g))
    if (hiIdx >= 0 && loIdx >= 0 && groups[hiIdx + 3] != null && groups[loIdx + 3] != null) {
      const high = Number(groups[hiIdx + 3])
      const low = Number(groups[loIdx + 3])
      if (Number.isFinite(high) && Number.isFinite(low)) return { high, low }
    }
  }
  const sym = text.match(RE_DEDUCT_SYMMETRIC)
  if (sym) {
    const rate = Number(sym[2])
    if (Number.isFinite(rate)) return { high: rate, low: rate }
  }
  return null
}

/**
 * 从价格分评分标准原文识别可复算口径。
 * fullScore 取自评分项分值列；<=0 时退回公式里隐含的满分（如「×10%×100」＝10 分）。
 */
export function parsePriceFormula(rawCriteria: string, fullScore: number): PriceFormulaParse {
  const text = normalizeFormulaText(rawCriteria ?? "")
  if (!text) return { ok: false, reason: "价格分评分标准为空，无法测算" }

  const isRatio = RE_RATIO_FORMULA.test(text)
  const hasDeduct = RE_DEDUCT_TWO.test(text) || RE_DEDUCT_SYMMETRIC.test(text)
  if (!isRatio && !hasDeduct) {
    return { ok: false, reason: "公式不属于可机械复算的口径（比值法／偏差扣分法），请按招标文件人工计算" }
  }

  const basis = detectBasis(text)
  if (!basis) {
    return { ok: false, reason: "公式含价格分计算但未标明「评标基准价」如何确定（最低价／平均值／去极值平均），无法测算" }
  }

  const implied = detectImpliedFullScore(text)
  const max = fullScore > 0 ? fullScore : implied ?? 0
  if (!(max > 0)) return { ok: false, reason: "价格分满分分值缺失，无法测算" }
  if (fullScore > 0 && implied != null && Math.abs(implied - fullScore) > 0.01) {
    return {
      ok: false,
      reason: `公式隐含满分 ${implied} 分与评分项分值列 ${fullScore} 分不一致，请先复核评分表（不静默取其一）`,
    }
  }

  const floatPct = detectFloatPct(text)

  if (isRatio) {
    return {
      ok: true,
      formula: {
        kind: "ratio",
        basis: basis.basis,
        basisLabel: basis.label,
        floatPct,
        fullScore: max,
        deductPerPctHigh: null,
        deductPerPctLow: null,
        raw: rawCriteria,
      },
    }
  }

  const rates = detectDeductRates(text)
  if (!rates) {
    return { ok: false, reason: "偏差扣分费率未成对标明（高于／低于基准价各扣多少分），无法测算" }
  }
  return {
    ok: true,
    formula: {
      kind: "deviation",
      basis: basis.basis,
      basisLabel: basis.label,
      floatPct,
      fullScore: max,
      deductPerPctHigh: rates.high,
      deductPerPctLow: rates.low,
      raw: rawCriteria,
    },
  }
}

/** 报价集合去污：只保留有限正数，四舍五入到分（复用 money.ts 的 R34 分位精确口径） */
function cleanPrices(values: number[]): number[] {
  return values.map((v) => (Number.isFinite(v) ? centsToYuan(productCents([v])) : 0)).filter((v) => v > 0)
}

function mean(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** 得分统一保留 2 位小数（招标文件普遍按 2 位计），走 money.ts 分位精确舍入，不吃浮点尾差 */
function roundScore(v: number): number {
  return centsToYuan(productCents([v]))
}

/** 按口径算出评标基准价；样本不足或无法确定时返回 null + 人话原因 */
function computeBaseline(
  formula: PriceScoreFormula,
  validPrices: number[],
): { value: number; note: string } | null {
  const n = validPrices.length
  if (n < 2) return null
  if (formula.basis === "lowest") {
    const value = Math.min(...validPrices)
    return { value, note: `评标基准价＝最低有效报价 ${value.toFixed(2)} 元（${formula.basisLabel}）` }
  }
  const pool = formula.basis === "trimmed_average" ? trimmedPool(validPrices, n) : validPrices
  if (!pool) return null
  const avg = mean(pool)
  const value = avg * (1 - formula.floatPct / 100)
  const floatNote = formula.floatPct > 0 ? `，下浮 ${formula.floatPct}%` : ""
  return {
    value,
    note: `评标基准价＝${formula.basisLabel}${floatNote}＝${value.toFixed(2)} 元（样本 ${pool.length} 家）`,
  }
}

/** 去极值样本池：去掉一个最高、一个最低；凑不齐 3 家就没有「极值」可去 */
function trimmedPool(validPrices: number[], n: number): number[] | null {
  if (n < 3) return null
  const sorted = [...validPrices].sort((a, b) => a - b)
  return sorted.slice(1, -1)
}

/**
 * 价格分复算主入口。
 * otherPrices 为**不含我方**的已知有效报价；为空则不可测算（价格分是相对分，缺参照系）。
 */
export function scorePrice(
  formula: PriceScoreFormula,
  ourPrice: number,
  otherPrices: number[],
): { ok: true; result: PriceScoreResult } | { ok: false; reason: string } {
  const ours = cleanPrices([ourPrice])
  if (!ours.length) return { ok: false, reason: "我方报价无效（需为正数金额）" }
  const others = cleanPrices(otherPrices)
  if (!others.length) return { ok: false, reason: "缺有效对手报价：价格分是相对分，没有参照系无法测算" }

  const our = ours[0]
  const pool = [...others, our]
  const base = computeBaseline(formula, pool)
  if (!base) {
    return {
      ok: false,
      reason:
        formula.basis === "trimmed_average"
          ? "报价样本不足 3 家，无法去极值取平均"
          : "有效报价样本不足，无法确定评标基准价",
    }
  }

  if (formula.kind === "ratio") {
    // 比值法：我方报价即基准价时比值 1（满分），低于基准价不会出现 >1 的加分，故封顶
    const rawScore = Math.min(1, base.value / our) * formula.fullScore
    return { ok: true, result: { baseline: base.value, baselineNote: base.note, score: roundScore(rawScore), gap: roundScore(formula.fullScore - rawScore), deviationPct: null } }
  }

  const devPct = ((our - base.value) / base.value) * 100
  const perPct = devPct > 0 ? (formula.deductPerPctHigh ?? 0) : devPct < 0 ? (formula.deductPerPctLow ?? 0) : 0
  // 偏差按「不足 1% 的比例」线性计，是招标文件最常见写法；扣完为止（不为负、不超满分）
  const rawScore = Math.max(0, Math.min(formula.fullScore, formula.fullScore - Math.abs(devPct) * perPct))
  return {
    ok: true,
    result: {
      baseline: base.value,
      baselineNote: base.note,
      score: roundScore(rawScore),
      gap: roundScore(formula.fullScore - rawScore),
      deviationPct: roundScore(devPct),
    },
  }
}

/**
 * 报价阶梯：以我方报价为基准按百分比偏移逐档试算，每档都重算基准价
 * （均价类口径下我方报价本身进样本池，挪报价会拖动基准价，不能钉死基准价算）。
 * 传入 limits 时，越界档位保留分数但打上 invalidReason，避免「为拿满分降到废标价」这种建议。
 */
export function priceScoreLadder(
  formula: PriceScoreFormula,
  ourPrice: number,
  otherPrices: number[],
  stepsPct: number[] = [-5, -4, -3, -2, -1, 0, 1, 2],
  limits?: PriceLimits,
): { ok: true; steps: PriceStep[] } | { ok: false; reason: string } {
  const anchor = scorePrice(formula, ourPrice, otherPrices)
  if (!anchor.ok) return anchor
  const steps: PriceStep[] = []
  for (const pct of stepsPct) {
    const price = centsToYuan(productCents([ourPrice, 1 + pct / 100]))
    const one = scorePrice(formula, price, otherPrices)
    if (!one.ok) continue
    steps.push({
      price,
      score: one.result.score,
      delta: roundScore(one.result.score - anchor.result.score),
      invalidReason: checkPriceValidity(price, limits),
    })
  }
  return { ok: true, steps }
}

/**
 * 拿满价格分的报价临界值（对「报多少」这一决策最有用的一行）。
 * 去极值平均口径下我方报价可能正是被去掉的那个极值，闭式解不成立，返回 null 由阶梯表试算兜底。
 */
export function fullScoreTargetPrice(
  formula: PriceScoreFormula,
  ourPrice: number,
  otherPrices: number[],
  limits?: PriceLimits,
): { price: number; cutPct: number; note: string; invalidReason: string | null } | null {
  const ours = cleanPrices([ourPrice])
  const others = cleanPrices(otherPrices)
  if (!ours.length || !others.length || formula.basis === "trimmed_average") return null
  const our = ours[0]
  const n = others.length
  const sum = others.reduce((a, b) => a + b, 0)
  const fl = formula.floatPct / 100

  let price: number
  let note: string
  if (formula.basis === "lowest") {
    price = Math.min(...others)
    note = "报价不高于最低对手报价即得价格分满分"
  } else {
    // 均价口径下我方报价自身也进样本池，报高会拖动基准价，须解自洽不动点：
    //   p = (1-fl)·(S+p)/(n+1)  ⇒  p = (1-fl)·S/(n+fl)（fl=0 时退化为 S/n）
    // 比值法取 min(1, base/p)=1 与偏差法取 dev=0 都归结为这同一个临界价。
    const denom = n + fl
    if (denom <= 0) return null
    price = ((1 - fl) * sum) / denom
    note = formula.kind === "ratio"
      ? "报价不高于此值即得满分（基准价含自身报价并下浮，非对手算术平均）"
      : "报价与自身计入后的基准价相等时得满分（已含下浮）"
  }
  if (!Number.isFinite(price) || price <= 0) return null
  const pinned = centsToYuan(productCents([price]))
  return {
    price: pinned,
    cutPct: roundScore(((our - pinned) / our) * 100),
    note,
    invalidReason: checkPriceValidity(pinned, limits),
  }
}

const PRICE_ITEM_RE = /价格分|价格评分|报价得分|投标报价得分|价格权重|报价分/

/** 从评分项里挑出价格分项并识别口径；跳过识别不出的项，便于 UI 只展示能算的 */
export function findPriceScoringItem(items: ScoringItem[]): {
  item: ScoringItem
  formula: PriceScoreFormula
} | null {
  for (const it of items) {
    const text = `${it.item}${it.criteria}`
    if (!PRICE_ITEM_RE.test(text)) continue
    const parsed = parsePriceFormula(it.criteria, it.score)
    if (parsed.ok) return { item: it, formula: parsed.formula }
  }
  return null
}

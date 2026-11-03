// ---------------------------------------------------------------------------
// R38（B12）价格分测算接 UI：第 6 步「模拟评标」的确定性视图模型
// 纯函数、零 AI、零新 collection —— 手输的对手报价只活在会话内，不落库。
//
// 缘起：R35 交付了价格分算法层（priceScoreModel.ts）、R36 修对了临界价闭式解，但全仓检索
// 显示该模块除自身单测外没有任何调用点——公式进了库、分也算得出，用户却一个入口都摸不到
// （账本 B12：high，用户入口为 0）。本层把「评分项 → 口径识别 → 我方报价 → 对手报价 →
// 得分 / 拿满分临界价 / 敏感性阶梯」串成一个可单测的纯函数，组件只负责渲染，
// 判定与文案口径集中在这一处，避免同一套规则在 JSX 里二次实现。
//
// 口径纪律（与 R35「认不出就不算」、B8 折扣歧义同一脉：不静默给错数）：
// ① 价格分是相对分：没有对手报价就只说原因，不输出任何数字冒充招标文件的结论；
// ② 我方报价取自「关联商机」的报价单真实总额（与 numeric-consistency-02 做法 B 同源，单源复用）；
//    对手报价只能手输——竞对情报里 competitor_evidence 存的是**中标金额**，不是本次投标报价，
//    冒用会把评标基准价算歪，故本层不提供任何自动带入；
// ③ 手输单位歧义（把「1200 万」写成「1200」）不静默换算：按所填单位如实计算，
//    另挂 unitHint 提醒复核（与 B8「不静默钳位」同处置口径）。
// ④ 报价有效性（R64）：「我方当前报价」与「建议价」同等受报价条款约束。此前 checkPriceValidity
//    只挂在建议价/阶梯上，于是出现「现价 800 万 < 限价 45%（1125 万）会废标，面板却写
//    『当前报价已拿满价格分，无需再降』并给满分」的自相矛盾——废标价拿满分毫无意义。
//    现价触犯条款时一律置 ourPriceInvalid，由面板置顶红字提示，且不再说「无需再降」。
// ---------------------------------------------------------------------------

import { centsToYuan, formatMoney, productCents } from "@/lib/money"
import { priceCeilingFromFacts, type ScoringItem } from "./bidTypes"
import {
  checkPriceValidity,
  fullScoreTargetPrice,
  listPriceScoringCandidates,
  priceScoreLadder,
  scorePrice,
  type PriceBasis,
  type PriceLimits,
  type PriceScoreFormula,
  type PriceScoreResult,
  type PriceStep,
} from "./priceScoreModel"

/** 敏感性阶梯档位（与 priceScoreModel.priceScoreLadder 缺省一致，显式写出便于与面板文案对齐） */
export const LADDER_PCTS = [-5, -4, -3, -2, -1, 0, 1, 2]

const KIND_LABEL: Record<PriceScoreFormula["kind"], string> = {
  ratio: "比值法（评标基准价 ÷ 投标报价 × 满分）",
  deviation: "偏差扣分法（等于基准价得满分，按偏差率线性扣分）",
}

/** 手输金额：数字 + 可选单位；无单位一律按「元」如实计算（不做「看着像万元」的猜测换算） */
const MONEY_RE = /^([0-9]+(?:\.[0-9]+)?)(亿元|亿|万元|万|千元|千|元)?$/
const UNIT_MULT: Record<string, number> = {
  亿元: 1e8,
  亿: 1e8,
  万元: 1e4,
  万: 1e4,
  千元: 1e3,
  千: 1e3,
  元: 1,
}

export type MoneyParse = { value: number | null; error: string | null }

/** 解析单个手输金额：空串=未填（不算错）；写法不对=给出可复述的原文与合法写法示例 */
export function parseMoneyInput(raw: string): MoneyParse {
  const src = (raw ?? "").trim()
  const s = src.replace(/[,，\s]/g, "").replace(/^(?:RMB|¥|￥)/i, "")
  if (!s) return { value: null, error: null }
  const m = MONEY_RE.exec(s)
  if (!m) {
    return { value: null, error: `无法识别的金额写法「${src.slice(0, 24)}」，请用「1200万」「12000000」或「1.2亿」` }
  }
  const num = Number(m[1])
  const mult = m[2] ? UNIT_MULT[m[2]] : 1
  if (!Number.isFinite(num) || num <= 0 || !Number.isFinite(mult)) return { value: null, error: "金额需为正数" }
  return { value: centsToYuan(productCents([num, mult])), error: null }
}

/**
 * 解析对手报价清单：换行/分号为主分隔，行内逗号按「千分位还是分隔符」启发式区分
 * （`1,200,000` 归一为 1200000；`1200,1500` 判为两个报价）。无法识别的原文逐条回传，
 * 让 UI 明确告诉用户哪几条没进测算，而不是静默丢掉参照样本。
 */
export function parsePriceListInput(raw: string): { prices: number[]; rejected: string[] } {
  const prices: number[] = []
  const rejected: string[] = []
  for (const line of (raw ?? "").split(/[\n;；]+/)) {
    const merged = line.replace(/([0-9])[,，](?=[0-9]{3}(?:\.[0-9]+)?(?:\s*(?:万元|亿元|元|亿|万|千)?)?(?![0-9]))/g, "$1")
    for (const token of merged.split(/[,，、]+/)) {
      const t = token.trim()
      if (!t) continue
      const p = parseMoneyInput(t)
      if (p.value !== null && !p.error) prices.push(p.value)
      else rejected.push(t)
    }
  }
  return { prices, rejected }
}

/** 金额回显：亿/万元为主读法，括号内给到分的元值——价格分核对最终以元对齐，避免两套单位各说各话 */
export function fmtPriceText(yuan: number): string {
  if (!Number.isFinite(yuan) || yuan <= 0) return "—"
  if (yuan >= 1e8) return `${formatMoney(yuan / 1e8)} 亿元（${formatMoney(yuan)} 元）`
  if (yuan >= 1e4) return `${formatMoney(yuan / 1e4)} 万元（${formatMoney(yuan)} 元）`
  return `${formatMoney(yuan)} 元`
}

/** 分值回显：最多 2 位小数并去尾零（招标普遍按 2 位计，0.5 分不写成 0.50） */
export function fmtScore(v: number): string {
  if (!Number.isFinite(v)) return "—"
  return String(Math.round(v * 100) / 100)
}

export type PriceScorePhase =
  /** 解析报告里还没有评分办法 */
  | "no-scoring"
  /** 有评分办法但抽不到价格分项 */
  | "no-price-item"
  /** 有价格分项但口径认不出（不算、只说明） */
  | "unrecognized"
  /** 口径可算，但输入还没齐 */
  | "await-input"
  /** 输入齐了但样本不足以确定基准价（沿用算法层的人话原因） */
  | "not-computable"
  /** 出数 */
  | "computed"

export type PriceFormulaView = {
  /** 评分项名称，供用户与评分表逐条核对 */
  name: string
  kind: PriceScoreFormula["kind"]
  kindLabel: string
  basis: PriceBasis
  basisLabel: string
  floatPct: number
  fullScore: number
  /** 偏差法的费率说明；比值法为 null */
  deductText: string | null
  /** 公式原文（口径必须能与招标文件逐字对上） */
  raw: string
  /** 「基准价口径 + 临界价是否含下浮」这句人话，账本 focus 点名要求显式写出 */
  plainNote: string
}

export type PriceCandidateNote = { name: string; score: number; reason: string }

export type PriceTargetView = {
  price: number
  cutPct: number
  note: string
  text: string
  invalidReason: string | null
}

export type PriceStepView = PriceStep & { isAnchor: boolean }

export type PriceScoreViewInput = {
  items: ScoringItem[]
  factLines: string[]
  ourPriceText: string
  competitorText: string
  /** 留空即取事实表里的最高限价/预算；填写即人工覆盖（以人工为准，不静默改写） */
  ceilingText: string
  /** 低于最高限价该比例按无效标处理（%），招标文件多写在废标条款里；留空即不校验 */
  minValidRatioText: string
}

export type PriceScoreView = {
  phase: PriceScorePhase
  /** 价格分候选评分项与各自的识别结论；口径认不出时逐条给用户原因 */
  candidates: PriceCandidateNote[]
  formula: PriceFormulaView | null
  ourPrice: number | null
  ourPriceError: string | null
  competitorCount: number
  competitorRejected: string[]
  ceiling: { value: number; src: string; fromInput: boolean } | null
  ceilingError: string | null
  minValidRatioPct: number | null
  minValidRatioError: string | null
  /**
   * 我方当前报价触犯报价有效性条款（超最高限价 / 低于无效标比例）时的原因，null = 合法或没填门槛。
   * 与 target.invalidReason（建议价是否合法）分开：一个是「你现在的价」，一个是「建议你报的价」。
   */
  ourPriceInvalid: string | null
  /** 单位歧义提醒（不换算，只提醒） */
  unitHint: string | null
  /** 没出数时的人话原因；出数时为 null */
  note: string | null
  result: PriceScoreResult | null
  target: PriceTargetView | null
  steps: PriceStepView[]
}

function emptyView(phase: PriceScorePhase): PriceScoreView {
  return {
    phase,
    candidates: [],
    formula: null,
    ourPrice: null,
    ourPriceError: null,
    competitorCount: 0,
    competitorRejected: [],
    ceiling: null,
    ceilingError: null,
    minValidRatioPct: null,
    minValidRatioError: null,
    ourPriceInvalid: null,
    unitHint: null,
    note: null,
    result: null,
    target: null,
    steps: [],
  }
}

/** 去极值平均口径没有「拿满分就报 X」的闭式解（我方报价可能正是被剔掉的那个极值），文案要如实说明 */
function targetView(
  formula: PriceScoreFormula,
  our: number,
  others: number[],
  limits: PriceLimits,
  gap: number,
  /** R64：现价已触犯报价有效性条款时的原因；此时「无需再降」是误导（该提价才合法） */
  ourInvalid: string | null,
): PriceTargetView | null {
  const t = fullScoreTargetPrice(formula, our, others, limits)
  if (!t) return null
  let text: string
  // 现价废标优先于「已拿满分」：先解决有效性，再谈价格分
  if (ourInvalid) text = "先解决废标：当前报价不合法，价格分再高也拿不到"
  else if (gap <= 0) text = "当前报价已拿满价格分，无需再降"
  else if (t.price >= our) text = "按该口径不存在「比现价更高才满分」的解，请对照下方阶梯复核"
  else text = `报 ${fmtPriceText(t.price)} 及以内可拿满价格分（较现价低 ${fmtScore(t.cutPct)}%）`
  return { price: t.price, cutPct: t.cutPct, note: t.note, text, invalidReason: t.invalidReason }
}

/**
 * 主入口：把一次面板输入算成完整视图。任何「没出数」的分支都带一句人话原因，
 * 且绝不返回部分数字（半成品数字比没有数字更危险）。
 */
export function buildPriceScoreView(input: PriceScoreViewInput): PriceScoreView {
  const items = input.items ?? []
  const candidates = listPriceScoringCandidates(items)

  if (!items.length) {
    const v = emptyView("no-scoring")
    v.note = "解析报告里还没有评分办法，价格分无从谈起——先完成 AI 解析报告环节。"
    return v
  }
  if (!candidates.length) {
    const v = emptyView("no-price-item")
    v.note = `共 ${items.length} 个评分项，没有一项的名称或评分标准提到价格分/报价得分——请确认招标文件是否单列价格分。`
    return v
  }

  const notes: PriceCandidateNote[] = candidates.map((c) => ({
    name: c.item.item,
    score: c.item.score,
    reason: c.parse.ok ? "已识别为可复算口径" : c.parse.reason,
  }))

  const hit = candidates.find((c) => c.parse.ok)
  if (!hit || !hit.parse.ok) {
    const v = emptyView("unrecognized")
    v.candidates = notes
    v.note = "价格分项存在，但评分标准里的口径无法机械复算，本面板不出数（认不出就不算，不代招标文件猜数）。"
    return v
  }

  const formula = hit.parse.formula
  const view = emptyView("await-input")
  view.candidates = notes
  view.formula = {
    name: hit.item.item,
    kind: formula.kind,
    kindLabel: KIND_LABEL[formula.kind],
    basis: formula.basis,
    basisLabel: formula.basisLabel,
    floatPct: formula.floatPct,
    fullScore: formula.fullScore,
    deductText:
      formula.kind === "deviation"
        ? `每高于基准价 1% 扣 ${fmtScore(formula.deductPerPctHigh ?? 0)} 分，每低于 1% 扣 ${fmtScore(formula.deductPerPctLow ?? 0)} 分`
        : null,
    raw: formula.raw,
    plainNote:
      `评标基准价口径：${formula.basisLabel}` +
      (formula.floatPct > 0 ? `，并下浮 ${fmtScore(formula.floatPct)}%` : "，无下浮") +
      `；满分 ${fmtScore(formula.fullScore)} 分。均价类口径下我方报价自身也进样本池，` +
      "临界价已含下浮率与自身报价对基准价的拉动，不是对手的算术平均。",
  }

  // 报价天花板：人工覆盖优先，否则取事实表（沿用 R42 硬限价优先于预算的既有口径）
  const ceilingParse = parseMoneyInput(input.ceilingText)
  view.ceilingError = ceilingParse.error
  const factCeiling = priceCeilingFromFacts(input.factLines ?? [])
  if (ceilingParse.value !== null && !ceilingParse.error) {
    view.ceiling = { value: ceilingParse.value, src: "人工填写", fromInput: true }
  } else if (factCeiling) {
    view.ceiling = { value: factCeiling.ceiling, src: factCeiling.src, fromInput: false }
  }

  const ratioSrc = (input.minValidRatioText ?? "").trim().replace(/[%％\s]/g, "")
  if (ratioSrc) {
    const ratio = Number(ratioSrc)
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 100) {
      view.minValidRatioError = `无效标比例「${ratioSrc.slice(0, 16)}」应为 0-100 之间的百分数`
    } else {
      view.minValidRatioPct = ratio
    }
  }

  const our = parseMoneyInput(input.ourPriceText)
  view.ourPriceError = our.error
  if (our.error) {
    view.note = our.error
    return view
  }
  if (our.value === null) {
    view.note = "还没填我方投标报价：可直接用「取自报价单」带入关联商机的报价单总额，或手工填写。"
    return view
  }
  view.ourPrice = our.value

  const comps = parsePriceListInput(input.competitorText)
  view.competitorCount = comps.prices.length
  view.competitorRejected = comps.rejected
  if (!comps.prices.length) {
    view.note =
      "价格分是相对分：请至少手工填写 1 个已知对手的有效报价（每行一个）。" +
      "竞对情报里存的是历史中标金额，不等于本次投标报价，因此不自动带入。"
    return view
  }

  const limits: PriceLimits = {}
  if (view.ceiling) limits.maxPrice = view.ceiling.value
  if (view.minValidRatioPct != null) limits.minValidRatioPct = view.minValidRatioPct

  // R64：现价先过一遍报价有效性条款——废标价的价格分再高也没有意义，必须先说这一句
  view.ourPriceInvalid = checkPriceValidity(our.value, limits)

  // 单位歧义提醒：不足天花板 1% 的价格极可能是把「万元」当「元」填了，如实计算但要点破
  if (view.ceiling) {
    const lowThreshold = view.ceiling.value / 100
    const suspicious = [our.value, ...comps.prices].filter((p) => p < lowThreshold).length
    if (suspicious) {
      view.unitHint =
        `有 ${suspicious} 个报价不足${view.ceiling.src}的 1%，疑似把「万元」按「元」填写。` +
        "本测算按所填单位如实计算，不做静默换算，请核对单位后重算。"
    }
  }

  const scored = scorePrice(formula, our.value, comps.prices)
  if (!scored.ok) {
    view.phase = "not-computable"
    view.note = scored.reason
    return view
  }

  view.phase = "computed"
  view.note = null
  view.result = scored.result
  view.target = targetView(formula, our.value, comps.prices, limits, scored.result.gap, view.ourPriceInvalid)
  const ladder = priceScoreLadder(formula, our.value, comps.prices, LADDER_PCTS, limits)
  view.steps = ladder.ok
    ? ladder.steps.map((s) => ({ ...s, isAnchor: centsToYuan(productCents([s.price])) === our.value }))
    : []
  return view
}

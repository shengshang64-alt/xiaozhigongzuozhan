// R35 监工独立复验 · priceScoreModel 全量回归锁
// 由监工（非 Qoder）编写：只调用被测导出函数，与脚本内手算真值比对。
// 用法：npx vite-node docs/evolution/_r35_price_score_recheck.mts
// 期望：全部通过。缺陷未修复时，「比值法 + 均价 + 下浮」相关 2 项会失败。
import {
  scorePrice,
  fullScoreTargetPrice,
  checkPriceValidity,
  parsePriceFormula,
  priceScoreLadder,
  type PriceScoreFormula,
} from "../../src/pages/BidWorkspace/priceScoreModel"

const fail: string[] = []
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail.push(`${label}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
  console.log(`${ok ? "✓" : "✗"} ${label} → ${JSON.stringify(got)}`)
}
/** 独立真值舍入到 2 位（toFixed 独立于被测实现） */
const r2 = (v: number): number => Number(v.toFixed(2))

// ---- 1) 比值法 · 最低价口径 ----
const fLow: PriceScoreFormula = {
  kind: "ratio",
  basis: "lowest",
  basisLabel: "x",
  floatPct: 0,
  fullScore: 10,
  deductPerPctHigh: null,
  deductPerPctLow: null,
  raw: "",
}
{
  const others = [12000000, 15000000, 18000000]
  const our = 24800000
  const r = scorePrice(fLow, our, others)
  const truthBase = Math.min(...others, our)
  eq("比值法·最低价：基准价", (r as { result?: { baseline: number } }).result?.baseline, truthBase)
  eq("比值法·最低价：得分", (r as { result?: { score: number } }).result?.score, r2(Math.min(1, truthBase / our) * 10))
}
{
  const r = scorePrice(fLow, 10000000, [24800000, 30000000])
  eq("我方即最低 → 满分", (r as { result?: { score: number } }).result?.score, 10)
}

// ---- 2) 比值法 · 均价 + 下浮 ----
const fAvg: PriceScoreFormula = { ...fLow, basis: "average", basisLabel: "y", floatPct: 3 }
{
  const others = [10000000, 20000000, 30000000]
  const our = 20000000
  const r = scorePrice(fAvg, our, others)
  const base = ((10000000 + 20000000 + 30000000 + our) / 4) * 0.97
  eq("比值法·均价+下浮3%：基准价", (r as { result?: { baseline: number } }).result?.baseline, base)
  eq("比值法·均价+下浮3%：得分", (r as { result?: { score: number } }).result?.score, r2(Math.min(1, base / our) * 10))
}

// ---- 3) 偏差法 ----
const fDev: PriceScoreFormula = {
  kind: "deviation",
  basis: "average",
  basisLabel: "z",
  floatPct: 0,
  fullScore: 10,
  deductPerPctHigh: 0.5,
  deductPerPctLow: 0.5,
  raw: "",
}
{
  const others = [10000000, 20000000]
  const our = 20000000
  const r = scorePrice(fDev, our, others)
  const base = (10000000 + 20000000 + our) / 3
  const dev = ((our - base) / base) * 100
  eq("偏差法：偏差率", (r as { result?: { deviationPct: number } }).result?.deviationPct, r2(dev))
  eq("偏差法：得分", (r as { result?: { score: number } }).result?.score, r2(Math.max(0, Math.min(10, 10 - Math.abs(dev) * 0.5))))
}

// ---- 4) 不动点自洽：按 fullScoreTargetPrice 报回去，必须真得满分 ----
{
  // 偏差法 + 均价 + 下浮 3%
  const others = [10000000, 18000000, 26000000]
  const t = fullScoreTargetPrice(fDev, 22000000, others)
  if (!t) fail.push("偏差法不动点返回 null（应给闭式解）")
  else {
    const S = others.reduce((a, b) => a + b, 0)
    const truth = (1 - fDev.floatPct / 100) * S / (others.length + fDev.floatPct / 100)
    eq("偏差法不动点：临界价", t.price, r2(truth))
    eq("偏差法不动点自洽：得满分", (scorePrice(fDev, t.price, others) as { result?: { score: number } }).result?.score, 10)
  }
}
{
  // 比值法 + 均价 + 下浮 3%（闭式解须含下浮率）
  const others = [10000000, 20000000, 30000000]
  const t = fullScoreTargetPrice(fAvg, 22000000, others)
  if (!t) fail.push("比值法+均价临界价返回 null")
  else {
    const S = others.reduce((a, b) => a + b, 0)
    const fl = fAvg.floatPct / 100
    eq("比值法+均价+下浮：临界价", t.price, r2((1 - fl) * S / (others.length + fl)))
    eq("比值法+均价+下浮：自洽得满分", (scorePrice(fAvg, t.price, others) as { result?: { score: number } }).result?.score, 10)
  }
}
{
  // 比值法 + 最低价：临界价 = 最低对手价
  const others = [10000000, 20000000]
  const t = fullScoreTargetPrice(fLow, 22000000, others)
  eq("比值法·最低价临界价", t?.price, 10000000)
  eq("比值法·最低价自洽：得满分", (scorePrice(fLow, 10000000, others) as { result?: { score: number } }).result?.score, 10)
}

// ---- 5) 废标区间守护 ----
eq("越界：超过最高限价", checkPriceValidity(26000000, { maxPrice: 25000000, minValidRatioPct: 45 }), "超过最高限价 25000000.00 元，按无效投标处理")
eq("越界：低于限价45%", checkPriceValidity(10000000, { maxPrice: 25000000, minValidRatioPct: 45 }), "低于最高限价的 45%（11250000.00 元），按无效投标处理")
eq("边界：恰在地板价上（有效）", checkPriceValidity(11250000, { maxPrice: 25000000, minValidRatioPct: 45 }), null)
eq("边界：恰在限价上（有效）", checkPriceValidity(25000000, { maxPrice: 25000000, minValidRatioPct: 45 }), null)
eq("无 limits 不校验", checkPriceValidity(1, undefined), null)

// ---- 6) 拒绝出口（不猜数）----
eq("拒绝：缺对手报价", scorePrice(fLow, 1000000, []), { ok: false, reason: "缺有效对手报价：价格分是相对分，没有参照系无法测算" })
eq("拒绝：公式不可复算", parsePriceFormula("价格分由评委酌情评定", 10).ok, false)
eq("拒绝：未标明基准价", parsePriceFormula("投标报价得分=（评标基准价/投标报价）×10％×100", 10).ok, false)
eq("拒绝：满分冲突不静默取一", parsePriceFormula("价格分统一采用低价优先法，投标报价得分＝（评标基准价/投标报价）×20％×100", 10).ok, false)
eq("拒绝：去极值无闭式解 → null", fullScoreTargetPrice({ ...fAvg, basis: "trimmed_average" }, 1000, [100, 200, 300]), null)

// ---- 7) 阶梯每档重算基准价 ----
{
  const others = [10000000, 20000000, 30000000]
  const l = priceScoreLadder(fAvg, 20000000, others)
  if (!l.ok) fail.push("阶梯应可算")
  else {
    eq("阶梯 0 档与直接测算一致", l.steps.find((s) => s.delta === 0)?.score, (scorePrice(fAvg, 20000000, others) as { result?: { score: number } }).result?.score)
    eq("阶梯 -5% 档价格", l.steps[0]?.price, r2(20000000 * 0.95))
  }
}

console.log(fail.length ? `✗ 失败 ${fail.length} 项：\n${fail.join("\n")}` : "✓ 全部通过")
process.exit(fail.length ? 1 : 0)

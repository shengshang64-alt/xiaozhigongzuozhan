// R37 / B9 建设清单金额分位审计。
// 用法：npx vite-node docs/evolution/_r37_checklist_cent_audit.mts
//
// 目的：证明「建设清单」金额链路（calcTotal / subtotalOfLines / 分类小计 / Excel 导出三处合计）
// 用的是二进制浮点直接累加，在「单价带 3 位以上小数」时会在分位产生偏差，
// 且导出文件里「逐行小计之和 ≠ 合计」—— 与 R34 报价域同一类缺陷（两套数字，被质疑级风险）。
//
// 参照实现：R34 已确立的 money.ts 口径（各因子取 1e-6 微元 → BigInt 精确相乘 → 分位远离零舍入）。

import { calcTotal, lineSubtotalYuan, type ChecklistLine } from "@/pages/SolutionStudio/checklistTypes"
import { subtotalOfLines, summarizeChecklistCategories } from "@/pages/SolutionStudio/checklistSummary"

/** 元 → 整数分（用于跨口径严格比对，规避 1e-13 级二进制尾差） */
const centsOf = (yuan: number) => Math.round(yuan * 100)

/** 精确十进制参照：qty × unit_price，分位远离零舍入，返回整数分 */
function exactLineCents(qty: number, price: number): number {
  const Q = BigInt(Math.round((Number.isFinite(qty) ? qty : 0) * 1e6))
  const P = BigInt(Math.round((Number.isFinite(price) ? price : 0) * 1e6))
  const N = Q * P
  const DEN = 10n ** 12n
  return Number((N * 200n + DEN) / (2n * DEN))
}

/** 冻结的修复前实现（checklistTypes.ts:223-227 原样抄录） */
function oldCalcTotal(lines: ChecklistLine[]): number {
  return (lines ?? [])
    .filter((l) => l.checked !== false)
    .reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0)
}

function line(over: Partial<ChecklistLine>): ChecklistLine {
  return {
    line_id: "l",
    category: "HIS",
    product_line: "",
    product_name: "x",
    module_name: "",
    module_func: "",
    unit: "套",
    qty: 1,
    unit_price: 0,
    source: "company",
    rating_hits: [],
    remark: "",
    product_id: "p",
    checked: true,
    ...over,
  }
}

// ---------------------------------------------------------------- 1) 随机对拍
let seed = 20261014
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

const dec = () => [0, 0, 0, 1, 2, 3, 4][Math.floor(rnd() * 7)] // 小数位：常见 0-2 位，偶发 3-4 位
const r2 = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

let badOldTotal = 0
let badNewTotal = 0
let badOldSub = 0
let badExportLineSumOld = 0
let badExportCatSumOld = 0
let badExportMismatchNew = 0
const samples: { qty: number; price: number; line: number; oldSum: number; exact: number }[] = []

const TRIALS = 200000
for (let t = 0; t < TRIALS; t++) {
  const n = 1 + Math.floor(rnd() * 8)
  const lines: ChecklistLine[] = []
  let exactSum = 0
  for (let i = 0; i < n; i++) {
    const qty = 1 + Math.floor(rnd() * 50)
    const price = r2(rnd() * 1e7, dec())
    lines.push(line({ line_id: `l${i}`, qty, unit_price: price, category: ["HIS", "LIS", "硬件"][i % 3] }))
    const c = exactLineCents(qty, price)
    exactSum += c
    const oldLine = qty * price
    if (Math.abs(oldLine - c / 100) > 1e-9 && samples.length < 3) {
      samples.push({ qty, price, line: oldLine, oldSum: 0, exact: c / 100 })
    }
  }

  if (Math.abs(oldCalcTotal(lines) - exactSum / 100) > 1e-9) badOldTotal++
  if (Math.abs(calcTotal(lines) - exactSum / 100) > 1e-9) badNewTotal++
  if (Math.abs(subtotalOfLines(lines) - exactSum / 100) > 1e-9) badOldSub++

  // 导出文件一致性（修复前，全部用冻结的浮点实现）：
  // (a) 客户在 Excel 里最直接的体验 —— 把「小计」列按分四舍五入后相加，是否等于「合计」格
  const oldLineRoundedSum = lines.reduce((s, l) => s + Math.round(l.qty * l.unit_price * 100) / 100, 0)
  const oldGrand = oldCalcTotal(lines)
  if (centsOf(oldLineRoundedSum) !== centsOf(oldGrand)) badExportLineSumOld++
  // (b) 分类小计之和 vs 合计 —— 同为浮点口径，仅求和顺序不同
  const oldCatMap = new Map<string, number>()
  for (const l of lines) oldCatMap.set(l.category, (oldCatMap.get(l.category) ?? 0) + l.qty * l.unit_price)
  const oldCatSum = Array.from(oldCatMap.values()).reduce((s, v) => s + v, 0)
  if (centsOf(oldCatSum) !== centsOf(oldGrand)) badExportCatSumOld++

  // 新口径（调用真实函数）：行小计之和 / 分类小计之和 必须严格等于 合计
  const newGrand = calcTotal(lines)
  const newLineSum = lines.reduce((s, l) => s + lineSubtotalYuan(l), 0)
  const newCatSum = summarizeChecklistCategories(lines).reduce((s, c) => s + c.subtotal, 0)
  if (centsOf(newLineSum) !== centsOf(newGrand) || centsOf(newCatSum) !== centsOf(newGrand)) badExportMismatchNew++
}

console.log("=== 1) 随机对拍（20 万组，单价小数位 0-4 位混布） ===")
console.log({
  TRIALS,
  badOldTotal,
  badNewTotal,
  badOldSub,
  badExportLineSumOld,
  badExportCatSumOld,
  badExportMismatchNew,
})
console.log("逐行小计与精确值的偏差样本（qty / price / 浮点行小计 / 精确值）：")
for (const s of samples) console.log("  ", s)

// ---------------------------------------------------------------- 2) 可复现的定点案例
console.log("\n=== 2) 定点案例（客户可复算） ===")
const demo = [
  line({ line_id: "d1", category: "HIS", qty: 7, unit_price: 12345.678 }),
  line({ line_id: "d2", category: "HIS", qty: 3, unit_price: 9876.543 }),
  line({ line_id: "d3", category: "硬件", qty: 11, unit_price: 4321.005 }),
]
const demoExactCents = demo.reduce((s, l) => s + exactLineCents(l.qty, l.unit_price), 0)
console.log("  逐行（数量 × 单价 → 浮点小计 → 精确小计）:")
for (const l of demo) {
  const exact = exactLineCents(l.qty, l.unit_price) / 100
  const raw = l.qty * l.unit_price
  console.log(`    ${l.qty} × ${l.unit_price} = ${raw}  | 精确 ${exact} ${Math.abs(raw - exact) > 1e-9 ? "← 偏差" : ""}`)
}
console.log("  修复前 calcTotal:", oldCalcTotal(demo), " 精确:", demoExactCents / 100)
console.log("  修复前 逐行小计之和:", demo.reduce((s, l) => s + l.qty * l.unit_price, 0))
console.log("  修复前 分类小计之和:", summarizeChecklistCategories(demo).reduce((s, c) => s + c.subtotal, 0))
console.log("  修复后 calcTotal:", calcTotal(demo))

const demoOk =
  badNewTotal === 0 &&
  Math.abs(calcTotal(demo) - demoExactCents / 100) < 1e-9
console.log("\n判定：", demoOk ? "✓ 新口径全部与精确值一致" : `✗ 仍有偏差（badNewTotal=${badNewTotal}）`)

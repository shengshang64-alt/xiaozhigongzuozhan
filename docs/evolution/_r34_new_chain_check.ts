// R34 新链路复核（与 _r34_amount_drift_audit.mjs 同一批种子、同一 BigInt 参照）。
// 用法：npx vite-node docs/evolution/_r34_new_chain_check.ts
// 期望输出：badItem=0 / badGroup=0 / badTotal=0，即修复后逐分与精确十进制定点一致。
import { itemSubtotal, groupSubtotal, quoteTotal, quoteTotalCents } from "@/pages/PptQuote/pptQuoteTypes"
import { cnyToUpper } from "@/lib/currencyCn"

const norm = (d: number) => (!Number.isFinite(d) || d <= 0 ? 100 : Math.min(100, d))
function exactCents(qty: number, price: number, disc: number): number {
  const Q = BigInt(Math.round(qty * 1e6))
  const P = BigInt(Math.round(price * 1e6))
  const D = BigInt(Math.round(norm(disc) * 1e6))
  const N = Q * P * D
  const DEN = 10n ** 18n
  return Number((N * 2n + DEN) / (2n * DEN))
}

let badItem = 0
let badGroup = 0
let badTotal = 0
const first: unknown[] = []
let seed = 12345
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
for (let t = 0; t < 200000; t++) {
  const n = 1 + Math.floor(rnd() * 8)
  const items = []
  for (let i = 0; i < n; i++) {
    const qty = Math.round(rnd() * 40) / (rnd() < 0.3 ? 2 : 1)
    const price = Math.round(rnd() * 1e8) / 100
    const disc = [100, 95, 90, 85, 80, 88, 70, 66.667][Math.floor(rnd() * 8)]
    items.push({ id: `i${i}`, item_name: "x", spec: "", unit: "套", qty, price, discount: disc })
    const cents = exactCents(qty, price, disc)
    if (Math.abs(itemSubtotal(items[i]) - cents / 100) > 1e-9) {
      badItem++
      if (first.length < 3) first.push({ qty, price, disc, got: itemSubtotal(items[i]), want: cents / 100 })
    }
  }
  const g = { id: "g", name: "x", items }
  const sumCents = items.reduce((s, it) => s + exactCents(it.qty, it.price, it.discount), 0)
  if (groupSubtotal(g) !== sumCents / 100) badGroup++
  if (quoteTotalCents([g]) !== sumCents) badTotal++
  if (quoteTotal([g]) !== sumCents / 100) badTotal++
}
console.log({ badItem, badGroup, badTotal, trials: 200000, first })
const demo = [15, 599729.21, 90]
const yuan = itemSubtotal({
  id: "d",
  item_name: "HIS",
  spec: "",
  unit: "套",
  qty: demo[0],
  price: demo[1],
  discount: demo[2],
} as never)
console.log("半分示例：15 × 599,729.21 × 90% =", yuan, "→", cnyToUpper(yuan, { prefixRmb: true }))

// 监工独立复验（foreman recheck）· R35 priceScoreModel
// 本文件由监工（非 Qoder）编写：验证 fullScoreTargetPrice 的闭式解自洽性。
// 用法：npx vite-node docs/evolution/_r35_foreman_recheck.mts
// 期望：全部通过。缺陷未修复时，「比值法 + 均价 + 下浮率」组合会失败。
import { scorePrice, fullScoreTargetPrice, type PriceScoreFormula } from "../../src/pages/BidWorkspace/priceScoreModel"

const r2 = (v: number): number => Number(v.toFixed(2))
const fail: string[] = []

// 均价口径 + 比值法 + 下浮 3%
const f: PriceScoreFormula = {
  kind: "ratio",
  basis: "average",
  basisLabel: "y",
  floatPct: 3,
  fullScore: 10,
  deductPerPctHigh: null,
  deductPerPctLow: null,
  raw: "",
}
const others = [10000000, 20000000, 30000000]

const t = fullScoreTargetPrice(f, 22000000, others)
console.log("代码给的临界价:", t?.price, "| note:", t?.note)

// 独立推导：base = (S + p) / (n + 1) * (1 - fl)；比值 = base / p = 1
//   ⇒ p * (n + 1) = (1 - fl) * (S + p)  ⇒  p * (n + fl) = (1 - fl) * S
//   ⇒ p = (1 - fl) * S / (n + fl)
const S = others.reduce((a, b) => a + b, 0)
const n = others.length
const fl = f.floatPct / 100
const truth = (1 - fl) * S / (n + fl)
console.log("真值临界价:", r2(truth))

if (!t) {
  fail.push("临界价返回 null（应给闭式解）")
} else {
  if (Math.abs(t.price - r2(truth)) > 0.01) {
    fail.push(`临界价偏差：代码 ${t.price} vs 真值 ${r2(truth)}`)
  }
  // 自洽：按代码给的价报回去，必须真得满分
  const back = scorePrice(f, t.price, others)
  console.log("按代码临界价报回去的得分:", back.ok ? back.result.score : back.reason, "（应 = 10）")
  if (!back.ok || Math.abs(back.result.score - 10) > 0.005) {
    fail.push(`自洽失败：${back.ok ? back.result.score : back.reason}`)
  }
}

// 对照：按真值价报回去应得满分
{
  const back = scorePrice(f, truth, others)
  console.log("按真值临界价报回去的得分:", back.ok ? back.result.score : back.reason, "（应 = 10）")
  if (!back.ok || Math.abs(back.result.score - 10) > 0.005) {
    fail.push(`真值也不自洽：${back.ok ? back.result.score : back.reason}`)
  }
}

// 顺带钉住偏差法同组合（该分支本来就是对的，防回归）
{
  const fd: PriceScoreFormula = { ...f, kind: "deviation", deductPerPctHigh: 0.5, deductPerPctLow: 0.5 }
  const td = fullScoreTargetPrice(fd, 22000000, others)
  const back = td ? scorePrice(fd, td.price, others) : null
  console.log("偏差法同组合：临界价", td?.price, "报回去得分", back && back.ok ? back.result.score : "n/a")
  if (!td || !back || !back.ok || Math.abs(back.result.score - 10) > 0.005) {
    fail.push("偏差法+均价+下浮 自洽失败（回归）")
  }
}

console.log(fail.length ? `✗ 缺陷确认：${fail.join("；")}` : "✓ 全部通过")
process.exit(fail.length ? 1 : 0)

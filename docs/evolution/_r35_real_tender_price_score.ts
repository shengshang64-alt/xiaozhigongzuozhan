// R35 证据脚本：把真实招标文件（.diag/r50_tender.txt，395,128 字节）里的价格分条款
// 直接喂给 priceScoreModel，验证识别与复算是否对得上招标文件原话。
// 运行：npx vite-node docs/evolution/_r35_real_tender_price_score.ts
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { checkPriceValidity, fullScoreTargetPrice, parsePriceFormula, priceScoreLadder, scorePrice } from "../../src/pages/BidWorkspace/priceScoreModel"

const root = process.cwd()
const text = readFileSync(resolve(root, ".diag/r50_tender.txt"), "utf8")

// 1) 捞出真实价格分条款（含基准价定义 + 计算公式两行）
const clause = text.match(/价格分统一采用低价优先法[\s\S]{0,220}?\d+％×100/)?.[0]
if (!clause) throw new Error("真实招标文件里没捞到价格分条款")
console.log("【招标文件原文条款】\n" + clause.replace(/\s+/g, " ").trim() + "\n")

// 2) 捞出最高限价（真实值：2500 万元）与无效标地板比例（真实值：45%）
const ceilingWan = Number(text.match(/最高限价[：:]?\s*(\d+(?:\.\d+)?)\s*万元/)?.[1] ?? 0)
const floorPct = Number(text.match(/投标报价＜采购项目最高限价[\s\S]{0,80}?×\s*(\d+(?:\.\d+)?)%/)?.[1] ?? 0)
const maxPrice = ceilingWan * 10000
console.log(`【真实约束】最高限价 ${ceilingWan} 万元＝${maxPrice} 元；低于限价 ${floorPct}% 按无效标处理\n`)

// 3) 识别口径
const parsed = parsePriceFormula(clause, 10)
if (!parsed.ok) throw new Error("识别失败：" + parsed.reason)
console.log("【识别结果】" + JSON.stringify({ ...parsed.formula, raw: undefined }, null, 0) + "\n")

// 4) 复算：模拟 3 家有效对手报价（含一家 1000 万低价抢标），我方贴限价报 2480 万
const others = [10_000_000, 22_000_000, 24_000_000]
const ours = 24_800_000
const r = scorePrice(parsed.formula, ours, others)
console.log("【我方报价测算】" + JSON.stringify(r, null, 0) + "\n")

// 5) 满分临界价 + 废标守护
const t = fullScoreTargetPrice(parsed.formula, ours, others, { maxPrice, minValidRatioPct: floorPct })
console.log("【拿满分临界价】" + JSON.stringify(t, null, 0) + "\n")

// 6) 敏感性阶梯（±0/1/2…%）
const ladder = priceScoreLadder(parsed.formula, ours, others, [-2, -1, 0, 1, 2], { maxPrice, minValidRatioPct: floorPct })
console.log("【报价阶梯】" + JSON.stringify(ladder, null, 0) + "\n")

// 7) 反例：只给公式行（无基准价定义）必须拒绝，不能猜
const lone = parsePriceFormula("投标报价得分＝（评标基准价/投标报价）×10％×100", 10)
console.log("【只给公式行】" + JSON.stringify(lone, null, 0))
console.log("【区间守护】2500 万零 1 元 → " + checkPriceValidity(25_000_001, { maxPrice, minValidRatioPct: floorPct }))

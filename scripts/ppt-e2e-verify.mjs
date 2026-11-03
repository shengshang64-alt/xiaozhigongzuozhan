/**
 * PPT 生成端到端验证（2026-11-03）
 *
 * 目的：用真实产出判断「知识原子接入」的效果，而不是只验证提示词里有没有。
 *
 * 对照设计（同素材、同模型、同页数，只差原子）：
 *   A 组：仅原有素材（buildMaterialText 产出，即用户上传/方案/标书）
 *   B 组：原有素材 + 知识原子（本轮新接入的 fetchAtomsForPages 路径）
 *
 * 量化指标：
 *   · 内容具体度（产品名/模块名/标准号出现次数）
 *   · 空话率（赋能/抓手/闭环生态等套话每千字）
 *   · 原子吸收率（bigram 重合）
 *   · pendingFields 数量（模型要求补充的字段越少，说明素材越够用）
 *
 * 用法：npx tsx scripts/ppt-e2e-verify.mjs [页数=12]
 */
import { DatabaseSync } from "node:sqlite"
import { writeFileSync } from "node:fs"
import { buildMaterialText, buildSlideContentMessages, normalizeSlidePlan } from "../src/pages/PptQuote/pptQuoteTypes.ts"

const DB = "D:\\重要文件\\工作的小程序\\xiaozhigongzuozhan\\pocketbase\\pb_data\\data.db"
const GW = "http://127.0.0.1:7000/api/model-gw/chat"
const HDR = { "Content-Type": "application/json", "X-Rh-User-Id": "local-user" }
const PAGES = Number(process.argv[2] ?? 12)

const db = new DatabaseSync(DB, { readOnly: true })
const cfg = db.prepare("SELECT id FROM model_configs WHERE config_name='sensenova'").get()
const p = db.prepare("SELECT * FROM bid_projects WHERE stage='evaluated' AND LENGTH(parse_report)>100 LIMIT 1").get()
db.close()

const outline = JSON.parse(p.bid_outline ?? "[]")
const chapters = JSON.parse(p.bid_chapters ?? "[]")

console.log(`=== PPT 生成端到端验证 ===`)
console.log(`素材源: ${p.project_name}`)
console.log(`页数: ${PAGES}\n`)

// ---- ① 原有素材 ----
const baseMaterial = buildMaterialText(p.project_name, outline, chapters, 4200, String(p.tender_text ?? ""))
console.log(`原有素材: ${baseMaterial.length} 字`)

// ---- ② 知识原子 ----
const topics = [
  "智慧医院建设背景与目标",
  "总体技术架构",
  "电子病历分级评价能力",
  "互联互通测评支持",
  "数据治理与迁移",
  "实施计划与里程碑",
  "运维服务体系",
  "安全保障体系",
]
let atomHits = []
for (const t of topics) {
  const r = await fetch("http://127.0.0.1:7000/api/kb/search", {
    method: "POST",
    headers: HDR,
    body: JSON.stringify({ query: t, usableFor: "ppt", topN: 2 }),
  })
  const d = await r.json()
  atomHits.push(...(d.hits ?? []))
}
console.log(`知识原子: ${atomHits.length} 条（来自 ${topics.length} 个主题）\n`)

const atomBlock = atomHits
  .map((h) => `- ${h.title}${h.docName ? `（来源：${h.docName}）` : ""}\n  ${h.body}`)
  .join("\n")
const withAtomsMaterial = `${baseMaterial}\n\n【已审核知识原子（我方真实产品能力与政策依据，优先引用这些口径）】\n${atomBlock}`.slice(0, 7200)
console.log(`含原子素材: ${withAtomsMaterial.length} 字\n`)

// ---- ③ 页面规划（同一套，A/B 共用）----
const rawPlan = topics.slice(0, PAGES).map((title, i) => ({
  title,
  kind: i === 0 ? "cover" : i % 3 === 0 ? "architecture" : "bullets",
  intent: `围绕${title}展开`,
}))
const plan = normalizeSlidePlan(rawPlan, PAGES)
const allTitles = plan.map((x) => x.title)

async function callModel(messages) {
  const body = JSON.stringify({
    config_id: cfg.id,
    model: "sensenova-6.8-flash-lite",
    messages,
    max_tokens: 2000,
    temperature: 0.3,
    disable_thinking: true,
  })
  const t0 = Date.now()
  const res = await fetch(GW, { method: "POST", headers: HDR, body })
  const d = await res.json()
  if (!d.ok) throw new Error(String(d.message ?? d.code).slice(0, 90))
  return { text: String(d.text ?? ""), ms: Date.now() - t0 }
}

/**
 * 从模型返回里提取可读文本。
 *
 * 2026-11-03 修正：模型实际返回的是 **{"slides":[{...}]}** 包装格式
 * （实测 buildSlideContentMessages 的契约要求如此），
 * 原实现只按单对象 {title,bullets,notes} 解析 → 全部提取为空，
 * 导致 A/B 两组都是 0 字、指标全 0 的假结果。
 */
function extractText(raw) {
  const cleaned = String(raw ?? "").replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim()
  const collect = (o) => {
    if (!o || typeof o !== "object") return ""
    const parts = [String(o.title ?? "")]
    for (const b of o.bullets ?? []) parts.push(String(b))
    for (const c of o.content ?? []) parts.push(String(c))
    parts.push(String(o.notes ?? ""))
    return parts.filter(Boolean).join("\n")
  }
  try {
    const o = JSON.parse(cleaned)
    // 优先 slides[] 包装；兼容裸单页对象
    if (Array.isArray(o?.slides)) return o.slides.map(collect).join("\n")
    return collect(o)
  } catch {
    return cleaned
  }
}

/** 质量审计 */
function audit(text) {
  const fluff = ["赋能", "抓手", "闭环生态", "全面提升", "全方位打造", "深度赋能", "数字化底座", "底座能力"]
  const fluffCount = fluff.reduce((n, w) => n + (text.split(w).length - 1), 0)
  const productNames = (text.match(/[A-Z]{2,}(?![a-z])/g) ?? []).length
  const modules = (text.match(/(系统|平台|模块|引擎|中台|中心)/g) ?? []).length
  const standards = (text.match(/(WS|GB|HL7|IHE|DICOM|ISO|等级保护|互联互通|电子病历应用水平|四级甲等|五级)/gi) ?? []).length
  return {
    chars: text.length,
    fluffCount,
    fluffRate: text.length ? Number(((fluffCount / text.length) * 1000).toFixed(2)) : 0,
    productNames,
    modules,
    standards,
    concrete: productNames * 2 + modules + standards * 3,
  }
}

function bigrams(s) {
  const t = String(s ?? "").replace(/[\s，。、；：""''（）()《》【】\-.,;:!?]/g, "")
  const out = new Set()
  for (let i = 0; i + 2 <= t.length; i += 1) out.add(t.slice(i, i + 2))
  return out
}

async function runGroup(label, materialText) {
  const ctx = {
    deckType: "planning",
    topic: `${p.project_name} 智慧医院建设方案汇报`,
    audience: "医院管理层与信息科",
    keyPoints: "总体架构、评级能力、实施计划、运维保障",
    materialText,
  }
  const texts = []
  let totalMs = 0
  for (let i = 0; i < plan.length; i += 1) {
    const msgs = buildSlideContentMessages(ctx, plan[i], allTitles)
    // 2026-11-03：单页失败要重试，否则空页会把整组指标拉低，
    // 误判成「原子没用」（实测 B 组第 2 页空，直接把总字数从 279 拉成 0）。
    let done = false
    for (let attempt = 0; attempt < 3 && !done; attempt += 1) {
      try {
        const r = await callModel(msgs)
        totalMs += r.ms
        const t = extractText(r.text)
        if (t.trim().length > 20) {
          texts.push(t)
          done = true
        }
      } catch {
        /* 重试 */
      }
      if (!done) await new Promise((r) => setTimeout(r, 2000))
    }
    if (!done) {
      texts.push("")
      console.log(`\n  ⚠ ${label} 第 ${i + 1} 页重试 3 次仍为空`)
    }
    process.stdout.write(`\r  ${label} ${i + 1}/${plan.length} 页…`)
  }
  console.log("")
  const joined = texts.join("\n")
  const a = audit(joined)

  // 2026-11-03 修正吸收率口径：
  //   原实现拿**全部 atomHits** 去比 A/B 两组的正文，而 A 组根本没收到原子，
  //   却因为有"同类方案素材"拿到 11/16——这指标分不出 A/B，等于没测。
  //   现改为分别算：A 组 vs 原子（基线噪声）、B 组 vs 原子（真实吸收），
  //   并额外算 **B 组独有**（即 B 命中但 A 没命中的原子数）——这才是原子带来的净增量。
  const bodyBigrams = bigrams(joined)
  const hitSet = new Set()
  for (const atom of atomHits) {
    const ab = bigrams(`${atom.title} ${atom.body}`)
    if (!ab.size) continue
    let hit = 0
    for (const g of ab) if (bodyBigrams.has(g)) hit += 1
    if (hit / ab.size >= 0.25) hitSet.add(String(atom.title))
  }
  return { label, texts, audit: a, ms: totalMs, absorbed: hitSet.size, absorbSet: hitSet, atomTotal: atomHits.length }
}

// 2026-11-03：单页偶发空/短会影响整组指标（模型不稳定）。
// 跑 3 轮取中位数，让结论不受单次波动影响。
const ROUNDS = Number(process.env.PPT_ROUNDS ?? 3)
const aRuns = []
const bRuns = []
for (let round = 0; round < ROUNDS; round += 1) {
  console.log(`\n=== 第 ${round + 1}/${ROUNDS} 轮 · A 组（仅原有素材）===`)
  aRuns.push(await runGroup("A", baseMaterial))
  await new Promise((r) => setTimeout(r, 3000))
  console.log(`\n=== 第 ${round + 1}/${ROUNDS} 轮 · B 组（原有素材 + 知识原子）===`)
  bRuns.push(await runGroup("B", withAtomsMaterial))
  await new Promise((r) => setTimeout(r, 3000))
}
const median = (arr) => {
  const s = [...arr].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}
const A = { audit: {}, absorbed: 0, atomTotal: atomHits.length, ms: 0 }
const B = { audit: {}, absorbed: 0, atomTotal: atomHits.length, ms: 0 }
for (const k of ["chars", "concrete", "productNames", "modules", "standards", "fluffRate"]) {
  A.audit[k] = median(aRuns.map((r) => r.audit[k]))
  B.audit[k] = median(bRuns.map((r) => r.audit[k]))
}
A.absorbed = median(aRuns.map((r) => r.absorbed))
B.absorbed = median(bRuns.map((r) => r.absorbed))
A.ms = median(aRuns.map((r) => r.ms))
B.ms = median(bRuns.map((r) => r.ms))
console.log(`\n（以上指标为 ${ROUNDS} 轮中位数）`)

console.log("\n" + "=".repeat(74))
console.log(`${"指标".padEnd(16)} ${"A(无原子)".padStart(12)} ${"B(含原子)".padStart(12)} ${"变化".padStart(14)}`)
const rows = [
  ["总字数", A.audit.chars, B.audit.chars],
  ["具体度加权分", A.audit.concrete, B.audit.concrete],
  ["产品名数", A.audit.productNames, B.audit.productNames],
  ["技术模块词", A.audit.modules, B.audit.modules],
  ["标准引用", A.audit.standards, B.audit.standards],
  ["空话/千字", A.audit.fluffRate, B.audit.fluffRate],
]
for (const [name, av, bv] of rows) {
  const diff = bv - av
  const pct = av ? `${((diff / av) * 100).toFixed(0)}%` : "n/a"
  console.log(`${String(name).padEnd(16)} ${String(av).padStart(12)} ${String(bv).padStart(12)} ${(diff >= 0 ? "+" : "") + diff + " (" + pct + ")".padStart(10)}`)
}
// 净增量：B 命中但 A 没命中的原子（排除"素材本来就覆盖"的部分）
const bSet = new Set(bRuns.flatMap((r) => [...(r.absorbSet ?? [])]))
const aSet = new Set(aRuns.flatMap((r) => [...(r.absorbSet ?? [])]))
const netNew = [...bSet].filter((t) => !aSet.has(t))
console.log(`\n原子命中：A=${A.absorbed}/${A.atomTotal}（素材自带语义）| B=${B.absorbed}/${B.atomTotal}`)
console.log(`B 组独有的原子（净增量）：${netNew.length} 条`)
for (const t of netNew.slice(0, 5)) console.log(`  + ${t.slice(0, 55)}`)
console.log(`耗时: A=${(A.ms / 1000).toFixed(0)}s | B=${(B.ms / 1000).toFixed(0)}s`)

writeFileSync("_ppt_e2e.json", JSON.stringify({ A, B, atoms: atomHits.map((h) => h.title) }, null, 1), "utf8")
console.log(`\n详细结果: _ppt_e2e.json`)

/**
 * 标书生成端到端验证（2026-11-02）
 *
 * 目的：用 8130 条原子库跑真实生成，量化验证价值。
 *
 * 与之前的 atom-ab-test.mjs 的差别：
 *   · 支持多章节批量跑（不只一章）
 *   · 输出「原子实际被采用的原文片段」，便于人工核对
 *   · 统计全局事实使用率、主题覆盖率
 *
 * 用法：npx tsx scripts/bid-e2e-verify.mjs [章节数=3]
 */
import { DatabaseSync } from "node:sqlite"
import { writeFileSync } from "node:fs"
import { retrieveTenderFragments } from "../src/pages/BidWorkspace/bidTypes.ts"
import { techTermsForTitle } from "../src/pages/BidWorkspace/techChapterTerms.ts"

const DB = "D:\\重要文件\\工作的小程序\\xiaozhigongzuozhan\\pocketbase\\pb_data\\data.db"
const GW = "http://127.0.0.1:7000/api/model-gw/chat"
const HDR = { "Content-Type": "application/json", "X-Rh-User-Id": "local-user" }
const N_CHAPTERS = Number(process.argv[2] ?? 3)

const db = new DatabaseSync(DB, { readOnly: true })
const cfg = db.prepare("SELECT id FROM model_configs WHERE config_name='sensenova'").get()
const p = db.prepare("SELECT * FROM bid_projects WHERE stage='evaluated' AND LENGTH(parse_report)>100 LIMIT 1").get()
const atomCount = db.prepare("SELECT COUNT(*) n FROM kb_atoms WHERE content_status='approved'").get()
db.close()

const report = JSON.parse(p.parse_report)
const chapters = JSON.parse(p.bid_chapters)
const techChapters = chapters.filter((c) => c.part !== "biz").slice(0, N_CHAPTERS)

console.log(`=== 标书生成端到端验证 ===`)
console.log(`项目: ${p.project_name}`)
console.log(`原子库: ${atomCount.n} 条 approved`)
console.log(`验证章节: ${techChapters.length} 个\n`)

/**
 * 全局事实：**直接用生产代码的 effectiveGlobalFactsLines**，不自己写正则。
 *
 * 2026-11-02 修正：验证脚本原本自己写了个正则 `^(项目名称|招标编号|...)[：:]`,
 * 但生产代码输出的是 `项目名称=xxx`（等号分隔）且包含 18 条事实，
 * 导致脚本只提取到 3 条、误判「事实利用率只有 2/3」。
 * 验证脚本必须复用生产实现，否则测的不是真东西。
 */
const { effectiveGlobalFactsLines, effectiveGlobalFacts } = await import("../src/pages/BidWorkspace/bidTypes.ts")
function globalFacts() {
  return effectiveGlobalFactsLines({ global_facts: p.global_facts, parse_report: report, tender_no: p.tender_no })
}

async function callModel(prompt) {
  const body = JSON.stringify({
    config_id: cfg.id,
    model: "sensenova-6.8-flash-lite",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 2000,
    temperature: 0.3,
    disable_thinking: true,
  })
  const t0 = Date.now()
  const res = await fetch(GW, { method: "POST", headers: HDR, body })
  const d = await res.json()
  if (!d.ok) throw new Error(String(d.message ?? d.code).slice(0, 100))
  return { text: String(d.text ?? ""), ms: Date.now() - t0 }
}

/** 检索原子（与生产 kbMaterialFor 同口径） */
async function fetchAtoms(chapterTitle) {
  const terms = techTermsForTitle(chapterTitle).slice(0, 6)
  const query = [chapterTitle, ...terms].join(" ")
  const r = await fetch("http://127.0.0.1:7000/api/kb/search", {
    method: "POST",
    headers: HDR,
    body: JSON.stringify({ query, usableFor: "bid", topN: 8 }),
  })
  const d = await r.json()
  return { hits: d.hits ?? [], query }
}

/** bigram 重合度（判断原子吸收） */
function bigrams(s) {
  const t = String(s ?? "").replace(/[\s，。、；：""''（）()《》【】\-.,;:!?]/g, "")
  const out = new Set()
  for (let i = 0; i + 2 <= t.length; i += 1) out.add(t.slice(i, i + 2))
  return out
}

const facts = globalFacts()
console.log(`全局事实: ${facts.length} 条`)
for (const f of facts.slice(0, 5)) console.log(`  ${f}`)
console.log("")

const results = []
for (let i = 0; i < techChapters.length; i += 1) {
  const ch = techChapters[i]
  console.log(`[${i + 1}/${techChapters.length}] ${ch.title}`)

  // ① 招标原文片段
  const frag = retrieveTenderFragments(
    String(p.tender_text ?? ""),
    { title: ch.title, sections: ch.sections ?? [], clauses: [] },
    6000,
    18,
  )
  // ② 知识原子
  const { hits, query } = await fetchAtoms(ch.title)
  const atomBlock = hits.map((h) => `- ${h.title}\n  ${h.body}`).join("\n\n")

  console.log(`  招标原文 ${frag.length} 字 | 原子 ${hits.length} 条 (query: ${query.slice(0, 40)}…)`)

  // ③ 提示词（两类内容都要求用）
  // 2026-11-02 修正：改成与生产代码同构的**双消息**结构。
  // 原验证脚本用单条 user 且把事实块放在最末尾 → 模型几乎不引用
  // （实测 18 条事实只用了 1 条采购人名称）。
  // 生产提示词把事实块放在**稳定块靠前位置**（紧跟项目背景之后），并按
  // GLOBAL_FACTS_PREAMBLE 要求「正文中出现项目名称/编号/预算/工期等必须与之一致」。
  // effectiveGlobalFacts 已包含 GLOBAL_FACTS_PREAMBLE 前言（「正文中出现项目名称/编号/预算…必须与之一致」）
  const factsBlock = effectiveGlobalFacts({ global_facts: p.global_facts, parse_report: report, tender_no: p.tender_no })
  const stableUser = [
    `【项目背景与概况（写作前先理解，正文须结合本项目实际情况组织内容）】\n项目名称：${p.project_name}\n采购人：${p.hospital}`,
    factsBlock,
    `【我方已审核产品能力与政策依据（真实能力，必须体现）】\n${atomBlock || "（无）"}`,
  ]
    .filter(Boolean)
    .join("\n\n")

  const taskUser = [
    `【招标原文相关段落（本章写作的首要依据，参数、指标、要求以原文为准）】\n${frag.slice(0, 5000)}`,
    `【本章任务】撰写「${ch.title}」章节正文。\n要求：\n1. 紧扣招标原文的具体约束与规模（点数、床位、工期、评级目标等）\n2. 充分利用上面的产品能力与政策依据，写出区别于同行的技术特征\n3. 800-1000 字，专业严谨，禁止空话套话\n4. 每个技术点说明「是什么 + 为什么对本项目重要」\n5. **凡涉及项目名称、招标编号、采购人、预算金额、工期、质保期、地点、时间节点，一律使用【全局事实】里的原文数值，不得改写或省略**——评标时这些是硬核对项`,
  ].join("\n\n")

  const prompt = `${stableUser}\n\n${taskUser}`

  try {
    const r = await callModel(prompt)
    // ④ 质量评估
    const bodyBigrams = bigrams(r.text)
    let absorbed = 0
    const absorbDetail = []
    for (const atom of hits) {
      const ab = bigrams(`${atom.title} ${atom.body}`)
      if (!ab.size) continue
      let hit = 0
      for (const g of ab) if (bodyBigrams.has(g)) hit += 1
      const rate = hit / ab.size
      absorbDetail.push({ title: String(atom.title).slice(0, 40), rate: Number(rate.toFixed(2)) })
      if (rate >= 0.25) absorbed += 1
    }
    const fluff = ["赋能", "抓手", "闭环生态", "全面提升", "全方位打造"].reduce(
      (n, w) => n + (r.text.split(w).length - 1),
      0,
    )
    // 2026-11-02 修正：事实格式是 `键=值`（等号），原实现按 `: `（冒号）切分
    // 取不到 val → factUsed 恒为 0，误报「模型完全没用事实」。
    const factUsed = facts.filter((f) => {
      const eq = f.indexOf("=")
      const val = eq >= 0 ? f.slice(eq + 1) : ""
      // 短值（如"不收取"）全匹配；长值取前 8 字
      const probe = val.trim().slice(0, Math.min(8, val.trim().length))
      return probe.length >= 2 && r.text.includes(probe)
    }).length

    const audit = {
      chars: r.text.length,
      absorbed,
      atomTotal: hits.length,
      absorbRate: hits.length ? Number((absorbed / hits.length).toFixed(2)) : 0,
      fluffCount: fluff,
      factUsed,
      ms: r.ms,
    }
    console.log(
      `  ✓ ${audit.chars} 字 / ${(audit.ms / 1000).toFixed(0)}s | 原子吸收 ${absorbed}/${hits.length} | 事实引用 ${factUsed}/${facts.length} | 空话 ${fluff}`,
    )
    results.push({ title: ch.title, ok: true, audit, absorbDetail, text: r.text })
  } catch (e) {
    console.log(`  ✗ ${String(e.message).slice(0, 70)}`)
    results.push({ title: ch.title, ok: false, err: String(e.message).slice(0, 100) })
  }
  // 章节间隔，避免限流
  await new Promise((r) => setTimeout(r, 3000))
  console.log("")
}

// 汇总
console.log("=".repeat(72))
const okOnes = results.filter((r) => r.ok)
if (okOnes.length) {
  const totalChars = okOnes.reduce((n, r) => n + r.audit.chars, 0)
  const avgAbsorb = okOnes.reduce((n, r) => n + r.audit.absorbRate, 0) / okOnes.length
  const totalFluff = okOnes.reduce((n, r) => n + r.audit.fluffCount, 0)
  const totalFacts = okOnes.reduce((n, r) => n + r.audit.factUsed, 0)
  const avgMs = okOnes.reduce((n, r) => n + r.audit.ms, 0) / okOnes.length
  console.log(`成功 ${okOnes.length}/${results.length} 章`)
  console.log(`总字数 ${totalChars} | 平均 ${Math.round(totalChars / okOnes.length)} 字/章`)
  console.log(`原子吸收率 ${(avgAbsorb * 100).toFixed(0)}% | 事实引用 ${totalFacts} 次 | 空话词 ${totalFluff} 次`)
  console.log(`平均耗时 ${(avgMs / 1000).toFixed(0)}s/章`)
}

writeFileSync("_e2e_verify.json", JSON.stringify(results, null, 1), "utf8")
console.log(`\n详细结果: _e2e_verify.json`)

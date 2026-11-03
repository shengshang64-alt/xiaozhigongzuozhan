/**
 * 原子使用效果 A/B 对比（2026-11-01）
 *
 * 目的：回答一个具体问题 —— **接原子到底有没有用？**
 *
 * 方法：同一章、同一项目、同一模型，跑两次：
 *   A 组：只用招标原文（不含知识原子）
 *   B 组：招标原文 + 知识原子
 * 然后按可量化指标对比产出。
 *
 * 评价维度（不靠主观感觉）：
 *   1. 内容具体度：具体产品名/模块名/标准号的出现次数
 *   2. 篇幅：正文字数
 *   3. 空话率：赋能/抓手/闭环生态等套话占比
 *   4. 原子吸收率：生成正文里有多少原子内容被采用
 *
 * 用法：npx tsx scripts/atom-ab-test.mjs [章名关键词]
 */
import { DatabaseSync } from "node:sqlite"
import { writeFileSync } from "node:fs"
import { retrieveTenderFragments } from "../src/pages/BidWorkspace/bidTypes.ts"

const DB = "D:\\重要文件\\工作的小程序\\xiaozhigongzuozhan\\pocketbase\\pb_data\\data.db"
const GW = "http://127.0.0.1:7000/api/model-gw/chat"
const HDR = { "Content-Type": "application/json", "X-Rh-User-Id": "local-user" }
const CHAPTER_KEY = process.argv[2] ?? "总体技术解决方案"

const db = new DatabaseSync(DB, { readOnly: true })
const cfg = db.prepare("SELECT id FROM model_configs WHERE config_name='ange'").get()
const p = db.prepare("SELECT project_name, hospital, tender_no, tender_text FROM bid_projects WHERE stage='evaluated' AND LENGTH(parse_report)>100 LIMIT 1").get()
db.close()

function audit(text) {
  const fluff = ["赋能", "抓手", "闭环生态", "全面提升", "全方位打造", "深度赋能", "数字化底座"]
  const fluffCount = fluff.reduce((n, w) => n + (text.split(w).length - 1), 0)
  const productNames = (text.match(/[A-Z]{2,}(?![a-z])/g) ?? []).length // 缩写产品名
  const modules = (text.match(/(系统|平台|模块|引擎|中台|中心)/g) ?? []).length
  const standards = (text.match(/(WS|GB|HL7|IHE|DICOM|ISO|等级保护|互联互通|电子病历应用水平)/gi) ?? []).length
  return {
    chars: text.length,
    fluffCount,
    fluffRate: text.length ? fluffCount / (text.length / 1000) : 0, // 每千字
    productNames,
    modules,
    standards,
    concreteScore: productNames * 2 + modules + standards * 3, // 加权具体度
  }
}

async function callModel(prompt, attempt = 0) {
  const body = JSON.stringify({
    config_id: cfg.id,
    model: "agnes-3.0-flash",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 2000,
    temperature: 0.3,
    disable_thinking: true,
  })
  const t0 = Date.now()
  const res = await fetch(GW, { method: "POST", headers: HDR, body })
  const d = await res.json()
  if (!d.ok) {
    const msg = String(d.message ?? d.code ?? "")
    // 429 频率限流时退避重试（与后台批处理共存时会出现）
    if (/429|频率|限流|rate/i.test(msg) && attempt < 4) {
      const wait = 15000 * (attempt + 1)
      console.log(`  (限流，${wait / 1000}s 后重试 ${attempt + 1}/4)`)
      await new Promise((r) => setTimeout(r, wait))
      return callModel(prompt, attempt + 1)
    }
    throw new Error(msg.slice(0, 100))
  }
  return { text: String(d.text ?? ""), ms: Date.now() - t0 }
}

const tender = String(p.tender_text ?? "")
const frag = retrieveTenderFragments(tender, { title: CHAPTER_KEY, sections: [], clauses: [] }, 6000, 18)
console.log(`项目: ${p.project_name}`)
console.log(`章节: ${CHAPTER_KEY}`)
console.log(`招标原文片段: ${frag.length} 字\n`)

// 取原子（服务端检索）
// 用章节标题 + 该主题的同义词构造查询（与生产 kbMaterialFor 的口径一致）
const { techTermsForTitle } = await import("../src/pages/BidWorkspace/techChapterTerms.ts")
const chapterQuery = [CHAPTER_KEY, ...techTermsForTitle(CHAPTER_KEY).slice(0, 6)].join(" ")

const sr = await fetch("http://127.0.0.1:7000/api/kb/search", {
  method: "POST",
  headers: HDR,
  // 2026-11-01 修正：原查询硬编码了「架构 接口 平台 集成」，导致任何章节（如培训方案）
  // 都被这几个词主导，检索结果全变成集成平台类原子（实测：培训方案 → 8 条全是集成接口）。
  // 改为**只用章节标题** + 该章节主题词，从 techChapterTerms 取同义词。
  body: JSON.stringify({ query: chapterQuery, usableFor: "bid", topN: 8 }),
})
const sd = await sr.json()
const atoms = sd.hits ?? []
console.log(`知识原子: ${atoms.length} 条\n`)

if (!atoms.length) {
  console.log("⚠ 无原子可用，A/B 对比无意义。请先补充 approved 原子。")
  process.exit(0)
}

const atomBlock = atoms.map((h) => `- ${h.title}\n  ${h.body}`).join("\n\n")
const common = `你是医疗信息化投标文件编写专家。为项目「${p.project_name}」（采购人：${p.hospital}）撰写「${CHAPTER_KEY}」章节。

【招标原文相关段落】
${frag.slice(0, 5000)}

【要求】
1. 紧扣招标原文要求展开
2. **必须 1100-1300 字**（不要因为信息密度高就压缩篇幅）
3. 包含：总体架构设计、技术路线、核心子系统、集成与数据方案、安全与运维
4. 禁止空话套话
5. 每个技术点都要展开说明「是什么 + 为什么对本项目重要」`

const promptA = common
// 2026-11-01 修正：实测 B 组（含原子）的招标事实使用率下降
// （15000 人次/5000 住院 从 A=1 降到 B=0）——原子块挤占了模型注意力。
// 在 B 组提示词里明确"两者都要用"，并给出各自的角色定位。
const promptB = `${common}

【我方已审核产品能力（真实能力，必须体现）】
${atomBlock}

【重要：两类内容都要用】
- 招标原文段落 → 提供本项目的具体约束与规模（床位数、门诊量、工期、评级目标等），**必须体现在正文里**
- 我方产品能力 → 提供区别于竞争对手的技术特征（具体产品名、模块、接口标准），**必须体现在正文里**
- 不要因为写产品能力而省略招标事实，也不要用通用描述替代具体数字`

console.log("=== 跑 A 组（不含原子）===")
const A = await callModel(promptA)
console.log(`  ${A.text.length} 字 / ${(A.ms / 1000).toFixed(0)}s`)

console.log("=== 跑 B 组（含原子）===")
const B = await callModel(promptB)
console.log(`  ${B.text.length} 字 / ${(B.ms / 1000).toFixed(0)}s\n`)

const a = audit(A.text)
const b = audit(B.text)

// 原子吸收率：用 **bigram 重合度** 判断，而不是整词包含。
// 2026-11-01 修正：原算法按标题 4 字片段精确匹配，但模型会改写措辞
// （原子「集成平台支持接口格式转换功能」→ 正文「支持XSTL、Freemarker模板引擎…解决接口转换问题」），
// 精确匹配得 0%，误报「原子完全没被采用」。bigram 重合能捕捉语义采用。
function bigrams(s) {
  const t = String(s ?? "").replace(/[\s，。、；：""''（）()《》【】\-.,;:!?]/g, "")
  const out = new Set()
  for (let i = 0; i + 2 <= t.length; i += 1) out.add(t.slice(i, i + 2))
  return out
}
const bodyBigrams = bigrams(B.text)
let absorbed = 0
const absorbDetail = []
for (const atom of atoms) {
  const atomBigrams = bigrams(`${atom.title} ${atom.body}`)
  if (!atomBigrams.size) continue
  let hit = 0
  for (const g of atomBigrams) if (bodyBigrams.has(g)) hit += 1
  const rate = hit / atomBigrams.size
  absorbDetail.push({ title: String(atom.title).slice(0, 40), rate: Number(rate.toFixed(2)) })
  // 重合度 ≥ 25% 视为该原子被采用（改写后仍保留足够语义片段）
  if (rate >= 0.25) absorbed += 1
}
const absorbRate = absorbed / atoms.length

console.log("=== 对比结果 ===")
console.log(`${"指标".padEnd(16)} ${"A组(无原子)".padStart(12)} ${"B组(含原子)".padStart(12)} ${"变化".padStart(10)}`)
const rows = [
  ["字数", a.chars, b.chars],
  ["具体度加权分", a.concreteScore, b.concreteScore],
  ["产品名数", a.productNames, b.productNames],
  ["技术模块词", a.modules, b.modules],
  ["标准引用", a.standards, b.standards],
  ["空话/千字", a.fluffRate, b.fluffRate],
]
for (const [name, av, bv] of rows) {
  const diff = bv - av
  const pct = av ? ((diff / av) * 100).toFixed(0) + "%" : "n/a"
  console.log(`${String(name).padEnd(16)} ${String(av).padStart(12)} ${String(bv).padStart(12)} ${String(diff >= 0 ? "+" : "") + diff + " (" + pct + ")".padStart(10)}`)
}
console.log(`\n原子吸收率: ${absorbed}/${atoms.length} (${(absorbRate * 100).toFixed(0)}%)`)
console.log("各原子采用情况（bigram 重合度）:")
for (const d of absorbDetail.sort((x, y) => y.rate - x.rate)) {
  console.log(`  ${d.rate >= 0.25 ? "✓" : "·"} ${(d.rate * 100).toFixed(0).padStart(3)}%  ${d.title}`)
}

writeFileSync(
  "_atom_ab_result.json",
  JSON.stringify({ chapter: CHAPTER_KEY, atoms: atoms.map((h) => ({ title: h.title, type: h.atomType })), A: { text: A.text, audit: a, ms: A.ms }, B: { text: B.text, audit: b, ms: B.ms }, absorbRate }, null, 1),
  "utf8",
)
console.log("\n详细结果: _atom_ab_result.json")

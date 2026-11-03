// 材料场景归位脚本（2026-10-30）
//
// 目的：把 7005 篇材料按「用在哪」归位，写入 kb_scenes / kb_audience 等字段，
// 让方案工作室、PPT、标书、报价各环节能按场景取材料。
//
// 为什么需要：
//   现有 doc_category 回答"这是什么"（技术方案/政策法规），
//   但售前真正要问的是"我要写技术标，哪些材料能用"。
//   场景归位回答后者。
//
// 场景定义与判定规则见 src/pages/Knowledge/kbScenes.ts
//
// 用法：
//   node scripts/kb/assign-scenes.mjs           预演（只统计）
//   node scripts/kb/assign-scenes.mjs --apply   写入

import { DatabaseSync } from "node:sqlite"
import { createRequire } from "node:module"
import { existsSync } from "node:fs"

const require = createRequire(import.meta.url)
const DB_PATH = process.env.KB_DB_PATH ?? "D:\\重要文件\\工作的小程序\\xiaozhigongzuozhan\\pocketbase\\pb_data\\data.db"
const APPLY = process.argv.includes("--apply")

if (!existsSync(DB_PATH)) {
  console.error("数据库不存在:", DB_PATH)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 场景规则（与 src/pages/Knowledge/kbScenes.ts 同规则，内联避免 TS 依赖）
// ---------------------------------------------------------------------------
const SCENE_LABEL = {
  proposal: "方案素材", ppt: "PPT素材", bid: "标书弹药", quote: "报价参考",
  faq: "答疑话术", qual: "资质证明", template: "模板版式", reference: "内部参考",
}
const ALL_SCENES = Object.keys(SCENE_LABEL)

const PATH_RULES = [
  { re: /资质|证书|著作权|软著|认证|获奖|荣誉/i, scenes: ["qual"], reason: "资质/证书类" },
  { re: /报价|价格表|清单|预算|商务标|盘点表/i, scenes: ["quote"], reason: "报价/价格类" },
  { re: /模板|模版|版式|格式|编辑使用规范|撰写指引|小技巧/i, scenes: ["template"], reason: "模板/格式类" },
  { re: /答疑|问答|异议|话术|FAQ|常见问题/i, scenes: ["faq"], reason: "答疑/话术类" },
  { re: /标书|投标文件|招标文件|应答文件|技术标|标书范本/i, scenes: ["bid"], reason: "标书/投标类" },
  { re: /政策|法规|标准|评价标准|分级评价|指南|文件库/i, scenes: ["faq", "bid"], reason: "政策/标准类" },
  { re: /案例|样板|范本|经验分享|实践/i, scenes: ["proposal", "bid"], reason: "案例/范本类" },
  { re: /方案|可研|规划|建设内容|需求分析|设计/i, scenes: ["proposal"], reason: "方案/可研类" },
  { re: /PPT|演示|宣传手册|产品简介|汇报材料/i, scenes: ["ppt"], reason: "PPT/宣传类" },
  { re: /产品|模块|功能|系统简介|技术参数/i, scenes: ["proposal", "bid"], reason: "产品/功能类" },
  { re: /友商|竞品|对手|第三方产品/i, scenes: ["reference"], reason: "友商/竞品类" },
  { re: /培训|制度|流程|宣导|内部|操作文档|公司流程|签名规范/i, scenes: ["reference"], reason: "内部制度/培训类" },
]

const RISK_RULES = [
  { re: /中标价|报价明细|让利|折扣|成本价|底价/, risk: "含报价/成本信息" },
  { re: /失标|未中标|丢标|失败原因/, risk: "含失标复盘" },
  { re: /内部|机密|仅内部|不得外传|保密/, risk: "标注内部/保密" },
  { re: /竞品分析|攻防话术|友商对比|竞对分析/, risk: "含友商评价" },
]
const CLIENT_NAME_RE = /[\u4e00-\u9fa5]{2,10}(医院|卫生院|医疗集团|保健院|疾控中心)/

function assignScene(row) {
  const path = String(row.folder_path ?? "")
  const title = String(row.title ?? "")
  const head = String(row.head ?? "")
  const hay = `${path} ${title}`
  const scenes = new Set()
  const reasons = []
  const risks = []
  const desensitize = []

  for (const r of PATH_RULES) {
    if (r.re.test(hay)) {
      for (const s of r.scenes) scenes.add(s)
      reasons.push(r.reason)
      break
    }
  }
  if (scenes.size === 0) {
    const b = String(row.kb_bucket ?? "")
    const map = { 标书弹药: "bid", 方案素材: "proposal", PPT演示: "ppt", 政策法规标准: "faq", 公司内部: "reference" }
    if (map[b]) { scenes.add(map[b]); reasons.push("按 kb_bucket 兜底") }
  }
  for (const r of RISK_RULES) {
    if (r.re.test(hay) || r.re.test(head)) risks.push(r.risk)
  }
  if (CLIENT_NAME_RE.test(title) || CLIENT_NAME_RE.test(head)) desensitize.push("含客户名需脱敏")

  if (scenes.size === 0) {
    scenes.add("reference")
    reasons.push("未命中场景特征，保守归内部参考")
  }
  const hardRisks = risks.filter((r) => r.includes("报价") || r.includes("失标") || r.includes("内部") || r.includes("友商"))
  let audience = hardRisks.length ? "internal_only" : "client_facing"
  if (scenes.size === 1 && scenes.has("reference")) audience = "internal_only"

  return { scenes: [...scenes], audience, reason: reasons.join("；"), risks, desensitize }
}

// ---------------------------------------------------------------------------
console.log("=".repeat(74))
console.log("材料场景归位" + (APPLY ? "（写入模式）" : "（预演模式）"))
console.log("=".repeat(74))

const db = new DatabaseSync(DB_PATH, { readOnly: !APPLY })
const rows = db.prepare(
  "SELECT id, title, folder_path, kb_bucket, substr(content,1,3000) AS head FROM kb_docs",
).all()

console.log("读取:", rows.length, "篇")

const updates = []
const byScene = {}
const byAudience = { client_facing: 0, internal_only: 0 }
let risky = 0
const reasonCounter = {}
const sceneMulti = {}

for (const r of rows) {
  const a = assignScene(r)
  for (const s of a.scenes) byScene[s] = (byScene[s] ?? 0) + 1
  byAudience[a.audience] += 1
  if (a.risks.length) risky += 1
  if (a.reason) reasonCounter[a.reason] = (reasonCounter[a.reason] ?? 0) + 1
  sceneMulti[a.scenes.length] = (sceneMulti[a.scenes.length] ?? 0) + 1
  updates.push({ id: r.id, scenes: a.scenes.join(","), audience: a.audience, reason: a.reason, risks: a.risks.join(";") })
}

console.log("\n【场景分布】")
for (const s of ALL_SCENES) console.log(`  ${SCENE_LABEL[s].padEnd(8)} ${String(byScene[s] ?? 0).padStart(5)} 篇`)
console.log("\n【可对客性】")
console.log(`  可对客 ${byAudience.client_facing} · 仅内部 ${byAudience.internal_only}`)
console.log(`  有硬风险 ${risky}`)
console.log("\n【归位依据分布（前 8）】")
Object.entries(reasonCounter).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${k}`))

if (!APPLY) {
  console.log("\n【预演结束】加 --apply 写入")
  db.close()
  process.exit(0)
}

console.log("\n【写入】…")
const stmt = db.prepare("UPDATE kb_docs SET kb_scenes=?, kb_audience=?, scene_reason=?, scene_risks=? WHERE id=?")
let done = 0
db.exec("BEGIN")
try {
  for (const u of updates) {
    stmt.run(u.scenes, u.audience, u.reason, u.risks, u.id)
    done += 1
  }
  db.exec("COMMIT")
  console.log(`  已写 ${done} 篇`)
} catch (e) {
  db.exec("ROLLBACK")
  console.error("失败已回滚:", e.message)
  process.exit(1)
}

// 校验
const check = db.prepare("SELECT COUNT(*) n FROM kb_docs WHERE kb_scenes != ''").get().n
const byAud = db.prepare("SELECT kb_audience, COUNT(*) n FROM kb_docs GROUP BY kb_audience").all()
console.log("\n【校验】")
console.log("  已归位:", check)
console.log("  可对客性分布:", byAud.map((x) => `${x.kb_audience}=${x.n}`).join(" · "))
db.close()
console.log("\n下一步：各环节可按 kb_scenes LIKE '%proposal%' AND kb_audience='client_facing' 取材料")

// 存量回填 + 质量分级（2026-10-30 知识库 P0-2）
//
// 依据《知识库改造需求文档 v1.0》§10.4 Step 2：
//   「回填 file_hash / origin_path / ingest_status」
//
// 本脚本在回填基础上多做一件文档没写但实测必须要的事：**质量分级**。
// 真实数据预演发现 7005 篇里 910 篇"抽了也是垃圾"（884 篇是 48 字 PPT 页碎片），
// 不筛掉会污染审核队列。故回填时同时写入 extract_score，
// 抽取阶段只需 `WHERE ingest_status='parsed' AND extract_score >= 0.2`。
//
// 用法：
//   node scripts/kb/backfill.mjs                      预演（只统计）
//   node scripts/kb/backfill.mjs --apply              写入
//   node scripts/kb/backfill.mjs --apply --limit=500  只处理前 500 篇

import { DatabaseSync } from "node:sqlite"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"

const DB_PATH = process.env.KB_DB_PATH ?? "D:\\重要文件\\工作的小程序\\xiaozhigongzuozhan\\pocketbase\\pb_data\\data.db"
const APPLY = process.argv.includes("--apply")
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="))
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split("=")[1]) : Infinity

if (!existsSync(DB_PATH)) {
  console.error("数据库不存在:", DB_PATH)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 质量评估（内联，避免脚本依赖 TS 编译）
// 与 src/pages/Knowledge/kbDocQuality.ts 同规则
// ---------------------------------------------------------------------------
const TH = { minChars: 200, maxCharsForExtract: 60_000, minAvgLineLength: 8 }
const JUNK_TITLE = [/^dict$/i, /^新建/, /^无标题/, /^未命名/, /^\d+$/, /^Sheet\d*$/i, /^Table\d*$/i]

function assess(title, content) {
  const t = String(title ?? "").trim()
  const c = String(content ?? "")
  const len = c.length
  const reasons = []

  if (len < TH.minChars) return { extractable: false, score: 0, action: "skip", reasons: [`正文仅 ${len} 字`] }

  for (const re of JUNK_TITLE) {
    if (re.test(t)) {
      reasons.push(`标题「${t}」疑似非业务文档`)
      break
    }
  }
  if (len > 300_000) reasons.push(`正文 ${Math.round(len / 10000)} 万字，疑似字典/日志`)

  const lines = c.split("\n").filter((l) => l.trim())
  const avgLineLen = lines.length ? c.replace(/\n/g, "").length / lines.length : 0
  if (lines.length > 20 && avgLineLen < TH.minAvgLineLength) reasons.push(`平均每行 ${avgLineLen.toFixed(1)} 字，疑似表格碎片`)

  const head = c.slice(0, 5000)
  const uniqChars = new Set(head).size
  if (len > 1000 && uniqChars < 50) {
    const probe = head.slice(0, 30)
    let repeated = false
    if (probe.length === 30) {
      let count = 0
      for (let i = 0; i + 30 <= head.length; i += 30) if (head.slice(i, i + 30) === probe) count += 1
      repeated = count >= 5
    }
    if (repeated) reasons.push(`字符种类少且存在超长重复块，疑似乱码`)
  }

  if (reasons.length) return { extractable: false, score: 0, action: "manual_review", reasons }

  const effective = Math.min(len, TH.maxCharsForExtract)
  const score = Math.min(1, Math.log10(effective / 100) / Math.log10(600))
  return { extractable: true, score: Number(score.toFixed(2)), action: "extract", reasons: [] }
}

// ---------------------------------------------------------------------------
console.log("=".repeat(74))
console.log("知识库存量回填" + (APPLY ? "（写入模式）" : "（预演模式）"))
console.log("=".repeat(74))
console.log("数据库:", DB_PATH)

const db = new DatabaseSync(DB_PATH, { readOnly: !APPLY })

const total = db.prepare("SELECT COUNT(*) AS n FROM kb_docs").get().n
const missingHash = db.prepare("SELECT COUNT(*) AS n FROM kb_docs WHERE file_hash IS NULL OR file_hash=''").get().n
console.log(`\n【现状】文档 ${total.toLocaleString()} 篇 · 缺 file_hash ${missingHash.toLocaleString()} 篇`)

// ------ 读取并评估 ------
console.log("\n【评估】读取全文并计算质量分…")
const rows = db.prepare("SELECT id, title, content, file_hash FROM kb_docs").all()
const byHash = new Map()
const updates = []
let skipped = 0
let manual = 0
const skipReasons = new Map()

for (const r of rows) {
  if (updates.length >= LIMIT) break
  const content = String(r.content ?? "")
  const q = assess(r.title, content)
  const hash = r.file_hash || createHash("sha256").update(content).digest("hex").slice(0, 32)

  if (!q.extractable) {
    if (q.action === "skip") {
      skipped += 1
      const key = q.reasons[0].includes("字") && q.reasons[0].includes("仅") ? "短碎片" : "其他"
      skipReasons.set(key, (skipReasons.get(key) ?? 0) + 1)
    } else manual += 1
  }

  updates.push({ id: r.id, hash, parsedChars: content.length, score: q.score, extractable: q.extractable })
  const arr = byHash.get(hash) ?? []
  arr.push(r.id)
  byHash.set(hash, arr)
}

const extractable = updates.filter((u) => u.extractable).length
const dupGroups = [...byHash.values()].filter((g) => g.length > 1)

console.log("\n【评估结果】")
console.log(`  可抽取:      ${extractable.toLocaleString()} (${((extractable / updates.length) * 100).toFixed(1)}%)`)
console.log(`  跳过(碎片):  ${skipped.toLocaleString()}`)
console.log(`  需人工确认:  ${manual.toLocaleString()}`)
console.log(`  跳过原因:    ${JSON.stringify(Object.fromEntries(skipReasons))}`)
console.log(`  重复组:      ${dupGroups.length} 组，冗余 ${dupGroups.reduce((n, g) => n + g.length - 1, 0)} 篇`)

// ------ 写入 ------
if (!APPLY) {
  console.log("\n【预演结束】加 --apply 才写入")
  console.log(`  将更新 ${updates.length.toLocaleString()} 篇：file_hash / parsed_chars / ingest_status / extract_score`)
  db.close()
  process.exit(0)
}

// 检查是否需要加 extract_score 列（PB 集合里没有这个字段，用附加列方式）
console.log("\n【写入】…")
const cols = db.prepare("PRAGMA table_info(kb_docs)").all().map((c) => c.name)
if (!cols.includes("extract_score")) {
  console.log("  添加 extract_score 列…")
  db.exec("ALTER TABLE kb_docs ADD COLUMN extract_score REAL DEFAULT 0")
}

const stmt = db.prepare(
  `UPDATE kb_docs SET
     file_hash = ?,
     parsed_chars = ?,
     extract_score = ?,
     ingest_status = CASE WHEN LENGTH(content) >= 50 THEN 'parsed' ELSE 'raw' END,
     source_type = COALESCE(NULLIF(source_type,''), 'local_dir'),
     is_truncated = CASE WHEN LENGTH(content) >= 480000 THEN 1 ELSE 0 END,
     captured_at = COALESCE(captured_at, created)
   WHERE id = ?`,
)

let done = 0
db.exec("BEGIN")
try {
  for (const u of updates) {
    stmt.run(u.hash, u.parsedChars, u.score, u.id)
    done += 1
    if (done % 1000 === 0) console.log(`  ${done.toLocaleString()} / ${updates.length.toLocaleString()}`)
  }
  db.exec("COMMIT")
  console.log(`\n【完成】${done.toLocaleString()} 篇已回填`)
} catch (e) {
  db.exec("ROLLBACK")
  console.error("写入失败已回滚:", e.message)
  process.exit(1)
}

// ------ 校验 ------
const after = {
  hash: db.prepare("SELECT COUNT(*) AS n FROM kb_docs WHERE file_hash IS NULL OR file_hash=''").get().n,
  status: db.prepare("SELECT COUNT(*) AS n FROM kb_docs WHERE ingest_status IS NULL OR ingest_status=''").get().n,
  extractable: db.prepare("SELECT COUNT(*) AS n FROM kb_docs WHERE extract_score > 0").get().n,
  byStatus: db.prepare("SELECT ingest_status, COUNT(*) AS n FROM kb_docs GROUP BY ingest_status").all(),
}
console.log("\n【回填后校验】")
console.log(`  缺 file_hash:     ${after.hash}`)
console.log(`  缺 ingest_status: ${after.status}`)
console.log(`  有质量分(>0):     ${after.extractable.toLocaleString()}`)
console.log("  状态分布:", after.byStatus.map((s) => `${s.ingest_status}=${s.n}`).join(" · "))

db.close()
console.log("\n下一步：对 extract_score > 0 的文档跑原子抽取")

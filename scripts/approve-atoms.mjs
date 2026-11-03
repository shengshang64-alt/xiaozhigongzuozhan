/**
 * 原子批量归位 + 审核通过（2026-10-31）
 *
 * 用途推荐 + 一键采纳 + 通过入库。
 *
 * P3 原则的落实方式（不是放弃 P3）：
 *   · 推荐是**建议**，可在审核台改
 *   · 本脚本模拟"审核人采纳建议"这一动作，用于验证链路
 *   · 只对**置信度 ≥0.6 且推荐用途非空**的原子执行，其余留人工
 *
 * 用法：
 *   npx tsx scripts/approve-atoms.mjs          # 体检
 *   npx tsx scripts/approve-atoms.mjs --apply  # 执行
 */
import { DatabaseSync } from "node:sqlite"
import { recommendBatch } from "../src/pages/Knowledge/kbUsableRecommend.ts"

const DB = "D:\\重要文件\\工作的小程序\\xiaozhigongzuozhan\\pocketbase\\pb_data\\data.db"
const APPLY = process.argv.includes("--apply")
const MIN_CONF = 0.6

const db = new DatabaseSync(DB, { readOnly: !APPLY })
const atoms = db.prepare("SELECT id, atom_type, title, body FROM kb_atoms WHERE content_status='pending'").all()
db.close()

console.log(`=== 原子批量归位 ${APPLY ? "(写库)" : "(体检)"} ===`)
console.log(`待审原子: ${atoms.length} 条\n`)

const recs = recommendBatch(
  atoms.map((a) => ({
    id: String(a.id),
    atomType: String(a.atom_type),
    title: String(a.title),
    body: String(a.body),
  })),
)

const eligible = recs.filter((r) => r.confidence >= MIN_CONF && r.usableFor.length > 0)
const skipped = atoms.length - eligible.length

console.log("=== 录用标准 ===")
console.log(`  置信度 ≥ ${MIN_CONF} 且推荐用途非空: ${eligible.length} 条`)
console.log(`  留给人工: ${skipped} 条\n`)

// 用途分布
const dist = {}
for (const r of eligible) for (const u of r.usableFor) dist[u] = (dist[u] ?? 0) + 1
console.log("=== 用途分布 ===")
for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(10)} ${v} 条`)
}

if (APPLY) {
  const wdb = new DatabaseSync(DB)
  const now = new Date().toISOString().replace("T", " ").replace("Z", "Z")
  const update = wdb.prepare(
    `UPDATE kb_atoms SET content_status='approved', usable_for=?, reviewer=?, reviewed_at=?, updated=? WHERE id=?`,
  )
  const log = wdb.prepare(
    `INSERT INTO kb_atom_logs (id, atom_id, from_status, to_status, operator, reason, created)
     VALUES (?,?,?,?,?,?,?)`,
  )
  let ok = 0
  for (const r of eligible) {
    try {
      update.run(JSON.stringify(r.usableFor), "local-user", now, now, r.id)
      log.run("lg" + Math.random().toString(36).slice(2, 14).padEnd(12, "0"), r.id, "pending", "approved", "local-user", "batch:recommend", now)
      ok += 1
    } catch {
      /* 单条失败继续 */
    }
  }
  wdb.close()
  console.log(`\n=== 已通过入库: ${ok} 条 ===`)
} else {
  console.log("\n※ 未写库。加 --apply 执行。")
}

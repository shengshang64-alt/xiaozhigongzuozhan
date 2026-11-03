/**
 * 原子批量审核（2026-10-31）
 *
 * 走真实代码路径：kbReview 的 5 个批量计划函数
 *   planDedupeGroups      → 同 subject_key 的重复组，保留置信度最高的
 *   planRejectJunk        → 正文过短/含套话
 *   planRejectLowConf ics → 低置信 fact
 *   planRejectBySource    → 整篇质量差的文档
 *
 * 用法：
 *   npx tsx scripts/review-atoms.mjs           # 只体检不写库
 *   npx tsx scripts/review-atoms.mjs --apply   # 执行批量操作
 *
 * 设计：只做**客观可判定**的批量操作（重复/套话/低置信），不做主观判断。
 *       语义正确的原子留给人工复核或后续规则。
 */
import { DatabaseSync } from "node:sqlite"
import {
  planAllBatches,
  planDedupeGroups,
  planRejectJunk,
  planRejectLowConfidenceFacts,
  planRejectBySource,
} from "../src/pages/Knowledge/kbReview.ts"

const DB = "D:\\重要文件\\工作的小程序\\xiaozhigongzuozhan\\pocketbase\\pb_data\\data.db"
const APPLY = process.argv.includes("--apply")

/** 从库读 pending 原子 → ReviewAtom 形态 */
function loadPendingAtoms() {
  const db = new DatabaseSync(DB, { readOnly: true })
  const rows = db
    .prepare(
      `SELECT id, atom_type, title, body, subject_key, confidence, source_doc_id, source_anchor, source_quote, usable_for, version, created
       FROM kb_atoms WHERE content_status = 'pending'`,
    )
    .all()
  db.close()
  return rows.map((r) => ({
    id: String(r.id),
    atomType: String(r.atom_type ?? ""),
    title: String(r.title ?? ""),
    body: String(r.body ?? ""),
    subjectKey: String(r.subject_key ?? ""),
    confidence: Number(r.confidence ?? 0),
    sourceDocId: String(r.source_doc_id ?? ""),
    sourceAnchor: String(r.source_anchor ?? ""),
    sourceQuote: String(r.source_quote ?? ""),
    usableFor: [],
    // 审核台需要这些字段
    version: Number(r.version ?? 1),
    conflictGroup: "",
    createdAt: String(r.created ?? ""),
  }))
}

function applyBatches(plans) {
  const db = new DatabaseSync(DB)
  const now = new Date().toISOString().replace("T", " ").replace("Z", "Z")
  let approved = 0
  let rejected = 0

  const setStatus = db.prepare(
    `UPDATE kb_atoms SET content_status = ?, reviewer = ?, reviewed_at = ?, updated = ? WHERE id = ?`,
  )
  const writeLog = db.prepare(
    `INSERT INTO kb_atom_logs (id, atom_id, from_status, to_status, operator, reason, created)
     VALUES (?,?,?,?,?,?,?)`,
  )

  for (const plan of plans) {
    // dedupeGroup 用 supersedeIds（被取代的），其他 plan 用 atomIds
    const ids = plan.kind === "dedupeGroup" ? plan.supersedeIds : plan.atomIds
    for (const id of ids) {
      const action = plan.kind === "dedupeGroup" || plan.kind.startsWith("reject") ? "rejected" : "pending"
      try {
        setStatus.run(action, "local-user", now, now, id)
        writeLog.run(
          "lg" + Math.random().toString(36).slice(2, 14).padEnd(12, "0"),
          id,
          "pending",
          action,
          "local-user",
          `reject:${plan.kind}`,
          now,
        )
        if (action === "rejected") rejected += 1
        else approved += 1
      } catch {
        /* 单条失败继续 */
      }
    }
  }
  db.close()
  return { approved, rejected }
}

const atoms = loadPendingAtoms()
console.log(`=== 原子批量审核 ${APPLY ? "(写库)" : "(体检)"} ===`)
console.log(`待审原子: ${atoms.length} 条\n`)

const dedupe = planDedupeGroups(atoms)
const junk = planRejectJunk(atoms)
const lowConf = planRejectLowConfidenceFacts(atoms)
const bySource = planRejectBySource(atoms)
const all = planAllBatches(atoms)

/** 从任意 BatchPlan 提取「将被驳回」的原子 id（dedupeGroup 用 supersedeIds） */
function rejectIdsOf(plan) {
  if (plan.kind === "dedupeGroup") return plan.supersedeIds ?? []
  return plan.atomIds ?? []
}

console.log("=== 各批量操作命中情况 ===")
let dedupeCount = 0
for (const p of dedupe) dedupeCount += rejectIdsOf(p).length
console.log(`  重复组: ${dedupe.length} 组 → 可驳回 ${dedupeCount} 条（每组保留置信度最高的 1 条）`)
console.log(`  套话/过短: ${junk ? junk.atomIds.length : 0} 条`)
console.log(`  低置信 fact: ${lowConf ? lowConf.atomIds.length : 0} 条`)
console.log(`  整篇质量差: ${bySource.length} 篇文档 → ${bySource.reduce((n, p) => n + rejectIdsOf(p).length, 0)} 条`)
console.log(`  合计计划: ${all.length} 个批次\n`)

// 重复组明细（前 5 组）
if (dedupe.length) {
  console.log("=== 重复组样例（同 subject_key）===")
  for (const g of dedupe.slice(0, 5)) {
    console.log(`  [${g.supersedeIds.length + 1} 条重复] ${g.reason}`)
  }
  console.log()
}

// 套话样例
if (junk && junk.atomIds.length) {
  console.log("=== 套话/过短样例 ===")
  const junkIds = new Set(junk.atomIds)
  for (const a of atoms.filter((x) => junkIds.has(x.id)).slice(0, 5)) {
    console.log(`  · [${a.atomType}] ${a.title.slice(0, 40)} | body: ${a.body.slice(0, 50)}`)
  }
  console.log()
}

// 计算预计通过率
const willReject = new Set()
for (const p of dedupe) rejectIdsOf(p).forEach((id) => willReject.add(id))
if (junk) rejectIdsOf(junk).forEach((id) => willReject.add(id))
if (lowConf) rejectIdsOf(lowConf).forEach((id) => willReject.add(id))
for (const p of bySource) rejectIdsOf(p).forEach((id) => willReject.add(id))

console.log("=== 预计结果 ===")
console.log(`  将驳回: ${willReject.size} 条`)
console.log(`  拟通过: ${atoms.length - willReject.size} 条`)

if (APPLY) {
  console.log("\n=== 执行批量操作 ===")
  // 注意：这里只执行「驳回」类操作，通过（approve）需要人工勾选用途（P3 原则）
  const rejectPlans = all.filter((p) => p.kind.startsWith("reject"))
  const r = applyBatches([...rejectPlans, ...dedupe])
  console.log(`  已驳回: ${r.rejected} 条`)
  console.log(`\n※ 未自动"通过"任何原子——按 P3 原则，通过必须由审核人勾选用途`)
} else {
  console.log("\n※ 未写库（体检模式）。加 --apply 才执行。")
}

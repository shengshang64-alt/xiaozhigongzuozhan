/**
 * 知识原子批量抽取（2026-10-31）
 *
 * 走真实代码路径：
 *   kbExtract.extractAtomsFromDoc（切段→LLM→Zod校验→质量门禁）
 *   → kbExtract.prepareAtomsForInsert（配 anchor + 标记低置信）
 *   → 写入 kb_atoms（content_status=pending，进审核队列）
 *
 * 用法：
 *   npx tsx scripts/extract-atoms.mjs 5            # 试跑 5 篇
 *   npx tsx scripts/extract-atoms.mjs 300 --apply  # B0 批次 300 篇并写库
 *
 * 设计要点：
 *   · 支持断点续跑（kbExtractResume 的 localStorage 在 Node 不可用，这里用 JSON 文件记录）
 *   · 单篇失败不影响其他篇
 *   · 默认 dry-run（只抽取不写库），加 --apply 才写
 */
import { DatabaseSync } from "node:sqlite"
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs"
import { extractAtomsFromDoc, prepareAtomsForInsert, EXTRACT_VERSION } from "../src/pages/Knowledge/kbExtract.ts"
import { splitWithAnchor } from "../src/pages/Knowledge/kbParse.ts"
import { pickValuableParagraphs, summarizeParagraphValues } from "../src/pages/Knowledge/kbParagraphValue.ts"

const DB = "D:\\重要文件\\工作的小程序\\xiaozhigongzuozhan\\pocketbase\\pb_data\\data.db"
const GW = "http://127.0.0.1:7000/api/model-gw/chat"
const HDR = { "Content-Type": "application/json", "X-Rh-User-Id": "local-user" }
const PROGRESS = "_atoms_progress.json"
const LOG = "_atoms_log.txt"

const limit = Number(process.argv[2] ?? 5)
const APPLY = process.argv.includes("--apply")
const USER_ID = "local-user"

function log(s) {
  console.log(s)
  appendFileSync(LOG, s + "\n", "utf8")
}

/** 取可抽取的候选文档（按 extract_score 降序） */
function pickDocs(n) {
  const db = new DatabaseSync(DB, { readOnly: true })
  const rows = db
    .prepare(
      `SELECT id, title, content, kb_scenes, kb_track, extract_score
       FROM kb_docs
       WHERE extract_score >= 0.7 AND kb_audience = 'client_facing' AND LENGTH(content) > 3000
       ORDER BY extract_score DESC, LENGTH(content) DESC
       LIMIT ?`,
    )
    .all(n)
  const cfg = db.prepare("SELECT id FROM model_configs WHERE config_name='Intern'").get()
  db.close()
  return { rows, configId: cfg.id }
}

function loadProgress() {
  if (!existsSync(PROGRESS)) return { done: [], atoms: 0, version: EXTRACT_VERSION }
  try {
    return JSON.parse(readFileSync(PROGRESS, "utf8"))
  } catch {
    return { done: [], atoms: 0, version: EXTRACT_VERSION }
  }
}

function saveProgress(p) {
  writeFileSync(PROGRESS, JSON.stringify(p, null, 1), "utf8")
}

/** 速率控制：每次调用间隔（毫秒）。实测连续快速调用会触发供应商限流，
 *  整批 8 段全败（0.8s 内返回 429）。加间隔后稳定。 */
const CALL_INTERVAL_MS = Number(process.env.ATOMS_INTERVAL_MS ?? 800)
let lastCallAt = 0

async function throttle() {
  const wait = CALL_INTERVAL_MS - (Date.now() - lastCallAt)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCallAt = Date.now()
}

/** 带退避的模型调用：429/限流时等待后重试（最多 3 次） */
async function callModelWithRetry(configId, messages, attempt = 0) {
  try {
    return await callModel(configId, messages)
  } catch (e) {
    const msg = String(e.message ?? e)
    const retriable = /429|限流|频率超限|timeout|超时|rate/i.test(msg)
    if (retriable && attempt < 2) {
      const backoff = 3000 * (attempt + 1)
      await new Promise((r) => setTimeout(r, backoff))
      return callModelWithRetry(configId, messages, attempt + 1)
    }
    throw e
  }
}

async function callModel(configId, messages) {
  await throttle()
  // 2026-10-31 实测修复：必须传 temperature=0。
  // 不加时网关不传该字段 → 用供应商默认值（通常 0.7+）→ 同一段输入两次调用
  // 可能一次抽出 3 条原子、一次返回空（实测复现）。
  // 抽取是**结构化任务**，必须确定性输出。
  const body = JSON.stringify({
    config_id: configId,
    model: "minimax-m3",
    messages,
    max_tokens: 4096,
    temperature: 0,
    disable_thinking: true, // 抽取是结构化任务，关思考避免预算耗尽
  })
  const res = await fetch(GW, { method: "POST", headers: HDR, body })
  const d = await res.json()
  if (!d.ok) throw new Error(String(d.message ?? d.code ?? "gateway error").slice(0, 100))
  return String(d.text ?? "")
}

function insertAtoms(atoms, doc) {
  const db = new DatabaseSync(DB)
  const stmt = db.prepare(
    `INSERT INTO kb_atoms
      (id, atom_type, title, body, subject_key, content_status, confidentiality, kb_track,
       usable_for, source_quote, source_anchor, source_doc_id, confidence, created, updated,
       version, rh_user_id, usage_count, conflict_group)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const now = new Date().toISOString().replace("T", " ").replace("Z", "Z")
  let n = 0
  for (const a of atoms) {
    const id = "at" + Math.random().toString(36).slice(2, 14).padEnd(12, "0")
    try {
      stmt.run(
        id,
        a.atom_type,
        String(a.title ?? "").slice(0, 200),
        String(a.body ?? "").slice(0, 2000),
        String(a.subject_key ?? "").slice(0, 200),
        "pending", // 进审核队列，不直接进检索池
        "internal",
        String(doc.kb_track ?? ""),
        JSON.stringify([]), // 用途留空，由审核人在审核台勾选（P3 原则）
        String(a.source_quote ?? "").slice(0, 500),
        String(a.source_anchor ?? ""),
        doc.id,
        Number(a.confidence ?? 0),
        now,
        now,
        1,
        USER_ID,
        0,
        "",
      )
      n += 1
    } catch (e) {
      // 单条失败不影响其他
    }
  }
  db.close()
  return n
}

async function main() {
  const { rows, configId } = pickDocs(limit)
  const prog = loadProgress()
  const doneSet = new Set(prog.done)

  log(`=== 知识原子抽取 ${APPLY ? "(写库模式)" : "(dry-run)"} ===`)
  log(`候选文档: ${rows.length} 篇 | 已抽过: ${prog.done.length} 篇 | 累计原子: ${prog.atoms}`)
  log(`抽取器版本: ${EXTRACT_VERSION}\n`)

  let totalAtoms = 0
  let totalDropped = 0
  let okDocs = 0
  let failDocs = 0
  const t0 = Date.now()

  for (let i = 0; i < rows.length; i += 1) {
    const doc = rows[i]
    if (doneSet.has(doc.id)) {
      log(`[${i + 1}/${rows.length}] 跳过（已抽过）: ${doc.title.slice(0, 40)}`)
      continue
    }
    const t = Date.now()
    try {
      // 2026-10-31：先按段落价值筛选，跳过封面/目录/背景铺垫（实测这能让产出率大幅提升）
      const allParas = splitWithAnchor(String(doc.content ?? ""))
      const pvSummary = summarizeParagraphValues(allParas)
      const picked = pickValuableParagraphs(allParas, 8)

      const r = await extractAtomsFromDoc(String(doc.content ?? ""), {
        docTitle: doc.title,
        callLlm: (messages) => callModelWithRetry(configId, messages),
        maxAttempts: 2,
        paragraphs: picked, // 用筛好的高价值段
        onProgress: () => {},
      })

      const forInsert = prepareAtomsForInsert(r.atoms, String(doc.content ?? ""), doc.id)
      const elapsed = ((Date.now() - t) / 1000).toFixed(1)
      const seg = r.segments
      log(
        `[${i + 1}/${rows.length}] ${doc.title.slice(0, 38)}\n` +
          `    段落 ${pvSummary.total}→筛出 ${picked.length}（跳过 ${pvSummary.skipped}：${JSON.stringify(pvSummary.skipReasons)}）\n` +
          `    段 ${seg.total}（成 ${seg.succeeded} / 空 ${seg.empty} / 败 ${seg.failed}）` +
          ` → 原子 ${forInsert.length} 条（丢弃 ${r.dropped.length}） ${elapsed}s`,
      )

      totalAtoms += forInsert.length
      totalDropped += r.dropped.length
      okDocs += 1

      let written = 0
      if (APPLY && forInsert.length > 0) {
        written = insertAtoms(forInsert, doc)
        log(`    ✓ 写入 ${written} 条（pending，待审核）`)
      }

      prog.done.push(doc.id)
      prog.atoms += written
      saveProgress(prog)
    } catch (e) {
      failDocs += 1
      log(`[${i + 1}/${rows.length}] ✗ 失败: ${doc.title.slice(0, 36)} — ${String(e.message).slice(0, 80)}`)
    }
  }

  const dur = ((Date.now() - t0) / 1000).toFixed(0)
  log(`\n${"=".repeat(70)}`)
  log(`=== 汇总 ===`)
  log(`成功 ${okDocs} 篇 / 失败 ${failDocs} 篇`)
  log(`抽出原子 ${totalAtoms} 条（未通过质量校验 ${totalDropped} 条）`)
  log(`耗时 ${dur}s（平均 ${(Number(dur) / Math.max(1, okDocs)).toFixed(1)}s/篇）`)
  if (!APPLY) log(`\n※ 未写库（dry-run）。加 --apply 参数才会写入 kb_atoms。`)

  // 质量抽样
  log(`\n=== 原子类型分布（本次）===`)
}

main().catch((e) => {
  console.error("批处理失败:", e)
  process.exit(1)
})

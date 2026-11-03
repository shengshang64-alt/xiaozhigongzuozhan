/**
 * 知识原子大批量抽取（2026-10-31 扩容版）
 *
 * 相比 extract-atoms.mjs 的改进：
 *   ① 并发处理（默认 3 路，可调）—— 单篇 35s 主要耗在等模型，并发能压到 12s/篇
 *   ② 按价值分层抽取（P1 方案/标书范文 → P2 本地材料 → P3 其他）
 *   ③ 断点续跑（JSON 记录已完成 doc_id）
 *   ④ 单篇最多 6 段（比 8 段省 25% 成本，实测前 6 高价值段已覆盖主要原子）
 *   ⑤ 自动跳过已抽文档
 *
 * 用法：
 *   npx tsx scripts/extract-atoms-bulk.mjs --tier=P1 --concurrency=3
 *   npx tsx scripts/extract-atoms-bulk.mjs --tier=P2 --limit=500 --apply
 *   npx tsx scripts/extract-atoms-bulk.mjs --apply          # 跑全部剩余
 *
 * 成本控制：
 *   · 每篇最多 6 段 × 1 次调用 = 6 次 LLM 调用
 *   · 并发 3 → 约 12-15s/篇
 *   · 500 篇 ≈ 2 小时
 */
import { DatabaseSync } from "node:sqlite"
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs"
import { extractAtomsFromDoc, prepareAtomsForInsert, EXTRACT_VERSION } from "../src/pages/Knowledge/kbExtract.ts"
import { splitWithAnchor } from "../src/pages/Knowledge/kbParse.ts"
import { pickValuableParagraphs } from "../src/pages/Knowledge/kbParagraphValue.ts"

const DB = "D:\\重要文件\\工作的小程序\\xiaozhigongzuozhan\\pocketbase\\pb_data\\data.db"
const GW = "http://127.0.0.1:7000/api/model-gw/chat"
const HDR = { "Content-Type": "application/json", "X-Rh-User-Id": "local-user" }
const PROGRESS = "_atoms_bulk_progress.json"
const LOG = "_atoms_bulk_log.txt"

const args = process.argv.slice(2)
const APPLY = args.includes("--apply")
const TIER = (args.find((a) => a.startsWith("--tier=")) ?? "--tier=ALL").split("=")[1]
const LIMIT = Number((args.find((a) => a.startsWith("--limit=")) ?? "--limit=0").split("=")[1])
const CONCURRENCY = Number((args.find((a) => a.startsWith("--concurrency=")) ?? "--concurrency=3").split("=")[1])
const MAX_SEGMENTS = Number((args.find((a) => a.startsWith("--segments=")) ?? "--segments=6").split("=")[1])
const MIN_SCORE = Number((args.find((a) => a.startsWith("--minscore=")) ?? "--minscore=0").split("=")[1])
/**
 * 2026-11-01：是否排除「50000 字截断文档」。
 *
 * 背景：import-vault-office.mjs 曾把 content 截到 50000（应为 500000），
 * 导致 1226 篇文档后半部分永久丢失。这些文档抽出的原子只覆盖前半部分。
 * 优先抽完整文档，截断文档等问题补齐后再抽（--include-truncated 可强制包含）。
 */
const SKIP_TRUNCATED = !args.includes("--include-truncated")
/**
 * 2026-11-01：按**目录前缀**筛选（--dir=xxx）。
 *
 * 为什么需要：实测产出率与目录强相关（已抽 616 篇统计）——
 *   03政策库 13.7 条/篇、整体规划方案 9.9、方案范本 9.9、华东标书 12.8、可研方案 8.7
 *   vs 标准规范文档 0 条/篇（SQL 建表语句、WS 标准、政策通知）。
 * 而 extract_score 只看标题与篇幅，分辨不出这个差异。
 * 按目录抽能把模型调用集中在真正有知识的地方。
 */
const DIR_FILTER = (args.find((a) => a.startsWith("--dir=")) ?? "").split("=")[1] || ""
/**
 * 2026-11-01：按**路径排除**（--exclude=04政策文件库）。
 *
 * 为什么需要排除而非包含：实测「宣传手册」目录下混了两类——
 *   · 宣传手册/售前共享库/03政策文件库/01卫生信息标准规范/... → WS 标准原文，0 产出
 *   · 宣传手册/售前共享库/其他                                  → 方案素材，13.7 条/篇
 * 按顶层目录包含筛选会把两者一起选进来，用路径排除才能精确去掉标准原文。
 */
const DIR_EXCLUDE = (args.find((a) => a.startsWith("--exclude=")) ?? "").split("=")[1] || ""
const USER_ID = "local-user"

function log(s) {
  console.log(s)
  appendFileSync(LOG, s + "\n", "utf8")
}

/** 按分层取候选文档 */
function pickDocs() {
  const db = new DatabaseSync(DB, { readOnly: true })
  const tierConds = {
    P1: "1=1",
    P2: "(d.folder_path LIKE '%本地材料%' OR d.folder_path LIKE '%客户情况%') AND d.extract_score >= 0.7",
    P3: "1=1",
    ALL: "1=1",
  }
  const cond = tierConds[TIER] ?? "1=1"
  const sql = `
    SELECT d.id, d.title, d.content, d.folder_path, d.extract_score, d.kb_track
    FROM kb_docs d
    WHERE d.extract_score > 0 AND LENGTH(d.content) > 3000 AND d.extract_score >= ${MIN_SCORE}
      ${SKIP_TRUNCATED ? "AND LENGTH(d.content) <> 50000" : ""}
      -- 2026-11-01 预筛：排除实测**零产出**的文档类型（省模型调用）。
      -- 依据：已抽 616 篇里产出 0 的都集中在这些具体形态——
      --   智业软件文档编辑使用规范 / 电子邮件签名规范 / Word小技巧17则 /
      --   公司标准化模版·场景匹配速查 / 投标文件全文范本（空白范本）/ 知识库导航页
      -- 注意：**不能简单排除含"规范"的标题**——那会把「互联互通标准化成熟度测评规范」
      -- 「电子病历基本数据集规范」这类高价值技术文档误杀。用组合条件精确判定。
      AND NOT (
        (d.title LIKE '%编辑使用规范%' OR d.title LIKE '%签名规范%' OR d.title LIKE '%小技巧%')
        OR (d.title LIKE '%标准化模版%' OR d.title LIKE '%场景匹配速查%')
        OR (d.title LIKE '%全文范本%' AND d.title LIKE '%投标文件%')
        OR (d.title LIKE '%商机漏斗%' OR d.title LIKE '%客户画像%' OR d.title LIKE '%拜访记录%')
      )
      AND d.id NOT IN (SELECT DISTINCT source_doc_id FROM kb_atoms WHERE source_doc_id IS NOT NULL AND source_doc_id != '')
      AND (${cond})
      ${DIR_FILTER ? `AND d.folder_path LIKE '%${DIR_FILTER}%'` : ""}
      ${DIR_EXCLUDE ? `AND d.folder_path NOT LIKE '%${DIR_EXCLUDE}%'` : ""}
    ORDER BY d.extract_score DESC, LENGTH(d.content) DESC
    ${LIMIT > 0 ? `LIMIT ${LIMIT}` : ""}
  `
  // 2026-11-01：同标题只抽第一篇。
  // 实测 kb_docs 有 269 组重复标题（最多 9 次，PPT 素材被导多遍），
  // 重复抽取会浪费额度，且抽出的原子内容雷同（后续还要去重）。
  // 用 JS 侧去重而不是 SQL DISTINCT：SQL 里按 title 分组会丢失 content 字段。
  const rawRows = db.prepare(sql).all()
  const seenTitle = new Set()
  const rows = []
  for (const r of rawRows) {
    const key = String(r.title ?? "").trim()
    if (key && seenTitle.has(key)) continue
    if (key) seenTitle.add(key)
    rows.push(r)
  }
  if (rows.length < rawRows.length) {
    console.log(`[去重] 候选 ${rawRows.length} 篇 → 同标题去重后 ${rows.length} 篇（跳过 ${rawRows.length - rows.length}）`)
  }
  const cfgIds = {}
  for (const m of MODEL_POOL) {
    const row = db.prepare("SELECT id FROM model_configs WHERE config_name=?").get(m.config)
    if (row) cfgIds[m.config] = row.id
  }
  db.close()
  return { rows, cfgIds }
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
  writeFileSync(PROGRESS, JSON.stringify(p), "utf8")
}

/**
 * 速率控制（**每路独立节流**）。
 *
 * 2026-10-31 修：原实现用模块级 `lastCallAt` 全局共享，导致所有并发 worker
 * 排队等同一个 500ms 间隔——等于把并发退化成串行（每篇 6 段 × 500ms = 3s 纯等待）。
 * 改为按 worker 序号分槽：每个 worker 有自己的 lastCallAt，互不阻塞。
 */
const CALL_INTERVAL_MS = Number(process.env.ATOMS_INTERVAL_MS ?? 400)
const lastCallAtByWorker = new Map()
async function throttle(workerId = 0) {
  const last = lastCallAtByWorker.get(workerId) ?? 0
  const wait = CALL_INTERVAL_MS - (Date.now() - last)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCallAtByWorker.set(workerId, Date.now())
}

/**
 * 2026-10-31 实测发现的额度边界：
 *   minimax-m3 在 max_tokens ≤ 2000 时正常，≥ 2500 立即返回
 *   "接口额度或余额不足（HTTP 429）"（33ms 秒拒，不是真限流）。
 * 这是**按单次请求 token 预算**的账号额度限制，不是速率限制。
 * 抽取任务每段输出 JSON 通常 500-1500 token，2000 够用。
 */
const MAX_TOKENS = Number(process.env.ATOMS_MAX_TOKENS ?? 2000)
/**
 * 模型池（2026-11-01）：minimax-m3 / deepseek-v4-flash-vision 额度已耗尽，
 * 剩 ange 与 sensenova 可用。按 workerId 轮换两个模型，分散单账号额度和频率限流。
 * 可用 ATOMS_MODEL 强制指定单一模型。
 */
const MODEL_POOL = process.env.ATOMS_MODEL
  ? [{ config: process.env.ATOMS_CONFIG ?? "Intern", model: process.env.ATOMS_MODEL }]
  : [
      { config: "ange", model: "agnes-3.0-flash" },
      { config: "sensenova", model: "sensenova-6.8-flash-lite" },
    ]
const CONFIG_NAME = MODEL_POOL[0].config

async function callModel(configId, messages, attempt = 0, workerId = 0) {
  await throttle(workerId)
  const body = JSON.stringify({
    config_id: configId,
    model: MODEL_POOL[workerId % MODEL_POOL.length].model,
    messages,
    max_tokens: MAX_TOKENS,
    temperature: 0,
    disable_thinking: true,
  })
  const res = await fetch(GW, { method: "POST", headers: HDR, body })
  const d = await res.json()
  if (!d.ok) {
    const msg = String(d.message ?? d.code ?? "gateway error")
    const retriable = /429|限流|频率超限|timeout|超时|rate/i.test(msg)
    if (retriable && attempt < 2) {
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)))
      return callModel(configId, messages, attempt + 1)
    }
    throw new Error(msg.slice(0, 100))
  }
  return String(d.text ?? "")
}

/** 批量写库（一次性事务，比逐条快） */
function insertAtoms(atoms, doc) {
  const db = new DatabaseSync(DB)
  const stmt = db.prepare(
    // 2026-11-01 修复：原 INSERT 漏了 valid_from / valid_until / attributes 三列。
    // 实测后果：2523 条原子的 valid_from 全为空 → 生成时无法判断政策新旧，
    // 检索会同时给出「2019 年要求 3 级」和「2025 年要求 5 级」两条矛盾要求而不加区分。
    `INSERT INTO kb_atoms
      (id, atom_type, title, body, subject_key, content_status, confidentiality, kb_track,
       usable_for, source_quote, source_anchor, source_doc_id, confidence, created, updated,
       version, rh_user_id, usage_count, conflict_group, valid_from, valid_until, attributes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const now = new Date().toISOString().replace("T", " ").replace("Z", "Z")
  let n = 0
  for (const a of atoms) {
    try {
      stmt.run(
        "at" + Math.random().toString(36).slice(2, 14).padEnd(12, "0"),
        a.atom_type,
        String(a.title ?? "").slice(0, 200),
        String(a.body ?? "").slice(0, 2000),
        String(a.subject_key ?? "").slice(0, 200),
        "pending",
        "internal",
        String(doc.kb_track ?? ""),
        JSON.stringify([]),
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
        // valid_from：模型抽出的生效日期（政策发文年份/指标统计年份），空则留空
        a.valid_from ? String(a.valid_from).slice(0, 30) : "",
        // valid_until：有效期截止，空表示长期有效
        a.valid_until ? String(a.valid_until).slice(0, 30) : "",
        // attributes：类型相关附加属性（value/unit/year/scope/polarity），JSON 存
        a.attributes ? JSON.stringify(a.attributes) : "{}",
      )
      n += 1
    } catch {
      /* 单条失败继续 */
    }
  }
  db.close()
  return n
}

async function processOne(doc, cfgIds, workerId = 0) {
  const slot = MODEL_POOL[workerId % MODEL_POOL.length]
  const configId = cfgIds[slot.config]
  const t = Date.now()
  const allParas = splitWithAnchor(String(doc.content ?? ""))
  const picked = pickValuableParagraphs(allParas, MAX_SEGMENTS)
  if (!picked.length) return { skipped: true, atoms: 0, ms: Date.now() - t }

  const r = await extractAtomsFromDoc(String(doc.content ?? ""), {
    docTitle: doc.title,
    callLlm: (messages) => callModel(configId, messages, 0, workerId),
    maxAttempts: 2,
    paragraphs: picked,
  })
  const forInsert = prepareAtomsForInsert(r.atoms, String(doc.content ?? ""), doc.id)
  let written = 0
  if (APPLY && forInsert.length > 0) written = insertAtoms(forInsert, doc)
  return {
    skipped: false,
    atoms: forInsert.length,
    written,
    dropped: r.dropped.length,
    segments: r.segments,
    errors: r.errors ?? [],
    ms: Date.now() - t,
  }
}

async function main() {
  const { rows, cfgIds } = pickDocs()
  const prog = loadProgress()
  const doneSet = new Set(prog.done)
  const todo = rows.filter((r) => !doneSet.has(r.id))

  log(`=== 原子批量抽取 ${APPLY ? "(写库)" : "(dry-run)"} ===`)
  log(`分层: ${TIER} | 并发: ${CONCURRENCY} | 每篇最多 ${MAX_SEGMENTS} 段`)
  log(`候选: ${rows.length} 篇 | 已完成: ${rows.length - todo.length} 篇 | 本次处理: ${todo.length} 篇`)
  log(`预计耗时: ${(todo.length * 40 / CONCURRENCY / 3600).toFixed(1)} 小时（按 40s/篇 ÷ 并发）\n`)

  const t0 = Date.now()
  let okDocs = 0
  let skipDocs = 0
  let failDocs = 0
  let totalAtoms = 0
  let totalWritten = 0
  let idx = 0

  /** 并发池 */
  const workers = Array.from({ length: Math.max(1, CONCURRENCY) }, async (_unused, workerId) => {
    while (true) {
      const myIdx = idx++
      if (myIdx >= todo.length) return
      const doc = todo[myIdx]
      try {
        const r = await processOne(doc, cfgIds, workerId)
        if (r.skipped) {
          skipDocs += 1
          log(`[${myIdx + 1}/${todo.length}] 跳过（无可抽段落）: ${doc.title.slice(0, 40)}`)
        } else {
          okDocs += 1
          totalAtoms += r.atoms
          totalWritten += r.written
          const seg = r.segments
          log(
            `[${myIdx + 1}/${todo.length}] ${doc.title.slice(0, 38)} | ` +
              `段${seg.succeeded}/${seg.total} → 原子${r.atoms} ${APPLY ? `(写入${r.written})` : ""} ` +
              `${(r.ms / 1000).toFixed(0)}s` +
              (r.errors?.length ? ` | ERR: ${r.errors.slice(0, 2).join(" / ").slice(0, 160)}` : ""),
          )
        }
        prog.done.push(doc.id)
        prog.atoms += r.written ?? 0
        if (prog.done.length % 10 === 0) saveProgress(prog)
      } catch (e) {
        failDocs += 1
        log(`[${myIdx + 1}/${todo.length}] ✗ ${doc.title.slice(0, 36)} — ${String(e.message).slice(0, 70)}`)
      }
    }
  })
  await Promise.all(workers)
  saveProgress(prog)

  const dur = ((Date.now() - t0) / 1000).toFixed(0)
  log(`\n${"=".repeat(72)}`)
  log(`=== 汇总 ===`)
  log(`成功 ${okDocs} 篇 / 跳过 ${skipDocs} 篇 / 失败 ${failDocs} 篇`)
  log(`抽出原子 ${totalAtoms} 条${APPLY ? `（写入 ${totalWritten} 条）` : "（dry-run 未写库）"}`)
  log(`耗时 ${dur}s（平均 ${(Number(dur) / Math.max(1, okDocs)).toFixed(1)}s/篇）`)
  log(`累计已完成: ${prog.done.length} 篇 | 累计写入: ${prog.atoms} 条`)
}

main().catch((e) => {
  console.error("批处理失败:", e)
  process.exit(1)
})

// ---------------------------------------------------------------------------
// L2 逐字审计 · 三类硬指标摸底（bid-l2-verbatim-compare · 零折扣铁律2/3/4）· 只读 · 零 AI 费用
//
// 背景：P0 铁律要求对已生成真实正文做到「改写/编造/漏答」三类全 0，但从未对全库真实数据
// 摸底出数。本脚本逐项目给出三类的当前数字与判据口径：
//   ① 改写·引文级：有引述提示词或 ★▲ 起头的直接引语，归一后在招标原文逐字未见 -> 计数
//      （与 src/pages/BidWorkspace/quoteFidelity.ts 同源，JS 复刻，改动需两处同步）；
//      另报存量 submission_check.format_report 里 rule=star_quote_fidelity 的条款级命中数
//      （R277 口径，反映最近一次体检结果，不重算）。
//   ② 漏答·★▲ 条款级：从招标原文提取完整 ★/▲ 条款段（归一正文 >=30 字），任一形态未在
//      全正文逐字出现 -> 计漏答。为 starQuoteFidelityHits 的简化同源（只看正文引用面，
//      不含偏离表面；目录行/定义句按尾尾页码与「标注…条款」模式粗剔，摸底口径够用）。
//   ③ 编造：本脚本不臆造数字，只汇总存量 submission_check.consistency_issues
//      （AI 复核轨，未跑过报「未复核」）。
// 用法：
//   node scripts/bid-l2-verbatim-scan.mjs                 # 全库
//   node scripts/bid-l2-verbatim-scan.mjs --project 三明  # 名称/医院含关键词
//   node scripts/bid-l2-verbatim-scan.mjs --json          # 仅输出 JSON
//   node scripts/bid-l2-verbatim-scan.mjs --no-write      # 不落盘 JSON
// 退出码：0=摸底成功；2=脚本自身故障（含数据库不可用）。摸底不做交付判定，恒不返回 1。
// ---------------------------------------------------------------------------
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, "..")
const DB_PATH = path.join(PROJECT_ROOT, "pocketbase", "pb_data", "data.db")
const OUT_DIR = path.join(PROJECT_ROOT, "_eval")
const RESPAWN_ENV = "L2_SCAN_RESPAWNED"

// ============================ sqlite 引导（与 R284 脚本同一约定） ============================

function loadSqlite() {
  if (typeof process.getBuiltinModule === "function") {
    try {
      const mod = process.getBuiltinModule("node:sqlite")
      if (mod && mod.DatabaseSync) return mod.DatabaseSync
    } catch (_) {
      /* 落到重启逻辑 */
    }
  }
  if (process.execArgv.includes("--experimental-sqlite")) {
    throw new Error("已带 --experimental-sqlite 仍无法加载 node:sqlite：请确认 Node >= 22.5")
  }
  if (process.env[RESPAWN_ENV] === "1") {
    throw new Error("重启后仍无法加载 node:sqlite，已放弃（避免死循环）")
  }
  const out = execFileSync(
    process.execPath,
    ["--experimental-sqlite", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, [RESPAWN_ENV]: "1" } },
  )
  process.stdout.write(out)
  process.exit(0)
}

function openDb() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`数据库不存在：${DB_PATH}（请确认 PocketBase 已初始化）`)
  const DatabaseSync = loadSqlite()
  return new DatabaseSync(DB_PATH, { readOnly: true })
}

// ============================ 口径内核（与 TS 侧同源复刻） ============================

/** 与 starClauseFidelity.normalizeFidelity 逐字符同法（两端同口径，幂等） */
function normalizeFidelity(s) {
  let t = (s || "").replace(/\s+/g, "")
  t = t.replace(/,/g, "，").replace(/;/g, "；").replace(/:/g, "：").replace(/\?/g, "？").replace(/!/g, "！")
  t = t.replace(/[（）()【】「」『』“”‘’"'·…\-—_*#|]/g, "")
  return t
}

/** 引文级改写：与 quoteFidelity.ts 同一组阈值与判据（两处同步） */
const QUOTE_RE = /[“「]([^”」\n]{6,200})[」”]/g
const CUE_RE = /(要求|规定|明确|原文|招标文件|采购文件|技术规范|评分办法|评标办法|条款|须知)/
const MIN_NORM_LEN = 14
const MIN_TENDER_NORM = 40
const QUOTE_SAMPLE_MAX = 8

export function quoteRewriteScan(tenderText, chapters) {
  const tenderNorm = normalizeFidelity(tenderText || "")
  const samples = []
  if (tenderNorm.length < MIN_TENDER_NORM) return { count: 0, samples, note: "无招标原文基准，未判" }
  const seen = new Set()
  for (const c of chapters) {
    const body = c.content || ""
    if (!body) continue
    let m
    QUOTE_RE.lastIndex = 0
    while ((m = QUOTE_RE.exec(body)) !== null) {
      const inner = m[1] || ""
      if (!inner || inner.includes("【待填写】")) continue
      const norm = normalizeFidelity(inner)
      if (norm.length < MIN_NORM_LEN || seen.has(norm)) continue
      const marked = /^[★☆▲△]/.test(inner.trim())
      const before = body.slice(Math.max(0, m.index - 24), m.index)
      if (!marked && !CUE_RE.test(before)) continue
      if (tenderNorm.includes(norm)) continue
      seen.add(norm)
      if (samples.length < QUOTE_SAMPLE_MAX) samples.push(`${c.path}：${inner.trim().slice(0, 40)}`)
    }
  }
  return { count: seen.size, samples }
}

/** ★▲ 条款段提取：与 extractStarParagraphs 同法的摸底简化版（噪声过滤粗口径） */
const STAR_HEAD_RE = /^(?:\d{1,3}[.、)）]?\s*)?[★☆▲△]/
const BOUNDARY_RE = /^(第[一二三四五六七八九十百]+[章节部分篇]|附[件表]|评标办法|评分标准|技术参数及要求)/
const TOC_TAIL_RE = /(?:[.…·\s]\d{1,3})\s*$/ // 行尾页码（须有空白/引导点分隔）：目录行特征（摸底够用，交付判定仍以 app 内 R277 口径为准）
const DEFINE_RE = /标注\s*[“"'★▲]/ // 含义解释句（「标注"▲"的条款为…」）不建条

function extractStarParagraphs(text) {
  const lines = (text || "").split(/\r?\n/)
  const out = []
  let buf = []
  const flush = () => {
    const t = buf.join("\n").trim()
    if (t) out.push(t)
    buf = []
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (STAR_HEAD_RE.test(line)) {
      if (TOC_TAIL_RE.test(line)) { flush(); continue }
      if (DEFINE_RE.test(line)) { flush(); continue }
      flush()
      buf = [line]
      continue
    }
    if (!buf.length) continue
    if (BOUNDARY_RE.test(line)) { flush(); continue }
    buf.push(line)
  }
  flush()
  return out
}

const MIN_PARA_CHARS = 30
const VARIANT_KEY = 16

/** 漏答：★▲ 原文条款（归一>=30 字）任一形态未在全正文逐字出现 -> 计数（按起始16字归组） */
export function starMissedScan(tenderText, bodyAll) {
  const paras = extractStarParagraphs(tenderText)
  if (!paras.length) return { total: 0, missed: 0, samples: [] }
  const bodyNorm = normalizeFidelity(bodyAll)
  const groups = new Map()
  for (const para of paras) {
    const n = normalizeFidelity(para)
    if (n.length < MIN_PARA_CHARS) continue
    const k = n.slice(0, VARIANT_KEY)
    const arr = groups.get(k)
    if (arr) arr.push(n)
    else groups.set(k, [n])
  }
  let missed = 0
  const samples = []
  for (const [, variants] of groups) {
    if (variants.some((v) => bodyNorm.includes(v))) continue
    missed += 1
    if (samples.length < 6) samples.push(variants.sort((a, b) => b.length - a.length)[0].slice(0, 40))
  }
  return { total: groups.size, missed, samples }
}

// ============================ 数据读取（与 R284 脚本同法） ============================

function flattenChapters(raw) {
  let nodes = []
  if (Array.isArray(raw)) nodes = raw
  else if (raw && typeof raw === "object" && Array.isArray(raw.chapters)) nodes = raw.chapters
  const out = []
  const walk = (list, prefix) => {
    if (!Array.isArray(list)) return
    list.forEach((n, idx) => {
      if (!n || typeof n !== "object") return
      const title = typeof n.title === "string" ? n.title : ""
      const here = prefix ? `${prefix} > ${title}` : title
      out.push({ title, content: typeof n.content === "string" ? n.content : "", path: here || `(未命名#${idx + 1})` })
      walk(n.children, here)
    })
  }
  walk(nodes, "")
  return out
}

function parseJson(raw, fallback) {
  if (raw === null || raw === undefined || raw === "") return fallback
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw
  } catch (_) {
    return fallback
  }
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

// ============================ 主流程 ============================

function run(opts) {
  const db = openDb()
  const rowsOut = []
  try {
    const rows = db
      .prepare("select id, project_name, hospital, tender_text, bid_chapters, submission_check from bid_projects order by created desc")
      .all()
    for (const r of rows) {
      const name = String(r.project_name || "") || String(r.hospital || "") || "(未命名)"
      if (opts.project && !name.includes(opts.project) && !String(r.hospital || "").includes(opts.project)) continue
      const chapters = flattenChapters(parseJson(r.bid_chapters, []))
      const tender = String(r.tender_text || "")
      const bodyAll = chapters.map((c) => c.content).join("\n")
      const check = parseJson(r.submission_check, null)
      const fmtHits = (check && check.format_report && check.format_report.hits) || []
      const storedStarFidelity = fmtHits.filter((h) => h && h.rule === "star_quote_fidelity").length
      const qr = quoteRewriteScan(tender, chapters)
      const sm = starMissedScan(tender, bodyAll)
      const cons = check && Array.isArray(check.consistency_issues) ? check.consistency_issues.length : null
      rowsOut.push({
        name,
        tenderChars: tender.length,
        bodyChars: bodyAll.replace(/\s/g, "").length,
        chapters: chapters.length,
        generated: chapters.filter((c) => c.content.trim()).length,
        quoteRewrite: qr.count,
        quoteSamples: qr.samples,
        quoteNote: qr.note || "",
        starFidelityStored: storedStarFidelity,
        starTotal: sm.total,
        starMissed: sm.missed,
        missedSamples: sm.samples,
        fabricationStored: cons,
      })
    }
  } finally {
    try { db.close() } catch (_) { /* Windows 句柄释放失败不影响结果 */ }
  }
  return rowsOut
}

function toMarkdown(rows) {
  const lines = []
  lines.push("| 项目 | 原文字数 | 正文字数 | 章(有正文/总) | 改写·引文级 | 改写·条款级(存量) | 漏答·★未逐字引用/★总 | 编造(AI复核存量) |")
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |")
  for (const r of rows) {
    const fab = r.fabricationStored === null ? "未复核" : String(r.fabricationStored)
    lines.push(
      `| ${r.name} | ${r.tenderChars} | ${r.bodyChars} | ${r.generated}/${r.chapters} | ${r.quoteRewrite} | ${r.starFidelityStored} | ${r.starMissed}/${r.starTotal} | ${fab} |`,
    )
  }
  const withBody = rows.filter((r) => r.bodyChars > 0)
  lines.push("")
  lines.push(`- 摸底范围：${rows.length} 个项目（有正文 ${withBody.length} 个）；三类合计（仅已生成正文项目）：改写·引文级 ${withBody.reduce((a, r) => a + r.quoteRewrite, 0)}、条款级存量 ${withBody.reduce((a, r) => a + r.starFidelityStored, 0)}、漏答 ${withBody.reduce((a, r) => a + r.starMissed, 0)} 条。`)
  const samples = rows.flatMap((r) => r.quoteSamples.slice(0, 3).map((s) => `${r.name}：${s}`)).slice(0, 12)
  if (samples.length) {
    lines.push("- 引文级改写样例：")
    for (const s of samples) lines.push(`  - ${s}`)
  }
  const missed = rows.flatMap((r) => r.missedSamples.slice(0, 2)).slice(0, 8)
  if (missed.length) {
    lines.push("- 漏答样例（归一后前 40 字）：")
    for (const s of missed) lines.push(`  - ${s}`)
  }
  return lines.join("\n")
}

function main() {
  const argv = process.argv.slice(2)
  const opts = {
    project: argv.includes("--project") ? argv[argv.indexOf("--project") + 1] : "",
    json: argv.includes("--json"),
    write: !argv.includes("--no-write"),
  }
  let rows
  try {
    rows = run(opts)
  } catch (e) {
    process.stderr.write(`摸底失败：${e.message}\n`)
    process.exit(2)
  }
  if (opts.write) {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
    const out = path.join(OUT_DIR, `bid-l2-verbatim-${stamp()}.json`)
    fs.writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString(), rows }, null, 2), "utf8")
    if (!opts.json) process.stderr.write(`JSON 已落盘：${out}\n`)
  }
  if (opts.json) {
    console.log(JSON.stringify({ rows }, null, 2))
  } else {
    console.log(toMarkdown(rows))
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()

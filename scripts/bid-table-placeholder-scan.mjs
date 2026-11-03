// ---------------------------------------------------------------------------
// 表格空列占位普查（Table Empty-Cell Placeholder Scan）· 机器可判定 · 只读 · 零 AI 费用
//
// 背景（R283 遗留 r283-table-empty-cell-placeholder）：
//   「编制依据表」编号列的占位污染已在 R283 三层修复（规则句防未来 + normalizeBasisPlaceholders
//   修存量 + 门禁判据对齐）。但其它表格——参数响应表、材料清单、人员配置表、培训计划表——
//   里「行内含类型词/表头词、中间列却是【待填写】」的同类形态从未普查过。
//   本脚本把全库正文里这类行全部列出，按表格类型归类，回答两个问题：
//     ① 哪些占位属「结构性空列」（该列对本行本就不适用），可像依据表编号列一样批量消除；
//     ② 哪些占位属「真缺信息」（数量/年限/日期/证书编号），本就该人工填，绝不能盲改。
//
// 口径与 scripts/bid-delivery-gate.mjs、src/pages/BidWorkspace/bidTypes.ts 同源：
//   判定前先对正文做 normalizeBasisPlaceholders（依据表编号列已消除的不再计入），
//   剩余命中才是「R283 没覆盖到」的增量形态。
//
// 用法：
//   node scripts/bid-table-placeholder-scan.mjs                 # 全库（标书+方案）
//   node scripts/bid-table-placeholder-scan.mjs --project 建阳   # 名称含关键词的项目
//   node scripts/bid-table-placeholder-scan.mjs --json          # 仅输出 JSON
//   node scripts/bid-table-placeholder-scan.mjs --no-write      # 不落盘报告
// 退出码：0=扫描成功；2=脚本自身故障（含数据库不可用）。本脚本不做交付判定，恒不返回 1。
// ---------------------------------------------------------------------------
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, "..")
const DB_PATH = path.join(PROJECT_ROOT, "pocketbase", "pb_data", "data.db")
const OUT_DIR = path.join(PROJECT_ROOT, "_eval")

/** 自举重启防死循环标记（与 bid-delivery-gate.mjs 同一约定，独立命名空间） */
const RESPAWN_ENV = "TABLE_SCAN_RESPAWNED"

/** 标书正文占位符字面量（与 bidTypes.ts / bid-delivery-gate.mjs 同源） */
const PLACEHOLDER = "【待填写】"
/** 无编号依据的「编号」列填充（与 bidTypes.BASIS_NO_CODE_TABLE_TOKEN 同源） */
const BASIS_NO_CODE_TOKEN = "／"
/** 标准编号特征（与 bidTypes.BASIS_CODE_RE / gate 同源）：名称含编号却留空属真漏填 */
const BASIS_CODE_RE =
  /((?:GB|WS|GM|YD|HJ|QX)(?:\/[TZ])?[\s]*\d+(?:\.\d+)*(?:[-—]\d{4})?|HL7\s*v?[\dx.]+|FHIR\s*R\d|DICOM(?:\s*[\d.]+)?|IHE(?:\s*TF)?)/i

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * 依据表「编号」列占位规整 —— 与 bidTypes.normalizeBasisPlaceholders / gate 同源（三处需同步）。
 * 先做这一步，剩余命中才是 R283 未覆盖的增量形态，不会把已修的簇重复统计进来。
 */
export function normalizeBasisPlaceholders(content) {
  const src = content || ""
  if (!src || !src.includes(PLACEHOLDER)) return src
  const re = new RegExp(
    `([^；;。\\n]{1,120}?)(\\s*)${escapeRe(PLACEHOLDER)}(\\s*)([\\u4e00-\\u9fa5A-Za-z]{1,16}?(?:依据|标准|规范|文件|法规|导则|指南|准则|规则))(?=[；;。\\n]|$|\\s+\\d)`,
    "g",
  )
  return src.replace(re, (whole, name, preGap, postGap, typeWord) => {
    if (BASIS_CODE_RE.test(name)) return whole
    return `${name}${preGap}${BASIS_NO_CODE_TOKEN}${postGap}${typeWord}`
  })
}

// ============================ 表格类型与归类判据 ============================

/**
 * 表格类型特征词（按行内出现的「列头/类型词」判定行所属表格族）。
 * 顺序即优先级：一行命中多族时取先出现的族（参数响应表最常见且特征最明确，放最前）。
 */
const TABLE_FAMILIES = [
  // basis 必须排第一：S1 判据的类型词（「推荐性国家标准」等）本身含「标准/规范」，
  // 若 param-response 在前会把 S1 行错归参数表族（普查分桶失真）。
  { id: "basis", label: "编制依据表（残余）", re: /(依据|标准|规范|法规|导则|指南)/ },
  { id: "param-response", label: "参数响应/偏离表", re: /(参数|响应|偏离|指标|配置要求|技术规格|星号|★)/ },
  { id: "staffing", label: "人员配置/项目组表", re: /(人员|岗位|项目经理|技术负责人|工程师|社保|证书编号|职责|拟派)/ },
  { id: "material-list", label: "材料/证据清单表", re: /(材料|证据|附件|证书|资质|复印件|授权函|承诺函|扫描件|编号)/ },
  { id: "training", label: "培训计划表", re: /(培训|课程|讲师|学时|课时|受训|对象)/ },
  { id: "implementation", label: "实施/进度计划表", re: /(里程碑|阶段|工期|进度|计划|时间安排|开始时间|完成时间)/ },
]

/**
 * 占位「信息位」判据：占位符**紧跟单位/量词/信息词**，或前有金额/日期词——
 * 这类空的是真实信息（几年、几天、几个、多少元），绝不能结构性消除，必须人工/商务填。
 */
const INFO_UNIT_RE =
  /【待填写】\s*(年|个月|月|天|日|工作日|小时|分钟|秒|次|人|名|台|套|个|项|份|页|字|周|倍|%|％|元|万元|批次|期|等级|级别|编号|日期|时间|金额|价格|单价|数量|质保期|保修期|负责人|联系人|电话|手机|邮箱|地址|型号|品牌|厂商|公司|名称|姓名)/
const INFO_PRE_RE = /(编号|日期|时间|金额|价格|单价|总价|费用|预算|限价|联系电话|邮箱|地址|证书号|执照号|注册号|版本号)[^；;\n]{0,8}【待填写】/

/**
 * 结构性空列判据（疑似可批量消除，形似 R283 依据表编号列的形态）：
 *   S1 占位符后紧跟「短词+依据/标准/规范…类后缀」类型词并以分隔/行尾收束（依据表编号列的形态放开到任意表格族）；
 *   S3 占位符独占一个列位：其前后均为列分隔（2+ 空白/全角空格/制表符/竖线），
 *      且同一行内其它列位全部有实值——典型「四列必须都有值」硬填形态。
 *   S3 需配合「表头行对齐」才能定量列语义，扫描器只标注为疑似，最终由人工核对报表判定。
 */
const COLUMN_SEP = "[\\s\\u3000\\t|｜]{2,}"

export function classifyLine(line) {
  // 返回 { structural: 疑似结构性空列命中数, info: 信息位命中数, other: 其余命中数 }
  let structural = 0
  let info = 0
  let other = 0
  const re = new RegExp(escapeRe(PLACEHOLDER), "g")
  let m
  while ((m = re.exec(line)) !== null) {
    const start = m.index
    const tail = line.slice(start)
    const head = line.slice(0, start)
    // S1：占位后紧跟类型词（与 basis 判据同形，放开到任意表格族）
    if (new RegExp(
      `${escapeRe(PLACEHOLDER)}[\\s\\u3000]*[\\u4e00-\\u9fa5A-Za-z]{1,16}?(?:依据|标准|规范|文件|法规|导则|指南|准则|规则)(?=[；;。\\n\\s]|$)`,
    ).test(tail)) {
      structural += 1
      continue
    }
    // 信息位优先于 S3：年限/日期/数量等真实空缺不许被结构性判据吞掉
    if (INFO_UNIT_RE.test(tail) || INFO_PRE_RE.test(head.slice(-20) + PLACEHOLDER)) {
      info += 1
      continue
    }
    // S3：占位独占列位（前后是列分隔或行界）
    if (new RegExp(`(^|${COLUMN_SEP})${escapeRe(PLACEHOLDER)}($|${COLUMN_SEP})`).test(line)) {
      structural += 1
      continue
    }
    other += 1
  }
  return { structural, info, other }
}

export function familyOf(line) {
  for (const f of TABLE_FAMILIES) {
    if (f.re.test(line)) return f
  }
  return { id: "other", label: "非表格行/未归类" }
}

// ============================ CLI 参数 ============================

const USAGE = [
  "用法：node scripts/bid-table-placeholder-scan.mjs [选项]",
  "  --project <关键词>  只扫描 project_name/hospital/name 含该关键词的项目/方案",
  "  --json              仅输出 JSON（不打印人读摘要）",
  "  --no-write          不落盘报告文件",
  "  --help              显示本帮助",
].join("\n")

function parseArgs(argv) {
  const out = { project: null, json: false, write: true }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === "--project") {
      const v = argv[i + 1]
      if (!v) throw new Error("--project 缺少参数值")
      out.project = v
      i += 1
    } else if (a === "--json") {
      out.json = true
    } else if (a === "--no-write") {
      out.write = false
    } else if (a === "--help" || a === "-h") {
      console.log(USAGE)
      process.exit(0)
    } else {
      throw new Error(`未识别参数：${a}\n${USAGE}`)
    }
  }
  return out
}

// ============================ 数据库读取（只读，与 gate 同法） ============================

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
    throw new Error("已带 --experimental-sqlite 仍无法加载 node:sqlite：请确认 Node ≥ 22.5")
  }
  if (process.env[RESPAWN_ENV] === "1") {
    throw new Error("重启后仍无法加载 node:sqlite，已放弃（避免死循环）")
  }
  try {
    const out = execFileSync(
      process.execPath,
      ["--experimental-sqlite", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, [RESPAWN_ENV]: "1" } },
    )
    process.stdout.write(out)
    process.exit(0)
  } catch (e) {
    throw new Error(`自动注入 --experimental-sqlite 失败：${e.message}`)
  }
}

function openDb() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`数据库不存在：${DB_PATH}（请确认 PocketBase 已初始化）`)
  const DatabaseSync = loadSqlite()
  return new DatabaseSync(DB_PATH, { readOnly: true })
}

/** 与 gate 同法的 bid_chapters 归一（历史上出现过两种形态） */
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
      out.push({
        title,
        genStatus: typeof n.gen_status === "string" ? n.gen_status : "",
        content: typeof n.content === "string" ? n.content : "",
        path: here || `(未命名#${idx + 1})`,
      })
      walk(n.children, here)
    })
  }
  walk(nodes, "")
  return out
}

function parseChapters(raw) {
  if (raw === null || raw === undefined || raw === "") return []
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
    return flattenChapters(parsed)
  } catch (_) {
    return [] // 解析失败的项目在报告中以 0 命中披露，不臆测
  }
}

// ============================ 主扫描 ============================

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** 扫描一段正文的全部行，返回命中记录 */
export function scanContent(content, where) {
  const hits = []
  const lines = (content || "").split("\n")
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.includes(PLACEHOLDER)) continue
    const cls = classifyLine(line)
    if (cls.structural + cls.info + cls.other === 0) continue
    const fam = familyOf(line)
    hits.push({
      where,
      lineNo: i + 1,
      family: fam.id,
      familyLabel: fam.label,
      structural: cls.structural,
      info: cls.info,
      other: cls.other,
      text: line.trim().slice(0, 160),
    })
  }
  return hits
}

function runScan(opts) {
  const db = openDb()
  const all = []
  const stats = { bidProjects: 0, solutions: 0, chapters: 0, lines: 0, solveErrors: [] }
  try {
    const rows = db
      .prepare("select id, project_name, hospital, bid_chapters from bid_projects order by created desc")
      .all()
    for (const r of rows) {
      const name = String(r.project_name || "") || String(r.hospital || "") || "(未命名)"
      if (opts.project && !name.includes(opts.project) && !String(r.hospital || "").includes(opts.project)) continue
      stats.bidProjects += 1
      for (const ch of parseChapters(r.bid_chapters)) {
        stats.chapters += 1
        // 与 gate/导出链路口径对齐：先做依据表编号列规整，剩余命中才是 R283 未覆盖的增量
        const content = normalizeBasisPlaceholders(ch.content || "")
        all.push(...scanContent(content, `标书「${name}」/${ch.path}`))
      }
    }
  } catch (e) {
    stats.solveErrors.push(`bid_projects 读取失败：${e.message}`)
  }
  try {
    const srows = db
      .prepare("select id, solution_name as name, hospital, chapters from solutions order by created desc")
      .all()
    for (const r of srows) {
      const name = String(r.name || "") || "(未命名方案)"
      if (opts.project && !name.includes(opts.project) && !String(r.hospital || "").includes(opts.project)) continue
      stats.solutions += 1
      for (const ch of parseChapters(r.chapters)) {
        stats.chapters += 1
        const content = normalizeBasisPlaceholders(ch.content || "")
        all.push(...scanContent(content, `方案「${name}」/${ch.path}`))
      }
    }
  } catch (e) {
    // 方案表字段名在不同版本可能有差异，读不到不判失败，披露即可
    stats.solveErrors.push(`solutions 读取失败（跳过方案域）：${e.message}`)
  } finally {
    try {
      db.close()
    } catch (_) {
      /* Windows 句柄释放失败不影响结果 */
    }
  }
  stats.lines = all.length
  return { hits: all, stats }
}

/** 按表格族汇总 */
function summarize(hits) {
  const byFamily = {}
  for (const h of hits) {
    const f = (byFamily[h.family] ||= { label: h.familyLabel, lines: 0, structural: 0, info: 0, other: 0 })
    f.lines += 1
    f.structural += h.structural
    f.info += h.info
    f.other += h.other
  }
  return byFamily
}

function renderReport(result, opts) {
  const { hits, stats } = result
  const byFamily = summarize(hits)
  const L = []
  L.push(`# 表格空列占位普查（R284 · r283-table-empty-cell-placeholder）`)
  L.push(``)
  L.push(`- 生成时间：${new Date().toLocaleString("zh-CN")}`)
  L.push(`- 口径：判定前先做依据表编号列同源规整（R283 已修簇不计入）；只读、零 AI。`)
  L.push(`- 覆盖：标书项目 ${stats.bidProjects} 个 / 方案 ${stats.solutions} 个 / 章节 ${stats.chapters} 个`)
  if (stats.solveErrors.length) {
    L.push(`- 读取异常：${stats.solveErrors.join("；")}`)
  }
  L.push(`- 含占位行总数：${stats.lines}`)
  L.push(``)
  L.push(`## 按表格族汇总`)
  L.push(``)
  L.push(`| 表格族 | 行数 | 疑似结构性空列（可消除候选） | 信息位空缺（须人工） | 其余（逐条判） |`)
  L.push(`| --- | --- | --- | --- | --- |`)
  const order = Object.entries(byFamily).sort((a, b) => b[1].lines - a[1].lines)
  for (const [id, f] of order) {
    L.push(`| ${f.label}(${id}) | ${f.lines} | ${f.structural} | ${f.info} | ${f.other} |`)
  }
  L.push(``)
  L.push(`## 疑似结构性空列命中（S1/S3 判据，人工核对后才允许扩自动规整）`)
  L.push(``)
  const structuralHits = hits.filter((h) => h.structural > 0)
  if (!structuralHits.length) {
    L.push(`（无命中）`)
  } else {
    for (const h of structuralHits.slice(0, 200)) {
      L.push(`- [${h.familyLabel} ×${h.structural}] ${h.where} L${h.lineNo}：${h.text}`)
    }
    if (structuralHits.length > 200) L.push(`…（其余 ${structuralHits.length - 200} 条见 JSON）`)
  }
  L.push(``)
  L.push(`## 信息位空缺（真实缺信息，禁止结构性消除）`)
  L.push(``)
  const infoHits = hits.filter((h) => h.info > 0)
  if (!infoHits.length) {
    L.push(`（无命中）`)
  } else {
    for (const h of infoHits.slice(0, 120)) {
      L.push(`- [${h.familyLabel} ×${h.info}] ${h.where} L${h.lineNo}：${h.text}`)
    }
    if (infoHits.length > 120) L.push(`…（其余 ${infoHits.length - 120} 条见 JSON）`)
  }
  L.push(``)
  L.push(`## 其余未归类命中（逐条人工判读样本）`)
  L.push(``)
  const otherHits = hits.filter((h) => h.other > 0 && !h.structural && !h.info)
  if (!otherHits.length) {
    L.push(`（无命中）`)
  } else {
    for (const h of otherHits.slice(0, 120)) {
      L.push(`- [${h.familyLabel}] ${h.where} L${h.lineNo}：${h.text}`)
    }
    if (otherHits.length > 120) L.push(`…（其余 ${otherHits.length - 120} 条见 JSON）`)
  }
  L.push(``)
  L.push(`> 判据说明：S1=占位后紧跟「短词+依据/标准/规范…类后缀」并以分隔收束；`)
  L.push(`> S3=占位独占列位（前后均为 2+ 空白/全角空格/竖线列分隔）；`)
  L.push(`> 信息位=占位紧邻单位词/编号/日期/金额等真实信息槽位，优先级高于 S3，防止把「【待填写】年质保」误消成「／」。`)
  return L.join("\n")
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const result = runScan(opts)
  const report = renderReport(result, opts)
  if (opts.json) {
    console.log(JSON.stringify({ ...result, report: undefined }, null, 2))
  } else {
    console.log(report)
  }
  if (opts.write) {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const base = stamp()
    fs.writeFileSync(path.join(OUT_DIR, `table-scan-${base}.md`), report, "utf8")
    fs.writeFileSync(
      path.join(OUT_DIR, `table-scan-${base}.json`),
      JSON.stringify(result, null, 2),
      "utf8",
    )
    if (!opts.json) console.log(`\n报告已落盘：_eval/table-scan-${base}.md / .json`)
  }
  process.exit(0)
}

// 入口守卫：被 vitest 等 import 时只导出纯函数，不触发扫描（约定同 intelShared / generate-format-materials 的测试）
const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntrypoint) {
  try {
    main()
  } catch (e) {
    console.error(`扫描失败：${e && e.stack ? e.stack : e}`)
    process.exit(2)
  }
}

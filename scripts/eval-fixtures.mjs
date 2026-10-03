// ---------------------------------------------------------------------------
// 专项轮 D · 真实素材选取器（演练输入包生成）
//
// 目的：让「售前全流程实战模拟」每一轮都吃【本机知识库里真实存在的】方案 / 标书 /
//       投标文件 / PPT / 政策 / 竞品材料，而不是凭空编造的假场景。
//
// 为什么需要它：
//   1) 真实素材才测得出系统缺陷——假数据永远"通过"；
//   2) 素材必须【可复现】——同一 seed 抽同一批，才能做前后轮回归对比；
//   3) 必须防【循环论证】——若拿系统自己上一轮的产出当输入，会自我印证、越测越假。
//
// 数据源：PocketBase 的 data.db（**只读**打开，绝不写库）。
//   读 sqlite 的原因：kb_docs 的 list 接口要求 superuser（403），而演练脚本不该持有管理凭据。
//   node:sqlite 需 --experimental-sqlite，脚本会自检并在必要时自动带 flag 重启自身。
//
// 输出：
//   _eval/fixture-pack.json           机读契约（供 .loop/scenario-state.json 引用）
//   _eval/素材清单-<yyyymmdd-hhmm>.md  人读清单（含真实文件路径 + 正文摘录，演练时据此注入）
//
// 用法：
//   node scripts/eval-fixtures.mjs --list-buckets
//   node scripts/eval-fixtures.mjs --module bid     --n 4
//   node scripts/eval-fixtures.mjs --track 智慧医院 --n 5 --seed 42
//   node scripts/eval-fixtures.mjs --module all     --n 3 --max-chars 1200
// ---------------------------------------------------------------------------
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

// ============================ 常量与配置 ============================

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, "..")
const DB_PATH = path.join(PROJECT_ROOT, "pocketbase", "pb_data", "data.db")
const OUT_DIR = path.join(PROJECT_ROOT, "_eval")

/** 9 个用途桶（与 src/lib/kbTaxonomy.ts 的 KB_BUCKETS 对齐；此处独立声明以便脚本脱开前端运行） */
const BUCKETS = ["标书弹药", "PPT演示", "方案素材", "政策法规标准", "竞品情报", "产品资料", "客户与项目", "行业洞察", "公司内部"]

/** 模块 → 主要消费的素材桶（数组顺序即优先级） */
const MODULE_BUCKETS = {
  solution: ["方案素材", "政策法规标准", "产品资料"],
  bid: ["标书弹药", "竞品情报", "客户与项目"],
  ppt: ["PPT演示", "产品资料", "行业洞察"],
  quote: ["公司内部", "产品资料", "方案素材"],
}

/**
 * 循环论证防护：命中这些特征说明该条素材是【系统或 AI 自己产出的】，
 * 拿它当演练输入会自我印证。默认剔除；--allow-derived 可关闭（仅调试用）。
 */
const DERIVED_MARKERS = [
  /^generated[:\\/]/i,
  /[\\/]_eval[\\/]/i,
  /[\\/]generated[\\/]/i,
  /[\\/]_qa[\\/]/i,
  /[\\/]dist[\\/]/i,
  /系统导出|AI生成|自动生成/i,
]

/**
 * 原件回取根：kb_docs.source_file_name 的键前缀 → 本地磁盘根目录。
 * 演练要做「逐字比对」，前提是能回到原件；本表让脚本真的去磁盘验证文件在不在。
 */
const VAULT = "D:\\重要文件\\A重要客户情况"
const KEY_ROOTS = {
  bidtpl: ["B标书"],
  soltpl: ["A整体规划方案"],
  pptsilde: [""], // rest 自带 "PPT模版\\..." 或 "公司产品PPT\\..."
  ammunition: [], // 虚拟键：无原件，只有系统内的结构化清单
}

const USAGE =
  "用法：node scripts/eval-fixtures.mjs [--module solution|bid|ppt|quote|all] [--track 赛道] " +
  "[--bucket 桶] [--n 4] [--seed 20261003] [--max-chars 900] [--visibility team|personal|both] " +
  "[--allow-derived] [--json-only] [--rebuild-index] [--grep 关键词] [--list-buckets]"

// ============================ 参数解析 ============================

/**
 * 解析 CLI 参数。未识别的参数直接报错退出，避免"静默接受了错参数"造成的假通过。
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const out = {
    module: "all",
    track: null,
    bucket: null,
    n: 4,
    seed: 20261003,
    maxChars: 900,
    visibility: null,
    listBuckets: false,
    allowDerived: false,
    jsonOnly: false,
    rebuildIndex: false,
    grep: null,
  }
  const needValue = new Set(["module", "track", "bucket", "n", "seed", "max-chars", "visibility", "grep"])

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    if (!raw.startsWith("--")) throw new Error(`无法识别的参数：${raw}`)
    const eq = raw.indexOf("=")
    const key = (eq >= 0 ? raw.slice(2, eq) : raw.slice(2)).trim()
    let val = eq >= 0 ? raw.slice(eq + 1) : null

    if (needValue.has(key) && val === null) {
      val = argv[++i]
      if (val === undefined) throw new Error(`参数 --${key} 缺少取值`)
    }

    switch (key) {
      case "module":
        out.module = String(val).trim()
        break
      case "track":
        out.track = String(val).trim()
        break
      case "bucket":
        out.bucket = String(val).trim()
        break
      case "n": {
        const num = Number(val)
        if (!Number.isInteger(num) || num <= 0 || num > 50) throw new Error(`--n 必须是 1..50 的整数，收到 ${val}`)
        out.n = num
        break
      }
      case "seed": {
        const num = Number(val)
        if (!Number.isFinite(num)) throw new Error(`--seed 必须是数字，收到 ${val}`)
        out.seed = Math.trunc(num)
        break
      }
      case "max-chars": {
        const num = Number(val)
        if (!Number.isInteger(num) || num < 120 || num > 20000) throw new Error(`--max-chars 需为 120..20000 的整数，收到 ${val}`)
        out.maxChars = num
        break
      }
      case "visibility": {
        const v = String(val).trim()
        if (!["team", "personal", "both"].includes(v)) throw new Error(`--visibility 只能是 team|personal|both，收到 ${v}`)
        out.visibility = v
        break
      }
      case "list-buckets":
        out.listBuckets = true
        break
      case "allow-derived":
        out.allowDerived = true
        break
      case "json-only":
        out.jsonOnly = true
        break
      case "rebuild-index":
        out.rebuildIndex = true
        break
      case "grep":
        out.grep = String(val).trim()
        break
      default:
        throw new Error(`未知参数：--${key}`)
    }
  }

  if (out.module !== "all" && !Object.hasOwn(MODULE_BUCKETS, out.module)) {
    throw new Error(`--module 只能是 ${Object.keys(MODULE_BUCKETS).join("|")}|all，收到 ${out.module}`)
  }
  if (out.bucket && !BUCKETS.includes(out.bucket)) {
    throw new Error(`--bucket 只能是 ${BUCKETS.join("|")}，收到 ${out.bucket}`)
  }
  return out
}

// ============================ 确定性随机 ============================

/**
 * 伪随机发生器（mulberry32 变体）：同一 seed 必得同一序列，跨平台一致。
 * @param {number} seed
 * @returns {() => number} [0,1) 上的伪随机数
 */
function makeRng(seed) {
  let a = (seed >>> 0) + 0x6d2b79f5
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 用固定 seed 做 Fisher–Yates 洗牌后取前 k 个（不修改入参）。
 * @template T
 * @param {T[]} arr
 * @param {number} k
 * @param {number} seed
 * @returns {T[]}
 */
function pickDeterministic(arr, k, seed) {
  const rng = makeRng(seed)
  const copy = arr.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = copy[i]
    copy[i] = copy[j]
    copy[j] = tmp
  }
  return copy.slice(0, Math.min(k, copy.length))
}

/**
 * 稳定字符串 hash（FNV-1a 32bit）：给每条素材一个可跨轮对齐的指纹。
 * @param {string} str
 */
function stableHash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}

// ============================ 数据库读取 ============================

/**
 * 拿到 node:sqlite 的 DatabaseSync；若当前进程未启用该模块，则带 flag 重启自身。
 * 这样调用方（Qoder / 定时任务）无需记住 --experimental-sqlite。
 * @returns {any} DatabaseSync 构造器
 */
function loadSqlite() {
  if (typeof process.getBuiltinModule === "function") {
    try {
      const mod = process.getBuiltinModule("node:sqlite")
      if (mod && mod.DatabaseSync) return mod.DatabaseSync
    } catch (_) {
      /* 落到下面的重启逻辑 */
    }
  }

  if (process.execArgv.includes("--experimental-sqlite")) {
    throw new Error(
      "已带 --experimental-sqlite 仍无法加载 node:sqlite：请确认 Node 版本 ≥ 22.5（本机托管 Node 22.22.2 可用）",
    )
  }

  // 带 flag 重启自身并透传输出；用环境变量防止无限重启
  if (process.env.EVAL_FIXTURES_RESPAWNED === "1") {
    throw new Error("重启后仍无法加载 node:sqlite，已放弃（避免死循环）")
  }
  try {
    const out = execFileSync(
      process.execPath,
      ["--experimental-sqlite", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, EVAL_FIXTURES_RESPAWNED: "1" } },
    )
    process.stdout.write(out)
    process.exit(0)
  } catch (e) {
    throw new Error(`自动注入 --experimental-sqlite 失败：${e.message}`)
  }
}

/**
 * 只读打开 PocketBase 数据库。
 * @returns {any} DatabaseSync 实例
 */
function openDb() {
  const DatabaseSync = loadSqlite()
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`找不到 PocketBase 数据库：${DB_PATH}（请确认本地 PB 已初始化并导入过知识库）`)
  }
  return new DatabaseSync(DB_PATH, { readOnly: true })
}

/**
 * 查询符合筛选条件的 kb_docs（过短正文视为噪声，不入演练）。
 * @param {any} db
 * @param {{bucket?:string|null, track?:string|null, visibility?:string|null}} filter
 */
function queryDocs(db, filter) {
  const where = ["content IS NOT NULL", "length(trim(content)) > 200"]
  const params = []
  if (filter.bucket) {
    where.push("kb_bucket = ?")
    params.push(filter.bucket)
  }
  if (filter.track) {
    where.push("kb_track = ?")
    params.push(filter.track)
  }
  if (filter.visibility && filter.visibility !== "both") {
    where.push("visibility = ?")
    params.push(filter.visibility)
  }
  const sql =
    "SELECT id, title, source_file_name, kb_bucket, kb_track, doc_format, doc_category, " +
    "visibility, is_sensitive, ai_context_mode, retrieval_weight, folder_path, " +
    "length(content) AS content_len, content FROM kb_docs WHERE " +
    where.join(" AND ")
  return db.prepare(sql).all(...params)
}

/**
 * 统计各桶 × 各可见性的可用条数（用于清单里的"素材池体检"段）。
 * @param {any} db
 */
function bucketStats(db) {
  return db
    .prepare(
      "SELECT kb_bucket AS bucket, visibility, COUNT(*) AS n, SUM(length(content)) AS chars " +
        "FROM kb_docs WHERE content IS NOT NULL GROUP BY kb_bucket, visibility ORDER BY n DESC",
    )
    .all()
}

// ============================ 素材加工 ============================

/**
 * vault 文件索引：以"文件名(小写)"为键，映射到磁盘上的绝对路径列表。
 * 为什么要它：kb_docs 里只有约 33% 的 source_file_name 带路径，其余只存了文件名。
 * 没有索引就只能写"需人工找"，演练的逐字比对也就没有硬证据。
 * 索引结果缓存在 _eval/vault-index.json，默认 7 天过期；--rebuild-index 强制重建。
 */
const INDEX_PATH = path.join(OUT_DIR, "vault-index.json")
const INDEX_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 递归扫描 vault，构建 文件名 → 绝对路径[] 索引。
 * @returns {{builtAt:string, root:string, count:number, map:Record<string,string[]>}}
 */
function buildVaultIndex() {
  const map = Object.create(null)
  let count = 0
  const skipDirs = new Set([".obsidian", ".git", "node_modules", "$RECYCLE.BIN", "trash_backups"])

  const walk = (dir, depth) => {
    if (depth > 14) return // 防御性深度上限
    let ents
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch (_) {
      return // 无权限/长路径等，跳过而不中断整轮扫描
    }
    for (const e of ents) {
      const fp = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) walk(fp, depth + 1)
      } else {
        const key = e.name.toLowerCase()
        if (!map[key]) map[key] = []
        map[key].push(fp)
        count++
      }
    }
  }
  walk(VAULT, 0)

  const payload = { builtAt: new Date().toISOString(), root: VAULT, count, map }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(INDEX_PATH, JSON.stringify(payload), "utf8")
  return payload
}

/**
 * 取 vault 索引：优先用未过期的缓存，否则重建。
 * @param {boolean} forceRebuild
 */
function loadVaultIndex(forceRebuild) {
  if (!forceRebuild) {
    try {
      const cached = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"))
      const age = Date.now() - new Date(cached.builtAt).getTime()
      if (cached.map && Number.isFinite(age) && age < INDEX_TTL_MS) return cached
    } catch (_) {
      /* 缓存缺失或损坏 → 重建 */
    }
  }
  return buildVaultIndex()
}

/**
 * 判定素材能否回到本地原件（逐字比对的前提）。
 * 三种形态：
 *   full-path      —— 能拼出本地路径；resolvedPath 非空表示磁盘上确实存在
 *   filename-only  —— 只有文件名，得在库内按名搜（比对可靠度打折）
 *   virtual        —— 系统内蒸馏清单（如弹药速查），压根没有对应原件
 * @param {string} sourceFileName kb_docs.source_file_name
 * @param {Record<string,string[]>} vaultIndex 文件名(小写) → 路径列表
 * @returns {{kind:"full-path"|"filename-only"|"virtual", resolvedPath:string|null, candidates:string[]}}
 */
function resolveOriginal(sourceFileName, vaultIndex) {
  const raw = String(sourceFileName || "")
  const m = /^([a-z]+):(.*)$/i.exec(raw)
  const key = m && Object.hasOwn(KEY_ROOTS, m[1].toLowerCase()) ? m[1].toLowerCase() : null
  const rest = key ? m[2] : raw

  // 虚拟键：系统内蒸馏清单，没有对应原件
  if (key === "ammunition") return { kind: "virtual", resolvedPath: null, candidates: [] }

  // pptslide 键尾部 #页码 只是页标识，不属于文件名
  const suffix = key === "pptslide" ? rest.split("#")[0] : rest
  const roots = key ? KEY_ROOTS[key].map((r) => path.join(VAULT, r)) : [VAULT]

  // ① 先按前缀拼路径（最可靠：路径信息来自入库脚本本身）
  for (const root of roots) {
    const cand = path.join(root, suffix)
    try {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        return { kind: "full-path", resolvedPath: cand, candidates: [cand] }
      }
    } catch (_) {
      /* 路径非法字符等，继续 */
    }
  }

  // ② 回退：拿文件名去 vault 索引里找（解决"只存了文件名"的 4700 条）
  const base = path.basename(suffix.replace(/[\\/]+$/, "")).toLowerCase()
  const indexMap = vaultIndex && vaultIndex.map ? vaultIndex.map : null
  const hits = indexMap && indexMap[base] ? indexMap[base].slice() : []
  if (hits.length > 0) {
    return { kind: "full-path", resolvedPath: hits[0], candidates: hits }
  }

  // ③ 都没命中：区分"有路径信息"与"压根没路径信息"
  return { kind: /[\\/]/.test(suffix) ? "full-path" : "filename-only", resolvedPath: null, candidates: [] }
}

/**
 * 判断一条素材是否"派生自系统自身产出"（循环论证风险）。
 * @param {any} row
 * @returns {boolean}
 */
function isDerived(row) {
  const hay = String(row.source_file_name || "") + " " + String(row.folder_path || "") + " " + String(row.title || "")
  return DERIVED_MARKERS.some((re) => re.test(hay))
}

/**
 * 把一行 kb_docs 转成演练素材卡。
 * @param {any} row
 * @param {number} maxChars
 */
function toFixture(row, maxChars, vaultIndex) {
  const rawContent = String(row.content || "")
  const orig = resolveOriginal(row.source_file_name, vaultIndex)
  const excerpt =
    rawContent.length > maxChars
      ? rawContent.slice(0, maxChars) + "\n…（正文已截断；演练需要更多时按原件路径回本地取全文）"
      : rawContent
  return {
    id: row.id,
    fingerprint: stableHash(String(row.id) + "|" + String(row.title)),
    title: row.title,
    sourceFile: row.source_file_name,
    folder: row.folder_path,
    bucket: row.kb_bucket,
    track: row.kb_track,
    format: row.doc_format,
    category: row.doc_category,
    visibility: row.visibility,
    sensitive: !!row.is_sensitive,
    aiContextMode: row.ai_context_mode,
    retrievalWeight: row.retrieval_weight,
    contentLen: row.content_len,
    original: { kind: orig.kind, resolvedPath: orig.resolvedPath, candidates: orig.candidates },
    excerpt,
  }
}

/**
 * 为一轮演练组装素材包。
 * @param {any} db
 * @param {ReturnType<typeof parseArgs>} opt
 * @param {Record<string,string[]>} vaultIndex
 */
function buildPack(db, opt, vaultIndex) {
  let targetBuckets
  if (opt.bucket) targetBuckets = [opt.bucket]
  else if (opt.module === "all") targetBuckets = ["方案素材", "标书弹药", "PPT演示", "竞品情报", "政策法规标准"]
  else targetBuckets = MODULE_BUCKETS[opt.module]

  const used = { pulled: 0, skippedDerived: 0, skippedByGrep: 0 }
  const picks = []
  const kw = opt.grep ? opt.grep.toLowerCase() : null

  targetBuckets.forEach((bucket, bucketIdx) => {
    const rows = queryDocs(db, { bucket, track: opt.track, visibility: opt.visibility })
    const eligible = []
    for (const r of rows) {
      if (!opt.allowDerived && isDerived(r)) {
        used.skippedDerived++
        continue
      }
      if (kw) {
        const hay = (String(r.title || "") + " " + String(r.source_file_name || "")).toLowerCase()
        if (!hay.includes(kw)) {
          used.skippedByGrep++
          continue
        }
      }
      eligible.push(r)
    }
    // 每条桶用 seed 的派生值：换桶不换整批，主题不漂移
    const seed = (opt.seed + bucketIdx * 7919) >>> 0
    for (const r of pickDeterministic(eligible, opt.n, seed)) {
      picks.push(Object.assign(toFixture(r, opt.maxChars, vaultIndex), { moduleBucket: bucket }))
      used.pulled++
    }
  })

  return { picks, used, targetBuckets }
}

// ============================ 输出 ============================

/**
 * 渲染"回取性"人读文案——决定这条素材能不能做逐字比对。
 * @param {{kind:string, resolvedPath:string|null}} orig
 */
function renderOriginal(orig) {
  if (orig.kind === "virtual") return "⛔ 无原件（系统内蒸馏清单）→ **只能做 L1 功能判定，不得做 L2 逐字比对**"
  if (orig.kind === "filename-only") return "⚠️ 库内只存了文件名，vault 索引也未命中 → 先确认原件是否还在库内"
  if (orig.resolvedPath) {
    const n = orig.candidates ? orig.candidates.length : 0
    if (n > 1) {
      const others = orig.candidates.slice(1, 4).map((c) => `\`${c}\``).join("、")
      return `✅ 可回取：\`${orig.resolvedPath}\`（同名共 ${n} 份，其余候选：${others}）`
    }
    return `✅ 可回取：\`${orig.resolvedPath}\``
  }
  return "⚠️ 有路径但磁盘未命中（原件可能已移动/重命名）→ **先查明再演练，否则比对结论无效**"
}

/**
 * 生成人读清单 Markdown（演练时 AI 直接照这份注入素材）。
 * @param {{picks:any[], used:any, targetBuckets:string[]}} pack
 * @param {ReturnType<typeof parseArgs>} opt
 * @param {any[]} stats
 */
function renderMarkdown(pack, opt, stats) {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, "0")
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  const L = []

  L.push(`# 专项轮 D · 真实素材清单（${stamp}）`)
  L.push("")
  L.push(
    `> 选取条件：module=\`${opt.module}\` · track=\`${opt.track || "不限"}\` · bucket=\`${opt.bucket || "不限"}\` · grep=\`${opt.grep || "不限"}\` · n=${opt.n} · seed=\`${opt.seed}\``,
  )
  L.push("> 数据源：`pocketbase/pb_data/data.db`（只读）→ `kb_docs`。**下列素材全部真实存在于本机知识库。**")
  L.push("")
  L.push("## 0. 使用纪律（先看这段）")
  L.push("")
  L.push("1. **不许替换素材。** 必须用下面列出的真实文件当输入，不得改用一个更顺手的素材——换素材等于换题，结果不可比。")
  L.push("2. **不许偷看答案。** 生成阶段只看 `excerpt`（截断正文）；比对阶段才回本地取原件全文做逐字核对。")
  L.push("3. **敏感素材守门禁。** 标记 ⚠️敏感 的条目含真实客户/金额/人员信息，演练中只用于内容判定，不得写入任何对外产出、不得出现在报告示例里。")
  L.push("4. **素材要回流。** 本轮发现的问题、复现步骤、原件路径必须写回 `.loop/scenario-state.json` 与轮次报告，否则下轮无法复现。")
  L.push("5. **回取不了的素材不许硬判。** 见每条素材的「回取性」行：无原件/未命中的素材只能做 L1 功能判定；强行对它下 L2 逐字比对结论 = 伪造证据。")
  L.push("")
  L.push("## 1. 素材池体检（当前 kb_docs 真实分布）")
  L.push("")
  L.push("| 用途桶 | team | personal | 合计 | 正文总量 |")
  L.push("|---|---:|---:|---:|---:|")
  const byBucket = new Map()
  for (const s of stats) {
    const cur = byBucket.get(s.bucket) || { team: 0, personal: 0, chars: 0 }
    cur[s.visibility === "team" ? "team" : "personal"] += s.n
    cur.chars += s.chars || 0
    byBucket.set(s.bucket, cur)
  }
  const ordered = [...byBucket.entries()].sort((a, b) => b[1].team + b[1].personal - (a[1].team + a[1].personal))
  for (const [bucket, v] of ordered) {
    L.push(`| ${bucket} | ${v.team} | ${v.personal} | **${v.team + v.personal}** | ${(v.chars / 1048576).toFixed(1)} MB |`)
  }
  L.push("")
  L.push(`本次组装：纳入 **${pack.picks.length}** 条真实素材；剔除"疑似系统自产" ${pack.used.skippedDerived} 条。`)
  const okCount = pack.picks.filter((p) => p.original.resolvedPath).length
  const virtualCount = pack.picks.filter((p) => p.original.kind === "virtual").length
  const weakCount = pack.picks.length - okCount - virtualCount
  L.push(
    `原件可回取：**✅ ${okCount} 条可回取** · ⚠️ ${weakCount} 条需人工确认 · ⛔ ${virtualCount} 条无原件。` +
      `只有「可回取」的素材能下 L2 逐字比对结论。`,
  )
  L.push("")
  L.push("## 2. 本轮素材卡")
  L.push("")
  pack.picks.forEach((p, i) => {
    L.push(`### F${String(i + 1).padStart(2, "0")} · ${p.title}`)
    L.push("")
    L.push(`- **指纹**：\`${p.fingerprint}\`（跨轮去重与回归对齐用，同一素材永不变）`)
    L.push(`- **原件**：\`${p.sourceFile}\``)
    L.push(`- **回取性**：${renderOriginal(p.original)}`)
    L.push(`- **桶 / 赛道**：${p.bucket} / ${p.track}`)
    L.push(`- **格式 / 正文长度**：${p.format} / ${p.contentLen} 字`)
    L.push(`- **可见性**：${p.visibility === "personal" ? "🔒 personal" : "team"}${p.sensitive ? " · ⚠️敏感" : ""}`)
    L.push(`- **喂 AI 口径**：\`${p.aiContextMode}\`（original=可喂全文；sanitized_summary=只喂摘要） · 检索权重 ${p.retrievalWeight}`)
    L.push("")
    L.push(`<details><summary>正文摘录（截断至 ${opt.maxChars} 字）</summary>`)
    L.push("")
    L.push("```text")
    L.push(p.excerpt)
    L.push("```")
    L.push("")
    L.push("</details>")
    L.push("")
  })
  L.push("## 3. 清单维护")
  L.push("")
  L.push("- 本清单由 `scripts/eval-fixtures.mjs` 自动生成，**请勿手工编辑**（下次运行会覆盖）。")
  L.push("- 换一批素材：改 `--seed`，其余条件不变则主题不漂移。")
  L.push("- 换赛道：`--track 智慧医院`（可选值见 `src/lib/kbTaxonomy.ts` 的 KB_TRACKS）。")
  L.push("")

  return { markdown: L.join("\n"), stamp }
}

// ============================ 主流程 ============================

function main() {
  let opt
  try {
    opt = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`[参数错误] ${e.message}`)
    console.error(USAGE)
    process.exit(2)
  }

  const db = openDb()
  try {
    if (opt.listBuckets) {
      console.log("素材池现状（桶 × 可见性）：")
      for (const s of bucketStats(db)) {
        console.log(`  ${String(s.bucket).padEnd(6, "　")} ${String(s.visibility).padEnd(9)} ${String(s.n).padStart(6)} 条`)
      }
      console.log("\n模块 → 主用桶：")
      for (const m of Object.keys(MODULE_BUCKETS)) console.log(`  ${m.padEnd(10)}→ ${MODULE_BUCKETS[m].join(" / ")}`)
      return
    }

    const stats = bucketStats(db)
    const vaultIndex = loadVaultIndex(opt.rebuildIndex)
    const pack = buildPack(db, opt, vaultIndex)
    const rendered = renderMarkdown(pack, opt, stats)

    fs.mkdirSync(OUT_DIR, { recursive: true })
    const mdPath = path.join(OUT_DIR, `素材清单-${rendered.stamp}.md`)
    const jsonPath = path.join(OUT_DIR, "fixture-pack.json")
    fs.writeFileSync(mdPath, rendered.markdown, "utf8")
    fs.writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          options: opt,
          counts: { pulled: pack.picks.length, skipped: pack.used },
          buckets: pack.targetBuckets,
          fixtures: pack.picks.map((p) => ({
            id: p.id,
            fingerprint: p.fingerprint,
            title: p.title,
            sourceFile: p.sourceFile,
            bucket: p.bucket,
            track: p.track,
            format: p.format,
            visibility: p.visibility,
            sensitive: p.sensitive,
            aiContextMode: p.aiContextMode,
            contentLen: p.contentLen,
            original: p.original,
            excerptChars: p.excerpt.length,
          })),
        },
        null,
        2,
      ),
      "utf8",
    )

    if (opt.jsonOnly) {
      console.log(mdPath)
      return
    }
    console.log(`[vault 索引] ${vaultIndex.count} 个文件 · 建于 ${vaultIndex.builtAt}`)
    console.log(`[素材包] 纳入 ${pack.picks.length} 条真实素材`)
    const okN = pack.picks.filter((p) => p.original.resolvedPath).length
    console.log(`[可回取] ${okN}/${pack.picks.length} 条已定位到本地原件（逐字比对前提）`)
    for (const p of pack.picks) console.log(`  · ${p.bucket}/${p.track}  ${p.title}`)
    console.log(`\n人读清单：${mdPath}`)
    console.log(`机读契约：${jsonPath}`)
    console.log("\n下一步：把清单里的素材卡当作本轮演练输入，按《专项轮D-售前实战模拟.md》执行。")
  } finally {
    db.close()
  }
}

main()

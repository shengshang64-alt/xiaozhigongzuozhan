// scripts/import-vault-office.mjs — 白捡档补库：把 Obsidian vault 全量「现代 Office + 文本」
// 里**尚未入库、现有抽取器能处理**的文件补进 kb_docs（第一期组装层的覆盖度延伸）。
//
// 由来：.diag/import_vault_materials.cjs 只扫 6 个核心目录，导致 区域材料/部门数据/报价体系/
//       实证材料 等目录下的 docx/xlsx/pptx 从未被抽取。本脚本复用同一套「字节级成熟」抽取器
//       (mammoth/fflate/XLSX) + 分类器 + 敏感策略，但：
//   1) 扫描范围 = 整个 VAULT（去噪/去隐藏/大小 2KB..40MB 同前）；
//   2) 幂等键 = 归一化 basename（与 .diag/kb_coverage.cjs 同款 norm）对全库去重，绝不重复导入；
//   3) 入库即带 kb_track/kb_bucket（词表与 src/lib/kbTaxonomy.ts / backfill-kb-taxonomy.mjs 同步）；
//   4) 敏感档（合同商务/资质证书 或 报价/客户/ONELINK/商机 路径）→ visibility=personal +
//      ai_context_mode=sanitized_summary；其余 → visibility=team 让知识库真正可被检索赋能；
//   5) 不碰 ③硬骨头（遗留 .doc 二进制 / 无文本层 PDF）——那是需要外部转换/OCR 的另一决策。
//
// 用法（PocketBase 需 127.0.0.1:7000 在线）：
//   node scripts/import-vault-office.mjs --dry        # 只预览：待补数/按类分布/抽取空判定/样例
//   node scripts/import-vault-office.mjs --limit 30   # 小批量真写，验证质量
//   node scripts/import-vault-office.mjs              # 全量补库
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { unzipSync, strFromU8 } from "fflate"

const require = createRequire(import.meta.url)
const XLSX = require("xlsx") // CJS 载入，规避 xlsx 的 ESM namespace 不暴露 readFile

const BASE = "http://127.0.0.1:7000"
const VAULT = "D:\\重要文件\\A重要客户情况"
const LOCAL_USER = "local-user"
// 实时进度日志：用 appendFileSync（同步、无缓冲），末行即当前正在处理的文件，彻底解决块缓冲看不到卡点
const PROG_LOG = path.join(process.cwd(), ".diag", "vo_progress.log")
const NLc = String.fromCharCode(10)
try { fs.writeFileSync(PROG_LOG, "") } catch {}
const plog = (msg) => { try { fs.appendFileSync(PROG_LOG, `${new Date().toISOString()} ${msg}${NLc}`) } catch {} }
const DRY = process.argv.includes("--dry")
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit")
  return i > 0 ? parseInt(process.argv[i + 1], 10) : Infinity
})()

// 现代 office + 文本；**不含 pdf**（pdf 多为扫描/超大，属硬骨头档，另议）
const SUPPORTED_EXT_RE = /\.(md|markdown|txt|docx|pptx|xls|xlsx|csv)$/i
const MIN_BYTES = 2048
const MAX_BYTES = 40 * 1024 * 1024
const SKIP_DIR_RE = /(\\node_modules\\|\\\.venv\\|\\venv\\|\\__pycache__\\|\\site-packages\\|\\trash\\|\\\.git\\|\\backup\\|\\backups\\|\\dist\\|\\build\\|\\target\\|\\\.cache\\|\\_pkg_verify\\|\\_wb_tmp\\|\\thumbnails\\|\\_moc\\)/i
const GEN_RE = /\\(backend|uploads|artifacts|ppt_output|node_modules|dist|build|\.next|storage|tmp|temp|cache|exports|generated|output)\b/
const FIXTURE_RE = /\\(test_artifacts|test_outputs|deploy|samples)\b|\\diag|\\repro|\b(diag|repro|sample|messy)_|_master_|_matched|_updated|self_out/
const HEX_RE = /[0-9a-f]{16,}/i
const isNoise = (abs, base) => GEN_RE.test(abs.toLowerCase()) || HEX_RE.test(base) || FIXTURE_RE.test(abs.toLowerCase())
// 归一化 basename 去重键（与 kb_coverage 一致：去空格/去括注/去扩展名）
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（(【\[][^）)】\]]*[)）】\]]/g, "")
    .replace(/\.(docx?|pptx?|xlsx?|pdf|md|txt|csv|xls|wps|et|dps|ofd|caj)$/i, "")

// --- 分类器（端口自 src/lib/kbPolicy.ts + import_vault_materials.cjs）--------
const FILENAME_CATEGORY_RULES = [
  { re: /合同|商务|报价单/, category: "合同商务" },
  { re: /资质|证书|许可/, category: "资质证书" },
  { re: /案例|业绩/, category: "项目案例" },
  { re: /政策|法规|标准|规范/, category: "政策法规" },
  { re: /方案|技术/, category: "技术方案" },
  { re: /产品|彩页|手册/, category: "产品资料" },
]
const guessCategoryFromFileName = (n) => {
  for (const r of FILENAME_CATEGORY_RULES) if (r.re.test(n)) return r.category
  return "其他"
}
const CONTENT_CATEGORY_RULES = [
  { category: "政策法规", words: ["标准与规范", "建设标准", "分级评价", "分级评估", "测评方案", "管理规范", "管理办法", "指导意见", "试点方案", "国家标准", "卫生行业标准", "卫健委", "国家卫生健康委", "政策法规", "考核指标", "评审标准"] },
  { category: "资质证书", words: ["营业执照", "资质证书", "CMMI", "ISO9001", "ISO14001", "ISO20000", "软件著作权", "软件产品登记", "信用等级", "等级保护测评", "授权书", "资格证明", "许可证"] },
  { category: "合同商务", words: ["报价表", "分项报价", "报价一览", "供应商", "合同条款", "采购需求", "商务偏离", "商务条款", "付款", "税率", "开标", "控制价", "最高限价", "协议"] },
  { category: "项目案例", words: ["投标文件", "响应文件", "谈判响应", "投标函", "技术响应", "业绩", "案例介绍", "验收报告", "实施总结", "客户汇报", "交流汇报", "首次交流", "现场汇报", "应答"] },
  { category: "产品资料", words: ["产品介绍", "产品彩页", "产品手册", "功能清单", "白皮书", "公司简介", "整体解决方案", "展会", "宣传", "产品优势", "核心产品", "能力介绍"] },
  { category: "技术方案", words: ["建设方案", "规划方案", "建设规划", "总体架构", "技术方案", "初步设计", "详细设计", "需求分析", "建设内容", "技术路线", "可行性", "现状与需求", "系统集成", "数据治理", "设计方案", "解决方案", "升级方案"] },
]
function classifyKbDoc(fileName, content) {
  if (/97[0-9]{11}|\bISBN\b/i.test(fileName || "")) return "其他"
  const hay = `${fileName || ""}\n${(content || "").replace(/\s+/g, "").slice(0, 4000)}`
  let best = { category: "其他", score: 0 }
  for (const rule of CONTENT_CATEGORY_RULES) {
    let score = 0
    for (const w of rule.words) {
      const inName = (fileName || "").includes(w) ? 3 : 0
      const inBody = hay.split(w).length - 1
      score += inName + inBody
    }
    if (score > best.score) best = { category: rule.category, score }
  }
  return best.score > 0 ? best.category : guessCategoryFromFileName(fileName)
}
const POLICY = {
  合同商务: { ai_context_mode: "sanitized_summary", retrieval_weight: 0.5, is_sensitive: true },
  资质证书: { ai_context_mode: "sanitized_summary", retrieval_weight: 0.5, is_sensitive: true },
  产品资料: { ai_context_mode: "original", retrieval_weight: 1.2, is_sensitive: false },
  技术方案: { ai_context_mode: "original", retrieval_weight: 1.2, is_sensitive: false },
  项目案例: { ai_context_mode: "original", retrieval_weight: 1.0, is_sensitive: false },
  政策法规: { ai_context_mode: "original", retrieval_weight: 1.0, is_sensitive: false },
  其他: { ai_context_mode: "original", retrieval_weight: 1.0, is_sensitive: false },
}

// --- 索引（端口自 kbCore.extractKbIndex）------------------------------------
const LATIN = /[a-zA-Z0-9][a-zA-Z0-9_.-]{1,}/g
const CJK = /[一-龥]{2,}/g
function tokenize(text) {
  const s = (text || "").toLowerCase()
  const out = []
  for (const m of s.matchAll(LATIN)) if (!out.includes(m[0])) out.push(m[0])
  for (const m of s.matchAll(CJK)) {
    const r = m[0]
    if (r.length <= 4 && !out.includes(r)) out.push(r)
    for (let i = 0; i + 2 <= r.length; i++) {
      const bi = r.slice(i, i + 2)
      if (!out.includes(bi)) out.push(bi)
    }
  }
  return out
}
const stripMd = (t) =>
  (t || "").replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/[*_>`|~-]{1,3}/g, " ").replace(/\s+/g, " ").trim()
function isSummaryJunk(line) {
  if (!line || line.length < 10) return true
  if (/^[-*\d.、\s（）()·｜|]*$/.test(line)) return true
  if (/^【工作表[^】]*】$/.test(line)) return true
  const seps = (line.match(/[,，|\t]/g) || []).length
  const core = line.replace(/[,，|\t\s]/g, "")
  if (seps >= 3 && core.length < seps * 2) return true
  return false
}
function extractIndex(title, content) {
  const plain = stripMd(content)
  const paras = (content || "").split(/\n{1,}/).map(stripMd).filter((l) => !isSummaryJunk(l))
  const summary = (paras[0] || plain).slice(0, 160)
  const counts = new Map()
  for (const t of tokenize(plain)) counts.set(t, (counts.get(t) || 0) + 1)
  const tt = tokenize(title)
  const keywords = []
  for (const t of tt) if (keywords.length < 8) keywords.push(t)
  const freq = [...counts.entries()].filter(([t, n]) => t.length >= 2 && n >= 3 && !tt.includes(t)).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([t]) => t)
  for (const t of freq) if (keywords.length < 24) keywords.push(t)
  return { summary, keywords }
}

// --- 赛道/桶（与 kbTaxonomy.ts / backfill 同步；改词表三处一起改）------------
const TRACK_RULES = [
  ["电子病历评级", /电子病历.{0,8}(评级|过级|升级|分级|五[级6]|六[级7]|七[级8])|病历评级|分级评价|EMR[4567]/gi],
  ["互联互通评级", /互联互通|标准化成熟度|信息互联互通|四甲|集成平台.{0,4}测评/g],
  ["医共体建设", /医共体|医联体|县域.{0,4}(医疗|卫生|影像|心电)|紧密型|区域.{0,3}(医疗|卫生)中心|分级诊疗/g],
  ["DRG-DIP医保", /DRG|DIP|医保支付|医保结算|病种分值|医保基金|飞行检查|支付方式/g],
  ["信创改造", /信创|国产化|自主可控|麒麟|统信|达梦|人大金仓|鲲鹏|海光/g],
  ["数据安全", /等级保护|等保[二三四]级|数据安全|密码改造|国密|灾备|容灾|数据脱敏|防勒索|网络安全|态势感知|隐私/g],
  ["中医医院", /中医|中药|辨证|治未病|中医药|中西医结合/g],
  ["运营管理HRP", /HRP|绩效|国考|成本核算|运营管理|经济核算/g],
  ["互联网医院", /互联网医院|互联网诊疗|在线问诊|远程医疗|远程会诊|掌上医院/g],
  ["集成平台", /集成平台|信息集成|\bESB\b|\bHL7\b|数据中心|\bCDR\b|\bODR\b|数据治理|数据中台|健康大脑|全民健康/g],
  ["移动医疗", /移动医疗|移动护理|移动医生|床旁|移动医保/g],
  ["智慧医院", /智慧医院|智慧服务|智慧管理|智慧医疗|全流程|一院多区|一院两区/g],
  ["HIS系统", /\bHIS\b|医院信息系统|门诊住院|收费结算|电子病历系统|一体化.{0,4}(管理|系统)/g],
]
function deriveTrack(text) {
  const hay = text ?? ""
  let best = "通用", bestHits = 0
  for (const [track, re] of TRACK_RULES) {
    re.lastIndex = 0
    const hits = (hay.match(re) || []).length
    if (hits > bestHits) { bestHits = hits; best = track }
  }
  return best
}
const BUCKET_RULES = [
  ["竞品情报", /竞品|竞对|友商|对手|攻防|话术|东软|卫宁|创业慧康|东华|曼荼罗|鼎新|和仁|易联众|麦迪思/],
  ["标书弹药", /标书|投标|招标|技术偏离|应答|响应文件|评标|开标|可研/],
  ["PPT演示", /PPT|演示|述标|宣传|彩页/],
  ["方案素材", /方案|规划|顶层设计|整体提升/],
  ["政策法规标准", /政策|法规|标准|规范|指南|办法|通知|意见|测评方案|评审标准/],
  ["产品资料", /产品|白皮书|功能清单|架构|接口|操作手册|说明书|技术文档/],
  ["客户与项目", /客户|画像|商机|拜访|台账|项目|合同|验收|复盘|评级清单/],
  ["行业洞察", /行业|趋势|洞察|标杆|案例/],
  ["公司内部", /制度|流程|考核|培训|报销|印章|人事|行政|报价体系/],
]
const COMPETITOR_DIR_RE = /友商公司产品|[\\/]竞品|竞对|攻防话术/
function deriveBucket(pathName) {
  const hay = pathName ?? ""
  if (COMPETITOR_DIR_RE.test(hay)) return "竞品情报"
  for (const [bucket, re] of BUCKET_RULES) if (re.test(hay)) return bucket
  return "其他"
}
const SENSITIVE_PATH_RE = /客户画像|拜访记录|安徽省客户情况|ONELINK|商机池|成单复盘|商机漏斗|合同|报价|部门数据|历年产品报价/

// --- 抽取器（复用成熟实现；pdf 不在此档，故不引 pdfjs）----------------------
function decodeXml(s) {
  return s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
}
function pptxText(p) {
  const z = unzipSync(new Uint8Array(fs.readFileSync(p)), { filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name) })
  const keys = Object.keys(z).sort((a, b) => parseInt(a.match(/(\d+)/)[1]) - parseInt(b.match(/(\d+)/)[1]))
  const out = []
  for (const k of keys) {
    const xml = strFromU8(z[k])
    const m = xml.match(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g) || []
    const t = m.map((s) => decodeXml(s.replace(/^<a:t(?:\s[^>]*)?>/, "").replace(/<\/a:t>$/, ""))).join(" ").trim()
    if (t) out.push(t)
  }
  return out.join("\n")
}
// docx：不引 mammoth（超大 docx 会慢/OOM），改 fflate 选择性 inflate 只解正文/页眉页脚 xml，快且省内存
function docxText(p) {
  const z = unzipSync(new Uint8Array(fs.readFileSync(p)), { filter: (f) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(f.name) })
  const parts = []
  for (const k of Object.keys(z).sort()) {
    const xml = strFromU8(z[k])
    const m = xml.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || []
    parts.push(m.map((s) => decodeXml(s.replace(/^<w:t(?:\s[^>]*)?>/, "").replace(/<\/w:t>$/, ""))).join(""))
    parts.push("\n")
  }
  const NL = String.fromCharCode(10)
  const TAB = String.fromCharCode(9)
  return parts
    .join(NL)
    .split(NL)
    .map((l) => l.replace(new RegExp("[" + TAB + " ]+$"), "").trim())
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join(NL)
    .trim()
}
function xlsxText(p) {
  const wb = XLSX.readFile(p, { dense: true })
  const out = []
  let total = 0
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws || !ws["!ref"]) continue
    // 病态大表防护：把 !ref 截到最多 8000 行 × 60 列，避免 sheet_to_csv 遍历百万级空单元格挂死
    const rg = XLSX.utils.decode_range(ws["!ref"])
    const e = { r: Math.min(rg.e.r, rg.s.r + 8000), c: Math.min(rg.e.c, rg.s.c + 60) }
    ws["!ref"] = XLSX.utils.encode_range({ s: rg.s, e })
    const csv = XLSX.utils.sheet_to_csv(ws)
    if (csv.trim()) { const blk = "【工作表 " + name + "】\n" + csv; out.push(blk); total += blk.length }
    if (total > 200000) break
  }
  return out.join("\n")
}
async function extractText(p) {
  const ext = path.extname(p).toLowerCase()
  let t = ""
  if (ext === ".docx") t = docxText(p)
  else if (ext === ".pptx") t = pptxText(p)
  else if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") t = xlsxText(p)
  else t = fs.readFileSync(p, "utf8")
  return (t || "").replace(/\u0000/g, "").replace(/\n{3,}/g, "\n\n").trim()
}

// --- 枚举全 vault -----------------------------------------------------------
function walk(dir, rel, acc) {
  let ents
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.name.startsWith(".") || e.name.startsWith("$") || /Thumbs\.db|desktop\.ini/i.test(e.name)) continue
    const abs = path.join(dir, e.name)
    const relNext = rel ? rel + "/" + e.name : e.name
    if (e.isDirectory()) { if (!SKIP_DIR_RE.test(abs.toLowerCase())) walk(abs, relNext, acc); continue }
    if (!SUPPORTED_EXT_RE.test(e.name)) continue
    if (isNoise(abs, e.name)) continue
    let st
    try { st = fs.statSync(abs) } catch { continue }
    if (st.size < MIN_BYTES || st.size > MAX_BYTES) continue
    acc.push({ abs, rel: relNext, name: e.name, sizeKB: Math.round(st.size / 1024) })
  }
}

async function main() {
  // 全库已入库的归一化 basename 集合（幂等去重键）
  const dbBase = new Set()
  for (let p = 1; p <= 80; p++) {
    const r = await fetch(`${BASE}/api/kb_docs?perPage=200&page=${p}`, { headers: { "X-Rh-User-Id": LOCAL_USER } })
    const items = ((await r.json()).items) || []
    if (!items.length) break
    for (const d of items) {
      const s = String(d.source_file_name || "")
      if (s) dbBase.add(norm(path.basename(s.replace(/\\/g, "/"))))
      if (d.title) dbBase.add(norm(String(d.title).split("/").pop()))
    }
    if (items.length < 200) break
  }
  console.log(`已入库归一化文件名: ${dbBase.size} 个`)

  const files = []
  walk(VAULT, "", files)
  // 目录内同名去重（取路径最短者），再对全库 basename 去重
  const byKey = new Map()
  for (const f of files) {
    const k = norm(f.name)
    const cur = byKey.get(k)
    if (!cur || f.abs.length < cur.abs.length) byKey.set(k, f)
  }
  const candidates = [...byKey.entries()].filter(([k]) => !dbBase.has(k)).map(([, f]) => f)
    .sort((a, b) => a.rel.localeCompare(b.rel, "zh"))

  console.log(`vault 支持文件 ${files.length}，去重后唯一 ${byKey.size}，未入库候选 ${candidates.length}${isFinite(LIMIT) ? `（本次限 ${LIMIT}）` : ""}`)
  if (!candidates.length) { console.log("无待补文件，结束。"); return }

  const areaOf = (rel) => { const s = rel.split("/"); return s[1] || "(vault根)" }
  const extDist = {}, areaDist = {}
  let emptyProbe = 0
  const samples = []
  const list = isFinite(LIMIT) ? candidates.slice(0, LIMIT) : candidates

  let ok = 0, empty = 0, fail = 0, sens = 0, bigSkip = 0
  for (let i = 0; i < list.length; i++) {
    const f = list[i]
    const ext = path.extname(f.name).toLowerCase().replace(".", "")
    // 病态大表防护：xlsx/xls > 5MB 直接跳过（zip 展开可能上百 MB，同步解析会挂死整批）
    if ((ext === "xlsx" || ext === "xls") && f.sizeKB > 5000) { bigSkip++; plog(`SKIPBIG ${ext} ${f.sizeKB}KB ${f.rel}`); continue }
    const t0 = Date.now()
    plog(`[${i + 1}/${list.length}] ${ext} ${f.sizeKB}KB ${f.rel}`)
    let text
    try { text = await extractText(f.abs) } catch (e) { fail++; if (fail <= 8) console.log(`ERR ${f.rel.slice(0, 70)} ${String(e.message).slice(0, 90)}`); continue }
    const dt = Date.now() - t0
    if (dt > 3000) plog(`  SLOW ${dt}ms [${i + 1}/${list.length}] ${f.rel}`)
    if (!text || text.length < 12) {
      empty++
      if (DRY) emptyProbe++
      continue
    }
    const category = classifyKbDoc(f.name, text)
    const { summary, keywords } = extractIndex(f.name.replace(SUPPORTED_EXT_RE, ""), text)
    const pol = POLICY[category] || POLICY["其他"]
    const pathHay = `${f.rel}/${f.name}`
    const track = deriveTrack([f.name, text.slice(0, 4000)].join(" "))
    const bucket = deriveBucket(pathHay)
    const sensitive = pol.is_sensitive || SENSITIVE_PATH_RE.test(pathHay)
    // 敏感（含仅路径命中 SENSITIVE_PATH_RE 的）一律脱敏 + 降权，兑现「敏感档维持 sanitized_summary」红线
    const effMode = sensitive ? "sanitized_summary" : pol.ai_context_mode
    const effWeight = sensitive ? Math.min(pol.retrieval_weight, 0.5) : pol.retrieval_weight
    const area = areaOf(f.rel)
    if (DRY) {
      extDist[ext] = (extDist[ext] || 0) + 1
      areaDist[area] = (areaDist[area] || 0) + 1
      if (sensitive) sens++
      if (samples.length < 20) samples.push(`  [${ext}|${category}|${track}/${bucket}|${sensitive ? "敏感·personal" : "team"}] ${f.rel.slice(0, 78)} (${f.sizeKB}KB,${text.length}字)`)
      continue
    }
    const folder_path = `本地材料导入/客户情况库/${area}` + (f.rel.split("/").length > 2 ? "/" + f.rel.split("/").slice(2, -1).join("/") : "")
    const payload = {
      rh_user_id: LOCAL_USER,
      title: f.name.replace(SUPPORTED_EXT_RE, ""),
      folder_path,
      content: text.slice(0, 50000),
      doc_format: ext,
      visibility: sensitive ? "personal" : "team",
      summary: summary.slice(0, 1000),
      keywords,
      source_file_name: f.rel.replace(/\//g, "\\"),
      uploader_name: "白捡补库·全vault",
      doc_category: category,
      ai_context_mode: effMode,
      retrieval_weight: effWeight,
      is_sensitive: sensitive,
      kb_track: track,
      kb_bucket: bucket,
    }
    const res = await fetch(`${BASE}/api/kb_docs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Rh-User-Id": LOCAL_USER },
      body: JSON.stringify(payload),
    })
    if (res.status === 200) { ok++; if (ok % 25 === 0) console.log(`  progress ok=${ok} i=${i}`) }
    else { fail++; if (fail <= 8) console.log(`POSTFAIL ${res.status} ${f.name}`) }
  }

  if (DRY) {
    console.log(`\n[DRY 未写库] 可抽取入库=${extDist && Object.values(extDist).reduce((a, b) => a + b, 0)} 抽取为空=${emptyProbe} 敏感(personal)=${sens} 超大xlsx跳过=${bigSkip}`)
    console.log("按扩展名:", JSON.stringify(extDist))
    console.log("按目录:", JSON.stringify(Object.fromEntries(Object.entries(areaDist).sort((a, b) => b[1] - a[1]).slice(0, 15))))
    console.log("样例(前20):")
    for (const s of samples) console.log(s)
    console.log("\n确认无误后去掉 --dry 正式补库。")
    return
  }
  console.log(`\n完成 ok=${ok} 空跳过=${empty} 失败=${fail}`)
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })

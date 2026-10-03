// R-206 第三批：A整体规划方案「标杆方案」章节抽取入库（服务 /solution-studio）
//
// 素材：D:\重要文件\A重要客户情况\A整体规划方案（按 大区→年份/项目→材料 组织，2,965 文件 / 13GB，1,093 docx）
// 目标：把跨项目可复用的「建设方案/规划方案/解决方案/调研方案」正文抽成纯文本入库，
//       方案编制页（/solution-studio）写同类方案时按赛道检索复用。
// 关键实现：这些 .docx 动辄上百 MB（内嵌架构图/截图，最大 456MB），整体解压会 OOM。
//   → 手动解析 ZIP 中央目录，只 inflate word/document.xml，绝不读取图片条目（复用第2批·补方法）。
// 筛选：文件名含 建设方案|规划方案|解决方案|整体方案|设计方案|调研方案|需求分析|总体规划 等；
//   排除 招标/参数/实证/问卷/清单/报价/商务/技术标/标书/模板/规范/… 及竞品件与第三方/参考件目录；
//   去重：① 归一化标题全局去重（ONE-LINK 标准方案多副本取最全）② 每个项目目录取最大 1 份。
// 口径：doc_category=技术方案、ai_context_mode=original、visibility=team（供团队方案复用）、
//   retrieval_weight=1.0；单篇正文截断 60k 字。幂等键 source_file_name=soltpl:<相对路径>。
// 用法：PB 需 127.0.0.1:7000 在线。 预览：node scripts/extract-solutions.mjs --dry
import fs from "node:fs"
import path from "node:path"
import { inflateRawSync } from "node:zlib"

const BASE = "http://127.0.0.1:7000"
const ROOT = "D:\\重要文件\\A重要客户情况\\A整体规划方案"
const LOCAL_USER = "local-user"
const DRY = process.argv.includes("--dry")
const MAX_CONTENT = 120000

const INC = /建设方案|规划方案|解决方案|整体方案|总体方案|设计方案|技术方案|项目方案|调研报告|调研方案|需求分析|总体规划|顶层规划|信息化建设|智慧医院.{0,6}方案|一体化.{0,4}方案|可研|初设|项目建议书/
const EXC = /招标|采购|磋商|谈判|邀请|更正|澄清|答疑|偏离|参数|技术规格|清单|报价|商务|合同|协议|评分|须知|实证|评估问卷|问卷|对照表|差异|盖章|签字|扫描件|开标|中标|成交通知|附录|附件|模板|模版|规范|制度|考核|纪要|会议|周报|日报|计划表|使用手册|操作手册|培训材料|技术标|投标文件|标书|检查检验|目录|封面|答疑|报名|投标申请|资格|营业执照|授权委托|简介|宣传/
const COMP = /东华|卫宁|东软|创业慧康|易联众|曼荼罗|望海|嘉和美康|荣科|久远银海|和仁|银江|太极股份|用友|金蝶|麦迪思/

// --- 精准抽取 docx 的 word/document.xml（不加载图片）------------------------
function extractDocxText(file) {
  const fd = fs.openSync(file, "r")
  try {
    const size = fs.fstatSync(fd).size
    const tailLen = Math.min(66000, size)
    const tail = Buffer.alloc(tailLen)
    fs.readSync(fd, tail, 0, tailLen, size - tailLen)
    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
    }
    if (eocd < 0) throw new Error("no EOCD (not a zip)")
    const total = tail.readUInt16LE(eocd + 10)
    const cdOffset = tail.readUInt32LE(eocd + 16)
    const cd = Buffer.alloc(tail.readUInt32LE(eocd + 12))
    fs.readSync(fd, cd, 0, cd.length, cdOffset)
    let p = 0
    let target = null
    for (let n = 0; n < total; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break
      const method = cd.readUInt16LE(p + 10)
      const compSize = cd.readUInt32LE(p + 20)
      const nameLen = cd.readUInt16LE(p + 28)
      const extraLen = cd.readUInt16LE(p + 30)
      const commentLen = cd.readUInt16LE(p + 32)
      const localOff = cd.readUInt32LE(p + 42)
      const name = cd.toString("utf8", p + 46, p + 46 + nameLen)
      if (name === "word/document.xml") { target = { method, compSize, localOff }; break }
      p += 46 + nameLen + extraLen + commentLen
    }
    if (!target) throw new Error("word/document.xml not found")
    const lh = Buffer.alloc(30)
    fs.readSync(fd, lh, 0, 30, target.localOff)
    const lNameLen = lh.readUInt16LE(26)
    const lExtraLen = lh.readUInt16LE(28)
    const dataOff = target.localOff + 30 + lNameLen + lExtraLen
    const buf = Buffer.alloc(target.compSize)
    fs.readSync(fd, buf, 0, target.compSize, dataOff)
    const xml = target.method === 0 ? buf.toString("utf8") : inflateRawSync(buf).toString("utf8")
    return xmlToText(xml)
  } finally {
    fs.closeSync(fd)
  }
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&")
}

function scrub(t) {
  return t
    .replace(/PAGEREF\s+_Toc\d+[^\n]*/gi, "")
    .replace(/_Toc\d+/g, "").replace(/\\h\b/g, "").replace(/HYPERLINK\s+"[^"]*"/gi, "")
    .replace(/HYPERLINK\s*/gi, "") // 拆分域指令残留的裸 HYPERLINK token
    .replace(/_Ref\d+/g, "").replace(/\bREF\b/g, "").replace(/\\\s*\*/g, "") // 交叉引用域 REF _Ref… \*
    .replace(/-\d{5,}/g, "") // 文本框/图形锚点 EMU 坐标偏移噪声
    .replace(/\bMERGEFORMAT\b/gi, "").replace(/\{\s*MERGEFORMAT\s*\}/gi, "")
    .replace(/^\s*TOC\s+/i, "").replace(/\\[a-zA-Z]\s*"[^"]*"/g, "").replace(/\\[a-zA-Z](?=\s|$)/g, "")
}

function xmlToText(xml) {
  let t = xml
    .replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, "") // 整体剥离域指令代码(PAGEREF/HYPERLINK/INCLUDEPICTURE/REF…)，保留域结果正文
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
  t = decodeEntities(t)
  const lines = t.split(/\r?\n/)
    .map((l) => scrub(l).replace(/[ \t]+/g, " ").replace(/\u00a0/g, " ").trim())
    .filter(Boolean)
  const isToc = (l) => /^第[一二三四五六七八九十百\d]{1,4}章|^[（(]?[一二三四五六七八九十]{1,3}[、.）)]|^\d+(\.\d+)+|^\d+\.\s/.test(l)
  const cleaned = lines.map((l) => {
    let x = l.replace(/\s*\t\s*\d{1,4}\s*$/, "")
    if (isToc(l)) x = x.replace(/\s+\d{1,4}\s*$/, "") // 可研/未更新域的目录行尾部页码
    return x.trim()
  }).filter(Boolean)
  return cleaned.join("\n")
}

// --- 归类（复用第2批·补 11 档赛道打分器）------------------------------------
const TRACKS = [
  ["电子病历评级", /电子病历.{0,6}(评级|过级|升级|五[级6]|六[级7])|评级.{0,4}电子病历|互联互通.{0,4}电子病历|电子病历.{0,4}(五级|六级|七级)/],
  ["互联互通评级", /互联互通|标准化成熟度|信息互联互通/],
  ["医共体建设", /医共体|县域.{0,4}(医疗|卫生|影像|心电)|紧密型|医联体|区域.{0,3}(医疗|卫生)中心/],
  ["DRG-DIP医保", /DRG|DIP|医保支付|医保结算|病种分值|医保基金|飞行检查/],
  ["信创改造", /信创|国产化|自主可控|麒麟|统信|达梦|人大金仓|鲲鹏|海光/],
  ["数据安全", /等级保护|等保[二三四]级|数据安全|密码改造|国密|灾备|容灾|数据脱敏|防勒索|网络安全设备|防火墙|态势感知/],
  ["中医医院", /中医|中药|辨证|治未病|中医药|中西医结合/],
  ["智慧医院", /智慧医院|智慧服务|智慧管理|智慧医疗|全流程|一体化平台|一院多区/],
  ["集成平台", /集成平台|信息集成|ESB|HL7|数据中心|CDR|ODR|数据治理|数据中台|互联互通平台|全民健康|健康大脑/],
  ["移动医疗", /移动医疗|移动护理|移动医生|床旁|互联网医院|在线问诊|掌上医院|远程医疗|远程会诊/],
  ["HIS系统", /\bHIS\b|医院信息系统|门诊住院|收费结算|电子病历系统|一体化.{0,4}(管理|系统)/],
]
function detectTrack(textHead, name) {
  const hay = name + "\n" + textHead
  let best = ["通用", 0]
  for (const [track, re] of TRACKS) {
    const hits = (hay.match(new RegExp(re.source, "g")) || []).length
    if (hits > best[1]) best = [track, hits]
  }
  return best[0]
}
function detectYear(rel) { const m = rel.match(/(20\d{2})年/); return m ? m[1] : (rel.match(/20\d{2}/) || [""])[0] }

// 项目目录定位：优先取「最深」的具体项目段（更精确），无则回退到最后一个非类别/年份目录段
const CLIENT_RE = /医院|卫生院|附院|医共体|医联体|妇幼|妇保|大学|学院|传染病|康复|疾控中心|卫健委|卫健|人民医院|中医院|健康集团|医疗集团|标准方案|整体解决方案|ONE-?LINK|[一二三四五六七八九十]院/i
const GENERIC_DIR = /^(20\d{2}([-_]\d{1,2})?年?(材料|方案|调研方案)?|.*材料|辅助文件|新院区|项目建议书|报名.*|提交.*|模板|参数|.*招标参数|.*清单|.*十张网|统一门户|整体建设规划方案|调研方案|20\d{6}.*)$/
function stripProj(s) {
  return s
    .replace(/^20\d{6}[-_ ]?/, "").replace(/^20\d{2}[-/年]\d{1,2}[-/月]?\d{0,2}[日]?[-_ ]?/, "")
    .replace(/[（(【\[].*?[)）】\]]/g, "")
    .replace(/(建设方案|规划方案|解决方案|调研报告|调研方案|可研暨?初设方案?|可研方案|项目建议书|信息化建设项目|信息化建设|信息化|建设项目|建设|方案|材料)$|^\d+/g, "")
    .replace(/[-_ ]+$/, "").trim()
}
function groupOf(rel) {
  const parts = rel.split(path.sep)
  const dirs = parts.slice(0, -1)
  let cut = -1
  for (let i = dirs.length - 1; i >= 0; i--) { if (CLIENT_RE.test(dirs[i])) { cut = i; break } } // 最深匹配
  if (cut < 0) for (let i = dirs.length - 1; i >= 0; i--) { if (!GENERIC_DIR.test(dirs[i]) && !/^\d/.test(dirs[i])) { cut = i; break } }
  if (cut < 0) cut = Math.min(1, dirs.length - 1)
  const raw = dirs[cut] || parts[0]
  const proj = stripProj(raw) || raw
  return { key: dirs.slice(0, cut + 1).join(path.sep) || rel, proj }
}
// 归一化标题：去版本号/日期/括号注释/空格/标点，用于跨目录识别同一份标准方案的多副本
function normTitle(name) {
  return path.basename(name, ".docx")
    .replace(/[（(【\[].*?[)）】\]]/g, "")
    .replace(/V?\d+(\.\d+)*/gi, "")
    .replace(/20\d{6}(_\d{2,4})?/g, "")
    .replace(/20\d{2}[-/.年]\d{1,2}([-/.月]\d{1,2}日?)?/g, "")
    .replace(/[\s\-_·、,，。.]/g, "")
    .toLowerCase()
}

// --- 枚举候选 ----------------------------------------------------------------
function walk(d, o) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, e.name); if (e.isDirectory()) walk(fp, o); else o.push(fp) } return o }
const picks = (() => {
  const all = walk(ROOT, [])
  const docx = all.filter((f) => f.toLowerCase().endsWith(".docx") && !/[~]\$/.test(path.basename(f)) && !/\.(bak|tmp)$/i.test(path.basename(f)))
  const cand = docx.filter((f) => { const b = path.basename(f); return INC.test(b) && !EXC.test(b) && !COMP.test(b) && !/第三方应标|参考标书|他人|友商|竞对|参考文件|参考标书|[\\/]参考[\\/]|报名/.test(f) })
  // ① 归一化标题全局去重：同一份标准方案的多副本只留最大
  const byTitle = {}
  for (const f of cand) {
    const k = normTitle(f)
    const cur = byTitle[k]
    if (!cur || fs.statSync(f).size > fs.statSync(cur).size) byTitle[k] = f
  }
  const dedupTitle = Object.values(byTitle)
  // ② 项目目录去重：每个项目取最大 1 份
  const groups = {}
  for (const f of dedupTitle) {
    const { key, proj } = groupOf(path.relative(ROOT, f))
    const cur = groups[key]
    if (!cur || fs.statSync(f).size > fs.statSync(cur.file).size) groups[key] = { file: f, proj }
  }
  return Object.values(groups).sort((a, b) => (a.file < b.file ? -1 : 1))
})()
console.log(`方案候选（标题去重 + 项目去重后）：${picks.length} 份`)

async function api(pathname, options = {}) {
  const res = await fetch(BASE + pathname, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } })
  if (!res.ok) throw new Error(`${options.method || "GET"} ${pathname} → ${res.status}: ${(await res.text()).slice(0, 160)}`)
  return res.status === 204 ? null : res.json()
}
const have = new Set()
if (!DRY) {
  for (let page = 1; page <= 20; page++) {
    const o = await api(`/api/kb_docs?perPage=200&page=${page}`)
    for (const it of o.items || []) if (String(it.source_file_name || "").startsWith("soltpl:")) have.add(String(it.source_file_name))
    if (!o.items || o.items.length < 200) break
  }
}

const dryLines = []
let ok = 0, skipped = 0, thin = 0, fail = 0
for (const { file: f, proj } of picks) {
  const rel = path.relative(ROOT, f)
  const key = `soltpl:${rel}`
  if (!DRY && have.has(key)) { skipped++; continue }
  let text
  try { text = extractDocxText(f) } catch (e) { fail++; dryLines.push(`[fail] ${rel}: ${e.message}`); continue }
  if (!text || text.length < 3000) { thin++; dryLines.push(`[thin] ${rel} (${text ? text.length : 0}字，疑似图片型/空)`); continue }
  const head = text.slice(0, 4000)
  if (/标题模板|样式模板|字体.{0,6}要求|段落格式|级别标题/.test(head)) { thin++; dryLines.push(`[tpl] ${rel}（排版格式模板，非方案正文）`); continue }
  const track = detectTrack(head, path.basename(f))
  const year = detectYear(rel)
  const content = text.length > MAX_CONTENT ? text.slice(0, MAX_CONTENT) + `\n\n…（正文过长，已截断至 ${MAX_CONTENT} 字）` : text
  const title = `方案范本/${track}/${year ? year + "·" : ""}${proj}·建设方案`
  const keywords = [track, year ? year + "年" : "", "建设方案", "整体规划", proj, ...((head.match(/建设目标|总体架构|建设内容|需求分析|现状分析|实施方案|项目背景|电子病历|互联互通|医共体|DRG|信创|集成平台|移动护理|智慧医院|数据治理|一院两区|顶层设计/g) || []))].filter((v, i, a) => v && a.indexOf(v) === i).slice(0, 14)
  if (DRY) { dryLines.push(`\n[${track}] ${title}  (${content.length}字, 原${text.length})  <- ${rel}`); dryLines.push("  " + content.split("\n").filter((l) => /^第.{1,8}章|^[一二三四五六七八九十]{1,3}、|^\d+\.\d+\s|^\d+\.\s/.test(l)).slice(0, 10).join("\n  ")); ok++; continue }
  await api("/api/kb_docs", {
    method: "POST",
    body: JSON.stringify({
      rh_user_id: LOCAL_USER, title,
      folder_path: `方案范本/${track}`,
      content, doc_format: "md", visibility: "team",
      summary: `标杆建设方案（${track}${year ? "·" + year + "年" : ""}·${proj}）：含项目背景、需求/现状分析、建设目标、总体架构、建设内容、实施方案等可复用章节，供同类方案编制参考（${content.length} 字）。`,
      keywords, source_file_name: key, uploader_name: "方案范本导入",
      doc_category: "技术方案", ai_context_mode: "original", retrieval_weight: 1.0, is_sensitive: false,
      kb_track: track, kb_bucket: "方案素材", // R138：入库即带确定性标签，不再依赖 backfill 猜桶
    }),
  })
  ok++
  if (ok % 10 === 0) console.log(`  …已入库 ${ok}`)
}
console.log(`\n完成：入库 ${ok}，已存在跳过 ${skipped}，过短/图片型 ${thin}，抽取失败 ${fail}`)
if (DRY) {
  fs.writeFileSync(path.join(process.cwd(), ".diag", "solutions-dry.txt"), `候选 ${picks.length}\n` + dryLines.join("\n"), "utf8")
  console.log("DRY 报告已写入 .diag/solutions-dry.txt")
}

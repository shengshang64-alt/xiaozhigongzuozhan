// R-206 第二批·补：B标书 历史「技术标/投标文件」章节范本抽取入库
//
// 素材：D:\重要文件\A重要客户情况\B标书（按 年份→大区/省→项目 组织，1,983 文件）
// 目标：把跨项目可复用的「技术标」正文章节（实施方案/项目管理/培训/售后等通用套话）
//       抽成纯文本入库，标书页写同类标书时按赛道检索复用。
// 关键实现：这些 .docx 动辄上百 MB（内嵌系统截图），整体解压会 OOM。
//   → 手动解析 ZIP 中央目录，只 inflate word/document.xml，绝不读取图片条目。
// 筛选：文件名含 技术标|技术文件|技术方案|投标文件|技术部分|技术响应；
//   排除 招标/采购/磋商/谈判/偏离/商务/报价/… 及竞品件（东华/卫宁/东软…）与 ~$/.bak/.tmp；
//   每个项目目录按大小去重取 1 份。
// 口径：doc_category=技术方案、ai_context_mode=original、visibility=team（供团队标书复用）、
//   retrieval_weight=1.0；单篇正文截断 60k 字。幂等键 source_file_name=bidtpl:<相对路径>。
// 用法：PB 需 127.0.0.1:7000 在线。 预览：node scripts/extract-bid-templates.mjs --dry
import fs from "node:fs"
import path from "node:path"
import { inflateRawSync } from "node:zlib"

const BASE = "http://127.0.0.1:7000"
const ROOT = "D:\\重要文件\\A重要客户情况\\B标书"
const LOCAL_USER = "local-user"
const DRY = process.argv.includes("--dry")
const MAX_CONTENT = 60000

const INC = /技术标|技术文件|技术方案|投标文件|技术部分|技术响应/
const EXC = /招标|采购|磋商|谈判|邀请|更正|澄清|答疑|偏离|清单|报价|商务|资质证明|合同|评分|需求参数|技术参数|文件目录|须知|附录|附件|盖章|签字|封面|扫描件|开标/
const COMP = /东华|卫宁|东软|创业慧康|易联众|曼荼罗|望海|嘉和美康|荣科|浪潮|久远银海|和仁|银江|太极股份|用友|金蝶|麦迪思/

// --- 精准抽取 docx 的 word/document.xml（不加载图片）------------------------
function extractDocxText(file) {
  const fd = fs.openSync(file, "r")
  try {
    const size = fs.fstatSync(fd).size
    const tailLen = Math.min(66000, size)
    const tail = Buffer.alloc(tailLen)
    fs.readSync(fd, tail, 0, tailLen, size - tailLen)
    // 找 EOCD（PK\x05\x06），从后往前
    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
    }
    if (eocd < 0) throw new Error("no EOCD (not a zip)")
    const total = tail.readUInt16LE(eocd + 10)
    const cdOffset = tail.readUInt32LE(eocd + 16)
    const cd = Buffer.alloc(tail.readUInt32LE(eocd + 12))
    fs.readSync(fd, cd, 0, cd.length, cdOffset)
    // 遍历中央目录，定位 word/document.xml
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
    // 读本地文件头，算数据起始偏移
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
    .replace(/PAGEREF\s+_Toc\d+[^\n]*/gi, "")   // 目录域代码整段
    .replace(/_Toc\d+/g, "").replace(/\\h\b/g, "").replace(/HYPERLINK\s+"[^"]*"/gi, "")
    .replace(/\{\s*MERGEFORMAT\s*\}/gi, "")
    .replace(/^\s*TOC\s+/i, "").replace(/\\[a-zA-Z]\s*"[^"]*"/g, "").replace(/\\[a-zA-Z](?=\s|$)/g, "") // 目录域开关 TOC \o "1-3" \z \u
}

function xmlToText(xml) {
  let t = xml
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
  t = decodeEntities(t)
  const lines = t.split(/\r?\n/)
    .map((l) => scrub(l).replace(/[ \t]+/g, " ").replace(/\u00a0/g, " ").trim())
    .filter(Boolean)
  // 目录行去掉尾部制表符+页码
  const cleaned = lines.map((l) => l.replace(/\s*\t\s*\d{1,4}\s*$/, "").replace(/\s{2,}\d{1,4}\s*$/, "").trim()).filter(Boolean)
  return cleaned.join("\n")
}

// --- 归类 --------------------------------------------------------------------
const TRACKS = [
  ["电子病历评级", /电子病历.{0,6}(评级|过级|升级|五[级6]|六[级7])|评级.{0,4}电子病历|互联互通.{0,4}电子病历/],
  ["互联互通评级", /互联互通|标准化成熟度|信息互联互通/],
  ["医共体建设", /医共体|县域.{0,4}(医疗|卫生|影像|心电)|紧密型/],
  ["DRG-DIP医保", /DRG|DIP|医保支付|医保结算|病种分值|医保基金|飞行检查/],
  ["信创改造", /信创|国产化|自主可控|麒麟|统信|达梦|人大金仓|鲲鹏|海光/],
  ["数据安全", /等级保护|等保[二三四]级|数据安全|密码改造|国密|灾备|容灾|数据脱敏|防勒索|网络安全设备|防火墙|态势感知/],
  ["中医医院", /中医|中药|辨证|治未病|中医药/],
  ["智慧医院", /智慧医院|智慧服务|智慧管理|智慧医疗|全流程|一体化平台/],
  ["集成平台", /集成平台|信息集成|ESB|HL7|数据中心|CDR|ODR|数据治理|数据中台|互联互通平台/],
  ["移动医疗", /移动医疗|移动护理|移动医生|床旁|互联网医院|在线问诊|掌上医院/],
  ["HIS系统", /\bHIS\b|医院信息系统|门诊住院|收费结算|电子病历系统/],
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
// 从路径里定位「项目目录」段（同项目的多个版本子目录归并为一个）
const PROJ_RE = /医院|卫生院|附院|医共体|大学|项目|中心|妇幼|平台|系统|建设|改造|维保|智慧|电子病历|互联互通|医技|公卫|病案|接口/
function groupOf(rel) {
  const parts = rel.split(path.sep)
  let cut = -1
  for (let i = 0; i < parts.length - 1; i++) { if (PROJ_RE.test(parts[i])) { cut = i; break } }
  if (cut < 0) cut = Math.min(2, parts.length - 2)
  return { key: parts.slice(0, cut + 1).join(path.sep), proj: parts[cut] || parts[parts.length - 2] || parts[0] }
}

// --- 枚举候选 ----------------------------------------------------------------
function walk(d, o) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, e.name); if (e.isDirectory()) walk(fp, o); else o.push(fp) } return o }
const picks = (() => {
  const all = walk(ROOT, [])
  const docx = all.filter((f) => f.toLowerCase().endsWith(".docx") && !/[~]\$/.test(path.basename(f)) && !/\.(bak|tmp)$/i.test(path.basename(f)))
  const cand = docx.filter((f) => { const b = path.basename(f); return INC.test(b) && !EXC.test(b) && !COMP.test(b) && !/第三方应标|参考标书|他人|友商|竞对/.test(f) })
  const groups = {}
  for (const f of cand) {
    const { key, proj } = groupOf(path.relative(ROOT, f))
    const cur = groups[key]
    if (!cur || fs.statSync(f).size > fs.statSync(cur.file).size) groups[key] = { file: f, proj }
  }
  return Object.values(groups).sort((a, b) => (a.file < b.file ? -1 : 1))
})()
console.log(`技术标候选（跨版本去重后）：${picks.length} 份`)

async function api(pathname, options = {}) {
  const res = await fetch(BASE + pathname, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } })
  if (!res.ok) throw new Error(`${options.method || "GET"} ${pathname} → ${res.status}: ${(await res.text()).slice(0, 160)}`)
  return res.status === 204 ? null : res.json()
}
const have = new Set()
if (!DRY) {
  for (let page = 1; page <= 20; page++) {
    const o = await api(`/api/kb_docs?perPage=200&page=${page}`)
    for (const it of o.items || []) if (String(it.source_file_name || "").startsWith("bidtpl:")) have.add(String(it.source_file_name))
    if (!o.items || o.items.length < 200) break
  }
}

let ok = 0, skipped = 0, thin = 0, fail = 0
for (const { file: f, proj } of picks) {
  const rel = path.relative(ROOT, f)
  const key = `bidtpl:${rel}`
  if (!DRY && have.has(key)) { skipped++; continue }
  let text
  try { text = extractDocxText(f) } catch (e) { fail++; console.log(`[fail] ${rel}: ${e.message}`); continue }
  if (!text || text.length < 3000) { thin++; console.log(`[thin] ${rel} (${text ? text.length : 0}字，疑似图片型/空)`); continue }
  const head = text.slice(0, 4000)
  const track = detectTrack(head, path.basename(f))
  const year = detectYear(rel)
  const content = text.length > MAX_CONTENT ? text.slice(0, MAX_CONTENT) + `\n\n…（正文过长，已截断至 ${MAX_CONTENT} 字）` : text
  const title = `标书范本/${track}/${year ? year + "·" : ""}${proj}·技术标`
  const keywords = [track, year ? year + "年" : "", "技术标", "投标文件", proj, ...((head.match(/电子病历|互联互通|医共体|DRG|信创|集成平台|移动护理|智慧医院|实施方案|项目管理|售后服务|培训|质量保障|需求理解/g) || []))].filter((v, i, a) => v && a.indexOf(v) === i).slice(0, 12)
  if (DRY) { console.log(`\n[${track}] ${title}  (${content.length}字, 原${text.length})  <- ${rel}`); console.log("  " + content.split("\n").filter((l) => /^第.{1,8}章|^[一二三四五六七八九十]{1,3}、|^\d+\.\d+\s/.test(l)).slice(0, 8).join("\n  ")); ok++; continue }
  await api("/api/kb_docs", {
    method: "POST",
    body: JSON.stringify({
      rh_user_id: LOCAL_USER, title,
      folder_path: `标书范本/${track}`,
      content, doc_format: "md", visibility: "team",
      summary: `历史投标技术标范本（${track}${year ? "·" + year + "年" : ""}·${proj}）：含项目需求理解、实施/管理/培训/售后等通用章节，供同类标书技术部分参考复用（${content.length} 字）。`,
      keywords, source_file_name: key, uploader_name: "标书范本导入",
      doc_category: "技术方案", ai_context_mode: "original", retrieval_weight: 1.0, is_sensitive: false,
    }),
  })
  ok++
  if (ok % 10 === 0) console.log(`  …已入库 ${ok}`)
}
console.log(`\n完成：入库 ${ok}，已存在跳过 ${skipped}，过短/图片型 ${thin}，抽取失败 ${fail}`)

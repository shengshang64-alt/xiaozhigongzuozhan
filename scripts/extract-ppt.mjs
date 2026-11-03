// R-205 第4批：PPT 页级素材库 —— 抽取 PPT模版 + 公司产品PPT 逐页正文，按页型/章节打标入库 kb_docs
// 复用「选择性 inflate」：只读 ppt/slides/slideN.xml，不解压图片，百 MB 级 pptx 零 OOM。
// 用法：node scripts/extract-ppt.mjs [--dry]
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"

const BASE = "http://127.0.0.1:7000"
const ROOT = "D:\\重要文件\\A重要客户情况"
const LOCAL_USER = "local-user"
const MAX_CONTENT = 20000 // 单页正文上限（PPT 页文字量小，留足余量）
const DRY = process.argv.includes("--dry")

// 策展范围：仅这两库
const BUCKET_DIRS = ["PPT模版", "公司产品PPT"]
// 排除：PPT 制作技巧教程（非素材）
const EXCLUDE_FILE = /PPT制作技巧|PPT.{0,4}技巧|制作技巧分享|iSlide|售前培训/

// ---------- ZIP：一次性解析中央目录，按需 inflate 指定条目 ----------
function openZip(file) {
  const fd = fs.openSync(file, "r")
  const size = fs.fstatSync(fd).size
  const tailLen = Math.min(66000, size)
  const tail = Buffer.alloc(tailLen)
  fs.readSync(fd, tail, 0, tailLen, size - tailLen)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) { fs.closeSync(fd); return null }
  const total = tail.readUInt16LE(eocd + 10)
  const cdSize = tail.readUInt32LE(eocd + 12)
  const cdOff = tail.readUInt32LE(eocd + 16)
  const cd = Buffer.alloc(cdSize)
  fs.readSync(fd, cd, 0, cdSize, cdOff)
  const map = new Map()
  let p = 0
  for (let n = 0; n < total; n++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break
    const method = cd.readUInt16LE(p + 10)
    const compSize = cd.readUInt32LE(p + 20)
    const nameLen = cd.readUInt16LE(p + 28)
    const extraLen = cd.readUInt16LE(p + 30)
    const commentLen = cd.readUInt16LE(p + 32)
    const localOff = cd.readUInt32LE(p + 42)
    const name = cd.toString("utf8", p + 46, p + 46 + nameLen)
    map.set(name, { method, compSize, localOff })
    p += 46 + nameLen + extraLen + commentLen
  }
  return {
    file, fd, map,
    read(name) {
      const e = map.get(name)
      if (!e) return null
      const lh = Buffer.alloc(30)
      fs.readSync(fd, lh, 0, 30, e.localOff)
      const lnl = lh.readUInt16LE(26), lel = lh.readUInt16LE(28)
      const dataOff = e.localOff + 30 + lnl + lel
      const buf = Buffer.alloc(e.compSize)
      fs.readSync(fd, buf, 0, e.compSize, dataOff)
      return e.method === 8 ? zlib.inflateRawSync(buf) : buf
    },
    close() { try { fs.closeSync(fd) } catch {} },
  }
}

// ---------- 文本抽取 & 清洗 ----------
function decodeEnt(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&")
}
// 综合清洗：页脚(公司名/地址/网址)、日期、口号、致谢、域噪声
function scrub(t) {
  return t
    .replace(/<[^>]+>/g, " ")
    .replace(/智业软件股份有限公司/g, " ")
    .replace(/地址[：:]?\s*[^，,。;；\n]{0,40}?(网址[：:]?)?/g, " ")
    .replace(/网址[：:]?\s*[\w.-]*\.(?:com|cn|net|org)[\w./-]*/g, " ")
    .replace(/www\.[\w.-]+/gi, " ")
    .replace(/zoesoft\.com\.cn/gi, " ")
    .replace(/智慧医疗\s*[·•・]\s*健康天下/g, " ")
    .replace(/践行社会责任[，,]?\s*助力健康中国[！!]*/g, " ")
    .replace(/\bThank\s*you\b|\bThanks\b|\bTHANKS!/gi, " ")
    .replace(/20\d{2}\s*[年.\-/]\s*\d{1,2}\s*[月.\-/]?\s*\d{1,2}\s*[日号]*/g, " ")
    .replace(/20\d{2}\s*[年.\-/]\s*\d{1,2}\s*月?/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}
function slideText(xmlBuf) {
  const s = xmlBuf.toString("utf8")
  const runs = []
  const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g
  let m
  while ((m = re.exec(s))) runs.push(m[1])
  let t = decodeEnt(runs.join(" "))
  t = scrub(t)
  return t
}
function cleanForLen(t) {
  return t.replace(/\s+/g, "").replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "")
}
function detectRole(t) {
  const s = t.trim()
  if (/THANKS|谢谢|敬请|感谢聆听|敬请指导|结束语/i.test(s)) return "尾页"
  if (/CONTENTS|目\s*录/i.test(s)) return "目录"
  if (/\bPART\s*\d+/i.test(s) && s.length < 60) return "过渡页"
  if (/^0\d\s|^\d{2}\s/.test(s) && s.length < 40) return "过渡页"
  if (/^第[一二三四五六七八九十]部分/.test(s) && s.length < 50) return "过渡页"
  if (s.length < 45 && /(汇报|方案|交流|规划|介绍|建议书|演示)/.test(s) && /(医院|大学|院区|公司|附属|总院|分院|卫生|健康)/.test(s)) return "封面"
  return "内容页"
}

// ---------- 分桶 & 章节 ----------
function bucketOf(rel) {
  const top = rel.split(path.sep)[0]
  const base = path.basename(rel, path.extname(rel))
  if (top === "PPT模版") {
    if (/^00[--.（(]|浅色/i.test(base)) return { bucket: "页版式模板", section: "版式" }
    const m = base.match(/^(\d{2})\s*[-.、]\s*(.+)$/)
    if (m) return { bucket: "分章节模板", section: m[2].replace(/[、,，].*$/, "").trim() }
    return { bucket: "分章节模板", section: base.replace(/^\d{4}/, "").slice(0, 12) || "综合" }
  }
  // 公司产品PPT
  if (/简介|公司概况|公司及产品|股份公司简|公司介绍/i.test(base)) return { bucket: "产品简介", section: "公司简介" }
  return { bucket: "产品简介", section: "产品能力" }
}
const SECTION_CAT = [
  [/政策|标准|评级|测评|解读|优惠|法规|规范/, "政策法规"],
  [/案例|人物|专家|典型|经验/, "项目案例"],
  [/产品|简介|公司|体系|方案概览/, "产品资料"],
  [/医院介绍|医院简介|现状|总体设计|总体架构|架构|建设依据|目标|实施|规划|设计|运维|功能/, "技术方案"],
]
function categoryOf(section, bucket) {
  for (const [re, c] of SECTION_CAT) if (re.test(section)) return c
  if (bucket === "页版式模板") return "其他"
  return "技术方案"
}
function deckShort(rel) {
  let b = path.basename(rel, path.extname(rel))
  b = b.replace(/^20\d{4,6}[-_ ]?/, "").replace(/^20\d{2}[-/.]\d{1,2}[-/.]?\d{0,2}[-_ ]?/, "")
  b = b.replace(/[（(【\[].*?[)）】\]]/g, "").replace(/\s*V?[\d.]+\s*$/i, "").replace(/[-_.\s]+$/g, "").trim()
  return (b || path.basename(rel)).slice(0, 40)
}
function normHash(t) {
  return t.toLowerCase().replace(/[\s\p{P}]/gu, "").slice(0, 400)
}

// ---------- 主流程 ----------
const slides = []
const seen = new Set()
let fileCount = 0, slideCount = 0, thinCount = 0, dupCount = 0

function processFile(full, rel) {
  const z = openZip(full)
  if (!z) return
  try {
    const names = [...z.map.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    names.sort((a, b) => parseInt(a.match(/(\d+)/)[1]) - parseInt(b.match(/(\d+)/)[1]))
    if (!names.length) return
    fileCount++
    const { bucket, section } = bucketOf(rel)
    const deck = deckShort(rel)
    names.forEach((nm, i) => {
      const buf = z.read(nm)
      if (!buf) return
      slideCount++
      const raw = slideText(buf)
      const body = raw.replace(/\s+\d{1,3}\s*$/, "").trim()
      if (/copy\s*&?\s*paste|keep text only|click to edit|单击此处|添加(标题|文本)|插入.{0,4}(图片|内容)|iSlide/i.test(body)) { thinCount++; return }
      if (cleanForLen(body).length < 20) { thinCount++; return }
      const h = normHash(body)
      if (seen.has(h)) { dupCount++; return }
      seen.add(h)
      const role = detectRole(body)
      slides.push({
        rel, n: i + 1, bucket, section, deck, role,
        category: categoryOf(section, bucket),
        text: body.slice(0, MAX_CONTENT),
      })
    })
  } finally { z.close() }
}

function walk(d) {
  let items = []
  try { items = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of items) {
    const fp = path.join(d, e.name)
    if (e.isDirectory()) { walk(fp); continue }
    if (!/\.pptx$/i.test(e.name) || /^~\$/.test(e.name)) continue
    if (EXCLUDE_FILE.test(e.name)) continue
    processFile(fp, path.relative(ROOT, fp))
  }
}
for (const sub of BUCKET_DIRS) walk(path.join(ROOT, sub))

// 统计
const byBucket = {}, byCat = {}, byRole = {}
for (const s of slides) {
  byBucket[s.bucket] = (byBucket[s.bucket] || 0) + 1
  byCat[s.category] = (byCat[s.category] || 0) + 1
  byRole[s.role] = (byRole[s.role] || 0) + 1
}
console.log(`文件 ${fileCount} | 页 ${slideCount} | 过短跳 ${thinCount} | 去重跳 ${dupCount} | 入库候选 ${slides.length}`)
console.log("桶分布:", JSON.stringify(byBucket))
console.log("分类分布:", JSON.stringify(byCat))
console.log("页型分布:", JSON.stringify(byRole))

if (DRY) {
  const sample = slides.filter((s) => s.role === "内容页").slice(0, 12)
  console.log("\n--- 内容页抽样 ---")
  for (const s of sample) console.log(`[${s.bucket}/${s.section}/${s.category}] ${s.deck}#P${s.n}: ${s.text.slice(0, 70)}`)
  fs.writeFileSync(path.join(process.cwd(), ".diag", "ppt-dry.txt"), slides.map((s) => `${s.bucket}\t${s.section}\t${s.role}\t${s.category}\t${s.deck}#P${s.n}\t${s.text.slice(0, 90)}`).join("\n"), "utf8")
  console.log("\nWROTE .diag/ppt-dry.txt")
  process.exit(0)
}

// ---------- 入库 ----------
async function main() {
  const have = new Set()
  for (let p = 1; p <= 40; p++) {
    const d = await (await fetch(`${BASE}/api/kb_docs?perPage=200&page=${p}`)).json()
    for (const x of d.items || []) if (String(x.source_file_name || "").startsWith("pptslide:")) have.add(String(x.source_file_name))
    if ((d.items || []).length < 200) break
  }
  let ok = 0, skip = 0, fail = 0
  for (const s of slides) {
    const key = `pptslide:${s.rel}#${s.n}`
    if (have.has(key)) { skip++; continue }
    const title = `PPT素材/${s.section}/${s.role}·${s.deck}·P${s.n}`
    const body = {
      rh_user_id: LOCAL_USER,
      title: title.slice(0, 300),
      folder_path: `PPT素材/${s.bucket}/${s.section}`,
      content: s.text,
      doc_format: "pptx",
      visibility: "team",
      summary: s.text.slice(0, 120),
      keywords: [s.bucket, s.section, s.role, s.deck],
      source_file_name: key.slice(0, 300),
      uploader_name: "PPT素材导入",
      doc_category: s.category,
      ai_context_mode: "original",
      retrieval_weight: 0,
      is_sensitive: false,
    }
    try {
      const r = await fetch(`${BASE}/api/kb_docs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      if (r.ok) ok++; else { fail++; console.log("FAIL", r.status, (await r.text()).slice(0, 120)) }
    } catch (e) { fail++; console.log("ERR", String(e && e.message || e)) }
  }
  console.log(`\n入库完成：新增 ${ok} | 跳过(幂等) ${skip} | 失败 ${fail}`)
}
main()

/**
 * R45 · 安中医（2026BFAFZ50845）整本「真导出」离线复演 —— 交付物级端到端验证
 *
 * 用法（仓库根）：node docs/evolution/_r45_anzhongyi_reexport.mjs [项目id] [输出docx路径]
 *
 * 口径：真代码（vite ssrLoadModule 加载 src/pages/BidWorkspace/bidFiles.ts）+ 真数据
 *      （只读 pocketbase/pb_data/data.db）+ 真 docx（docx 库 Packer.toBlob 产出的 zip）。
 *      零 AI 调用、不写库、不碰用户既有产物。
 *
 * 已知边界：Node 无 DOM/canvas，配图渲染（figureToPng）走生产代码自带的 try/catch 降级分支
 *          → 图位落为「【图】标题」文字。即：正文/标记/章节结构/标题层级全部为真实产物口径，
 *          「图的位图字节」这一段未覆盖（浏览器里由 canvas 完成，与本轮三处修复无关）。
 */
import { createServer } from "vite"
import { DatabaseSync } from "node:sqlite"
import { inflateRawSync } from "node:zlib"
import { fileURLToPath } from "node:url"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const PID = process.argv[2] ?? "mfl6howomsw5i0l"
const OUT = process.argv[3] ?? path.join(ROOT, ".diag/r45-reexport/安中医-投标文件.docx")

// ---- 浏览器环境最小替身（只为让 triggerBlobDownload 走通并把 blob 截获下来）----
let captured = null
globalThis.URL.createObjectURL = (blob) => { captured = blob; return "blob:stub" }
globalThis.URL.revokeObjectURL = () => {}
globalThis.document = {
  createElement: () => ({ href: "", download: "", click() {}, remove() {}, setAttribute() {} }),
  body: { appendChild() {} },
}

// ---- 真源码 ----
const server = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, "vite.config.ts"),
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
})
const bf = await server.ssrLoadModule("/src/pages/BidWorkspace/bidFiles.ts")
const bt = await server.ssrLoadModule("/src/pages/BidWorkspace/bidTypes.ts")

// ---- 真数据（只读）----
const db = new DatabaseSync(path.join(ROOT, "pocketbase/pb_data/data.db"), { readOnly: true })
const row = db.prepare("select * from bid_projects where id = ?").get(PID)
if (!row) throw new Error("未找到项目 " + PID)
const project = { ...row, bid_chapters: JSON.parse(row.bid_chapters || "[]"), gen_options: JSON.parse(row.gen_options || "{}") }
const scope = bt.normalizeBidScope(project.gen_options)
const exportChapters = bf.pickExportChapters(project.bid_chapters, scope)
console.log(`项目 ${row.project_name}（${row.tender_no}）章数 ${project.bid_chapters.length}，内容范围 ${scope}，导出章数 ${exportChapters.length}`)

// ---- 真导出：走 exportBidDocx（format_settings=null → 默认导出路径）----
await bf.exportBidDocx(project)
if (!captured) throw new Error("未截获导出 blob：exportBidDocx 未走到 downloadDocx")
const bytes = Buffer.from(await captured.arrayBuffer())
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, bytes)
console.log(`已产出 docx：${path.relative(ROOT, OUT)}（${(bytes.length / 1024).toFixed(0)} KB）`)

// ---- 解 zip 取 word/document.xml（自写最小 zip 读取，零依赖）----
function readZipEntry(buf, want) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) throw new Error("不是合法 zip（无 EOCD）")
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), cmtLen = buf.readUInt16LE(p + 32)
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen)
    const localOff = buf.readUInt32LE(p + 42)
    if (name === want) {
      const method = buf.readUInt16LE(localOff + 8)
      const lNameLen = buf.readUInt16LE(localOff + 26), lExtraLen = buf.readUInt16LE(localOff + 28)
      const size = buf.readUInt32LE(p + 24)
      const dataStart = localOff + 30 + lNameLen + lExtraLen
      const raw = buf.subarray(dataStart, dataStart + size)
      return method === 0 ? raw : inflateRawSync(raw)
    }
    p += 46 + nameLen + extraLen + cmtLen
  }
  throw new Error("zip 中找不到 " + want)
}
const xml = readZipEntry(bytes, "word/document.xml").toString("utf8")

// ---- 检查 1/2/3：文本层（★/▲ 保全、承诺函整章、章数）----
const text = xml
  .replace(/<w:p[ >]/g, "\n<w:p ")
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
const count = (s, ch) => s.split(ch).length - 1
const srcStars = exportChapters.reduce((n, c) => n + count(c.content || "", "★"), 0)
const srcTri = exportChapters.reduce((n, c) => n + count(c.content || "", "▲"), 0)
const docStars = count(text, "★"), docTri = count(text, "▲")
const h1 = (xml.match(/w:val="Heading1"/g) ?? []).length
const hasCommitment = text.includes("第18章 实质性条款响应承诺函")
console.log(`\n[1] ★ 保全：库内导出章 ${srcStars} 个 -> docx 正文 ${docStars} 个  ${srcStars === docStars ? "✓ 零丢失" : "✗ 有丢失！"}`)
console.log(`     ▲ 保全：库内 ${srcTri} 个 -> docx ${docTri} 个  ${srcTri === docTri ? "✓" : "✗"}`)
console.log(`[2] 承诺函整章：${hasCommitment ? "✓ 已作为第18章在导出物中" : "✗ 整章缺失"}`)
console.log(`[3] 章标题数（Heading1）：${h1} 个（期望 ${exportChapters.length}）  ${h1 === exportChapters.length ? "✓" : "✗"}`)

// ---- 检查 4：标题层级（本轮修复 3 的直接产物）----
const h2Count = (xml.match(/w:val="Heading2"/g) ?? []).length
const h3Count = (xml.match(/w:val="Heading3"/g) ?? []).length
// 改前算法（HEAD~1 原文：无 sections=[] 兜底）在同一份数据上的预测值
const norm = (t) => (t ?? "").replace(/[\s\u3000]+/g, "")
function oldHeading(line, sections, chapterNo) {
  const l = (line ?? "").trim()
  if (!l || l.length > 40) return false
  if (/[。！？；，、]$/.test(l)) return false
  const m = /^(\d+(?:\.\d+)+)[.、\s]*(\S.*)$/.exec(l)
  if (!m) return false
  const idx = Number(m[1].split(".")[1])
  const src = (sections ?? [])[idx - 1]
  if (!src) return false
  if (norm(m[1]) !== norm(String(chapterNo) + "." + String(idx))) return false
  return norm(m[2]) === norm(src)
}
let oldH2 = 0
for (const [i, ch] of exportChapters.entries()) {
  for (const line of (ch.content || "").split("\n")) if (oldHeading(line.trim(), ch.sections, i + 1)) oldH2++
}
console.log(`[4] 小节标题（Heading2）：改前预测 ${oldH2} 条 -> 真导出 ${h2Count} 条  ${h2Count > oldH2 ? "✓ 目录层级已恢复" : "✗ 未改善"}`)
console.log(`    （另有 Heading3 的（一）（二）式小标题 ${h3Count} 条）`)

// ---- 检查 5：承诺函章内的 ★ 逐条响应是否真的带出来了 ----
const commitStart = text.indexOf("实质性条款响应承诺函")
const commitText = commitStart < 0 ? "" : text.slice(commitStart, commitStart + 6000)
console.log(`[5] 承诺函章内 ★ 数：${count(commitText, "★")} 个 / ▲ ${count(commitText, "▲")} 个（前 6000 字窗口）`)

const ok = srcStars === docStars && srcTri === docTri && hasCommitment && h1 === exportChapters.length && h2Count > oldH2
console.log(`\n结论：${ok ? "PASS —— 三处修复在真导出物上全部生效" : "FAIL —— 见上面 ✗ 项"}`)
await server.close()
process.exit(ok ? 0 : 2)

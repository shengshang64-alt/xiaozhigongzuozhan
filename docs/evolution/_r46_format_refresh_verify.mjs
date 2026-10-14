/**
 * R46 · 「格式刷新」真可用性验证（只读真实 docx，零 AI 零写库）
 * 用法：node docs/evolution/_r46_format_refresh_verify.mjs
 */
import { createServer } from "vite"
import { JSDOM } from "jsdom"
import { unzipSync, strFromU8 } from "fflate"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

// formatSpec 的识别侧依赖浏览器 DOMParser；node 里用 jsdom 顶上
const win = new JSDOM("").window
globalThis.DOMParser = win.DOMParser

const server = await createServer({
  root: ROOT, configFile: path.join(ROOT, "vite.config.ts"),
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
})
const spec0 = await server.ssrLoadModule("/src/pages/FormatTool/formatSpec.ts")
const ref0 = await server.ssrLoadModule("/src/pages/FormatTool/refreshDocx.ts")

const SAMPLE = ".probe/realrun/downloads/安中医-投标文件.docx"
const DRAFT  = ".diag/r45-reexport/安中医-投标文件.docx"
const OTHER  = "_eval/安庆二院投标文件-真实场景交付样本-2026-10-13.docx"

function toFile(rel) {
  const p = path.join(ROOT, rel)
  const buf = fs.readFileSync(p)
  return new File([new Uint8Array(buf)], path.basename(p), { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })
}
function readXml(bytes, name) {
  const zip = unzipSync(new Uint8Array(bytes))
  return { zip, xml: zip[name] ? strFromU8(zip[name]) : "" }
}
const count = (s, re) => (s.match(re) ?? []).length

async function inspect(rel) {
  const file = toFile(rel)
  console.log(`\n=== 识别：${rel}（${(file.size/1024).toFixed(0)} KB）===`)
  let spec
  try { spec = await spec0.extractFormatSpecFromFile(file) }
  catch (e) { console.log("  识别失败:", e.message); return null }
  const h = spec.headings.map(x => `L${x.level}:${x.fontEastAsia||"?"}/${x.sizePt}pt/${x.align||"-"}`).join("  ")
  console.log(`  正文: ${spec.body.fontEastAsia||"?"} / ${spec.body.sizePt}pt / 行距 ${spec.body.lineSpacing||"未设"} / 缩进 ${spec.body.firstLineChars} 字`)
  console.log(`  纸张: ${spec.page.paperGuess} 边距 T${spec.page.margin.top}/B${spec.page.margin.bottom}/L${spec.page.margin.left}/R${spec.page.margin.right} cm`)
  console.log(`  标题(${spec.headings.length}): ${h}`)
  console.log(`  段落样式数: ${spec.paragraphStyleCount}，未命中样本: ${spec.styleSample.length}`)
  return { file, spec }
}

// ---------- 1) 两份真实 docx 的格式识别 ----------
const a = await inspect(SAMPLE)
const b = await inspect(DRAFT)
const c = await inspect(OTHER)

// ---------- 2) 用「A 的格式标准」刷新「B 的草稿」（真实商务场景）----------
const src = a ?? b
const dst = b ?? a
if (src && dst) {
  const { settings, notes: mapNotes } = spec0.specToFormatSettings(src.spec)
  console.log(`\n=== 用「${path.basename(src.file.name)}」的格式标准刷新「${path.basename(dst.file.name)}」===`)
  console.log(`  映射说明: ${mapNotes.length ? mapNotes.join(" | ") : "（无近似项）"}`)
  console.log(`  目标: 正文 ${settings.body.font}${settings.body.size} 行距${settings.body.lineSpacing} | 纸张 ${settings.paper} | 标题 ${settings.heading.map(x=>x.font+x.size).join(",")}`)

  const scopes = ["font", "heading", "spacing", "page"]
  const t0 = Date.now()
  const out = await ref0.refreshDocxFile(dst.file, settings, scopes)
  const dt = Date.now() - t0
  console.log(`  耗时 ${dt}ms，产出 ${(out.blob.size/1024).toFixed(0)} KB，notes: ${out.notes.length ? out.notes.join(" | ") : "（无）"}`)
  const r = out.report
  for (const [k, v] of Object.entries(r.slots)) console.log(`  [${k}] ${v.status}  ${v.reason}`)
  console.log(`  槽位 ok ${r.okCount}/${r.totalCount}｜正文字符数 ${r.textBefore} -> ${r.textAfter} ${r.textBefore===r.textAfter?"✓ 文字0改动":"✗ 文字发生变化"}`)

  // ---------- 3) 独立复核产出物（不信任 report，直接解包看字节）----------
  const bytes = Buffer.from(await out.blob.arrayBuffer())
  const zipOut = unzipSync(new Uint8Array(bytes))
  const names = Object.keys(zipOut)
  const required = ["[Content_Types].xml", "word/document.xml", "word/styles.xml", "_rels/.rels"]
  console.log(`  独立复核：zip 条目 ${names.length}，必需部件 ${required.filter(n=>names.includes(n)).length}/${required.length} ${required.every(n=>names.includes(n))?"✓":"✗"}`)
  const before = readXml(await dst.file.arrayBuffer(), "word/document.xml").xml
  const after = strFromU8(zipOut["word/document.xml"])
  const textOf = (xml) => (xml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? []).map(t=>t.replace(/<[^>]+>/g,"")).join("")
  const tb = textOf(before), ta = textOf(after)
  console.log(`  正文文字逐字一致：${tb === ta ? "✓ 完全一致（"+tb.length+" 字）" : "✗ 不一致（"+tb.length+" -> "+ta.length+"）"}`)
  // R46 增补：产出物必须是【合法 XML】——只查子串的断言抓不到错位替换造成的非法 XML
  const xmlErr = (xml) => {
    const d = new win.DOMParser().parseFromString(xml, "text/xml")
    const e = d.getElementsByTagName("parsererror")
    return e.length ? (e[0].textContent || "").replace(/\s+/g, " ").slice(0, 120) : ""
  }
  const docErr = xmlErr(after)
  const stErr = xmlErr(strFromU8(zipOut["word/styles.xml"]))
  console.log(`  产出 XML 合法性：document.xml ${docErr ? "✗ " + docErr : "✓"}；styles.xml ${stErr ? "✗ " + stErr : "✓"}`)
  const ddBlock = (() => { const x = strFromU8(zipOut["word/styles.xml"]); const a = x.indexOf("<w:docDefaults>"); const b = x.indexOf("</w:docDefaults>"); return a >= 0 && b > a ? x.slice(a, b) : "" })()
  console.log(`  docDefaults：存在 ${ddBlock ? "✓" : "—"}；rPr 个数 ${(ddBlock.match(/<w:rPr>/g) || []).length}（应为 1）；含目标字体 ${ddBlock.includes(`w:eastAsia="${settings.body.font}"`) ? "✓" : "✗"}`)
  const hasNormal = strFromU8(zipOut["word/styles.xml"]).includes('w:styleId="Normal"')
  console.log(`  样式表含 Normal 正文样式：${hasNormal ? "✓" : "✗（缺失则正文格式无处落地）"}`)
  const st = strFromU8(zipOut["word/styles.xml"])
  console.log(`  样式表含目标字体 ${settings.body.font}: ${st.includes(`w:eastAsia="${settings.body.font}"`)?"✓":"✗"}；目标字号 ${settings.body.size}: ${st.includes(`<w:sz w:val="${Math.round((spec0.SIZE_PT[settings.body.size]??12)*2)}"/>`)?"✓":"✗"}`)
  const paper = {A4:[11906,16838],A3:[16838,23811],"16K":[10431,14740]}[settings.paper]
  const sect = /<w:sectPr[\s\S]*?<\/w:sectPr>/.exec(after)?.[0] ?? ""
  console.log(`  sectPr 目标纸张 ${settings.paper}: ${paper && sect.includes(`w:w="${paper[0]}"`)? "✓":"✗"}；边距 top: ${sect.includes(`w:top="${Math.round(settings.margins.top*566.928)}"`)?"✓":"✗"}`)

  // ---------- 4) 直排格式（run 级 rPr）覆盖率——决定"改样式"能否真正改变视觉 ----------
  const runFonts = count(after, /<w:rFonts /g)
  const rPrRuns = count(after, /<w:rPr>/g)
  const runs = count(after, /<w:r[ >]/g)
  console.log(`  ⚠️ 直排风险：run ${runs} 个，其中 run 级 <w:rPr> ${rPrRuns} 个、显式 <w:rFonts> ${runFonts} 个`)
  console.log(`     段落数 ${count(after, /<w:p[ >]/g)}；pStyle 引用 ${count(after, /<w:pStyle /g)} 个`)

  // ---------- 5) removeUnusedStyles ----------
  const out2 = await ref0.refreshDocxFile(dst.file, settings, ["font"], { removeUnusedStyles: true })
  const st2 = strFromU8(unzipSync(new Uint8Array(await out2.blob.arrayBuffer()))["word/styles.xml"])
  const before2 = strFromU8(unzipSync(new Uint8Array(await dst.file.arrayBuffer()))["word/styles.xml"])
  console.log(`  清理未应用样式：styles.xml 样式数 ${count(before2, /<w:style /g)} -> ${count(st2, /<w:style /g)}，notes: ${out2.notes.join(" | ")||"（无）"}`)
}

// ---------- 6) 边界：非 docx / 损坏文件 ----------
console.log("\n=== 边界 ===")
try {
  const bad = new File([new Uint8Array([1,2,3,4])], "bad.docx")
  await ref0.refreshDocxFile(bad, spec0 ? {} : {}, ["font"])
  console.log("  损坏文件：未抛错（需检查）")
} catch (e) { console.log(`  损坏文件：抛错「${e.message}」→ 界面会提示"请确认文档是未加密的 .docx" ✓`) }

await server.close()

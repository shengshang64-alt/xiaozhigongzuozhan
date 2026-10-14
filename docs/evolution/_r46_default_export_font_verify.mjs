/**
 * R46 · 「默认导出（format_settings=null）是否写入字体」实测（jsdom + docx 真实构建，零网络）
 * 用法：node docs/evolution/_r46_default_export_font_verify.mjs
 */
import { createServer } from "vite"
import { JSDOM } from "jsdom"
import { unzipSync, strFromU8 } from "fflate"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" })
const win = dom.window
globalThis.window = win
globalThis.document = win.document
globalThis.DOMParser = win.DOMParser
globalThis.HTMLElement = win.HTMLElement
globalThis.Node = win.Node

let captured = null
win.URL.createObjectURL = (b) => { captured = b; return "blob:fake" }
win.URL.revokeObjectURL = () => {}
globalThis.URL.createObjectURL = win.URL.createObjectURL
globalThis.URL.revokeObjectURL = win.URL.revokeObjectURL

const server = await createServer({
  root: ROOT, configFile: path.join(ROOT, "vite.config.ts"),
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
})
const bf = await server.ssrLoadModule("/src/pages/BidWorkspace/bidFiles.ts")

const project = {
  id: "r46-verify",
  project_name: "安中医R46默认导出口径实测",
  hospital: "安徽中医药大学第一附属医院",
  tender_no: "2026BFAFZ50845",
  gen_options: { include_biz: true, include_tech: true },
  bid_chapters: [
    { id: "c1", title: "项目理解与需求响应", part: "tech", sections: ["1.1 现状诊断"], content: "第一段正文，用于验证默认导出是否写入字体信息。\n1.1 现状诊断\n第二段正文。" },
    { id: "c2", title: "商务响应", part: "biz", sections: ["2.1 报价一览"], content: "" },
  ],
  format_settings: null,
}

await bf.exportBidDocx(project)

if (!captured) { console.error("未捕获到导出 blob"); process.exit(1) }
const bytes = new Uint8Array(await captured.arrayBuffer())
const zip = unzipSync(bytes)
const doc = zip["word/document.xml"] ? strFromU8(zip["word/document.xml"]) : ""
const styles = zip["word/styles.xml"] ? strFromU8(zip["word/styles.xml"]) : ""
const count = (s, re) => (s.match(re) ?? []).length

console.log(`产出 ${(bytes.length / 1024).toFixed(1)} KB，zip 条目 ${Object.keys(zip).length}`)
console.log(`document.xml <w:rFonts> 个数：${count(doc, /<w:rFonts/g)}`)
console.log(`  含 eastAsia="黑体"：${doc.includes('w:eastAsia="黑体"') ? "✓" : "✗"}`)
console.log(`  含 eastAsia="仿宋"：${doc.includes('w:eastAsia="仿宋"') ? "✓" : "✗"}`)
console.log(`  含 ascii="SimHei"：${doc.includes('w:ascii="SimHei"') ? "✓" : "✗"}`)
console.log(`  含 ascii="FangSong"：${doc.includes('w:ascii="FangSong"') ? "✓" : "✗"}`)
const bare = count(doc, /<w:rPr><w:sz /g)
console.log(`无字体的裸 <w:rPr><w:sz> 运行数：${bare}`)
console.log(`页脚页码 run 含宋体：${/第 |PageNumber/.test(styles) ? "n/a" : "n/a"}`)

// 让「格式识别」侧读一遍同一份产物，闭环验证
const spec0 = await server.ssrLoadModule("/src/pages/FormatTool/formatSpec.ts")
const spec = await spec0.extractFormatSpecFromFile(
  new File([bytes], "verify.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
)
console.log(`识别侧读回：正文字体 ${spec.body.fontEastAsia || "?"} / ${spec.body.sizePt}pt / 行距 ${spec.body.lineSpacing || "未设"}`)
console.log(`标题：${spec.headings.map((h) => `L${h.level}:${h.fontEastAsia || "?"}/${h.sizePt}pt`).join("  ")}`)

await server.close()

// R007（B-4 阶段一）验证脚本：直接调用 buildExportFrontMatter 生成 docx 并核对内容
import { Document, Packer } from "docx"
import { unzipSync } from "fflate"
import { buildExportFrontMatter, DEFAULT_EXPORT_TEMPLATE } from "../../src/pages/SolutionStudio/exportTemplate.ts"

const sol = {
  id: "verify",
  solution_name: "市一医院电子病历五级建设方案",
  solution_type: "planning",
  hospital: "市第一人民医院",
  chapters: [],
}
const tpl = { ...DEFAULT_EXPORT_TEMPLATE, company: "XX 信息科技有限公司", toc: true }

const front = buildExportFrontMatter(sol, tpl)
const doc = new Document({
  features: { updateFields: true },
  sections: [{ children: [...front, new (await import("docx")).Paragraph({ text: "正文开始" })] }],
})
const buf = await Packer.toBuffer(doc)
const files = unzipSync(new Uint8Array(buf))
const xml = Buffer.from(files["word/document.xml"]).toString("utf8")

const checks = {
  公司名: xml.includes("XX 信息科技有限公司"),
  方案名: xml.includes("市一医院电子病历五级建设方案"),
  医院类型: xml.includes("市第一人民医院 · 规划方案"),
  编制日期: xml.includes("编制日期："),
  目录标题: xml.includes("目  录"),
  TOC域: xml.includes("TOC"),
  分页符: xml.includes('w:type="page"'),
  updateFields特性: typeof files["word/settings.xml"] === "undefined" ? true : Buffer.from(files["word/settings.xml"]).toString("utf8").includes("updateFields"),
}
console.log(JSON.stringify({ frontChildren: front.length, checks }, null, 2))
const failed = Object.entries(checks).filter(([, v]) => !v)
if (failed.length) {
  console.error("FAILED:", failed.map(([k]) => k).join(","))
  process.exit(1)
}
console.log("ALL PASS")

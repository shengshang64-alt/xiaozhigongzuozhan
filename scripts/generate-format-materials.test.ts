// scripts/generate-format-materials.test.ts — 附五·交付材料生成（模拟真实操作）：
// 用公司模板配置（A4/宋体小四/1.5倍/缩进2字符）对真实导出的投标文件执行「格式刷新」，
// 产出格式刷新后的交付材料到 Downloads/测试材料/。与浏览器 UI 走同一份 refreshDocxFile 代码。
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { refreshDocxFile } from "../src/pages/FormatTool/refreshDocx"
import { DEFAULT_FORMAT_SETTINGS, type FormatSettings } from "../src/pages/BidWorkspace/bidTypes"

const OUT_DIR = "C:/Users/Administrator/Downloads/测试材料"
const SRC_DOCX = "C:/Users/Administrator/Downloads/测试导出-安庆二院智慧医院-投标文件.docx"

/** 公司模板配置（与 format_templates 库内「智业软件文档编辑使用规范V2.1」一致） */
function companySettings(): FormatSettings {
  const s: FormatSettings = JSON.parse(JSON.stringify(DEFAULT_FORMAT_SETTINGS))
  s.paper = "A4"
  s.body = { ...s.body, font: "宋体", size: "小四", lineSpacing: "1.5倍", firstIndent: 2, align: "justify" }
  s.margins = { top: 2.5, bottom: 2.5, left: 2.8, right: 2.6 }
  return s
}

/**
 * 这份测试读的是**操作者本机 Downloads 里的真实投标 docx**（不是仓库内夹具），因此它天然只在
 * 「那台机器 + 那个文件还在」时才有意义。2026-10-21（R63）按仓内既有惯例加 skip 门：
 * 夹具不存在就整块跳过并打印原因——否则在 VM 沙盒 / CI / 换台机器上它会稳定变红，
 * 而这个红既不说明代码坏了，还会把真正的回归淹掉（对照 outlineGuardRealDb.test.ts 的 skipIf）。
 * 文件在时行为完全不变：照样刷格式、照样产出材料、照样断言产物大小。
 */
const HAS_SRC = fs.existsSync(SRC_DOCX)

describe.skipIf(!HAS_SRC)("附五·交付材料生成：格式刷新（模拟真实操作）", () => {
  it("按公司模板刷新投标文件并产出交付材料", async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    expect(fs.existsSync(SRC_DOCX)).toBe(true)
    const buf = fs.readFileSync(SRC_DOCX)
    const file = new File([buf as unknown as BlobPart], "安庆市第二人民医院智慧医院信息化系统项目.docx")
    const settings = companySettings()
    const { blob, notes } = await refreshDocxFile(file, settings, ["font", "heading", "spacing", "page"])
    const outPath = path.join(OUT_DIR, "格式刷新后-安庆二院智慧医院投标文件.docx")
    fs.writeFileSync(outPath, Buffer.from(new Uint8Array(await blob.arrayBuffer())))
    console.log("MATERIAL:", outPath, "| notes:", notes.length)
    expect(fs.existsSync(outPath)).toBe(true)
    expect(fs.statSync(outPath).size).toBeGreaterThan(10000)
  })
})

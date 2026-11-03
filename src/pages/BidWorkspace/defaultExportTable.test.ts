// L3 真产物验证发现的缺陷回归（2026-10-27）
//
// 缺陷：`exportBidDocxDefaults`（format_settings 为空时走的路径）**完全没有表格转换**。
//   正文里的表格（行间用全角空格 U+3000 分列）全部退化成普通段落。
//
// 实测证据（安中医项目 lq5ot8hq8sbqg16，正文 7 个表格块 / 46 行）：
//   修复前导出件：w:tbl = 2 张（都是代码构造的目录表/评分表），正文表格 0 张
//   修复后导出件：w:tbl = 9 张（+7 张正文表格），全角空格残留行 1 → 0
//
// 影响面：18 个有效项目中 **16 个 format_settings 为空**，都会走这条路径。
// 而新建项目默认 format_settings 就是空 —— 等于绝大多数导出都丢表格。
//
// 本测试守两件事：
//   ① 默认路径与格式化路径共用同一套表格判定（不允许两套实现分叉）
//   ② 默认路径确实调用了 buildFmtTable（不是只识别不构建）
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const SRC = fileURLToPath(new URL("./bidFiles.ts", import.meta.url))
const src = readFileSync(SRC, "utf8")

/** 取出某个函数体（从 function 名开始，到下一个顶层 function 前） */
function bodyOf(name: string): string {
  const at = src.indexOf(`function ${name}(`)
  expect(at, `找不到函数 ${name}`).toBeGreaterThan(-1)
  const next = src.indexOf("\nasync function ", at + 10)
  const next2 = src.indexOf("\nfunction ", at + 10)
  const candidates = [next, next2].filter((x) => x > 0)
  const end = candidates.length ? Math.min(...candidates) : src.length
  return src.slice(at, end)
}

describe("exportBidDocxDefaults · 默认导出路径必须有表格转换", () => {
  it("默认路径复用了 createFormatDocxKit 的表格能力（不与 Formatted 分叉）", () => {
    const body = bodyOf("exportBidDocxDefaults")
    expect(body, "默认路径未创建 kit").toContain("createFormatDocxKit")
    expect(body, "默认路径未取 splitTableRow").toContain("splitTableRow")
    expect(body, "默认路径未取 buildFmtTable").toContain("buildFmtTable")
  })

  it("默认路径真的构建了表格（不只是识别）", () => {
    const body = bodyOf("exportBidDocxDefaults")
    expect(body, "识别了却没构建 → 表格仍会退化成段落").toMatch(/buildFmtTable\(block\)/)
  })

  it("表格块判定门槛是「连续 ≥2 行」（单行仍按正文）", () => {
    const body = bodyOf("exportBidDocxDefaults")
    expect(body).toMatch(/block\.length\s*>=\s*2/)
  })

  it("默认路径用 DEFAULT_FORMAT_SETTINGS 作为 kit 的格式来源", () => {
    const body = bodyOf("exportBidDocxDefaults")
    expect(body).toContain("DEFAULT_FORMAT_SETTINGS")
    // 且该常量必须已被导入，否则运行时会 ReferenceError
    // （import 块较长，用一个足够宽的窗口匹配，锚定 from "./bidTypes"）
    expect(src).toMatch(/import\s*\{[\s\S]{0,2000}DEFAULT_FORMAT_SETTINGS[\s\S]{0,2000}\}\s*from\s*"\.\/bidTypes"/)
  })

  it("两条导出路径都不再是「只有 Formatted 会转表格」", () => {
    const defaults = bodyOf("exportBidDocxDefaults")
    const formatted = bodyOf("exportBidDocxFormatted")
    expect(defaults).toContain("buildFmtTable")
    expect(formatted).toContain("buildFmtTable")
  })
})

describe("exportBidDocxDefaults · 页面设置与页码（L3 实测第二处缺陷）", () => {
  it("必须给 downloadDocx 传页面选项（否则纸张/边距用库默认值）", () => {
    const body = bodyOf("exportBidDocxDefaults")
    expect(body, "未传 opts → 用 docx 库默认页面").toMatch(/downloadDocx\(\s*buildExportFileName\([\s\S]{0,200}?children,\s*\{/)
    expect(body).toContain("PAPER_TWIPS")
    expect(body).toContain("cmToTwips")
  })

  it("必须开启页码（投标文件缺页码=格式不符）", () => {
    // 实测：修复前产物 footer 文件 0 个、无 PAGE 域
    const body = bodyOf("exportBidDocxDefaults")
    expect(body, "未传 footerPageNumber → 整份文件没有页码").toContain("footerPageNumber")
    expect(body).toMatch(/footerPageNumber:\s*DEFAULT_FORMAT_SETTINGS\.pageNumber/)
  })

  it("页眉按默认设置（headerFooter=false 时不输出页眉）", () => {
    const body = bodyOf("exportBidDocxDefaults")
    expect(body).toContain("headerText")
    expect(body).toMatch(/headerText:\s*DEFAULT_FORMAT_SETTINGS\.headerFooter/)
  })

  it("目录域跟随默认设置", () => {
    const body = bodyOf("exportBidDocxDefaults")
    expect(body).toMatch(/updateFields:\s*DEFAULT_FORMAT_SETTINGS\.toc/)
  })

  it("默认设置的 pageNumber 必须为 true（否则上面的修复无意义）", async () => {
    const mod = await import("./bidTypes")
    expect(mod.DEFAULT_FORMAT_SETTINGS.pageNumber, "默认必须开页码").toBe(true)
    expect(mod.DEFAULT_FORMAT_SETTINGS.paper).toBe("A4")
  })
})

describe("pageOptsFromFormatSettings · 报告导出必须有页码（L3 实测第三处缺陷）", () => {
  it("fmt 为空时也返回页面选项（不再 undefined）", async () => {
    const mod = await import("./bidFiles")
    const opts = mod.pageOptsFromFormatSettings(null, { pageNumber: true })
    expect(opts, "fmt 为空时不能放弃页面设置").toBeDefined()
    expect(opts?.page, "必须带纸型与边距").toBeDefined()
  })

  it("fmt 为空 + pageNumber=true 时开启页码", async () => {
    const mod = await import("./bidFiles")
    const opts = mod.pageOptsFromFormatSettings(null, { pageNumber: true })
    expect(opts?.footerPageNumber, "报告缺页码=格式不符").toBe(true)
  })

  it("fmt 为空时回落到 DEFAULT_FORMAT_SETTINGS 的纸型与边距", async () => {
    const mod = await import("./bidFiles")
    const types = await import("./bidTypes")
    const opts = mod.pageOptsFromFormatSettings(null, { pageNumber: true })
    // A4 = 11906 x 16838 twips
    expect(opts?.page?.size).toEqual({ width: 11906, height: 16838 })
    // 默认左右边距 3.18cm ≈ 1803 twips
    expect(Math.abs((opts?.page?.margin?.left ?? 0) - 1803)).toBeLessThanOrEqual(2)
    expect(types.DEFAULT_FORMAT_SETTINGS.pageNumber).toBe(true)
  })

  it("pageNumber=false 时不加页码（保留调用方控制权）", async () => {
    const mod = await import("./bidFiles")
    const opts = mod.pageOptsFromFormatSettings(null, { pageNumber: false })
    expect(opts?.footerPageNumber).toBeUndefined()
  })
})

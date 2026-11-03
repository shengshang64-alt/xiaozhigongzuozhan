import { describe, expect, it } from "vitest"
import {
  formatLabel,
  parseAbstractLevels,
  resolveNumFmt,
  resolveParagraphNumbering,
  type NumberingResult,
} from "./numberingResolve"

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
    <w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
  <w:num w:numId="3"><w:abstractNumId w:val="9"/></w:num>
</w:numbering>`

function p(inner: string): string {
  return `<w:p>${inner}</w:p>`
}
function numPr(numId?: string, ilvl?: string): string {
  const parts = [numId ? `<w:numId w:val="${numId}"/>` : "", ilvl ? `<w:ilvl w:val="${ilvl}"/>` : ""]
  return `<w:pPr><w:numPr>${parts.join("")}</w:numPr></w:pPr>`
}

const DOC = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${p(`${numPr("1", "0")}<w:r><w:t>一、数字编号段</w:t></w:r>`)}
${p(`${numPr("2", "0")}<w:r><w:t>项目符号段甲</w:t></w:r>`)}
${p(`${numPr("2", "0")}<w:r><w:t>项目符号段乙</w:t></w:r>`)}
${p(`${numPr("1")}<w:r><w:t>缺 ilvl 的编号段（按 ilvl=0 计）</w:t></w:r>`)}
${p(`${numPr("3", "0")}<w:r><w:t>numId 在 numbering.xml 里查不到</w:t></w:r>`)}
${p(`${numPr(undefined, "1")}<w:r><w:t>只有 ilvl 没有 numId，不构成编号</w:t></w:r>`)}
${p(`<w:r><w:t>普通段落</w:t></w:r>`)}
</w:body></w:document>`

describe("numberingResolve · 编号形式（格式镖师 §11 的只读版）", () => {
  const parts = { "word/numbering.xml": NUMBERING, "word/document.xml": DOC }
  const res: NumberingResult = resolveParagraphNumbering(parts)

  it("只统计带 numId 的段落（只有 ilvl / 无 numPr 的不计）", () => {
    expect(res.numberedParagraphs).toBe(5)
    expect(res.bulletParagraphs).toBe(2)
  })

  it("按 numId→abstractNumId→lvl/w:numFmt 解析出编号形式分布", () => {
    const byFmt = new Map(res.formats.map((f) => [f.format, f.count]))
    expect(byFmt.get("decimal")).toBe(2)
    expect(byFmt.get("bullet")).toBe(2)
    expect(byFmt.get("lowerLetter")).toBeUndefined() // ilvl=1 的定义没被误用
  })

  it("numId 查不到对应定义时如实计入 unresolved，不瞎猜成数字编号", () => {
    expect(res.unresolvedParagraphs).toBe(1)
    expect(res.formats.reduce((a, f) => a + f.count, 0)).toBe(4) // 5 段带编号里 1 段未解析
  })

  it("无 numbering.xml（如项目正文/未启用自动编号）返回全零，不误报", () => {
    const lone = resolveParagraphNumbering({ "word/document.xml": DOC })
    expect(lone).toEqual({ formats: [], numberedParagraphs: 0, bulletParagraphs: 0, unresolvedParagraphs: 0 })
  })

  it("无 document.xml 返回全零", () => {
    expect(resolveParagraphNumbering({ "word/numbering.xml": NUMBERING }).numberedParagraphs).toBe(0)
  })
})

describe("numberingResolve · 取值与展示", () => {
  it("ilvl 缺失/越界时回落到 lvl 0（不猜成 bullet）", () => {
    const numToAbstract = new Map([["1", "0"]])
    const levels = parseAbstractLevels(NUMBERING)
    expect(resolveNumFmt("1", "0", numToAbstract, levels)).toBe("decimal")
    expect(resolveNumFmt("1", "7", numToAbstract, levels)).toBe("decimal")
    expect(resolveNumFmt("1", "1", numToAbstract, levels)).toBe("lowerLetter")
    expect(resolveNumFmt("999", "0", numToAbstract, levels)).toBe("")
  })

  it("formatLabel 只做展示映射，未收录的 numFmt 原样返回", () => {
    expect(formatLabel("bullet")).toBe("项目符号")
    expect(formatLabel("decimal")).toBe("阿拉伯数字")
    expect(formatLabel("someNewFmt")).toBe("someNewFmt")
  })
})
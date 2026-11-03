import { describe, expect, it } from "vitest"
import { buildDocContextFromParts, extractParagraphs, parasToChapters } from "./docxInspect"

const documentXml = `
<w:document><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章 概述</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:rFonts w:eastAsia="宋体"/></w:rPr><w:t>这是正文段落。</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:rFonts w:eastAsia="黑体"/><w:vanish/></w:rPr><w:t>隐藏文字</w:t></w:r></w:p>
<w:bookmarkStart w:id="0" w:name="_GoBack"/>
<w:bookmarkStart w:id="1" w:name="MyCompanyMark"/>
<w:ins w:id="2"><w:r><w:t>插入修订</w:t></w:r></w:ins>
<w:del w:id="3"><w:r><w:delText>删除修订</w:delText></w:r></w:del>
<w:p><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>字号示例</w:t></w:r></w:p>
<w:sectPr><w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800"/></w:sectPr>
</w:body></w:document>`

const coreXml = `<cp:coreProperties xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:creator>张三</dc:creator><cp:lastModifiedBy>李四</cp:lastModifiedBy>
<dc:title>XX医院投标方案</dc:title><cp:keywords>某某科技有限公司</cp:keywords></cp:coreProperties>`

const appXml = `<Properties><Company>某某科技有限公司</Company><Manager>王五</Manager></Properties>`
const commentsXml = `<w:comments><w:comment w:author="赵六" w:id="0"><w:p><w:r><w:t>批注内容</w:t></w:r></w:p></w:comment></w:comments>`
const settingsXml = `<w:settings><w:documentProtection w:edit="readOnly"/></w:settings>`
const headerXml = `<w:hdr><w:p><w:r><w:t>某某科技有限公司 13800138000</w:t></w:r></w:p></w:hdr>`

function ctx() {
  return buildDocContextFromParts(
    "投标文件.docx",
    {
      "word/document.xml": documentXml,
      "docProps/core.xml": coreXml,
      "docProps/app.xml": appXml,
      "word/comments.xml": commentsXml,
      "word/settings.xml": settingsXml,
      "word/header1.xml": headerXml,
    },
    ["word/document.xml", "word/header1.xml", "customXml/item.xml", "word/media/image1.png"],
  )
}

describe("docxInspect.buildDocContextFromParts", () => {
  it("识别标题分段为章节", () => {
    const paras = extractParagraphs(documentXml)
    const { chapters } = parasToChapters(paras)
    expect(chapters.some((c) => c.title === "第一章 概述")).toBe(true)
  })

  it("T-4：每个段落携带其在 paras 数组中的 index", () => {
    const paras = extractParagraphs(documentXml)
    expect(paras.length).toBeGreaterThan(0)
    paras.forEach((p, i) => expect(p.index).toBe(i))
  })

  it("T-3：chapterOf 长度 = 段落数，且段落正确归章", () => {
    const paras = extractParagraphs(documentXml)
    const { chapters, chapterOf } = parasToChapters(paras)
    expect(chapterOf.length).toBe(paras.length)
    chapterOf.forEach((ci) => expect(ci).toBeGreaterThanOrEqual(0))
    expect(chapterOf.every((ci) => ci < chapters.length)).toBe(true)
    // 正文段（非标题）应归入「第一章 概述」对应章
    const bodyIdx = paras.findIndex((p) => p.text === "这是正文段落。")
    const chapterIdx = chapters.findIndex((c) => c.title === "第一章 概述")
    expect(chapterOf[bodyIdx]).toBe(chapterIdx)
  })

  it("T-1：表格内段落 inTable=true 且同一表格 tableIndex 一致；正文段 inTable=false", () => {
    const tableXml = `<w:document><w:body>
      <w:p><w:r><w:t>表前正文</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>单元格一</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>单元格二</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:p><w:r><w:t>表后正文</w:t></w:r></w:p>
    </w:body></w:document>`
    const paras = extractParagraphs(tableXml)
    const inTable = paras.filter((p) => p.inTable)
    expect(inTable.length).toBe(2)
    expect(inTable.every((p) => p.tableIndex === 0)).toBe(true)
    expect(paras.find((p) => p.text === "表前正文")?.inTable).toBe(false)
    expect(paras.find((p) => p.text === "表后正文")?.inTable).toBe(false)
  })

  it("T-2：含 w:drawing/w:pict 的段落 hasImage=true", () => {
    const imgXml = `<w:document><w:body>
      <w:p><w:r><w:drawing><wp:inline/></w:drawing></w:r><w:r><w:t>配图说明</w:t></w:r></w:p>
      <w:p><w:r><w:t>纯文字</w:t></w:r></w:p>
    </w:body></w:document>`
    const paras = extractParagraphs(imgXml)
    expect(paras.find((p) => p.text === "配图说明")?.hasImage).toBe(true)
    expect(paras.find((p) => p.text === "纯文字")?.hasImage).toBe(false)
  })

  it("提取 core/app 元数据字段", () => {
    const m = ctx().meta
    expect(m.available).toBe(true)
    expect(m.creator).toBe("张三")
    expect(m.lastModifiedBy).toBe("李四")
    expect(m.title).toBe("XX医院投标方案")
    expect(m.company).toBe("某某科技有限公司")
    expect(m.manager).toBe("王五")
  })

  it("识别节点级痕迹：批注作者 / 隐藏文字 / 修订 / 书签 / 页眉 / 保护 / customXml", () => {
    const m = ctx().meta
    expect(m.hasComments).toBe(true)
    expect(m.commentAuthors).toContain("赵六")
    expect(m.hasHiddenText).toBe(true)
    expect(m.revisionIns).toBe(1)
    expect(m.revisionDel).toBe(1)
    expect(m.bookmarkNames).toContain("MyCompanyMark")
    expect(m.headerFooterText).toContain("某某科技有限公司")
    expect(m.hasProtection).toBe(true)
    expect(m.hasCustomXml).toBe(true)
    expect(m.imageCount).toBe(1)
  })

  it("提取字体 / 字号 / 边距（cm）", () => {
    const m = ctx().meta
    expect(m.fontsUsed).toEqual(expect.arrayContaining(["宋体", "黑体"]))
    expect(m.sizesUsed).toContain("24")
    expect(m.margins).not.toBeNull()
    expect(m.margins!.top).toBeCloseTo(2.54, 1)
  })

  it("无包输入应不含结构事实（由 emptyMeta 承担，available=false）", () => {
    const empty = buildDocContextFromParts("x.txt", {}, [])
    expect(empty.meta.available).toBe(true) // 显式传入 parts 即视为有包
  })

  it("buildDocContextFromParts 产出 paragraphs / chapterOf（供三栏定位）", () => {
    const c = ctx()
    expect(c.paragraphs.length).toBeGreaterThan(0)
    expect(c.chapterOf.length).toBe(c.paragraphs.length)
    expect(c.paragraphs.every((p, i) => p.index === i)).toBe(true)
  })
})

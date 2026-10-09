import { describe, expect, it } from "vitest"
import { unzipSync, zipSync, strFromU8 } from "fflate"
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx"
import { refreshStylesXml, refreshDocumentXml, refreshDocxFile, removeUnusedStylesXml, collectUsedStyleIds } from "./refreshDocx"
import { DEFAULT_FORMAT_SETTINGS, type FormatSettings } from "@/pages/BidWorkspace/bidTypes"
import type { FormatScope } from "./formatDiff"

// 贴近 Word 实际序列化形态的最小样式表 fixture
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="等线"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="160"/></w:pPr><w:rPr><w:rFonts w:ascii="等线" w:hAnsi="等线" w:eastAsia="等线"/><w:sz w:val="21"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="黑体" w:hAnsi="黑体" w:eastAsia="黑体"/><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
</w:styles>`

const DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>第一章 总体建设方案</w:t></w:r></w:p>
<w:p><w:r><w:t>正文内容保持不变。</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" w:header="851" w:footer="992" w:gutter="0"/><w:cols w:space="425"/></w:sectPr>
</w:body></w:document>`

function cfg(patch?: Partial<FormatSettings>): FormatSettings {
  const s: FormatSettings = JSON.parse(JSON.stringify(DEFAULT_FORMAT_SETTINGS))
  return patch ? { ...s, ...patch } : s
}

const ALL_SCOPES: FormatScope[] = ["font", "heading", "spacing", "page"]

describe("refreshStylesXml · 按模板精确改写样式（R58）", () => {
  it("font 范围：Normal 字体字号改写、首行缩进注入、docDefaults 同步", () => {
    const settings = cfg()
    settings.body.font = "仿宋"
    settings.body.size = "四号" // 14pt → sz 28
    settings.body.firstIndent = 2
    const out = refreshStylesXml(STYLES_XML, settings, ["font"], [])
    const normal = out.slice(out.indexOf('w:styleId="Normal"'))
    expect(normal).toContain('w:eastAsia="仿宋"')
    expect(normal).toContain('<w:sz w:val="28"/>')
    expect(normal).toContain('w:firstLineChars="200"')
    // 缩进 twips = 2 字符 × 14pt × 20
    expect(normal).toContain('w:firstLine="560"')
    const defaults = out.slice(0, out.indexOf("</w:docDefaults>"))
    expect(defaults).toContain('w:eastAsia="仿宋"')
    // heading 范围未勾选 → 标题样式不动
    const h1 = out.slice(out.indexOf('w:styleId="1"'), out.indexOf('w:styleId="2"'))
    expect(h1).toContain('w:ascii="黑体"')
    expect(h1).toContain('<w:sz w:val="32"/>')
  })

  it("spacing 范围：行距与对齐写入 Normal 的 pPr，原 after 属性保留", () => {
    const settings = cfg()
    settings.body.lineSpacing = "1.5倍"
    settings.body.align = "justify"
    const out = refreshStylesXml(STYLES_XML, settings, ["spacing"], [])
    const normal = out.slice(out.indexOf('w:styleId="Normal"'))
    expect(normal).toContain('w:line="360" w:lineRule="auto"')
    expect(normal).toContain('w:after="160"') // 未管理的属性不动
    expect(normal).toContain('<w:jc w:val="both"/>')
  })

  it("固定值行距映射为 exact", () => {
    const settings = cfg()
    settings.body.lineSpacing = "固定值20磅"
    const out = refreshStylesXml(STYLES_XML, settings, ["spacing"], [])
    expect(out).toContain('w:line="400" w:lineRule="exact"')
  })

  it("heading 范围：已有标题样式改字体字号对齐；缺样式的级别记 notes；二号线创建 rPr/jc", () => {
    const settings = cfg()
    settings.heading[0] = { font: "黑体", size: "三号", align: "center" }
    settings.heading[1] = { font: "楷体", size: "小三", align: "left" }
    const notes: string[] = []
    const out = refreshStylesXml(STYLES_XML, settings, ["heading"], notes)
    const h1 = out.slice(out.indexOf('w:styleId="1"'), out.indexOf('w:styleId="2"'))
    expect(h1).toContain('<w:jc w:val="center"/>')
    expect(h1).toContain('<w:sz w:val="32"/>') // 三号 = 16pt
    const h2 = out.slice(out.indexOf('w:styleId="2"'))
    expect(h2).toContain('w:eastAsia="楷体"')
    expect(h2).toContain('<w:jc w:val="left"/>')
    // 只定义了 2 级样式，3-6 级缺 → notes 提示（fixture 只有 2 级）
    expect(notes.some((n) => n.includes("标题3"))).toBe(true)
  })

  it("page 范围：sectPr 纸张与页边距按 cm→twips 改写，其余属性保留", () => {
    const settings = cfg()
    settings.paper = "A4"
    settings.margins = { top: 2.5, bottom: 2.5, left: 2.8, right: 2.8 }
    const out = refreshDocumentXml(DOC_XML, settings, ["page"], [])
    expect(out).toContain('<w:pgSz w:w="11906" w:h="16838"/>')
    expect(out).toContain('w:top="1417"') // 2.5cm
    expect(out).toContain('w:left="1587"') // 2.8cm
    expect(out).toContain('w:header="851"') // 未管理属性不动
    expect(out).toContain("正文内容保持不变。") // 文字 0 改动
  })

  it("scope 全关 → XML 原样返回", () => {
    expect(refreshStylesXml(STYLES_XML, cfg(), [], [])).toBe(STYLES_XML)
    expect(refreshDocumentXml(DOC_XML, cfg(), [], [])).toBe(DOC_XML)
  })
})

describe("refreshDocxFile · 真实 docx 往返（docx 库生成 → 改写 → 解包断言）", () => {
  it("改写后的包仍是合法 zip，styles.xml 带新值，document.xml 文字不变", async () => {
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ text: "第五章 集成平台设计", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun("集成平台采用企业服务总线（ESB）与医疗信息标准相结合的架构。")] }),
        ],
      }],
    })
    const buf = await Packer.toBuffer(doc)
    const file = new File([new Uint8Array(buf)], "原稿.docx")
    const settings = cfg()
    settings.body.font = "仿宋"
    settings.body.size = "四号"
    settings.body.firstIndent = 2
    settings.heading[0] = { font: "黑体", size: "小二", align: "center" }
    settings.margins = { top: 2.5, bottom: 2.5, left: 3, right: 3 }
    const { blob, notes } = await refreshDocxFile(file, settings, ALL_SCOPES)
    expect(blob.size).toBeGreaterThan(1000)
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(zip["word/styles.xml"]).toBeTruthy()
    const styles = strFromU8(zip["word/styles.xml"])
    expect(styles).toContain('w:eastAsia="仿宋"')
    expect(styles).toContain('w:eastAsia="黑体"')
    const docXml = strFromU8(zip["word/document.xml"])
    expect(docXml).toContain("集成平台采用企业服务总线（ESB）与医疗信息标准相结合的架构。")
    expect(docXml).toContain('w:top="1417"')
    expect(docXml).toContain('w:left="1701"')
    // 缺 2-6 级标题样式 → 如实记 notes（docx 库默认模板含更多标题样式则可能不缺）
    expect(Array.isArray(notes)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 附三用户需求（2026-10-07）：导出可选删除未应用的样式定义
// ---------------------------------------------------------------------------

const STYLES_WITH_UNUSED = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
<w:style w:type="character" w:styleId="UnusedChar"><w:name w:val="Unused Char Style"/></w:style>
<w:style w:type="paragraph" w:styleId="UnusedBlock"><w:name w:val="Unused Block"/><w:basedOn w:val="UsedParent"/></w:style>
<w:style w:type="paragraph" w:styleId="UsedParent"><w:name w:val="Used Parent"/></w:style>
</w:styles>`

const DOC_WITH_REFS = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:rPr><w:rStyle w:val="UsedParent"/></w:rPr><w:t>标题</w:t></w:r></w:p>
<w:p><w:r><w:t>正文</w:t></w:r></w:p>
</w:body></w:document>`

describe("removeUnusedStylesXml · 删除未应用的样式（附三）", () => {
  it("删除未被引用的样式；默认样式与被引用样式保留", () => {
    const used = collectUsedStyleIds([DOC_WITH_REFS])
    expect(used.has("1")).toBe(true)
    expect(used.has("UsedParent")).toBe(true)
    const notes: string[] = []
    const out = removeUnusedStylesXml(STYLES_WITH_UNUSED, used, notes)
    expect(out).not.toContain('w:styleId="UnusedChar"')
    expect(out).not.toContain('w:styleId="UnusedBlock"')
    expect(out).toContain('w:styleId="Normal"') // 默认样式保留
    expect(out).toContain('w:styleId="1"') // 被引用保留
    expect(out).toContain('w:styleId="UsedParent"') // 被引用保留
    expect(notes[0]).toContain("已删除 2 个未应用的样式")
  })

  it("继承链级联：被保留样式 basedOn 的父样式即使未被直接引用也保留", () => {
    const used = new Set(["UnusedBlock"]) // 只引用 UnusedBlock，其 basedOn=UsedParent 应级联保留
    const out = removeUnusedStylesXml(STYLES_WITH_UNUSED, used, [])
    expect(out).toContain('w:styleId="UsedParent"')
    expect(out).not.toContain('w:styleId="UnusedChar"')
  })

  it("全部保留时原文返回、零删除备注", () => {
    const used = collectUsedStyleIds([DOC_WITH_REFS])
    used.add("UnusedChar").add("UnusedBlock")
    const notes: string[] = []
    const out = removeUnusedStylesXml(STYLES_WITH_UNUSED, used, notes)
    expect(out).toBe(STYLES_WITH_UNUSED)
    expect(notes).toHaveLength(0)
  })
})

describe("refreshDocxFile · opts.removeUnusedStyles（附三导出选项）", () => {
  it("勾选后导出的 docx 不再含未应用样式；未勾选时保留", async () => {
    const zip: Record<string, Uint8Array> = {
      "word/styles.xml": new TextEncoder().encode(STYLES_WITH_UNUSED),
      "word/document.xml": new TextEncoder().encode(DOC_WITH_REFS),
    }
    const file = new File([zipSync(zip)], "t.docx")
    const withOpt = await refreshDocxFile(file, cfg(), ALL_SCOPES, { removeUnusedStyles: true })
    const outXml = strFromU8(unzipSync(new Uint8Array(await withOpt.blob.arrayBuffer()))["word/styles.xml"])
    expect(outXml).not.toContain('w:styleId="UnusedChar"')
    const withoutOpt = await refreshDocxFile(file, cfg(), ALL_SCOPES)
    const keepXml = strFromU8(unzipSync(new Uint8Array(await withoutOpt.blob.arrayBuffer()))["word/styles.xml"])
    expect(keepXml).toContain('w:styleId="UnusedChar"')
  })
})

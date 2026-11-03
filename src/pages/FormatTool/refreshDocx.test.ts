import { describe, expect, it } from "vitest"
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate"
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx"
import { refreshStylesXml, refreshDocumentXml, refreshDocxFile, removeUnusedStylesXml, collectUsedStyleIds, createRefreshStats } from "./refreshDocx"
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


// ---------------------------------------------------------------------------
// R46（2026-10-14）用户三问之「格式更新到底能不能用」：
// 实测本项目导出的 docx 把格式写死在每个 run 的 <w:rPr> 上、且 styles.xml 无 Normal 样式，
// 只改样式表等于「改了但看不见」。以下用例锁定修复后的行为：
//   ① 缺 Normal 时补建并写入正文格式；
//   ② 默认按范围同步改写文字级 / 段落级直接格式，四项复检 ok；
//   ③ 标题复检按样式块判定级别（Word 序列化的是 "Heading 1" 大写 H，旧实现大小写敏感会误报 fail）；
//   ④ overrideDirectFormat=false 时不改直接格式，并如实提示；
//   ⑤ 文字 0 改动（w:t 逐字一致）；表格内 / 非正文非标题样式段落不碰且计数。
// ---------------------------------------------------------------------------

// 无 Normal 样式 + 格式写死在 run 上 + 表格 + Title 段落（贴近本项目导出物与第三方成稿）
const STYLES_NO_NORMAL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="1"><w:name w:val="Heading 1"/><w:qFormat/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:eastAsia="等线"/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:sz w:val="44"/></w:rPr></w:style>
</w:styles>`

const DOC_DIRECT_FORMAT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:rPr><w:rFonts w:eastAsia="等线"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t>第一章 总体建设方案</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:rFonts w:eastAsia="等线"/><w:sz w:val="24"/></w:rPr><w:t>正文内容保持不变。</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:sz w:val="44"/></w:rPr><w:t>封面标题</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格单元文字</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>
</w:body></w:document>`

function directFormatFixture(): File {
  const zip: Record<string, Uint8Array> = {
    "word/styles.xml": strToU8(STYLES_NO_NORMAL),
    "word/document.xml": strToU8(DOC_DIRECT_FORMAT),
  }
  return new File([zipSync(zip) as unknown as BlobPart], "direct-format.docx")
}

/** 取 document.xml 里第一个含指定文字的段落块，供逐字比对 / 断言 */
function paraOf(docXml: string, text: string): string {
  const i = docXml.indexOf(text)
  const start = docXml.lastIndexOf("<w:p>", i) >= 0 ? docXml.lastIndexOf("<w:p>", i) : docXml.lastIndexOf("<w:p ", i)
  const end = docXml.indexOf("</w:p>", i)
  return docXml.slice(start, end)
}

function settingsForR46(): FormatSettings {
  const s = cfg()
  s.body = { font: "仿宋", size: "四号", firstIndent: 2, align: "justify", lineSpacing: "1.5倍" }
  s.heading[0] = { font: "黑体", size: "三号", align: "center" }
  s.margins = { top: 2.5, bottom: 2.5, left: 3, right: 3 }
  return s
}

// R46 新增纪律：格式刷新的产出物必须是合法 XML。
// 旧实现在「改写 docDefaults 里的 rPr」时会错位替换，产出 <w:docDefaults<w:rPr>… 这类非法 XML，
// 而所有既有断言（只查子串）全都通不过不了——Word 打开才会报「文件已损坏」。这里用 XML 解析器兜住。
function assertWellFormedXml(xml: string, label: string) {
  const stack: string[] = []
  let i = 0
  let problem = ""
  while (i < xml.length && !problem) {
    const lt = xml.indexOf("<", i)
    if (lt < 0) break
    if (xml.startsWith("<!--", lt)) { const e = xml.indexOf("-->", lt + 4); if (e < 0) { problem = "注释未闭合"; break } i = e + 3; continue }
    if (xml.startsWith("<![CDATA[", lt)) { const e = xml.indexOf("]]>", lt + 9); if (e < 0) { problem = "CDATA 未闭合"; break } i = e + 3; continue }
    if (xml.startsWith("<?", lt) || xml.startsWith("<!", lt)) { const e = xml.indexOf(">", lt); if (e < 0) { problem = "声明未闭合"; break } i = e + 1; continue }
    const isClose = xml[lt + 1] === "/"
    let k = lt + 1
    let quote = ""
    for (; k < xml.length; k++) {
      const ch = xml[k]
      if (quote) { if (ch === quote) quote = ""; continue }
      if (ch === `"` || ch === "'") { quote = ch; continue }
      if (ch === ">") break
    }
    if (k >= xml.length) { problem = "标签未闭合（缺 >）"; break }
    const body = xml.slice(lt + 1, k)
    const selfClose = !isClose && body.endsWith("/")
    const core = (isClose ? body.slice(1) : selfClose ? body.slice(0, -1) : body)
    const m = /^([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*$/.exec(core)
    if (!m) { problem = "标签形态非法（名字/属性不合法）：<" + body.slice(0, 60) + ">"; break }
    const name = m[1]
    if (isClose) {
      const top = stack.pop()
      if (top !== name) { problem = "闭合标签不匹配：期望 </" + (top ?? "无") + ">，实际 </" + name + ">"; break }
    } else if (!selfClose) {
      stack.push(name)
    }
    i = k + 1
  }
  if (!problem && stack.length) problem = "以下标签未闭合：" + stack.slice(-3).join(", ")
  expect(problem, label + " 不是合法 XML：" + problem).toBe("")
}
const STYLES_WITH_DOCDEFAULTS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="等线"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:rFonts w:eastAsia="等线"/><w:sz w:val="21"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="1"><w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
</w:styles>`

describe("refreshDocxFile · R46 直接格式改写（格式写死在文字上的文档）", () => {
  it("默认覆盖：四项复检 4/4 ok，Normal 补建，文字 0 改动，表格/封面段落受保护", async () => {
    const { blob, notes, report } = await refreshDocxFile(directFormatFixture(), settingsForR46(), ALL_SCOPES)
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const docXml = strFromU8(zip["word/document.xml"])
    const stylesXml = strFromU8(zip["word/styles.xml"])

    // ⓪ 产出物必须是合法 XML（旧实现在 docDefaults 改写处错位替换，会产出非法 XML）
    assertWellFormedXml(stylesXml, "styles.xml")
    assertWellFormedXml(docXml, "document.xml")

    // ① 缺 Normal → 补建并写入正文格式
    expect(report.direct.normalInjected).toBe(true)
    expect(stylesXml).toContain('w:styleId="Normal"')
    expect(notes.some((n) => n.includes("Normal"))).toBe(true)

    // ② 正文 run 文字级字体字号已改写（等线/24 → 仿宋/28）
    const bodyPara = paraOf(docXml, "正文内容保持不变。")
    expect(bodyPara).toContain('w:eastAsia="仿宋"')
    expect(bodyPara).toContain('<w:sz w:val="28"/>')
    expect(bodyPara).not.toContain('w:sz w:val="24"')
    expect(bodyPara).toContain('w:firstLine="560"') // 2 字符 × 14pt × 20

    // ③ 标题 run 文字级改写（等线/24 → 黑体/32）+ 标题样式块级别复检（"Heading 1" 大写 H）
    const headingPara = paraOf(docXml, "第一章 总体建设方案")
    expect(headingPara).toContain('w:eastAsia="黑体"')
    expect(headingPara).toContain('<w:sz w:val="32"/>')

    // ④ 四项复检全 ok（含行距/页边距走直接格式与 sectPr）
    expect(report.slots.bodyFont.status).toBe("ok")
    expect(report.slots.heading.status).toBe("ok")
    expect(report.slots.lineSpacing.status).toBe("ok")
    expect(report.slots.pageMargin.status).toBe("ok")
    expect(report.okCount).toBe(4)
    expect(report.totalCount).toBe(4)
    expect(docXml).toContain('w:top="1417"')

    // ⑤ 统计如实
    expect(report.direct.bodyRuns).toBeGreaterThanOrEqual(1)
    expect(report.direct.headingRuns).toBeGreaterThanOrEqual(1)
    expect(report.direct.spacingParas).toBeGreaterThanOrEqual(1)
    expect(report.direct.protectedParas).toBeGreaterThanOrEqual(2) // 表格 1 段 + Title 1 段
    expect(report.direct.overriddenSizes).toContain(12)

    // ⑥ 文字 0 改动，逐字一致；受保护段落原样
    expect(report.textBefore).toBe(report.textAfter)
    expect(docXml).toContain("正文内容保持不变。")
    expect(docXml).toContain("表格单元文字")
    expect(paraOf(docXml, "表格单元文字")).not.toContain("仿宋")
    expect(paraOf(docXml, "封面标题")).toContain('<w:sz w:val="44"/>')
  })

  it("overrideDirectFormat=false：不改直接格式，如实提示「可能看起来没变」", async () => {
    const { blob, notes, report } = await refreshDocxFile(directFormatFixture(), settingsForR46(), ALL_SCOPES, {
      overrideDirectFormat: false,
    })
    const docXml = strFromU8(unzipSync(new Uint8Array(await blob.arrayBuffer()))["word/document.xml"])
    // 正文 run 保持原样（等线/24），未被模板字体字号覆盖
    expect(paraOf(docXml, "正文内容保持不变。")).toContain('<w:sz w:val="24"/>')
    expect(docXml).not.toContain('w:eastAsia="仿宋"')
    expect(report.direct.bodyRuns).toBe(0)
    expect(report.direct.headingRuns).toBe(0)
    expect(notes.some((n) => n.includes("覆盖文字级直接格式"))).toBe(true)
  })

  it("无 pStyle 但带 outlineLvl 的段落按标题处理；spacing 未勾选时不动行距", async () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>无样式的一级标题</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>正文</w:t></w:r></w:p>
</w:body></w:document>`
    const ctx = { stats: createRefreshStats() }
    const st = settingsForR46()
    const out = refreshDocumentXml(docXml, st, ["heading"], [], ctx)
    expect(paraOf(out, "无样式的一级标题")).toContain('w:eastAsia="黑体"')
    expect(ctx.stats.headingRuns).toBe(1)
    // spacing 未勾选 → 正文字体不动、行距不动
    expect(paraOf(out, "正文</w:t>")).toContain('<w:sz w:val="24"/>')
    expect(out).not.toContain("<w:spacing")
  })

  it("无样式但大字号居中（封面形态）受保护：字体字号对齐都不改", async () => {
    // 模拟真实标书封面：无 pStyle，26pt（52）字号 + 居中对齐，无缩进
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:rPr><w:sz w:val="52"/><w:rFonts w:eastAsia="华文彩云"/></w:rPr><w:jc w:val="center"/><w:t>封面标题</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>正文</w:t></w:r></w:p>
</w:body></w:document>`
    const ctx = { stats: createRefreshStats() }
    const st = settingsForR46()
    const out = refreshDocumentXml(docXml, st, ALL_SCOPES, [], ctx)
    // 封面段落保持原样：华文彩云/52pt/居中不动
    const coverPara = paraOf(out, "封面标题")
    expect(coverPara).toContain('<w:sz w:val="52"/>')
    expect(coverPara).toContain('w:eastAsia="华文彩云"')
    expect(coverPara).toContain('<w:jc w:val="center"/>')
    expect(ctx.stats.protectedParas).toBeGreaterThanOrEqual(1)
    // 正文正常改写
    const bodyPara = paraOf(out, "正文")
    expect(bodyPara).toContain('w:eastAsia="仿宋"')
    expect(bodyPara).toContain('<w:sz w:val="28"/>')
  })

  it("无样式但普通字号左对齐正文不受保护：正常改写", async () => {
    // 模拟普通正文：无 pStyle，12pt（24），左对齐，无缩进
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:rPr><w:sz w:val="24"/><w:rFonts w:eastAsia="等线"/></w:rPr><w:jc w:val="left"/><w:t>普通正文</w:t></w:r></w:p>
</w:body></w:document>`
    const ctx = { stats: createRefreshStats() }
    const st = settingsForR46()
    const out = refreshDocumentXml(docXml, st, ALL_SCOPES, [], ctx)
    // 正文被改写
    expect(paraOf(out, "普通正文")).toContain('w:eastAsia="仿宋"')
    expect(paraOf(out, "普通正文")).toContain('<w:sz w:val="28"/>')
  })

  it("含图片的段落受保护：图注/图形内文字不被改写", () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="1" cy="1"/></wp:inline></w:drawing></w:r></w:p>
<w:p><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>普通正文</w:t></w:r></w:p>
</w:body></w:document>`
    const ctx = { stats: createRefreshStats() }
    const out = refreshDocumentXml(docXml, settingsForR46(), ALL_SCOPES, [], ctx)
    expect(out).toContain("<w:drawing>")
    expect(ctx.stats.protectedParas).toBeGreaterThanOrEqual(1)
    expect(paraOf(out, "普通正文")).toContain('w:eastAsia="仿宋"')
  })

  it("空白段落受保护：不补首行缩进、不加行距，避免封面版式被撑乱", () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>正文</w:t></w:r></w:p>
</w:body></w:document>`
    const ctx = { stats: createRefreshStats() }
    const out = refreshDocumentXml(docXml, settingsForR46(), ALL_SCOPES, [], ctx)
    // 空白段不出现缩进注入
    const emptyIdx = out.indexOf("<w:t xml:space=\"preserve\"> </w:t>")
    const before = out.slice(0, emptyIdx)
    const lastPara = before.slice(before.lastIndexOf("<w:p>"), before.lastIndexOf("<w:p>") + 200)
    expect(lastPara).not.toContain("w:firstLine")
    expect(ctx.stats.protectedParas).toBeGreaterThanOrEqual(1)
  })

  it("多节文档：封面节保留 A4 原边距、正文节被改写后，页面复检必须 ok（不能取第一个 sectPr 误报）", async () => {
    // 真实形态：封面节 sectPr 在前（旧边距 1440），正文节 sectPr 在后（将被改写）
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>封面</w:t></w:r></w:p>
<w:p><w:pPr><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800"/></w:sectPr></w:pPr></w:p>
<w:p><w:r><w:t>正文</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800"/></w:sectPr>
</w:body></w:document>`
    const stylesXml = STYLES_XML
    const zip = zipSync({
      "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`),
      "word/document.xml": strToU8(docXml),
      "word/styles.xml": strToU8(stylesXml),
    })
    const file = new File([new Uint8Array(zip)], "多节文档.docx")
    const r = await refreshDocxFile(file, settingsForR46(), ["page"])
    const outDoc = strFromU8(unzipSync(new Uint8Array(await r.blob.arrayBuffer()))["word/document.xml"])
    const settings = settingsForR46()
    const lastSect = [...outDoc.matchAll(/<w:sectPr(?:\s[^>]*?)?>[\s\S]*?<\/w:sectPr>/g)].pop()?.[0] ?? ""
    expect(lastSect).toContain(`w:top="${Math.round(settings.margins.top * 566.928)}"`)
    // 第一个 sectPr（封面节）保持原值
    expect(outDoc.indexOf('w:top="1440"')).toBeLessThan(outDoc.indexOf(`w:top="${Math.round(settings.margins.top * 566.928)}"`))
    // 复检必须与改写同口径：ok
    expect(r.report.slots.pageMargin.status).toBe("ok")
  })
})

// ---------------------------------------------------------------------------
// R46 追加：docDefaults 改写路径的合法性与「正常路径」回归
// 旧实现在改写 docDefaults 内 rPr 时把 rprd.text 的相对偏移直接加到 dd.start 上，
// 会错位替换（吃掉 <w:rPrDefault> 开标签、留下重复 <w:rPr>）→ 产出非法 XML，
// 而当时所有断言都只查子串，全部通过。以下用例是这条链路的守门人。
// ---------------------------------------------------------------------------


describe("refreshStylesXml · R46 docDefaults 改写合法性与补建", () => {
  it("docDefaults 已存在：rPr 就地改写，产出仍是合法 XML", () => {
    const st = settingsForR46()
    const notes: string[] = []
    const out = refreshStylesXml(STYLES_WITH_DOCDEFAULTS, st, ["font", "spacing"], notes)
    assertWellFormedXml(out, "styles.xml")
    const dd = out.slice(out.indexOf("<w:docDefaults>"), out.indexOf("</w:docDefaults>"))
    // 只应剩一个 rPr；rPrDefault 开标签必须还在（旧实现会把它吃掉）
    expect(dd.match(/<w:rPr>/g) ?? []).toHaveLength(1)
    expect(dd).toContain("<w:rPrDefault>")
    expect(dd).toContain('w:eastAsia="仿宋"')
    expect(dd).toContain('<w:sz w:val="28"/>')
    // 未被管理的属性 / 部件原样保留
    expect(dd).toContain('w:line="259"')
    expect(out).toContain('w:styleId="Normal"')
    expect(out).toContain('w:styleId="1"')
    expect(out.endsWith("</w:styles>")).toBe(true)
  })

  it("完全没有 docDefaults / Normal：两者都补建、样式表仍合法，且补建的 Normal 不会被丢弃", () => {
    const ctx = { stats: createRefreshStats() }
    const out = refreshStylesXml(STYLES_NO_NORMAL, settingsForR46(), ["font", "spacing"], [], ctx)
    assertWellFormedXml(out, "styles.xml")
    expect(ctx.stats.normalInjected).toBe(true)
    expect(out).toContain("<w:docDefaults>")
    expect(out).toContain("<w:rPrDefault>")
    expect(out).toContain('w:styleId="Normal"')
    expect(out).toContain('w:eastAsia="仿宋"')
    // 落在 styles 根节点内（旧实现 return result 会把补建样式整块丢掉）
    expect(out.indexOf('w:styleId="Normal"')).toBeGreaterThan(-1)
    expect(out.indexOf('w:styleId="Normal"')).toBeLessThan(out.indexOf("</w:styles>"))
  })
})
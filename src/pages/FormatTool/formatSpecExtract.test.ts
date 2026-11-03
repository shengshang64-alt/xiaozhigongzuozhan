// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { zipSync, strToU8 } from "fflate"
import { extractFormatSpecFromFile, specToFormatSettings } from "./formatSpec"

/**
 * R46：本系统导出的 docx 把格式写死在每个 run 上（styles.xml 无正文样式、docDefaults 为空），
 * 识别侧必须能按「文字级抽样」推定字体/字号，并在原文档确实没写字体时如实说明。
 * 这里用最小 OOXML fixture 钉住这两条口径（DOMParser 需 jsdom）。
 */
function makeFile(stylesXml: string | null, docXml: string): File {
  const entries: Record<string, Uint8Array> = { "word/document.xml": strToU8(docXml) }
  if (stylesXml) entries["word/styles.xml"] = strToU8(stylesXml)
  const zip = zipSync(entries)
  return new File([zip], "样本.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

/** 无正文样式、docDefaults 为空——本系统导出物的真实形态 */
const STYLES_NO_NORMAL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}><w:docDefaults><w:rPrDefault/><w:pPrDefault/></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
</w:styles>`

function doc(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>${inner}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>`
}

const HEAD = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/><w:rFonts w:eastAsia="黑体" w:ascii="SimHei" w:hAnsi="SimHei"/></w:rPr><w:t>第1章 总体方案</w:t></w:r></w:p>'

describe("extractFormatSpecFromFile · 文字级抽样（R46）", () => {
  it("文字上写了字体：抽样推定字体/字号并标注来源", async () => {
    const body = '<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:eastAsia="仿宋" w:ascii="FangSong" w:hAnsi="FangSong"/><w:sz w:val="24"/></w:rPr><w:t>这是正文内容，用于抽样推定字体与字号。</w:t></w:r></w:p>'
    const spec = await extractFormatSpecFromFile(makeFile(STYLES_NO_NORMAL, doc(HEAD + body)))
    expect(spec.bodySource).toBe("sampled")
    expect(spec.body.fontEastAsia).toBe("仿宋")
    expect(spec.body.sizePt).toBe(12)
    expect(spec.headings[0].fontEastAsia).toBe("黑体")
    const notes = specToFormatSettings(spec).notes.join(" | ")
    expect(notes).toContain("抽样推定")
    expect(notes).not.toContain("没有写入字体信息")
  })

  it("整个文档没有字体信息：不臆造字体，如实提示按系统默认", async () => {
    const body = '<w:p><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>本段文字只有字号，没有字体。</w:t></w:r></w:p>'
    const head = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:sz w:val="32"/></w:rPr><w:t>第1章 只有字号</w:t></w:r></w:p>'
    const spec = await extractFormatSpecFromFile(makeFile(STYLES_NO_NORMAL, doc(head + body)))
    expect(spec.body.fontEastAsia).toBe("")
    expect(spec.headings.every((h) => !h.fontEastAsia)).toBe(true)
    const notes = specToFormatSettings(spec).notes.join(" | ")
    expect(notes).toContain("没有写入字体信息")
    expect(notes).toContain("标题字体未被原文档写入")
  })

  it("损坏的 zip：抛错并给可读提示", async () => {
    const bad = new File([new Uint8Array([1, 2, 3, 4, 5])], "坏文件.docx")
    await expect(extractFormatSpecFromFile(bad)).rejects.toThrow()
  })
})

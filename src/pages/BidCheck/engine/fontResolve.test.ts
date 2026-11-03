import { describe, expect, it } from "vitest"
import {
  containsCjk,
  isSameFont,
  normalizeFontName,
  parseDocDefaultFont,
  parseStyleDefs,
  readRFonts,
  resolveEffectiveFonts,
  resolveStyleFont,
} from "./fontResolve"

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="宋体" w:eastAsia="宋体" w:hAnsi="宋体"/><w:sz w:val="28"/></w:rPr></w:rPrDefault>
    <w:pPrDefault/>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/><w:rPr><w:rFonts w:eastAsia="宋体"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="a"/><w:pPr><w:rPr><w:rFonts w:eastAsia="宋体"/></w:rPr></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Heading1"/></w:style>
  <w:style w:type="character" w:styleId="Quote"><w:rPr><w:rFonts w:eastAsia="仿宋"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Loop1"><w:basedOn w:val="Loop2"/></w:style>
  <w:style w:type="paragraph" w:styleId="Loop2"><w:basedOn w:val="Loop1"/></w:style>
</w:styles>`

function p(inner: string, pStyle?: string): string {
  const style = pStyle ? `<w:pPr><w:pStyle w:val="${pStyle}"/></w:pPr>` : ""
  return `<w:p>${style}${inner}</w:p>`
}
function run(text: string, rPr = ""): string {
  return `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`
}
function doc(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`
}

describe("fontResolve · 别名归一（格式镖师 §9.3）", () => {
  it("中文名与英文名归一为同一字体", () => {
    expect(normalizeFontName("SimSun")).toBe("宋体")
    expect(normalizeFontName(" 宋体 ")).toBe("宋体")
    expect(normalizeFontName("Songti SC")).toBe("宋体")
    expect(normalizeFontName("仿宋_GB2312")).toBe("仿宋")
    expect(normalizeFontName("Microsoft YaHei")).toBe("微软雅黑")
    expect(normalizeFontName("")).toBe("")
  })

  it("未收录字体原样返回（不瞎猜成某个中文字体）", () => {
    expect(normalizeFontName("SomeUnknownFont")).toBe("SomeUnknownFont")
  })

  it("isSameFont 认别名，不同字体判不同", () => {
    expect(isSameFont("SimSun", "宋体")).toBe(true)
    expect(isSameFont("宋体-简", "SimSun")).toBe(true)
    expect(isSameFont("黑体", "宋体")).toBe(false)
    expect(isSameFont("", "宋体")).toBe(false)
  })
})

describe("fontResolve · 继承链解析（格式镖师 §9.1）", () => {
  const parts = { "word/styles.xml": STYLES, "word/document.xml": doc(
    [
      p(run("中文标题"), "Heading1"), // 段样式 Heading1 → 黑体
      p(run("正文文字自然段")), // 无 pStyle → docDefaults/默认样式 → 宋体
      p(run("引用文字", `<w:rPr><w:rFonts w:eastAsia="仿宋"/></w:rPr>`)), // run 自身 → 仿宋
      p(run("Hello World")), // 无中文 → 不计入
      p(run("中文被设成Arial", `<w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Arial"/></w:rPr>`)), // 占位字体不采信 → 上溯 宋体
      p(run("二级标题文字"), "Heading2"), // basedOn 链 → 黑体
    ].join(""),
  ) }

  const res = resolveEffectiveFonts(parts)

  it("只统计含中文的 run，且丢弃非中文 run", () => {
    expect(res.cjkRuns).toBe(5)
    expect(res.usages.find((u) => u.font === "Hello World")).toBeUndefined()
  })

  it("继承自文档默认/样式/Run 的生效字体分别正确归集", () => {
    const byFont = new Map(res.usages.map((u) => [u.font, u.count]))
    expect(byFont.get("宋体")).toBe(2) // 无 pStyle 的正文（默认样式 a）+ Arial 占位回退后上溯
    expect(byFont.get("黑体")).toBe(2) // Heading1 + Heading2（沿 basedOn 继承）
    expect(byFont.get("仿宋")).toBe(1) // run 自身 rFonts
    expect(res.unresolvedRuns).toBe(0) // 本例所有含中文 run 都能沿继承链取到字体
    expect([...byFont.values()].reduce((a, b) => a + b, 0)).toBe(res.cjkRuns) // 归集总数 = 含中文 run 数
  })

  it("分布按命中数降序，且带首处文本样本", () => {
    const counts = res.usages.map((u) => u.count)
    // 降序（允许并列）；不依赖并列时的先后（受中文排序规则影响）
    for (let i = 1; i < counts.length; i += 1) expect(counts[i - 1]).toBeGreaterThanOrEqual(counts[i])
    const song = res.usages.find((u) => u.font === "宋体")!
    expect(song.sample).toContain("正文文字")
    expect(song.sample.length).toBeLessThanOrEqual(20)
  })

  it("无 styles.xml（继承链全断）时不计成字体，而是如实上报未解析数", () => {
    const lone = resolveEffectiveFonts({ "word/document.xml": doc(p(run("中文无字体"))) })
    expect(lone.usages).toEqual([])
    expect(lone.cjkRuns).toBe(1)
    expect(lone.unresolvedRuns).toBe(1)
  })

  it("无 document.xml 时返回空结果（pdf/项目正文输入不误报）", () => {
    expect(resolveEffectiveFonts({})).toEqual({ usages: [], cjkRuns: 0, unresolvedRuns: 0 })
  })
})

describe("fontResolve · 小工具", () => {
  it("containsCjk 只认中日韩表意字符", () => {
    expect(containsCjk("中文")).toBe(true)
    expect(containsCjk("English 123")).toBe(false)
    expect(containsCjk("")).toBe(false)
  })

  it("readRFonts 兼容自闭合与成对写法", () => {
    expect(readRFonts(`<w:rFonts w:ascii="A" w:eastAsia="宋体" w:hAnsi="H"/>`).eastAsia).toBe("宋体")
    expect(readRFonts(`<w:rPr><w:rFonts w:eastAsia="黑体"></w:rFonts></w:rPr>`).eastAsia).toBe("黑体")
    expect(readRFonts(`<w:rPr><w:b/></w:rPr>`)).toEqual({ eastAsia: "", ascii: "", hAnsi: "" })
  })

  it("parseDocDefaultFont 取 docDefaults 的东亚字体优先", () => {
    expect(parseDocDefaultFont(STYLES)).toBe("宋体")
    expect(parseDocDefaultFont("<w:styles/>")).toBe("")
  })

  it("resolveStyleFont 沿 basedOn 上溯，且成环时不死循环", () => {
    const styles = parseStyleDefs(STYLES)
    expect(resolveStyleFont(styles, "Heading2")).toBe("黑体")
    expect(resolveStyleFont(styles, "Quote")).toBe("仿宋")
    expect(resolveStyleFont(styles, "Loop1")).toBe("")
    expect(resolveStyleFont(styles, "NoSuchStyle")).toBe("")
  })
})

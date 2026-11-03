import { describe, expect, it } from "vitest"
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import { buildFidelityDeck, inspectFidelityTemplate, inspectFidelityTemplateDetailed, pickFidelitySamples } from "./templateFidelity.ts"

// ---------------------------------------------------------------------------
// R182 切片一（模板母版/版式级保真引擎）单测：
// 合成最小 OOXML 模板（真实部件名与关系结构），覆盖 happy path / 样式模板复用 /
// XML 转义 / 无占位符回退 / 黑名单关系剔除 / notes 关系清理 / 各类诚实降级。
// 保真算法的端到端合法性已由 R181 PoC-2 + python-pptx 离线复核（评估报告留档）。
// ---------------------------------------------------------------------------

const SLIDE_CT = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

const MASTER = "<p:sldMaster>MARKER-MASTER</p:sldMaster>"
const LAYOUT = "<p:sldLayout>MARKER-LAYOUT</p:sldLayout>"
const THEME = "<a:theme>MARKER-THEME</a:theme>"

function spWithPh(phType: string, oldText: string, extra = ""): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="${phType}"/></p:nvPr></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="l"/><a:r><a:rPr lang="zh-CN" sz="1800"/><a:t>${oldText}</a:t></a:r></a:p></p:txBody>${extra}</p:sp>`
  )
}

/** 版式克隆的正文占位符形态：type 缺省（规范默认 body），只写 idx */
function spBarePh(oldText: string): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="B"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:p><a:r><a:t>${oldText}</a:t></a:r></a:p></p:txBody></p:sp>`
  )
}

function spNoPh(oldText: string): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="X"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:p><a:r><a:rPr b="1"/><a:t>${oldText}</a:t></a:r></a:p></p:txBody></p:sp>`
  )
}

function slideDoc(shapes: string): string {
  return `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`
}

type Opt = {
  slide1BodyPh?: boolean
  /** 第 2 页正文占位符写成裸 `<p:ph idx="1"/>`（type 缺省） */
  bareBody?: boolean
  withPh?: boolean
  notes?: boolean
  notesMaster?: boolean
  chart?: boolean
  chartBoth?: boolean
  image?: boolean
}

function synth(o: Opt = {}): Uint8Array {
  const withPh = o.withPh !== false
  const shapes = (n: string) =>
    withPh
      ? `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-CN" sz="4000" b="1"/><a:t>旧标题${n}</a:t></a:r></a:p></p:txBody></p:sp>` +
        (o.slide1BodyPh
          ? `<p:sp><p:nvSpPr><p:cNvPr id="3" name="B"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:pPr marL="216000"/><a:r><a:rPr lang="zh-CN" sz="1600"/><a:t>旧正文${n}</a:t></a:r></a:p></p:txBody></p:sp>`
          : "")
      : spNoPh("旧标题" + n) + spNoPh("旧正文" + n)
  const slide1 = slideDoc(shapes("1"))
  const slide2 = withPh
    ? slideDoc(spWithPh("title", "旧标题2") + (o.bareBody ? spBarePh("旧正文2") : spWithPh("body", "旧正文2")))
    : slideDoc(spNoPh("旧标题2") + spNoPh("旧正文2"))
  let rel1 = `<Relationship Id="rId1" Type="${REL_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`
  if (o.notes) rel1 += `<Relationship Id="rId2" Type="${REL_NS}/notesSlide" Target="../notesSlides/notesSlide1.xml"/>`
  if (o.chart || o.chartBoth) rel1 += `<Relationship Id="rId2" Type="${REL_NS}/chart" Target="../charts/chart1.xml"/>`
  if (o.image) rel1 += `<Relationship Id="rId2" Type="${REL_NS}/image" Target="../media/image1.png"/>`
  let rel2 = `<Relationship Id="rId1" Type="${REL_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`
  if (o.chartBoth) rel2 += `<Relationship Id="rId2" Type="${REL_NS}/chart" Target="../charts/chart1.xml"/>`
  const ct =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>` +
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>` +
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
    `<Override PartName="/ppt/slides/slide1.xml" ContentType="${SLIDE_CT}"/>` +
    `<Override PartName="/ppt/slides/slide2.xml" ContentType="${SLIDE_CT}"/>` +
    (o.notesMaster
      ? `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>`
      : "") +
    `</Types>`
  const pres =
    `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
    `<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>`
  const presRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${REL_NS}/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
    `<Relationship Id="rId2" Type="${REL_NS}/slide" Target="slides/slide1.xml"/>` +
    `<Relationship Id="rId3" Type="${REL_NS}/slide" Target="slides/slide2.xml"/>` +
    `</Relationships>`
  const map: Record<string, string> = {
    "[Content_Types].xml": ct,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
    "ppt/presentation.xml": pres,
    "ppt/_rels/presentation.xml.rels": presRels,
    "ppt/slideMasters/slideMaster1.xml": MASTER,
    "ppt/slideLayouts/slideLayout1.xml": LAYOUT,
    "ppt/theme/theme1.xml": THEME,
    "ppt/slides/slide1.xml": slide1,
    "ppt/slides/_rels/slide1.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel1}</Relationships>`,
    "ppt/slides/slide2.xml": slide2,
    "ppt/slides/_rels/slide2.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel2}</Relationships>`,
  }
  if (o.notesMaster) {
    map["ppt/notesMasters/notesMaster1.xml"] = "<p:notesMaster>NOTES-MASTER</p:notesMaster>"
    map["ppt/notesMasters/_rels/notesMaster1.xml.rels"] =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_NS}/theme" Target="../theme/theme1.xml"/></Relationships>`
  }
  if (o.notes) {
    map["ppt/notesSlides/notesSlide1.xml"] = "<p:notesSlide>NOTES</p:notesSlide>"
    map["ppt/notesSlides/_rels/notesSlide1.xml.rels"] =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL_NS}/slide" Target="../slides/slide1.xml"/>` +
      `<Relationship Id="rId2" Type="${REL_NS}/notesMaster" Target="../notesMasters/notesMaster1.xml"/>` +
      `</Relationships>`
  }
  const entries: Record<string, Uint8Array> = {}
  for (const k of Object.keys(map)) entries[k] = strToU8(map[k])
  return zipSync(entries, { level: 0 })
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes)
}

describe("buildFidelityDeck（happy path）", () => {
  const tmpl = synth({ slide1BodyPh: false })
  const r = buildFidelityDeck(tmpl, [
    { title: "封面页" },
    { title: "方案页", lines: ["一、现状", "二、目标"] },
  ])

  it("返回 ok 并报告样张选择", () => {
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.titleSample).toBe(1)
    expect(r.bodySample).toBe(2)
    expect(r.slideCount).toBe(2)
  })

  it("母版/版式/主题逐字节保留，产物只含生成页", () => {
    if (!r.ok) return
    const out = unzip(r.bytes)
    expect(strFromU8(out["ppt/slideMasters/slideMaster1.xml"])).toBe(MASTER)
    expect(strFromU8(out["ppt/slideLayouts/slideLayout1.xml"])).toBe(LAYOUT)
    expect(strFromU8(out["ppt/theme/theme1.xml"])).toBe(THEME)
    expect(out["ppt/slides/slide3.xml"]).toBeUndefined()
    expect(strFromU8(out["ppt/slides/slide1.xml"])).toContain("封面页")
    expect(strFromU8(out["ppt/slides/slide1.xml"])).not.toContain("旧标题1")
  })

  it("生成页 rels 沿用样张的版式引用", () => {
    if (!r.ok) return
    const out = unzip(r.bytes)
    expect(strFromU8(out["ppt/slides/_rels/slide1.xml.rels"])).toContain("slideLayout1.xml")
    expect(strFromU8(out["ppt/slides/_rels/slide2.xml.rels"])).toContain("slideLayout1.xml")
  })

  it("presentation.xml sldIdLst 与 rels 一一对应且无悬空", () => {
    if (!r.ok) return
    const out = unzip(r.bytes)
    const pres = strFromU8(out["ppt/presentation.xml"])
    expect((pres.match(/<p:sldId /g) || []).length).toBe(2)
    const presRels = strFromU8(out["ppt/_rels/presentation.xml.rels"])
    expect((presRels.match(/Type="[^"]*\/slide"/g) || []).length).toBe(2)
    const targets = [...presRels.matchAll(/Type="[^"]*\/slide" Target="([^"]+)"/g)].map((m) => "ppt/" + m[1])
    for (const t of targets) expect(out[t]).toBeDefined()
    // 旧 rId2/rId3 不复用于 slide
    const ids = [...presRels.matchAll(/Id="(rId\d+)" Type="[^"]*\/slide"/g)].map((m) => m[1])
    expect(new Set(ids).size).toBe(2)
    const sldLst = /<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/.exec(pres)?.[1] ?? ""
    const listIds = [...sldLst.matchAll(/r:id="(rId\d+)"/g)].map((m) => m[1])
    expect([...listIds].sort()).toEqual([...ids].sort())
  })

  it("[Content_Types].xml slide Override 恰好 K 条不重复", () => {
    if (!r.ok) return
    const ct = strFromU8(unzip(r.bytes)["[Content_Types].xml"])
    const ov = ct.match(/PartName="\/ppt\/slides\/slide\d+\.xml"/g) || []
    expect(ov.length).toBe(2)
    expect(new Set(ov).size).toBe(2)
  })

  it("K≠模板页数(3 页)时重建清单真正写入产物：sldIdLst 与 rels 指向全部生成页", () => {
    // 直接锁死 fix3：旧实现沿用原始 presentation.xml（仅 2 页 sldId），此断言会失败。
    const tmpl3 = synth({ slide1BodyPh: true })
    const r3 = buildFidelityDeck(tmpl3, [
      { title: "一" },
      { title: "二", lines: ["a"] },
      { title: "三", lines: ["b"] },
    ])
    if (!r3.ok) throw new Error("unexpected failure：" + r3.reason)
    expect(r3.slideCount).toBe(3)
    const out3 = unzip(r3.bytes)
    const pres3 = strFromU8(out3["ppt/presentation.xml"])
    const sldLst = /<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/.exec(pres3)?.[1] ?? ""
    expect((sldLst.match(/<p:sldId /g) || []).length).toBe(3)
    const presRels3 = strFromU8(out3["ppt/_rels/presentation.xml.rels"])
    const targets = [...presRels3.matchAll(/Type="[^"]*\/slide" Target="([^"]+)"/g)].map((m) => "ppt/" + m[1])
    expect(targets.sort()).toEqual(["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml"])
    for (const t of targets) expect(out3[t]).toBeDefined()
    expect((presRels3.match(/Type="[^"]*\/slide"/g) || []).length).toBe(3)
  })
})

describe("文本注入细节", () => {
  it("正文每行一个 a:p，且复用原 pPr/rPr 样式模板", () => {
    const tmpl = synth({ slide1BodyPh: true })
    const r = buildFidelityDeck(tmpl, [
      { title: "T" },
      { title: "B", lines: ["一、现状", "二、目标", "三、架构"] },
    ])
    if (!r.ok) throw new Error("unexpected failure")
    const slide2 = strFromU8(unzip(r.bytes)["ppt/slides/slide2.xml"])
    const body = /<p:ph\b[^>]*type="body"[\s\S]*?<\/p:sp>/.exec(slide2)?.[0] ?? ""
    expect(body).toContain("<a:pPr marL=\"216000\"")
    expect(body).toContain('sz="1600"')
    expect((body.match(/<a:p>/g) || []).length).toBe(3)
    expect(body).toContain("一、现状")
    expect(body).toContain("三、架构")
  })

  it("XML 特殊字符全部转义", () => {
    const tmpl = synth({ slide1BodyPh: true })
    const r = buildFidelityDeck(tmpl, [{ title: 'A&B <x> "q"' }])
    if (!r.ok) throw new Error("unexpected failure")
    const s1 = strFromU8(unzip(r.bytes)["ppt/slides/slide1.xml"])
    expect(s1).toContain("A&amp;B &lt;x&gt; &quot;q&quot;")
    expect(s1).not.toContain("<a:t>A&B")
  })

  it("无占位符模板按形状顺序回退（第一形状=标题，第二形状=正文）", () => {
    const tmpl = synth({ withPh: false })
    const r = buildFidelityDeck(tmpl, [{ title: "新页", lines: ["甲", "乙"] }])
    if (!r.ok) throw new Error("unexpected failure")
    const s = strFromU8(unzip(r.bytes)["ppt/slides/slide1.xml"])
    expect(s).toContain("<a:t>新页</a:t>")
    expect(s).toContain("<a:t>甲</a:t>")
    expect(s).not.toContain("旧标题")
  })

  it("含 $ 的文本不被当作替换模式吞掉", () => {
    const tmpl = synth({ slide1BodyPh: true })
    const r = buildFidelityDeck(tmpl, [{ title: "100$ & $&" }])
    if (!r.ok) throw new Error("unexpected failure")
    expect(strFromU8(unzip(r.bytes)["ppt/slides/slide1.xml"])).toContain("<a:t>100$ &amp; $&amp;</a:t>")
  })
})

describe("样张资格与诚实降级", () => {
  it("notes 关系样张被跳过；正文走 slide2；notes rels 清理旧页引用", () => {
    const tmpl = synth({ notes: true })
    const r = buildFidelityDeck(tmpl, [{ title: "封面" }, { title: "内页", lines: ["内容"] }])
    if (!r.ok) throw new Error("unexpected failure：" + r.reason)
    expect(r.titleSample).toBe(2)
    expect(r.bodySample).toBe(2)
    const out = unzip(r.bytes)
    const nr = strFromU8(out["ppt/notesSlides/_rels/notesSlide1.xml.rels"])
    expect(nr).not.toContain("slides/slide")
    expect(nr).toContain("notesMaster")
  })

  it("全部样张含 chart 关系时返回 ok:false", () => {
    const tmpl = synth({ chartBoth: true })
    const r = buildFidelityDeck(tmpl, [{ title: "T" }])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain("title sample")
  })

  it("图片关系不影响样张资格（随包保留）", () => {
    const entries: Record<string, Uint8Array> = {}
    const base = unzip(synth({ image: true }))
    for (const k of Object.keys(base)) entries[k] = base[k]
    entries["ppt/media/image1.png"] = strToU8("PNG-BYTES")
    const tmpl = zipSync(entries, { level: 0 })
    const r = buildFidelityDeck(tmpl, [{ title: "T1" }, { title: "T2", lines: ["行"] }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const out = unzip(r.bytes)
    expect(strFromU8(out["ppt/media/image1.png"])).toBe("PNG-BYTES")
    expect(strFromU8(out["ppt/slides/_rels/slide1.xml.rels"])).toContain("image1.png")
  })

  it("空 specs / 非法 zip 均返回 ok:false", () => {
    expect(buildFidelityDeck(synth(), []).ok).toBe(false)
    expect(buildFidelityDeck(strToU8("not-a-zip") as unknown as Uint8Array, [{ title: "x" }]).ok).toBe(false)
  })
})

describe("pickFidelitySamples（R190 抽出：探测与渲染共用选页真源）", () => {
  it("标题页取首个含标题占位的可用页，正文页取含正文占位的页", () => {
    const info = inspectFidelityTemplateDetailed(synth())
    expect(info.failure).toBeNull()
    expect(pickFidelitySamples(info.slides)).toEqual({ title: 1, body: 2 })
  })

  it("样张被关系黑名单剔除后顺延选下一页", () => {
    const info = inspectFidelityTemplateDetailed(synth({ chart: true }))
    expect(pickFidelitySamples(info.slides).title).toBe(2)
  })

  it("无占位符时退到「有可填文字的形状」，两处以上才能当正文页", () => {
    const onlyOne = pickFidelitySamples([
      { idx: 1, titlePh: false, bodyPh: false, textShapes: 1, usable: true },
    ])
    expect(onlyOne).toEqual({ title: 1, body: null })
    const two = pickFidelitySamples([
      { idx: 3, titlePh: false, bodyPh: false, textShapes: 2, usable: true },
    ])
    expect(two).toEqual({ title: 3, body: 3 })
  })
})

describe("inspectFidelityTemplateDetailed（R190 切片三前置探测）", () => {
  it("带备注页版式的模板如实返回 hasNotesMaster", () => {
    expect(inspectFidelityTemplateDetailed(synth({ notesMaster: true })).hasNotesMaster).toBe(true)
    expect(inspectFidelityTemplateDetailed(synth()).hasNotesMaster).toBe(false)
  })

  it("不可解析时给出引擎侧原始归因键，且不改老 API 的 null 契约", () => {
    expect(inspectFidelityTemplateDetailed(strToU8("junk")).failure).toBe("template is not a valid zip package")
    expect(inspectFidelityTemplate(strToU8("junk") as unknown as Uint8Array)).toBeNull()
  })
})

describe("inspectFidelityTemplate", () => {
  it("目录含每页占位符标记与资格判定", () => {
    const info = inspectFidelityTemplate(synth({ chart: true }))
    expect(info).not.toBeNull()
    expect(info!.slides.length).toBe(2)
    expect(info!.slides[0].usable).toBe(false)
    expect(info!.slides[0].reject).toContain("forbidden")
    expect(info!.slides[1].usable).toBe(true)
  })

  it("非法输入返回 null", () => {
    expect(inspectFidelityTemplate(strToU8("junk") as unknown as Uint8Array)).toBeNull()
  })
})

describe("讲稿备注 notesSlide（R189）", () => {
  const NOTES_CT_STR = "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"

  it("specs 带 notes 且模板含 notesMaster：生成 notesSlide 挂回对应生成页并补 Override", () => {
    const tmpl = synth({ slide1BodyPh: true, notesMaster: true })
    const r = buildFidelityDeck(tmpl, [
      { title: "封面" },
      { title: "内页", lines: ["要点"], notes: "讲：第一句\n讲：第二句 & <x>" },
    ])
    if (!r.ok) throw new Error("unexpected failure：" + r.reason)
    expect(r.notesCount).toBe(1)
    const out = unzip(r.bytes)
    const n = strFromU8(out["ppt/notesSlides/notesSlide1.xml"])
    expect(n).toContain("讲：第一句")
    expect(n).toContain("讲：第二句 &amp; &lt;x&gt;")
    expect((n.match(/<a:p>/g) || []).length).toBe(2)
    const nr = strFromU8(out["ppt/notesSlides/_rels/notesSlide1.xml.rels"])
    expect(nr).toContain("../slides/slide2.xml")
    expect(nr).toContain("../notesMasters/notesMaster1.xml")
    const ct = strFromU8(out["[Content_Types].xml"])
    expect((ct.match(/PartName="\/ppt\/notesSlides\/notesSlide1\.xml"/g) || []).length).toBe(1)
    expect(ct).toContain(NOTES_CT_STR)
    expect(strFromU8(out["ppt/notesMasters/notesMaster1.xml"])).toContain("NOTES-MASTER")
  })

  it("模板已有 notesSlide 孤部件时新备注顺延编号、不覆盖", () => {
    const tmpl = synth({ slide1BodyPh: true, notes: true, notesMaster: true })
    const r = buildFidelityDeck(tmpl, [{ title: "A", notes: "备注甲" }])
    if (!r.ok) throw new Error("unexpected failure：" + r.reason)
    expect(r.notesCount).toBe(1)
    const out = unzip(r.bytes)
    expect(strFromU8(out["ppt/notesSlides/notesSlide1.xml"])).toBe("<p:notesSlide>NOTES</p:notesSlide>")
    const n2 = strFromU8(out["ppt/notesSlides/notesSlide2.xml"])
    expect(n2).toContain("备注甲")
    const nr2 = strFromU8(out["ppt/notesSlides/_rels/notesSlide2.xml.rels"])
    expect(nr2).toContain("../slides/slide1.xml")
    const ct = strFromU8(out["[Content_Types].xml"])
    expect(ct).toContain('/ppt/notesSlides/notesSlide2.xml')
  })

  it("有备注但模板无 notesMaster：ok:false（讲稿不静默丢失，调用方回退现通道）", () => {
    const r = buildFidelityDeck(synth({ slide1BodyPh: true }), [{ title: "A", notes: "备注" }])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain("notesMaster")
  })

  it("全部 specs 无备注：不新增 notesSlide 部件，notesMaster 原样保留", () => {
    const tmpl = synth({ notesMaster: true })
    const r = buildFidelityDeck(tmpl, [{ title: "A" }, { title: "B", lines: ["x"] }])
    if (!r.ok) throw new Error("unexpected failure：" + r.reason)
    expect(r.notesCount).toBe(0)
    const out = unzip(r.bytes)
    expect(out["ppt/notesSlides/notesSlide1.xml"]).toBeUndefined()
    expect(strFromU8(out["ppt/notesMasters/notesMaster1.xml"])).toBe("<p:notesMaster>NOTES-MASTER</p:notesMaster>")
  })
})

describe("正文占位符 type 缺省形态（ECMA-376 默认 body）", () => {
  it("裸 <p:ph idx=\"1\"/> 的内容页认作带正文框", () => {
    const insp = inspectFidelityTemplateDetailed(synth({ bareBody: true }))
    if (insp.failure) throw new Error(insp.failure)
    const page2 = insp.slides.find((s) => s.idx === 2)
    expect(page2?.titlePh).toBe(true)
    expect(page2?.bodyPh).toBe(true)
  })

  it("显式 type=\"body\" 的原有口径不变", () => {
    const insp = inspectFidelityTemplateDetailed(synth())
    if (insp.failure) throw new Error(insp.failure)
    expect(insp.slides.find((s) => s.idx === 2)?.bodyPh).toBe(true)
  })

  it("样张口径：带裸 ph 的内容页优先于「标题框 + 文本框」的封面页", () => {
    const cover = { idx: 1, titlePh: true, bodyPh: false, textShapes: 2, usable: true }
    const content = { idx: 2, titlePh: true, bodyPh: true, textShapes: 2, usable: true }
    expect(pickFidelitySamples([cover, content])).toEqual({ title: 1, body: 2 })
    // 回归护栏：内容页的正文 ph 若认不出来，兜底口径会把封面页选成正文样张
    expect(pickFidelitySamples([cover, { ...content, bodyPh: false }])).toEqual({ title: 1, body: 1 })
  })

  it("裸 ph 内容页可作为正文样张写出多行文本", () => {
    const r = buildFidelityDeck(synth({ bareBody: true }), [
      { title: "封面" },
      { title: "方案页", lines: ["一、现状", "二、目标"] },
    ])
    if (!r.ok) throw new Error("unexpected failure")
    const slide2 = strFromU8(unzip(r.bytes)["ppt/slides/slide2.xml"])
    expect(slide2).toContain("一、现状")
    expect(slide2).toContain("二、目标")
    const bodyShape = /<p:ph idx="1"\/>[\s\S]*?<\/p:sp>/.exec(slide2)?.[0] ?? ""
    expect((bodyShape.match(/<a:p>/g) || []).length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 附三用户需求（2026-10-07）：图文并茂 × 模板——带图页保真
// ---------------------------------------------------------------------------

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

describe("buildFidelityDeck · 带图页保真（附三图文并茂×模板）", () => {
  it("带图 spec：媒体部件/页关系/pic 元素/CT Default 全部落包", () => {
    const bytes = synth({ withPh: true })
    const specs = [
      { title: "总体架构", lines: ["统一门户", "数据中台"], image: { base64: PNG_1PX, ext: "png" } },
      { title: "纯文字页", lines: ["要点一", "要点二"] },
    ]
    const out = buildFidelityDeck(bytes, specs)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const zip = unzipSync(out.bytes)
    const names = Object.keys(zip)
    // 媒体部件落包
    expect(names.some((n) => /^ppt\/media\/image\d+\.png$/.test(n))).toBe(true)
    // 页关系引用媒体
    const rels = names.filter((n) => n.startsWith("ppt/slides/_rels/")).map((n) => strFromU8(zip[n])).join("\n")
    expect(rels).toContain("/media/image")
    // 页 XML 注入 <p:pic>
    const slide1 = strFromU8(zip["ppt/slides/slide1.xml"])
    expect(slide1).toContain("<p:pic>")
    expect(slide1).toContain('r:embed="rId')
    // CT 注册 png
    expect(strFromU8(zip["[Content_Types].xml"])).toContain('Extension="png"')
  })

  it("dataURL 前缀自动剥离；非法 base64 该页无图不致失败", () => {
    const bytes = synth({ withPh: true })
    const out = buildFidelityDeck(bytes, [
      { title: "带前缀图", lines: ["a"], image: { base64: "data:image/png;base64," + PNG_1PX, ext: "png" } },
      { title: "坏图页", lines: ["b"], image: { base64: "!!!", ext: "png" } },
    ])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const zip = unzipSync(out.bytes)
    const media = names_of(zip).filter((n) => /^ppt\/media\//.test(n))
    expect(media.length).toBe(1) // 坏图不落媒体部件
  })
})

function names_of(zip: ReturnType<typeof unzipSync>): string[] {
  return Object.keys(zip)
}

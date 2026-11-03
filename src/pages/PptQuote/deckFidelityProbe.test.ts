// Author: loop-R190
// R190（r169 切片三·探测层）单测：合成最小 OOXML 模板，钉死
// 1) 样张目录与选页口径（复用引擎真源 pickFidelitySamples）；
// 2) 结论合成顺序与导出分流一致（整册判定 → 模板守卫）；
// 3) 用户可见文案不外泄内部部件名/英文错误串。纯逻辑，node 下直接跑。
import { describe, expect, it } from "vitest"
import { strToU8, zipSync } from "fflate"
import { encodeTemplateBytes, type StoredDeckTemplate } from "./deckTheme"
import { describeFidelityRows, finalizeFidelityProbe, probeTemplateFacts } from "./deckFidelityProbe"
import { inspectFidelityTemplateDetailed, pickFidelitySamples } from "./templateFidelity"
import type { Slide } from "./pptQuoteTypes"

const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
const SLIDE_CT = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"

function phSp(ph: string, text: string): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="${ph}"/></p:nvPr></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
  )
}
function plainSp(text: string): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="X"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
  )
}

type PageSpec = {
  title?: boolean
  body?: boolean
  /** 正文占位符写成裸 `<p:ph idx="1"/>`（type 缺省即 body） */
  bareBody?: boolean
  plain?: number
  bad?: "chart" | "norels" | "nolayout"
}

function mkTemplate(pages: PageSpec[], opts: { notesMaster?: boolean } = {}): Uint8Array {
  const map: Record<string, string> = {}
  const slideTags: string[] = []
  const ctTags: string[] = []
  pages.forEach((p, i) => {
    const n = i + 1
    let shapes = ""
    if (p.title) shapes += phSp("ctrTitle", `旧标题${n}`)
    if (p.body) shapes += phSp("body", `旧正文${n}`)
    if (p.bareBody) shapes += `<p:sp><p:nvSpPr><p:cNvPr id="4" name="B"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>旧正文${n}</a:t></a:r></a:p></p:txBody></p:sp>`
    for (let k = 0; k < (p.plain ?? 0); k++) shapes += plainSp(`文本${n}_${k}`)
    if (!shapes) shapes = plainSp(`装饰${n}`)
    map[`ppt/slides/slide${n}.xml`] =
      `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`
    let rel = `<Relationship Id="rId1" Type="${REL_NS}/slideLayout" Target="../slideLayouts/slideLayout${n}.xml"/>`
    if (p.bad === "chart") rel = `<Relationship Id="rId1" Type="${REL_NS}/chart" Target="../charts/chart1.xml"/>`
    if (p.bad === "nolayout") rel = `<Relationship Id="rId1" Type="${REL_NS}/theme" Target="../theme/theme1.xml"/>`
    if (p.bad !== "norels") {
      map[`ppt/slides/_rels/slide${n}.xml.rels`] =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel}</Relationships>`
    }
    slideTags.push(`<Relationship Id="rId${n + 1}" Type="${REL_NS}/slide" Target="slides/slide${n}.xml"/>`)
    ctTags.push(`<Override PartName="/ppt/slides/slide${n}.xml" ContentType="${SLIDE_CT}"/>`)
  })
  const presRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${REL_NS}/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slideTags.join("")}</Relationships>`
  const idList = pages.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")
  map["[Content_Types].xml"] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
    ctTags.join("") +
    (opts.notesMaster
      ? `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>`
      : "") +
    `</Types>`
  map["_rels/.rels"] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
  map["ppt/presentation.xml"] =
    `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
    `<p:sldIdLst>${idList}</p:sldIdLst></p:presentation>`
  map["ppt/_rels/presentation.xml.rels"] = presRels
  map["ppt/slideMasters/slideMaster1.xml"] = "<p:sldMaster>MASTER</p:sldMaster>"
  map["ppt/theme/theme1.xml"] = "<a:theme>THEME</a:theme>"
  if (opts.notesMaster) {
    map["ppt/notesMasters/notesMaster1.xml"] = "<p:notesMaster>NOTES-MASTER</p:notesMaster>"
  }
  const entries: Record<string, Uint8Array> = {}
  for (const k of Object.keys(map)) entries[k] = strToU8(map[k])
  return zipSync(entries, { level: 0 })
}

function mkStored(bytes: Uint8Array | null): StoredDeckTemplate {
  const t: StoredDeckTemplate = { name: "公司模板.pptx", savedAt: 0, theme: { accents: ["0E9F8A"] } }
  const b64 = bytes ? encodeTemplateBytes(bytes) : null
  return b64 ? { ...t, bytesB64: b64 } : t
}

function mkSlide(o: Partial<Slide> = {}): Slide {
  return { id: "s", title: "标题", bullets: ["要点"], notes: "", ...o }
}

const TITLE_AND_BODY = mkTemplate([{ title: true }, { title: true, body: true }])

describe("probeTemplateFacts（模板侧探测）", () => {
  it("标准模板：存到本地且可读，样张目录标出标题/正文样式页", () => {
    const facts = probeTemplateFacts(mkStored(TITLE_AND_BODY))
    expect(facts.stored).toBe(true)
    expect(facts.readable).toBe(true)
    expect(facts.templatePages).toBe(2)
    expect(facts.titlePage).toBe(1)
    expect(facts.bodyPage).toBe(2)
    expect(facts.rows[0].role).toBe("title")
    expect(facts.rows[1].role).toBe("body")
    expect(facts.rows[1].caps).toEqual(["标题框", "正文框"])
    expect(facts.hasNotesMaster).toBe(false)
  })

  it("模板含备注页版式时如实标记（讲稿能否写入的前置条件）", () => {
    expect(probeTemplateFacts(mkStored(mkTemplate([{ title: true, body: true }], { notesMaster: true }))).hasNotesMaster).toBe(true)
  })

  it("正文占位符写成裸 <p:ph idx=\"1\"/>（type 缺省）时也认出正文框并优先当正文样张", () => {
    // 第 1 页只有标题框 + 一处文本框（兜底口径能凑成正文），第 2 页是真正的裸 ph 内容页
    const facts = probeTemplateFacts(mkStored(mkTemplate([{ title: true, plain: 1 }, { title: true, bareBody: true }])))
    expect(facts.titlePage).toBe(1)
    expect(facts.bodyPage).toBe(2)
    expect(facts.rows[0].role).toBe("title")
    expect(facts.rows[1].role).toBe("body")
    expect(facts.rows[1].caps).toEqual(["标题框", "正文框"])
    expect(facts.rows[1].note).toBe("")
  })

  it("无占位符但有多处文本框的页面也能当正文样式（与引擎真源同口径）", () => {
    const facts = probeTemplateFacts(mkStored(mkTemplate([{ plain: 2 }])))
    expect(facts.titlePage).toBe(1)
    expect(facts.bodyPage).toBe(1)
    expect(facts.rows[0].role).toBe("both")
    expect(facts.rows[0].caps).toEqual(["文本框 2 处"])
  })

  it("含图表等专属内容的页面被判不可复用，归因是中文", () => {
    const facts = probeTemplateFacts(mkStored(mkTemplate([{ bad: "chart" }, { title: true, body: true }])))
    expect(facts.rows[0].usable).toBe(false)
    expect(facts.rows[0].note).toContain("无法复用")
    expect(facts.rows[0].note).not.toContain("relation")
    expect(facts.titlePage).toBe(2)
  })

  it("缺配套配置与未绑定版式的页面各有独立中文归因", () => {
    const facts = probeTemplateFacts(mkStored(mkTemplate([{ bad: "norels" }, { bad: "nolayout" }, { title: true }])))
    expect(facts.rows[0].note).toContain("配套配置")
    expect(facts.rows[1].note).toContain("版式")
    expect(facts.titlePage).toBe(3)
  })

  it("模板字节非法：可读性为 false 且给出中文归因", () => {
    const facts = probeTemplateFacts(mkStored(strToU8("这不是一个 zip 包")))
    expect(facts.stored).toBe(true)
    expect(facts.readable).toBe(false)
    expect(facts.failure).toBe("文件不是可解析的 PPT 模板包")
  })

  it("未保存模板原件（超容量降级）：stored=false 并说明只留下配色与字体", () => {
    const facts = probeTemplateFacts(mkStored(null))
    expect(facts.stored).toBe(false)
    expect(facts.failure).toContain("模板原件未保存到本地")
    expect(facts.rows).toEqual([])
  })

  it("没有模板时返回空事实，不抛异常", () => {
    expect(probeTemplateFacts(undefined).stored).toBe(false)
    expect(probeTemplateFacts(null).readable).toBe(false)
  })
})

describe("describeFidelityRows（样张目录）", () => {
  it("按 pickFidelitySamples 的选页结果标注角色，未选中且无文本框的页给出归因", () => {
    const insp = inspectFidelityTemplateDetailed(mkTemplate([{ plain: 2 }, { plain: 1 }]))
    const rows = describeFidelityRows(insp.slides, pickFidelitySamples(insp.slides))
    expect(rows[0].role).toBe("both")
    expect(rows[1].role).toBeNull()
    expect(rows[0].caps).toEqual(["文本框 2 处"])
  })
})

describe("finalizeFidelityProbe（结论合成，顺序与导出分流一致）", () => {
  const okFacts = probeTemplateFacts(mkStored(TITLE_AND_BODY))

  it("整册纯文字且模板可用：判定为可复用模板版式，不给建议", () => {
    const p = finalizeFidelityProbe(okFacts, [mkSlide(), mkSlide({ title: "末页" })])
    expect(p.verdict).toBe("fidelity")
    expect(p.headline).toContain("2 页")
    expect(p.reasons).toEqual([])
    expect(p.advice).toBeNull()
    expect(p.blockedPages).toEqual([])
    expect(p.plainPages).toBe(2)
  })

  it("任一页含图表/KPI/配图即整册回退内置版式，并点名页号", () => {
    const p = finalizeFidelityProbe(okFacts, [
      mkSlide(),
      mkSlide({ kpi: [{ value: "1200", label: "床位" }] }),
      mkSlide({ image: "data:image/png;base64,x" }),
    ])
    expect(p.verdict).toBe("theme")
    expect(p.blockedPages).toEqual([2, 3])
    expect(p.headline).toContain("第 2、3 页")
    expect(p.advice).toContain("纯文字")
    expect(p.plainPages).toBe(1)
  })

  it("写了讲稿而模板没有备注页版式：为防讲稿丢失回退，并说明页数", () => {
    const noNotes = { ...okFacts, hasNotesMaster: false }
    const p = finalizeFidelityProbe(noNotes, [mkSlide({ notes: "开场讲稿" }), mkSlide()])
    expect(p.verdict).toBe("theme")
    expect(p.reasons[0]).toContain("1 页写了讲稿")
    const withNotes = finalizeFidelityProbe({ ...noNotes, hasNotesMaster: true }, [mkSlide({ notes: "开场讲稿" })])
    expect(withNotes.verdict).toBe("fidelity")
  })

  it("讲稿检查排在样张检查之前：两者都不满足时先报讲稿归因", () => {
    const p = finalizeFidelityProbe({ ...okFacts, titlePage: null, bodyPage: null, hasNotesMaster: false }, [mkSlide({ notes: "讲稿" })])
    expect(p.reasons[0]).toContain("备注页版式")
  })

  it("模板里没有可填标题的页面：给出可操作的换模板建议", () => {
    const p = finalizeFidelityProbe({ ...okFacts, titlePage: null }, [mkSlide()])
    expect(p.verdict).toBe("theme")
    expect(p.headline).toContain("内置版式")
    expect(p.advice).toContain("另存为标准 .pptx")
  })

  it("模板缺正文样式页（封面目录无处落字）：单独归因", () => {
    const p = finalizeFidelityProbe({ ...okFacts, bodyPage: null }, [mkSlide()])
    expect(p.verdict).toBe("theme")
    expect(p.headline).toContain("正文")
  })

  it("还没有页面时不下保真结论", () => {
    const p = finalizeFidelityProbe(okFacts, [])
    expect(p.verdict).toBe("theme")
    expect(p.headline).toContain("还没有页面")
  })

  it("模板读不出来：结论独立于仅套用主题，建议另存文件", () => {
    const p = finalizeFidelityProbe(probeTemplateFacts(mkStored(strToU8("junk"))), [mkSlide()])
    expect(p.verdict).toBe("unreadable")
    expect(p.advice).toContain("另存为标准 .pptx")
  })

  it("原件未保存：只报配色与字体已套用", () => {
    const p = finalizeFidelityProbe(probeTemplateFacts(mkStored(null)), [mkSlide()])
    expect(p.verdict).toBe("theme")
    expect(p.headline).toContain("配色与字体")
  })

  it("所有用户可见文案都不外泄内部部件名与英文错误串", () => {
    const cases = [
      okFacts,
      { ...okFacts, hasNotesMaster: false },
      { ...okFacts, titlePage: null, bodyPage: null },
      probeTemplateFacts(mkStored(strToU8("junk"))),
      probeTemplateFacts(mkStored(null)),
    ]
    for (const facts of cases) {
      for (const slides of [[mkSlide({ notes: "讲稿" })], [mkSlide({ kpi: [{ value: "1", label: "床位" }] })], []]) {
        const p = finalizeFidelityProbe(facts, slides)
        const text = [p.headline, p.advice ?? "", ...p.reasons, ...p.rows.map((r) => r.note)].join(" ")
        expect(text).not.toMatch(/notesMaster|slideLayout|rels|pptxgenjs|txBody|zip|placeholder/i)
        expect(text).not.toMatch(/P\d|F\d\d/)
      }
    }
  })
})

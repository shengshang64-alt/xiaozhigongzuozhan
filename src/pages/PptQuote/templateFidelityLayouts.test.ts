// ---------------------------------------------------------------------------
// 按 kind 分配版式（2026-11-05 修）
//
// 缺陷：保真引擎原本只克隆「一张」样张页（titleSample/bodySample），
// 整册所有页共用同一版式。实测公司官方模板（zoe-light-internal，6 版式）导出 6 页：
//   第1..6页 layout 全部 = 「封面」
// 封面/目录/章节/内页/封底的差异被完全抹平——用户看到的仍是"一个版式复制 N 遍"，
// 这正是"套了公司模板还是不像公司模板"的核心原因之一。
//
// 修法：FidelitySlideSpec 增加 layoutFile，引擎按它挑「该版式下的样张页」来克隆。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import { buildFidelityDeck } from "./templateFidelity"

const P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
const CT_SLIDE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"
const CT_LAYOUT = "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"
const CT_MASTER = "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"

/** 造模板：2 个版式（封面/内页），各 1 张样张页，用于验证「按 layoutFile 选样张」 */
function makeTwoLayoutTemplate(): Uint8Array {
  const slide = (titleText: string, phType: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"><p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="标题 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
<p:nvPr><p:ph type="${phType}"/></p:nvPr></p:nvSpPr><p:spPr/>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>${titleText}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="正文 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>原正文占位</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`

  const slideRels = (layoutNo: number) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${R_NS}/slideLayout" Target="../slideLayouts/slideLayout${layoutNo}.xml"/>
</Relationships>`

  const layout = (_no: number, name: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}" type="title"><p:cSld name="${name}"><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
${[1, 2].map((i) => `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="${CT_SLIDE}"/>`).join("")}
${[1, 2].map((i) => `<Override PartName="/ppt/slideLayouts/slideLayout${i}.xml" ContentType="${CT_LAYOUT}"/>`).join("")}
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT_MASTER}"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
    ),
    "ppt/presentation.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`,
    ),
    "ppt/_rels/presentation.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${R_NS}/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="${R_NS}/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId3" Type="${R_NS}/slide" Target="slides/slide2.xml"/>
</Relationships>`,
    ),
    "ppt/slides/slide1.xml": strToU8(slide("原标题A", "ctrTitle")),
    "ppt/slides/_rels/slide1.xml.rels": strToU8(slideRels(1)),
    "ppt/slides/slide2.xml": strToU8(slide("原标题B", "title")),
    "ppt/slides/_rels/slide2.xml.rels": strToU8(slideRels(2)),
    "ppt/slideMasters/slideMaster1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"><p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"
accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst></p:sldMaster>`,
    ),
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${R_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="${R_NS}/slideLayout" Target="../slideLayouts/slideLayout2.xml"/>
<Relationship Id="rId3" Type="${R_NS}/theme" Target="../theme/theme1.xml"/>
</Relationships>`,
    ),
    "ppt/slideLayouts/slideLayout1.xml": strToU8(layout(1, "封面")),
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${R_NS}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`,
    ),
    "ppt/slideLayouts/slideLayout2.xml": strToU8(layout(2, "内页1")),
    "ppt/slideLayouts/_rels/slideLayout2.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${R_NS}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`,
    ),
    "ppt/theme/theme1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${A_NS}" name="t"><a:themeElements><a:clrScheme name="c">
<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
<a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2>
<a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4>
<a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6>
<a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink>
</a:clrScheme><a:fontScheme name="f"><a:majorFont><a:latin typeface="Arial"/></a:majorFont>
<a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme>
<a:fmtScheme name="s"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme>
</a:themeElements></a:theme>`,
    ),
  }
  return zipSync(files)
}

/** 读产物里每页绑定的版式文件名 */
function layoutsOfDeck(bytes: Uint8Array): string[] {
  const files = unzipSync(bytes)
  const out: string[] = []
  const slides = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)/.exec(a)![1]) - Number(/(\d+)/.exec(b)![1]))
  for (const s of slides) {
    const no = Number(/(\d+)/.exec(s)![1])
    const rels = files[`ppt/slides/_rels/slide${no}.xml.rels`]
    const txt = rels ? strFromU8(rels) : ""
    out.push(/Target="[^"]*?(slideLayout\d+\.xml)"/.exec(txt)?.[1] ?? "（无版式）")
  }
  return out
}

describe("按 kind 分配版式 · 不同页型必须用不同版式", () => {
  it("指定 layoutFile 后，各页分别绑定各自版式（不再整册同一个）", () => {
    const tpl = makeTwoLayoutTemplate()
    const out = buildFidelityDeck(tpl, [
      { title: "封面标题", lines: ["副标题"], layoutFile: "slideLayout1.xml" },
      { title: "内容页标题", lines: ["要点一", "要点二"], layoutFile: "slideLayout2.xml" },
      { title: "再来一页内容", lines: ["要点三"], layoutFile: "slideLayout2.xml" },
    ])
    if (!out.ok) throw new Error("构建失败 reason=" + out.reason)
    expect(layoutsOfDeck(out.bytes)).toEqual(["slideLayout1.xml", "slideLayout2.xml", "slideLayout2.xml"])
  })

  it("不指定 layoutFile 时退回旧行为（全用同一样张页），不影响存量调用", () => {
    const tpl = makeTwoLayoutTemplate()
    const out = buildFidelityDeck(tpl, [
      { title: "第一篇", lines: ["正文"] },
      { title: "第二篇", lines: ["正文"] },
    ])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const ls = layoutsOfDeck(out.bytes)
    expect(ls[0]).toBe(ls[1])
  })

  it("指定的版式在模板里没有样张页时安全退回默认样张（不报错、不产出坏文件）", () => {
    const tpl = makeTwoLayoutTemplate()
    const out = buildFidelityDeck(tpl, [{ title: "标题", lines: ["正文"], layoutFile: "slideLayout99.xml" }])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(layoutsOfDeck(out.bytes)[0]).toMatch(/^slideLayout[12]\.xml$/)
  })
})

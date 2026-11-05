// ---------------------------------------------------------------------------
// 模板示例文案不得冒充本页内容 + 正文必须可见（2026-11-05，渲染实测暴露）
//
// 用公司官方模板真实导出、LibreOffice 渲染成图后发现的两个严重缺陷：
//
// 缺陷 A（内容错乱）：模板「内页1」样张页没有 body 占位符，是一排装饰卡片，
//   16 个文字形状装的是模板作者的示例文案（「直播带货：新生代妈妈消费新风尚」
//   「直播观看次数 7000W+」「新生代妈妈...」）。旧实现只替换标题、其余文字原样保留，
//   导出后 3/5/7 页**正文完全相同**、全是直播带货内容，只有标题被换掉——
//   "看起来套上了模板，实际交付了错误内容"，比不套模板更糟。
//
// 缺陷 B（文字被盖住）：正文按「第一个有文字的非标题形状」挑，挑中了一块
//   **带 accent5 填充 + 整页宽** 的色块；而它上方还有一层全页渐变矩形，
//   于是文字注入成功、却完全被上层盖住，渲染出来是"标题 + 空白大色板"。
//
// 修法：① 其余文字形状一律清空（形状保留，装饰不受影响）；
//      ② 正文优先写进「不带填充的纯文本框」，避开会被盖住的色块。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import { strToU8, strFromU8, unzipSync, zipSync } from "fflate"
import { buildFidelityDeck } from "./templateFidelity"

const P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

/** 造一个「只有一个样张页」的模板，其形状布局复刻真实模板的关键特征：
 *  · 标题占位符
 *  · 带填充的整页色块（陷阱：文字写进去会被上层渐变盖住）
 *  · 全页渐变矩形（上层遮罩）
 *  · 一个不带填充的纯文本框（正确宿主）
 *  · 若干装示例文案的卡片文字形状
 */
function makeTrapTemplate(): Uint8Array {
  const slide = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"><p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="标题 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
<p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>模板原标题</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="5" name="矩形 5"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="0" y="3350835"/><a:ext cx="12192000" cy="3429000"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent5"/></a:solidFill></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>模板作者示例文案A</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="44" name="矩形 44"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="0" y="3429000"/><a:ext cx="12192000" cy="3429000"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:gradFill flip="none" rotWithShape="1"><a:gsLst>
<a:gs pos="0"><a:srgbClr val="3987FB"/></a:gs><a:gs pos="100000"><a:srgbClr val="0045E2"/></a:gs>
</a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="9" name="文本框 9"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="603504" y="1656612"/><a:ext cx="7851264" cy="831484"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>模板示例大标题B</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="12" name="文本框 12"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="603504" y="3895344"/><a:ext cx="1252728" cy="310896"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>直播观看次数</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="13" name="文本框 13"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="603504" y="4160520"/><a:ext cx="1517656" cy="521208"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>7000W+</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
    ),
    "ppt/presentation.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    ),
    "ppt/_rels/presentation.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${R_NS}/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="${R_NS}/slide" Target="slides/slide1.xml"/></Relationships>`,
    ),
    "ppt/slides/slide1.xml": strToU8(slide),
    "ppt/slides/_rels/slide1.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${R_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
    ),
    "ppt/slideMasters/slideMaster1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"><p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"
accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
    ),
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${R_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="${R_NS}/theme" Target="../theme/theme1.xml"/></Relationships>`,
    ),
    "ppt/slideLayouts/slideLayout1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}" type="title"><p:cSld name="内页1"><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    ),
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${R_NS}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
    ),
    "ppt/theme/theme1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${A_NS}" name="t"><a:themeElements><a:clrScheme name="c">
<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
<a:accent1><a:srgbClr val="0045E2"/></a:accent1><a:accent2><a:srgbClr val="1EABEC"/></a:accent2>
<a:accent3><a:srgbClr val="4472C4"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="3987FB"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="9C6ABA"/></a:folHlink>
</a:clrScheme><a:fontScheme name="f"><a:majorFont><a:latin typeface="Arial"/></a:majorFont>
<a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme>
<a:fmtScheme name="s"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme>
</a:themeElements></a:theme>`,
    ),
  }
  return zipSync(files)
}

function shapeTexts(bytes: Uint8Array, slideNo = 1): { name: string; texts: string[]; framed: boolean }[] {
  const files = unzipSync(bytes)
  const xml = strFromU8(files[`ppt/slides/slide${slideNo}.xml`] ?? new Uint8Array())
  const out: { name: string; texts: string[]; framed: boolean }[] = []
  for (const m of xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
    const b = m[0]
    const name = /<p:cNvPr[^>]*name="([^"]*)"/.exec(b)?.[1] ?? "?"
    const texts = [...b.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((x) => x[1])
    const spPr = /<p:spPr\b[\s\S]*?<\/p:spPr>/.exec(b)?.[0] ?? ""
    const framed = /<a:(solidFill|gradFill|pattFill|blipFill)\b/.test(spPr)
    out.push({ name, texts, framed })
  }
  return out
}

describe("模板示例文案不得冒充本页内容", () => {
  it("导出后不再残留模板作者的示例文案（直播带货那类）", () => {
    const out = buildFidelityDeck(makeTrapTemplate(), [
      { title: "评级差距集中在数据与流程", lines: ["接口未统一，抽取成本高", "指标重叠，统筹可避免重复投入"] },
    ])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const all = shapeTexts(out.bytes)
      .flatMap((s) => s.texts)
      .join("")
    for (const forbidden of ["模板作者示例文案A", "模板示例大标题B", "直播观看次数", "7000W+"]) {
      expect(all, `模板示例文案「${forbidden}」泄漏到成品`).not.toContain(forbidden)
    }
  })

  it("本页真实内容完整保留", () => {
    const out = buildFidelityDeck(makeTrapTemplate(), [
      { title: "评级差距集中在数据与流程", lines: ["接口未统一，抽取成本高", "指标重叠，统筹可避免重复投入"] },
    ])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const all = shapeTexts(out.bytes)
      .flatMap((s) => s.texts)
      .join("")
    expect(all).toContain("评级差距集中在数据与流程")
    expect(all).toContain("接口未统一，抽取成本高")
    expect(all).toContain("指标重叠，统筹可避免重复投入")
  })
})

describe("正文必须写进可见形状（不能被上层色块盖住）", () => {
  it("正文宿主是不带填充的纯文本框，不是带填充的整页色块", () => {
    const out = buildFidelityDeck(makeTrapTemplate(), [
      { title: "标题", lines: ["第一条要点", "第二条要点"] },
    ])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const shapes = shapeTexts(out.bytes)
    const host = shapes.find((s) => s.texts.includes("第一条要点"))
    expect(host, "找不到承载正文的形状").toBeDefined()
    expect(host!.framed, `正文写进了带填充的形状「${host!.name}」——会被上层色块盖住而看不见`).toBe(false)
    expect(host!.name).toBe("文本框 9")
  })

  it("装饰形状本身保留（不是整页删光）", () => {
    const out = buildFidelityDeck(makeTrapTemplate(), [{ title: "标题", lines: ["要点"] }])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const shapes = shapeTexts(out.bytes)
    // 渐变遮罩与带填充色块都还在（版面结构不能丢），只是不再有示例文字
    expect(shapes.some((s) => s.name === "矩形 44")).toBe(true)
    expect(shapes.some((s) => s.name === "矩形 5")).toBe(true)
    const rect5 = shapes.find((s) => s.name === "矩形 5")!
    expect(rect5.texts).toEqual([])
  })
})

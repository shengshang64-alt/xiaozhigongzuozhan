// ---------------------------------------------------------------------------
// 母版保真引擎：主题样式提取的 XML 配对扫描（2026-11-05 修）
//
// 真实缺陷（不是理论风险）：用公司官方模板 zoe-light-internal（来自
// GordenPPTSkill v1.2.0 的 templates/ 目录）走保真导出，**产出的 pptx 打不开**：
//   python-pptx 报 `XMLSyntaxError: Opening and ending tag mismatch: ln ... and r`
//   PowerPoint 同样拒绝打开。用户看到的是"导出成功"，拿到的是坏文件——最坏的一类失败。
//
// 根因：`rewriteShapeTxBody` 用惰性正则提取要复用的样式片段
//   `/<a:rPr\b[\s\S]*?(?:\/>|<\/a:rPr>)/`
// 该模板的 rPr 里嵌套了自闭合子元素：
//   <a:rPr kumimoji="1" lang="zh-CN" altLang="en-US"><a:ln w="12700"><a:noFill/></a:ln></a:rPr>
// 惰性匹配先撞上 `<a:noFill/>` 的 `/>` 就收尾，截出
//   `<a:rPr ...><a:ln w="12700"><a:noFill/>`
// ——ln 与 rPr 都没闭合，拼回新段落后整页 XML 标签不匹配。
//
// 本文件用「嵌套容器样式」的构造样张页面锁住这个行为。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import { strToU8, unzipSync, zipSync } from "fflate"
import { buildFidelityDeck, inspectFidelityTemplate } from "./templateFidelity"

const P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

/** 造一个最小 pptx：含 1 张样张页，其 rPr/bodyPr/pPr 都带**自闭合子元素**（还原真实模板形态） */
function makeTemplate(opts: { nestedRunStyle: boolean }): Uint8Array {
  const rPr = opts.nestedRunStyle
    ? '<a:rPr kumimoji="1" lang="zh-CN" altLang="en-US"><a:ln w="12700"><a:noFill/></a:ln></a:rPr>'
    : '<a:rPr lang="zh-CN"/>'
  const slide = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"><p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="标题 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
<p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>
<p:txBody><a:bodyPr><a:normAutofit fontScale="90000"/></a:bodyPr><a:lstStyle/>
<a:p><a:pPr><a:spcBef><a:spcPts val="600"/></a:spcBef></a:pPr><a:r>${rPr}<a:t>原标题</a:t></a:r></a:p>
</p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="正文 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>
<p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/>
<a:p><a:pPr><a:buFont typeface="Arial"/></a:pPr><a:r>${rPr}<a:t>原正文</a:t></a:r></a:p>
</p:txBody></p:sp>
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
<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
    ),
    "ppt/presentation.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`,
    ),
    "ppt/_rels/presentation.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${R_NS}/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="${R_NS}/slide" Target="slides/slide1.xml"/>
</Relationships>`,
    ),
    "ppt/slides/slide1.xml": strToU8(slide),
    "ppt/slides/_rels/slide1.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${R_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`,
    ),
    "ppt/slideMasters/slideMaster1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"><p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1"
accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6"
hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst>
<p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
    ),
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${R_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="${R_NS}/theme" Target="../theme/theme1.xml"/>
</Relationships>`,
    ),
    "ppt/slideLayouts/slideLayout1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}" type="title"><p:cSld name="标题幻灯片"><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    ),
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": strToU8(
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

/** 校验 zip 里每个 xml 部件都是良构 XML（不引第三方库：用 DOMParser 不可用，改做标签配对粗检） */
function badXmlParts(zipBytes: Uint8Array): string[] {
  const files = unzipSync(zipBytes)
  const bad: string[] = []
  for (const [name, data] of Object.entries(files)) {
    if (!name.endsWith(".xml")) continue
    const xml = new TextDecoder().decode(data)
    // 栈式配对检查（足以抓出「ln 未闭合导致 r 报错」这类问题）
    const stack: string[] = []
    const re = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g
    let m: RegExpExecArray | null
    let broken = false
    while ((m = re.exec(xml)) !== null) {
      const [, close, tag, , selfClose] = m
      if (close) {
        if (stack.pop() !== tag) {
          broken = true
          break
        }
      } else if (!selfClose) {
        stack.push(tag)
      }
    }
    if (broken || stack.length) bad.push(name)
  }
  return bad
}

describe("母版保真引擎 · 嵌套样式容器的 XML 配对", () => {
  it("样张页 rPr/bodyPr/pPr 含自闭合子元素时，产出的 pptx 每个部件都是良构 XML", () => {
    const tpl = makeTemplate({ nestedRunStyle: true })
    const insp = inspectFidelityTemplate(tpl)
    expect(insp, "引擎应能读取该模板").not.toBeNull()
    expect(insp!.slides.filter((s) => s.usable).length).toBeGreaterThan(0)

    const out = buildFidelityDeck(tpl, [
      { title: "某医院智慧医院建设规划汇报", lines: ["汇报对象：院领导", "2026年11月"] },
      { title: "一体化平台支撑评级达成", lines: ["接口全量接入中台", "临床AI限定明确场景"] },
    ])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    // 这条断言就是真实缺陷的回归锁：修复前 slide1.xml/slide2.xml 都会进 bad 列表
    expect(badXmlParts(out.bytes), "产出含标签不匹配的 XML 部件——文件将无法被 PowerPoint 打开").toEqual([])
  })

  it("对照用例：rPr 无嵌套时同样良构（证明不是靠特判通过）", () => {
    const tpl = makeTemplate({ nestedRunStyle: false })
    const out = buildFidelityDeck(tpl, [{ title: "标题", lines: ["正文一", "正文二"] }])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(badXmlParts(out.bytes)).toEqual([])
  })

  it("注入的文字按行完整保留（配对扫描不能把正文弄丢）", () => {
    const tpl = makeTemplate({ nestedRunStyle: true })
    const out = buildFidelityDeck(tpl, [{ title: "结论式标题", lines: ["要点一", "要点二", "要点三"] }])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const files = unzipSync(out.bytes)
    const slide = new TextDecoder().decode(files["ppt/slides/slide1.xml"] ?? new Uint8Array())
    for (const t of ["结论式标题", "要点一", "要点二", "要点三"]) {
      expect(slide, `文字「${t}」丢失`).toContain(t)
    }
    // 原文案必须被替换掉，不能残留在产物里
    expect(slide).not.toContain("原标题")
    expect(slide).not.toContain("原正文")
  })

  it("样式模板被保留（不是退化成无样式）", () => {
    const tpl = makeTemplate({ nestedRunStyle: true })
    const out = buildFidelityDeck(tpl, [{ title: "标题", lines: ["正文"] }])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const files = unzipSync(out.bytes)
    const slide = new TextDecoder().decode(files["ppt/slides/slide1.xml"] ?? new Uint8Array())
    // 嵌套的 ln 样式应完整保留（含闭合标签），这正是修复的核心
    expect(slide).toContain("<a:ln w=\"12700\"><a:noFill/></a:ln>")
    expect(slide).toContain("normAutofit")
  })
})

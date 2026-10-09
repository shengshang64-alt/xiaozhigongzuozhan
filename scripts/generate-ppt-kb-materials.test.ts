// scripts/generate-ppt-kb-materials.test.ts — 附五·交付材料生成（第二批）：
// ① PPT 模板保真样例：用「公司标准模板样张」（标题+正文占位）× 真实投标章节 specs，
//    走 buildFidelityDeck 保真通道产出 .pptx（与浏览器导出走同一份引擎代码）
// ② 知识库章节用途分类清单：从 kb_section 抽取实施方案类样本（md 材料）
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { zipSync, strToU8, strFromU8, unzipSync } from "fflate"
import { buildFidelityDeck, type FidelitySlideSpec } from "../src/pages/PptQuote/templateFidelity"

const OUT_DIR = "C:/Users/Administrator/Downloads/测试材料"
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

/** 公司标准模板样张（最小 OOXML：封面样张=标题占位；内容样张=标题+正文占位；母版/版式/主题齐备） */
function companyTemplate(): Uint8Array {
  const spTitle = (t: string) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-CN" sz="4000" b="1"/><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`
  const spBody = (t: string) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="B"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:pPr marL="216000"/><a:r><a:rPr lang="zh-CN" sz="1600"/><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`
  const slideDoc = (shapes: string) =>
    `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${shapes}</p:spTree></p:cSld></p:sld>`
  const relsFor = () =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`
  const masterRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`
  const entries: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`,
    ),
    "ppt/presentation.xml": strToU8(
      `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
    ),
    "ppt/_rels/presentation.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${REL}/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/></Relationships>`,
    ),
    "ppt/theme/theme1.xml": strToU8(`<a:theme xmlns:a="a">MARKER-THEME</a:theme>`),
    "ppt/slideMasters/slideMaster1.xml": strToU8(
      `<p:sldMaster xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>MARKER-MASTER</p:spTree></p:cSld></p:sldMaster>`,
    ),
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": strToU8(masterRels),
    "ppt/slideLayouts/slideLayout1.xml": strToU8(
      `<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>LAYOUT-MARKER</p:spTree></p:cSld></p:sldLayout>`,
    ),
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": strToU8(masterRels),
    "ppt/slides/slide1.xml": strToU8(slideDoc(spTitle("旧封面") + spBody("旧正文"))),
    "ppt/slides/_rels/slide1.xml.rels": strToU8(relsFor()),
  }
  return zipSync(entries)
}

describe("附五·交付材料生成：PPT 保真样例", () => {
  it("① 按公司模板样张生成图文并茂 PPT（真实投标章节）", () => {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const template = companyTemplate()
    const specs: FidelitySlideSpec[] = [
      { title: "安庆市第二人民医院智慧医院信息化系统", lines: ["汇报单位：智业软件", "2026 年 10 月"] },
      {
        title: "项目背景与建设要求",
        lines: ["等级保护三级要求", "电子病历四级、互联互通四甲建设目标", "2026 年 12 月前完成立项"],
        image: { base64: PNG_1PX, ext: "png" },
      },
      { title: "总体架构设计", lines: ["统一门户", "集成平台", "数据中心", "核心业务系统"], image: { base64: PNG_1PX, ext: "png" } },
      { title: "实施与售后服务", lines: ["实施周期 6-8 个月", "7×24 小时响应", "驻场运维 3 年"] },
    ]
    const out = buildFidelityDeck(template, specs)
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error(out.reason)
    const outPath = path.join(OUT_DIR, "PPT保真样例-智慧医院方案（模板通道）.pptx")
    fs.writeFileSync(outPath, Buffer.from(out.bytes))
    // 结构合规断言：4 页生成、模板母版/版式/主题原样携带、带图页媒体/关系落包
    const zip = unzipSync(out.bytes)
    const names = Object.keys(zip)
    expect(names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length).toBe(4)
    expect(zip["ppt/slideMasters/slideMaster1.xml"]).toBeDefined()
    expect(strFromU8(zip["ppt/theme/theme1.xml"])).toContain("MARKER-THEME")
    const relsAll = names
      .filter((n) => n.startsWith("ppt/slides/_rels/"))
      .map((n) => strFromU8(zip[n]))
      .join("\n")
    expect(relsAll).toContain("/media/image")
    console.log("MATERIAL:", outPath, "| slides:", out.slideCount)
  })
})

import { describe, expect, it } from "vitest"
import { zipSync, strToU8 } from "fflate"
import {
  parseTemplateOutline,
  recommendMapping,
  resolveMapping,
  mappingSummary,
  parseTemplateMapping,
  type TemplateOutline,
} from "./templateLayouts"
import { SLIDE_KINDS } from "./deckSchema"

// ---------------------------------------------------------------------------
// 阶段 3 验收测试：公司模板版式解析与映射
//
// 对应需求（用户第 7 条）：
//   · 解析并展示模板中的 slideMaster、slideLayout、版式名称
//   · 提供"页面类型—模板版式"映射，允许调整并保存
//   · 模板没有合适版式时明确提示，不得静默降级
//   · 不允许只提取模板颜色和字体，就宣称"已按公司模板生成"
// ---------------------------------------------------------------------------

/** 构造一个最小可解析的 pptx 包（只含版式与母版 XML） */
function makePptx(layouts: { name: string; phs: string[] }[], masterCount = 1): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  // 母版
  for (let i = 1; i <= masterCount; i += 1) {
    files[`ppt/slideMasters/slideMaster${i}.xml`] = strToU8(`<?xml version="1.0"?><p:sldMaster><p:cSld name="母版${i}"/></p:sldMaster>`)
  }
  layouts.forEach((l, i) => {
    const n = i + 1
    const phXml = l.phs
      .map((p, j) => (p === "title" || p === "ctrTitle" ? `<p:ph type="${p}"/>` : `<p:ph type="${p}" idx="${j + 1}"/>`))
      .join("")
    files[`ppt/slideLayouts/slideLayout${n}.xml`] = strToU8(
      `<?xml version="1.0"?><p:sldLayout><p:cSld name="${l.name}"><p:spTree>${phXml}</p:spTree></p:cSld></p:sldLayout>`,
    )
    files[`ppt/slideLayouts/_rels/slideLayout${n}.xml.rels`] = strToU8(
      `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="slidemaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
    )
  })
  files["[Content_Types].xml"] = strToU8(`<?xml version="1.0"?><Types/>`)
  return zipSync(files)
}

/** 典型公司模板：有标题版、节标题版、封面版 */
const GOOD = makePptx([
  { name: "标题幻灯片", phs: ["ctrTitle", "subTitle"] },
  { name: "目录", phs: ["title", "body"] },
  { name: "节标题", phs: ["title"] },
  { name: "标题和内容", phs: ["title", "body"] },
  { name: "图片与标题", phs: ["title", "pic"] },
  { name: "尾页", phs: [] },
])

/** 真实场景：多数版式只有标题，没有正文占位（实测公司模板就长这样） */
const TITLE_ONLY = makePptx([
  { name: "标题幻灯片", phs: [] },
  { name: "空白", phs: ["title"] },
  { name: "仅标题", phs: ["title"] },
  { name: "尾页", phs: [] },
])

describe("parseTemplateOutline：解析模板版式", () => {
  it("解析出全部版式、名称与占位符", () => {
    const o = parseTemplateOutline(GOOD)
    expect(o.failure).toBeNull()
    expect(o.masterCount).toBe(1)
    expect(o.layouts).toHaveLength(6)
    expect(o.layouts.map((l) => l.name)).toContain("标题和内容")
    const content = o.layouts.find((l) => l.name === "标题和内容")!
    expect(content.hasTitle).toBe(true)
    expect(content.hasBody).toBe(true)
    expect(content.placeholders.map((p) => p.kind)).toEqual(["title", "body"])
  })

  it("识别母版关联", () => {
    const o = parseTemplateOutline(GOOD)
    expect(o.layouts[0].masterPath).toContain("slideMaster1.xml")
  })

  it("无版式时给出明确失败原因（不静默降级）", () => {
    const empty = zipSync({ "[Content_Types].xml": strToU8("<Types/>") })
    const o = parseTemplateOutline(empty)
    expect(o.failure).toContain("没有找到任何版式")
    expect(o.layouts).toHaveLength(0)
  })

  it("非 zip 包时给出明确失败原因", () => {
    const o = parseTemplateOutline(strToU8("not a zip"))
    expect(o.failure).toContain("不是有效的 pptx")
  })
})

describe("recommendMapping：kind → 版式自动推荐", () => {
  it("全部 kind 都能映射到版式（标准模板）", () => {
    const o = parseTemplateOutline(GOOD)
    const m = recommendMapping(o)
    const res = resolveMapping(o, m)
    expect(res.missing).toHaveLength(0)
    for (const k of SLIDE_KINDS) expect(res.resolved[k]).toBeTruthy()
  })

  it("封面/目录/章节/结束页按名称语义匹配", () => {
    const o = parseTemplateOutline(GOOD)
    const res = resolveMapping(o, recommendMapping(o))
    expect(res.resolved.cover?.name).toBe("标题幻灯片")
    expect(res.resolved.agenda?.name).toBe("目录")
    expect(res.resolved.section?.name).toBe("节标题")
    expect(res.resolved.summary?.name).toBe("尾页")
  })

  it("图片页优先匹配含图片占位符的版式", () => {
    const o = parseTemplateOutline(GOOD)
    const res = resolveMapping(o, recommendMapping(o))
    expect(res.resolved.image?.name).toBe("图片与标题")
  })

  it("真实场景：版式只有标题占位 → 仍能映射，但标记 bodyFromRenderer", () => {
    const o = parseTemplateOutline(TITLE_ONLY)
    const res = resolveMapping(o, recommendMapping(o))
    expect(res.missing).toHaveLength(0) // 不再全部失败
    expect(res.resolved.bullets).toBeTruthy()
    // 正文区需渲染器自绘，导出时要提示用户
    expect(res.bodyFromRenderer.length).toBeGreaterThan(0)
  })
})

describe("resolveMapping：映射解析与缺失提示", () => {
  it("用户手动清空某项 → 该 kind 进 missing（明确提示）", () => {
    const o = parseTemplateOutline(GOOD)
    const m = recommendMapping(o)
    delete m.chart
    const res = resolveMapping(o, m)
    expect(res.missing).toContain("chart")
    expect(res.resolved.chart).toBeNull()
  })

  it("支持 layout3 / slideLayout3 两种 id 写法", () => {
    const o = parseTemplateOutline(GOOD)
    const a = resolveMapping(o, { cover: "layout1" })
    const b = resolveMapping(o, { cover: "slideLayout1" })
    expect(a.resolved.cover?.path).toBe(b.resolved.cover?.path)
  })
})

describe("parseTemplateMapping：映射校验", () => {
  it("合法映射通过", () => {
    const m = parseTemplateMapping({ cover: "layout1", bullets: "layout4" })
    expect(m).not.toBeNull()
    expect(m!.cover).toBe("layout1")
  })

  it("非法 kind 被丢弃但不报错（宽松）", () => {
    const m = parseTemplateMapping({ cover: "layout1", notAKind: "x" })
    expect(m).not.toBeNull()
    expect(m!.cover).toBe("layout1")
  })

  it("非对象输入返回 null", () => {
    expect(parseTemplateMapping(null)).toBeNull()
    expect(parseTemplateMapping("x")).toBeNull()
  })
})

describe("mappingSummary：给用户看的映射摘要", () => {
  it("按版式分组展示映射关系", () => {
    const o = parseTemplateOutline(GOOD)
    const s = mappingSummary(o, recommendMapping(o))
    expect(s).toContain("标题幻灯片")
    expect(s).toContain("封面")
    // 多 kind 共用一个版式时会合并展示
    expect(s).toContain("/")
  })
})

describe("模板解析性能与健壮性", () => {
  it("大模板不抛异常（只读 XML 不解压图片）", () => {
    const many = makePptx(Array.from({ length: 40 }, (_, i) => ({ name: `版式${i}`, phs: ["title", "body"] })))
    const o: TemplateOutline = parseTemplateOutline(many)
    expect(o.failure).toBeNull()
    expect(o.layouts).toHaveLength(40)
  })
})

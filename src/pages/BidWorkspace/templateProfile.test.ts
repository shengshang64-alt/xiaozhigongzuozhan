import { describe, expect, it } from "vitest"
import {
  alignRequirements,
  buildTemplateProfile,
  classifyRequirement,
  emptySpecFacts,
  templateProfileOf,
  templateRequirementLines,
  textSimilarity,
  type TemplateSpecFacts,
} from "./templateProfile"
import {
  DEFAULT_FORMAT_SETTINGS,
  isMeaningfulTemplateProfile,
  normalizeTemplateProfile,
  type FormatSettings,
  type TemplateProfile,
} from "./bidTypes"
import type { ExtractedFormat } from "./bidDocxFormatExtract"

// R47（B20）商务模板识别编排层：本文件只测纯函数（DOMParser / 真 docx 那半边在
// bidDocxFormatExtract.test.ts 与实机验收里覆盖），fixture 全部手写。

type Head = TemplateSpecFacts["headings"][number]

function ext(partial: Partial<ExtractedFormat> = {}): ExtractedFormat {
  return { evidence: {}, ...partial }
}

function settings(patch: Partial<FormatSettings> = {}): FormatSettings {
  return { ...DEFAULT_FORMAT_SETTINGS, ...patch }
}

function head(level: number, fontEastAsia: string, sizePt: number, align: Head["align"] = "left"): Head {
  return {
    level,
    fontEastAsia,
    fontAscii: "",
    sizePt,
    bold: false,
    align,
    lineSpacing: "",
    firstLineChars: 0,
    colorRgb: "",
    styleId: "Heading" + level,
    styleName: "heading " + level,
  }
}

function spec(
  partial: { headings?: Head[]; bodyFont?: string; bodySizePt?: number } = {},
): TemplateSpecFacts {
  const base = emptySpecFacts()
  return {
    headings: partial.headings ?? base.headings,
    body: {
      ...base.body,
      fontEastAsia: partial.bodyFont ?? base.body.fontEastAsia,
      sizePt: partial.bodySizePt ?? base.body.sizePt,
    },
  }
}

describe("R47 模板要求 ↔ 招标条目近似匹配（本地规则，零 AI）", () => {
  it("完全一致 / 互相包含一律判 1（长条款里含短要求也认得出）", () => {
    expect(textSimilarity("投标人须提供营业执照", "投标人须提供营业执照")).toBe(1)
    expect(textSimilarity("须提供营业执照", "投标人须提供营业执照副本复印件")).toBe(1)
    expect(textSimilarity("投标人须提供营业执照副本复印件", "须提供营业执照")).toBe(1)
  })

  it("标点 / 空白 / 全角半角差异不算差异", () => {
    expect(textSimilarity("须提供：营业执照（复印件）", "须提供 营业执照 复印件")).toBe(1)
  })

  it("空串与无共同字的两句判 0（不硬凑）", () => {
    expect(textSimilarity("", "须提供营业执照")).toBe(0)
    expect(textSimilarity("须提供营业执照", "")).toBe(0)
    expect(textSimilarity("▲▲▲", "须提供营业执照")).toBe(0)
  })

  it("只是同领域但不同一条的 → 低于阈值", () => {
    expect(textSimilarity("技术方案须包含系统总体架构设计", "投标保证金为人民币五万元")).toBeLessThan(0.34)
  })

  it("归类：★/▲ 与「与招标 ★ 条款同一条」都判实质性", () => {
    expect(classifyRequirement("★ 投标人须提供三年内同类项目业绩")).toBe("star")
    expect(classifyRequirement("▲ 系统须支持双向转诊")).toBe("star")
    expect(classifyRequirement("投标人须提供营业执照副本", ["投标人须提供营业执照副本复印件"])).toBe("star")
  })

  it("归类：排版口径关键词判 format（不进正文注入，走格式 patch）", () => {
    expect(classifyRequirement("格式要求：正文宋体小四，行距 1.5 倍")).toBe("format")
    expect(classifyRequirement("页边距上下 2.5cm，需带页码与目录")).toBe("format")
  })

  it("归类：其余内容要求判 content", () => {
    expect(classifyRequirement("第二章 技术方案须写明系统总体架构")).toBe("content")
  })
})

describe("R47 模板要求 ↔ 评分点 / ★ 条款对齐", () => {
  const lines = [
    "技术方案须包含系统总体架构设计",
    "格式要求：正文宋体小四",
    "★ 投标人须提供三年内同类项目业绩",
    "★ 投标人须提供三年内同类项目业绩",
  ]
  const scoreItems = ["技术方案须包含系统总体架构设计", "售后服务方案"]
  const starClauses = ["投标人须提供三年内同类项目业绩"]

  it("逐行去重落库，命中项回填招标条目名，kind 一并带上", () => {
    const { requirements } = alignRequirements(lines, scoreItems, starClauses)
    expect(requirements.map((r) => r.text)).toEqual([
      "技术方案须包含系统总体架构设计",
      "格式要求：正文宋体小四",
      "★ 投标人须提供三年内同类项目业绩",
    ])
    expect(requirements[0].matched).toContain("技术方案须包含系统总体架构设计")
    expect(requirements[1].kind).toBe("format")
    expect(requirements[2].kind).toBe("star")
  })

  it("统计口径：matched=命中的评分点+★ 条数，unmatched=招标有而模板没写对应要求行的条数", () => {
    const { alignment } = alignRequirements(lines, scoreItems, starClauses)
    expect(alignment).toEqual({ scoreItemCount: 2, starClauseCount: 1, matched: 2, unmatched: 1 })
  })

  it("limit 截断；三条通道都空时不炸且统计全 0", () => {
    expect(alignRequirements(["须包含甲", "须列明乙", "须写明丙"], [], [], 2).requirements).toHaveLength(2)
    expect(alignRequirements([], [], []).alignment).toEqual({
      scoreItemCount: 0,
      starClauseCount: 0,
      matched: 0,
      unmatched: 0,
    })
  })
})

describe("R47 模板画像组装（buildTemplateProfile）", () => {
  const base = { fileName: "商务模板.docx", settings: settings(), ext: ext() }

  it("六级标题：样式表定义=style，模板没单独定义的更高级别按上一级推定=sampled", () => {
    // align / size 取的是 formatSpec 桥接后的受限枚举（settings.heading）；原始 rFonts / sz 由桥接层负责映射，
    // 这里把桥接结果（1 级居中）传进来，验证画像如实透传。
    const bridged = settings({
      heading: DEFAULT_FORMAT_SETTINGS.heading.map((h, i) => (i === 0 ? { ...h, align: "center" } : h)),
    })
    const p = buildTemplateProfile({
      ...base,
      settings: bridged,
      spec: spec({ headings: [head(1, "黑体", 22, "center")] }),
    })
    expect(p.headings).toHaveLength(6)
    expect(p.headings[0]).toMatchObject({ level: 1, source: "style", font: "黑体", sizePt: 22, align: "center" })
    expect(p.patch.heading?.[0].align).toBe("center")
    expect(p.headings[1]).toMatchObject({ level: 2, source: "sampled", font: "黑体", sizePt: 22 })
    expect(p.notes.some((n) => n.includes("推定"))).toBe(true)
  })

  it("六级全缺 → 全 missing，并提示这几级按本项目缺省落地", () => {
    const p = buildTemplateProfile({ ...base, spec: spec() })
    expect(p.headings.every((h) => h.source === "missing")).toBe(true)
    expect(p.notes.some((n) => n.includes("1 / 2 / 3 / 4 / 5 / 6"))).toBe(true)
  })

  it("patch 只写模板明确表达的：没有表格/页眉页脚就不动这两项，也绝不碰暗标 sealed", () => {
    const p = buildTemplateProfile({ ...base, spec: spec({ headings: [head(1, "黑体", 22)] }) })
    expect(p.patch.paper).toBe(DEFAULT_FORMAT_SETTINGS.paper)
    expect(p.patch.heading).toEqual(DEFAULT_FORMAT_SETTINGS.heading)
    expect(p.patch.table).toBeUndefined()
    expect(p.patch.headerFooter).toBeUndefined()
    expect(p.patch.pageNumber).toBeUndefined()
    expect(p.patch.toc).toBeUndefined()
    expect("sealed" in p.patch).toBe(false)
  })

  it("检出表格 / 页眉页脚 / 目录 / 编号才写对应 patch；页码按有无 PAGE 域如实落地", () => {
    const p = buildTemplateProfile({
      ...base,
      spec: spec({ headings: [head(1, "黑体", 22)] }),
      ext: ext({
        table: { border: "1pt", contentFont: "宋体小四" },
        header: "智业软件",
        footer: "第 1 页",
        pageNumber: false,
        toc: true,
        titleNumbering: "chapter",
      }),
    })
    expect(p.patch.table).toEqual({ border: "1pt", contentFont: "宋体小四" })
    expect(p.patch.headerFooter).toBe(true)
    expect(p.patch.pageNumber).toBe(false)
    expect(p.patch.toc).toBe(true)
    expect(p.patch.titleNumbering).toBe("chapter")
    expect(p.notes.some((n) => n.includes("PAGE"))).toBe(true)
  })

  it("原始值没识别到时退回本项目缺省串（不写 0 / 空）", () => {
    const p = buildTemplateProfile({ ...base, spec: spec() })
    expect(p.body.font).toBe(DEFAULT_FORMAT_SETTINGS.body.font)
    expect(p.body.size).toBe(DEFAULT_FORMAT_SETTINGS.body.size)
    expect(p.body.sizePt).toBe(0)
    expect(p.page.paper).toBe(DEFAULT_FORMAT_SETTINGS.paper)
    expect(p.notes.some((n) => n.includes("没有页眉页脚"))).toBe(true)
  })

  it("模板要求落库；不给招标原文就说明未对齐，给了招标原文才做对齐统计", () => {
    const withReq = {
      ...base,
      spec: spec({ headings: [head(1, "黑体", 22)] }),
      ext: ext({ requirements: ["技术方案须包含系统总体架构设计", "格式要求：正文宋体小四"] }),
    }
    const noTender = buildTemplateProfile(withReq)
    expect(noTender.requirements).toHaveLength(2)
    expect(noTender.alignment).toEqual({ scoreItemCount: 0, starClauseCount: 0, matched: 0, unmatched: 0 })
    expect(noTender.notes.some((n) => n.includes("未提供招标原文"))).toBe(true)

    const withTender = buildTemplateProfile({
      ...withReq,
      ext: ext({
        requirements: ["技术方案须包含系统总体架构设计", "★ 投标人须提供三年内同类项目业绩"],
      }),
      opts: { tenderText: "评标办法\n技术方案须包含系统总体架构设计 15分\n★ 投标人须提供三年内同类项目业绩\n" },
    })
    expect(withTender.alignment.starClauseCount).toBe(1)
    expect(withTender.alignment.matched).toBeGreaterThanOrEqual(1)
    expect(withTender.notes.some((n) => n.includes("与招标文件对齐"))).toBe(true)
  })

  it("没有要求行时不写「检出 N 条要求」的说明", () => {
    const p = buildTemplateProfile({ ...base, spec: spec({ headings: [head(1, "黑体", 22)] }) })
    expect(p.requirements).toHaveLength(0)
    expect(p.notes.some((n) => n.includes("要求，已写入"))).toBe(false)
  })
})

describe("R47 模板画像落库 / 读取容错", () => {
  it("非对象 → null（=未上传模板，老项目行为不变）", () => {
    expect(normalizeTemplateProfile(null)).toBeNull()
    expect(normalizeTemplateProfile(undefined)).toBeNull()
    expect(normalizeTemplateProfile("模版")).toBeNull()
    expect(normalizeTemplateProfile(42)).toBeNull()
  })

  it("非法枚举 / 越界数值 / 空文本一律落回缺省，不穿透进导出", () => {
    const q = normalizeTemplateProfile({
      paper: "Letter",
      headings: [{ level: 1, font: "黑体", sizePt: -3, size: "巨无霸", align: "斜着" }],
      titleNumbering: "bogus",
      page: { margins: { top: "abc" } },
      body: { firstIndent: 99 },
      requirements: [{ text: "   " }, { kind: "weird", text: "须提供 X" }],
      alignment: { matched: "3" },
    }) as TemplateProfile
    expect(q.page.paper).toBe(DEFAULT_FORMAT_SETTINGS.paper)
    expect(q.page.margins.top).toBe(DEFAULT_FORMAT_SETTINGS.margins.top)
    expect(q.headings[0].sizePt).toBe(0)
    expect(q.headings[0].size).toBe(DEFAULT_FORMAT_SETTINGS.heading[0].size)
    expect(q.headings[0].align).toBe(DEFAULT_FORMAT_SETTINGS.heading[0].align)
    expect(q.headings[1].source).toBe("missing")
    expect(q.titleNumbering).toBe(DEFAULT_FORMAT_SETTINGS.titleNumbering)
    expect(q.body.firstIndent).toBe(4)
    expect(q.requirements).toHaveLength(1)
    expect(q.requirements[0].kind).toBe("content")
    expect(q.alignment.matched).toBe(3)
  })

  it("是否值得落库：全 missing 且无要求无 extras → false；有一条要求 → true", () => {
    const empty = normalizeTemplateProfile({ headings: [] })
    expect(isMeaningfulTemplateProfile(empty)).toBe(false)
    expect(isMeaningfulTemplateProfile(null)).toBe(false)
    const withReq = normalizeTemplateProfile({ requirements: [{ text: "须包含总体架构" }] })
    expect(isMeaningfulTemplateProfile(withReq)).toBe(true)
  })

  it("templateProfileOf：项目没识别过模板时返回 null，识别过时原样取出", () => {
    expect(templateProfileOf(undefined)).toBeNull()
    expect(templateProfileOf(settings())).toBeNull()
    const profile = buildTemplateProfile({
      fileName: "商务模板.docx",
      spec: spec({ headings: [head(1, "黑体", 22)] }),
      settings: settings(),
      ext: ext(),
    })
    const back = templateProfileOf(settings({ templateProfile: profile }))
    expect(back?.headings[0]).toMatchObject({ source: "style", font: "黑体", sizePt: 22 })
    expect(back?.sourceFileName).toBe("商务模板.docx")
  })
})

describe("R47 写作注入用要求行", () => {
  const profile = buildTemplateProfile({
    fileName: "商务模板.docx",
    spec: spec({ headings: [head(1, "黑体", 22)] }),
    settings: settings(),
    ext: ext({
      requirements: ["技术方案须包含系统总体架构设计", "格式要求：正文宋体小四", "★ 投标人须提供三年内同类项目业绩"],
    }),
  })

  it("只取 content / star，排版口径的 format 不进正文提示词（它们已进格式 patch）", () => {
    expect(templateRequirementLines(profile)).toEqual([
      "技术方案须包含系统总体架构设计",
      "★ 投标人须提供三年内同类项目业绩",
    ])
  })

  it("limit 生效；未上传模板时返回空数组（提示词零注入，老项目行为不变）", () => {
    expect(templateRequirementLines(profile, 1)).toEqual(["技术方案须包含系统总体架构设计"])
    expect(templateRequirementLines(null)).toEqual([])
  })
})

import { describe, expect, it } from "vitest"
import { runFormatChecks } from "./format"
import { emptyMeta } from "../engine/docxInspect"
import { DEFAULT_CHECK_CONFIG, type CheckConfig } from "../config/checkConfig"
import { DEFAULT_ANBID_CONFIG, type AnbidCheckConfig } from "../config/anbidCheckConfig"
import type { CheckItem, DocContext } from "../bidCheckTypes"

function makeCtx(over: Partial<DocContext> = {}): DocContext {
  return {
    sourceName: over.sourceName ?? "投标文件.docx",
    inputKind: over.inputKind ?? "file",
    hasPackage: over.hasPackage ?? true,
    chapters: over.chapters ?? [],
    paragraphs: over.paragraphs ?? [],
    chapterOf: over.chapterOf ?? [],
    fullText: over.fullText ?? "",
    meta: over.meta ?? emptyMeta(),
  }
}

function byCode(items: CheckItem[], code: string): CheckItem | undefined {
  return items.find((it) => it.code === code)
}
function byTitle(items: CheckItem[], title: string): CheckItem | undefined {
  return items.find((it) => it.title === title)
}

const cfg: CheckConfig = DEFAULT_CHECK_CONFIG

describe("format L1 · 正文禁则复用", () => {
  it("装饰残留命中产出一条 L1 文本项（warn）", () => {
    const ctx = makeCtx({ chapters: [{ title: "第一章", content: "【注意】这里残留了装饰符号" }] })
    const items = runFormatChecks(ctx, cfg, DEFAULT_ANBID_CONFIG, "normal")
    const decoration = items.find((it) => it.title.includes("装饰") || it.category === "正文格式")
    expect(items.some((it) => it.code.startsWith("L1-T"))).toBe(true)
    expect(decoration).toBeTruthy()
  })

  it("identity_leak 交由 L5，L1 不产出该项", () => {
    const ctx = makeCtx({ chapters: [{ title: "第一章", content: "某某科技有限公司简介" }] })
    const items = runFormatChecks(ctx, cfg, DEFAULT_ANBID_CONFIG, "normal")
    expect(items.some((it) => it.basis.includes("身份") && it.title.includes("暗标身份"))).toBe(false)
  })
})

describe("format L1 · 结构类依赖文件包", () => {
  it("无 docx 包（项目正文）：结构项标 skipped", () => {
    const ctx = makeCtx({ inputKind: "project", hasPackage: false, meta: emptyMeta(), chapters: [{ title: "章", content: "正文" }] })
    const items = runFormatChecks(ctx, cfg, DEFAULT_ANBID_CONFIG, "normal")
    expect(byCode(items, "L1-1")?.status).toBe("skipped")
    expect(byCode(items, "L1-2")?.status).toBe("skipped")
  })

  it("有包且出现 ≥2 种字体：字体一致性 warn", () => {
    const meta = emptyMeta()
    meta.available = true
    meta.fontsUsed = ["宋体", "黑体"]
    meta.sizesUsed = ["24"]
    const ctx = makeCtx({ meta })
    const items = runFormatChecks(ctx, cfg, DEFAULT_ANBID_CONFIG, "normal")
    expect(byCode(items, "L1-1")?.status).toBe("warn")
    expect(byCode(items, "L1-2")?.status).toBe("pass")
  })
})

describe("format L1 · 字号/行距达标（R269 接入预留配置项 bodySize/lineSpacing）", () => {
  function anbidWith(std: Partial<typeof DEFAULT_ANBID_CONFIG.formatStandard>): AnbidCheckConfig {
    return { ...DEFAULT_ANBID_CONFIG, formatStandard: { ...DEFAULT_ANBID_CONFIG.formatStandard, ...std } }
  }

  it("bodySize 未配置：L1-13 unconfigured", () => {
    const meta = emptyMeta(); meta.available = true; meta.sizesUsed = ["24"]
    const items = runFormatChecks(makeCtx({ meta }), cfg, DEFAULT_ANBID_CONFIG, "normal")
    expect(byCode(items, "L1-13")?.status).toBe("unconfigured")
  })

  it("bodySize=小四 且正文统一 24 半点：L1-13 pass", () => {
    const meta = emptyMeta(); meta.available = true; meta.sizesUsed = ["24"]
    const items = runFormatChecks(makeCtx({ meta }), cfg, anbidWith({ bodySize: "小四" }), "normal")
    expect(byCode(items, "L1-13")?.status).toBe("pass")
  })

  it("bodySize=小四 但出现非 24 字号：L1-13 warn（只报不拦 medium）", () => {
    const meta = emptyMeta(); meta.available = true; meta.sizesUsed = ["24", "32"]
    const items = runFormatChecks(makeCtx({ meta }), cfg, anbidWith({ bodySize: "小四" }), "normal")
    const it = byCode(items, "L1-13")
    expect(it?.status).toBe("warn")
    expect(it?.severity).toBe("medium")
    expect(it?.hits[0]?.rule).toBe("size_std")
  })

  it("无法识别的字号要求：L1-13 unconfigured（不瞎判）", () => {
    const meta = emptyMeta(); meta.available = true; meta.sizesUsed = ["24"]
    const items = runFormatChecks(makeCtx({ meta }), cfg, anbidWith({ bodySize: "火星文" }), "normal")
    expect(byCode(items, "L1-13")?.status).toBe("unconfigured")
  })

  it("lineSpacing=1.5倍 且文档有 360:auto：L1-14 pass", () => {
    const meta = emptyMeta(); meta.available = true; meta.lineSpacingsDetail = [{ line: "360", rule: "auto" }]
    const items = runFormatChecks(makeCtx({ meta }), cfg, anbidWith({ lineSpacing: "1.5倍" }), "normal")
    expect(byCode(items, "L1-14")?.status).toBe("pass")
  })

  it("lineSpacing=1.5倍 但文档仅单倍：L1-14 warn", () => {
    const meta = emptyMeta(); meta.available = true; meta.lineSpacingsDetail = [{ line: "240", rule: "auto" }]
    const items = runFormatChecks(makeCtx({ meta }), cfg, anbidWith({ lineSpacing: "1.5倍" }), "normal")
    expect(byCode(items, "L1-14")?.status).toBe("warn")
  })

  it("lineSpacing=固定28磅 且文档有 560:exact：L1-14 pass", () => {
    const meta = emptyMeta(); meta.available = true; meta.lineSpacingsDetail = [{ line: "560", rule: "exact" }]
    const items = runFormatChecks(makeCtx({ meta }), cfg, anbidWith({ lineSpacing: "固定28磅" }), "normal")
    expect(byCode(items, "L1-14")?.status).toBe("pass")
  })

  it("无 docx 包：L1-13/L1-14 skipped", () => {
    const ctx = makeCtx({ inputKind: "project", hasPackage: false, meta: emptyMeta(), chapters: [{ title: "章", content: "正文" }] })
    const items = runFormatChecks(ctx, cfg, anbidWith({ bodySize: "小四", lineSpacing: "1.5倍" }), "normal")
    expect(byCode(items, "L1-13")?.status).toBe("skipped")
    expect(byCode(items, "L1-14")?.status).toBe("skipped")
  })
})

describe("format L1 · 未配置不瞎判 + 暗标升级", () => {
  it("页数上限未配置：L1-12 unconfigured", () => {
    const meta = emptyMeta()
    meta.available = true
    const ctx = makeCtx({ meta })
    const items = runFormatChecks(ctx, cfg, DEFAULT_ANBID_CONFIG, "sealed")
    expect(byCode(items, "L1-12")?.status).toBe("unconfigured")
  })

  it("暗标模式页数超限：L1-12 升 critical 且 fail", () => {
    const meta = emptyMeta()
    meta.available = true
    meta.pageEstimate = 120
    const anbid: AnbidCheckConfig = { ...DEFAULT_ANBID_CONFIG, formatStandard: { ...DEFAULT_ANBID_CONFIG.formatStandard, maxPages: 80 } }
    const items = runFormatChecks(makeCtx({ meta }), cfg, anbid, "sealed")
    const it = byCode(items, "L1-12")
    expect(it?.status).toBe("fail")
    expect(it?.severity).toBe("critical")
  })

  it("页边距配置后偏差即判 fail", () => {
    const meta = emptyMeta()
    meta.available = true
    meta.margins = { top: 2.54, right: 3.17, bottom: 2.54, left: 3.17 }
    const anbid: AnbidCheckConfig = {
      ...DEFAULT_ANBID_CONFIG,
      formatStandard: { ...DEFAULT_ANBID_CONFIG.formatStandard, margins: { top: 3.0, right: 3.0, bottom: 3.0, left: 3.0 } },
    }
    const items = runFormatChecks(makeCtx({ meta }), cfg, anbid, "normal")
    expect(byTitle(items, "页边距不符")?.status).toBe("fail")
  })
})

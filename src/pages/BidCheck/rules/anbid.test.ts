import { describe, expect, it } from "vitest"
import { runAnbidChecks } from "./anbid"
import { emptyMeta } from "../engine/docxInspect"
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

describe("anbid L5 · 非暗标模式", () => {
  it("普通模式返回空数组（L5 不启用）", () => {
    expect(runAnbidChecks(makeCtx(), DEFAULT_ANBID_CONFIG, false)).toEqual([])
  })
})

describe("anbid L5-A · 主体身份泄露", () => {
  const cfg: AnbidCheckConfig = { ...DEFAULT_ANBID_CONFIG, identityWords: ["某某科技"] }
  const text =
    "某某科技成立于2000年\n联系电话13800138000 邮箱 sales@example.com\n统一社会信用代码91310000MA1FL0123X\n我司已在同仁医院上线运行该系统"
  const ctx = makeCtx({ chapters: [{ title: "公司简介", content: text }], fullText: text })
  const items = runAnbidChecks(ctx, cfg, true)

  it("公司词 / 手机 / 邮箱 / 信用代码 / 案例 / 第一人称 均命中", () => {
    expect(byCode(items, "L5-A1")?.status).toBe("fail")
    expect(byCode(items, "L5-A4")?.hits.length).toBeGreaterThan(0)
    expect(byCode(items, "L5-A6")?.hits.length).toBeGreaterThan(0)
    expect(byCode(items, "L5-A8")?.hits.length).toBeGreaterThan(0)
    expect(byCode(items, "L5-F1")?.hits.length).toBeGreaterThan(0)
  })

  it("命中项附五要素：位置 / 原文 / 依据", () => {
    const hit = byCode(items, "L5-A1")!.hits[0]
    expect(hit.location).toBeTruthy()
    expect(hit.text).toContain("某某科技")
    expect(byCode(items, "L5-A1")!.basis).toContain("暗标")
  })
})

describe("anbid L5-B · 元数据与痕迹", () => {
  it("docx 包：作者 / 公司 / 批注 / 隐藏文字命中即 fail", () => {
    const meta = emptyMeta()
    meta.available = true
    meta.creator = "张三"
    meta.company = "某某科技有限公司"
    meta.hasComments = true
    meta.commentAuthors = ["李四"]
    meta.hasHiddenText = true
    const items = runAnbidChecks(makeCtx({ meta }), DEFAULT_ANBID_CONFIG, true)
    expect(byCode(items, "L5-B1")?.status).toBe("fail")
    expect(byCode(items, "L5-B2")?.status).toBe("fail")
    expect(byCode(items, "L5-B4")?.status).toBe("fail")
    expect(byCode(items, "L5-B5")?.status).toBe("fail")
  })

  it("非包输入（项目正文）：节点痕迹项标 skipped", () => {
    const ctx = makeCtx({ inputKind: "project", hasPackage: false, meta: emptyMeta() })
    const items = runAnbidChecks(ctx, DEFAULT_ANBID_CONFIG, true)
    expect(byCode(items, "L5-B4")?.status).toBe("skipped")
    expect(byCode(items, "L5-B5")?.status).toBe("skipped")
    expect(byCode(items, "L5-B8")?.status).toBe("skipped")
  })
})

describe("anbid L5-C/E · 标准未配置不瞎判", () => {
  it("格式标准留空时相关项标 unconfigured", () => {
    const items = runAnbidChecks(makeCtx(), DEFAULT_ANBID_CONFIG, true)
    expect(byCode(items, "L5-C9")?.status).toBe("unconfigured")
    expect(byCode(items, "L5-E2")?.status).toBe("unconfigured")
  })

  it("配置页数上限后超限即判 fail", () => {
    const meta = emptyMeta()
    meta.available = true
    meta.pageEstimate = 120
    const cfg: AnbidCheckConfig = {
      ...DEFAULT_ANBID_CONFIG,
      formatStandard: { ...DEFAULT_ANBID_CONFIG.formatStandard, maxPages: 80 },
    }
    const items = runAnbidChecks(makeCtx({ meta }), cfg, true)
    expect(byCode(items, "L5-C9")?.status).toBe("fail")
  })
})

describe("anbid L5-E1 · 文件名", () => {
  it("文件名含身份词命中", () => {
    const cfg: AnbidCheckConfig = { ...DEFAULT_ANBID_CONFIG, identityWords: ["某某科技"] }
    const items = runAnbidChecks(makeCtx({ sourceName: "某某科技-技术方案.docx" }), cfg, true)
    expect(byCode(items, "L5-E1")?.status).toBe("fail")
  })
})

describe("anbid L5-C1 · 正文字体（生效字体继承链，R45）", () => {
  const cfg: AnbidCheckConfig = {
    ...DEFAULT_ANBID_CONFIG,
    formatStandard: { ...DEFAULT_ANBID_CONFIG.formatStandard, bodyFont: "宋体" },
  }

  it("run 自身不写字体、字体来自样式/文档默认时也能判 pass（旧口径会漏检）", () => {
    const meta = emptyMeta()
    meta.available = true
    meta.fontsUsed = [] // 旧口径：document.xml 内没有任何 w:rFonts/@eastAsia
    meta.fontsEffective = [{ font: "宋体", count: 12, sample: "投标人须具备独立法人资格" }]
    meta.fontsUnresolvedRuns = 0
    const c1 = byCode(runAnbidChecks(makeCtx({ meta }), cfg, true), "L5-C1")
    expect(c1?.status).toBe("pass")
    expect(c1?.basis).toContain("宋体×12处")
  })

  it("别名互认：SimSun 与「宋体」不再互判为不同字体", () => {
    const meta = emptyMeta()
    meta.available = true
    meta.fontsEffective = [{ font: "SimSun", count: 3, sample: "第一章 项目概述" }]
    const c1 = byCode(runAnbidChecks(makeCtx({ meta }), cfg, true), "L5-C1")
    expect(c1?.status).toBe("pass")
  })

  it("确混入其它字体：命中并给出分布与样本", () => {
    const meta = emptyMeta()
    meta.available = true
    meta.fontsEffective = [
      { font: "宋体", count: 40, sample: "正文" },
      { font: "黑体", count: 2, sample: "擅自改动" },
    ]
    const c1 = byCode(runAnbidChecks(makeCtx({ meta }), cfg, true), "L5-C1")
    expect(c1?.status).toBe("fail")
    expect(c1?.hits[0]?.text).toContain("黑体")
    expect(c1?.basis).toContain("宋体×40处")
  })

  it("有段落取不到字体：既不判 pass 也不判废标，降级 warn 交人工核对", () => {
    const meta = emptyMeta()
    meta.available = true
    meta.fontsEffective = [{ font: "宋体", count: 5, sample: "正文" }]
    meta.fontsUnresolvedRuns = 2
    const c1 = byCode(runAnbidChecks(makeCtx({ meta }), cfg, true), "L5-C1")
    expect(c1?.status).toBe("warn")
    expect(c1?.basis).toContain("2 处")
  })

  it("生效字体为空：回退 fontsUsed 旧口径（如实标注出现过的字体）", () => {
    const meta = emptyMeta()
    meta.available = true
    meta.fontsUsed = ["楷体"]
    const c1 = byCode(runAnbidChecks(makeCtx({ meta }), cfg, true), "L5-C1")
    expect(c1?.status).toBe("fail")
    expect(c1?.hits[0]?.text).toContain("楷体")
  })
})

describe("anbid L5-C10 · 编号形式（禁用项目符号，R45）", () => {
  const base: AnbidCheckConfig = {
    ...DEFAULT_ANBID_CONFIG,
    formatStandard: { ...DEFAULT_ANBID_CONFIG.formatStandard, allowBulletNumbering: false },
  }

  it("要求数字编号而出现项目符号：判失败，并给出形式分布", () => {
    const meta = emptyMeta()
    meta.available = true
    meta.numberedParagraphs = 5
    meta.bulletParagraphs = 3
    meta.numberingFormats = [
      { format: "bullet", count: 3 },
      { format: "decimal", count: 2 },
    ]
    const c10 = byCode(runAnbidChecks(makeCtx({ meta }), base, true), "L5-C10")
    expect(c10?.status).toBe("fail")
    expect(c10?.hits[0]?.text).toContain("3 处")
    expect(c10?.basis).toContain("项目符号×3处")
    expect(c10?.basis).toContain("阿拉伯数字×2处")
  })

  it("全是数字编号：判通过", () => {
    const meta = emptyMeta()
    meta.available = true
    meta.numberedParagraphs = 4
    meta.bulletParagraphs = 0
    meta.numberingFormats = [{ format: "decimal", count: 4 }]
    const c10 = byCode(runAnbidChecks(makeCtx({ meta }), base, true), "L5-C10")
    expect(c10?.status).toBe("pass")
  })

  it("无自动编号（手工敲的 1. 2. 3.）：判通过，不误报", () => {
    const meta = emptyMeta()
    meta.available = true
    const c10 = byCode(runAnbidChecks(makeCtx({ meta }), base, true), "L5-C10")
    expect(c10?.status).toBe("pass")
  })

  it("未配置编号形式要求：标「标准未配置」，不瞎判", () => {
    const meta = emptyMeta()
    meta.available = true
    meta.bulletParagraphs = 9
    const c10 = byCode(runAnbidChecks(makeCtx({ meta }), DEFAULT_ANBID_CONFIG, true), "L5-C10")
    expect(c10?.status).toBe("unconfigured")
  })

  it("非 docx 包（项目正文）：标 skipped 而非通过", () => {
    const meta = emptyMeta()
    meta.available = false
    const ctx = makeCtx({ meta, inputKind: "project", hasPackage: false })
    const c10 = byCode(runAnbidChecks(ctx, base, true), "L5-C10")
    expect(c10?.status).toBe("skipped")
  })
})

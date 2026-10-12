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

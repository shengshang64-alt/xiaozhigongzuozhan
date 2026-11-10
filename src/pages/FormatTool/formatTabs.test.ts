// 格式刷新 屏内 Tab 口径守卫（UX-v2：prototype/format/ 两屏）。
// 与其余模块的 tabs 守卫同思路；「只改格式不改文字」逻辑不动也要钉住。
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { FORMAT_TABS, formatTabHref, parseFormatTab, type FormatTab } from "./formatTabs"

const readSrc = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8")

describe("① Tab 口径：顺序与屏名对齐原型 manifest 的 format 两屏", () => {
  it("顺序固定为 ① 上传与模板 → ② 预览套用", () => {
    expect(FORMAT_TABS.map((t) => t.key)).toEqual(["upload", "preview"])
  })

  it("屏名与原型 manifest 的 tab 字段逐字一致", () => {
    expect(FORMAT_TABS.map((t) => t.label)).toEqual(["① 上传与模板", "② 预览套用"])
  })

  it("每屏都有一句话 hint（AUTHORING §屏内 Tab：右侧说明位不许空着）", () => {
    for (const t of FORMAT_TABS) expect(t.hint.trim().length).toBeGreaterThan(4)
  })
})

describe("② ?tab= 解析与地址参数", () => {
  it("非法/缺省返回 null，由页面按会话派生（已有文档/方案 → 预览，否则上传）", () => {
    expect(parseFormatTab(null)).toBeNull()
    expect(parseFormatTab("")).toBeNull()
    expect(parseFormatTab("preview ")).toBeNull()
    expect(parseFormatTab("../")).toBeNull()
  })

  it("合法值原样透传", () => {
    const keys: FormatTab[] = ["upload", "preview"]
    for (const k of keys) expect(parseFormatTab(k)).toBe(k)
  })

  it("地址形状：① 屏不带参数位，② 屏带 ?tab=", () => {
    expect(formatTabHref("upload")).toBe("/format-tool")
    expect(formatTabHref("preview")).toBe("/format-tool?tab=preview")
  })
})

describe("③ 原型设计说明条（.note 拆前/拆后）不许进生产", () => {
  it("页面壳与子屏组件里都没有拆前/拆后文案", () => {
    const files = ["./FormatSubtabs.tsx", "./FormatToolPage.tsx"]
    for (const rel of files) {
      const src = readSrc(rel)
      expect(src.includes("拆前") || src.includes("拆后"), `${rel} 残留设计说明条文案`).toBe(false)
    }
  })
})

describe("④ 拆屏零丢失 + 既有逻辑不动", () => {
  it("页面壳引用了全部既有能力（一个不删，只重新归位）", () => {
    const page = readSrc("./FormatToolPage.tsx")
    for (const mod of [
      "FormatDiffPreview",
      "ApplyReportPanel",
      "RecognizedSummary",
      "TemplateRadio",
      "handleUploadSource",
      "handleRecognize",
      "saveTemplate",
      "applyFormat",
      "exportApplied",
      "computeFormatDiff",
      "deleteTemplate",
      "setDefault",
    ]) {
      expect(page.includes(mod), `格式刷新拆屏丢了模块/能力：${mod}`).toBe(true)
    }
  })

  it("原四步向导条退役，两屏 Tab 接管（同位条件渲染，区段不搬家）", () => {
    const page = readSrc("./FormatToolPage.tsx")
    expect(page).toContain("FormatSubtabs")
    expect(page.includes("FormatWizardStepper")).toBe(false)
    expect(page.includes("activeStep")).toBe(false)
    // 两屏同位条件渲染：左区段属 upload、右区段属 preview
    expect(page).toContain('{tab === "upload" ? (')
    expect(page).toContain('{tab === "preview" ? (')
  })

  it("「只改格式不改文字」的口径原样保留（安全承诺 + 导出二次确认）", () => {
    const page = readSrc("./FormatToolPage.tsx")
    expect(page).toContain("仅统一排版样式，不改动任何文档文字")
    expect(page).toContain("正文文字内容 0 改动")
    expect(page).toContain("仍要导出")
  })
})

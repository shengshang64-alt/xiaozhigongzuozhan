// Author: loop-R189
// R189（r169 切片二）接线哨兵：钉死「内核已交付、接线到位」与「无模板/引擎拒绝逐字回退现通道」契约。
// 风格同 deckLintPanel.test.ts（源码扫描，无需 jsdom）。
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const EXPORTS = new URL("./deckExports.ts", import.meta.url)
const PLAN = new URL("./deckFidelityPlan.ts", import.meta.url)
const THEME = new URL("./deckTheme.ts", import.meta.url)
const USE = new URL("./usePptQuote.ts", import.meta.url)
const EDITOR = new URL("../../components/ppt-quote/DeckEditorWorkspace.tsx", import.meta.url)
const PROBE = new URL("./deckFidelityProbe.ts", import.meta.url)
const FID = new URL("./templateFidelity.ts", import.meta.url)
const PANEL = new URL("../../components/ppt-quote/TemplateFidelityPanel.tsx", import.meta.url)
const PAGE = new URL("./PptQuotePage.tsx", import.meta.url)

describe("deckExports 保真通道接线（R189）", () => {
  it("分流在 pptxgenjs 构造前：命中走 fidelity、否则 legacy 现通道逐字不变", () => {
    const code = readFileSync(EXPORTS, "utf-8")
    expect(code).toContain('from "./templateFidelity"')
    expect(code).toContain('from "./deckFidelityPlan"')
    expect(code).toContain("if (opts.templateBytes?.length) {")
    expect(code).toContain('return "fidelity"')
    expect(code).toContain('return "legacy"')
    // effectiveLayout 单一来源迁移：deckExports 不再本地定义
    expect(code).not.toContain("function effectiveLayout(")
  })

  it("plan 模块纯函数三件套存在且不依赖 PPT 渲染库", () => {
    const code = readFileSync(PLAN, "utf-8")
    expect(code).toContain("export function effectiveLayout(")
    expect(code).toContain("export function isFidelityEligibleSlide(")
    expect(code).toContain("export function planFidelityExport(")
    expect(code.toLowerCase()).not.toContain("pptxgenjs")
  })
})

describe("模板字节持久化与调用接线（R189）", () => {
  it("deckTheme 提供 base64 codec 与容量上限", () => {
    const code = readFileSync(THEME, "utf-8")
    expect(code).toContain("export function encodeTemplateBytes(")
    expect(code).toContain("export function decodeTemplateBytes(")
    expect(code).toContain("MAX_TEMPLATE_BYTES")
  })

  it("上传保存模板字节（容量失败降级）；导出把字节喂给保真通道并按通道回报", () => {
    const code = readFileSync(USE, "utf-8")
    expect(code).toContain("encodeTemplateBytes(bytes)")
    // 2026-11-05：导出侧不再直接 decode，而是走 effectiveTemplateBytes——
    // 内置公司模板（4.93MB，超 localStorage 3MB 上限）必须优先于用户上传模板，
    // 否则内置模板会被 encodeTemplateBytes 判超限、保真通道被静默关闭。
    expect(code).toContain("builtinTplBytes ?? decodeTemplateBytes(deckTemplate)")
    expect(code).toContain("templateBytes: effectiveTemplateBytes")
    expect(code).toContain('path === "fidelity"')
    expect(code).toContain("未启用母版级保真")
  })

  it("内置模板走 fetch 通道而非 localStorage（4.93MB 装不进 3MB 预算）", () => {
    const use = readFileSync(USE, "utf-8")
    expect(use).toContain("loadBuiltinTemplateBytes(")
    expect(use).toContain("selectBuiltinDeckTemplate")
    const mod = readFileSync(new URL("./builtinTemplates.ts", import.meta.url), "utf-8")
    expect(mod).toContain("/ppt-templates/zoe-light-internal.pptx")
    expect(mod).toContain("byteCache")
  })

  it("上传按钮 tooltip 口径同步母版/版式保真能力", () => {
    const code = readFileSync(EDITOR, "utf-8")
    expect(code).toContain("母版/版式保真")
  })
})

describe("模板保真体检接线（R190 切片三）", () => {
  it("探测层复用引擎与计划层真源，不另写一套选页/合格口径", () => {
    const fid = readFileSync(FID, "utf-8")
    expect(fid).toContain("export function pickFidelitySamples(")
    expect(fid).toContain("export function inspectFidelityTemplateDetailed(")
    const probe = readFileSync(PROBE, "utf-8")
    expect(probe).toContain('from "./templateFidelity"')
    expect(probe).toContain("pickFidelitySamples(insp.slides)")
    expect(probe).toContain("isFidelityEligibleSlide")
    // 探测层不重复实现引擎守卫
    expect(probe).not.toContain("unzipSync")
  })

  it("hook 只随模板变化解包一次，回退现通道时补归因提示", () => {
    const code = readFileSync(USE, "utf-8")
    expect(code).toContain("useMemo(() => probeTemplateFacts(deckTemplate), [deckTemplate])")
    expect(code).toContain("deckTemplateProbe,")
    expect(code).toContain('if (path === "legacy" && deckTemplate) {')
    expect(code).toContain("finalizeFidelityProbe(deckTemplateProbe, deck.slides)")
  })

  it("编辑器渲染体检卡片并由页面透传事实", () => {
    const editor = readFileSync(EDITOR, "utf-8")
    expect(editor).toContain("<TemplateFidelityPanel")
    expect(editor).toContain("deckTemplateName && deckTemplateProbe")
    expect(readFileSync(PAGE, "utf-8")).toContain("deckTemplateProbe={p.deckTemplateProbe}")
  })

  it("面板只呈现不阻断：无解包无 AI，展开态可访问", () => {
    const panel = readFileSync(PANEL, "utf-8")
    expect(panel).toContain("export function TemplateFidelityPanel(")
    expect(panel).toContain("aria-expanded")
    expect(panel.toLowerCase()).not.toContain("unzipsync")
    expect(panel).not.toContain("chatViaGateway")
  })
})

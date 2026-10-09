// Author: loop-R166
// R166 把 R121 的 deck 导出前自检接入编辑期常驻（DeckLintPanel + 页面列表 warn 圆点）。
// 本哨兵钉住接线与「非阻断」契约：面板必须挂在编辑与预览两个 tab 之上、跳转必须
// 同时切页与切回逐页编辑、导出 toast 不得被移除。风格同 disclosureA11y.test.ts /
// requirementCoverage.test.ts（源码扫描，无需 jsdom）。
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const WS = new URL("../../components/ppt-quote/DeckEditorWorkspace.tsx", import.meta.url)
const PANEL = new URL("../../components/ppt-quote/DeckLintPanel.tsx", import.meta.url)
const NAV = new URL("../../components/ppt-quote/SlideListNav.tsx", import.meta.url)
const USE = new URL("./usePptQuote.ts", import.meta.url)

describe("DeckLintPanel 自身（R166）", () => {
  it("真源指向 deckLint：聚合与摘要都走既有单一实现", () => {
    const code = readFileSync(PANEL, "utf-8")
    expect(code).toContain('from "@/pages/PptQuote/deckLint"')
    expect(code).toContain("groupIssuesByPage(issues)")
    expect(code).toContain("lintSummaryText(issues)")
  })

  it("展开明细按钮带 aria-expanded（R136 无障碍主线沿用）", () => {
    const code = readFileSync(PANEL, "utf-8")
    expect(code).toContain("aria-expanded={open}")
    expect(code).toContain("setOpen")
  })

  it("有 warn 命中时给分级徽标，点页码回调 0 基下标", () => {
    const code = readFileSync(PANEL, "utf-8")
    expect(code).toContain("需注意")
    expect(code).toContain("可优化")
    expect(code).toContain("onJumpToPage(it.page - 1)")
  })
})

describe("DeckEditorWorkspace 接线（R166 防回流）", () => {
  it("编辑期对 slides memo 计算 lintDeck，并传给常驻面板", () => {
    const code = readFileSync(WS, "utf-8")
    expect(code).toContain("const lintIssues = useMemo(() => lintDeck(deck.slides), [deck.slides])")
    expect(code).toContain("<DeckLintPanel")
    expect(code).toContain("issues={lintIssues}")
  })

  it("点页码同时切到该页并回到逐页编辑", () => {
    const code = readFileSync(WS, "utf-8")
    expect(code).toContain("setCurrentSlideIndex(index)")
    expect(code).toContain('setEditorTab("edit")')
  })

  it("warn 级命中页集合传给页面列表（info 不打点）", () => {
    const code = readFileSync(WS, "utf-8")
    expect(code).toContain("const lintWarnPages = useMemo")
    expect(code).toContain('level === "warn" && page > 0')
    expect(code).toContain("warnPages={lintWarnPages}")
  })
})

describe("SlideListNav warn 圆点（R166）", () => {
  it("新 prop 可选且未传时不渲染徽标（默认行为等价）", () => {
    const code = readFileSync(NAV, "utf-8")
    expect(code).toContain("warnPages?: ReadonlySet<number>")
    expect(code).toContain("warnPages?.has(index)")
    expect(code).toContain("导出前自检：本页有需要处理的项")
  })
})

describe("非阻断契约维持（R166）", () => {
  it("导出前自检失败不拦截：toast 照旧 + 导出流程不变", () => {
    const code = readFileSync(USE, "utf-8")
    // R121 的一次性导出 toast 仍在（常驻面板是补全，不是替换；按无空格前缀断言，防快照差异误报）
    expect(code).toContain("toast.warning(`导出前自检：${lintSummaryText(lintIssues)}")
    // lint 命中后没有 return / throw，流程继续走导出（取 lint 到 try 之间片段断言）
    const start = code.indexOf("const lintIssues = lintDeck(deck.slides)")
    const end = code.indexOf("const { exportDeckPptx }", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const seg = code.slice(start, end)
    expect(seg).not.toContain("return")
    expect(seg).not.toContain("throw")
  })
})

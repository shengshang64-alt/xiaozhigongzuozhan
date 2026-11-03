// R-302（2026-10-16）接线哨兵：钉死「版式与文风整改」三层的契约。
// 背景：售前/评审反馈 5 条（标题层级错乱 / AI 套话重 / 内联指引多 / 无表格 / 无甘特图）——
//   本哨兵防止后人只改一层（如只改 prompt 不接 lint、或删掉跳转按钮）而悄悄回归。
// 风格同 deckFidelityWiring.test.ts（源码扫描，无需 jsdom）。
import { hookSources, sourceText } from "@/testing/hookSources"
import { describe, expect, it } from "vitest"

// 路径统一为仓库相对 POSIX 路径；读取走单一入口（R57 · 审计 §3.1）。
const TYPES = "src/pages/BidWorkspace/bidTypes.ts"
const LINTER = "src/pages/BidWorkspace/bidProseLinter.ts"
const PAGE = "src/pages/BidWorkspace/BidWorkspacePage.tsx"
const COMPOSE = "src/components/bid-workspace/ComposeStep.tsx"
const SOL_TYPES = "src/pages/SolutionStudio/solutionTypes.ts"
const P_CHAPTER = "src/pages/BidWorkspace/prompts/bidChapter.ts"
const P_SECTION = "src/pages/BidWorkspace/prompts/bidSection.ts"
const P_REFINE = "src/pages/BidWorkspace/prompts/bidRefine.ts"

describe("R-302 第①层：prompt 预防（PROSE_LINT_RULES 注入三个正文生成器）", () => {
  it("bidTypes 导出 PROSE_LINT_RULES 且覆盖 5 类反馈", () => {
    const code = sourceText(TYPES)
    expect(code).toContain("export const PROSE_LINT_RULES: string[] = [")
    // ① AI 套话黑名单
    expect(code).toContain("AI 套话黑名单")
    // ② 禁内联指引
    expect(code).toContain("禁内联指引")
    // ③ 标题层级
    expect(code).toContain("标题层级严格")
    // ④ 关键章强制出表
    expect(code).toContain("关键章强制出表")
    // ⑤ 实施章强制出甘特图
    expect(code).toContain("mermaid gantt")
  })

  it("章 / 小节 / 改写三个生成器都注入 PROSE_LINT_RULES", () => {
    for (const [label, url] of [
      ["bidChapter", P_CHAPTER],
      ["bidSection", P_SECTION],
      ["bidRefine", P_REFINE],
    ] as const) {
      const code = sourceText(url)
      expect(code, `${label} 应 import PROSE_LINT_RULES`).toContain("PROSE_LINT_RULES")
      // 两种消费形态都算接线到位：for...of 编号展开（章/节） 或 .map 编号展开（改写）
      const consumed =
        code.includes("for (const t of PROSE_LINT_RULES)") || code.includes("...PROSE_LINT_RULES.map(")
      expect(consumed, `${label} 应实际消费 PROSE_LINT_RULES（for...of 或 .map）`).toBe(true)
    }
  })
})

describe("R-302 第②层：lintProse 后处理兜底（纯本地、零 AI、零网络）", () => {
  it("导出 lintProse 且不引入任何 AI / 网络依赖", () => {
    const code = sourceText(LINTER)
    expect(code).toContain("export function lintProse(")
    expect(code).toContain("export type LintKind")
    // 纯本地：不得出现网关/请求
    expect(code.toLowerCase()).not.toContain("fetch(")
    expect(code.toLowerCase()).not.toContain("chatviagateway")
    expect(code).not.toContain("from \"@/lib/llm\"")
  })

  it("四类命中项齐全（AI 套话 / 内联指引 / 标题断裂 / 缺表）", () => {
    const code = sourceText(LINTER)
    expect(code).toContain("AI_CLICHE_PATTERNS")
    expect(code).toContain("INLINE_LINK_PATTERNS")
    expect(code).toContain("detectTitleBreak")
    expect(code).toContain("TABLE_REQUIRED_KEYWORDS")
    expect(code).toContain('"ai_cliche"')
    expect(code).toContain('"inline_link"')
    expect(code).toContain('"title_break"')
    expect(code).toContain('"missing_table"')
  })
})

describe("R-302 第③层：接线（命中入库 → 徽标 → 一键跳转/重写）", () => {
  it("Chapter 类型落库两个字段（文案 + 跳转锚点）", () => {
    const code = sourceText(SOL_TYPES)
    expect(code).toContain("proseLintWarning?: string")
    expect(code).toContain("proseLintFirstHit?: { offset: number; excerpt: string }")
  })

  it("applyAutoRepair 内跑 lintProse 并同时写 warnings 与 firstHit（命中/清空双向）", () => {
    const code = hookSources()
    expect(code).toContain('from "./bidProseLinter"')
    // REQ-025（2026-10-17）：lint 入参由 res.content 改为 fixedContent——
    // applyAutoRepair 里先做长段落本地重排，lint 必须检查**重排后的内容**，
    // 否则"版式?"徽标会按拆段前的旧文本报数（拆完了还报长段落）。
    expect(code).toContain("lintProse(fixedContent, ch.title)")
    expect(code).toContain("proseLintWarning: lp.summary")
    expect(code).toContain("proseLintFirstHit: { offset: first.offset, excerpt: first.excerpt }")
    // REQ-021：severity 必须同时落库（否则 UI 分不出结构性红/观感琥珀）
    expect(code).toContain("proseLintSeverity: lp.severity ?? undefined")
    // 修好后必须清空（否则徽标永久残留）。
    // ⚠️ REQ-021 起该清空块从单行改写为多行（多清一个 severity 字段），
    //    故断言改成"逐字段各自出现 + severity 也在清空块内"，
    //    不用「单行连写」这种排版敏感写法（与 CLAUDE.md 行尾纪律同源：
    //    扫描型守卫不要依赖排版，行锚一律宽容）。
    //    新断言比旧的更强：旧断言只证明 warning/firstHit 被清，新的还钉住 severity。
    expect(code).toMatch(/proseLintWarning:\s*undefined/)
    expect(code).toMatch(/proseLintFirstHit:\s*undefined/)
    expect(code).toMatch(/proseLintSeverity:\s*undefined/)
  })

  it("hook 导出 focusPositionInChapter 且页面透传（否则点击无声失败）", () => {
    const use = hookSources()
    expect(use).toContain("const focusPositionInChapter = useCallback(")
    expect(use).toContain("focusPositionInChapter,")
    expect(sourceText(PAGE)).toContain("focusPositionInChapter={p.focusPositionInChapter}")
  })

  it("ComposeStep：徽标可点击 + 声明 prop + 预览态先切编辑态再跳", () => {
    const code = sourceText(COMPOSE)
    expect(code).toContain('| "focusPositionInChapter"')
    expect(code).toContain("p.focusPositionInChapter(ch.node_id, hit.offset, hit.excerpt)")
    // 预览模式下 textarea 未挂载：必须在点击事件里切 edit（不在 effect 内 setState，
    // 否则触发 react-hooks/set-state-in-effect）
    expect(code).toContain('setViewMode("edit")')
    expect(code).not.toContain('if (viewMode !== "edit") setViewMode("edit")')
    // 定位原语必须复用抽出的可测实现，禁止再内联一份（边界逻辑只能有一个真源）
    expect(code).toContain('from "@/pages/BidWorkspace/bidFocusJump"')
    expect(code).not.toContain("el.setSelectionRange(safeOffset")
    // 一键重写入口
    expect(code).toContain('p.refineChapter(ch.node_id, "rewrite")')
  })
})

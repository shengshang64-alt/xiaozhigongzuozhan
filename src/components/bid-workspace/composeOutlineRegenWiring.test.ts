// 编制阶段「重新生成大纲」接线守卫（2026-10-15 用户反馈）。
//
// 背景：大纲面板（含「重新生成」）原先只在 `!hasChapters` 时渲染——一旦确认大纲、进入逐章编制，
// 整个大纲区连同重生成入口一起消失，用户只能退回解析环节才能重跑大纲。
// 现在：编制阶段也能打开大纲视图（`!hasChapters || outlineViewOpen`），且大纲目录面板头带重生成入口。
// 缺任一环该功能就"看不见"，所以断在源码上（与 proseFallbackWiring 同类接线守卫）。
import { sourceText } from "@/testing/hookSources"
import { describe, expect, it } from "vitest"

// 读取走 src/testing/hookSources 单一入口（R57 · 审计 §3.1）。
const COMPOSE = sourceText("src/components/bid-workspace/ComposeStep.tsx")
// UX-v2 拆屏（2026-11-11）：左树（重生成入口按钮、全部展开、小节展开）在独立组件里
const TREE = sourceText("src/components/bid-workspace/BidChapterNavTree.tsx")

describe("编制阶段重新生成大纲接线守卫", () => {
  it("③大纲编制 / ④正文编写 由页面按步骤指定（view prop），不再靠内部开关切换", () => {
    // UX-v2 七步对齐：页面传 view="outline" / view="draft"，组件内 showOutline 决定渲染哪屏
    expect(COMPOSE).toContain("showOutline")
    expect(COMPOSE).toContain('p.view === "outline"')
    expect(COMPOSE).toContain("view?: \"outline\" | \"draft\"")
  })

  it("大纲目录面板头带重生成入口，且接了回调", () => {
    expect(TREE).toContain("重新生成大纲")
    expect(COMPOSE).toContain("onRegenerateOutline")
    // 编制阶段的口径：先切到大纲视图，再弹"重新生成大纲？"确认（复用既有弹窗）
    expect(COMPOSE).toContain("setOutlineViewOpen(true)")
    expect(COMPOSE).toContain("setRegenConfirmOpen(true)")
  })

  it("章节导航支持「全部展开」（默认只展开当前章，避免误以为小节丢了）", () => {
    expect(TREE).toContain("expandAllSections")
    expect(TREE).toContain("全部展开")
    // 渲染条件同时放行"当前章"与"全部展开"
    expect(TREE).toContain("(isCurrent || expandAllSections) &&")
  })

  it("已有章节时能返回逐章编制，确认大纲后自动回到该视图", () => {
    expect(COMPOSE).toContain("返回逐章编制")
    // 两条确认路径（直接确认 / 覆盖正文的二次确认）都要回到逐章编制视图
    const backCount = (COMPOSE.match(/setOutlineViewOpen\(false\)/g) ?? []).length
    expect(backCount).toBeGreaterThanOrEqual(3)
  })
})

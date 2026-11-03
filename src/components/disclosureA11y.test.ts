// R136 防回流哨兵：可折叠面板的"展开/收起"触发按钮必须携带 aria-expanded，
// 屏幕阅读器才能播报展开态（WCAG 4.1.2 名称/角色/值）。此前 ChapterScoreCard、
// ActivityFeedSection、CompetitorsPage 分析建议、QuoteEditor 历史报价四处 disclosure
// 只有文字与 chevron 旋转、缺展开态语义，本轮补齐并钉住。FolderTree 目录树因锚点在途保护挂账，R156 在途提交后并入 SITES。
// R162 并入方案侧「需求条目落位核验卡」的展开明细按钮。
// 采用源码扫描（与 onDemandHeavyLibs.test.ts 同风格，纯 node fs，无需 jsdom），
// 逐个断言枚举站点存在对应 aria-expanded={state} token。
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// [相对 src 的文件路径, 期望存在的 aria-expanded 绑定, 折叠态布尔变量]
const SITES: Array<[string, string, string]> = [
  ["components/solution-studio/ChapterScoreCard.tsx", "aria-expanded={expanded}", "setExpanded"],
  ["components/home/ActivityFeedSection.tsx", "aria-expanded={expanded}", "setExpanded"],
  ["pages/Competitors/CompetitorsPage.tsx", "aria-expanded={expanded}", "setExpanded"],
  ["components/ppt-quote/QuoteEditor.tsx", "aria-expanded={historyOpen}", "setHistoryOpen"],
  ["components/knowledge/FolderTree.tsx", "aria-expanded={expanded}", "setExpanded"],
  ["components/solution-studio/RequirementCoverageCard.tsx", "aria-expanded={expanded}", "setExpanded"],
]

describe("R136 折叠 disclosure 按钮带 aria-expanded（防回流）", () => {
  it.each(SITES)("%s 展开按钮声明 aria-expanded 且确为受控折叠", (rel, token, setter) => {
    const code = readFileSync(path.join(SRC, rel), "utf-8")
    expect(code, `缺少 ${token}`).toContain(token)
    // 关联的折叠状态确实由该 setter 切换，避免 token 是孤立残留
    expect(code).toContain(setter)
  })
})

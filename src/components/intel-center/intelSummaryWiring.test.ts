import { describe, expect, it } from "vitest"
import { countMatches, sourceText } from "@/testing/hookSources"

// R64（intel-summary-meta-blob）接线哨兵
// 为什么需要这条：summary 的清洗是纯函数，单测只能证明「函数对」，证明不了「界面用了它」。
// 本轮修的就是「首页用了 displayizeIntel、情报中心没用任何清洗」这种半接线——
// 一旦有人把渲染改回 {item.summary}，这里必须变红。
describe("情报摘要展示层接线（R64）", () => {
  const CARD = "src/components/intel-center/IntelItemCard.tsx"
  const DETAIL = "src/components/intel-center/IntelDetailPanel.tsx"
  const HOME = "src/pages/Home/useHome.ts"

  it("列表卡片：摘要走 cleanIntelSummary，且不再原样渲染 item.summary", () => {
    const src = sourceText(CARD)
    expect(countMatches(src, /cleanIntelSummary\(item\.summary/g)).toBe(1)
    expect(src).not.toContain("{item.summary}")
    // 空清洗结果不渲染空段落：条件必须挂在清洗后的变量上
    expect(src).toContain("{summaryText && (")
  })

  it("详情面板：正文与「复制」都走清洗后的文本，不再原样渲染 item.summary", () => {
    const src = sourceText(DETAIL)
    expect(countMatches(src, /cleanIntelSummary\(item\.summary/g)).toBe(1)
    expect(src).not.toContain("{item.summary}")
    expect(src).not.toContain('(item.summary ?? "")')
    expect(src).toContain("{summaryText && (")
    // 复制内容与展示内容同源，避免「看到的干净、复制出去是 JSON」
    expect(src).toContain('(item.title ? item.title + "\\n" : "") + summaryText')
  })

  it("首页动态卡：摘要同样走 cleanIntelSummary（三处口径同源）", () => {
    const src = sourceText(HOME)
    expect(countMatches(src, /cleanIntelSummary\(row\.summary/g)).toBe(1)
    // 回退哨兵：若有人改回仅 displayizeIntel，这批「JSON 与正文同行」的摘要会被整行丢成空白
    expect(src).not.toContain("displayizeIntel(row.summary")
  })
})

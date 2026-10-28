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

// R65（intel-snippet-listing-residue）接线哨兵
// 为什么需要这条：cleanIntelSnippet 是纯函数，单测只能证明「函数对」，证明不了「界面用了它」。
// 本轮修的是 content_snippet 这个字段——首页拿它当摘要、详情面板**原样渲染**，
// 一旦有人改回 {item.content_snippet} 或改回裸 displayizeIntel，这里必须变红。
describe("情报内容片段展示层接线（R65）", () => {
  const DETAIL = "src/components/intel-center/IntelDetailPanel.tsx"
  const HOME = "src/pages/Home/useHome.ts"

  it("首页动态卡：片段走 cleanIntelSnippet（带标题做亲和度判定），不再裸 displayizeIntel", () => {
    const src = sourceText(HOME)
    expect(countMatches(src, /cleanIntelSnippet\(row\.content_snippet/g)).toBe(1)
    // 回退哨兵：裸 displayizeIntel 认不出「更多…」与「标题+日期」列表，会把别人的标题当摘要
    expect(src).not.toContain("displayizeIntel(row.content_snippet")
    // 标题必须传进去：列表残片里夹着邻篇正文时，只有标题能判出「这段不属于本条」
    expect(src).toContain("title: row.title")
  })

  it("详情面板：内容片段走 cleanIntelSnippet，不再原样渲染 item.content_snippet", () => {
    const src = sourceText(DETAIL)
    expect(countMatches(src, /cleanIntelSnippet\(item\.content_snippet/g)).toBe(1)
    expect(src).not.toContain("{item.content_snippet}")
    // 空清洗结果要有如实说明（而不是留一个空白框，也不是把列表残片照旧显示）
    expect(src).toContain("片段是其他条目的标题列表")
  })
})

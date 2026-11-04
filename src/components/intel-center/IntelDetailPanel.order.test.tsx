/** @vitest-environment jsdom */
/**
 * 情报详情首屏的**阅读优先**回归网（2026-11-04，审计 P1）。
 *
 * 缺陷形态：详情面板里「人工补正招标要素」表单排在 AI 摘要 / 内容片段 / 查看原文**之前**，
 * 且在没抽到招标要素（真实样本 50/50 条 structured=null）时**默认展开**——
 * 用户点开一条情报，首屏看到的是 6 行空输入框，真正要读的摘要和正文被压到下面几屏。
 * 补录是「看完之后」才做的动作，不该抢首屏。
 *
 * 本文件用 DOM 顺序（不是快照）钉住：摘要、内容片段、查看原文都必须排在补正表单之前。
 * 反向验证：把编辑器移回摘要之前 → 本文件对应用例必须红。
 */
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { IntelDetailPanel } from "./IntelDetailPanel"
import type { IntelItemRow } from "@/pages/IntelCenter/useIntelCenter"

afterEach(cleanup)

function item(over: Partial<IntelItemRow> = {}): IntelItemRow {
  return {
    id: "i1",
    title: "某医院智慧医院建设项目招标公告",
    content_snippet: "本项目采购内容包括电子病历、互联互通测评等，详见招标文件正文。",
    summary: "该项目的电子病历与互联互通建设对本公司产品线是有利信号。",
    item_type: "bid",
    item_status: "pending",
    my_status: "pending",
    region: "安徽",
    source_id: "s1",
    source_name: "中国政府采购网",
    url: "https://example.com/1",
    published_at: "2026-11-01",
    created: "2026-11-01 00:00:00.000Z",
    updated: "2026-11-01 00:00:00.000Z",
    tags: [],
    visibility: "public",
    added_by: "crawl",
    structured: null,
    ...over,
  } as IntelItemRow
}

function renderPanel(it: IntelItemRow = item()) {
  return render(
    <IntelDetailPanel
      item={it}
      starred={false}
      aiTagging={false}
      lead={false}
      onClose={() => {}}
      onConfirm={() => {}}
      onIgnore={() => {}}
      onAiTag={() => {}}
      onToggleStar={() => {}}
      onToggleLead={() => {}}
      onCreateBidTask={() => {}}
      onConvertToOpp={() => {}}
      onSaveStructured={async () => true}
    />,
  )
}

/** 用 DOM 顺序判断 a 是否出现在 b 之前 */
function comesBefore(a: Element | null, b: Element | null): boolean {
  if (!a || !b) return false
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
}

describe("情报详情：正文优先，补正表单靠后", () => {
  it("AI 摘要排在「人工补正」表单之前（首屏先看到内容，不是空输入框）", () => {
    renderPanel()
    const summary = screen.getByText("AI 摘要").closest("section")
    const editorToggle = screen.getByText(/收起人工补正|补正招标要素/)
    expect(comesBefore(summary, editorToggle)).toBe(true)
  })

  it("内容片段排在补正表单之前", () => {
    renderPanel()
    const snippet = screen.getByText("内容片段").closest("section")
    const editorToggle = screen.getByText(/收起人工补正|补正招标要素/)
    expect(comesBefore(snippet, editorToggle)).toBe(true)
  })

  it("「查看原文」排在补正表单之前（读完正文就去原文核对，再补录）", () => {
    renderPanel()
    const link = screen.getByRole("link", { name: /查看原文/ })
    const editorToggle = screen.getByText(/收起人工补正|补正招标要素/)
    expect(comesBefore(link, editorToggle)).toBe(true)
  })

  it("补正表单仍然存在且可用（只是靠后，不是被删掉）", () => {
    renderPanel()
    expect(screen.getByText(/收起人工补正|补正招标要素/)).toBeInTheDocument()
    // 默认展开逻辑不变：没有 deadline/budget 时仍是展开态，输入框可见
    expect(screen.getByPlaceholderText(/安徽中医药大学第一附属医院/)).toBeInTheDocument()
  })

  it("已抽齐要素的条目：补正表单默认收起，摘要依旧在最前", () => {
    renderPanel(item({ structured: { buyer: "某医院", budget: "2300万元", deadline: "2026-11-20 09:30" } }))
    expect(screen.getByText(/补正招标要素/)).toBeInTheDocument()
    const summary = screen.getByText("AI 摘要").closest("section")
    expect(comesBefore(summary, screen.getByText(/补正招标要素/))).toBe(true)
  })
})

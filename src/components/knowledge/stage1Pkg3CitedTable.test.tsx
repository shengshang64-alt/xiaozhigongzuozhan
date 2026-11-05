/** @vitest-environment jsdom */
/**
 * 阶段 1 · 包 3 第③条：**问答 Markdown 表可渲染**（DOM 行为网）。
 *
 * 缺陷（2026-11-05 实测复现）：`CitedAnswer` 先把整篇回答按 `[资料N]` 切段，
 * 再对每段分别做 Markdown 渲染。表格单元格里一旦带引用标记（`| HIS | 300 万 [资料1] |`），
 * 这句就被切成「…300 万」「chip」「 |」三段，表格结构被切断：
 * 实测第二行数据整行漏到表格外，界面留下原始 `|\n| EMR | 200 万` 文本，`<tr>` 从 3 掉到 2。
 * 而知识问答最常见的输出恰恰是「表格 + 逐格引用」。
 *
 * 修复口径：先按块级表格切分，表格整块渲染（块内标记折成上标数字 + 表格下方给来源行），
 * 非表格块维持原有交互 chip 行为。
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"

vi.mock("@/components/ui/hover-card", () => ({
  HoverCard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  HoverCardTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  HoverCardContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import { CitedAnswer } from "./CitedAnswer"
import { foldCitationMarkersInTable, hasCitationMarkers } from "./citationMarkers"

const CITATIONS = [
  { index: 1, title: "演示-建设清单说明", visibility: "team", snippet: "片段一", docId: "d1" },
  { index: 2, title: "演示-报价规则", visibility: "team", snippet: "片段二", docId: "d2" },
] as never[]

afterEach(cleanup)

describe("③ 问答 Markdown 表：单元格带引用时表格必须完整", () => {
  const content = [
    "汇总如下：",
    "",
    "| 系统 | 预算 |",
    "| --- | --- |",
    "| HIS | 300 万 [资料1] |",
    "| EMR | 200 万 [资料2] |",
    "",
    "以上为初步口径。",
  ].join("\n")

  it("表格行数完整（表头 + 2 数据行 = 3 个 tr），不再被引用标记切碎", () => {
    const { container } = render(
      <CitedAnswer content={content} citations={CITATIONS} onOpenCitation={() => {}} />,
    )
    expect(container.querySelectorAll("table")).toHaveLength(1)
    expect(container.querySelectorAll("tr")).toHaveLength(3)
  })

  it("不残留未渲染的 Markdown 表格语法（|---| 或裸露的 | EMR |）", () => {
    const { container } = render(
      <CitedAnswer content={content} citations={CITATIONS} onOpenCitation={() => {}} />,
    )
    const text = container.textContent ?? ""
    expect(text).not.toContain("---")
    expect(text).not.toContain("| EMR |")
    // 两行数据的内容都必须在（没被丢掉）
    expect(text).toContain("300 万")
    expect(text).toContain("200 万")
  })

  it("引用可见：表格下方给出本表用到的资料与标题", () => {
    const { container } = render(
      <CitedAnswer content={content} citations={CITATIONS} onOpenCitation={() => {}} />,
    )
    const text = container.textContent ?? ""
    expect(text).toContain("表格来源")
    expect(text).toContain("演示-建设清单说明")
    expect(text).toContain("演示-报价规则")
  })

  it("非表格段落仍走原有交互 chip（引用标记不丢）", () => {
    const noTable = "建设内容以 HIS 为主 [资料1]，报价见附表 [资料2]。"
    const { container } = render(
      <CitedAnswer content={noTable} citations={CITATIONS} onOpenCitation={() => {}} />,
    )
    // 原文里的 [资料N] 标记本身不应残留在正文中（被 chip 替换）
    expect(container.textContent ?? "").not.toContain("[资料1]")
    expect(container.querySelectorAll("button").length).toBeGreaterThanOrEqual(2)
  })
})

describe("引用标记工具函数", () => {
  it("表格内标记折成上标数字，越界序号原样保留（不编造）", () => {
    expect(foldCitationMarkersInTable("A [资料1] B [资料9]", CITATIONS)).toBe("A ⁽1⁾ B [资料9]")
  })

  it("hasCitationMarkers 认得出标记", () => {
    expect(hasCitationMarkers("见 [资料2]")).toBe(true)
    expect(hasCitationMarkers("没有标记")).toBe(false)
  })
})

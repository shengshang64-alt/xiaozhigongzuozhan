/** @vitest-environment jsdom */
/**
 * 章节生成失败态的可见性回归网（2026-11-04）。
 *
 * 用户原话方向：「方案页无『正在生成』或失败原因」。审计实测：失败后正文区照常渲染
 * 「点击生成正文」的空文本框，副标题写「尚未生成正文」——看起来像从没生成过。
 * 原因其实一直在（genError 随章落库），只是唯一出口是大纲目录那个 2px 红点的 hover tooltip。
 *
 * 本文件钉住三件事：
 *  ① 失败章必须在正文区露出失败原因 + 「重试」按钮，且副标题不能说「尚未生成正文」；
 *  ② 失败但已有旧正文时，原因条同样要显示（不能因为"有内容"就把失败痕迹吃掉）；
 *  ③ 没失败 / 归档只读 / 正在生成时不许误报失败条。
 */
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { ChapterEditor } from "./ChapterEditor"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

afterEach(cleanup)

function chapter(extra: Partial<Chapter> = {}): Chapter {
  return {
    node_id: "n1",
    title: "总体技术方案",
    content: "",
    gen_status: "pending",
    sections: [],
    ...extra,
  } as Chapter
}

function renderEditor(ch: Chapter, opts: { readOnly?: boolean; bulkGenerating?: boolean } = {}) {
  const calls: string[] = []
  render(
    <ChapterEditor
      activeChapter={ch}
      activeChapterId={ch.node_id}
      editingContent={ch.content ?? ""}
      setEditingContent={() => {}}
      chapterBusy={null}
      generateChapter={(id) => calls.push(`generate:${id}`)}
      refineChapter={() => {}}
      bulkGenerating={opts.bulkGenerating ?? false}
      regenerateChapter={(id) => calls.push(`regenerate:${id}`)}
      chapterIndex={0}
      readOnly={opts.readOnly}
    />,
  )
  return calls
}

describe("章节失败态：正文区必须自己说清楚", () => {
  it("失败章显示失败原因与「重试」，副标题不再说「尚未生成正文」", () => {
    renderEditor(chapter({ gen_status: "failed", genError: "该模型本次响应超时（网关单次请求上限约 300 秒）" }))
    expect(screen.getByText(/上次生成本章失败/)).toBeInTheDocument()
    expect(screen.getByText(/网关单次请求上限约 300 秒/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument()
    expect(screen.queryByText("尚未生成正文")).toBeNull()
    expect(screen.getByText(/上次生成失败，可直接重试/)).toBeInTheDocument()
  })

  it("旧记录没有 genError：给统一兜底文案，不留空白原因", () => {
    renderEditor(chapter({ gen_status: "failed" }))
    expect(screen.getByText(/旧记录未留存原因/)).toBeInTheDocument()
  })

  it("失败但已有旧正文：失败痕迹照常显示（不被「有内容」吃掉）", () => {
    renderEditor(chapter({ gen_status: "failed", genError: "额度不足", content: "上一版的正文内容，仍保留" }))
    expect(screen.getByText(/上次生成本章失败/)).toBeInTheDocument()
    expect(screen.getByText(/额度不足/)).toBeInTheDocument()
    // 旧正文仍在编辑区里，没有被失败态顶掉
    expect(screen.getByDisplayValue(/上一版的正文内容/)).toBeInTheDocument()
  })

  it("点「重试」走重新生成入口（有 regenerateChapter 时优先用它）", () => {
    const calls = renderEditor(chapter({ gen_status: "failed", genError: "超时" }))
    fireEvent.click(screen.getByRole("button", { name: /重试/ }))
    expect(calls).toEqual(["regenerate:n1"])
  })

  it("没失败时不出现失败条（反噪音）", () => {
    renderEditor(chapter({ gen_status: "done", content: "正文" }))
    expect(screen.queryByText(/上次生成本章失败/)).toBeNull()
  })

  it("正在生成时不出现失败条（旧原因不能盖住「正在撰写」）", () => {
    renderEditor(chapter({ gen_status: "failed", genError: "超时" }), { bulkGenerating: true })
    expect(screen.queryByText(/上次生成本章失败/)).toBeNull()
  })

  it("归档只读：仍展示原因，但不给重试按钮", () => {
    renderEditor(chapter({ gen_status: "failed", genError: "超时" }), { readOnly: true })
    expect(screen.getByText(/上次生成本章失败/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /重试/ })).toBeNull()
  })
})

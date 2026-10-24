/** @vitest-environment jsdom */
// P1-1 轻量：阅读区「历史版本」一键预设的组件测试。
// 语义锁定：标记 = 显式 blocked（检索/问答即刻排除）；恢复 = ai_context_mode 重置为空
// （回到分类默认），不得写死 original——否则合同商务等默认脱敏档会被意外放开。
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { DocPolicySection } from "./DocPolicySection"
import type { KbDocRow } from "@/lib/kbCore"

// vitest 未开 globals，RTL 的自动 cleanup 不生效，手动清（否则上一例的按钮会污染下一例查询）
afterEach(cleanup)

function doc(overrides: Partial<KbDocRow> = {}): KbDocRow {
  return {
    id: "d1",
    rh_user_id: "local-user",
    title: "某项目招标文件",
    folder_path: "",
    content: "正文",
    doc_format: "docx",
    visibility: "team",
    summary: "",
    keywords: [],
    source_file_name: "a.docx",
    uploader_name: "测试",
    created: "2026-01-01",
    updated: "2026-01-02",
    doc_category: "其他",
    ai_context_mode: "",
    retrieval_weight: 1,
    is_sensitive: false,
    ...overrides,
  } as KbDocRow
}

function setup(d: KbDocRow) {
  const updateDocPolicy = vi.fn()
  render(<DocPolicySection doc={d} editable updateDocPolicy={updateDocPolicy} />)
  return updateDocPolicy
}

describe("DocPolicySection 历史版本一键预设（P1-1）", () => {
  it("现行文档显示「标记为历史版本」，点击写显式 blocked", () => {
    const spy = setup(doc())
    fireEvent.click(screen.getByRole("button", { name: /标记为历史版本/ }))
    expect(spy).toHaveBeenCalledTimes(1)
    const patch = spy.mock.calls[0][1]
    expect(patch.ai_context_mode).toBe("blocked")
  })

  it("blocked 文档显示「恢复为现行」，点击重置为空（分类默认），不写死 original", () => {
    const spy = setup(doc({ ai_context_mode: "blocked" }))
    fireEvent.click(screen.getByRole("button", { name: /历史版本 · 恢复为现行/ }))
    const patch = spy.mock.calls[0][1]
    expect(patch.ai_context_mode).toBe("")
    expect(patch.ai_context_mode).not.toBe("original")
  })

  it("不可编辑时不渲染预设按钮", () => {
    const updateDocPolicy = vi.fn()
    render(<DocPolicySection doc={doc()} editable={false} updateDocPolicy={updateDocPolicy} />)
    expect(screen.queryByRole("button", { name: /标记为历史版本/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /恢复为现行/ })).toBeNull()
  })
})

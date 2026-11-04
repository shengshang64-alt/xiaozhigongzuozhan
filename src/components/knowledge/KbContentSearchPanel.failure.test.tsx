/** @vitest-environment jsdom */
/**
 * 知识库正文检索的「失败」与「真没有」必须分开（2026-11-04，审计 P1）。
 *
 * 缺陷形态：`searchKbContent` 返回 ok:false（401 / 索引没建 / 服务没起 / 超时）时，
 * 面板直接丢弃 message 并把 items 清空，于是界面显示
 * 「没有找到正文包含该关键词的文档」——用户会认为「库里确实没这内容」，
 * 而真实原因是检索功能坏了。两者都说「没有」，处置完全不同。
 *
 * 本文件守四条：
 *  ① 失败时必须显示「没有成功（不是没有这篇文档）」+ 人话建议 + 技术原因；
 *  ② 真搜到 0 条时仍显示原话「没有找到…」，不许出现失败横幅；
 *  ③ 失败后重试成功，失败横幅要消失；
 *  ④ 不同失败类型给出不同建议（未登录 / 索引未建 / 连不上服务）。
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"

const state = vi.hoisted(() => ({ results: [] as unknown[] }))

vi.mock("@/lib/kbContentSearch", async (orig) => {
  const actual = await orig<typeof import("@/lib/kbContentSearch")>()
  return {
    ...actual,
    searchKbContent: async () => state.results.shift(),
  }
})

import { KbContentSearchPanel } from "./KbContentSearchPanel"

afterEach(cleanup)

function renderPanel() {
  return render(<KbContentSearchPanel libTab="team" />)
}

async function search(kw: string) {
  fireEvent.change(screen.getByLabelText("正文字号检索关键词"), { target: { value: kw } })
  fireEvent.click(screen.getByRole("button", { name: /搜正文/ }))
}

describe("正文检索：失败不能被说成「没找到」", () => {
  it("未登录（401）→ 显示失败横幅 + 重新登录建议，而不是「没有找到」", async () => {
    state.results = [{ ok: false, message: "HTTP 401 Unauthorized" }]
    renderPanel()
    await search("电子病历")
    await waitFor(() => expect(screen.getByText(/正文检索没有成功/)).toBeInTheDocument())
    expect(screen.getByText(/登录状态失效/)).toBeInTheDocument()
    expect(screen.getByText(/技术原因：HTTP 401 Unauthorized/)).toBeInTheDocument()
    expect(screen.queryByText(/没有找到正文包含该关键词的文档/)).toBeNull()
  })

  it("索引没建 → 建议重建索引或改用列表搜索", async () => {
    state.results = [{ ok: false, message: "no such table: kb_fts" }]
    renderPanel()
    await search("互联互通")
    await waitFor(() => expect(screen.getByText(/正文索引还没建好/)).toBeInTheDocument())
  })

  it("连不上服务 → 提示确认 PocketBase 在运行", async () => {
    state.results = [{ ok: false, message: "Failed to fetch" }]
    renderPanel()
    await search("DRG")
    await waitFor(() => expect(screen.getByText(/连不上本地服务/)).toBeInTheDocument())
  })

  it("超时 → 提示稍等再试（不是没有结果）", async () => {
    state.results = [{ ok: false, message: "检索请求失败：The operation was aborted" }]
    renderPanel()
    await search("智慧医院")
    await waitFor(() => expect(screen.getByText(/检索超时/)).toBeInTheDocument())
  })
})

describe("正文检索：真搜到 0 条仍走原话", () => {
  it("ok:true 但 0 条 → 原话「没有找到」，不出现失败横幅", async () => {
    state.results = [{ ok: true, query: "不存在的词", total: 0, items: [] }]
    renderPanel()
    await search("不存在的词")
    await waitFor(() => expect(screen.getByText(/没有找到正文包含该关键词的文档/)).toBeInTheDocument())
    expect(screen.queryByText(/正文检索没有成功/)).toBeNull()
  })

  // 2026-11-04 口径统一：知识库其余展示面（QaDrawer / CitedAnswer / qaCopyText）渲染前都过
  // redactPii，只有本面板曾裸渲染原文片段。掩码保留头尾，不防碍「认出是哪个号」。
  it("片段里的手机号/邮箱/身份证必须脱敏后才上屏", async () => {
    state.results = [
      {
        ok: true,
        query: "合同",
        total: 1,
        items: [
          {
            id: "d2",
            title: "某合同",
            folder_path: "合同商务",
            snippet: "联系人手机13812345678 邮箱zhangsan@corp.com 身份证110101199003071234",
          },
        ],
      },
    ]
    renderPanel()
    await search("合同")
    await waitFor(() => expect(screen.getByText("某合同")).toBeInTheDocument())
    const shown = document.body.textContent ?? ""
    expect(shown).not.toContain("13812345678")
    expect(shown).not.toContain("zhangsan@corp.com")
    expect(shown).not.toContain("110101199003071234")
    // 掩码保留头尾，仍能认出是哪个号
    expect(shown).toContain("138****5678")
  })

  it("失败后重试成功 → 失败横幅消失，显示命中条数", async () => {
    state.results = [
      { ok: false, message: "HTTP 500" },
      {
        ok: true,
        query: "电子病历",
        total: 1,
        items: [{ id: "d1", title: "某医院电子病历方案", folder_path: "方案/2026", snippet: "[[电子病历]]五级整改" }],
      },
    ]
    renderPanel()
    await search("电子病历")
    await waitFor(() => expect(screen.getByText(/正文检索没有成功/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /搜正文/ }))
    await waitFor(() => expect(screen.getByText(/命中 1 篇/)).toBeInTheDocument())
    expect(screen.queryByText(/正文检索没有成功/)).toBeNull()
    expect(screen.getByText("某医院电子病历方案")).toBeInTheDocument()
  })
})

/** @vitest-environment jsdom */
/**
 * 保活内容区的行为网：标签切走不卸载、切回状态还在、未注册路径出 NotFound。
 *
 * 守的是这次改造的核心承诺——「切走再切回来还在原处」。断的是**DOM 与组件状态**，
 * 不是"渲染不抛错"：非当前标签必须仍在 DOM 里（hidden 而非卸载），否则标书半成品、
 * 滚动位置、填了一半的表单都会在一次切页里丢掉。
 */
import { afterEach, describe, expect, it, vi } from "vitest"

// 用两个假页面替掉真实路由表：真实页面会拉起整站依赖，与"保活"断言无关。
// A 页带受控输入（用于验证状态是否留存），B 页只有标记。
vi.mock("@/lib/routeRegistry", async () => {
  const React = await import("react")
  const PageA = () => {
    const [v, setV] = React.useState("")
    return React.createElement(
      "div",
      null,
      React.createElement("span", { "data-testid": "page-a" }, "PAGE-A"),
      React.createElement("input", {
        "aria-label": "a-input",
        value: v,
        onChange: (e: { target: { value: string } }) => setV(e.target.value),
      }),
    )
  }
  const PageB = () => React.createElement("span", { "data-testid": "page-b" }, "PAGE-B")
  const meta = (path: string, label: string, Component: () => unknown) => ({
    path,
    label,
    icon: () => null,
    Component,
    loader: async () => ({ default: Component }),
  })
  const routes = [meta("/", "作战驾驶舱", PageA), meta("/knowledge", "知识库", PageB)]
  const byPath: Record<string, ReturnType<typeof meta>> = {}
  for (const r of routes) byPath[r.path] = r
  return {
    HOME_PATH: "/",
    ROUTES: routes,
    ROUTE_BY_PATH: byPath,
    NAV_GROUPS: [],
    hasRoute: (p: string) => Boolean(byPath[p]),
    labelFor: (p: string) => byPath[p]?.label ?? "工作台",
    preloadRoute: () => {},
  }
})

import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import userEvent from "@testing-library/user-event"
import "@testing-library/jest-dom/vitest"
import { TabbedOutlet } from "./TabbedOutlet"
import type { WorkspaceTabsState } from "@/lib/workspaceTabs"

const tabsOf = (active: string, items: string[] = ["/", "/knowledge"]): WorkspaceTabsState => ({
  items,
  active,
  touched: items,
})

afterEach(() => cleanup())

describe("TabbedOutlet（多标签保活）", () => {
  it("已打开的标签全部保持挂载，非当前标签只是隐藏", () => {
    render(<MemoryRouter><TabbedOutlet tabs={tabsOf("/")} pathname="/" /></MemoryRouter>)

    // 两个页面都在 DOM 里 —— 这就是"保活"：非当前页没有被卸载
    expect(screen.getByTestId("page-a")).toBeInTheDocument()
    expect(screen.getByTestId("page-b")).toBeInTheDocument()

    const panelB = document.querySelector('[data-tab-panel="/knowledge"]')
    const panelA = document.querySelector('[data-tab-panel="/"]')
    expect(panelB).toHaveAttribute("hidden")
    expect(panelA).not.toHaveAttribute("hidden")
  })

  it("切走再切回，页面内的组件状态仍在（输入框内容不丢）", async () => {
    const { rerender } = render(<MemoryRouter><TabbedOutlet tabs={tabsOf("/")} pathname="/" /></MemoryRouter>)
    await userEvent.type(screen.getByLabelText("a-input"), "半成品正文")

    // 切到知识库
    rerender(<MemoryRouter><TabbedOutlet tabs={tabsOf("/knowledge")} pathname="/knowledge" /></MemoryRouter>)
    expect(screen.getByLabelText("a-input")).toHaveValue("半成品正文") // 仍挂载且值还在

    // 切回驾驶舱
    rerender(<MemoryRouter><TabbedOutlet tabs={tabsOf("/")} pathname="/" /></MemoryRouter>)
    expect(screen.getByLabelText("a-input")).toHaveValue("半成品正文")
  })

  it("未注册路径不建标签，直接渲染 NotFound；已注册时不渲染", () => {
    render(<MemoryRouter><TabbedOutlet tabs={tabsOf("/")} pathname="/no-such-page" /></MemoryRouter>)
    expect(screen.getByText(/页面不存在|找不到|404/)).toBeInTheDocument()

    cleanup()
    render(<MemoryRouter><TabbedOutlet tabs={tabsOf("/")} pathname="/" /></MemoryRouter>)
    expect(screen.queryByText(/页面不存在|找不到|404/)).toBeNull()
  })
})

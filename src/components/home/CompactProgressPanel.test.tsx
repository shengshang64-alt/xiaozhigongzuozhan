/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import "@testing-library/jest-dom/vitest"
import { CompactProgressPanel } from "./CompactProgressPanel"
import type { ActiveWorkItem } from "@/pages/Home/activeWork"
import type { ActivityEvent } from "@/hooks/useActivityFeed"

afterEach(cleanup)

function LocationProbe() {
  const loc = useLocation()
  return <span data-testid="loc">{loc.pathname}</span>
}

const WORK: ActiveWorkItem[] = [
  {
    key: "b1",
    kind: "bid",
    name: "某医院标书",
    subtitle: "11 章",
    statusLabel: "编制中",
    route: "/bid-workspace",
    updated: "2026-11-07 09:00:00.000Z",
  },
  {
    key: "s1",
    kind: "solution",
    name: "某方案",
    subtitle: "",
    statusLabel: "编写中",
    route: "/solution-studio",
    updated: "2026-11-06 09:00:00.000Z",
  },
]

const EVENTS: ActivityEvent[] = [
  {
    id: "e1",
    kind: "bid",
    title: "某医院标书",
    desc: "解析完成",
    time: "2026-11-07 09:30:00.000Z",
    timeLabel: "09:30",
    route: "/bid-workspace",
  },
]

function renderPanel(overrides = {}) {
  const props = {
    activeWork: WORK,
    activeWorkTotal: 7,
    activeWorkLoading: false,
    todayEvents: EVENTS,
    eventsLoading: false,
    ...overrides,
  }
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <CompactProgressPanel {...props} />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe("CompactProgressPanel：进度速览双栏", () => {
  it("左栏进行中事项（工作台标签 + 溢出提示），右栏今日动态", () => {
    renderPanel()
    expect(screen.getByText("工作台进行中")).toBeInTheDocument()
    expect(screen.getByText("共 7 项")).toBeInTheDocument()
    // 同名条目可同时出现在左栏与右栏动态里，用出现次数断言
    expect(screen.getAllByText("某医院标书").length).toBe(2)
    expect(screen.getByText("标书")).toBeInTheDocument() // KIND_LABEL
    // 只有 2 条在制（≤5）不渲染溢出提示
    expect(screen.queryByText(/另有 \d+ 项/)).not.toBeInTheDocument()
    expect(screen.getByText("今日动态")).toBeInTheDocument()
    expect(screen.getByText("09:30")).toBeInTheDocument()
  })

  it("点击条目 → 站内跳转", () => {
    renderPanel()
    // 左栏与右栏动态里各有一条「某医院标书」，点左栏（进行中事项）的第一条
    fireEvent.click(screen.getAllByText("某医院标书")[0])
    expect(screen.getByTestId("loc")).toHaveTextContent("/bid-workspace")
  })

  it("双空态文案", () => {
    renderPanel({ activeWork: [], activeWorkTotal: 0, todayEvents: [] })
    expect(screen.getByText(/各工作台暂无进行中事项/)).toBeInTheDocument()
    expect(screen.getByText(/今天还没有新动态/)).toBeInTheDocument()
  })

  it("loading → 骨架屏（role=status）", () => {
    renderPanel({ activeWorkLoading: true, eventsLoading: true })
    expect(screen.getAllByRole("status").length).toBe(2)
  })

  it("截断到前 5 条（PROGRESS_PANEL_LIMIT）", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      ...WORK[0],
      key: `k${i}`,
      name: `事项${i}`,
    }))
    renderPanel({ activeWork: many, activeWorkTotal: 8 })
    expect(screen.getByText("事项0")).toBeInTheDocument()
    expect(screen.queryByText("事项7")).not.toBeInTheDocument()
    expect(screen.getByText(/另有 3 项/)).toBeInTheDocument()
  })
})

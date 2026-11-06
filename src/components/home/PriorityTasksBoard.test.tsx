/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import "@testing-library/jest-dom/vitest"
import { PriorityTasksBoard } from "./PriorityTasksBoard"
import { priorityTasksOf, type PriorityTask } from "@/pages/Home/homeLayout"
import type { MustSeeToday } from "@/pages/Home/useHome"

afterEach(cleanup)

function LocationProbe() {
  const loc = useLocation()
  return <span data-testid="loc">{loc.pathname}</span>
}

function renderWithRouter(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="*" element={<>{ui}<LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

const MUST_SEE: MustSeeToday = {
  overdue: [
    {
      id: "o1",
      group: "overdue",
      category: "todo",
      title: "回复澄清公告",
      meta: "待办",
      detail: "已逾期（截止 11-05）",
      route: "/intel-center",
    },
  ],
  dueToday: [],
  active: [
    {
      id: "a1",
      group: "active",
      category: "project",
      title: "某医院智慧病房方案",
      meta: "某医院",
      detail: "方案 · 进度 45% · 剩 7 天",
      project: {
        id: "p1",
        rh_user_id: "u1",
        project_name: "某医院智慧病房方案",
        project_type: "方案",
        hospital: "某医院",
        progress: 45,
        deadline: "2026-11-14",
        notes: "",
        created: "2026-11-01 10:00:00.000Z",
        updated: "2026-11-05 10:00:00.000Z",
      },
    },
  ],
  total: 4,
}

describe("PriorityTasksBoard：当天最重要的前 3 件事", () => {
  it("标题 + 总数徽标 + 溢出提示", () => {
    renderWithRouter(
      <PriorityTasksBoard tasks={priorityTasksOf(MUST_SEE, 3)} total={MUST_SEE.total} onOpenProject={() => {}} />,
    )
    expect(screen.getByText("今日优先任务")).toBeInTheDocument()
    expect(screen.getByText("共 4 项")).toBeInTheDocument()
    expect(screen.getByText(/另有 2 项/)).toBeInTheDocument()
  })

  it("任务卡带组别徽标与项目进度；点击项目任务打开详情回调", () => {
    const onOpen = vi.fn()
    renderWithRouter(
      <PriorityTasksBoard tasks={priorityTasksOf(MUST_SEE, 3)} total={2} onOpenProject={onOpen} />,
    )
    expect(screen.getByText("已逾期")).toBeInTheDocument()
    expect(screen.getByText("回复澄清公告")).toBeInTheDocument()
    expect(screen.getByText("45%")).toBeInTheDocument()
    fireEvent.click(screen.getByText("继续推进"))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it("点击路由任务 → 站内跳转", () => {
    renderWithRouter(
      <PriorityTasksBoard tasks={priorityTasksOf(MUST_SEE, 3)} total={1} onOpenProject={() => {}} />,
    )
    fireEvent.click(screen.getByText("去处理"))
    expect(screen.getByTestId("loc")).toHaveTextContent("/intel-center")
  })

  it("无事项 → 平静空态，不渲染任务卡", () => {
    renderWithRouter(<PriorityTasksBoard tasks={[]} total={0} onOpenProject={() => {}} />)
    expect(screen.getByText("今天没有逾期或到期事项，专注推进就好")).toBeInTheDocument()
    expect(screen.queryByText("共 0 项")).not.toBeInTheDocument()
  })

  it("loading → 骨架屏（带 role=status）", () => {
    renderWithRouter(<PriorityTasksBoard tasks={[]} total={0} loading onOpenProject={() => {}} />)
    expect(screen.getByRole("status")).toBeInTheDocument()
  })

  it("任务进度条宽度按百分比渲染（防呆：越界值夹紧在 0-100）", () => {
    const task: PriorityTask = {
      id: "x",
      group: "active",
      title: "越界进度",
      meta: "",
      detail: "",
      route: null,
      progress: 180,
      project: null,
    }
    renderWithRouter(<PriorityTasksBoard tasks={[task]} total={1} onOpenProject={() => {}} />)
    const bar = screen.getByTestId("progress-track").firstElementChild as HTMLElement | null
    expect(bar).not.toBeNull()
    expect(bar?.style.width).toBe("100%")
  })
})

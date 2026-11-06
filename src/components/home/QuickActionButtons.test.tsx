/** @vitest-environment jsdom */
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import "@testing-library/jest-dom/vitest"
import { QuickActionButtons } from "./QuickActionButtons"

afterEach(cleanup)

function LocationProbe() {
  const loc = useLocation()
  return <span data-testid="loc">{loc.pathname}</span>
}

/** 受控壳：todoInput 走真实 state，模拟 useHome 的受控行为 */
function Harness({ addTodo, todoAdding = false }: { addTodo: () => void; todoAdding?: boolean }) {
  const [todoInput, setTodoInput] = useState("")
  const [todoDueDate, setTodoDueDate] = useState("")
  return (
    <>
      <QuickActionButtons
        todoInput={todoInput}
        setTodoInput={setTodoInput}
        todoDueDate={todoDueDate}
        setTodoDueDate={setTodoDueDate}
        addTodo={addTodo}
        todoAdding={todoAdding}
      />
      <LocationProbe />
    </>
  )
}

function renderHarness(addTodo: () => void, todoAdding = false) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="*" element={<Harness addTodo={addTodo} todoAdding={todoAdding} />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe("QuickActionButtons：首屏快捷入口", () => {
  it("渲染四个入口", () => {
    renderHarness(vi.fn())
    for (const label of ["新建商机", "导入招标文件", "查询资质", "添加待办"]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it("三个入口站内跳转到对应模块", () => {
    renderHarness(vi.fn())
    fireEvent.click(screen.getByText("新建商机"))
    expect(screen.getByTestId("loc")).toHaveTextContent("/customer-management")
    fireEvent.click(screen.getByText("导入招标文件"))
    expect(screen.getByTestId("loc")).toHaveTextContent("/bid-workspace")
    fireEvent.click(screen.getByText("查询资质"))
    expect(screen.getByTestId("loc")).toHaveTextContent("/qual-certs")
  })

  it("添加待办：就地展开输入行，空内容禁用提交，提交调用 addTodo", () => {
    const addTodo = vi.fn()
    renderHarness(addTodo)

    const toggle = screen.getByText("添加待办").closest("button") as HTMLButtonElement
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")

    const input = screen.getByLabelText("待办内容")
    const submit = screen.getByText("添加")
    expect(submit).toBeDisabled()

    fireEvent.change(input, { target: { value: "周三前交资质扫描件" } })
    expect(submit).not.toBeDisabled()
    fireEvent.change(screen.getByLabelText("截止日期（可选）"), { target: { value: "2026-11-11" } })
    fireEvent.click(submit)
    expect(addTodo).toHaveBeenCalledTimes(1)
  })

  it("提交中（todoAdding）按钮禁用", () => {
    renderHarness(vi.fn(), true)
    fireEvent.click(screen.getByText("添加待办"))
    fireEvent.change(screen.getByLabelText("待办内容"), { target: { value: "x" } })
    expect(screen.getByText("添加")).toBeDisabled()
  })
})

/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { LoadingOverlay } from "./LoadingOverlay"

afterEach(cleanup)

describe("LoadingOverlay：异步操作遮罩", () => {
  it("默认消息 + role=status（可被读屏播报）", () => {
    render(
      <div className="relative">
        <LoadingOverlay />
      </div>,
    )
    expect(screen.getByRole("status")).toHaveTextContent("正在处理…")
  })

  it("自定义消息 + 全屏模式", () => {
    render(<LoadingOverlay message="正在导出标书…" fullscreen />)
    expect(screen.getByText("正在导出标书…")).toBeInTheDocument()
    const overlay = screen.getByRole("status")
    expect(overlay.className).toContain("fixed")
  })
})

// P0 回归（费用确认弹窗退出态）：确认运行后，弹窗遮罩必须**同步**进入 data-state=closed。
/** @vitest-environment jsdom */
//
// 背景（2026-10-24 实测）：确认运行会立刻执行付费动作，其中知识库问答在同一次点击里
// 同步做全量语料检索（重 CPU）。普通 setState 会被这段同步工作饿住——实测点击确认后
// Radix 遮罩连 data-state=closed 都拿不到，全屏 pointer-events:auto 拦截页面 6 秒+，
// 用户感知为“页面假死”。修复为 flushSync 先冲刷关闭渲染，再同步执行 action。
// index.css 另有 [data-dialog-exit-guard][data-state="closed"] { pointer-events:none;
// opacity:0 } 保险，让迟到的卸载也无害。本测试锁定前半段：closed 态必须在 click
// 返回前就落到 DOM 上。
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { CostConfirmDialog } from "./CostConfirmDialog"
import { useCostConfirm } from "@/hooks/useCostConfirm"

// vitest 未开 globals，RTL 的自动 cleanup 不生效，手动清
afterEach(cleanup)

function Harness({ action }: { action: () => void }) {
  const cc = useCostConfirm()
  return (
    <>
      <button onClick={() => cc.runWithCostConfirm(action, "预计 ¥0.01")}>触发</button>
      <CostConfirmDialog {...cc} />
    </>
  )
}

describe("CostConfirmDialog 退出态（P0：确认后遮罩不得拦截页面）", () => {
  it("确认运行后：action 同步执行，且遮罩/内容在 click 返回时已是 data-state=closed", () => {
    // 模拟知识库问答的重同步动作：阻塞主线程，制造“饿住渲染”的条件
    let actionRan = false
    const heavyAction = () => {
      actionRan = true
      const start = Date.now()
      while (Date.now() - start < 150) {
        /* 同步重活：语料检索同类负载 */
      }
    }
    render(<Harness action={heavyAction} />)
    act(() => {
      screen.getByText("触发").click()
    })
    const confirmBtn = screen.getByRole("button", { name: "确认运行" })
    const overlay = document.querySelector("[data-dialog-exit-guard]")
    expect(overlay?.getAttribute("data-state")).toBe("open")

    act(() => {
      confirmBtn.click()
    })
    // click 返回后立即可断言：action 已同步跑完（行为网契约）；弹窗要么已整体卸载
    // （jsdom 无流式饿死，flushSync 后 Presence 立即走完），要么至少进入 closed 态
    // （真实浏览器里卸载可能被流式渲染推迟，closed 由 index.css 保险驯服）。
    expect(actionRan).toBe(true)
    const overlayAfter = document.querySelector("[data-dialog-exit-guard]")
    const contentAfter = document.querySelector('[role="dialog"]')
    expect(overlayAfter === null || overlayAfter.getAttribute("data-state") === "closed").toBe(true)
    expect(contentAfter === null || contentAfter.getAttribute("data-state") === "closed").toBe(true)
  })

  it("取消：同样同步进入 closed 态", () => {
    const action = vi.fn()
    render(<Harness action={action} />)
    act(() => {
      screen.getByText("触发").click()
    })
    act(() => {
      screen.getByRole("button", { name: "取消" }).click()
    })
    expect(action).not.toHaveBeenCalled()
    const overlayAfter = document.querySelector("[data-dialog-exit-guard]")
    expect(overlayAfter === null || overlayAfter.getAttribute("data-state") === "closed").toBe(true)
  })
})

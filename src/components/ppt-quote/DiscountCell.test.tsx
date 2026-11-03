/** @vitest-environment jsdom */
/**
 * R42 · UI 回归网（第一张）：折扣单元格 DiscountCell
 *
 * 守的是 R40 修掉的那类「金额静默错」：
 *  - 0 < 值 < 5 的手填值有两种读法（按 % 还是按「几折」），相差 10~100 倍，直接乘进每行金额；
 *    旧实现会**静默钳位**（0.9 → 1，整行金额只剩原价 1%），用户只看到小计变小、不知道钱错了。
 *  - 现口径：歧义值**不落值、不钳位**，交回 DiscountIntentDialog 确认（onAsk）。
 *
 * 「删掉实现即变红」：把 DiscountCell.commit 里的 `if (discountAmbiguity(n)) { ... }` 分支删掉，
 * 第 3/4 条（断言 onCommit 未被调用）会立刻变红。
 *
 * 环境：本文件用 per-file 的 `@vitest-environment jsdom` 覆盖全局 node 环境，
 * 不动 vitest.config.ts 里既有 220 个测试文件的 node 环境（零回归风险）。
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { DiscountCell } from "./QuoteEditor"

afterEach(cleanup)

function setup(value = 100) {
  const onAsk = vi.fn()
  const onCommit = vi.fn()
  render(<DiscountCell value={value} ariaLabel="折扣" onAsk={onAsk} onCommit={onCommit} />)
  const input = screen.getByLabelText("折扣") as HTMLInputElement
  return { onAsk, onCommit, input }
}

/** 模拟：输入 raw 后失焦 */
function typeAndBlur(input: HTMLInputElement, raw: string) {
  fireEvent.change(input, { target: { value: raw } })
  fireEvent.blur(input)
}

describe("DiscountCell · 折扣单元格（R40 回归网）", () => {
  it("1. 渲染当前折扣值（受控）", () => {
    const { input } = setup(90)
    expect(input).toHaveValue(90)
  })

  it("2. 正常百分比 90 → 失焦提交 90，不弹确认", () => {
    const { input, onCommit, onAsk } = setup(100)
    typeAndBlur(input, "90")
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(90)
    expect(onAsk).not.toHaveBeenCalled()
  })

  it("3. 歧义值 3（可能想写「3 折」）→ 不落值、交回确认（金额绝不静默错）", () => {
    const { input, onCommit, onAsk } = setup(100)
    typeAndBlur(input, "3")
    expect(onAsk).toHaveBeenCalledTimes(1)
    expect(onAsk).toHaveBeenCalledWith(3)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("4. 歧义值 0.9（可能想写「9 折」）→ 不落值、交回确认", () => {
    const { input, onCommit, onAsk } = setup(100)
    typeAndBlur(input, "0.9")
    expect(onAsk).toHaveBeenCalledWith(0.9)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("5. 0 → 按原价 100 计（旧实现会静默钳成 1，整行金额只剩原价 1%）", () => {
    const { input, onCommit } = setup(90)
    typeAndBlur(input, "0")
    expect(onCommit).toHaveBeenCalledWith(100)
  })

  it("6. 超过 100 → 归一到 100", () => {
    const { input, onCommit } = setup(90)
    typeAndBlur(input, "120")
    expect(onCommit).toHaveBeenCalledWith(100)
  })

  it("7. 清空 → 按原价 100 计", () => {
    const { input, onCommit } = setup(90)
    fireEvent.change(input, { target: { value: "" } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith(100)
  })

  it("8. 回车即提交（不必失焦）", () => {
    const { input, onCommit } = setup(100)
    fireEvent.change(input, { target: { value: "85" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onCommit).toHaveBeenCalledWith(85)
  })

  it("9. 边界：5 是正常值（仅在 0 < 值 < 5 判歧义）", () => {
    const { input, onCommit, onAsk } = setup(100)
    typeAndBlur(input, "5")
    expect(onCommit).toHaveBeenCalledWith(5)
    expect(onAsk).not.toHaveBeenCalled()
  })

  it("10. 4.99 仍判歧义（阈值内侧）", () => {
    const { input, onCommit, onAsk } = setup(100)
    typeAndBlur(input, "4.99")
    expect(onAsk).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })
})

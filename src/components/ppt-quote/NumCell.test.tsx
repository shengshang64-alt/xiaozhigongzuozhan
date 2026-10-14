/** @vitest-environment jsdom */
/**
 * R42 · UI 回归网（第二张）：数字单元格 NumCell
 *
 * 守的是 A2-8 修掉的那类「数字悄悄错 / 悄悄没」：
 *  - 编辑期保留用户输入原文（不逐键钳位），非法/空值当场行内提示；
 *  - 只在失焦归一：空值回落 fallback，越界钳进 [min, max]；归一后提示必须消失，
 *    不能把非法草稿留在框里冒充「已生效的值」。
 *
 * 「删掉实现即变红」：删掉 NumCell 越界分支里的 setHint(...) → 第 5/6/7 条变红；
 * 删掉 onBlur 里的 setDraft(null) → 第 8 条变红；删掉空值提示 → 第 3 条变红。
 *
 * 环境：per-file `@vitest-environment jsdom`，不动全局 node 环境（其余用例零影响）。
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { NumCell } from "./QuoteEditor"

afterEach(cleanup)

type NumCellProps = Parameters<typeof NumCell>[0]

function setup(over: Partial<NumCellProps> = {}) {
  const onCommit = vi.fn()
  render(
    <NumCell
      value={5}
      min={1}
      max={100}
      fallback={1}
      ariaLabel="单价"
      onCommit={onCommit}
      {...over}
    />,
  )
  const input = screen.getByLabelText("单价") as HTMLInputElement
  return { onCommit, input }
}

const HINT = /失焦后自动修正/

describe("NumCell · 数字单元格（A2-8 回归网）", () => {
  it("1. 渲染当前值（受控）", () => {
    const { input } = setup({ value: 90 })
    expect(input).toHaveValue(90)
  })

  it("2. 区间内合法值 → 输入即提交，且无行内提示", () => {
    const { input, onCommit } = setup()
    fireEvent.change(input, { target: { value: "42" } })
    expect(onCommit).toHaveBeenCalledWith(42)
    expect(input).toHaveAttribute("aria-invalid", "false")
    expect(screen.queryByText(HINT)).toBeNull()
  })

  it("3. 清空 → 行内提示「不能为空」，且不落值", () => {
    const { input, onCommit } = setup()
    fireEvent.change(input, { target: { value: "" } })
    expect(onCommit).not.toHaveBeenCalled()
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByText(/不能为空，失焦后自动修正/)).toBeInTheDocument()
  })

  it("4. 清空后失焦 → 回落到 fallback（不留空、不静默变 0）", () => {
    const { input, onCommit } = setup({ value: 30, fallback: 7 })
    fireEvent.change(input, { target: { value: "" } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(7)
    expect(screen.queryByText(HINT)).toBeNull()
  })

  it("5. 低于 min → 提交钳位值，并留行内提示（旧实现只闪一下、无痕）", () => {
    const { input, onCommit } = setup()
    fireEvent.change(input, { target: { value: "0.5" } })
    expect(onCommit).toHaveBeenCalledWith(1)
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByText(/应在 1–100 之间/)).toBeInTheDocument()
  })

  it("6. 高于 max → 钳到 max，并留行内提示", () => {
    const { input, onCommit } = setup()
    fireEvent.change(input, { target: { value: "150" } })
    expect(onCommit).toHaveBeenCalledWith(100)
    expect(screen.getByText(/应在 1–100 之间/)).toBeInTheDocument()
  })

  it("7. 未设上限时的越界文案是「不能小于 N」", () => {
    const { input, onCommit } = setup({ max: undefined })
    fireEvent.change(input, { target: { value: "0.5" } })
    expect(onCommit).toHaveBeenCalledWith(1)
    expect(screen.getByText(/不能小于 1/)).toBeInTheDocument()
  })

  it("8. 失焦归一：提示清除、草稿复位（非法草稿不留在框里冒充生效值）", () => {
    const { input } = setup({ value: 5 })
    fireEvent.change(input, { target: { value: "150" } })
    expect(screen.getByText(/应在 1–100 之间/)).toBeInTheDocument()
    fireEvent.blur(input)
    expect(screen.queryByText(HINT)).toBeNull()
    expect(input).toHaveValue(5)
  })

  it("9. 未编辑直接失焦 → 提交 fallback 兜底（不把空草稿当 0）", () => {
    const { input, onCommit } = setup({ value: 5, fallback: 3 })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(3)
  })

  it("10. highlightZero：单价 ≤ 0 时带「待录入」底色", () => {
    const { input } = setup({ value: 0, highlightZero: true })
    expect(input.className).toContain("bg-amber-50/60")
  })

  it("11. highlightZero：单价 > 0 时不给底色（不误报待录入）", () => {
    const { input } = setup({ value: 12, highlightZero: true })
    expect(input.className).not.toContain("bg-amber-50/60")
  })
})

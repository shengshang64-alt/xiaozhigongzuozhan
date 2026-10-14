/** @vitest-environment jsdom */
/**
 * R42 · UI 回归网（第三张）：折扣歧义二次确认弹窗 DiscountIntentDialog
 *
 * 守的是 B8/R40 的口径：一个可能被读成「几折」的数字，绝不替用户猜、也绝不静默落值 ——
 *  - 必须把「按 % 念」「按 折 念」两种读法各换算成真实金额，摆出来让用户点；
 *  - 金额必须与小计同源（groupSubtotalAtDiscount），组件自己不另乘一遍；
 *  - 「都不是」只关窗，一字不改（onPick 不触发）；
 *  - 队列里还有多少笔要接着说清楚。
 *
 * 「删掉实现即变红」：把两个读法按钮的 onClick={() => onPick(r.pct)} 改成固定 onPick(100)
 * → 第 2/3 条变红；删掉「都不是」按钮 → 第 4 条变红。
 *
 * 环境：per-file `@vitest-environment jsdom`，不动全局 node 环境。
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { DiscountIntentDialog, type DiscountAsk } from "./DiscountIntentDialog"
import {
  formatMoney,
  groupSubtotalAtDiscount,
  type QuoteItem,
} from "@/pages/PptQuote/pptQuoteTypes"

afterEach(cleanup)

function line(id: string, price: number, qty = 1): QuoteItem {
  return { id, item_name: `行 ${id}`, spec: "", unit: "套", qty, price, discount: 100 }
}

function ask(over: Partial<DiscountAsk> = {}): DiscountAsk {
  return {
    scope: "row",
    groupId: "g1",
    itemId: "i1",
    label: "HIS 主模块",
    raw: 3,
    items: [line("i1", 100)],
    ...over,
  }
}

function show(a: DiscountAsk | null, queued = 0) {
  const onPick = vi.fn()
  const onCancel = vi.fn()
  render(<DiscountIntentDialog ask={a} queued={queued} onPick={onPick} onCancel={onCancel} />)
  return { onPick, onCancel }
}

describe("DiscountIntentDialog · 折扣歧义确认（B8 回归网）", () => {
  it("1. ask 为空 → 不渲染弹窗", () => {
    show(null)
    expect(screen.queryByText(/折扣写法有歧义/)).toBeNull()
  })

  it("2. 无歧义数字（90）→ 不渲染（只有歧义才拦）", () => {
    show(ask({ raw: 90 }))
    expect(screen.queryByText(/折扣写法有歧义/)).toBeNull()
  })

  it("3. 两种读法各点各的：按 % → 3；按 折 → 30（不替用户猜）", () => {
    const { onPick } = show(ask({ raw: 3 }))
    fireEvent.click(screen.getByRole("button", { name: /按 3% 计价/ }))
    expect(onPick).toHaveBeenCalledWith(3)
  })

  it("4. 习惯写「折」的一侧落 30（3 折），文案标明这一侧是给谁看的", () => {
    const { onPick } = show(ask({ raw: 3 }))
    const habit = screen.getByRole("button", { name: /按 30% 计价/ })
    expect(habit).toHaveTextContent(/习惯写「折」的人要的是这个/)
    fireEvent.click(habit)
    expect(onPick).toHaveBeenCalledWith(30)
  })

  it("5. 0.9 的两种读法是 0.9% / 90%（差 100 倍）", () => {
    const { onPick } = show(ask({ raw: 0.9 }))
    fireEvent.click(screen.getByRole("button", { name: /按 90% 计价/ }))
    expect(onPick).toHaveBeenCalledWith(90)
  })

  it("6. 金额与小计同源：两种读法展示的钱 = groupSubtotalAtDiscount(items, pct)", () => {
    const items = [line("i1", 100, 2)]
    show(ask({ items }))
    const pctBtn = screen.getByRole("button", { name: /按 3% 计价/ })
    const habitBtn = screen.getByRole("button", { name: /按 30% 计价/ })
    const text = (pct: number) =>
      `本行小计 ¥ ${formatMoney(groupSubtotalAtDiscount(items, pct))}（原价 ¥ ${formatMoney(
        groupSubtotalAtDiscount(items, 100),
      )}）`
    expect(pctBtn).toHaveTextContent(text(3))
    expect(habitBtn).toHaveTextContent(text(30))
  })

  it("7. 「都不是，返回改数字」→ 只关窗，一字不改", () => {
    const { onPick, onCancel } = show(ask())
    fireEvent.click(screen.getByRole("button", { name: /都不是，返回改数字/ }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onPick).not.toHaveBeenCalled()
  })

  it("8. 队列还有下一笔时必须说清楚（queued > 0）", () => {
    show(ask(), 2)
    expect(screen.getByText(/确认后接着处理剩下的 2 笔/)).toBeInTheDocument()
  })

  it("9. 队列空了就不要提（queued = 0）", () => {
    show(ask(), 0)
    expect(screen.queryByText(/接着处理剩下的/)).toBeNull()
  })

  it("10. 整组批量时按组报行数（本组 N 行），单行则说「本行」", () => {
    const items = [line("i1", 100), line("i2", 50)]
    show(ask({ scope: "group", itemId: undefined, items }))
    expect(screen.getByRole("button", { name: /按 3% 计价/ })).toHaveTextContent(/本组 2 行小计/)
  })

  it("11. 确认对象要写清楚是哪一笔钱（label）", () => {
    show(ask({ label: "检验模块 LIS" }))
    expect(screen.getByText(/确认对象：检验模块 LIS/)).toBeInTheDocument()
  })
})

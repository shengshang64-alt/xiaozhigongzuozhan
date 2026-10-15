/** @vitest-environment jsdom */
/**
 * R48 · UI 回归网：报价编辑器「行编辑 → 行小计 / 组小计 / 总计」往返一致性。
 *
 * 守的是 R034/R037/R040 反复修过、也最容易复发的一类事故：**同一笔钱在界面上出现两套数字**。
 *  - 行小计：编辑器第 674/798 行用 `itemSubtotal(item)`（R034 起为「微元整数精确相乘 + 分位远离零舍入」单一真源）；
 *  - 组小计 / 总计：由调用方（usePptQuote:1795）用 `groupSubtotal` / `quoteTotal` 算出后经 `totals` 传入；
 *  - 导出（Excel/Word）与交付体检读的是同一组单源函数。
 * 任何一处改回裸浮点 `qty*price*discount/100`，本文件第 1/3 组断言就会在「真值恰好半分」的行上少 1 分而变红
 * （用例行：15 × 599,729.21 × 90% 精确值 8,096,344.34，裸浮点得 .33）。
 *
 * 环境：per-file `@vitest-environment jsdom`，不动全局 node 环境（同 DiscountCell.test.tsx 口径）。
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { useMemo, useState } from "react"
import { QuoteEditor } from "./QuoteEditor"
import {
  formatMoney,
  groupSubtotal,
  itemSubtotal,
  quoteTotal,
  type QuoteGroup,
  type QuoteItem,
  type QuoteRecord,
} from "@/pages/PptQuote/pptQuoteTypes"

afterEach(cleanup)

// ---------------------------------------------------------------------------
// fixture：两分组三行。A1 特意选「真值恰好半分」的量级（R034 的经典反例）。
// ---------------------------------------------------------------------------
function line(over: Partial<QuoteItem>): QuoteItem {
  return {
    id: "x",
    item_name: "未命名行",
    spec: "",
    unit: "套",
    qty: 1,
    price: 100,
    discount: 100,
    category: "医疗信息化",
    product_name: "",
    module_name: "",
    module_func: "",
    source: "company",
    product_id: "",
    rating_hits: [],
    remark: "",
    ...over,
  } as QuoteItem
}

function baseQuote(): QuoteRecord {
  const groups: QuoteGroup[] = [
    {
      id: "g-soft",
      name: "软件",
      items: [
        line({ id: "a1", item_name: "电子病历系统", qty: 15, price: 599729.21, discount: 90 }),
        line({ id: "a2", item_name: "实施服务", qty: 2, price: 5000, discount: 100 }),
      ],
    },
    {
      id: "g-hw",
      name: "硬件",
      items: [line({ id: "b1", item_name: "服务器", qty: 3, price: 1000, discount: 100 })],
    },
  ]
  return {
    id: "q1",
    rh_user_id: "local-user",
    quote_name: "回归网报价单",
    ref_type: "",
    ref_id: "",
    ref_name: "",
    opportunity_id: "",
    opportunity_name: "",
    groups,
    tax_note: "",
    version: "v1",
    created: "",
    updated: "",
  } as QuoteRecord
}

/**
 * 状态化 harness：等价线上 usePptQuote 的 mutateQuote 路径——
 * 编辑只改 quote state，totals 永远由**同一组单源函数**从最新 state 重算。
 * 若编辑器内部另算一套（或 totals 口径漂移），下面的断言立刻对不上。
 */
function Harness({ initial }: { initial: QuoteRecord }) {
  const [quote, setQuote] = useState(initial)
  const totals = useMemo(() => {
    const byGroup: Record<string, number> = {}
    for (const g of quote.groups) byGroup[g.id] = groupSubtotal(g)
    return { byGroup, total: quoteTotal(quote.groups) }
  }, [quote])

  const updateItem = (groupId: string, itemId: string, patch: Partial<QuoteItem>) =>
    setQuote((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id !== groupId
          ? g
          : { ...g, items: g.items.map((it) => (it.id !== itemId ? it : { ...it, ...patch })) },
      ),
    }))
  const setGroupDiscount = (groupId: string, discount: number) =>
    setQuote((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id !== groupId ? g : { ...g, items: g.items.map((it) => ({ ...it, discount })) },
      ),
    }))

  return (
    <QuoteEditor
      quote={quote}
      totals={totals}
      onBack={vi.fn()}
      onRename={vi.fn()}
      onTaxNoteChange={vi.fn()}
      onVersionChange={vi.fn()}
      addGroup={vi.fn()}
      deleteGroup={vi.fn()}
      renameGroup={vi.fn()}
      updateItem={updateItem}
      setGroupDiscount={setGroupDiscount}
      deleteItem={vi.fn()}
      saveItemToLibrary={vi.fn()}
      onAiDraft={vi.fn()}
      onExportXlsx={vi.fn()}
      onExportWord={vi.fn()}
      syncOppAmount={false}
      onSyncOppAmountChange={vi.fn()}
      oppSyncFailed={false}
      persistFailed={false}
      onSaveNow={vi.fn()}
      openCheckProductPicker={vi.fn()}
      openChecklistImport={vi.fn()}
      addManualItem={vi.fn()}
    />
  )
}

/** 取「数量」输入框（按行序：a1、a2、b1） */
function qtyInputs() {
  return screen.getAllByLabelText("数量") as HTMLInputElement[]
}
function priceInputs() {
  return screen.getAllByLabelText("单价（元）") as HTMLInputElement[]
}
function discountInputs() {
  return screen.getAllByLabelText("折扣（百分比）") as HTMLInputElement[]
}

describe("QuoteEditor · 行编辑 → 小计/组小计/总计 往返（R48 回归网）", () => {
  it("1. 首屏：行小计逐分等于 itemSubtotal（含真值恰好半分的 15 × 599,729.21 × 90% = 8,096,344.34）", () => {
    render(<Harness initial={baseQuote()} />)
    // 裸浮点实现会渲染 8,096,344.33 → 本断言即「改回浮点就变红」
    expect(screen.getAllByText("8,096,344.34").length).toBeGreaterThan(0)
    expect(screen.queryByText("8,096,344.33")).not.toBeInTheDocument()
    expect(screen.getAllByText("10,000.00").length).toBeGreaterThan(0)
    expect(screen.getAllByText("3,000.00").length).toBeGreaterThan(0)
  })

  it("2. 首屏：组小计 = 该组各行小计之和；总计 = 各组小计之和（三处同源）", () => {
    const q = baseQuote()
    render(<Harness initial={q} />)
    const gA = groupSubtotal(q.groups[0])
    const gB = groupSubtotal(q.groups[1])
    expect(gA).toBeCloseTo(8_096_344.34 + 10_000, 2)
    expect(gB).toBeCloseTo(3_000, 2)
    expect(screen.getAllByText(formatMoney(gA)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(formatMoney(gB)).length).toBeGreaterThan(0)
    expect(screen.getByText(`¥ ${formatMoney(quoteTotal(q.groups))}`)).toBeInTheDocument()
    // 结构不变式：行小计之和 = 组小计之和 = 总计
    const sumOfLines = q.groups
      .flatMap((g) => g.items)
      .reduce((s, it) => s + itemSubtotal(it), 0)
    expect(sumOfLines).toBeCloseTo(quoteTotal(q.groups), 2)
  })

  it("3. 改数量 15 → 10：行小计 / 组小计 / 总计 同步，且逐分等于单源重算值", () => {
    render(<Harness initial={baseQuote()} />)
    fireEvent.change(qtyInputs()[0], { target: { value: "10" } })

    const after = baseQuote()
    after.groups[0].items[0] = { ...after.groups[0].items[0], qty: 10 }
    const lineA1 = itemSubtotal(after.groups[0].items[0])
    expect(lineA1).toBeCloseTo(5_397_562.89, 2)
    expect(screen.getByText(formatMoney(lineA1))).toBeInTheDocument()
    expect(screen.getByText(formatMoney(groupSubtotal(after.groups[0])))).toBeInTheDocument()
    expect(screen.getByText(`¥ ${formatMoney(quoteTotal(after.groups))}`)).toBeInTheDocument()
  })

  it("4. 改折扣 90 → 50（失焦提交）：三处金额同步，不出现歧义弹窗", () => {
    render(<Harness initial={baseQuote()} />)
    const d = discountInputs()[0]
    fireEvent.change(d, { target: { value: "50" } })
    fireEvent.blur(d)

    const after = baseQuote()
    after.groups[0].items[0] = { ...after.groups[0].items[0], discount: 50 }
    const lineA1 = itemSubtotal(after.groups[0].items[0])
    expect(lineA1).toBeCloseTo(4_497_969.08, 2) // 15 × 599,729.21 × 50%
    expect(screen.getByText(formatMoney(lineA1))).toBeInTheDocument()
    expect(screen.getByText(`¥ ${formatMoney(quoteTotal(after.groups))}`)).toBeInTheDocument()
    // 折扣列口径文案仍在（防「静默改金额」回归）
    expect(screen.queryByText(/折扣写法有歧义/)).not.toBeInTheDocument()
  })

  it("5. 改单价 5000 → 8000：三处金额同步", () => {
    render(<Harness initial={baseQuote()} />)
    fireEvent.change(priceInputs()[1], { target: { value: "8000" } })

    const after = baseQuote()
    after.groups[0].items[1] = { ...after.groups[0].items[1], price: 8000 }
    const lineA2 = itemSubtotal(after.groups[0].items[1])
    expect(lineA2).toBeCloseTo(16_000, 2)
    expect(screen.getByText(formatMoney(lineA2))).toBeInTheDocument()
    expect(screen.getByText(`¥ ${formatMoney(quoteTotal(after.groups))}`)).toBeInTheDocument()
  })

  it("6. 连续多次编辑后，界面上出现的行小计集合 = 单源重算集合（无残留旧值）", () => {
    render(<Harness initial={baseQuote()} />)
    fireEvent.change(qtyInputs()[0], { target: { value: "10" } })
    fireEvent.change(qtyInputs()[2], { target: { value: "7" } })

    const after = baseQuote()
    after.groups[0].items[0] = { ...after.groups[0].items[0], qty: 10 }
    after.groups[1].items[0] = { ...after.groups[1].items[0], qty: 7 }
    for (const g of after.groups) {
      for (const it of g.items) {
        expect(screen.getAllByText(formatMoney(itemSubtotal(it))).length).toBeGreaterThan(0)
      }
    }
    // 旧值必须已经消失（防止「改了 state 但界面仍显示旧小计」）
    expect(screen.queryByText("8,096,344.34")).not.toBeInTheDocument()
    expect(screen.queryByText("3,000.00")).not.toBeInTheDocument()
  })
})

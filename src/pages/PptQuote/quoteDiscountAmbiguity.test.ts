// R40 backlog B8（折扣语义歧义入口）：判定单一真源 + 两个入口都不再静默钳位。
// 本机 vitest environment=node（无 jsdom/RTL），沿用 quoteDiscount.test.ts /
// priceScoreWiring.test.ts 的「纯函数 + 源码扫描」双轨范式。
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { DISCOUNT_AMBIGUOUS_BELOW, discountAmbiguity, isAmbiguousDiscount } from "@/lib/discountIntent"
import {
  groupSubtotalAtDiscount,
  itemSubtotal,
  itemSubtotalAtDiscount,
  normalizeDiscount,
  scanAmbiguousDiscounts,
  type QuoteGroup,
  type QuoteItem,
} from "@/pages/PptQuote/pptQuoteTypes"

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

// 按行剥 CR：跨工作区补丁写回可能产生 CRLF，含换行的 toContain 会因此假红
const read = (rel: string) =>
  readFileSync(path.join(SRC, rel), "utf-8")
    .split(String.fromCharCode(10))
    .map((l) => (l.endsWith(String.fromCharCode(13)) ? l.slice(0, -1) : l))
    .join(String.fromCharCode(10))

const line = (patch: Partial<QuoteItem> = {}): QuoteItem =>
  ({
    id: "i1",
    item_name: "HIS 授权",
    spec: "",
    unit: "套",
    qty: 1,
    price: 99000,
    discount: 100,
    ...patch,
  }) as QuoteItem

describe("discountAmbiguity（R40 B8 歧义判定单一真源）", () => {
  it("0.9：两种读法 0.9% 与 90%，相差 100 倍；换算值定点干净不留二进制尾差", () => {
    const a = discountAmbiguity(0.9)
    expect(a).not.toBeNull()
    expect(a?.percent.pct).toBe(0.9)
    expect(a?.habit.pct).toBe(90)
    expect(a?.ratio).toBe(100)
    expect(a?.habit.caption).toContain("90% 计价")
    expect(a?.habit.caption).toContain("9 折")
  })

  it("3 与 4.5：按「几折」读法是 30% / 45%，相差 10 倍", () => {
    expect(discountAmbiguity(3)?.habit.pct).toBe(30)
    expect(discountAmbiguity(3)?.habit.caption).toContain("3 折")
    expect(discountAmbiguity(4.5)?.habit.pct).toBe(45)
    expect(discountAmbiguity(4.5)?.ratio).toBe(10)
  })

  it("1 也属歧义（是 1% 还是 1 折 = 10%），不被当成「最小合法值」放过", () => {
    const a = discountAmbiguity(1)
    expect(a?.percent.pct).toBe(1)
    expect(a?.habit.pct).toBe(10)
  })

  it("阈值以上不判歧义：5 / 6 / 85.5 / 90 / 100 按百分比直接落值", () => {
    for (const d of [DISCOUNT_AMBIGUOUS_BELOW, 6, 85.5, 90, 100]) expect(discountAmbiguity(d)).toBeNull()
  })

  it("≤0 / 缺省 / 非有限值不判歧义（R285 的「视为原价」不是写法歧义）", () => {
    for (const d of [0, -1, -100, undefined, null, NaN, Infinity]) expect(discountAmbiguity(d)).toBeNull()
  })

  it("判定是纯函数：只报读法，不返回钳位结果、不改写原值", () => {
    const a = discountAmbiguity(0.9)
    expect(a?.raw).toBe(0.9)
    expect(a?.percent.pct).toBeLessThan(DISCOUNT_AMBIGUOUS_BELOW)
    expect(isAmbiguousDiscount(0.9)).toBe(true)
    expect(isAmbiguousDiscount(90)).toBe(false)
    expect(isAmbiguousDiscount(undefined)).toBe(false)
  })
})

describe("normalizeDiscount（R285 裁定不得被本轮改动）", () => {
  it("≤0 / 缺省 / 非法仍归一为原价 100，>100 封顶", () => {
    expect(normalizeDiscount(0)).toBe(100)
    expect(normalizeDiscount(-5)).toBe(100)
    expect(normalizeDiscount(undefined)).toBe(100)
    expect(normalizeDiscount(NaN)).toBe(100)
    expect(normalizeDiscount(120)).toBe(100)
  })

  it("歧义值不被静默钳位：0.9 原样返回，读法由确认弹窗交回用户", () => {
    expect(normalizeDiscount(0.9)).toBe(0.9)
    expect(normalizeDiscount(1)).toBe(1)
  })
})

describe("按折扣换算金额（确认弹窗用来把钱说清）", () => {
  it("同一行按 0.9% 与按 90% 计价差 100 倍 —— 这就是必须让用户点一次的理由", () => {
    const row = line({ discount: 0.9 })
    expect(itemSubtotal(row)).toBe(891)
    expect(itemSubtotalAtDiscount(row, 0.9)).toBe(891)
    expect(itemSubtotalAtDiscount(row, 90)).toBe(89100)
    expect(itemSubtotalAtDiscount(row, 100)).toBe(99000)
  })

  it("R34 半分案例在换算口里同样精确：15 × 599,729.21 × 90% = 8,096,344.34", () => {
    const row = line({ qty: 15, price: 599729.21 })
    expect(itemSubtotalAtDiscount(row, 90)).toBe(8096344.34)
    expect(groupSubtotalAtDiscount([row, line({ id: "i2", price: 1000 })], 90)).toBe(8097244.34)
  })

  it("空行列表返回 0；pct ≤0 按 R285 走原价，不会把金额清零", () => {
    expect(groupSubtotalAtDiscount([], 90)).toBe(0)
    expect(itemSubtotalAtDiscount(line(), 0)).toBe(99000)
  })
})

describe("scanAmbiguousDiscounts（已落库数据的只读盘点）", () => {
  const groups: QuoteGroup[] = [
    { id: "g1", name: "软件", items: [line({ id: "a", discount: 0.9 }), line({ id: "b", discount: 90 })] },
    {
      id: "g2",
      name: "硬件",
      items: [line({ id: "c", item_name: "   ", discount: 1 }), line({ id: "d", discount: 5 }), line({ id: "e", discount: 0 })],
    },
  ]

  it("只命中歧义行，带上组名/行名/原值，且不改动任何数据", () => {
    const hits = scanAmbiguousDiscounts(groups)
    expect(hits.map((h) => h.itemId)).toEqual(["a", "c"])
    expect(hits[0].groupName).toBe("软件")
    expect(hits[0].raw).toBe(0.9)
    expect(hits[1].itemName).toBe("未命名行")
    expect(groups[0].items[0].discount).toBe(0.9)
  })

  it("空数组 / 缺 items / 缺 discount 的老记录都安全", () => {
    expect(scanAmbiguousDiscounts([])).toEqual([])
    expect(scanAmbiguousDiscounts([{ id: "g", name: "x" } as unknown as QuoteGroup])).toEqual([])
    expect(
      scanAmbiguousDiscounts([
        { id: "g", name: "x", items: [{ id: "z", item_name: "n", qty: 1, price: 1 } as QuoteItem] },
      ]),
    ).toEqual([])
  })
})

describe("入口接线哨兵（源码级锁：不许再把歧义值静默钳进金额）", () => {
  const editor = read("components/ppt-quote/QuoteEditor.tsx")
  const dlg = read("components/ppt-quote/DiscountIntentDialog.tsx")
  const check = read("lib/deliverability.ts")

  it("行内折扣格不再走 NumCell 的 min/fallback 钳位，改为 DiscountCell + onAsk", () => {
    const i = editor.indexOf('ariaLabel="折扣（百分比）"')
    expect(i).toBeGreaterThan(-1)
    expect(editor.slice(Math.max(0, i - 160), i)).toContain("<DiscountCell")
    const after = editor.slice(i, i + 700)
    expect(after).toContain("onAsk=")
    expect(after).toContain("{ discount: normalizeDiscount(n) }")
    expect(after).not.toContain("fallback=")
    expect(after).not.toContain("min={1}")
  })

  it("整组批量折扣：先判歧义再落值（判定必须排在 setGroupDiscount 之前）", () => {
    const i = editor.indexOf('aria-label="整组折扣百分比"')
    expect(i).toBeGreaterThan(-1)
    const seg = editor.slice(i, i + 1600)
    expect(seg).toContain("discountAmbiguity(n)")
    expect(seg.indexOf("discountAmbiguity(n)")).toBeLessThan(seg.indexOf("setGroupDiscount(group.id, n)"))
  })

  it("已落库歧义行有横幅 + 逐行确认队列，确认弹窗挂在编辑器里", () => {
    expect(editor).toContain("scanAmbiguousDiscounts(")
    expect(editor).toContain("逐行确认")
    expect(editor).toContain("<DiscountIntentDialog")
    expect(editor).toContain("askQueue")
  })

  it("弹窗把两种读法各换算成真实金额，且「不选就什么都不改」", () => {
    expect(dlg).toContain("onPick(r.pct)")
    expect(dlg).toContain("groupSubtotalAtDiscount")
    expect(dlg).toContain("不选就什么都不改")
    expect(dlg).toContain("都不是，返回改数字")
  })

  it("报价交付体检同步盘点歧义折扣，只出 warn 不阻断（维持只报不拦裁定）", () => {
    expect(check).toContain("isAmbiguousDiscount")
    expect(check).toContain("疑似按「几折」")
    expect(check).toContain('criterion: "verbatim_fidelity",\n      severity: "warn"')
  })
})

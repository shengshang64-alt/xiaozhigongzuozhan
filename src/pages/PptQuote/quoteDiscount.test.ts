// R285 r281-quote-discount-no-entry：discount 字段此前全链路常量 100、无任何录入入口，
// 「改了也白改」。本测试锁定录入链路的四处锚点，任何一处被拆掉即报警：
//   UI 列（QuoteEditor 折扣% + 整组批量）→ 页面接线（PptQuotePage）→
//   算子（usePptQuote.setGroupDiscount）→ 导出（quoteItemSubtotalFormula 同口径）。
// 纯源码扫描（node fs），本机无 jsdom/RTL，与 disclosureA11y.test.ts 同范式。
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// 本文件位于 src/pages/PptQuote/，../.. 才到 src 根（disclosureA11y 在 src/components/ 下只需 ..）
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

// 按行剥 CR：跨工作区补丁写回可能产生 CRLF，含换行的 toContain 会因此假红
const read = (rel: string) =>
  readFileSync(path.join(SRC, rel), "utf-8")
    .split(String.fromCharCode(10))
    .map((l) => (l.endsWith(String.fromCharCode(13)) ? l.slice(0, -1) : l))
    .join(String.fromCharCode(10))

describe("quoteDiscount 录入链路（R285）", () => {
  const editor = read("components/ppt-quote/QuoteEditor.tsx")
  const page = read("pages/PptQuote/PptQuotePage.tsx")
  const hook = read("pages/PptQuote/usePptQuote.ts")
  const exportsSrc = read("pages/PptQuote/quoteExports.ts")

  it("QuoteEditor 有行内折扣%录入（NumCell 写回 discount），不再无入口", () => {
    expect(editor).toContain('ariaLabel="折扣（百分比）"')
    expect(editor).toContain("{ discount: normalizeDiscount(n) }")
    expect(editor).toContain("折扣(%)")
  })

  it("QuoteEditor 有整组批量折扣入口（整包折让），且 UI 层拒绝 0（min=1）", () => {
    expect(editor).toContain('aria-label="整组折扣百分比"')
    expect(editor).toContain("setGroupDiscount(group.id, n)")
    expect(editor).toContain("min={1}")
  })

  it("PptQuotePage 把 setGroupDiscount 接进 QuoteEditor（接线不断）", () => {
    expect(page).toContain("setGroupDiscount={p.setGroupDiscount}")
  })

  it("usePptQuote 定义并暴露 setGroupDiscount（函数式 mutateQuote，非整数组竞态写法）", () => {
    expect(hook).toContain("const setGroupDiscount = useCallback(")
    expect(hook).toContain("setGroupDiscount,")
    expect(hook).toContain("items: (g.items ?? []).map((it) => ({ ...it, discount: d }))")
    expect(hook).toContain("mutateQuote((q) => ({")
  })

  it("导出 Excel 公式与 itemSubtotal 共用 normalizeDiscount 单一口径（R281 接续）", () => {
    expect(exportsSrc).toContain("const discount = normalizeDiscount(it.discount)")
    expect(exportsSrc).toContain("normalizeDiscount,")
  })
})

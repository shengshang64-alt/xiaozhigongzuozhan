// R34 报价金额交付正确性（quote-total-cent + 大写单源）。
//
// 审计起点：旧 itemSubtotal 用 `Math.round(qty*price*(disc/100)*100)/100`，
// 在「真值恰好半分」的二进制浮点处系统性少 1 分（200,000 组真实量级随机用例中 8.3% 命中）。
// 客户侧 Excel 的 ROUND、计算器与人工复核都给「四舍五入」那一侧，于是同一份报价单
// 出现两套数字——报价单是对外交付物，一分之差属被质疑级风险（与 R281 同一判断口径）。
//
// 本文件三层锁定：
//   1) 纯函数：半分边界逐分对齐 + 任意规模累加不漂移；
//   2) 大写单源：quoteTotalUpper 由 quoteTotal 派生且与 parseCnyUpper 互逆；
//   3) 接线：Word/Excel/编辑器三处出口真实带上大写（Excel 走 workbook 截获，非源码想象）。
import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { fileURLToPath } from "node:url"
import { parseCnyUpper } from "@/lib/currencyCn"
import { centsToYuan, productCents } from "@/lib/money"
import {
  groupSubtotal,
  groupSubtotalCents,
  itemSubtotal,
  itemSubtotalCents,
  quoteTotal,
  quoteTotalCents,
  quoteTotalUpper,
  type QuoteGroup,
  type QuoteItem,
} from "./pptQuoteTypes"

// 截获两个出口产物：wb = 传给 XLSX.writeFile 的 workbook，blob = 触发下载的 docx Blob
const cap = vi.hoisted(() => ({ wb: undefined as unknown, blob: undefined as unknown }))
const writeFileCapture = cap
vi.mock("xlsx-js-style", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>
  const base = ((mod.default ?? mod) as Record<string, unknown>) ?? {}
  return { ...base, writeFile: (wb: unknown) => (writeFileCapture.wb = wb) }
})
// Word 出口只截获下载动作，产物 Blob 原样留着拆 zip（不 mock 库本身，防「测试绿了文件没变」）
vi.mock("@/lib/download", () => ({
  triggerBlobDownload: (blob: unknown) => {
    writeFileCapture.blob = blob
  },
}))
import { exportQuoteDocx, exportQuoteXlsx } from "./quoteExports"

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf-8")

const item = (qty: number, price: number, discount: number): QuoteItem =>
  ({ id: "i1", item_name: "x", spec: "", unit: "套", qty, price, discount }) as QuoteItem

// ---------------------------------------------------------------------------
// 1) 精确到分
// ---------------------------------------------------------------------------

describe("itemSubtotal 半分边界（R34 回归锁）", () => {
  it.each([
    // 手算可核对：15 × 599,729.21 × 90% = 8,096,344.335 → 四舍五入到分 = .34（旧实现给 .33）
    [15, 599729.21, 90, 8096344.34],
    // 5 × 30,553.70 × 95% = 145,130.075 → .08（旧实现给 145,130.07）
    [5, 30553.7, 95, 145130.08],
    // 3 × 87,456.70 × 95% = 249,251.595 → .60（旧实现给 249,251.59）
    [3, 87456.7, 95, 249251.6],
    // 无折扣且非边界：1.5 × 12,345.67 = 18,518.505 → .51（旧实现此处恰好也对，锁住不回归）
    [1.5, 12345.67, 100, 18518.51],
    // 单价含分、整数数量：不进位
    [3, 19.99, 100, 59.97],
  ] as [number, number, number, number][])(
    "%s × %s × %s%% = %s",
    (qty, price, disc, expected) => {
      expect(itemSubtotal(item(qty, price, disc))).toBe(expected)
      expect(itemSubtotalCents(item(qty, price, disc))).toBe(Math.round(expected * 100))
    },
  )

  it("旧写法确实偏小：同一组数据下浮点舍入给 .33/.07，新口径给 .34/.08", () => {
    const legacyA = Math.round(15 * 599729.21 * (90 / 100) * 100) / 100
    const legacyB = Math.round(5 * 30553.7 * (95 / 100) * 100) / 100
    expect(legacyA).toBe(8096344.33)
    expect(legacyB).toBe(145130.07)
    expect(itemSubtotal(item(15, 599729.21, 90))).toBe(8096344.34)
    expect(itemSubtotal(item(5, 30553.7, 95))).toBe(145130.08)
  })

  it("随机规模：结果恒为整分，且与真值偏差不超过半分", () => {
    let seed = 20261014
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const discs = [100, 95, 90, 88, 85, 80, 66.667]
    for (let t = 0; t < 4000; t++) {
      const qty = Math.round(rnd() * 40) / (rnd() < 0.3 ? 2 : 1)
      const price = Math.round(rnd() * 1e8) / 100
      const disc = discs[Math.floor(rnd() * discs.length)]
      const cents = itemSubtotalCents(item(qty, price, disc))
      expect(Number.isInteger(cents)).toBe(true)
      // 对照值本身是二进制浮点（带 1e-9 量级尾差），故给一个随量级放大的容差
      const truth = qty * price * (disc / 100)
      expect(Math.abs(centsToYuan(cents) - truth)).toBeLessThanOrEqual(0.005 + Math.abs(truth) * 1e-9)
    }
  })

  it("脏值口径不变：折扣 0/负/NaN 按原价，数量单价缺失按 0", () => {
    expect(itemSubtotal({ ...item(2, 1000, 0) })).toBe(2000)
    expect(itemSubtotal(item(2, 1000, -50))).toBe(2000)
    expect(itemSubtotal(item(2, 1000, NaN))).toBe(2000)
    expect(itemSubtotal(item(0, 1000, 90))).toBe(0)
    expect(itemSubtotalCents(item(2, 1000, 90))).toBe(180000)
  })

  it("productCents：因子含 0 直接归零，负值走远离零（与 Excel ROUND 同侧）", () => {
    expect(productCents([3, 100, 0])).toBe(0)
    expect(productCents([-1.5, 100, 1])).toBe(-15000)
    expect(centsToYuan(productCents([2, 3, 4]))).toBe(24)
  })

  it("三层不漂移：总计 === 逐行分位求和（300 行大表）", () => {
    const items = Array.from({ length: 300 }, (_, i) =>
      item(i % 7 === 0 ? 1.5 : 1, 12345.67 + i, i % 3 === 0 ? 90 : 95),
    )
    const groups: QuoteGroup[] = [
      { id: "g1", name: "软件", items: items.slice(0, 150) },
      { id: "g2", name: "服务", items: items.slice(150) },
      { id: "g3", name: "空组", items: [] },
    ]
    const cents = items.reduce((s, it) => s + itemSubtotalCents(it), 0)
    expect(quoteTotalCents(groups)).toBe(cents)
    expect(quoteTotal(groups)).toBe(centsToYuan(cents))
    expect(groupSubtotalCents(groups[0])).toBe(
      items.slice(0, 150).reduce((s, it) => s + itemSubtotalCents(it), 0),
    )
    expect(groupSubtotal(groups[1])).toBe(centsToYuan(groupSubtotalCents(groups[1])))
  })
})

// ---------------------------------------------------------------------------
// 2) 大写单源
// ---------------------------------------------------------------------------

describe("quoteTotalUpper 大写单源", () => {
  it("带「人民币」前缀，且与 parseCnyUpper 互逆（大小写逐分一致）", () => {
    const groups: QuoteGroup[] = [
      { id: "g1", name: "软件", items: [item(15, 599729.21, 90), item(1.5, 12345.67, 100)] },
    ]
    const upper = quoteTotalUpper(groups)
    // 8,096,344.34 + 18,518.51 = 8,114,862.85
    expect(quoteTotal(groups)).toBe(8114862.85)
    expect(upper).toBe("人民币捌佰壹拾壹万肆仟捌佰陆拾贰元捌角伍分")
    expect(parseCnyUpper(upper)).toBe(quoteTotal(groups))
  })

  it("改单价后大写跟着变（手填大写会停在旧值，这正是单源要消灭的）", () => {
    const groups: QuoteGroup[] = [{ id: "g1", name: "软件", items: [item(1, 100000, 100)] }]
    expect(quoteTotalUpper(groups)).toBe("人民币壹拾万元整")
    groups[0].items[0] = item(1, 100000, 90)
    expect(quoteTotalUpper(groups)).toBe("人民币玖万元整")
  })

  it("空报价 → 人民币零元整（导出仍写出该单元格，不留空位）", () => {
    expect(quoteTotalUpper([])).toBe("人民币零元整")
  })
})

// ---------------------------------------------------------------------------
// 3) 出口接线
// ---------------------------------------------------------------------------

const quoteFixture = {
  id: "q1",
  rh_user_id: "u",
  quote_name: "测试报价",
  ref_name: "",
  version: "",
  tax_note: "",
  groups: [
    {
      id: "g1",
      name: "软件",
      items: [
        { id: "i1", item_name: "HIS", spec: "", unit: "套", qty: 1.5, price: 12345.67, discount: 100 },
        { id: "i2", item_name: "LIS", spec: "", unit: "套", qty: 2, price: 8000, discount: 90 },
      ],
    },
    { id: "g2", name: "空组", items: [] },
  ],
} as never

/** 最小 zip 读取：只处理 store/deflate 两种 entry，够 SheetJS / docx 产物形态 */
function zipEntries(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>()
  const eocdSig = 0x06054b50
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === eocdSig) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error("not a zip")
  const total = buf.readUInt16LE(eocd + 10)
  let ptr = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error("bad central dir")
    const method = buf.readUInt16LE(ptr + 10)
    const compSize = buf.readUInt32LE(ptr + 20)
    const nameLen = buf.readUInt16LE(ptr + 28)
    const extraLen = buf.readUInt16LE(ptr + 30)
    const commentLen = buf.readUInt16LE(ptr + 32)
    const localOff = buf.readUInt32LE(ptr + 42)
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf-8")
    const lNameLen = buf.readUInt16LE(localOff + 26)
    const lExtraLen = buf.readUInt16LE(localOff + 28)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    const data = buf.subarray(dataStart, dataStart + compSize)
    out.set(name, (method === 8 ? zlib.inflateRawSync(data) : data).toString("utf-8"))
    ptr += 46 + nameLen + extraLen + commentLen
  }
  return out
}

const resetCaptures = () => {
  cap.wb = undefined
  cap.blob = undefined
}

describe("报价单出口带大写", () => {
  it("Excel：总计行下一行真实写出「总计（大写）」与大写串", async () => {
    resetCaptures()
    await exportQuoteXlsx(quoteFixture)
    const ws = (writeFileCapture.wb as { Sheets: Record<string, Record<string, { v?: unknown }>> }).Sheets["报价清单"]
    // 行锚点与 quoteExcelNumFmt.test 同一布局：表头行3、行项 4-5、组小计 6、空组 7、总计 8、大写 9
    expect(ws["H8"].v).toBe(32918.51)
    expect(ws["D9"].v).toBe("总计（大写）")
    expect(ws["E9"].v).toBe("人民币叁万贰仟玖佰壹拾捌元伍角壹分")
  })

  it("Word：真实 .docx 产物拆包后 document.xml 里确有该行大写", async () => {
    resetCaptures()
    await exportQuoteDocx(quoteFixture)
    const blob = cap.blob as Blob
    expect(blob).toBeTruthy()
    const buf = Buffer.from(await blob.arrayBuffer())
    const xml = zipEntries(buf).get("word/document.xml") ?? ""
    expect(xml).toContain("合计金额（大写）：")
    expect(xml).toContain("人民币叁万贰仟玖佰壹拾捌元伍角壹分")
    expect(xml).toContain("小写：¥32,918.51")
  })

  it("编辑器：总计卡显示大写（quoteTotalUpper 单源，非新增第二套口径）", () => {
    const src = read("components/ppt-quote/QuoteEditor.tsx")
    expect(src).toContain("quoteTotalUpper(quote.groups ?? [])")
  })

  it("金额链路只有一条：小计/组小计/总计都走 productCents，旧浮点舍入写法已移除", () => {
    const src = read("pages/PptQuote/pptQuoteTypes.ts")
    expect(src).toContain("productCents([")
    expect(src).not.toMatch(/Math\.round\(\(it\.qty \|\| 0\)[^]*?\* 100\) \/ 100/)
    expect(src).not.toContain("const raw = (it.qty || 0) * (it.price || 0)")
  })
})

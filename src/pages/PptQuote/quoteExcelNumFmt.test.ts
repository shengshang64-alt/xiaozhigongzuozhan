// R289 r281-excel-money-column-no-numfmt：报价 Excel 的金额列（单价/小计/组小计/总计）
// 此前只写裸数值，同一份报价单在 Word/界面是「8,799.99」、在 Excel 显示 8799.99。
// 根因比表象深一层：CE 版 xlsx 写侧不支持任何单元格样式（cell.s 被静默忽略、
// 产物无 numFmt），故换用 xlsx-js-style（Apache-2.0，CE 0.18.5 功能超集）。
// 本测试三层锁定：1) moneyNumFmtCell 纯函数形态；2) 端到端——就地截获 exportQuoteXlsx
// 传给 XLSX.writeFile 的 workbook，序列化 buffer 用 Node zlib 解 OOXML zip，验证
// styles.xml 收录 #,##0.00（内置 ID4）、金额单元格 s 索引生效且 <f> 公式保留
// （R281 口径不因换库漂移）；3) 源码接线与依赖声明。
import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { fileURLToPath } from "node:url"
const writeFileCapture = vi.hoisted(() => ({ wb: undefined as unknown }))
// xlsx-js-style 是 CJS 包：vitest 命名空间只有 default/module.exports，utils 等
// 靠 interop 层解析。mock 工厂在 default 形态（无则原名空间）上仅替换 writeFile
// 截获 workbook，write/utils 等原能力全部保留
vi.mock("xlsx-js-style", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>
  const base = ((mod.default ?? mod) as Record<string, unknown>) ?? {}
  return { ...base, writeFile: (wb: unknown) => (writeFileCapture.wb = wb) }
})

import * as XLSX from "xlsx-js-style"
import { exportQuoteXlsx, MONEY_XLSX_NUM_FMT, moneyNumFmtCell } from "./quoteExports"

// 本文件位于 src/pages/PptQuote/，../.. 才到 src 根（与 quoteDiscount.test.ts 同范式）
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const ROOT = path.resolve(SRC, "..")
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf-8")

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

describe("moneyNumFmtCell", () => {
  it("数值单元格带千分位两位小数格式（与 formatMoney 同口径）", () => {
    const cell = moneyNumFmtCell(8799.99)
    expect(cell.t).toBe("n")
    expect(cell.v).toBe(8799.99)
    expect(cell.s).toEqual({ numFmt: "#,##0.00" })
    expect(MONEY_XLSX_NUM_FMT).toBe("#,##0.00")
  })

  it("传公式时 f 与 v 并存（缓存值保真，打开文件不闪空值）", () => {
    const cell = moneyNumFmtCell(18518.51, "ROUND(E4*G4*100/100,2)")
    expect(cell.f).toBe("ROUND(E4*G4*100/100,2)")
    expect(cell.v).toBe(18518.51)
  })

  it("不传公式时不写 f 键（避免空公式污染）", () => {
    expect("f" in moneyNumFmtCell(0)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 端到端：真实序列化产物验 XML（不 mock 库，防「测试绿了但文件没变」）
// ---------------------------------------------------------------------------

/** 最小 zip 读取：只处理 store/deflate 两种 entry，够 SheetJS 产物形态 */
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

describe("exportQuoteXlsx 端到端产物", () => {
  it("真实调用：金额单元格的 numFmt/公式经库序列化真实落进 xlsx 文件", async () => {
    await exportQuoteXlsx(quoteFixture)
    const captured = writeFileCapture.wb as XLSX.WorkBook
    expect(captured).toBeTruthy()
    const ws = captured.Sheets["报价清单"] as XLSX.WorkSheet
    expect(ws).toBeTruthy()
    // 布局锚点（meta 为空不占行）：表头行3；行项 G4/H4、G5/H5（ROUND 公式）；
    // 组小计 H6（SUM）、空组兜底 H7（0 值同带格式）；总计 H8（H6+H7）
    const moneyRefs = ["G4", "G5", "H4", "H5", "H6", "H7", "H8"]
    for (const ref of moneyRefs) {
      const cell = ws[ref] as XLSX.CellObject
      expect(cell, `${ref} 应为金额单元格`).toBeTruthy()
      expect(cell.t).toBe("n")
      expect(cell.s?.numFmt, `${ref} 缺 numFmt`).toBe(MONEY_XLSX_NUM_FMT)
    }
    expect(ws["H4"].f).toBe("ROUND(E4*G4*100/100,2)")
    expect(ws["H5"].f).toBe("ROUND(E5*G5*90/100,2)")
    expect(ws["H6"].f).toBe("SUM(H4:H5)")
    expect(ws["H8"].f).toBe("H6+H7")
    expect(ws["H4"].v).toBe(18518.51) // 1.5 × 12345.67 舍入到分（缓存值保真）

    // 再走一层真实序列化：截获的 workbook 直接 write 成 buffer 解 zip 验 XML（mock 只覆盖了 writeFile）
    const out = XLSX.write(captured, { bookType: "xlsx", type: "buffer" }) as Buffer
    const files = zipEntries(out)
    const styles = files.get("xl/styles.xml") ?? ""
    const sheet = files.get("xl/worksheets/sheet1.xml") ?? ""
    // xlsx-js-style 把 "#,##0.00" 归一到 OOXML 内置 ID4：不新增 numFmts 表也成立
    expect(styles).toContain('numFmtId="4"')
    expect(sheet).toContain("<f>ROUND(E4*G4*100/100,2)</f>")
    const moneyCells = [...sheet.matchAll(/<c r="[GH][4-8]"([^>]*)>/g)]
    expect(moneyCells.length).toBeGreaterThanOrEqual(7)
    for (const m of moneyCells) {
      const sAttr = /s="(\d+)"/.exec(m[1])
      expect(sAttr, `单元格 ${m[0]} 无样式索引`).not.toBeNull()
      expect(sAttr![1], `单元格 ${m[0]} 落在默认样式 0`).not.toBe("0")
    }
  })
})

// ---------------------------------------------------------------------------
// 接线与依赖：源码扫描防漂移
// ---------------------------------------------------------------------------

describe("换库接线不漂移（源码扫描）", () => {
  const exportsSrc = read("pages/PptQuote/quoteExports.ts")

  it("quoteExports 走 xlsx-js-style，不再从 CE xlsx 导入（CE 写侧无样式能力）", () => {
    expect(exportsSrc).toContain('import * as XLSX from "xlsx-js-style"')
    expect(exportsSrc).not.toContain('from "xlsx"')
  })

  it("四个金额写点全部走 moneyNumFmtCell 单一口径", () => {
    expect(exportsSrc).toContain("put(r, 6, moneyNumFmtCell(Number(row[6]) || 0))")
    expect(exportsSrc).toContain("put(r, 7, moneyNumFmtCell(itemSubtotal(it), quoteItemSubtotalFormula(r + 1, it)))")
    expect(exportsSrc).toContain("moneyNumFmtCell(groupSubtotal(g), `SUM(H${start + 1}:H${r})`)")
    expect(exportsSrc).toContain("moneyNumFmtCell(0)")
  })

  it("package.json 已声明 xlsx-js-style 依赖（防只改 import 漏装包）", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>
    }
    expect(pkg.dependencies?.["xlsx-js-style"]).toBeTruthy()
  })
})

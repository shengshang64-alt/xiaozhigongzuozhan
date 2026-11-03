import * as XLSX from "xlsx-js-style"
import { AlignmentType, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx"
import { DOCX_DEFAULT_STYLES } from "@/lib/exportFont"
import {
  formatMoney,
  groupSubtotal,
  itemSubtotal,
  normalizeDiscount,
  quoteTotal,
  quoteTotalUpper,
  type QuoteItem,
  type QuoteRecord,
} from "./pptQuoteTypes"
import { targetsLabel } from "@/pages/SolutionStudio/checklistTypes"
import { triggerBlobDownload } from "@/lib/download"
import { buildSafeFileName } from "@/lib/fileName"
import { formatDateTime } from "@/lib/dateDisplay"
import { localDateStamp } from "@/lib/dateStamp"

// ---------------------------------------------------------------------------
// 报价导出：Excel + Word，与建设清单 exportChecklistXlsx 同构 10 列。
//   表头：类别 | 产品/系统 | 模块 | 来源 | 数量 | 单位 | 单价(元) | 小计(元) | 评级关联 | 备注
//   折扣不进列（包含在小计），旧行无 product_id 时降级取 item_name / spec。
// ---------------------------------------------------------------------------

/** 报价行→导出行（10 列）：与 ChecklistLine 口径对齐 */
export function quoteRowCells(it: QuoteItem, category: string): (string | number)[] {
  const productName = it.product_name ?? it.item_name ?? ""
  const moduleName = it.module_name || it.module_func || it.spec || ""
  const sourceLabel = it.source === "external" ? "外购" : it.source === "company" ? "我公司" : "手工"
  const ratingLabel = targetsLabel(it.rating_hits ?? [])
  const remark = it.remark ?? it.spec ?? ""
  return [
    it.category?.trim() || category,
    productName,
    moduleName,
    sourceLabel,
    Number(it.qty) || 0,
    it.unit || "套",
    Number(it.price) || 0,
    itemSubtotal(it),
    ratingLabel,
    remark,
  ]
}

export const QUOTE_EXPORT_HEADERS = [
  "类别",
  "产品/系统",
  "模块",
  "来源",
  "数量",
  "单位",
  "单价(元)",
  "小计(元)",
  "评级关联",
  "备注",
] as const

function safeFileName(name: string, ext: string): string {
  return buildSafeFileName(name, ext, "报价单")
}

// R289 r281-excel-money-column-no-numfmt：金额列的 Excel 数字格式。
// 界面/Word 版一贯是 formatMoney 的「8,799.99」（zh-CN 千分位 + 固定两位），
// 而 CE 版 xlsx 写侧根本不支持样式（cell.s 被静默忽略、产物无 numFmt），同一份
// 报价单在 Excel 里显示 8799.99——两套观感。现改用 xlsx-js-style（Apache-2.0，
// CE 0.18.5 的功能超集），金额单元格统一走 moneyNumFmtCell 带上本格式。
// "#,##0.00" 恰好是 OOXML 内置格式 ID 4，无需自定义 numFmts 表。
export const MONEY_XLSX_NUM_FMT = "#,##0.00"

/** 金额数值单元格：值 + 可选活公式 + 千分位两位小数显示格式（与 formatMoney 同口径） */
export function moneyNumFmtCell(v: number, f?: string): XLSX.CellObject {
  const cell: XLSX.CellObject = { t: "n", v, s: { numFmt: MONEY_XLSX_NUM_FMT } }
  if (f) cell.f = f
  return cell
}

/**
 * 小计列的 Excel 活公式（R281）：必须与 itemSubtotal 的「四舍五入到分」口径完全一致。
 * 为什么包 ROUND：客户在 Excel 里改数量/单价会触发整表重算，若公式不舍入，
 * 半个人月（qty=1.5）× 带分单价就会算出 18,518.505 这类第三位小数，
 * 小计、组小计、总计全部与界面和 Word 版对不上——报价单是给客户的交付物，
 * 两套数字属于废标/被质疑级风险。SUM 与总计公式只汇总已舍入的单元格，无需再包。
 * 列锚点：E=数量 G=单价 H=小计（见 QUOTE_EXPORT_HEADERS）。
 */
export function quoteItemSubtotalFormula(excelRow: number, it: QuoteItem): string {
  const discount = normalizeDiscount(it.discount)
  return `ROUND(E${excelRow}*G${excelRow}*${discount}/100,2)`
}

export async function exportQuoteXlsx(quote: QuoteRecord): Promise<void> {
  const groups = quote.groups ?? []
  if (!groups.length) throw new Error("报价内容为空，无法导出")
  const wb = XLSX.utils.book_new()
  const ws: XLSX.WorkSheet = {}
  const put = (r: number, c: number, cell: XLSX.CellObject) => {
    ws[XLSX.utils.encode_cell({ r, c })] = cell
  }
  const str = (r: number, c: number, v: string, bold = false) =>
    put(r, c, bold ? { t: "s", v, s: { font: { bold: true } } } : { t: "s", v })

  let r = 0
  str(r, 0, quote.quote_name || "报价单", true)
  r += 1
  const meta = [quote.ref_name ? `关联项目：${quote.ref_name}` : "", quote.version ? `版本：${quote.version}` : ""]
    .filter(Boolean)
    .join("　　")
  if (meta) {
    str(r, 0, meta)
    r += 1
  }
  r += 1

  const headers = QUOTE_EXPORT_HEADERS as unknown as string[]
  headers.forEach((h, c) => put(r, c, { t: "s", v: h, s: { font: { bold: true } } }))
  r += 1

  const subtotalRows: number[] = []
  groups.forEach((g) => {
    const start = r
    const items = g.items ?? []
    items.forEach((it) => {
      const row = quoteRowCells(it, g.name)
      // 0-3 文本；4/6/7 数字；5/8/9 文本
      str(r, 0, String(row[0] ?? ""))
      str(r, 1, String(row[1] ?? ""))
      str(r, 2, String(row[2] ?? ""))
      str(r, 3, String(row[3] ?? ""))
      put(r, 4, { t: "n", v: Number(row[4]) || 0 })
      str(r, 5, String(row[5] ?? ""))
      put(r, 6, moneyNumFmtCell(Number(row[6]) || 0))
      put(r, 7, moneyNumFmtCell(itemSubtotal(it), quoteItemSubtotalFormula(r + 1, it)))
      str(r, 8, String(row[8] ?? ""))
      str(r, 9, String(row[9] ?? ""))
      r += 1
    })
    str(r, 3, `${g.name}小计`, true)
    if (items.length) {
      put(r, 7, moneyNumFmtCell(groupSubtotal(g), `SUM(H${start + 1}:H${r})`))
    } else {
      put(r, 7, moneyNumFmtCell(0))
    }
    subtotalRows.push(r)
    r += 1
  })

  str(r, 3, "总计", true)
  put(
    r,
    7,
    moneyNumFmtCell(
      quoteTotal(groups),
      subtotalRows.length ? subtotalRows.map((x) => `H${x + 1}`).join("+") : "0",
    ),
  )
  r += 1
  // R34：合计大写紧跟总计，值由 quoteTotal 单源派生（杜绝手填大写与小写重算后不一致）
  str(r, 3, "总计（大写）", true)
  str(r, 4, quoteTotalUpper(groups))
  r += 1
  if (quote.tax_note?.trim()) {
    str(r, 0, `税率与含税说明：${quote.tax_note.trim()}`)
    r += 1
  }
  str(r, 0, `导出时间：${formatDateTime(new Date())}`)
  r += 1

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r - 1, c: 9 } })
  ws["!cols"] = [
    { wch: 12 },
    { wch: 22 },
    { wch: 22 },
    { wch: 8 },
    { wch: 6 },
    { wch: 6 },
    { wch: 12 },
    { wch: 14 },
    { wch: 18 },
    { wch: 24 },
  ]
  XLSX.utils.book_append_sheet(wb, ws, "报价清单")
  XLSX.writeFile(wb, safeFileName(`${quote.quote_name}${quote.version ? `-${quote.version}` : ""}`, "xlsx"))
}

// ---------------------------------------------------------------------------
// Word 报价单
// ---------------------------------------------------------------------------

function cellText(text: string, opts: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; fill?: string } = {}): TableCell {
  return new TableCell({
    shading: opts.fill ? { fill: opts.fill } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [
      new Paragraph({
        alignment: opts.align ?? AlignmentType.LEFT,
        children: [new TextRun({ text, bold: opts.bold ?? false, size: 18 })],
      }),
    ],
  })
}

export async function exportQuoteDocx(quote: QuoteRecord): Promise<void> {
  const groups = quote.groups ?? []
  if (!groups.length) throw new Error("报价内容为空，无法导出")
  const HEADER_FILL = "EEF3F8"
  const headerCells = QUOTE_EXPORT_HEADERS as unknown as string[]
  const rows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: headerCells.map((h) =>
        cellText(h, { bold: true, align: AlignmentType.CENTER, fill: HEADER_FILL }),
      ),
    }),
  ]
  groups.forEach((g) => {
    rows.push(
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 10,
            shading: { fill: "F7F9FB" },
            margins: { top: 60, bottom: 60, left: 80, right: 80 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: `【${g.name}】`, bold: true, size: 19, color: "1F3864" })],
              }),
            ],
          }),
        ],
      }),
    )
    const items = g.items ?? []
    if (!items.length) {
      rows.push(
        new TableRow({
          children: [
            new TableCell({
              columnSpan: 10,
              margins: { top: 40, bottom: 40, left: 80, right: 80 },
              children: [new Paragraph({ children: [new TextRun({ text: "（本组暂无行项）", size: 18, color: "999999" })] })],
            }),
          ],
        }),
      )
    }
    items.forEach((it) => {
      const cells = quoteRowCells(it, g.name)
      rows.push(
        new TableRow({
          children: [
            cellText(String(cells[0] ?? "")),
            cellText(String(cells[1] ?? "")),
            cellText(String(cells[2] ?? "")),
            cellText(String(cells[3] ?? ""), { align: AlignmentType.CENTER }),
            cellText(String(cells[4] ?? ""), { align: AlignmentType.CENTER }),
            cellText(String(cells[5] ?? ""), { align: AlignmentType.CENTER }),
            cellText(formatMoney(Number(cells[6]) || 0), { align: AlignmentType.RIGHT }),
            cellText(formatMoney(itemSubtotal(it)), { align: AlignmentType.RIGHT }),
            cellText(String(cells[8] ?? "")),
            cellText(String(cells[9] ?? "")),
          ],
        }),
      )
    })
    rows.push(
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 7,
            margins: { top: 50, bottom: 50, left: 80, right: 80 },
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: `${g.name}小计`, bold: true, size: 18 })],
              }),
            ],
          }),
          cellText(formatMoney(groupSubtotal(g)), { bold: true, align: AlignmentType.RIGHT, fill: HEADER_FILL }),
          new TableCell({
            columnSpan: 2,
            margins: { top: 50, bottom: 50, left: 80, right: 80 },
            children: [new Paragraph({ children: [new TextRun({ text: "", size: 18 })] })],
          }),
        ],
      }),
    )
  })
  rows.push(
    new TableRow({
      children: [
        new TableCell({
          columnSpan: 7,
          margins: { top: 70, bottom: 70, left: 80, right: 80 },
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: "总计", bold: true, size: 20 })],
            }),
          ],
        }),
        cellText(formatMoney(quoteTotal(groups)), { bold: true, align: AlignmentType.RIGHT, fill: HEADER_FILL }),
        new TableCell({
          columnSpan: 2,
          margins: { top: 70, bottom: 70, left: 80, right: 80 },
          children: [new Paragraph({ children: [new TextRun({ text: "", size: 20 })] })],
        }),
      ],
    }),
  )

  const children: Paragraph[] = []
  const titleBits = [quote.quote_name || "报价单"]
  if (quote.version) titleBits.push(quote.version)
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: titleBits.join(" · "), bold: true, size: 34 })],
    }),
  )
  const meta = [
    quote.ref_name ? `关联项目：${quote.ref_name}` : "",
    `导出日期：${localDateStamp()}`,
  ]
    .filter(Boolean)
    .join("　　")
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 260 },
      children: [new TextRun({ text: meta, size: 20, color: "666666" })],
    }),
  )
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  })
  const finalDoc = new Document({
    styles: DOCX_DEFAULT_STYLES,
    sections: [
      {
        children: [...children, table, totalInWordsParagraph(quote), ...tailParagraphs(quote)],
      },
    ],
  })
  const blob = await Packer.toBlob(finalDoc)
  triggerBlobDownload(blob, safeFileName(`${quote.quote_name}${quote.version ? `-${quote.version}` : ""}`, "docx"))
}

/**
 * R34：表下的「合计金额（大写）」行。报价单/开标一览表的硬性组成项，
 * 且必须由 quoteTotal 单源派生——手填大写在改数量后不会跟着重算，
 * 大小写不一致是被质疑/废标级的经典失分点。
 */
function totalInWordsParagraph(quote: QuoteRecord): Paragraph {
  const groups = quote.groups ?? []
  return new Paragraph({
    spacing: { before: 160, after: 120 },
    children: [
      new TextRun({ text: "合计金额（大写）：", bold: true, size: 22 }),
      new TextRun({ text: quoteTotalUpper(groups), bold: true, size: 22 }),
      new TextRun({
        text: "　（小写：¥" + formatMoney(quoteTotal(groups)) + "）",
        size: 20,
        color: "444444",
      }),
    ],
  })
}

function tailParagraphs(quote: QuoteRecord): Paragraph[] {
  const out: Paragraph[] = []
  out.push(
    new Paragraph({
      spacing: { before: 240, after: 80 },
      children: [new TextRun({ text: "税率与含税说明", bold: true, size: 22 })],
    }),
  )
  out.push(
    new Paragraph({
      spacing: { after: 240 },
      children: [new TextRun({ text: quote.tax_note?.trim() || "（未填写）", size: 20, color: "444444" })],
    }),
  )
  out.push(
    new Paragraph({
      spacing: { before: 320 },
      children: [new TextRun({ text: "报价方（盖章）：＿＿＿＿＿＿＿＿＿＿　　　　客户确认（盖章）：＿＿＿＿＿＿＿＿＿＿", size: 20 })],
    }),
  )
  out.push(
    new Paragraph({
      spacing: { before: 200 },
      children: [new TextRun({ text: "日期：＿＿＿＿年＿＿月＿＿日　　　　　　　　日期：＿＿＿＿年＿＿月＿＿日", size: 20 })],
    }),
  )
  return out
}

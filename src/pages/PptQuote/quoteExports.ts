import * as XLSX from "xlsx"
import { AlignmentType, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx"
import { formatMoney, groupSubtotal, itemSubtotal, quoteTotal, type QuoteRecord } from "./pptQuoteTypes"

// ---------------------------------------------------------------------------
// 报价导出：Excel（分组小计/总计带公式）+ Word 报价单
// ---------------------------------------------------------------------------

function safeFileName(name: string, ext: string): string {
  const base = (name || "报价单").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60)
  return `${base}.${ext}`
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

  const headers = ["分组", "序号", "名称", "规格说明", "单位", "数量", "单价(元)", "折扣(%)", "小计(元)"]
  headers.forEach((h, c) => put(r, c, { t: "s", v: h, s: { font: { bold: true } } }))
  r += 1

  const subtotalRows: number[] = []
  groups.forEach((g) => {
    const start = r
    const items = g.items ?? []
    items.forEach((it, idx) => {
      str(r, 0, idx === 0 ? g.name : "")
      put(r, 1, { t: "n", v: idx + 1 })
      str(r, 2, it.item_name || "")
      str(r, 3, it.spec || "")
      str(r, 4, it.unit || "")
      put(r, 5, { t: "n", v: it.qty || 0 })
      put(r, 6, { t: "n", v: it.price || 0 })
      put(r, 7, { t: "n", v: it.discount == null ? 100 : it.discount })
      put(r, 8, { t: "n", v: itemSubtotal(it), f: `F${r + 1}*G${r + 1}*H${r + 1}/100` })
      r += 1
    })
    str(r, 2, `${g.name}小计`, true)
    if (items.length) {
      put(r, 8, { t: "n", v: groupSubtotal(g), f: `SUM(I${start + 1}:I${r})` })
    } else {
      put(r, 8, { t: "n", v: 0 })
    }
    subtotalRows.push(r)
    r += 1
  })

  str(r, 2, "总计", true)
  put(r, 8, {
    t: "n",
    v: quoteTotal(groups),
    f: subtotalRows.length ? subtotalRows.map((x) => `I${x + 1}`).join("+") : "0",
  })
  r += 1
  if (quote.tax_note?.trim()) {
    str(r, 0, `税率与含税说明：${quote.tax_note.trim()}`)
    r += 1
  }
  str(r, 0, `导出时间：${new Date().toLocaleString("zh-CN")}`)
  r += 1

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r - 1, c: 8 } })
  ws["!cols"] = [
    { wch: 12 },
    { wch: 6 },
    { wch: 26 },
    { wch: 38 },
    { wch: 8 },
    { wch: 8 },
    { wch: 12 },
    { wch: 10 },
    { wch: 14 },
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
  const headerCells = ["序号", "名称", "规格说明", "单位", "数量", "单价(元)", "折扣(%)", "小计(元)"]
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
            columnSpan: 8,
            shading: { fill: "F7F9FB" },
            margins: { top: 60, bottom: 60, left: 80, right: 80 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: g.name, bold: true, size: 19, color: "1F3864" })],
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
              columnSpan: 8,
              margins: { top: 40, bottom: 40, left: 80, right: 80 },
              children: [new Paragraph({ children: [new TextRun({ text: "（本组暂无行项）", size: 18, color: "999999" })] })],
            }),
          ],
        }),
      )
    }
    items.forEach((it, idx) => {
      rows.push(
        new TableRow({
          children: [
            cellText(String(idx + 1), { align: AlignmentType.CENTER }),
            cellText(it.item_name || ""),
            cellText(it.spec || ""),
            cellText(it.unit || "", { align: AlignmentType.CENTER }),
            cellText(String(it.qty || 0), { align: AlignmentType.CENTER }),
            cellText(formatMoney(it.price || 0), { align: AlignmentType.RIGHT }),
            cellText(String(it.discount == null ? 100 : it.discount), { align: AlignmentType.CENTER }),
            cellText(formatMoney(itemSubtotal(it)), { align: AlignmentType.RIGHT }),
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
    `导出日期：${new Date().toLocaleDateString("zh-CN")}`,
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
    sections: [
      {
        children: [...children, table, ...tailParagraphs(quote)],
      },
    ],
  })
  const blob = await Packer.toBlob(finalDoc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = safeFileName(`${quote.quote_name}${quote.version ? `-${quote.version}` : ""}`, "docx")
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
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

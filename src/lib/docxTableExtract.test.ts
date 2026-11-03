// B4 内核单测：docx 表格还原（纯解析，无 DOM/网络）
// 一半用手写 OOXML 片段测边界（合并单元格/多段落/实体），一半用 docx 库真实打一份 .docx 走完整 zip+XML 链路。
import { describe, expect, it } from "vitest"
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx"
import { extractDocxTables, mapHeaderColumns, parseDocxTablesXml } from "./docxTableExtract"

const wrap = (inner: string) => `<?xml version="1.0"?><w:document><w:body>${inner}</w:body></w:document>`

describe("parseDocxTablesXml：OOXML 表格还原", () => {
  it("① 基本行列 + 单元格多段落 + XML 实体", () => {
    const xml = wrap(`
      <w:tbl>
        <w:tr>
          <w:tc><w:p><w:r><w:t>序号</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>子系统名称</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>备&amp;注</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>患者主索引</w:t></w:r></w:p><w:p><w:r><w:t>含主数据管理</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>经营要素平台</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>`)
    const [t] = parseDocxTablesXml(xml)
    expect(t.rows).toEqual([
      ["序号", "子系统名称", "备&注"],
      ["1", "患者主索引 含主数据管理", "经营要素平台"],
    ])
  })

  it("② gridSpan 横向合并展开为空格，vMerge 续行留空", () => {
    const xml = wrap(`
      <w:tbl>
        <w:tr>
          <w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>合并表头</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>第三列</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>跨行首格</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>C2</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p><w:r><w:t>不该出现</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>B3</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>C3</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>`)
    const [t] = parseDocxTablesXml(xml)
    expect(t.rows[0]).toEqual(["合并表头", "", "第三列"])
    expect(t.rows[1]).toEqual(["跨行首格", "B2", "C2"])
    expect(t.rows[2]).toEqual(["", "B3", "C3"])
  })

  it("③ 多张表按出现顺序编号；空表不产出", () => {
    const xml = wrap(`
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:tbl></w:tbl>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`)
    const tables = parseDocxTablesXml(xml)
    expect(tables.map((t) => t.rows[0][0])).toEqual(["A1", "B1"])
    expect(tables.map((t) => t.index)).toEqual([0, 1])
  })
})

describe("extractDocxTables：真实 .docx 走 zip+XML 全链路", () => {
  it("④ docx 库打包的表格能被原样读回（3 行 × 4 列）", async () => {
    const cell = (text: string) => new TableCell({ children: [new Paragraph({ children: [new TextRun(text)] })] })
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun("前言行，不是表")] }),
            new Table({
              rows: [
                new TableRow({ children: ["序号", "名称", "数量", "单位"].map(cell) }),
                new TableRow({ children: ["1", "患者主索引", "1", "套"].map(cell) }),
                new TableRow({ children: ["2", "输血管理信息系统", "1", "套"].map(cell) }),
              ],
            }),
          ],
        },
      ],
    })
    const buf = await Packer.toBuffer(doc)
    const tables = extractDocxTables(new Uint8Array(buf))
    expect(tables).toHaveLength(1)
    expect(tables[0].rows).toEqual([
      ["序号", "名称", "数量", "单位"],
      ["1", "患者主索引", "1", "套"],
      ["2", "输血管理信息系统", "1", "套"],
    ])
  })

  it("⑤ 非 docx 字节不抛异常，返回空数组", () => {
    expect(extractDocxTables(new Uint8Array([1, 2, 3]))).toEqual([])
  })
})

describe("mapHeaderColumns：表头列名归一", () => {
  it("⑥ 认得 序号/名称/规格型号/数量/单位/备注 及其同义叫法", () => {
    const cols = mapHeaderColumns(["序 |", "子系统名称", "技术参数", "数量", "计量单位", "备注"])
    expect(cols).toEqual({ no: 0, name: 1, spec: 2, qty: 3, unit: 4, note: 5 })
  })

  it("⑦ 只认出「名称」时返回 null（不硬当清单表）", () => {
    expect(mapHeaderColumns(["名称", "随便一列"])).toBeNull()
  })
})

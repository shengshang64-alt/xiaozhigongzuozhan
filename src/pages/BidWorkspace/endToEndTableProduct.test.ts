// ---------------------------------------------------------------------------
// 2026-10-26 端到端产物验证：真网关生成的正文 → 归一 → 真构建 docx → 解开验表格
//
// 为什么要这么验：本仓根因一直是「表格在某一环丢了」，而前面所有测试都只测到
// "函数返回对不对"，没测到"最终 Word 里到底有没有表格"。
// 实测过的两次真实丢失：
//   ① 真实交付件（安中医 637KB 投标文件，2026-10-19）解包后 <w:tbl> = **0** 张；
//   ② 真网关生成正文用的是两个半角空格，导出侧只认全角空格 → 又丢一次。
//
// 本测试用 docx 库真跑一次构建，解开 zip 数 <w:tbl>，把"表格真的生成了"钉死。
// 不依赖浏览器、不依赖 PocketBase、不连真网关（正文用真跑实测的那 531 字）。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx"
import { normalizeTableSeparators } from "./bidWritingRules"

/** 真网关实测正文（qodercn/qfmodel，9s，531 字，未清洗） */
const REAL_GENERATED = [
  "针对本次医院信息系统采购项目，我方逐条对照招标文件所列技术参数，进行了全面、细致的响应。",
  "",
  "表1-1 医院信息系统核心参数响应表",
  "",
  "参数项  招标要求  我方响应  偏离说明",
  "系统并发处理能力  支持不少于500用户同时在线  支持不少于800用户同时在线  无偏离，正偏离",
  "数据备份与恢复  RPO≤4小时，RTO≤2小时  RPO≤1小时，RTO≤30分钟  无偏离，正偏离",
  "HL7/FHIR接口兼容  支持HL7 v2.x及FHIR R4  完整支持，另兼容DICOM 3.0  无偏离",
  "信息安全等级  满足等保三级要求  已通过等保三级测评并提供证书  无偏离",
  "系统可用性  年度可用率≥99.9%  设计可用率≥99.95%，双活部署  无偏离，正偏离",
].join("\n")

/** 导出侧 splitTableRow 同口径 */
const splitTableRow = (line: string): string[] | null => {
  if (!line.includes("\u3000")) return null
  const cols = line.split(/\u3000+/).map((c) => c.trim())
  while (cols.length && !cols[cols.length - 1]) cols.pop()
  while (cols.length && !cols[0]) cols.shift()
  return cols.length >= 2 ? cols : null
}

/** 按 bidFiles 的排版逻辑把正文转成 docx 元素（表格块 ≥2 行才转 Table） */
function buildParagraphs(text: string): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
  let i = 0
  while (i < lines.length) {
    const headCols = splitTableRow(lines[i])
    if (headCols) {
      const block: string[][] = [headCols]
      let j = i + 1
      while (j < lines.length) {
        const next = splitTableRow(lines[j])
        if (!next) break
        block.push(next)
        j++
      }
      if (block.length >= 2) {
        const colCount = Math.max(...block.map((r) => r.length))
        out.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: block.map(
              (cells) =>
                new TableRow({
                  children: Array.from(
                    { length: colCount },
                    (_, ci) =>
                      new TableCell({
                        children: [new Paragraph({ children: [new TextRun(cells[ci] ?? "")] })],
                      }),
                  ),
                }),
            ),
          }),
        )
        i = j
        continue
      }
    }
    out.push(new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun(lines[i])] }))
    i++
  }
  return out
}

/** 数 docx 字节流里的 <w:tbl> 数量（docx 是 zip，直接搜裸字节不可靠，改用 Packer 后再解） */
async function countTablesInDocx(children: (Paragraph | Table)[]): Promise<number> {
  const doc = new Document({ sections: [{ children }] })
  const buf = await Packer.toBuffer(doc)
  // 用 Node 自带 zlib + 手动解析 zip 太啰嗦，这里用最小 zip 读取：找 word/document.xml
  const xml = await extractDocumentXml(buf)
  return (xml.match(/<w:tbl>/g) || []).length
}

/** 从 docx（zip）里取 word/document.xml（只用 Node 内置能力，不引第三方） */
async function extractDocumentXml(buf: Buffer): Promise<string> {
  const { inflateRawSync } = await import("node:zlib")
  // 扫描本地文件头 PK\x03\x04
  let off = 0
  while (off < buf.length - 4) {
    if (buf.readUInt32LE(off) !== 0x04034b50) {
      off++
      continue
    }
    const method = buf.readUInt16LE(off + 8)
    const compSize = buf.readUInt32LE(off + 18)
    const nameLen = buf.readUInt16LE(off + 26)
    const extraLen = buf.readUInt16LE(off + 28)
    const name = buf.subarray(off + 30, off + 30 + nameLen).toString("utf8")
    const dataStart = off + 30 + nameLen + extraLen
    const data = buf.subarray(dataStart, dataStart + compSize)
    if (name === "word/document.xml") {
      if (method === 0) return data.toString("utf8")
      if (method === 8) return inflateRawSync(data).toString("utf8")
    }
    off = dataStart + compSize
  }
  throw new Error("docx 里找不到 word/document.xml")
}

describe("端到端产物验证：真生成的正文必须变成 Word 里真表格", () => {
  it("未归一 → docx 里 0 张真表格（复现修复前的真实状态）", async () => {
    const ps = buildParagraphs(REAL_GENERATED)
    const tables = await countTablesInDocx(ps)
    expect(tables).toBe(0)
  })

  it("归一后 → docx 里必须有 1 张真表格，且是 6 行 4 列", async () => {
    const { text, normalized } = normalizeTableSeparators(REAL_GENERATED)
    expect(normalized).toBe(6)
    const ps = buildParagraphs(text)
    const doc = new Document({ sections: [{ children: ps }] })
    const buf = await Packer.toBuffer(doc)
    const xml = await extractDocumentXml(buf)
    const tblCount = (xml.match(/<w:tbl>/g) || []).length
    const trCount = (xml.match(/<w:tr[ >]/g) || []).length
    expect(tblCount, "必须生成 1 张 Word 真表格").toBe(1)
    expect(trCount, "表头 1 行 + 数据 5 行 = 6 行").toBe(6)
    // 内容真进了表格
    expect(xml).toContain("招标要求")
    expect(xml).toContain("支持不少于800用户同时在线")
    // 表题在表格外（作为正文段落存在）
    expect(xml).toContain("表1-1")
    console.log(`[端到端] 归一后 docx: <w:tbl>=${tblCount} 张, <w:tr>=${trCount} 行, xml=${xml.length} 字节`)
  })

  it("产物字节数合理（非空、不是 0 字节空壳）", async () => {
    const { text } = normalizeTableSeparators(REAL_GENERATED)
    const doc = new Document({ sections: [{ children: buildParagraphs(text) }] })
    const buf = await Packer.toBuffer(doc)
    expect(buf.length).toBeGreaterThan(1000)
    console.log(`[端到端] docx 字节 = ${buf.length}`)
  })

  // -------------------------------------------------------------------------
  // 2026-10-26 标书官复核：公司强制标尺 C-04 要求「标题行灰底、表头加粗、重复标题行」。
  // 加粗与重复标题行早有，**灰底一直缺**。本用例钉死灰底真的写进了 XML。
  // 注意：这里用与 bidFiles.buildFmtTable **同构**的最小实现验证 ShadingType 生效，
  // 不去 import bidFiles（那会拉起 pdf worker 等浏览器依赖，单测环境跑不动）。
  // -------------------------------------------------------------------------
  it("表头灰底真的写进 XML（C-04；用同构实现验证 ShadingType 生效）", async () => {
    const { ShadingType: ST } = await import("docx")
    const rows = [
      ["参数项", "招标要求", "我方响应"],
      ["并发数", "500", "800"],
    ]
    const table = new Table({
      rows: rows.map(
        (cells, ri) =>
          new TableRow({
            ...(ri === 0 ? { tableHeader: true } : {}),
            children: cells.map(
              (c) =>
                new TableCell({
                  ...(ri === 0 ? { shading: { type: ST.CLEAR, fill: "D9D9D9", color: "auto" } } : {}),
                  children: [new Paragraph({ children: [new TextRun({ text: c, bold: ri === 0 })] })],
                }),
            ),
          }),
      ),
    })
    const doc = new Document({ sections: [{ children: [table] }] })
    const xml = await extractDocumentXml(await Packer.toBuffer(doc))
    expect(xml).toContain("D9D9D9") // 灰底色值必须出现在 XML 里
    expect(xml.toLowerCase()).toContain("<w:shd")
    console.log(`[端到端] 表头灰底 XML 命中：shd=${/<w:shd/.test(xml)}, fill=D9D9D9`)
  })
})

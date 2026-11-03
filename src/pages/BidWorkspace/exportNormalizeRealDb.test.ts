// ---------------------------------------------------------------------------
// 2026-10-26（标书官 P0-A/P0-B）：导出侧归一下沉的产物级回归
//
// 背景：标书官指出我上一版把归一**只接在生成侧**（useBidWorkspace.applyAutoRepair），
// 而导出要面对三种绕过它的输入，实测他解了 5 份历史导出件，全是 0 张 w:tbl：
//   ① 637KB 那份有 157 根裸露 `|`（markdown 表格语法被当文字写进标书）
//   ② 「天坛」那份 211 行连续半角空格、0 个全角空格
//   ③ 金标准 143MB 那份 w:tbl=130 张、全角空格=0 → 说明「全角空格模拟表格」只是中间态，
//      真正的验收判据是 **w:tbl ≥ 1**，不是"导出侧能认出表格行"
//
// 本测试锁两件事：
//   A. sanitizeChapterText（导出侧唯一收口）现在会做两道归一 —— 存量正文也能出表
//   B. 判据是解开 docx 数 <w:tbl>（产物口径），不是复刻 splitTableRow（自欺口径）
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx"
import { inflateRawSync } from "node:zlib"
import { sanitizeChapterText } from "./bidTypes"

/** 导出侧 splitTableRow 同口径（仅用于把归一结果排成 docx 表格） */
const splitTableRow = (line: string): string[] | null => {
  if (!line.includes("\u3000")) return null
  const cols = line.split(/\u3000+/).map((c) => c.trim())
  while (cols.length && !cols[cols.length - 1]) cols.pop()
  while (cols.length && !cols[0]) cols.shift()
  return cols.length >= 2 ? cols : null
}

/** 按 bidFiles 排版逻辑把正文转 docx 元素 */
function buildChildren(text: string): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
  let i = 0
  while (i < lines.length) {
    const head = splitTableRow(lines[i])
    if (head) {
      const block: string[][] = [head]
      let j = i + 1
      while (j < lines.length) {
        const n = splitTableRow(lines[j])
        if (!n) break
        block.push(n)
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
                    (_, ci) => new TableCell({ children: [new Paragraph({ children: [new TextRun(cells[ci] ?? "")] })] }),
                  ),
                }),
            ),
          }),
        )
        i = j
        continue
      }
    }
    out.push(new Paragraph({ children: [new TextRun(lines[i])] }))
    i++
  }
  return out
}

/** 解开 docx（zip）取 word/document.xml */
async function documentXml(buf: Buffer): Promise<string> {
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
    const ds = off + 30 + nameLen + extraLen
    const data = buf.subarray(ds, ds + compSize)
    if (name === "word/document.xml") {
      return method === 0 ? data.toString("utf8") : inflateRawSync(data).toString("utf8")
    }
    off = ds + compSize
  }
  throw new Error("docx 里没有 word/document.xml")
}

/** 产物的真表格数（唯一可信判据） */
async function countRealTables(text: string): Promise<number> {
  const doc = new Document({ sections: [{ children: buildChildren(text) }] })
  const xml = await documentXml(await Packer.toBuffer(doc))
  return (xml.match(/<w:tbl>/g) || []).length
}

describe("导出侧归一下沉（标书官 P0-A）：存量正文重新导出必须能出真表格", () => {
  it("存量 markdown 竖线表：sanitizeChapterText 后 w:tbl ≥ 1（修复前是 0）", async () => {
    // 这是真实历史稿的形态（637KB 那份有 157 根裸露 |）
    const stock = [
      "针对本项目技术参数，我方逐条响应如下：",
      "| 序号 | 招标参数 | 响应值 | 偏离 |",
      "|---|---|---|---|",
      "| 1 | 并发用户数 | 800 | 正偏离 |",
      "| 2 | 响应时间 | 2 秒 | 无偏离 |",
    ].join("\n")

    // 修复前：原文直接导出
    expect(await countRealTables(stock), "未归一时应为 0 张表（复现修复前）").toBe(0)

    // 修复后：走导出侧收口
    const cleaned = sanitizeChapterText(stock)
    expect(await countRealTables(cleaned), "sanitizeChapterText 后必须出表").toBeGreaterThanOrEqual(1)
  })

  it("存量半角空格分列表：sanitizeChapterText 后 w:tbl ≥ 1（天坛那份 211 行的形态）", async () => {
    const stock = [
      "下表列出参数响应：",
      "序号  招标参数  响应值  偏离",
      "1  并发用户数  800  正偏离",
      "2  响应时间  2 秒  无偏离",
    ].join("\n")

    expect(await countRealTables(stock), "未归一时应为 0 张表").toBe(0)
    const cleaned = sanitizeChapterText(stock)
    expect(await countRealTables(cleaned), "sanitizeChapterText 后必须出表").toBeGreaterThanOrEqual(1)
  })

  it("护栏仍然生效：条目式正文经 sanitizeChapterText 后不能变成表格", async () => {
    const listLike = [
      "（1）支持门诊挂号  退号  换号功能",
      "（2）支持按科室  医生  午别检索",
      "（3）支持医保结算  自费结算  混合结算",
    ].join("\n")
    const cleaned = sanitizeChapterText(listLike)
    expect(await countRealTables(cleaned), "条目式正文被误折成表格了").toBe(0)
    // 内容不能丢
    expect(cleaned).toContain("（1）支持门诊挂号")
    expect(cleaned).toContain("（3）支持医保结算")
  })

  it("无表格的普通正文经 sanitizeChapterText 后仍是 0 张表（不无中生有）", async () => {
    const plain = "本方案采用微服务架构，按业务域拆分服务边界。系统支持横向扩展，单节点可承载 500 并发。"
    const cleaned = sanitizeChapterText(plain)
    expect(await countRealTables(cleaned)).toBe(0)
    expect(cleaned).toContain("微服务架构")
  })

  it("产物字节数合理（不是空壳）", async () => {
    const stock = "标题\n| a | b |\n|---|---|\n| 1 | 2 |"
    const cleaned = sanitizeChapterText(stock)
    const doc = new Document({ sections: [{ children: buildChildren(cleaned) }] })
    const buf = await Packer.toBuffer(doc)
    expect(buf.length).toBeGreaterThan(500)
  })
})

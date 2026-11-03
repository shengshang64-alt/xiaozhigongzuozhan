// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { zipSync, strToU8 } from "fflate"
import {
  extractDocxTextFromXml,
  DOCX_XML_SIZE_THRESHOLD,
  pickRicherDocxText,
  DOCX_RICHER_MIN_RATIO,
  DOCX_RICHER_MIN_CHARS,
} from "./bidFiles"

/**
 * REQ-057（2026-10-18）：大文件 docx 文本提取（只读 word/document.xml，不解压图片）的针对性单测。
 *
 * 为什么必须单独测：`extractDocxTextFromXml` 是新增的 ~270 行函数，
 * 292 个既有用例全绿只能证明「没打破别的」，**不能证明新函数行为正确**。
 * 这里用合成 docx（几 KB）锁住三条核心行为 + 一条降级行为：
 *   ① 表格行 → 「A | B | C」（与 tableRowsToLines 同口径）
 *   ② 竖排字 → 单元格内 ≤2 字的多个 w:p 合并（招标评分表常见形态）
 *   ③ pageTag → 前缀 〔P?〕
 *   ④ 空/异常 XML 不崩，返回空串
 *
 * 合成而非真实文件：几 KB vs 143MB，跑得快、可读、失败时能一眼看出断言意图。
 */

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"'

/** 把一段 word/document.xml 正文包成合法 docx（zip），返回 ArrayBuffer */
function makeDocx(bodyXml: string): ArrayBuffer {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${bodyXml}</w:body></w:document>`
  const zipped = zipSync({ "word/document.xml": strToU8(xml) }, { level: 0 })
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
}

/** w:p 的简写：一段纯文本 */
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
/** w:tc 的简写：单元格内若干段落 */
const tc = (...paras: string[]) => `<w:tc>${paras.map(p).join("")}</w:tc>`
/** w:tr 的简写：一行若干单元格 */
const tr = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`

describe("REQ-057 extractDocxTextFromXml：表格行", () => {
  it("w:tbl 转成「A | B | C」竖线行（与 tableRowsToLines 同口径）", async () => {
    const xml = `<w:tbl>${tr(tc("序号"), tc("招标参数"), tc("响应值"))}${tr(tc("1"), tc("并发用户数 ≥500"), tc("满足"))}</w:tbl>`
    const text = await extractDocxTextFromXml(makeDocx(xml))
    expect(text).toContain("序号 | 招标参数 | 响应值")
    expect(text).toContain("1 | 并发用户数 ≥500 | 满足")
  })

  it("表格前后的正文段落各自独立成行，且表格后保留分块空行", async () => {
    const xml = p("评分办法如下表：") + `<w:tbl>${tr(tc("评分项"), tc("分值"))}</w:tbl>` + p("上表为全部评分项。")
    const text = await extractDocxTextFromXml(makeDocx(xml))
    const lines = text.split("\n")
    expect(lines).toContain("评分办法如下表：")
    expect(lines).toContain("评分项 | 分值")
    expect(lines).toContain("上表为全部评分项。")
    // 表格后有空行（分块边界）
    const idx = lines.indexOf("评分项 | 分值")
    expect(lines[idx + 1]).toBe("")
  })

  it("纵向合并（vMerge）按 rowspan 向上填充名称列，不让名称凭空消失", async () => {
    // 第 1 行「T3 功能方案」纵向合并跨 2 行；第 2 行只有 2 个 w:tc
    const vmStart = `<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>${p("T3 功能方案")}</w:tc>`
    const vmCont = `<w:tc><w:tcPr><w:vMerge/></w:tcPr>${p("")}</w:tc>`
    const xml = `<w:tbl>${tr(vmStart, tc("3 分"), tc("说明一"))}${tr(vmCont, tc("3 分"), tc("说明二"))}</w:tbl>`
    const text = await extractDocxTextFromXml(makeDocx(xml))
    // 两个数据行都必须带上名称（旧缺陷是第 2 行只剩「3 分 | 说明二」）
    expect(text).toContain("T3 功能方案 | 3 分 | 说明一")
    expect(text).toContain("T3 功能方案 | 3 分 | 说明二")
  })
})

describe("REQ-057 extractDocxTextFromXml：竖排字合并", () => {
  it("单元格内 ≤2 字的多个段落合并成一行（「投」「标」「价」→「投标价」）", async () => {
    // 竖排字在 docx 里是「一个字一个 w:p」，mammoth 渲染成 <br> 分隔的碎片
    const vertical = `<w:tc>${p("投")}${p("标")}${p("价")}</w:tc>`
    const xml = `<w:tbl>${tr(vertical, tc("40 分"))}</w:tbl>`
    const text = await extractDocxTextFromXml(makeDocx(xml))
    expect(text).toContain("投标价 | 40 分")
    // 反证：不许输出成「投 | 标 | 价」或带换行的碎片
    expect(text).not.toContain("投 | 标")
  })

  it("长文本单元格不触发竖排合并（保持原样，不被误合）", async () => {
    const longCell = `<w:tc>${p("支持门急诊挂号")}${p("支持住院收费")}</w:tc>`
    const xml = `<w:tbl>${tr(longCell, tc("20 分"))}</w:tbl>`
    const text = await extractDocxTextFromXml(makeDocx(xml))
    // 非竖排：多段是该单元格的完整内容，非竖排时被 cellText 折叠成一行（空格连接）
    expect(text).toContain("支持门急诊挂号 支持住院收费")
  })
})

describe("REQ-057 extractDocxTextFromXml：页码锚点与降级", () => {
  it("opts.pageTag=true 时输出前缀 〔P?〕", async () => {
    const text = await extractDocxTextFromXml(makeDocx(p("第一章 项目概述")), { pageTag: true })
    expect(text.startsWith("〔P?〕 ")).toBe(true)
    expect(text).toContain("第一章 项目概述")
  })

  it("opts.pageTag 缺省时不加前缀", async () => {
    const text = await extractDocxTextFromXml(makeDocx(p("第一章 项目概述")))
    expect(text.startsWith("〔P?〕")).toBe(false)
    expect(text).toBe("第一章 项目概述")
  })

  it("空 body 返回空串，不崩", async () => {
    const text = await extractDocxTextFromXml(makeDocx(""))
    expect(text).toBe("")
  })

  it("pageTag=true 但内容为空时，不输出孤立的前缀", async () => {
    const text = await extractDocxTextFromXml(makeDocx(""), { pageTag: true })
    expect(text).toBe("")
  })

  it("缺 word/document.xml 时抛出可读错误（不是静默返回空）", async () => {
    const zipped = zipSync({ "word/other.xml": strToU8("<x/>") }, { level: 0 })
    const ab = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
    await expect(extractDocxTextFromXml(ab)).rejects.toThrow(/word\/document\.xml/)
  })

  it("文本框（mc:AlternateContent）只取 Choice 分支，不重复输出两遍", async () => {
    // 旧缺陷：Choice 与 Fallback 两份等价内容都取 → 「正本正本」
    const txbx = `<w:p><w:r><mc:AlternateContent>
      <mc:Choice Requires="wps"><w:drawing><w:txbxContent>${p("正本")}</w:txbxContent></w:drawing></mc:Choice>
      <mc:Fallback><w:pict><w:txbxContent>${p("正本")}</w:txbxContent></w:pict></mc:Fallback>
    </mc:AlternateContent></w:r></w:p>`
    const text = await extractDocxTextFromXml(makeDocx(txbx))
    expect(text).toContain("正本")
    expect(text).not.toContain("正本正本")
  })
})

describe("REQ-057 分流阈值常量", () => {
  it("阈值为 20MB（低于此值走旧路径 mammoth，避免改动既有行为）", () => {
    expect(DOCX_XML_SIZE_THRESHOLD).toBe(20 * 1024 * 1024)
  })
})

/**
 * 2026-10-24（P1-3）：走查报告称「docx 解析丢字约 21%」。实测证伪了一半，另一半做成安全网。
 *
 * **实测**（`_eval/R142_tender_sanming.docx`，142KB 真实招标文件）：
 * `document.xml` 里全部 `<w:t>` 文本非空白字符合计 **58,412**，与 mammoth 输出**完全相等**——
 * mammoth 并不丢正文；我们的 XML 路多出 684 字（+1.17%），那是 vMerge 合并格向上填充的重复文本。
 * 另外 3 份仓内 docx 同样吻合（1446/1464、20299/20305、137436/137436）。
 * 所以这个包装器**不是主路径**，只是安全网：只有 XML 路显著更全（≥300 字且 ≥3%）才替换，
 * 避免把表格更好读的 mammoth 结果换成重复文本更多的 XML 结果。
 * 这里脱离 File/DOMParser 直测「怎么选」这条判定；两条路径各自的抽取效果由上面几组用例覆盖。
 */
describe("P1-3 pickRicherDocxText：docx 双路径取舍（安全网，默认仍用 mammoth）", () => {
  it("XML 路显著更全时才替换（≥300 字且 ≥3%）", () => {
    const mammoth = "招标文件第三章采购需求"
    const xml = mammoth + "参数".repeat(200) // +400 字
    expect(pickRicherDocxText(xml, mammoth)).toBe(xml)
  })

  it("只多一点点（<300 字）不替换——避免用重复填充文本换掉表格排版", () => {
    // 真实招标文件实测就是这种情况：+684 字 / +1.17%（vMerge 向上填充），仍用 mammoth
    const mammoth = "a".repeat(58412)
    const xml = mammoth + "b".repeat(684)
    expect(pickRicherDocxText(xml, mammoth)).toBe(mammoth)
  })

  it("多绝对字数够但比例不足（大文件里多 400 字只占 0.3%）也不替换", () => {
    const mammoth = "a".repeat(200000)
    const xml = mammoth + "b".repeat(400)
    expect(pickRicherDocxText(xml, mammoth)).toBe(mammoth)
  })

  it("一条路径彻底失败（空串/纯空白）时用另一条，不做比较", () => {
    expect(pickRicherDocxText("", "mammoth 结果")).toBe("mammoth 结果")
    expect(pickRicherDocxText("   \n ", "只有空白")).toBe("只有空白")
    expect(pickRicherDocxText("XML 结果", "")).toBe("XML 结果")
    expect(pickRicherDocxText("XML 结果", "\n\t")).toBe("XML 结果")
  })

  it("两条都空时返回空串（不抛错）", () => {
    expect(pickRicherDocxText("", "")).toBe("")
  })

  it("阈值常量就是上面几组用例的依据（≥300 字且 ≥3%）", () => {
    expect(DOCX_RICHER_MIN_CHARS).toBe(300)
    expect(DOCX_RICHER_MIN_RATIO).toBe(1.03)
  })
})

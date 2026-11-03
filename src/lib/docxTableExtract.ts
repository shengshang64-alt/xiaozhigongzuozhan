// ---------------------------------------------------------------------------
// B4（2026-10-22，用户裁定「先 docx」）：从 .docx 里还原表格结构
//
// 为什么必须有这一层：招标文件的「功能清单 / 技术参数」在原文里是表格，现有链路是
// `extractTenderFileText` 把 docx/PDF 摊平成纯文本存进 tender_text——表格的行列关系就此丢失，
// 解析出来只能是一行行「名称：X｜数量：Y」，还原不出「序号|名称|规格|数量|单位|备注」。
// 实测安中医的 PDF 更极端：第一列「经营要素平台」是竖排字，抽成文本后变成「经」「营」「要」…
// 散在每一行开头，任何文本层启发式都救不回来。
//
// 本模块只做**纯解析**：字节 → 表格数组。不碰 DOM、不碰网络、不碰 React，可在 node 下单测。
//   · docx 本质是 ZIP + OOXML，`word/document.xml` 里的 `<w:tbl>/<w:tr>/<w:tc>` 就是表格结构；
//   · 合并单元格：`<w:gridSpan w:val="N"/>` 横向占 N 列（本实现展开为 N 个格，值留在第一格），
//     `<w:vMerge w:val="restart"/>` 起始、`<w:vMerge/>` 续行（续行格留空）；
//   · 单元格文本：`<w:tc>` 内所有 `<w:t>` 按段落 `<w:p>` 拼接，段间用空格（不是换行，便于回填单行）。
//
// 已知边界（刻意不做，别在别处假设它做了）：
//   · 不解析嵌套表格（招投标正文里几乎不出现；真出现时内层表会被并进外层格文本）；
//   · 不解析 `.doc`（旧二进制格式）与 PDF；PDF 走第二期坐标聚类。
// ---------------------------------------------------------------------------

import { strFromU8, unzipSync } from "fflate"

export type DocxTable = {
  /** 行 × 列；已按 gridSpan 展开（被合并的列补空串，保持矩形） */
  rows: string[][]
  /** 该表在 document.xml 中的出现序号（从 0 起），用于稳定定位 */
  index: number
}

/** XML 实体解码（表格里常见 &amp; &lt; 以及全角空格） */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
}

/** 取 `<w:tc>...</w:tc>` 里的纯文本：按段落切，段内 w:t 直接相连，段间补空格 */
function cellText(tcXml: string): string {
  const paras = tcXml.split(/<\/w:p>/)
  const out: string[] = []
  for (const p of paras) {
    const runs: string[] = []
    const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(p))) runs.push(decodeEntities(m[1]))
    const t = runs.join("").trim()
    if (t) out.push(t)
  }
  return out.join(" ").trim()
}

/** 横向合并列数 */
function gridSpanOf(tcXml: string): number {
  const m = tcXml.match(/<w:gridSpan[^>]*w:val="(\d+)"/)
  const n = m ? Number(m[1]) : 1
  return Number.isFinite(n) && n > 0 ? n : 1
}

/** 纵向合并：restart = 起始格（保留值）；无 val 的 <w:vMerge/> = 续行（值留空） */
function isVMergeContinuation(tcXml: string): boolean {
  const m = tcXml.match(/<w:vMerge(?:\s[^>]*)?\/?>/)
  if (!m) return false
  return /w:vMerge\s*\/>/.test(m[0]) || !/w:val="restart"/.test(m[0])
}

/**
 * 从 document.xml 文本解析全部表格（纯字符串处理，node 可测）。
 */
export function parseDocxTablesXml(xml: string): DocxTable[] {
  const tables: DocxTable[] = []
  const open = /<w:tbl(?:\s[^>]*)?>/g
  let m: RegExpExecArray | null
  let idx = 0
  while ((m = open.exec(xml))) {
    const start = m.index + m[0].length
    // 深度扫描找配对的 </w:tbl>（处理嵌套，内层整体计入本表切片）
    let depth = 1
    let cursor = start
    const tagRe = /<w:tbl(?:\s[^>]*)?>|<\/w:tbl>/g
    tagRe.lastIndex = start
    let t: RegExpExecArray | null
    let end = -1
    while ((t = tagRe.exec(xml))) {
      depth += t[0].startsWith("</") ? -1 : 1
      if (depth === 0) {
        end = t.index
        break
      }
      cursor = t.index
    }
    if (end < 0) break
    const body = xml.slice(start, end)
    open.lastIndex = end

    const rows: string[][] = []
    const rowRe = /<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g
    let r: RegExpExecArray | null
    while ((r = rowRe.exec(body))) {
      const cells: string[] = []
      const cellRe = /<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g
      let c: RegExpExecArray | null
      while ((c = cellRe.exec(r[1]))) {
        const span = gridSpanOf(c[0])
        const text = isVMergeContinuation(c[0]) ? "" : cellText(c[1])
        cells.push(text)
        for (let i = 1; i < span; i++) cells.push("")
      }
      if (cells.length) rows.push(cells)
    }
    if (rows.length) {
      const width = Math.max(...rows.map((x) => x.length))
      tables.push({ rows: rows.map((x) => [...x, ...Array(width - x.length).fill("")]), index: idx })
      idx += 1
    }
    void cursor
  }
  return tables
}

/** 从 .docx 字节里取全部表格 */
export function extractDocxTables(bytes: Uint8Array): DocxTable[] {
  // 不是 zip（.doc/.pdf/纯文本被误传进来）时返回空表，由调用方回退文本抽取——不抛异常打断上传流程
  let files: ReturnType<typeof unzipSync>
  try {
    files = unzipSync(bytes)
  } catch {
    return []
  }
  const xml = files["word/document.xml"]
  if (!xml) return []
  return parseDocxTablesXml(strFromU8(xml))
}

/**
 * 表头识别：返回「列名 → 列下标」。命中词按同义词归一，便于不同招标文件的叫法差异。
 * 找不到表头（少于 2 个已知列名）返回 null——调用方应按普通文本处理，不要硬当成清单表。
 */
const HEADER_ALIASES: Record<string, RegExp> = {
  no: /^(序号|编号|项号|序)$/,
  name: /^(名称|子系统名称|系统名称|货物名称|项目名称|品目|服务名称)$/,
  spec: /^(规格型号|规格|型号|技术参数|参数|技术要求|规格及参数|功能需求|主要参数)$/,
  qty: /^(数量|数目|数)$/,
  unit: /^(单位|计量单位)$/,
  note: /^(备注|说明|所属平台|所属系统|备注说明)$/,
}

export function mapHeaderColumns(headerRow: string[]): Record<string, number> | null {
  const out: Record<string, number> = {}
  headerRow.forEach((cell, i) => {
    const t = (cell ?? "").replace(/[\s|｜:：]+/g, "")
    if (!t) return
    for (const [key, re] of Object.entries(HEADER_ALIASES)) {
      if (out[key] === undefined && re.test(t)) out[key] = i
    }
  })
  // 至少要认出「名称」+ 一个别的列，才认为这是一张清单表
  return out.name !== undefined && Object.keys(out).length >= 2 ? out : null
}

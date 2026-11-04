// Markdown 表格兜底解析（渲染侧）。
// 背景：本仓 react-markdown 未装 remark-gfm，GFM 表格（| a | b | + |---|---|）不会被解析，
// 在问答回答里会原样显示成 `|---|` 文本。这里在渲染前把块级表格切出来，交给 KbMarkdown 用 <table> 渲染。
// 口径：只识别块级表格（表头行 + 分隔行 + 后续连续行），单元格只做纯文本与 `\|` 转义还原，不解析行内 Markdown。

export type MarkdownTableAlign = "left" | "center" | "right"

export type MarkdownTable = {
  header: string[]
  /** 每列对齐方式，取自分隔行 `|:--|:-:|--:|`，缺省按 left 渲染 */
  align: MarkdownTableAlign[]
  rows: string[][]
}

export type MarkdownBlock =
  | { kind: "markdown"; text: string }
  | { kind: "table"; table: MarkdownTable }

const DELIM_CELL = /^:?-+:?$/

/** 按未转义的竖线切分一行，并去掉行首行尾的表格竖线（`\|` 保留为字面竖线） */
function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith("|")) s = s.slice(1)
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ""
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|"
      i += 1
      continue
    }
    if (ch === "|") {
      cells.push(cur.trim())
      cur = ""
      continue
    }
    cur += ch
  }
  cells.push(cur.trim())
  return cells
}

/** 分隔行 `|---|:--:|` → 每列对齐方式；不是分隔行返回 null */
function parseAlignRow(line: string): MarkdownTableAlign[] | null {
  if (!line.includes("|")) return null
  const cells = splitRow(line)
  if (cells.length === 0) return null
  const align: MarkdownTableAlign[] = []
  for (const cell of cells) {
    if (!DELIM_CELL.test(cell)) return null
    const left = cell.startsWith(":")
    const right = cell.endsWith(":")
    align.push(left && right ? "center" : right ? "right" : "left")
  }
  return align
}

/** 表格数据行：非空、含竖线，且不是标题 / 引用 / 代码围栏 / 列表项的起头 */
function isTableRow(line: string): boolean {
  const s = line.trim()
  if (!s || !s.includes("|")) return false
  return !/^(#{1,6}\s|>|```|[-*+]\s|\d+[.)]\s)/.test(s)
}

/** 把一行的单元格数对齐到表头列数：多则截断，少则补空（GFM 同款容错） */
function fitRow(cells: string[], width: number): string[] {
  const out = cells.slice(0, width)
  while (out.length < width) out.push("")
  return out
}

/**
 * 把 Markdown 文本切成「连续文本块 / 表格块」序列。
 * 没有表格时返回单个 markdown 块，调用方据此保持原渲染路径不变。
 */
export function splitMarkdownTables(content: string): MarkdownBlock[] {
  const lines = (content ?? "").split(/\r?\n/)
  const blocks: MarkdownBlock[] = []
  let buffer: string[] = []

  const flush = () => {
    if (buffer.some((line) => line.trim())) blocks.push({ kind: "markdown", text: buffer.join("\n") })
    buffer = []
  }

  for (let i = 0; i < lines.length; i += 1) {
    const headerLine = lines[i]
    const align = i + 1 < lines.length ? parseAlignRow(lines[i + 1]) : null
    if (align && headerLine.includes("|")) {
      const header = splitRow(headerLine)
      const rows: string[][] = []
      let j = i + 2
      while (j < lines.length && isTableRow(lines[j])) {
        rows.push(fitRow(splitRow(lines[j]), header.length))
        j += 1
      }
      flush()
      blocks.push({ kind: "table", table: { header, align, rows } })
      i = j - 1
      continue
    }
    buffer.push(headerLine)
  }
  flush()
  return blocks
}

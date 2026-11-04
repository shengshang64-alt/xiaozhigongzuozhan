import { describe, expect, it } from "vitest"
import { splitMarkdownTables } from "@/lib/markdownTables"

describe("splitMarkdownTables", () => {
  it("把 GFM 表格切成 table 块，前后文本保留为 markdown 块", () => {
    const md = "结论如下：\n\n| 项 | 说明 |\n| --- | --- |\n| A | 甲 |\n| B | 乙 |\n\n结尾。"
    const blocks = splitMarkdownTables(md)
    expect(blocks.map((b) => b.kind)).toEqual(["markdown", "table", "markdown"])
    expect(blocks[1]).toEqual({
      kind: "table",
      table: {
        header: ["项", "说明"],
        align: ["left", "left"],
        rows: [
          ["A", "甲"],
          ["B", "乙"],
        ],
      },
    })
    const rest = blocks
      .filter((b): b is Extract<typeof b, { kind: "markdown" }> => b.kind === "markdown")
      .map((b) => b.text)
      .join("")
    expect(rest).toContain("结论如下")
    expect(rest).toContain("结尾。")
  })

  it("没有表格时原样返回单个 markdown 块", () => {
    const md = "第一段\n\n第二段"
    expect(splitMarkdownTables(md)).toEqual([{ kind: "markdown", text: md }])
  })

  it("识别对齐标记", () => {
    const blocks = splitMarkdownTables("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |")
    expect(blocks[0]).toEqual({
      kind: "table",
      table: {
        header: ["a", "b", "c"],
        align: ["left", "center", "right"],
        rows: [["1", "2", "3"]],
      },
    })
  })

  it("转义竖线 \\| 不当作列分隔", () => {
    const blocks = splitMarkdownTables("| a | b |\n| --- | --- |\n| x \\| y | z |")
    const table = blocks[0].kind === "table" ? blocks[0].table : null
    expect(table?.rows[0]).toEqual(["x | y", "z"])
  })

  it("单元格数不齐时按表头列数截断或补空", () => {
    const blocks = splitMarkdownTables("| a | b |\n| --- | --- |\n| 1 |\n| 1 | 2 | 3 |")
    const table = blocks[0].kind === "table" ? blocks[0].table : null
    expect(table?.rows).toEqual([
      ["1", ""],
      ["1", "2"],
    ])
  })

  it("缺分隔行时不当作表格（避免把普通含竖线文本吃掉）", () => {
    const md = "| a | b |\n| c | d |"
    expect(splitMarkdownTables(md)).toEqual([{ kind: "markdown", text: md }])
  })
})

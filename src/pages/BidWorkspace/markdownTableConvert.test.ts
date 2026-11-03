// ---------------------------------------------------------------------------
// 2026-10-26：Markdown 竖线表格 → 全角空格纯文本表格行（兜底转换）
//
// 为什么要有：全局风格规则曾要求「关键章必须用 markdown 表格」，而导出真源
// bidFiles.splitTableRow **只认全角空格**（行内不含 U+3000 就直接返回 null）。
// 模型照全局规则写出 markdown 表格时，导出会整张表退化成一堆带 | 的普通文字段落。
//
// 本测试锁三件事：
//   ① 标准 markdown 表格转换后，导出侧（splitTableRow 同口径）能识别成表格；
//   ② 分隔行被丢弃、单元格内容一字不改；
//   ③ 不误伤：单行竖线、代码围栏内的表格、普通正文都不动。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import { convertMarkdownTables } from "./bidWritingRules"

/** 导出侧 splitTableRow 同口径：含全角空格且折出 ≥2 非空列 */
const isExportTableRow = (line: string): boolean => {
  if (!line.includes("\u3000")) return false
  return line.split(/\u3000+/).filter((c) => c.trim() !== "").length >= 2
}

describe("convertMarkdownTables：markdown 表格转全角空格表格行", () => {
  it("标准表格转换后，每一行都能被导出侧识别成表格行（这是本次修复的判据）", () => {
    const md = ["| 序号 | 名称 | 备注 |", "|---|---|---|", "| 1 | 系统A | 无 |", "| 2 | 系统B | 无 |"].join("\n")
    const { text, converted } = convertMarkdownTables(md)
    expect(converted).toBe(1)
    const lines = text.split("\n")
    // 分隔行被丢弃，剩 3 行
    expect(lines.length).toBe(3)
    for (const l of lines) expect(isExportTableRow(l), `未转成导出可识别的表格行：${l}`).toBe(true)
    expect(lines[0]).toBe("序号\u3000\u3000名称\u3000\u3000备注")
    expect(lines[1]).toBe("1\u3000\u3000系统A\u3000\u3000无")
  })

  it("单元格内容一字不改（数字/单位/标点全保留）", () => {
    const md = "| 指标 | 数值 |\n|---|---|\n| 响应时间 | ≤3 秒（P95） |"
    const { text } = convertMarkdownTables(md)
    expect(text).toContain("响应时间")
    expect(text).toContain("≤3 秒（P95）")
    expect(text).not.toContain("|")
  })

  it("对齐标记的分隔行（:---:）也丢弃", () => {
    const md = "| a | b |\n|:---|---:|\n| 1 | 2 |"
    const { text } = convertMarkdownTables(md)
    expect(text.split("\n").length).toBe(2)
    expect(text).not.toContain("---")
  })

  it("单行竖线不转（与 bidProseLinter 的 ≥2 行才算表同口径，避免误伤正文引用）", () => {
    const src = "这里引用了 A | B 两种方案"
    const { text, converted } = convertMarkdownTables(src)
    expect(converted).toBe(0)
    expect(text).toBe(src)
  })

  it("代码围栏内的 markdown 表格不动（那是示例代码不是正文表格）", () => {
    const src = "```\n| a | b |\n|---|---|\n| 1 | 2 |\n```"
    const { text, converted } = convertMarkdownTables(src)
    expect(converted).toBe(0)
    expect(text).toBe(src)
  })

  it("多张表格分别计数；纯文本段落原样保留", () => {
    const src = ["第一张表：", "| a | b |", "|---|---|", "| 1 | 2 |", "", "中间一段正文。", "", "第二张表：", "| c | d |", "| 1 | 2 |"].join("\n")
    const { text, converted } = convertMarkdownTables(src)
    expect(converted).toBe(2)
    expect(text).toContain("中间一段正文。")
    expect(text).toContain("第一张表：")
    expect(text).not.toContain("|---|---|")
  })

  it("无竖线的正文完全不动、零开销路径", () => {
    const src = "纯中文正文，没有任何表格。"
    expect(convertMarkdownTables(src)).toEqual({ text: src, converted: 0 })
  })

  it("空输入不抛错", () => {
    expect(convertMarkdownTables("")).toEqual({ text: "", converted: 0 })
  })
})

// REQ-019 表格提取层单测：纵向合并单元格（rowspan）不得让「名称」列塌缩。
//
// 缺陷（验收官在 REQ-015 验收中发现的既有 bug）：
//   docx 评分表用纵向合并单元格时，mammoth 渲染成 <td rowspan="8">，续行在 HTML 里就只剩 2 个 td，
//   于是 `名称 | 分值 | 说明` 塌缩成 `分值 | 说明`，用户看到「3 分 | 投标人提供的医院信息系统…」
//   却不知道是哪一项。实测福安 10/20 = 50% 评分项丢名称；84/96 份文件含 rowspan。
//
// 本文件锁定三件事（都是**真行为断言**，不是源码字符串匹配）：
//  1) 续行必须继承上方合并单元格的文本（就修对了）；
//  2) 行数不减少（不许把「丢名」换成「丢行」）；
//  3) 竖排字合并（cellText 内 ≤2 字逐字换行的合并）行为不变——这是既有能力，改坏即回归。
/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest"
import { tableRowsToLines } from "./bidFiles"

/** 与 bidFiles.extractDocxText 内部 cellText 逐字一致（竖排字合并 + 空白折叠） */
function makeCellText() {
  const decode = (s: string) =>
    s.replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
  return (td: Element): string => {
    const raw = decode(td.textContent ?? "")
    const rows = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean)
    if (rows.length > 1 && rows.every((r) => [...r].length <= 2)) return rows.join("")
    return raw.replace(/\s+/g, " ").trim()
  }
}

function table(html: string): Element {
  const doc = new DOMParser().parseFromString(`<table>${html}</table>`, "text/html")
  return doc.querySelector("table") as Element
}

const cellText = makeCellText()

describe("REQ-019 纵向合并单元格（rowspan）不得丢名称", () => {
  it("续行继承合并格文本：福安形态（T3 跨 8 行，后 7 行原本只剩分值+说明）", () => {
    // 真实形态摘自福安《信息化智能化采购项目招标文件－发售稿.docx》表 #10
    const tb = table(`
      <tr><td>评标项目</td><td>评标分值</td><td>评标方法描述</td></tr>
      <tr><td>T1、技术服务响应程度</td><td>39</td><td>根据各投标人所投设备技术性能…</td></tr>
      <tr><td rowspan="3">T3、信息系统功能方案</td><td>3</td><td>投标人提供的医院信息系统，具有一卡通管理…</td></tr>
      <tr><td>3</td><td>投标人或所投品牌厂家提供的结构化电子病历…</td></tr>
      <tr><td>1</td><td>投标人具有信息安全保障能力的得1分…</td></tr>
      <tr><td>T4、项目实施及培训方案</td><td>3</td><td>根据投标产品的主要件和关键件配置情况…</td></tr>
    `)
    const lines = tableRowsToLines(tb, cellText)
    // 行数不减少：6 个 <tr> → 6 行（表头也算）
    expect(lines.length).toBe(6)
    // 表头原样
    expect(lines[0]).toBe("评标项目 | 评标分值 | 评标方法描述")
    // T3 的三行（首行 + 2 个续行）都必须带名称
    expect(lines[2].startsWith("T3、信息系统功能方案 | 3 |")).toBe(true)
    expect(lines[3].startsWith("T3、信息系统功能方案 | 3 |")).toBe(true)
    expect(lines[4].startsWith("T3、信息系统功能方案 | 1 |")).toBe(true)
    // 每个续行都是 3 列（不再塌缩成 2 列）
    for (const line of lines.slice(2, 5)) expect(line.split(" | ").length).toBe(3)
    // T4 独立成项，不被 T3 串味
    expect(lines[5].startsWith("T4、项目实施及培训方案 | 3 |")).toBe(true)
  })

  it("不许把「丢名」换成「丢行」：每个 <tr> 有内容都产出一行，且行数等于 tr 数", () => {
    const tb = table(`
      <tr><td>评标项目</td><td>评标分值</td><td>评标方法描述</td></tr>
      <tr><td rowspan="4">B1、企业实力</td><td>3</td><td>同时具备 ISO-9001…</td></tr>
      <tr><td>3</td><td>守合同重信用企业…</td></tr>
      <tr><td>3</td><td>企业资信等级 AAA…</td></tr>
      <tr><td>2</td><td>软件企业认定…</td></tr>
      <tr><td>B2、服务能力</td><td>3</td><td>售后服务方案…</td></tr>
    `)
    const lines = tableRowsToLines(tb, cellText)
    expect(lines.length).toBe(6)
    // 补名行不得从 4 行塌成 1 行，也不得被合并成 1 行
    expect(lines.filter((l) => l.startsWith("B1、企业实力 |")).length).toBe(4)
  })

  it("竖排字合并（cellText 内 ≤2 字逐字换行）行为不变——既有能力不得回归", () => {
    // 竖排表头「投 标 价 格 分」逐字换行，应合并成「投标价格分」而不是被拆开
    const tb = table(`
      <tr><td>投\n标\n价\n格\n分</td><td>分值</td><td>说明</td></tr>
      <tr><td>技术</td><td>30</td><td>略</td></tr>
    `)
    const lines = tableRowsToLines(tb, cellText)
    expect(lines[0]).toBe("投标价格分 | 分值 | 说明")
    // 竖排合并 + rowspan 同时存在时，两者都要正确
    const tb2 = table(`
      <tr><td>项\n目</td><td>分值</td></tr>
      <tr><td rowspan="2">甲项</td><td>3</td></tr>
      <tr><td>2</td></tr>
    `)
    const l2 = tableRowsToLines(tb2, cellText)
    expect(l2[0]).toBe("项目 | 分值")
    expect(l2[1]).toBe("甲项 | 3")
    expect(l2[2]).toBe("甲项 | 2")
  })

  it("无 rowspan 的表格逐字走原路径（零行为变化）", () => {
    const tb = table(`
      <tr><td>A</td><td>B</td><td>C</td></tr>
      <tr><td>1</td><td>2</td><td>3</td></tr>
    `)
    expect(tableRowsToLines(tb, cellText)).toEqual(["A | B | C", "1 | 2 | 3"])
  })

  it("横向合并（colspan）不得把同一文本灌进多个列位——否则伪造重复列，反而让正常行对不上", () => {
    // 真实形态摘自 #17《招标文件正文.docx》表头：`评分标准 | 评分因素 | 需提供材料 | 分值`，
    // 「评分因素」在 docx 里是 colspan=2 的合并格。旧实现（一个 td 只输出一格）产出 4 列；
    // 若把同一文本同时填进 2 个占位列，会变成 `评分因素 | 评分因素`，行内容被伪造改写。
    const tb = table(`
      <tr><td>评分标准</td><td colspan="2">评分因素</td><td>分值</td></tr>
      <tr><td rowspan="2">技术分</td><td colspan="2">方案完整性</td><td>3</td></tr>
      <tr><td colspan="2">方案可行性</td><td>2</td></tr>
    `)
    const lines = tableRowsToLines(tb, cellText)
    // 表头：合并格只出现一次，不得重复成两列
    expect(lines[0]).toBe("评分标准 | 评分因素 | 分值")
    // 续行：纵向合并的名称仍要补上（不被横向修复冲掉）
    expect(lines[1]).toBe("技术分 | 方案完整性 | 3")
    expect(lines[2]).toBe("技术分 | 方案可行性 | 2")
    // 任何一行都不许出现相邻完全相同的单元格（重复列的特征）
    for (const l of lines) {
      const cols = l.split(" | ")
      for (let i = 1; i < cols.length; i++) expect(cols[i] === cols[i - 1] && cols[i] !== "").toBe(false)
    }
  })

  it("空行/全空格行仍被跳过（不产出空行）", () => {
    const tb = table(`
      <tr><td>A</td><td>B</td></tr>
      <tr><td></td><td></td></tr>
      <tr><td rowspan="2">X</td><td>1</td></tr>
      <tr><td>2</td></tr>
    `)
    const lines = tableRowsToLines(tb, cellText)
    expect(lines).toEqual(["A | B", "X | 1", "X | 2"])
  })
})

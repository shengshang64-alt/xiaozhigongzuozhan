// PDF 提取行重建单测（2026-09-28 解析审计 Q16 的回归锁）
//
// 背景：extractPdfText 旧实现 join("") 把整页文本粘成一行，导致
//  ① 页码粘进章节名（「15第三章」）② 表格行列全丢
//  ③ extractScoringSectionExcerpt 的标题行规则（≤60字/行首「第X章」）全灭 → 评分章节定位失效。
// rebuildPdfLines 用 pdfjs 文本项的 transform 坐标（e=x, f=y）按几何位置重建行。
// 用例坐标/文本取自真实招标文件（天坛医院安徽医院 466 页 PDF）实测片段。
import { describe, expect, it } from "vitest"
import { rebuildPdfLines } from "./bidFiles"
import { extractScoringSectionExcerpt } from "./prompts/tenderParse"

/** 便捷构造：pdfjs 文本项（transform: [a,b,c,d,e=x,f=y]），w=宽度（列间距判定用） */
function item(str: string, x: number, y: number, w = str.length * 10) {
  return { str, transform: [1, 0, 0, 1, x, y], width: w, height: 10 }
}

describe("rebuildPdfLines · 几何重建行", () => {
  it("页码与章节标题分离（旧实现为「3第一章 招标公告」粘连）", () => {
    const items = [
      item("3", 20, 780), // 页码在页眉（y 最大 = 最顶部），独立成行
      item("第一章 招标公告", 60, 745),
      item("首都医科大学附属北京天坛医院安徽医院", 60, 720),
    ]
    const out = rebuildPdfLines(items as unknown as Array<Record<string, unknown>>)
    const lines = out.split("\n")
    // 页码独立成行、不再粘进章节名；章节行保持阅读顺序
    expect(lines[0]).toBe("3")
    expect(lines[1]).toBe("第一章 招标公告")
    expect(lines[2]).toBe("首都医科大学附属北京天坛医院安徽医院")
  })

  it("同一 y 的多个片段按 x 排序合并；列间距大 → 竖线分隔（表格行）", () => {
    const items = [
      item("系统/模块名称", 120, 500),
      item("序号", 60, 500),
      item("技术与服务要求", 320, 500),
    ]
    const out = rebuildPdfLines(items as unknown as Array<Record<string, unknown>>)
    // 「序号」x=60 宽约 20 → 结束 80；「系统/模块名称」x=120 → gap 40 > 15 → 竖线
    expect(out.split("\n")[0]).toBe("序号 | 系统/模块名称 | 技术与服务要求")
  })

  it("相邻片段列间距小（连续文本）→ 空格拼接不用竖线", () => {
    const items = [
      item("预算金额：", 60, 500, 60),
      item("45239200.00", 126, 500, 66),
      item("元", 196, 500, 10),
    ]
    const out = rebuildPdfLines(items as unknown as Array<Record<string, unknown>>)
    expect(out).toBe("预算金额： 45239200.00 元")
  })

  it("相邻 y（±2.5pt 容差）归为一行；空串项丢弃", () => {
    const items = [
      item("预算金额：45239200.00 元", 60, 500.0),
      item("", 300, 500.8), // 空串应丢弃
      item("(政府采购任务书编号)", 60, 501.8), // 与 500 差 1.8 ≤ 2.5 → 同行
      item("下一行内容", 60, 488), // 差 12 → 换行
    ]
    const out = rebuildPdfLines(items as unknown as Array<Record<string, unknown>>)
    expect(out.split("\n")).toHaveLength(2)
    expect(out.split("\n")[0]).toContain("预算金额")
    expect(out.split("\n")[1]).toBe("下一行内容")
  })

  it("全部为空项时返回空串", () => {
    const items = [item("", 10, 10), item("  ", 20, 20)]
    expect(rebuildPdfLines(items as unknown as Array<Record<string, unknown>>)).toBe("")
  })
})

describe("解析审计端到端：重建行后评分章节可被定位（此前完全失效）", () => {
  // 模拟 PDF 旧提取的产物：整页粘成一行、页码粘章节名 → 评分定位器找不到标题行
  it("旧行结构（超长单行）下评分章节定位失败", () => {
    const oldStyle =
      "45第五章 评标办法及评分规则（D2）一、评分办法本项目采用综合评分法…技术分40分商务分20价格分40…1.技术评分表 序号 评分项 分值 评审标准…"
    // 旧行 = 一整行（无换行）→ 行长 5000 > 60，标题行规则永不命中
    expect(extractScoringSectionExcerpt(oldStyle.slice(0, 120))).toBe("")
  })

  it("新行结构下评分章节命中并完整截取", () => {
    const newStyle = [
      "第一章 招标公告",
      "项目概况：某某医院信息化项目",
      "第五章 评标办法及评分规则（D2）",
      "一、评分办法",
      "本项目采用综合评分法：技术分 40 分，商务分 20 分，价格分 40 分。",
      "1.技术评分表",
      "序号 评分项 分值 评审标准",
      "1 一体化平台架构 5 分 支持集团多院区架构者得 5 分",
    ].join("\n")
    const excerpt = extractScoringSectionExcerpt(newStyle)
    expect(excerpt).toContain("评标办法及评分规则")
    expect(excerpt).toContain("综合评分法")
  })
})

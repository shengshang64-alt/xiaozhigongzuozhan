import { describe, expect, it } from "vitest"
import { locateOriginal } from "./parseOriginalLocator"

const TENDER = [
  "第一章 招标公告",
  "1.1 项目名称：某医院智慧医院建设项目",
  "1.2 采购人：某医院",
  "",
  "第二章 投标人资格要求",
  "2.1 （企业名称），从业人员 1 人，营业收入为 1 万元，资产总额为 5 万元，属于中小企业",
  "2.2 投标人须具备独立法人资格，不接受联合体投标",
  "第三章 评标办法",
  "3.1 技术方案（20 分）：优（15-20 分）、良（10-14 分）、一般（5-9 分）",
].join("\n")

describe("原文定位 · 行号优先", () => {
  it("行号在范围内：直接定位该行并给出上下文窗口", () => {
    const h = locateOriginal(TENDER, { line: 6, context: 1 })
    expect(h.how).toBe("line")
    expect(h.line).toBe(6)
    expect(h.from).toBe(5)
    expect(h.to).toBe(7)
    expect(h.rows.map((r) => r.no)).toEqual([5, 6, 7])
    expect(h.rows.filter((r) => r.hit).map((r) => r.no)).toEqual([6])
    expect(h.note).toContain("第 6 行")
  })

  it("命中行是空行时落到最近的非空行（高亮不能落在空白上）", () => {
    const h = locateOriginal(TENDER, { line: 4, context: 0 })
    expect(h.how).toBe("line")
    expect(h.rows.every((r) => r.text.trim().length > 0)).toBe(true)
    expect(h.rows.find((r) => r.hit)?.text.trim().length).toBeGreaterThan(0)
  })

  it("行号越界（原文被重新导入变短）→ 不崩，改用摘录检索并说明", () => {
    const h = locateOriginal(TENDER, { line: 9999, excerpt: "不接受联合体投标" })
    expect(h.how).toBe("excerpt")
    expect(h.line).toBe(7)
    expect(h.note).toMatch(/第 7 行/)
  })

  it("越界且摘录也找不到 → how=none，note 说明对不上并给下一步", () => {
    const h = locateOriginal(TENDER, { line: 9999, excerpt: "这段原文根本不存在的内容" })
    expect(h.how).toBe("none")
    expect(h.rows).toEqual([])
    expect(h.note).toContain("9999")
    expect(h.note).toContain("搜索关键词")
  })
})

describe("原文定位 · 无行号时按摘录检索", () => {
  it("AI 提示项没有行号（line=0）：按摘录单行命中", () => {
    const h = locateOriginal(TENDER, { line: 0, excerpt: "投标人须具备独立法人资格" })
    expect(h.how).toBe("excerpt")
    expect(h.line).toBe(7)
    expect(h.note).toContain("没有行号")
  })

  it("摘录被裁剪过（带首尾省略号与各种引号空白）仍能命中", () => {
    const h = locateOriginal(TENDER, {
      excerpt: "…「（企业名称），从业人员 1 人，营业收入为 1 万元⋯",
    })
    expect(h.how).toBe("excerpt")
    expect(h.line).toBe(6)
  })

  it("原文被物理换行切断时，跨行拼起来也能命中", () => {
    const wrapped = ["第一章", "2.1 ★ 系统须支持国产化", "数据库，并完成历史数据迁移", "第三章"].join("\n")
    const h = locateOriginal(wrapped, { excerpt: "系统须支持国产化数据库" })
    expect(h.how).toBe("excerpt")
    expect(h.line).toBe(2)
    expect(h.note).toContain("换行")
  })

  it("纯语义提示且原文找不到 → how=none，note 说清要人工搜关键词", () => {
    const h = locateOriginal(TENDER, { line: 0, excerpt: "疑似隐形倾向某供应商" })
    expect(h.how).toBe("none")
    expect(h.note).toContain("手动在原文里搜索关键词")
  })
})

describe("原文定位 · 边界与空态", () => {
  it("没有招标原文 → 明确说没有原文，而不是空白面板", () => {
    for (const t of ["", "   ", null, undefined]) {
      const h = locateOriginal(t, { line: 3, excerpt: "随便" })
      expect(h.how).toBe("none")
      expect(h.note).toContain("没有保留招标原文")
    }
  })

  it("上下文窗口边界 clamp 在正文内（首行/末行不越界）", () => {
    const first = locateOriginal(TENDER, { line: 1, context: 5 })
    expect(first.from).toBe(1)
    const last = locateOriginal(TENDER, { line: 9, context: 5 })
    expect(last.to).toBe(9)
    expect(last.rows.every((r) => r.no >= 1 && r.no <= 9)).toBe(true)
  })

  it("context 非法值不放大窗口（负数按 0，超大按 10 上限）", () => {
    const neg = locateOriginal(TENDER, { line: 5, context: -3 })
    expect(neg.rows).toHaveLength(1)
    const huge = locateOriginal(TENDER, { line: 5, context: 999 })
    expect(huge.rows.length).toBeLessThanOrEqual(11)
  })

  it("摘录短于 4 字不参与检索（避免「投标人」这类词遍地命中）", () => {
    const h = locateOriginal(TENDER, { line: 0, excerpt: "投标" })
    expect(h.how).toBe("none")
  })
})

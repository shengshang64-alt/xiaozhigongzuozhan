import { describe, expect, it } from "vitest"
import {
  DEFAULT_FORMAT_SETTINGS,
  chapterWordBudgets,
  estimatePagesFromChars,
  formatCharsPerPage,
  type FormatSettings,
} from "./bidTypes"

const withBody = (over: Partial<FormatSettings["body"]>): FormatSettings => ({
  ...DEFAULT_FORMAT_SETTINGS,
  body: { ...DEFAULT_FORMAT_SETTINGS.body, ...over },
})
const withPaper = (paper: FormatSettings["paper"]): FormatSettings => ({
  ...DEFAULT_FORMAT_SETTINGS,
  paper,
})

describe("formatCharsPerPage", () => {
  it("默认/空配置恒等 500", () => {
    expect(formatCharsPerPage()).toBe(500)
    expect(formatCharsPerPage(null)).toBe(500)
    expect(formatCharsPerPage(DEFAULT_FORMAT_SETTINGS)).toBe(500)
  })

  it("字号双向缩放", () => {
    expect(formatCharsPerPage(withBody({ size: "小四" }))).toBe(681)
    expect(formatCharsPerPage(withBody({ size: "三号" }))).toBe(383)
    expect(formatCharsPerPage(withBody({ size: "五号" }))).toBe(889)
  })

  it("行距倍率", () => {
    expect(formatCharsPerPage(withBody({ lineSpacing: "单倍" }))).toBe(750)
    expect(formatCharsPerPage(withBody({ lineSpacing: "2倍" }))).toBe(375)
    expect(formatCharsPerPage(withBody({ lineSpacing: "固定值21磅" }))).toBe(650)
  })

  it("纸张与页边距影响可用版面", () => {
    const base = formatCharsPerPage(DEFAULT_FORMAT_SETTINGS)
    expect(formatCharsPerPage(withPaper("A3"))).toBeGreaterThan(base)
    expect(formatCharsPerPage(withPaper("16K"))).toBeLessThan(base)
    const wide: FormatSettings = {
      ...DEFAULT_FORMAT_SETTINGS,
      margins: { top: 5, bottom: 5, left: 5, right: 5 },
    }
    expect(formatCharsPerPage(wide)).toBeLessThan(base)
  })

  it("结果限幅", () => {
    const extreme: FormatSettings = {
      ...DEFAULT_FORMAT_SETTINGS,
      paper: "A3",
      body: { ...DEFAULT_FORMAT_SETTINGS.body, size: "初号", lineSpacing: "2倍" },
    }
    const r = formatCharsPerPage(extreme)
    expect(r).toBeGreaterThanOrEqual(150)
    expect(r).toBeLessThanOrEqual(2600)
  })
})

describe("charsPerPage 参数贯穿页数换算", () => {
  it("estimatePagesFromChars 按系数折算", () => {
    expect(estimatePagesFromChars(1000)).toBe(2)
    expect(estimatePagesFromChars(1000, 500)).toBe(2)
    expect(estimatePagesFromChars(1000, 1000)).toBe(1)
  })

  it("chapterWordBudgets 总量随系数线性放大", () => {
    const chapters = [{ title: "第一部分" }, { title: "第二部分" }]
    const def = chapterWordBudgets(chapters, 10)
    const dbl = chapterWordBudgets(chapters, 10, 1000)
    expect(def[0]).toBe(2500)
    expect(dbl[0]).toBe(5000)
    expect(dbl[0]).toBe(def[0] * 2)
  })
})

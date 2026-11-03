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
  it("默认/空配置恒等校准值 950", () => {
    expect(formatCharsPerPage()).toBe(950)
    expect(formatCharsPerPage(null)).toBe(950)
    expect(formatCharsPerPage(DEFAULT_FORMAT_SETTINGS)).toBe(950)
  })

  it("字号双向缩放", () => {
    expect(formatCharsPerPage(withBody({ size: "小四" }))).toBe(1293)
    expect(formatCharsPerPage(withBody({ size: "三号" }))).toBe(727)
    expect(formatCharsPerPage(withBody({ size: "五号" }))).toBe(1689)
  })

  it("行距倍率", () => {
    expect(formatCharsPerPage(withBody({ lineSpacing: "单倍" }))).toBe(1425)
    expect(formatCharsPerPage(withBody({ lineSpacing: "2倍" }))).toBe(713)
    expect(formatCharsPerPage(withBody({ lineSpacing: "固定值21磅" }))).toBe(1235)
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
    expect(def[0]).toBe(4750)
    expect(dbl[0]).toBe(5000)
  })
})

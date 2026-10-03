// Author: loop-R127
// formatDiff 此前 0 直接单测（refreshDocx.test.ts 仅借用 FormatScope 类型）。
// 钉住 computeFormatDiff 的比对口径：scope 过滤、null spec、字号/边距容差、
// 未设置占位文案、标题级数上限、平铺条目总数矩阵（9 项/全开）。
// 语义锚定：原稿缺失值（""/0）与模板目标值一律判 same=false（标为待刷新修正）。
import { describe, expect, it } from "vitest"

import { DEFAULT_FORMAT_SETTINGS, type FormatSettings } from "@/pages/BidWorkspace/bidTypes"
import type { FormatSpec } from "./formatSpec"
import { computeFormatDiff, SCOPE_OPTIONS, type FormatScope } from "./formatDiff"

const ALL: FormatScope[] = ["font", "heading", "spacing", "page"]

function settings(over: Partial<FormatSettings> = {}): FormatSettings {
  const s: FormatSettings = JSON.parse(JSON.stringify(DEFAULT_FORMAT_SETTINGS))
  return { ...s, ...over }
}

function spec(over: Partial<FormatSpec> = {}): FormatSpec {
  return {
    sourceFileName: "原稿.docx",
    page: {
      paperW: 11906,
      paperH: 16838,
      margin: { top: 2.54, right: 3.18, bottom: 2.54, left: 3.18 },
      paperGuess: "A4",
    },
    body: {
      styleId: "Normal",
      styleName: "Normal",
      fontEastAsia: "仿宋",
      fontAscii: "",
      sizePt: 14,
      bold: false,
      align: "justify",
      lineSpacing: "1.5倍",
      firstLineChars: 2,
      colorRgb: "",
    },
    headings: [],
    paragraphStyleCount: 1,
    styleSample: [],
    ...over,
  }
}

const findItem = (items: ReturnType<typeof computeFormatDiff>, label: string) =>
  items.find((i) => i.label === label)

describe("computeFormatDiff · 分 scope 比对", () => {
  it("spec 为 null → 空数组", () => {
    expect(computeFormatDiff(null, settings(), ALL)).toEqual([])
  })

  it("scopes 为空 → 不产生任何条目", () => {
    expect(computeFormatDiff(spec(), settings(), [])).toEqual([])
  })

  it("SCOPE_OPTIONS 恰为 4 项且 key 与 FormatScope 对齐", () => {
    expect(SCOPE_OPTIONS.map((o) => o.key)).toEqual(ALL)
    expect(SCOPE_OPTIONS.every((o) => o.label.length > 0)).toBe(true)
  })

  it("全 scope 开启 + 默认模板与一致原稿 → 平铺 10 项且全部 same（font3+spacing2+page5）", () => {
    const items = computeFormatDiff(spec(), settings(), ALL)
    expect(items).toHaveLength(10)
    expect(items.every((i) => i.same)).toBe(true)
  })

  it("未勾选的 scope 不参与比对（条目不出现）", () => {
    const items = computeFormatDiff(spec(), settings(), ["page"])
    expect(items.every((i) => i.scope === "page")).toBe(true)
    expect(items).toHaveLength(5)
  })

  it("font：字体匹配与不匹配（mapped 取模板值）", () => {
    const same = findItem(computeFormatDiff(spec(), settings(), ["font"]), "正文字体")
    expect(same?.same).toBe(true)
    const diff = findItem(
      computeFormatDiff(spec({ body: { ...spec().body, fontEastAsia: "宋体" } }), settings(), ["font"]),
      "正文字体",
    )
    expect(diff?.same).toBe(false)
    expect(diff?.raw).toBe("宋体")
    expect(diff?.mapped).toBe("仿宋")
  })

  it("font：原稿字体未设置 → raw 显示未设置且判 same=false", () => {
    const item = findItem(
      computeFormatDiff(spec({ body: { ...spec().body, fontEastAsia: "" } }), settings(), ["font"]),
      "正文字体",
    )
    expect(item?.raw).toBe("未设置")
    expect(item?.same).toBe(false)
  })

  it("字号容差 0.6pt：14.4 判一致，13 判不一致", () => {
    const ok = findItem(computeFormatDiff(spec({ body: { ...spec().body, sizePt: 14.4 } }), settings(), ["font"]), "正文字号")
    expect(ok?.same).toBe(true)
    expect(ok?.raw).toBe("14.4pt")
    expect(ok?.mapped).toBe("四号（14pt）")
    const no = findItem(computeFormatDiff(spec({ body: { ...spec().body, sizePt: 13 } }), settings(), ["font"]), "正文字号")
    expect(no?.same).toBe(false)
  })

  it("字号未设置（0pt）→ raw 未设置且判 same=false", () => {
    const item = findItem(computeFormatDiff(spec({ body: { ...spec().body, sizePt: 0 } }), settings(), ["font"]), "正文字号")
    expect(item?.raw).toBe("未设置")
    expect(item?.same).toBe(false)
  })

  it("首行缩进按字符数精确比对（不匹配报 raw/mapped）", () => {
    const item = findItem(
      computeFormatDiff(spec({ body: { ...spec().body, firstLineChars: 3 } }), settings(), ["font"]),
      "首行缩进",
    )
    expect(item?.raw).toBe("3 字符")
    expect(item?.mapped).toBe("2 字符")
    expect(item?.same).toBe(false)
  })

  it("heading：仅为原稿实际存在的级别出条目（跳级不虚构；字号与默认三号一致判 same）", () => {
    const h2 = {
      level: 2,
      styleId: "2",
      styleName: "heading 2",
      fontEastAsia: "黑体",
      fontAscii: "",
      sizePt: 16,
      bold: false,
      align: "left" as const,
      lineSpacing: "",
      firstLineChars: 0,
      colorRgb: "",
    }
    const items = computeFormatDiff(spec({ headings: [h2] }), settings(), ["heading"])
    expect(items).toHaveLength(2)
    expect(items[0].label).toBe("二级标题字体")
    expect(items[1].label).toBe("二级标题字号")
    expect(items[0].same).toBe(true)
    expect(items[1].same).toBe(true)
  })

  it("heading：级别超过 3 不比对（设置面板仅前 3 级参与）", () => {
    const mk = (lvl: number) => ({
      level: lvl,
      styleId: String(lvl),
      styleName: `heading ${lvl}`,
      fontEastAsia: "黑体",
      fontAscii: "",
      sizePt: 16,
      bold: false,
      align: "left" as const,
      lineSpacing: "",
      firstLineChars: 0,
      colorRgb: "",
    })
    const items = computeFormatDiff(spec({ headings: [mk(1), mk(2), mk(3), mk(4)] }), settings(), ["heading"])
    expect(items.filter((i) => i.scope === "heading")).toHaveLength(6)
  })

  it("spacing：行距与对齐按字符串精确比对", () => {
    const okItems = computeFormatDiff(spec(), settings(), ["spacing"])
    expect(okItems.every((i) => i.same)).toBe(true)
    const diffSpec = spec({ body: { ...spec().body, lineSpacing: "单倍", align: "" } })
    const items = computeFormatDiff(diffSpec, settings(), ["spacing"])
    const ls = findItem(items, "正文行距")
    expect(ls?.raw).toBe("单倍")
    expect(ls?.mapped).toBe("1.5倍")
    expect(ls?.same).toBe(false)
    const al = findItem(items, "正文对齐")
    expect(al?.raw).toBe("未设置")
    expect(al?.same).toBe(false)
  })

  it("page：纸张与四边距，边距容差 0.1cm", () => {
    const ok = computeFormatDiff(spec(), settings(), ["page"])
    expect(ok.filter((i) => i.scope === "page")).toHaveLength(5)
    expect(ok.every((i) => i.same)).toBe(true)

    const near = spec({
      page: { paperW: 11906, paperH: 16838, margin: { top: 2.54, right: 3.18, bottom: 2.54, left: 3.23 }, paperGuess: "A4" },
    })
    const leftItem = findItem(computeFormatDiff(near, settings(), ["page"]), "左边距")
    expect(leftItem?.same).toBe(true)
    expect(leftItem?.raw).toBe("3.23cm")

    const far = spec({
      page: { paperW: 11906, paperH: 16838, margin: { top: 2.54, right: 3.18, bottom: 2.54, left: 3.0 }, paperGuess: "A3" },
    })
    const items = computeFormatDiff(far, settings(), ["page"])
    expect(findItem(items, "纸张")?.same).toBe(false)
    expect(findItem(items, "左边距")?.same).toBe(false)
    expect(findItem(items, "左边距")?.mapped).toBe("3.18cm")
  })
})

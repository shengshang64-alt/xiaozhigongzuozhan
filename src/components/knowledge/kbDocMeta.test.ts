// 知识库 · 文档元信息口径守卫（纯函数）。
//
// 这些口径是「文档卡上每一个数字/徽标的唯一出处」——
// 固化成纯函数是为了让它可单测：文档库屏与全文检索屏都消费它们，
// 两屏的「8 天前」「可对客」「被引用 12 次」必须是同一个口径。
import { describe, expect, it } from "vitest"
import {
  audienceLabel,
  citationBucketOf,
  citationBucketRows,
  docFormatLabel,
  docFormatTone,
  fileSizeLabel,
  relativeTimeOf,
} from "./kbDocMeta"

describe("① 格式徽标：文案与语义色档", () => {
  it("已知扩展名映射到大写文案", () => {
    expect(docFormatLabel("docx")).toBe("DOCX")
    expect(docFormatLabel("PPTX")).toBe("PPTX")
    expect(docFormatLabel("pdf")).toBe("PDF")
    expect(docFormatLabel("md")).toBe("MD")
    expect(docFormatLabel("xlsx")).toBe("XLSX")
  })

  it("未知格式回落到大写扩展名，空则 FILE", () => {
    expect(docFormatLabel("wps")).toBe("WPS")
    expect(docFormatLabel("")).toBe("FILE")
    expect(docFormatLabel(undefined as unknown as string)).toBe("FILE")
  })

  it("语义色按「要不要打开看」分档，不按扩展名随机上色", () => {
    // 旧格式要转换 → 琥珀
    expect(docFormatTone("doc")).toBe("warning")
    expect(docFormatTone("xls")).toBe("warning")
    // 压缩包要警惕 → 红
    expect(docFormatTone("zip")).toBe("danger")
    // 主流文档 → 主色
    expect(docFormatTone("pdf")).toBe("primary")
    expect(docFormatTone("docx")).toBe("primary")
    // 纯文本 → 成功色
    expect(docFormatTone("md")).toBe("success")
    // 未知 → 中性
    expect(docFormatTone("wps")).toBe("neutral")
    expect(docFormatTone("")).toBe("neutral")
  })
})

describe("② 可对客性口径", () => {
  it("两个已知值分别归位", () => {
    expect(audienceLabel("client_facing")).toBe("可对客")
    expect(audienceLabel("internal_only")).toBe("仅内部")
  })

  it("未归位返回 null（界面显示「可对客性未归位」，不猜）", () => {
    expect(audienceLabel("")).toBeNull()
    expect(audienceLabel(undefined)).toBeNull()
    expect(audienceLabel("whatever")).toBeNull()
  })
})

describe("③ 相对时间", () => {
  const now = Date.parse("2026-11-11T08:00:00Z")

  it("分钟 / 小时 / 天 / 月 / 年 五档", () => {
    expect(relativeTimeOf("2026-11-11T07:58:00Z", now)).toBe("2 分钟前")
    expect(relativeTimeOf("2026-11-11T06:00:00Z", now)).toBe("2 小时前")
    expect(relativeTimeOf("2026-11-03T08:00:00Z", now)).toBe("8 天前")
    expect(relativeTimeOf("2026-10-11T08:00:00Z", now)).toBe("1 个月前")
    expect(relativeTimeOf("2026-08-11T08:00:00Z", now)).toBe("3 个月前")
    expect(relativeTimeOf("2024-11-11T08:00:00Z", now)).toBe("2 年前")
  })

  it("非法时间返回空串（不显示「NaN 天前」）", () => {
    expect(relativeTimeOf("", now)).toBe("")
    expect(relativeTimeOf("not-a-date", now)).toBe("")
    expect(relativeTimeOf(undefined, now)).toBe("")
  })

  it("未来时间显示「刚刚」而不是负数", () => {
    expect(relativeTimeOf("2026-11-11T09:00:00Z", now)).toBe("刚刚")
  })

  it("30 天边界：29 天算天、31 天算月", () => {
    expect(relativeTimeOf(new Date(now - 29 * 86400000).toISOString(), now)).toBe("29 天前")
    expect(relativeTimeOf(new Date(now - 31 * 86400000).toISOString(), now)).toBe("1 个月前")
  })
})

describe("④ 文件大小文案", () => {
  it("B / KB / MB 三档", () => {
    expect(fileSizeLabel(512)).toBe("512 B")
    expect(fileSizeLabel(2048)).toBe("2.0 KB")
    expect(fileSizeLabel(2 * 1024 * 1024)).toBe("2.0 MB")
  })

  it("空 / 0 / 非法 → null（不显示「0 B」）", () => {
    expect(fileSizeLabel(undefined)).toBeNull()
    expect(fileSizeLabel(0)).toBeNull()
    expect(fileSizeLabel(Number.NaN)).toBeNull()
  })
})

describe("⑤ 引用数分档（原型「按引用数排」三档口径）", () => {
  it("≥10 活知识 / 3-9 常用 / 0 从未被引用", () => {
    expect(citationBucketOf(12)).toBe("hot")
    expect(citationBucketOf(10)).toBe("hot")
    expect(citationBucketOf(9)).toBe("warm")
    expect(citationBucketOf(3)).toBe("warm")
    expect(citationBucketOf(2)).toBe("cold")
    expect(citationBucketOf(0)).toBe("cold")
  })

  it("统计三档并给百分比", () => {
    const rows = citationBucketRows({ a: 12, b: 5, c: 0, d: 1 })
    expect(rows.map((r) => r.key)).toEqual(["hot", "warm", "cold"])
    expect(rows[0].count).toBe(1)
    expect(rows[1].count).toBe(1)
    expect(rows[2].count).toBe(2)
    expect(rows[0].pct).toBe(25)
    expect(rows[2].pct).toBe(50)
  })

  it("**没有任何引用数据时返回空数组**（界面画「还没有引用数据」，不画三条 0 的柱子）", () => {
    expect(citationBucketRows({})).toEqual([])
  })
})

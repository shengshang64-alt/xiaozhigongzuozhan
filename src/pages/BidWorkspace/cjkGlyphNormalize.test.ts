// 招标原文「康熙部首」归一化的回归测试（2026-10-27 实测发现的系统性缺陷）
//
// 现象：三明项目 23.5 万字招标原文里，有 69 种字符落在 U+2E80–U+2FDF（CJK 部首补充 /
// 康熙部首）区间、合计数千处。最常见 `⼈`(U+2F08, 1024 次)、`⽂`(U+2F42, 453 次)、
// `⼀`(U+2F00, 265 次)。肉眼看与「人 / 文 / 一」一模一样，但**不是同一个码点**。
//
// 实测后果：
//   - `/一致$/` 匹配不到「前述表述完全⼀致」→ 评分项残片过滤器漏判该条；
//   - 隐式硬约束里「作废标处理」这类句子因字形不同被漏掉（归一后废标项 3 → 7）；
//   - 关键词命中、区域识别、★▲ 条款匹配等所有中文正则同理受污染。
//
// 为什么在解析入口归一：extractTenderFileText 是招标原文进入系统的唯一入口。
import { describe, expect, it } from "vitest"
import { normalizeCjkGlyphs } from "./bidFiles"

describe("normalizeCjkGlyphs · 康熙部首归一", () => {
  it("最常见的三个部首字归一为标准汉字", () => {
    // U+2F00 ⼀ / U+2F08 ⼈ / U+2F42 ⽂
    expect(normalizeCjkGlyphs("⼀致")).toBe("一致")
    expect(normalizeCjkGlyphs("投标⼈")).toBe("投标人")
    expect(normalizeCjkGlyphs("⽂件")).toBe("文件")
  })

  it("归一后中文正则才匹配得上（这正是缺陷的真实表现）", () => {
    const raw = "前述表述完全⼀致"
    const fixed = normalizeCjkGlyphs(raw)
    expect(/一致$/.test(raw)).toBe(false) // 原样匹配不上
    expect(/一致$/.test(fixed)).toBe(true) // 归一后匹配得上
  })

  it("覆盖面：部首补充区整段都能归一（抽查各段代表字）", () => {
    const cases: Array<[string, string]> = [
      ["⾦", "金"], // U+2FA6
      ["⾏", "行"], // U+2F8F
      ["⽅", "方"], // U+2F45
      ["⽤", "用"], // U+2F64
      ["⽬", "目"], // U+2F6C
      ["⾬", "雨"], // U+2FAC
      ["⿂", "魚"], // U+2FC2
    ]
    for (const [glyph, expected] of cases) {
      expect(normalizeCjkGlyphs(glyph), `U+${glyph.codePointAt(0)?.toString(16)}`).toBe(expected)
    }
  })

  it("不改动全角标点 / 全角数字 / 圈号（NFKC 会改坏这些，故手写映射）", () => {
    const keep = "（１）①：、％Ⅰ"
    expect(normalizeCjkGlyphs(keep)).toBe(keep)
  })

  it("无命中时零改动；空串安全", () => {
    const plain = "这是一段没有任何康熙部首的正常中文。"
    expect(normalizeCjkGlyphs(plain)).toBe(plain)
    expect(normalizeCjkGlyphs("")).toBe("")
  })

  it("长度守恒（逐字符映射，不增不减）", () => {
    const s = "投标⼈应提交⽂件⼀式两份，⾦额不得超过预算。"
    expect(normalizeCjkGlyphs(s).length).toBe(s.length)
  })
})

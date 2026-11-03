// R159：招标文本标注符号丢失检测——空引号对/私用区签名 + 零误报边界（纯函数单测）
import { describe, expect, it } from "vitest"
import { countMarkerLossLines, detectMarkerSymbolLoss, lineHasMarkerLoss, markerLossNotice } from "./materialIntegrity"

describe("detectMarkerSymbolLoss 空引号签名", () => {
  it("封面真实损坏形态：标注“”的条款为实质性要求 → 命中", () => {
    const r = detectMarkerSymbolLoss("1.本文件中标注“”的条款为实质性要求条款，投标人必须完全满足")
    expect(r.hits).toBe(1)
    expect(r.emptyQuoteCount).toBe(1)
    expect(r.samples[0]).toContain("标注")
  })

  it("正常标记条款不误报：标注“▲”的条款/参数行", () => {
    const r = detectMarkerSymbolLoss("标注“▲”的条款为重要技术指标，负偏离将按第六章评分标准扣分\n▲系统响应时间≤ 2 秒")
    expect(r.hits).toBe(0)
    expect(r.samples).toHaveLength(0)
  })

  it("后缀式兜底：空引号对 + 的指标", () => {
    const r = detectMarkerSymbolLoss("凡涉及“”的指标均需逐条响应")
    expect(r.hits).toBe(1)
  })

  it('普通引用/数值不误报：“这个”、"120"万元', () => {
    const r = detectMarkerSymbolLoss('采购人说“这个”很好，报价控制数 "120" 万元以内')
    expect(r.hits).toBe(0)
  })

  it("私用医残留：\uF0F5 直接出现在文本 → puaCount 命中", () => {
    const r = detectMarkerSymbolLoss("下列符号  为实质性条款标记")
    expect(r.puaCount).toBe(1)
    expect(r.hits).toBe(1)
    expect(r.samples[0]).toContain("实质性")
  })

  it("多处损坏：hits 累加、样本封顶 5 条且单条 ≤ 61 字", () => {
    const lines = Array.from({ length: 7 }, (_, i) => `${i + 1}.本文件中标注“”的条款为实质性要求`).join("\n")
    const r = detectMarkerSymbolLoss(lines + "\n其他正常内容")
    expect(r.hits).toBe(7)
    expect(r.samples).toHaveLength(5)
    for (const s of r.samples) expect(s.length).toBeLessThanOrEqual(61)
  })

  it("空输入/无损输入静默：hits=0 且 notice 为空串", () => {
    expect(detectMarkerSymbolLoss("").hits).toBe(0)
    expect(markerLossNotice(detectMarkerSymbolLoss(""))).toBe("")
    expect(markerLossNotice(detectMarkerSymbolLoss("标注“★”的条款"))).toBe("")
  })
})

describe("markerLossNotice 文案", () => {
  it("有疑点时含计数与对照原件引导", () => {
    const msg = markerLossNotice(detectMarkerSymbolLoss("标注“”的条款为实质性要求"))
    expect(msg).toContain("1 处")
    expect(msg).toContain("请对照招标原件核实")
  })
})

describe("lineHasMarkerLoss / countMarkerLossLines 逐行判定（R160 徽标数据源）", () => {
  it("空引号定义句命中，正常条款行与空白行不命中", () => {
    expect(lineHasMarkerLoss("本文件中标注“”的条款为实质性要求")).toBe(true)
    expect(lineHasMarkerLoss("标注“▲”的条款为重要技术指标")).toBe(false)
    expect(lineHasMarkerLoss("")).toBe(false)
    expect(lineHasMarkerLoss("   ")).toBe(false)
  })

  it("私用区残留字符行命中", () => {
    expect(lineHasMarkerLoss("下列符号 \uF0F5 为实质性条款标记")).toBe(true)
  })

  it("countMarkerLossLines 逐行计数、忽略空行与正常行", () => {
    const text = "1.标注“”的条款为实质性要求\n\n▲系统响应时间≤2秒\n2.标注“”的条款为重要指标"
    expect(countMarkerLossLines(text)).toBe(2)
    expect(countMarkerLossLines("")).toBe(0)
    expect(countMarkerLossLines("正常内容无空引号")).toBe(0)
  })
})

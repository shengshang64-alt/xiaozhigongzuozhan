import { describe, expect, it } from "vitest"
import { cleanStarClauseContent, isStarClauseNoiseLine, looksLikeStarDefinitionLine, looksLikeTocClauseLine } from "./starClauseNoise"

// R144：★/▲ 噪声判定单一真源——目录行/标注含义句识别 + 按条丢弃（含续行）
describe("starClauseNoise · 目录行判定", () => {
  it("编号前缀 + 行尾裸页码 + 短行判为目录行；真实条款不误判", () => {
    expect(looksLikeTocClauseLine("1.▲门急诊挂号系统 123")).toBe(true)
    expect(looksLikeTocClauseLine("附件三：带/▲条款汇总表 814")).toBe(true)
    expect(looksLikeTocClauseLine("（2）住院医生工作站 125")).toBe(true)
    // 强判别来自行尾裸页码：真实条款不以裸数字收尾
    expect(looksLikeTocClauseLine("★1")).toBe(false)
    expect(looksLikeTocClauseLine("▲门急诊挂号系统须支持日均门诊15000人次")).toBe(false)
  })
})

describe("starClauseNoise · 标注含义解释句判定", () => {
  it("以标记开头且含约定语判为解释句；普通参数条款不误判", () => {
    expect(looksLikeStarDefinitionLine("▲条款为实质性要求，任何一项负偏离其投标按无效投标处理")).toBe(true)
    expect(looksLikeStarDefinitionLine("★条款的含义：标注★的参数须逐条响应")).toBe(true)
    expect(looksLikeStarDefinitionLine("▲某系统须支持本地化服务团队")).toBe(false)
  })
})

describe("starClauseNoise · 行内式标注约定句判定（R153）", () => {
  it("编号起头、不以标记开头但为「标注X的条款」约定句判为噪声", () => {
    expect(
      looksLikeStarDefinitionLine(
        '2.本文件中标注"▲"的条款为重要技术指标/服务指标，负偏离将按第六章评分标准扣分',
      ),
    ).toBe(true)
    expect(
      looksLikeStarDefinitionLine('本文件标注"★"的条款为实质性要求，任一条负偏离按无效投标处理'),
    ).toBe(true)
    // 「」引号变体同样命中（引号类可扩展）
    expect(looksLikeStarDefinitionLine("带▲的：标注「▲」的条款须逐条响应，否则扣分")).toBe(true)
  })

  it("真实参数条款/纯约定词但非「标注…的条款」结构不误判", () => {
    // 参数条款虽含「标注」但非「标注X的条款」约定语结构
    expect(looksLikeStarDefinitionLine("▲须在投标文件中逐条标注响应情况并加盖公章")).toBe(false)
    expect(looksLikeStarDefinitionLine("▲门急诊挂号系统须支持日均门诊15000人次")).toBe(false)
    expect(looksLikeStarDefinitionLine("1.系统应满足等保三级要求")).toBe(false)
  })

  it("含 | 的表格行即便命中约定语也按结构内容保留（不判噪声）", () => {
    expect(
      looksLikeStarDefinitionLine('| 备注 | 本文件中标注"▲"的条款为实质性要求 | 是 |'),
    ).toBe(false)
  })
})

describe("starClauseNoise · cleanStarClauseContent 按条丢弃（含续行）", () => {
  it("噪声标记行及其续行剔除，干净条款与正文保留", () => {
    const content = [
      "1.▲门急诊挂号系统 123",
      "（1）注册登记、叫号功能说明",
      "★1",
      "软件性能支持日均门诊患者人次达15000以上。",
      "▲条款为实质性要求，任何一项负偏离按无效投标处理",
      "注:须提供承诺函",
      "★2",
      "数据处理能力：须制定历史数据迁移方案。",
    ].join("\n")
    const cleaned = cleanStarClauseContent(content)
    expect(isStarClauseNoiseLine("1.▲门急诊挂号系统 123")).toBe(true)
    expect(cleaned).toContain("软件性能支持")
    expect(cleaned).toContain("数据处理能力")
    expect(cleaned).not.toContain("门急诊挂号系统 123")
    expect(cleaned).not.toContain("注册登记")
    expect(cleaned).not.toContain("按无效投标处理")
    expect(cleaned).not.toContain("注:须提供承诺函")
  })

  it("本地扫描产出的干净内容幂等（原样返回）", () => {
    const content = ["★1", "完全满足采购需求所有实质性条款", "★2", "质保期不少于3年"].join("\n")
    expect(cleanStarClauseContent(content)).toBe(content)
  })
})

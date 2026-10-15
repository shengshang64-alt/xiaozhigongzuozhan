import { describe, expect, it } from "vitest"
import { contentHeadingLevel } from "./bidFiles"

/**
 * R54（导出排版）：格式设置面板能设 6 级标题样式，但导出此前最多只到 3 级——
 * （一）→H3，其余一律当正文，于是四/五级标题的字体字号设了也看不出任何变化。
 * 这里锁「正文行 → 标题级别」的判据：只认括号/圈号枚举的短行，
 * **不认「1.」「1.1」**（那两种在正文里绝大多数是列表项，误升标题会把交付物结构搞乱）。
 */
describe("contentHeadingLevel：正文行→标题级别", () => {
  it("（一）式 → 2 级（沿用既有口径）", () => {
    expect(contentHeadingLevel("（一）总体架构")).toBe(2)
    expect(contentHeadingLevel("（十二）运维保障")).toBe(2)
  })

  it("（1）式 → 3 级；① 式 → 4 级（新接住的深层标题）", () => {
    expect(contentHeadingLevel("（1）门诊医生工作站")).toBe(3)
    expect(contentHeadingLevel("(2) 住院护士工作站")).toBe(3)
    expect(contentHeadingLevel("① 数据采集")).toBe(4)
    expect(contentHeadingLevel("⑩ 验收交付")).toBe(4)
  })

  it("正文段落一律 0 级：长句、带句末标点、以及「1.」「1.1」式列表项都不升标题", () => {
    expect(contentHeadingLevel("系统采用微服务架构，支持多院区部署。")).toBe(0)
    expect(contentHeadingLevel("1. 支持国产化数据库")).toBe(0)
    expect(contentHeadingLevel("1.1 系统架构说明")).toBe(0)
    expect(contentHeadingLevel("（1）本条要求投标人提供原厂授权书并加盖公章。")).toBe(0)
    expect(contentHeadingLevel("（一）本项目按照招标文件要求执行，")).toBe(0)
  })

  it("超长行不升标题（避免把整段说明当成标题）", () => {
    expect(contentHeadingLevel(`（一）${"很长的标题".repeat(10)}`)).toBe(0)
  })

  it("空行/空白不升标题", () => {
    expect(contentHeadingLevel("")).toBe(0)
    expect(contentHeadingLevel("   ")).toBe(0)
  })
})

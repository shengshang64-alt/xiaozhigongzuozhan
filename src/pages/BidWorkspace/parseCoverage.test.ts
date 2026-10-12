// R-038③（R258）解析覆盖率度量与门禁 场景自测（零模型，纯函数）
import { describe, expect, it } from "vitest"
import {
  COVERAGE_BLOCK,
  COVERAGE_MIN_BLOCK_SOURCE_CHARS,
  COVERAGE_WARN,
  coverageLevel,
  coveragePercent,
  parseCoverageRatio,
  parsedContentChars,
} from "./parseCoverage"
import type { ParseSection } from "./bidTypes"

const sec = (content: string): ParseSection => ({ key: "overview", title: "项目概述", content })
const src = (n: number): string => "字".repeat(n) // n 个非空白字符的原文

describe("R-038③ 解析覆盖率度量与门禁（R258）", () => {
  it("覆盖率=产出/原文非空白；空白不计", () => {
    expect(parsedContentChars([sec("  abcdef  ")])).toBe(6)
    expect(parseCoverageRatio([sec("abcd")], src(10))).toBeCloseTo(0.4)
  })

  it("原文为空返回 null；超 1 截断到 1", () => {
    expect(parseCoverageRatio([sec("x")], "   ")).toBeNull()
    expect(parseCoverageRatio([sec("x".repeat(50))], src(10))).toBe(1)
  })

  it("分级：<30%且原文够大→block；<50%→warn；其余 ok", () => {
    expect(coverageLevel(parseCoverageRatio([sec("x".repeat(2000))], src(10000)), src(10000))).toBe("block")
    expect(coverageLevel(parseCoverageRatio([sec("x".repeat(4000))], src(10000)), src(10000))).toBe("warn")
    expect(coverageLevel(parseCoverageRatio([sec("x".repeat(6000))], src(10000)), src(10000))).toBe("ok")
  })

  it("短原文(<阻断下限字数)即便占比低也只 warn 不 block（防误伤精简输出）", () => {
    const r = parseCoverageRatio([sec("x".repeat(200))], src(COVERAGE_MIN_BLOCK_SOURCE_CHARS - 1))
    expect(coverageLevel(r, src(COVERAGE_MIN_BLOCK_SOURCE_CHARS - 1))).toBe("warn")
  })

  it("null 覆盖率→ok（不臆断）；百分比取整", () => {
    expect(coverageLevel(null, src(10000))).toBe("ok")
    expect(coveragePercent(0.437)).toBe(44)
    expect(coveragePercent(null)).toBeNull()
    expect(COVERAGE_BLOCK).toBeLessThan(COVERAGE_WARN)
  })
})

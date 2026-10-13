// R-038③（R258）解析覆盖率度量与门禁 场景自测（零模型，纯函数）
import { describe, expect, it } from "vitest"
import {
  COVERAGE_BLOCK,
  COVERAGE_MIN_BLOCK_SOURCE_CHARS,
  COVERAGE_WARN,
  CRITICAL_SECTION_KEYS,
  coverageLevel,
  coveragePercent,
  missingCriticalSections,
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

// 2026-10-13 真实场景实测：38.2 万字标书解析出约 3 万字（覆盖率 8%）触发阻断，
// 但真正的病灶是「响应文件要求」「投标文件目录要求」解析为空（大纲硬依赖）。
// 门禁阻断判据改为「关键项缺失」，覆盖率降级告警，故补关键项判据测试。
describe("R288+ 生成前门禁：关键解析项缺失判据（真实场景实测）", () => {
  const mk = (key: string, content: string, status?: ParseSection["status"]): ParseSection =>
    ({ key, title: key, content, ...(status ? { status } : {}) }) as ParseSection

  it("关键项全部有内容且 status=ok → 无缺失", () => {
    const sections = CRITICAL_SECTION_KEYS.map((k) => mk(k, "有内容", "ok"))
    expect(missingCriticalSections(sections)).toEqual([])
  })

  it("缺 key → 命中该 key", () => {
    const sections = CRITICAL_SECTION_KEYS.filter((k) => k !== "response_req").map((k) => mk(k, "有内容", "ok"))
    expect(missingCriticalSections(sections)).toEqual(["response_req"])
  })

  it("status 非 ok（pending/failed/miss）→ 命中，即便 content 有壳", () => {
    expect(missingCriticalSections([mk("tech_score", "暂无内容", "pending")])).toContain("tech_score")
    expect(missingCriticalSections([mk("void_items", "有内容", "failed")])).toContain("void_items")
    expect(missingCriticalSections([mk("biz_score", "有内容", "miss")])).toContain("biz_score")
  })

  it("content 为空或仅空态占位文本 → 命中（防「有壳无肉」）", () => {
    expect(missingCriticalSections([mk("response_req", "   ", "ok")])).toContain("response_req")
    expect(missingCriticalSections([mk("bid_outline_req", "未解析", "ok")])).toContain("bid_outline_req")
    expect(missingCriticalSections([mk("tech_score", "原文未提及", "ok")])).toContain("tech_score")
  })

  it("旧数据无 status 字段时按「有内容=ok」兼容（不误伤存量报告）", () => {
    const sections = CRITICAL_SECTION_KEYS.map((k) => mk(k, "有内容")) // 不带 status
    expect(missingCriticalSections(sections)).toEqual([])
  })

  it("真实场景形态：9 段长文档仅 2 项未解析 → 精确命中这 2 项，其余不误报", () => {
    const sections = [
      mk("tech_score", "评分项…", "ok"),
      mk("response_req", "暂无内容", "pending"), // 实测未解析
      mk("biz_score", "总分100分…", "ok"),
      mk("void_items", "未密封/未盖章", "ok"),
      mk("bid_outline_req", "", "pending"), // 实测未解析
    ]
    expect(missingCriticalSections(sections).sort()).toEqual(["bid_outline_req", "response_req"])
  })

  it("返回顺序与 CRITICAL_SECTION_KEYS 一致（便于提示语稳定）", () => {
    expect(missingCriticalSections([])).toEqual([...CRITICAL_SECTION_KEYS])
  })
})

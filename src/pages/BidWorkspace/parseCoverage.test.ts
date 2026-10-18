// R-038③（R258）解析覆盖率度量与门禁 场景自测（零模型，纯函数）
import { describe, expect, it } from "vitest"
import {
  COVERAGE_BLOCK,
  COVERAGE_MIN_BLOCK_SOURCE_CHARS,
  COVERAGE_WARN,
  CRITICAL_SECTION_KEYS,
  coverageLevel,
  coveragePercent,
  decideOutlineCriticalGate,
  isBlockingMissingStatus,
  missingCriticalSectionTitles,
  missingCriticalSections,
  parseCoverageRatio,
  parsedContentChars,
} from "./parseCoverage"
import { requestedKeys, type ParseSection } from "./bidTypes"

const sec = (content: string): ParseSection => ({ key: "overview", title: "项目概述", content })
const src = (n: number): string => "字".repeat(n) // n 个非空白字符的原文

describe("R-038③ 解析覆盖率度量与门禁（R258）", () => {
  it("覆盖率=产出/原文非空白；空白不计", () => {
    expect(parsedContentChars([sec("  abcdef  ")])).toBe(6)
    expect(parseCoverageRatio([sec("a".repeat(50))], src(125))).toBeCloseTo(0.4)
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

  const withOnly = (k: string, content: string, status?: ParseSection["status"]): ParseSection[] =>
    CRITICAL_SECTION_KEYS.filter((x) => x !== k).map((x) => mk(x, "有内容", "ok")).concat(mk(k, content, status))

  it("status=failed/pending → 命中，即便 content 有壳", () => {
    expect(missingCriticalSections([mk("tech_score", "暂无内容", "pending")])).toContain("tech_score")
    expect(missingCriticalSections([mk("void_items", "有内容", "failed")])).toContain("void_items")
  })

  it("R289：status=miss 不阻断（原文本确实没有该项，是正确完整的解析结果）", () => {
    // 取证：真实招标文件（安庆二院 CG-AQ-2021-5149 / 三明 38.2 万字稿）全文「投标文件目录」0 次，
    // 该要求通过「投标文件格式」章表达。如实答「原文未提及」= 正确，不是失败。
    expect(missingCriticalSections(withOnly("biz_score", "原文未提及", "miss"))).toEqual([])
    expect(isBlockingMissingStatus("miss")).toBe(false)
    expect(isBlockingMissingStatus("failed")).toBe(true)
    expect(isBlockingMissingStatus("pending")).toBe(true)
    expect(isBlockingMissingStatus("ok")).toBe(false)
    expect(isBlockingMissingStatus(undefined)).toBe(false)
  })

  it("content 为空或仅空态占位文本 → 命中（防「有壳无肉」）；但 status=miss 时以 status 为准", () => {
    expect(missingCriticalSections(withOnly("response_req", "   ", "ok"))).toContain("response_req")
    expect(missingCriticalSections(withOnly("bid_outline_req", "未解析", "ok"))).toContain("bid_outline_req")
    expect(missingCriticalSections(withOnly("tech_score", "原文未提及", "ok"))).toContain("tech_score")
    // status=miss 优先：不因内容是空态文本而误判为缺失
    expect(missingCriticalSections(withOnly("tech_score", "原文未提及", "miss"))).toEqual([])
  })

  it("旧数据无 status 字段时按「有内容=ok」兼容（不误伤存量报告）", () => {
    const sections = CRITICAL_SECTION_KEYS.map((k) => mk(k, "有内容")) // 不带 status
    expect(missingCriticalSections(sections)).toEqual([])
  })

  it("真实场景形态：pending 才阻断，miss 放行", () => {
    const sections = [
      mk("tech_score", "评分项…", "ok"),
      mk("response_req", "暂无内容", "pending"), // 真未产出 → 阻断
      mk("biz_score", "总分100分…", "ok"),
      mk("void_items", "未密封/未盖章", "ok"),
      mk("bid_outline_req", "原文未提及", "miss"), // 原文无此专章 → 放行
    ]
    expect(missingCriticalSections(sections)).toEqual(["response_req"])
  })

  it("返回顺序与 CRITICAL_SECTION_KEYS 一致（便于提示语稳定）", () => {
    expect(missingCriticalSections([])).toEqual([...CRITICAL_SECTION_KEYS])
  })
})

// ---------------------------------------------------------------------------
// R58（B28）关键项门禁的两处修正（真实数据复算驱动）
//   ① 未请求的关键项不算缺失：默认 key 档解析不请求 void_items（它在 PARSE_EXTRA_SECTIONS 里），
//      而门禁把它当关键项 → 25 条真实记录里 5 条 key 档项目被假拦。
//   ② 已有非空大纲时不硬拦，改二次确认（默认取消）；无大纲保持硬拦。
// 反向验证（删实现即变红）：
//   · 去掉 missingCriticalSections 的 requestedKeys 过滤 → 用例①红；
//   · 把 decideOutlineCriticalGate 改回「只看 criticalMissing 非空 → block」→ 用例②红。
// ---------------------------------------------------------------------------
describe("R58（B28）关键项门禁：作用域感知 + 已有大纲不硬拦", () => {
  const mk = (key: string, content: string, status?: ParseSection["status"]): ParseSection =>
    ({ key, title: key, content, ...(status ? { status } : {}) }) as ParseSection

  /** 关键项档实际请求的 8 项（不含 void_items） */
  const keyKeys = requestedKeys({ scope: "key", extra_keys: [] })
  /** 完整档实际请求的项（含 void_items） */
  const fullKeys = requestedKeys({ scope: "full", extra_keys: ["void_items"] })

  it("① 未请求的关键项不算缺失：key 档不请求 void_items，就不该因它缺失被拦", () => {
    const sections = keyKeys.map((k) => mk(k, "有内容", "ok"))
    // 不传 requestedKeys（旧口径）：把没请求过的 void_items 也算成缺失 → 假拦
    expect(missingCriticalSections(sections)).toEqual(["void_items"])
    // 传该项目的实际请求范围：反馈为空，放行
    expect(missingCriticalSections(sections, CRITICAL_SECTION_KEYS, keyKeys)).toEqual([])
    expect(missingCriticalSectionTitles({ scope: "key", sections }, CRITICAL_SECTION_KEYS, keyKeys)).toEqual([])
    // 反向对照：同一份数据在完整档（请求了 void_items）下判缺是正确的，不是被放掉
    expect(missingCriticalSections(sections, CRITICAL_SECTION_KEYS, fullKeys)).toEqual(["void_items"])
  })

  it("①b 请求过的关键项真缺失时照旧判缺（作用域感知不得放掉真拦截）", () => {
    const sections = fullKeys.filter((k) => k !== "tech_score").map((k) => mk(k, "有内容", "ok"))
    expect(missingCriticalSections(sections, CRITICAL_SECTION_KEYS, fullKeys)).toEqual(["tech_score"])
  })

  it("② 已有非空大纲 → confirm（不硬拦）；无大纲 → block（保持硬拦）；不缺项 → pass", () => {
    expect(decideOutlineCriticalGate([], true)).toBe("pass")
    expect(decideOutlineCriticalGate([], false)).toBe("pass")
    expect(decideOutlineCriticalGate(["void_items"], true)).toBe("confirm")
    expect(decideOutlineCriticalGate(["void_items"], false)).toBe("block")
    // 多项缺失也一样：有纲就不硬拦
    expect(decideOutlineCriticalGate([...CRITICAL_SECTION_KEYS], true)).toBe("confirm")
  })
})

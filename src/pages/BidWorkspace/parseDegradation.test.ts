// ---------------------------------------------------------------------------
// R58（B29）解析层退化自检 场景自测（零模型，纯函数）
//
// 覆盖主导者裁定的 v2a 口径四要点：
//  ① 规模阈值（38.2 万字 1 分区触发 / 小标书不触发 / 正常大标书不触发）；
//  ② 必须能盖住「静默退化」——关键项内容全是空态占位、其余分区看着不少时，现行口径一声不吭，
//     而生成门禁判其缺项；v2a 起与门禁同判据，两者不可能再打架；
//  ③ 「非空分区」复用门禁 isSectionMissing（占位文字不算有内容）；
//  ④ 必须传 requestedKeys——未请求过的项不参与统计（否则 key 档项目收到假告警）。
//
// 反向验证（删实现即变红）：去掉 detectParseDegradation 里的 criticalMissing 触发 → 本文件
// 「静默退化」用例红；把 filledSections 换回「content 非空白 > 0」→ 同用例红；去掉 inScope 过滤 → 「key 档不假告警」用例红。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import {
  CRITICAL_SECTION_KEYS,
  PARSE_DEGRADED_MIN_FILLED_SECTIONS,
  PARSE_DEGRADED_MIN_SCORING_LINES,
  PARSE_DEGRADED_MIN_SOURCE_CHARS,
  PARSE_DEGRADED_MIN_VOID_LINES,
  detectParseDegradation,
} from "./parseCoverage"
import { PARSE_EXTRA_SECTIONS, requestedKeys, type ParseReport, type ParseSection } from "./bidTypes"
import { hookSources, sourceText } from "@/testing/hookSources"

const HOOK = hookSources()

/** n 个非空白字符的原文 */
const src = (n: number): string => "字".repeat(n)

const mk = (key: string, content: string, status?: ParseSection["status"]): ParseSection =>
  ({ key, title: key, content, ...(status ? { status } : {}) }) as ParseSection

const rep = (sections: ParseSection[]): ParseReport => ({ scope: "full", sections })

/** 完整档（含 void_items）请求范围 */
const FULL_KEYS = requestedKeys({ scope: "full", extra_keys: ["void_items"] })
/** 存量项目形态：2026-10-22 之前的关键项档请求范围（不含废标三件套） */
const KEY_KEYS = [
  "overview",
  "tech_score",
  "project_info",
  "purchaser_info",
  "delivery_req",
  "response_req",
  "biz_score",
  "bid_outline_req",
]

const realContent = (n = 20): string => Array.from({ length: n }, (_, i) => `第 ${i + 1} 条要点内容`).join("\n")

describe("R58（B29）解析层退化自检 v2a", () => {
  it("① 38.2 万字退化例（仅 1 个 overview 分区）→ 触发，且说得出是哪几项", () => {
    const r = detectParseDegradation(rep([mk("overview", realContent(), "ok")]), src(382000), FULL_KEYS)
    expect(r.degraded).toBe(true)
    expect(r.metrics.filledSections).toBe(1)
    expect(r.reason).toContain("非空分区")
    // 关键项一个都没产出 → 原因里必须点名，而不是只说「分区少」
    expect(r.reason).toContain("技术评分要求")
    // 落库口径：单条 warnings ≤100 字，超长会被截断
    expect(r.reason.length).toBeLessThanOrEqual(100)
  })

  it("② 小标书（<5 万字）即便只 1 个分区也不触发——门槛约束全部触发条件", () => {
    const r = detectParseDegradation(rep([mk("overview", "很短的内容", "ok")]), src(PARSE_DEGRADED_MIN_SOURCE_CHARS - 1), FULL_KEYS)
    expect(r.degraded).toBe(false)
    expect(r.reason).toBe("")
    // 边界：恰好达到门槛才进入判定（此处 1 分区 + 无关键项 → 必触发）
    const atGate = detectParseDegradation(rep([mk("overview", "很短的内容", "ok")]), src(PARSE_DEGRADED_MIN_SOURCE_CHARS), FULL_KEYS)
    expect(atGate.degraded).toBe(true)
  })

  it("③ 正常大标书（关键项齐全、分区足够）不触发", () => {
    const sections = [
      mk("overview", realContent(), "ok"),
      mk("tech_score", realContent(12), "ok"),
      mk("project_info", realContent(), "ok"),
      mk("purchaser_info", realContent(), "ok"),
      mk("delivery_req", realContent(), "ok"),
      mk("response_req", realContent(), "ok"),
      mk("biz_score", realContent(6), "ok"),
      mk("void_items", realContent(8), "ok"),
      mk("qualification", realContent(), "ok"),
      mk("compliance", realContent(), "ok"),
      mk("bid_outline_req", realContent(), "ok"),
      mk("contract_terms", realContent(), "ok"),
    ]
    const r = detectParseDegradation(rep(sections), src(120000), FULL_KEYS)
    expect(r.degraded).toBe(false)
    expect(r.reason).toBe("")
    expect(r.metrics.filledSections).toBe(sections.length)
    expect(r.metrics.scoringLines).toBeGreaterThanOrEqual(PARSE_DEGRADED_MIN_SCORING_LINES)
    expect(r.metrics.voidLines).toBeGreaterThanOrEqual(PARSE_DEGRADED_MIN_VOID_LINES)
    expect(r.metrics.voidRequested).toBe(true)
  })

  it("④ 静默退化：关键项内容全是「原文未提及」占位、其余分区不少 → 必须告警（v2a 新增触发）", () => {
    // 占位 5 项 + 若干正常分区；分区数（≥4）与评分/废标行数（各 1 行占位）都过得了旧阈值，
    // 于是旧口径 degraded=false、一条告警都不发，而生成门禁却判「5/5 缺」——两份判据结论相反。
    const placeholders = CRITICAL_SECTION_KEYS.map((k) => mk(k, "原文未提及", "ok"))
    const others = PARSE_EXTRA_SECTIONS.slice(0, 6).map((d) => mk(d.key, realContent(), "ok"))
    const wideKeys = requestedKeys({
      scope: "full",
      extra_keys: ["void_items", ...PARSE_EXTRA_SECTIONS.slice(0, 6).map((d) => d.key)],
    })
    const r = detectParseDegradation(rep([...placeholders, ...others]), src(100000), wideKeys)
    expect(r.degraded, "门禁判缺而自检沉默＝静默退化，必须告警").toBe(true)
    // 占位文字不算「有内容」：11 项里只有 6 项算数（这正是旧口径 11 项全算、因而漏报的地方）
    expect(r.metrics.filledSections).toBe(6)
    expect(r.reason).toContain("关键项无有效内容")
    expect(r.reason.length).toBeLessThanOrEqual(100)
  })

  it("⑤ 范围感知：存量 key 档不请求废标项 → 不因它缺失告警（否则 11 条 key 档项目里 5 条假告警）", () => {
    const keySections = KEY_KEYS.map((k) =>
      mk(k, k === "tech_score" || k === "biz_score" ? realContent(6) : realContent(), "ok"),
    )
    const r = detectParseDegradation(rep(keySections), src(200000), KEY_KEYS)
    expect(KEY_KEYS).not.toContain("void_items")
    expect(r.metrics.voidRequested).toBe(false)
    expect(r.degraded).toBe(false)
    // 同一份数据若按完整档请求范围判定，void 缺失就是真该告警的（反向对照）
    expect(detectParseDegradation(rep(keySections), src(200000), FULL_KEYS).degraded).toBe(true)
  })

  it("⑥ status=miss（原文本就没有该项）是正确结果，不算缺失、不触发告警", () => {
    const sections = CRITICAL_SECTION_KEYS.map((k) =>
      k === "bid_outline_req" ? mk(k, "原文未提及", "miss") : mk(k, realContent(6), "ok"),
    )
    const r = detectParseDegradation(rep(sections), src(80000), FULL_KEYS)
    // miss 在门禁判据 isSectionMissing 里不算缺失（R289），故关键项不缺 → 不告警
    expect(r.degraded).toBe(false)
    // 但它也不是「有内容」，不应被当成产出的分区（口径与门禁一致）
    expect(r.metrics.scoringLines).toBeGreaterThanOrEqual(1)
  })

  it("⑦ 阈值常量关系自洽（防有人把门槛调成互相矛盾的值）", () => {
    expect(PARSE_DEGRADED_MIN_SOURCE_CHARS).toBe(50000)
    expect(PARSE_DEGRADED_MIN_FILLED_SECTIONS).toBeGreaterThan(0)
    expect(PARSE_DEGRADED_MIN_SCORING_LINES).toBeGreaterThanOrEqual(1)
    expect(PARSE_DEGRADED_MIN_VOID_LINES).toBeGreaterThanOrEqual(1)
  })

  it("⑧ 无报告 / 空原文不抛异常也不臆断", () => {
    expect(detectParseDegradation(null, src(200000), FULL_KEYS).degraded).toBe(true) // 大原文却没报告 = 退化
    expect(detectParseDegradation(null, "", FULL_KEYS).degraded).toBe(false)
    expect(detectParseDegradation(rep([]), null, FULL_KEYS).degraded).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 接线哨兵（源码级，与 promptVisibilityWiring 同类）：
// 本仓真实发生过「判定函数写好了、却 0 个调用点」——函数与阈值都在，琥珀横幅永远不会出现，
// 而单测全绿（因为只在测函数本身）。故这里钉死「函数 → warnings 组装 → 置首位」这条链，
// 缺任何一环就红。读取走 src/testing/hookSources（行尾已归一到 LF）。
// ---------------------------------------------------------------------------
describe("R58（B29）退化自检接线哨兵", () => {
  it("detectParseDegradation 的调用点在 warnings 组装处，且退化告警排在首位（琥珀横幅只显首条）", () => {
    expect(HOOK).toContain("const degradation = detectParseDegradation(report, text, requestedKeys(cfg))")
    expect(HOOK).toContain("const degradationWarn = degradation.degraded ? [degradation.reason] : []")
    // 必须排在其他告警之前：ParseReportPanel 的琥珀横幅只渲染 summarizeParseWarnings().headline（首条）
    const warningsStart = HOOK.indexOf("const warnings = [")
    expect(warningsStart).toBeGreaterThan(-1)
    const head = HOOK.slice(warningsStart, warningsStart + 120)
    expect(head).toContain("...degradationWarn,")
    // 且必须与落库链路相接（刷新后横幅能恢复）
    expect(HOOK).toContain("...(warnings.length ? { warnings: warnings.map((w) => w.slice(0, 100)).slice(0, 20) } : {})")
  })

  it("门禁与自检同源：门禁判缺的关键项集合直接喂给自检（不是各算一套）", () => {
    expect(HOOK).toContain("missingCriticalSections(cur.parse_report.sections, CRITICAL_SECTION_KEYS, reqKeys)")
    expect(HOOK).toContain("decideOutlineCriticalGate(criticalMissing, (cur.bid_outline ?? []).length > 0)")
  })
})

describe("R58（B28）关键项门禁接线哨兵", () => {
  it("弹窗三件套真的接到了 View 层（不是只有 setter、没有读取方的死状态）", () => {
    const compose = sourceText("src/components/bid-workspace/ComposeStep.tsx")
      .split(/\r?\n/)
      .join("\n")
    expect(compose).toContain("p.outlineCriticalConfirmOpen")
    expect(compose).toContain("p.outlineCriticalConfirmText")
    expect(compose).toContain("p.confirmGenerateOutlineCritical")
    expect(compose).toContain("p.cancelGenerateOutlineCritical")
    // 默认动作是取消：取消按钮必须是默认焦点（autoFocus），且遮罩/Esc 关闭也走取消
    const dialogAt = compose.indexOf("p.outlineCriticalConfirmOpen")
    const dialogBlock = compose.slice(dialogAt, dialogAt + 1600)
    expect(dialogBlock).toContain("autoFocus")
    expect(dialogBlock).toContain("if (!o) p.cancelGenerateOutlineCritical()")
    expect(dialogBlock).toContain("覆盖现有大纲")
    // 页面必须把句柄透传下去，否则组件拿到 undefined
    const page = sourceText("src/pages/BidWorkspace/BidWorkspacePage.tsx")
    expect(page).toContain("confirmGenerateOutlineCritical={p.confirmGenerateOutlineCritical}")
    expect(page).toContain("cancelGenerateOutlineCritical={p.cancelGenerateOutlineCritical}")
  })
})

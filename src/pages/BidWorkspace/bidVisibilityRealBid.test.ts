// R50b · 安中医真实标书回归（真实数据，不再只测构造样本）
//
// 背景：R50 的「长文可见性」（bidVisibility.ts）只在构造样本上验证过，轮报把「未用真实标书验证」登记为
// 未覆盖边界。2026-10-14 真实跑完的安中医项目（bid_projects.id = mfl6howomsw5i0l）经
// scripts/azhongyi-real-fixture.mjs 导出成脱敏夹具（18 章 / 4.7 万字 / 133 条款），本文件是它的常态回归：
// 断言的是行为不变量与下限（防回归），不是把某次测量的命中率写死——检索变好时基线应上调，不是把测试改绿。
//
// 实测（2026-10-15，脱敏 v2）：mode=retrieval / input_complete=false / 注入 7 段约 19944 字 / 未注入 27159 字 /
// clause_hit=56/133（全覆盖 5 章）；旧口径 clipText(12000) 只覆盖 3 章却自称 input_complete=true。
//
// 实测（2026-10-20，召回修复后重测）：bidVisibility.ts 的 selectBidEvidence 原把「排名第一的块放不进
// 剩余预算」的条款**永久判死**（`tried[ci] = rows.length` 后 break），连退而求其次用次优块的机会都没有。
// 改为只跳出本轮、下一轮从次优块继续试之后，同一夹具、同一预算下：子集 clause_hit 56→110、不可见
// 77→23；全量 clause_hit 13→50、待核对 119→83。本文件基线随之**上调**（按文件头原则：检索变好时上调，
// 不是为了让测试变绿而改数字）。这两组数字都是当场实跑得到的，不是推算。
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  BID_VISIBILITY_BUDGET_CHARS,
  bidEvidenceBlock,
  chunkBidText,
  describeBidVisibility,
  selectBidEvidence,
  type BidEvidencePack,
} from "./bidVisibility"
import { buildDeviationMapMessages } from "./prompts/deviationMap"
import {
  DEVIATION_REVIEW_EXPORT_SUMMARY,
  DEVIATION_REVIEW_INTERNAL_NOTES,
  GATE_FATAL_RULES,
  MAX_BID_CHARS,
  clipText,
  deviationCommitHits,
  deviationExportSummary,
  deviationStats,
  markInvisibleDeviationRows,
  sanitizeDeviationRows,
  type DeviationRow,
  type DeviationTable,
  type RequirementClause,
} from "./bidTypes"

type FixtureClause = { id: string; text: string; source: string; legacy_level: string }
type RealBidFixture = {
  meta: {
    hospital: string
    tender_no: string
    stage: string
    chapter_count: number
    tender_chars: number
    bid_chars: number
    clause_count: number
    legacy_levels: Record<string, number>
    subset: boolean
  }
  tender_text: string
  bid_text: string
  clauses: FixtureClause[]
}

const DIR = path.dirname(fileURLToPath(import.meta.url))
const SUBSET_PATH = path.join(DIR, "__fixtures__", "azhongyiRealBid.json")
/** 全量真实数据（含真名，只在本机 .probe/ 下，不入库）：存在时多跑一轮同口径断言 */
const FULL_PATH = path.join(DIR, "..", "..", "..", ".probe", "az-fixture", "azhongyi.full.json")

const readFixture = (p: string): RealBidFixture => JSON.parse(readFileSync(p, "utf8")) as RealBidFixture
const SUBSET = readFixture(SUBSET_PATH)

const norm = (s: string): string => s.replace(/[\s|｜]/g, "")
const allText = (f: RealBidFixture): string => `${f.tender_text}\n${f.bid_text}\n${f.clauses.map((c) => c.text).join("\n")}`
const asClauses = (f: RealBidFixture): RequirementClause[] => f.clauses.map(({ id, text, source }) => ({ id, text, source }))
const chapterRefs = (text: string): string[] => [...new Set(chunkBidText(text).map((c) => c.chapter_ref))]

/** 记录基线：夹具脱敏 v2 生成时实测值，供「不得更差」类断言引用（变好则上调） */
const RECORDED = {
  chapters: 18,
  clauseTotal: 133,
  legacyDeviation: 82,
  /** 子集：本次可见的条款数 / 可见且历史判定为偏离的条款数（＝新链路最多能报出的负偏离）
   *  2026-10-20 召回修复后重测：subsetHit 56→110、subsetVisibleDeviation 29→65、subsetInvisible 77→23 */
  subsetHit: 110,
  subsetVisibleDeviation: 65,
  subsetInvisible: 23,
  /** 检索召回下限：当前 110/133；调优后应上调，低于 90 视为回归（旧值 40 = 修复前 56 的保守下限） */
  hitFloor: 90,
  /** 单条规则进体检的条数上限（与其它本地检查一致） */
  ruleCap: 30,
}

/** 历史旧口径判定 → 本次模拟「模型只看得到可见条款时的作答」（不可见条款一律漏答，驱动降级链路） */
const LEGACY_LABEL: Record<string, string> = { full: "完全响应", partial: "部分响应", deviation: "偏离" }

/**
 * 真实链路复现：证据包 → 模型只对可见条款作答 → sanitizeDeviationRows → markInvisibleDeviationRows。
 * 与 useBidWorkspace.runDeviationTable 同一串函数，只是把「模型输出」替换成夹具里的历史判定。
 */
function buildEndToEnd(f: RealBidFixture): { pack: BidEvidencePack; table: DeviationTable; invisible: string[]; visibleDeviation: number } {
  const clauses = asClauses(f)
  const pack = selectBidEvidence(f.bid_text, clauses.map((c) => ({ id: c.id, text: c.text })))
  const invisible = pack.clauses.filter((c) => !c.hit).map((c) => c.ref)
  const rows: Record<string, unknown>[] = []
  f.clauses.forEach((c, i) => {
    if (!pack.clauses[i]?.hit) return // 本次不可见 → 模型无从判定 → 漏答
    rows.push({
      clause_id: c.id,
      response_level: LEGACY_LABEL[c.legacy_level] ?? "部分响应",
      response_node: "第3章 一体化核心业务系统详细功能与技术参数实质性响应",
      response_summary: "已按招标要求响应并提供量化承诺与证明材料",
      bid_ref: "3.1",
    })
  })
  const sanitized = sanitizeDeviationRows({ rows }, clauses)
  const marked = markInvisibleDeviationRows(sanitized, invisible)
  const visibleDeviation = f.clauses.filter((c, i) => pack.clauses[i]?.hit && c.legacy_level === "deviation").length
  return { pack, table: { split_dim: "system", generated_at: "", rows: marked }, invisible, visibleDeviation }
}

const E2E = buildEndToEnd(SUBSET)
const PACK = E2E.pack
const R = PACK.report
const INVISIBLE = E2E.invisible
const INVISIBLE_SET = new Set(INVISIBLE)
const INJECTED = R.input_chars - R.omitted_chars
const ALL_CHAPTERS = chapterRefs(SUBSET.bid_text)
const MISSED = PACK.clauses.filter((c) => !c.hit)

describe("R50b §0 夹具自洽与脱敏（安中医真实标书 → 可入库夹具）", () => {
  it("真实规模：18 章 / 4.7 万字正文 / 133 条款，meta 与实际逐项一致", () => {
    expect(SUBSET.meta.subset).toBe(true)
    expect(SUBSET.meta.chapter_count).toBe(RECORDED.chapters)
    expect(SUBSET.clauses.length).toBe(RECORDED.clauseTotal)
    expect(SUBSET.meta.clause_count).toBe(SUBSET.clauses.length)
    expect(SUBSET.meta.bid_chars).toBe(SUBSET.bid_text.length)
    expect(SUBSET.meta.tender_chars).toBe(SUBSET.tender_text.length)
    expect(ALL_CHAPTERS.length).toBe(RECORDED.chapters)
    expect(SUBSET.bid_text.length).toBeGreaterThan(40000) // 真的比构造样本长一个量级
  })

  it("旧口径判定分布留在夹具里（用来量化「脱离证据的负偏离」）", () => {
    expect(SUBSET.meta.legacy_levels.deviation).toBe(RECORDED.legacyDeviation)
    const sum = Object.values(SUBSET.meta.legacy_levels).reduce((a, b) => a + b, 0)
    expect(sum).toBe(RECORDED.clauseTotal)
  })

  it("脱敏到位：院名/项目编号已换占位，地址/电话/人名不再残留（断言用形状，不写真名）", () => {
    const text = allText(SUBSET)
    expect(SUBSET.bid_text).toContain(SUBSET.meta.hospital)
    expect(SUBSET.tender_text).toContain(SUBSET.meta.tender_no)
    expect(text).not.toContain("安徽中医药大学") // 真实校名/院名前缀
    expect(text.match(/1[3-9]\d{9}/g) ?? []).toEqual([]) // 手机号
    expect(text.match(/\b0[1-9]\d{1,2}-\d{7,8}\b/g) ?? []).toEqual([]) // 带真实区号的固话
    // 街道地址：占位「某市某路 000 号」以外的「…路 N 号」一律不得出现
    const addr = text.match(/[\u4e00-\u9fa5]{2,10}(?:路|街|大道)\s*\d{1,6}\s*号/g) ?? []
    expect(addr.filter((s) => !/某市某路\s*000\s*号/.test(s))).toEqual([])
  })
})

describe("R50b §1 4.7 万字真实正文：定向检索 + 如实报告可见范围", () => {
  it("mode=retrieval 且 input_complete=false（不得再声称注入完整）", () => {
    expect(R.mode).toBe("retrieval")
    expect(R.input_complete).toBe(false)
    expect(R.input_chars).toBe(SUBSET.bid_text.trim().length)
    expect(R.total_chapters).toBe(RECORDED.chapters)
    expect(R.selected_chunks).toBeGreaterThan(0)
    expect(R.selected_chunks).toBeLessThan(R.total_chunks)
  })

  it("注入量 ≤ 预算，且未注入部分被如实计量", () => {
    expect(INJECTED).toBeGreaterThan(0)
    expect(INJECTED).toBeLessThanOrEqual(BID_VISIBILITY_BUDGET_CHARS)
    expect(R.omitted_chars).toBe(R.input_chars - INJECTED)
    expect(R.omitted_chars).toBeGreaterThan(0)
  })

  it("覆盖章是真实章节的子集，且告警第一条就是「输入未完整覆盖」", () => {
    expect(R.covered_chapters.length).toBeGreaterThan(0)
    expect(R.covered_chapters.every((c) => ALL_CHAPTERS.includes(c))).toBe(true)
    expect(R.warnings.join("\n")).toContain("输入未完整覆盖")
    expect(R.warnings.join("\n")).toContain("待人工核对")
  })

  it("可见性说明块写明「输入完整：否」「未注入」「不得当作不存在」", () => {
    expect(PACK.note).toContain("输入完整：否")
    expect(PACK.note).toContain("未注入")
    expect(PACK.note).toContain("不得当作「投标文件中不存在」")
    expect(PACK.note).toContain("程序生成，非模型推断")
  })

  it("toast 文案只说「本次仅注入」，不得出现「已完整注入模型」", () => {
    const s = describeBidVisibility(PACK, "技术偏离表")
    expect(s).toContain("技术偏离表")
    expect(s).toContain("本次仅注入")
    expect(s).toContain("未注入")
    expect(s).not.toContain("已完整注入模型")
  })
})

describe("R50b §2 未覆盖章 = 真的没进模型输入（不是「没写」）", () => {
  const injectedNorm = norm(PACK.text)
  const chunks = chunkBidText(SUBSET.bid_text)
  const uncovered = chunks.filter((c) => !R.covered_chapters.includes(c.chapter_ref))
  const covered = chunks.filter((c) => R.covered_chapters.includes(c.chapter_ref))

  it("未覆盖章的代表性片段不出现在注入素材里，但确实存在于原文（断言非空转）", () => {
    expect(uncovered.length).toBeGreaterThan(0)
    const snippet = norm(uncovered[0].text).slice(40, 120)
    expect(snippet.length).toBeGreaterThan(30)
    expect(norm(SUBSET.bid_text)).toContain(snippet)
    expect(injectedNorm).not.toContain(snippet)
  })

  it("覆盖章的片段确实注入了，且带来源标头（模型能对号入座）", () => {
    expect(covered.length).toBeGreaterThan(0)
    const snippet = norm(covered[0].text).slice(0, 60)
    expect(snippet.length).toBeGreaterThan(20)
    expect(injectedNorm).toContain(snippet)
    expect(PACK.text).toContain("【投标签片段 1/")
    expect(PACK.text).toContain("来源：")
  })
})

describe("R50b §3 真实召回率基线（检索有损 → 降级链路必需）", () => {
  it("命中率有下限（防劣化），且不可能是 100%——否则降级链路就没存在意义", () => {
    expect(R.clause_total).toBe(RECORDED.clauseTotal)
    expect(R.clause_hit).toBeGreaterThanOrEqual(RECORDED.hitFloor)
    expect(R.clause_hit).toBeLessThan(R.clause_total)
    expect(R.clause_hit + INVISIBLE.length).toBe(R.clause_total)
  })

  it("命中条款必带来源片段；未命中条款的来源为空、且被写进说明块逐条点名", () => {
    expect(PACK.clauses.filter((c) => c.hit).every((c) => c.sources.length > 0)).toBe(true)
    expect(MISSED.every((c) => c.sources.length === 0)).toBe(true)
    expect(INVISIBLE.every((ref) => PACK.note.includes(ref))).toBe(true)
  })

  it("真实长文被跳过的是整章而不是几行：未覆盖章 ≥ 10 章（全量更差，见 §7）", () => {
    const uncoveredChapters = ALL_CHAPTERS.filter((c) => !R.covered_chapters.includes(c))
    expect(uncoveredChapters.length).toBeGreaterThanOrEqual(10)
  })
})

describe("R50b §4 旧口径对照：静默截断（clipText + 自称完整）不得回归", () => {
  const oldText = clipText(SUBSET.bid_text, MAX_BID_CHARS)
  const oldPack = selectBidEvidence(oldText, asClauses(SUBSET).map((c) => ({ id: c.id, text: c.text })))
  const oldChapters = chapterRefs(oldText)

  it("旧路径把截断后的 1.2 万字当「输入完整」——这正是本轮要消灭的病", () => {
    expect(oldText.length).toBeGreaterThan(MAX_BID_CHARS) // 尾部还留着「后文因篇幅截断」标记
    expect(oldPack.report.mode).toBe("full")
    expect(oldPack.report.input_complete).toBe(true)
    expect(oldPack.report.omitted_chars).toBe(0)
    expect(oldPack.report.clause_hit).toBe(oldPack.report.clause_total)
  })

  it("新路径覆盖的章严格多于旧路径，且输入字数更接近真实全文", () => {
    expect(oldChapters.length).toBeLessThan(R.covered_chapters.length)
    expect(oldPack.report.input_chars).toBeLessThan(R.input_chars)
    expect(oldPack.report.input_chars).toBeLessThan(oldText.length + 1)
  })

  it("旧口径只看到开头 3 章：被它跳过的整章，新路径能按条款检索捞回来", () => {
    const beyondOld = R.covered_chapters.filter((c) => !oldChapters.includes(c))
    expect(beyondOld.length).toBeGreaterThan(0)
    const ch = chunkBidText(SUBSET.bid_text).find((c) => c.chapter_ref === beyondOld[0])
    expect(ch).toBeTruthy()
    expect(norm(ch!.text).slice(0, 60).length).toBeGreaterThan(20)
    expect(norm(PACK.text)).toContain(norm(ch!.text).slice(0, 60))
    // 反向：旧路径的 3 章全部在原文里，只是它把 4.7 万字当成 1.2 万字用
    expect(ALL_CHAPTERS.length).toBeGreaterThan(oldChapters.length)
  })
})

describe("R50b §5 端到端降级链路：真实 133 条款 → 偏离表 → 交卷体检 → 导出", () => {
  const rows = E2E.table.rows
  const stats = deviationStats(E2E.table)
  const hits = deviationCommitHits(E2E.table)
  const undercommit = hits.filter((h) => h.rule === "deviation_undercommit")
  const invisibleHits = hits.filter((h) => h.rule === "deviation_invisible_review")

  it("模型漏答的条款一律 partial + 待人工核对，绝不再冒充负偏离", () => {
    const missedRows = rows.filter((r) => INVISIBLE_SET.has(r.clause_id))
    expect(missedRows.length).toBe(INVISIBLE.length)
    expect(missedRows.every((r) => r.response_level === "partial")).toBe(true)
    expect(missedRows.every((r) => r.needs_review === true)).toBe(true)
    expect(missedRows.every((r) => (r.response_summary ?? "").trim().length > 0)).toBe(true)
  })

  it("可见条款不被误标待核对；历史「偏离」只保留在可见条款上", () => {
    const visibleRows = rows.filter((r) => !INVISIBLE_SET.has(r.clause_id))
    expect(visibleRows.every((r) => r.needs_review !== true)).toBe(true)
    expect(stats.deviation).toBe(E2E.visibleDeviation)
    expect(E2E.visibleDeviation).toBe(RECORDED.subsetVisibleDeviation)
  })

  it("脱离证据的负偏离被真实消掉：旧口径 82 条偏离 → 本次只 29 条（均有可见证据）", () => {
    expect(stats.total).toBe(RECORDED.clauseTotal)
    expect(stats.needs_review).toBe(RECORDED.subsetInvisible)
    expect(stats.deviation).toBeLessThan(RECORDED.legacyDeviation)
    expect(stats.deviation + stats.partial + stats.full).toBe(stats.total)
  })

  it("负偏离（废标级规则）必须真的进体检，不被「待核对」洪峰挤掉", () => {
    expect(undercommit.length).toBe(Math.min(stats.deviation, RECORDED.ruleCap))
    expect(undercommit.some((h) => GATE_FATAL_RULES.has(h.rule))).toBe(true)
    expect(undercommit.every((h) => h.level === "warn")).toBe(true)
  })

  it("「本次不可见」单列一类上报，条数受独立上限约束（与负偏离各 30 条）", () => {
    expect(invisibleHits.length).toBe(Math.min(INVISIBLE.length, RECORDED.ruleCap))
    expect(GATE_FATAL_RULES.has("deviation_invisible_review")).toBe(false)
    expect(invisibleHits.every((h) => h.level === "warn" && h.quote.includes("没有可见证据"))).toBe(true)
    expect(hits.every((h) => h.rule === "deviation_undercommit" || h.rule === "deviation_invisible_review")).toBe(true)
  })

  it("导出：待核对行一律落到对外口径，内部过程话术一个字都不外泄", () => {
    const exported = rows.map(deviationExportSummary)
    expect(exported.filter((s) => DEVIATION_REVIEW_INTERNAL_NOTES.includes(s))).toEqual([])
    const pending = rows.filter((r) => r.needs_review === true)
    expect(pending.length).toBe(RECORDED.subsetInvisible)
    expect(pending.every((r) => deviationExportSummary(r) === DEVIATION_REVIEW_EXPORT_SUMMARY)).toBe(true)
    expect(exported.filter((s) => s.length > 0).length).toBe(rows.length)
  })
})

describe("R50b §6 证据包真的进到偏离表提示词（真实数据）", () => {
  const messages = buildDeviationMapMessages(asClauses(SUBSET), [], PACK)
  const user = typeof messages[1]?.content === "string" ? messages[1].content : ""
  const item = (rows: DeviationRow[]) => rows[0]

  it("user 消息含可见性说明块与真实正文片段，且不含未注入章的原片段", () => {
    expect(user).toContain("输入完整：否")
    expect(user).toContain("【投标文件正文")
    expect(user).toContain("来源：第")
    const uncovered = chunkBidText(SUBSET.bid_text).find((c) => !R.covered_chapters.includes(c.chapter_ref))
    expect(uncovered).toBeTruthy()
    expect(norm(user)).not.toContain(norm(uncovered!.text).slice(40, 120))
  })

  it("素材段与 bidEvidenceBlock 逐字同源（三份提示词共用同一拼装口径）", () => {
    expect(user).toContain(bidEvidenceBlock(PACK, "投标文件正文（按条款定向检索注入的片段）"))
  })

  it("占位行守卫：空证据包也给出显式占位，避免被读成「文件里没写」", () => {
    const empty: BidEvidencePack = { report: R, text: "", note: "", clauses: [] }
    expect(bidEvidenceBlock(empty)).toContain("本次无可注入的投标文件正文")
    expect(item(E2E.table.rows)).toBeTruthy()
  })
})

describe.skipIf(!existsSync(FULL_PATH))("R50b §7 全量真实标书（139k 字，本机 .probe/ 夹具，不入库）", () => {
  const f = existsSync(FULL_PATH) ? readFixture(FULL_PATH) : SUBSET
  const e2e = buildEndToEnd(f)

  it("全量更长 → 命中率更差，但「不谎称完整」的行为不变", () => {
    expect(f.bid_text.length).toBeGreaterThan(100000)
    expect(e2e.pack.report.mode).toBe("retrieval")
    expect(e2e.pack.report.input_complete).toBe(false)
    // 2026-10-20 召回修复后实测 50/133（修复前 13/133）；下限随之上调，低于 40 视为回归
    expect(e2e.pack.report.clause_hit).toBeGreaterThanOrEqual(40)
    expect(e2e.pack.report.clause_hit).toBeLessThan(e2e.pack.report.clause_total)
    expect(e2e.pack.report.input_chars - e2e.pack.report.omitted_chars).toBeLessThanOrEqual(BID_VISIBILITY_BUDGET_CHARS)
  })

  // 2026-10-20 更新：召回修复后全量待核对从 119 降到 83（83/133 = 62%）。仍是大头，
  // 「预算 ÷ 正文长度」这个瓶颈没被消除（见 backlog B25），所以本条继续盯住它，只是把阈值
  // 从「>100」下调到「>80」——按文件头原则，检索变好时基线应上调/阈值随实测收紧，不是改绿。
  it("全量下多数条款仍落入「待人工核对」——长文检索召回是当前最大待办", () => {
    const stats = deviationStats(e2e.table)
    expect(stats.needs_review).toBeGreaterThan(80)
    expect(stats.deviation).toBe(e2e.visibleDeviation)
    expect(stats.deviation).toBeLessThan(stats.needs_review)
    const hits = deviationCommitHits(e2e.table)
    expect(hits.filter((h) => h.rule === "deviation_undercommit").length).toBe(Math.min(stats.deviation, 30))
  })
})

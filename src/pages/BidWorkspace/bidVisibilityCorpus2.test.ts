// R63 · 第二份真实语料（结构对照样本）：长文选块召回率不再只在安中医一份标书上验证
//
// 为什么需要这个文件：B25 的待办里明确写着「必须补第二份不同结构（如纯条款清单型）标书作对照样本」——
// 只在同一份语料上调参、再在同一份语料上报数字，无法区分「算法变好」与「对这份语料过拟合」。
//
// 语料来源：本地 PocketBase 项目 `n6l21cok5x688tg`（建阳区总医院 · 设备及信息化建设 / 集成平台 + 接口对接），
// 由 R63 的临时脚本按**生产同一条链路**导出：投标正文走 chaptersToText 口径，条款走
// `resolveDeviationClauses(tender_text, parse_report, { limit: 200, granularity: "l3" })`。
// 结构与安中医明显不同：45 个章节 / 184 条条款 / 13.2 万字（安中医是 18 章 / 133 条 / 13.9 万字）。
//
// 与 §7 全量夹具同样的取舍：**含真实院名，只存本机 `.probe/corpus2/jianyang.json`，不入库**；
// 库/夹具不存在时整块 skip（新克隆、CI 上不该因此变红）。只断言不变量与下限，不把某次测量的
// 命中率写死成精确值——检索变好时按「下限上调」处理，不是改绿。
//
// 复跑：node node_modules/vitest/vitest.mjs run src/pages/BidWorkspace/bidVisibilityCorpus2.test.ts
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { BID_VISIBILITY_BUDGET_CHARS, chunkBidText, selectBidEvidence } from "./bidVisibility"

type Corpus = {
  meta: { chapter_count: number; bid_chars: number; clause_count: number; clause_how: string }
  bid_text: string
  clauses: { id: string; text: string; source: string }[]
}

const DIR = path.dirname(fileURLToPath(import.meta.url))
const CORPUS2 = path.join(DIR, "..", "..", "..", ".probe", "corpus2", "jianyang.json")

/** R63 实测记录（旧选块 → 新选块，同一语料同一预算）：命中 115/184 → 171/184；未命中 69 → 13；
 *  覆盖章 7/34 → 10/34。下限取 160（留出调参余量，低于即视为回归）。 */
const RECORDED = {
  clauseTotal: 184,
  oldHit: 115,
  newHit: 171,
  hitFloor: 160,
  uncoveredChapters: 24, // 34 章里覆盖 10 章 → 未覆盖 24；只许变少
}

describe.skipIf(!existsSync(CORPUS2))("R63 第二份真实语料（建阳总医院，结构对照）", () => {
  const f = JSON.parse(readFileSync(CORPUS2, "utf8")) as Corpus
  const pack = selectBidEvidence(
    f.bid_text,
    f.clauses.map((c) => ({ id: c.id, text: c.text })),
  )
  const r = pack.report
  const allChapters = [...new Set(chunkBidText(f.bid_text).map((c) => c.chapter_ref))]

  it("确实是一份结构不同的样本（否则本文件的对照意义不成立）", () => {
    expect(f.meta.chapter_count).toBeGreaterThanOrEqual(30)
    expect(r.clause_total).toBe(RECORDED.clauseTotal)
    expect(f.meta.clause_how).not.toBe("none")
    expect(r.input_chars).toBeGreaterThan(100000)
  })

  it("超预算 → 检索模式且如实声明输入不完整（不得谎称全文）", () => {
    expect(r.mode).toBe("retrieval")
    expect(r.input_complete).toBe(false)
    expect(pack.note).toContain("输入完整：否")
    expect(pack.note).toContain("不得当作")
    expect(r.input_chars - r.omitted_chars).toBeLessThanOrEqual(BID_VISIBILITY_BUDGET_CHARS)
  })

  it("召回率下限：同一预算下不得低于 R63 之后的实测水位（旧选块 115 → 新选块 171）", () => {
    expect(r.clause_hit).toBeGreaterThanOrEqual(RECORDED.hitFloor)
    expect(r.clause_hit).toBeLessThan(r.clause_total) // 不可能是 100%，否则降级链路就没存在意义
    expect(r.clause_hit).toBeGreaterThan(RECORDED.oldHit)
  })

  it("未命中条款逐条点名、来源为空；命中条款必带来源", () => {
    const missed = pack.clauses.filter((c) => !c.hit)
    expect(missed.length).toBe(r.clause_total - r.clause_hit)
    expect(missed.every((c) => c.sources.length === 0)).toBe(true)
    expect(pack.clauses.filter((c) => c.hit).every((c) => c.sources.length > 0)).toBe(true)
    expect(missed.every((c) => pack.note.includes(c.ref))).toBe(true)
  })

  it("覆盖章数只许变多：未覆盖章不超过 R63 实测的 24 章", () => {
    const uncovered = allChapters.filter((c) => !r.covered_chapters.includes(c))
    expect(uncovered.length).toBeGreaterThan(0) // 不得空转
    expect(uncovered.length).toBeLessThanOrEqual(RECORDED.uncoveredChapters)
  })
})

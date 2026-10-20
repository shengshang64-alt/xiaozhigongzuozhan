// ---------------------------------------------------------------------------
// 真实库「输出质量」体检（只读、零 AI 费用；统计只打印，只断言不变量）
//
// 背景（2026-10-20 用户反馈）：生成的标书「AI 味太浓厚」，且「解析的评分办法与主观响应材料不全」。
// 这三条此前**只有主观感受、没有任何数字**——既判断不了严重程度，也无法验证改动是否有效。
//
// 与其它测试的区别（与 outlineGuardRealDb.test.ts 同一范式）：
//   · 读的是**真实用户数据**（pocketbase/pb_data/data.db），库不存在时整块 skip（CI/新克隆不变红）；
//   · 只断言**不变量**，不断言随时会变的统计数字——数据变了数字就变，测试不该因此变红；
//   · 统计结果只打印，供人抄进报告。
//
// 三个口径全部调用**生产模块**，不在这里重写第二份逻辑：
//   ① 配置：gen_options 三个开关——它们直接决定「素材进不进正文」（见 useBidWorkspace 的 boost 分支）
//   ② 段落/句子长度分布 + AI 套话密度。段落切分走 bidProseLinter.splitParagraphs（**已 export**），
//      为的是与 bidProseLinter.ts 头部那张基准表**同口径**可比：
//        真实交付《售后服务方案》段落中位 81.5 字 / 85 分位 193 / 超 300 字占 0.7%
//        同仓实测 AI 稿段落中位 272 字 / 超 300 字占 37%
//      ⚠️ 套话词命中数**不是**病根（bidProseLinter.ts:145 已用 45.1 万字实测证明：
//         30+ 条禁词表全篇只命中 29 处）。它在这里只作对照，别拿它当主要指标。
//   ③ 评分办法完整性：scoreItemsScan.crossCheckScores 的 missingInReport
//      —— 它扫的是**招标原文**，是三条线索里唯一的**独立证据**；其余两个数
//         （条目合计 vs 声明总分）都是 AI 摘出来的，互相自证，证明不了漏没漏。
//      ⚠️ 但它的匹配判据是**子串包含**（scoreItemsScan.ts:387 nameSimilar），
//         措辞不同即判「漏」。所以 missingInReport 是**上限**、不是实测漏抽数：
//         要判断真假，必须人工拿一个项目把原文评分表和解析报告并排核对。
//
// 用法：
//   npx vitest run src/pages/BidWorkspace/qualityAuditRealDb.test.ts
//   XZ_AUDIT_PROJECT=安中医 npx vitest run src/pages/BidWorkspace/qualityAuditRealDb.test.ts
//     ↑ 只统计项目名含该子串的项目。**A/B 对比就靠它**：同一项目改配置前跑一次、重生成后再跑一次，
//       比 ② 的段落中位/超 300 占比。注意默认是全库，别把过滤后的结果当成全库结论。
//   Windows cmd 里设环境变量：set XZ_AUDIT_PROJECT=安中医
// ---------------------------------------------------------------------------
import { existsSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { lintProse, splitParagraphs, splitSentences } from "./bidProseLinter"
import { crossCheckScores } from "./scoreItemsScan"
import { normalizeGenOptions, numberScoringItems, type GenOptions, type ParseReport } from "./bidTypes"

const DB = new URL("../../../pocketbase/pb_data/data.db", import.meta.url)

/**
 * 单测超时：vitest 默认 5s，而这个体检要遍历**所有项目的全部章节正文**
 * （真实库成稿正文合计可达数百万字）。显式给足，否则失败原因是超时而不是逻辑错——那种红最难分辨。
 */
const AUDIT_TIMEOUT_MS = 300_000

/** 项目名子串过滤（空 = 全库）。见文件头「用法」。 */
const FILTER = (process.env.XZ_AUDIT_PROJECT ?? "").trim()

/**
 * 基准值（bidProseLinter.ts 头部表的转录，来源：真实交付并中标的《售后服务方案》28,177 字 / 286 段，
 * 以及同仓实测的一份 45.1 万字 AI 生成稿）。抄在这里是为了让体检直接打印"离基准多远"。
 */
const BENCH = {
  paraMedianReal: 81.5,
  paraP85Real: 193,
  paraMaxReal: 318,
  over300Real: 0.007,
  sentMedianReal: 45,
  sentP85Real: 79,
  paraMedianAi: 272,
  over300Ai: 0.37,
}

type Row = {
  id: string
  project_name: string | null
  stage: string | null
  archived: number | null
  tender_text: string | null
  parse_report: string | null
  bid_chapters: string | null
  gen_options: string | null
}

function loadRows(): Row[] {
  // Windows 下 URL.pathname 带前导斜杠且中文会百分号编码，必须走 fileURLToPath
  const db = new DatabaseSync(fileURLToPath(DB), { readOnly: true })
  try {
    return db
      .prepare(
        `select id, project_name, stage, archived, tender_text, parse_report, bid_chapters, gen_options
         from bid_projects order by length(coalesce(tender_text,'')) desc`,
      )
      .all() as Row[]
  } finally {
    db.close()
  }
}

/** 全库行 + 过滤；过滤生效时打印一行提醒，避免把过滤结果误当全库结论 */
function auditRows(): Row[] {
  const all = loadRows()
  if (!FILTER) return all
  const hit = all.filter((r) => (r.project_name ?? "").includes(FILTER))
  console.log(`\n[过滤生效] XZ_AUDIT_PROJECT="${FILTER}" → ${hit.length}/${all.length} 个项目（以下统计仅覆盖这些项目）`)
  return hit
}

function parseJson(raw: string | null): unknown {
  try {
    return JSON.parse(raw ?? "null")
  } catch {
    return null
  }
}

function parseReport(raw: string | null): ParseReport | null {
  const v = parseJson(raw)
  return v && typeof v === "object" ? (v as ParseReport) : null
}

type ChapterLike = { title?: string; content?: string; node_id?: string; children?: ChapterLike[] }

/** 章节归一：历史上出现过「平铺」与「带 children 嵌套」两种形态，两种都塌平 */
function flattenChapters(raw: string | null): ChapterLike[] {
  const parsed = parseJson(raw)
  if (!Array.isArray(parsed)) return []
  const out: ChapterLike[] = []
  const walk = (nodes: unknown[]): void => {
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue
      const c = n as ChapterLike
      out.push(c)
      if (Array.isArray(c.children)) walk(c.children)
    }
  }
  walk(parsed)
  return out
}

const hasBody = (s: string | null | undefined): boolean => /\S/.test(s ?? "")
const label = (r: Row): string =>
  `${(r.project_name ?? "未命名").slice(0, 22)}${r.archived ? "（已归档）" : ""}`

/** 升序数组的 p 分位（p 取 0-100；空数组返回 0）。与基准表同法：先排序再取位。 */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))
  return sorted[idx]
}

describe.skipIf(!existsSync(DB))("输出质量体检（真实库只读）", () => {
  it("① 生成配置：三个开关的实际分布（它们决定素材进不进正文）", () => {
    const rows = auditRows()
    expect(rows.length).toBeGreaterThan(0)

    let boost = 0
    let clause = 0
    let demo = 0
    let withTender = 0
    const modeCount: Record<string, number> = {}
    const noBoostWithTender: string[] = []

    for (const r of rows) {
      const gen: GenOptions = normalizeGenOptions(parseJson(r.gen_options))
      const hasTender = hasBody(r.tender_text)
      if (hasTender) withTender += 1
      if (gen.material_boost === true) boost += 1
      else if (hasTender) noBoostWithTender.push(label(r))
      if (gen.clause_response === true) clause += 1
      if (gen.generate_demo === true) demo += 1
      const mode = String(gen.compliance_mode ?? "(空)")
      modeCount[mode] = (modeCount[mode] ?? 0) + 1
    }

    console.log(`\n[① 生成配置] 共 ${rows.length} 个项目，其中 ${withTender} 个有招标原文`)
    console.log(`  素材优先注入 material_boost 开启：${boost}/${withTender}  （关闭 ⇒ 知识库一个字都不进正文；开启还会把招标原文片段预算 4000→8000 字、12→24 段）`)
    console.log(`  逐条应答强化 clause_response 开启：${clause}/${withTender}  （关闭 ⇒ ★/▲ 条款块不进正文）`)
    console.log(`  演示分节点 generate_demo 开启：${demo}`)
    console.log(`  写作模式：${Object.entries(modeCount).map(([k, v]) => `${k}=${v}`).join("  ")}`)
    if (noBoostWithTender.length) {
      console.log(`  ⚠ 有原文但未开素材注入（${noBoostWithTender.length} 个）：${noBoostWithTender.slice(0, 8).join("、")}${noBoostWithTender.length > 8 ? " 等" : ""}`)
    }

    // 不变量：开关计数不可能超过项目总数；模式计数之和必须等于总数
    expect(boost).toBeLessThanOrEqual(rows.length)
    expect(clause).toBeLessThanOrEqual(rows.length)
    expect(Object.values(modeCount).reduce((a, b) => a + b, 0)).toBe(rows.length)
  }, AUDIT_TIMEOUT_MS)

  it("② 段落/句子长度分布（对齐基准表）+ AI 套话密度对照", () => {
    const rows = auditRows()
    const perProject: {
      name: string
      chars: number
      paraCount: number
      paraMedian: number
      paraP85: number
      paraMax: number
      over300: number
      sentMedian: number
      sentP85: number
      cliche: number
    }[] = []

    for (const r of rows) {
      const paraLens: number[] = []
      const sentLens: number[] = []
      let chars = 0
      let cliche = 0
      for (const c of flattenChapters(r.bid_chapters)) {
        if (!hasBody(c.content)) continue
        const text = c.content ?? ""
        chars += text.length
        // 段落切分复用 linter 的 splitParagraphs（每行一段、跳过表格行）——口径与基准表一致
        for (const p of splitParagraphs(text)) {
          paraLens.push(p.text.length)
          for (const s of splitSentences(p.text)) sentLens.push(s.length)
        }
        // maxHits 只截断 hits；stats.rawCounts 是未截断的真实量，密度必须用它
        cliche += lintProse(text, c.title ?? "").stats.rawCounts.ai_cliche
      }
      if (!paraLens.length) continue
      const ps = [...paraLens].sort((a, b) => a - b)
      const ss = [...sentLens].sort((a, b) => a - b)
      perProject.push({
        name: label(r),
        chars,
        paraCount: ps.length,
        paraMedian: percentile(ps, 50),
        paraP85: percentile(ps, 85),
        paraMax: ps[ps.length - 1],
        over300: ps.filter((n) => n > 300).length / ps.length,
        sentMedian: percentile(ss, 50),
        sentP85: percentile(ss, 85),
        cliche,
      })
    }

    perProject.sort((a, b) => b.over300 - a.over300)
    const totChars = perProject.reduce((a, p) => a + p.chars, 0)
    const totCliche = perProject.reduce((a, p) => a + p.cliche, 0)
    const allPara = perProject.map((p) => p.paraMedian).sort((a, b) => a - b)

    console.log(`\n[② 段落/句子长度] ${perProject.length} 个项目有成稿正文，共 ${totChars} 字`)
    console.log(`  基准对照（真实交付《售后服务方案》）：段落中位 ${BENCH.paraMedianReal} 字 / 85 分位 ${BENCH.paraP85Real} / 最长 ${BENCH.paraMaxReal} / 超 300 字占 ${(BENCH.over300Real * 100).toFixed(1)}%`)
    console.log(`  同仓实测 AI 稿：段落中位 ${BENCH.paraMedianAi} 字 / 超 300 字占 ${(BENCH.over300Ai * 100).toFixed(0)}%`)
    console.log(`  句子基准：真实交付中位 ${BENCH.sentMedianReal} 字 / 85 分位 ${BENCH.sentP85Real}（AI 稿与真实件只差 1.27 倍，故句子不是主要矛盾）`)
    console.log(`  本次各项目中位数之中位：${percentile(allPara, 50)} 字`)
    console.log("  超 300 字占比最高的 10 个项目（超300占比 · 段落中位 · 85分位 · 最长 · 段数 · 句中位 · 套话 · 字数）：")
    for (const p of perProject.slice(0, 10)) {
      console.log(
        `    ${p.name.padEnd(24)} ${(p.over300 * 100).toFixed(1).padStart(5)}%  ${String(p.paraMedian).padStart(4)}  ${String(p.paraP85).padStart(4)}  ${String(p.paraMax).padStart(4)}  ${String(p.paraCount).padStart(5)}  ${String(p.sentMedian).padStart(4)}  ${String(p.cliche).padStart(4)}  ${String(p.chars).padStart(7)}`,
      )
    }
    console.log(`  AI 套话对照：未截断命中合计 ${totCliche} 处 ⇒ ${totChars ? ((totCliche * 1000) / totChars).toFixed(2) : "0"} 处/千字`)
    console.log(`  （套话不是病根：bidProseLinter.ts:145 实测 45.1 万字只命中 29 处。主要指标看「超 300 字占比」与「段落中位」。）`)

    // 不变量：分位单调、占比在 [0,1]、段数等于各长度计数
    expect(perProject.every((p) => p.paraMedian <= p.paraP85 && p.paraP85 <= p.paraMax)).toBe(true)
    expect(perProject.every((p) => p.over300 >= 0 && p.over300 <= 1)).toBe(true)
    expect(perProject.every((p) => p.sentMedian <= p.sentP85)).toBe(true)
    expect(perProject.every((p) => p.cliche <= p.chars)).toBe(true)
  }, AUDIT_TIMEOUT_MS)

  it("③ 评分办法完整性：招标原文扫描 vs 解析报告（上限值，非实测漏抽数）", () => {
    const rows = auditRows()
    const perProject: {
      name: string
      scanned: number
      parsed: number
      missing: number
      extra: number
      sumParsed: number
      declared: number | null
      numbered: number
    }[] = []

    for (const r of rows) {
      const report = parseReport(r.parse_report)
      const tender = r.tender_text ?? ""
      if (!report || !hasBody(tender)) continue
      const cc = crossCheckScores(tender, report)
      perProject.push({
        name: label(r),
        scanned: cc.scanned.length,
        parsed: cc.parsed.length,
        missing: cc.missingInReport.length,
        extra: cc.extraInReport.length,
        sumParsed: cc.sumOfParsed,
        declared: cc.total.value,
        numbered: numberScoringItems(report).length,
      })
    }

    perProject.sort((a, b) => b.missing - a.missing)
    const totalScanned = perProject.reduce((a, p) => a + p.scanned, 0)
    const totalMissing = perProject.reduce((a, p) => a + p.missing, 0)

    console.log(`\n[③ 评分办法完整性] ${perProject.length} 个项目可比对（有原文 + 有解析报告）`)
    console.log(`  原文扫描到评分项合计 ${totalScanned} 条；其中「原文有、报告里没有」合计 ${totalMissing} 条`)
    console.log(`  ⚠ 匹配判据是子串包含（scoreItemsScan.ts:387），措辞不同即判「漏」——这是**上限**，不是实测漏抽数。`)
    console.log(`  ⚠ 判真假只需一个动作：挑一个项目把原文评分表与解析报告并排人工核对。`)
    console.log("  疑似漏抽最多的 8 个项目（原文条数 · 报告条数 · 漏 · 多出 · 合计分 · 声明总分 · 结构化项数）：")
    for (const p of perProject.slice(0, 8)) {
      console.log(
        `    ${p.name.padEnd(24)} ${String(p.scanned).padStart(4)}  ${String(p.parsed).padStart(4)}  ${String(p.missing).padStart(3)}  ${String(p.extra).padStart(3)}  ${String(p.sumParsed).padStart(6)}  ${p.declared === null ? "    —" : String(p.declared).padStart(5)}  ${String(p.numbered).padStart(4)}`,
      )
    }
    const zeroMissing = perProject.filter((p) => p.missing === 0).length
    console.log(`  ${zeroMissing}/${perProject.length} 个项目未发现漏抽（扫描器是启发式的，无匹配≠一定没有）`)
    console.log(`  参考：安中医原文 31 行 / 报告 14 项 / 合计 100 分 / 声明总分 100 —— 总数相等而项数差一倍，更像「合并成粗项」而非「丢项」。`)

    // 不变量：missingInReport ⊆ scanned、extraInReport ⊆ parsed（两集合各自由差集定义而来）
    expect(perProject.every((p) => p.missing <= p.scanned && p.missing >= 0)).toBe(true)
    expect(perProject.every((p) => p.extra <= p.parsed && p.extra >= 0)).toBe(true)
  }, AUDIT_TIMEOUT_MS)
})

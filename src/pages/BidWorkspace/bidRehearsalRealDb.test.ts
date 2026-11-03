// ---------------------------------------------------------------------------
// 真实标书「解析 → 大纲」离线演练（只读、零 AI；库不存在时整块 skip）
//
// 为什么要有它：大纲生成这一步必须调模型，模型调用只能在用户机器上跑；
// 但**模型之外的部分**（提示词组装、评分项对齐、子系统覆盖、目录落点、解析侧告警）
// 全都能拿真实项目离线复算。改完代码有没有效，先看这里，再看模型输出。
//
// 用法（A/B 对比就靠它：重生成大纲前后各跑一次，比「子系统覆盖 X/Y」）：
//   npx vitest run src/pages/BidWorkspace/bidRehearsalRealDb.test.ts
//   XZ_BID_PROJECT=<项目id> npx vitest run src/pages/BidWorkspace/bidRehearsalRealDb.test.ts
//   XZ_BID_PROMPT_PROJECT=<还没生成大纲的项目id> npx vitest run ...   # 校验提示词里带没带子系统清单
//
// 口径与 qualityAuditRealDb.test.ts 一致：**只断言不变量，统计只打印**——
// 数据一变数字就变，测试不该因此变红。
// ---------------------------------------------------------------------------
import { copyFileSync, existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { buildOutlineLevel1Messages } from "./prompts/outlineLevel1"
import {
  numberScoringItems,
  outlineChapterScoringAlignment,
  sectionText,
  subsystemCoverage,
  validateScoringSections,
  type ParseReport,
} from "./bidTypes"
import { buildCatalogIndex } from "./composeGates"
import { voidClauseFloorWarning } from "./voidClauseFloor"
import { coveragePercent, parseCoverageRatio } from "./parseCoverage"
import type { OutlineNode } from "../SolutionStudio/solutionTypes"
import { hasRealParseReport } from "./realDbFixture"

const DB = new URL("../../../pocketbase/pb_data/data.db", import.meta.url)
const DB_PATH = fileURLToPath(DB)

/**
 * 只读打开真实库。
 *
 * 为什么不直接开：PB 运行时在挂载点上是 WAL + 文件锁，直接 `new DatabaseSync(path,{readOnly})`
 * 在某些环境（本仓沙盒实测）会在 prepare 时抛 `disk I/O error`，测试变成环境性假红。
 * 先试直连；失败则把 data.db(+wal/shm) 复制到临时目录再开——只读、不动原库。
 */
let cachedDb: DatabaseSync | null = null
function openRealDb(): DatabaseSync {
  if (cachedDb) return cachedDb
  try {
    const direct = new DatabaseSync(DB_PATH, { readOnly: true })
    direct.prepare("select 1 from bid_projects limit 1").get()
    cachedDb = direct
    return direct
  } catch {
    const dir = mkdtempSync(join(tmpdir(), "bid-rehearsal-"))
    const copy = join(dir, "data.db")
    copyFileSync(DB_PATH, copy)
    for (const ext of ["-wal", "-shm"]) {
      if (existsSync(DB_PATH + ext)) copyFileSync(DB_PATH + ext, copy + ext)
    }
    cachedDb = new DatabaseSync(copy, { readOnly: true })
    return cachedDb
  }
}

type Row = { project_name: string; hospital: string; tender_text: string; parse_report: string; bid_outline: string }

function load(id: string): { name: string; hospital: string; tender: string; parse: ParseReport; outline: OutlineNode[] } | null {
  const db = openRealDb()
  const r = db.prepare("select project_name,hospital,tender_text,parse_report,bid_outline from bid_projects where id=?").get(id) as
    | Row
    | undefined
  if (!r?.parse_report) return null
  let parse: ParseReport
  try {
    parse = JSON.parse(r.parse_report) as ParseReport
  } catch {
    return null
  }
  let outline: OutlineNode[] = []
  try {
    outline = r.bid_outline ? (JSON.parse(r.bid_outline) as OutlineNode[]) : []
  } catch {
    /* 大纲损坏按空处理（演练只打印，不据此断言） */
  }
  return { name: r.project_name ?? "", hospital: r.hospital ?? "", tender: r.tender_text ?? "", parse, outline }
}

/** 全库最新一个「有解析报告」的项目 id（没指定 XZ_BID_PROJECT 时用它） */
function latestWithParse(): string | null {
  const db = openRealDb()
  const r = db
    .prepare("select id from bid_projects where parse_report is not null and length(parse_report) > 10 order by updated desc limit 1")
    .get() as { id: string } | undefined
  return r?.id ?? null
}

describe.skipIf(!hasRealParseReport())("真实标书演练：解析 ↔ 大纲（只读、零 AI）", () => {
  it("① 提示词里真的带上了采购需求子系统与招标目录（B4/第二批修复的落点）", () => {
    const id = process.env.XZ_BID_PROMPT_PROJECT || latestWithParse()
    expect(id).toBeTruthy()
    const p = load(id!)
    expect(p).toBeTruthy()
    const msgs = buildOutlineLevel1Messages(p!.name, p!.hospital, p!.parse, { techChapterHint: 8, scope: "tech" })
    const all = msgs.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n")
    const sysLines = sectionText(p!.parse, "req_structure").split(/\r?\n/).filter((l) => l.trim())
    console.log(`[演练①] ${id} 提示词 ${all.length} 字；子系统 ${sysLines.length} 条`)
    console.log(`[演练①] 含子系统清单块: ${all.includes("采购需求子系统清单")}；含首个系统「${sysLines[0] ?? "-"}」: ${sysLines[0] ? all.includes(sysLines[0]) : "n/a"}`)
    // 不变量：有子系统清单时，提示词必须带上它（否则分步路径又退回「只按评分项成章」）
    if (sysLines.length) {
      expect(all).toContain("采购需求子系统清单")
      expect(all).toContain(sysLines[0])
    }
  })

  it("② 已有大纲：评分项对齐 / 子系统覆盖 / 目录落点的真实读数", () => {
    const id = process.env.XZ_BID_PROJECT || latestWithParse()
    const p = load(id!)
    if (!p || !p.outline.length) {
      console.log(`[演练②] ${id} 还没有大纲，跳过（先点一次「生成大纲」再来对比）`)
      return
    }
    const items = numberScoringItems(p.parse)
    const align = outlineChapterScoringAlignment(p.outline, items)
    const subs = subsystemCoverage(p.parse, p.outline)
    const catalog = buildCatalogIndex(p.parse, p.outline, { scope: "tech" })
    const catMiss = catalog.filter((r) => !r.found)
    console.log(`[演练②] ${id} 顶层技术章 ${align.techChapterCount} / 技术评分项 ${align.techItemCount}`)
    console.log(`[演练②] 合并章 ${align.mergedChapters.length} 处；无章承接 ${align.itemsWithoutChapter.length} 项`)
    console.log(`[演练②] 子系统覆盖 ${subs.coveredCount}/${subs.total}`)
    if (subs.missing.length) console.log(`[演练②] 未覆盖（前 10）：${subs.missing.slice(0, 10).join("、")}`)
    console.log(`[演练②] 目录项 ${catalog.length} 条，技术标缺 ${catMiss.length} 条：${catMiss.map((r) => r.item).join("、") || "无"}`)
    // 不变量：覆盖率不会超过总数；缺章清单不会比评分项还多
    expect(subs.coveredCount).toBeLessThanOrEqual(subs.total)
    expect(align.itemsWithoutChapter.length).toBeLessThanOrEqual(align.techItemCount)
  })

  it("③ 解析侧：评分分区合计与废标条数下限的误报是否已清掉", () => {
    const id = process.env.XZ_BID_PROJECT || latestWithParse()
    const p = load(id!)
    if (!p) return
    const v = validateScoringSections(p.parse)
    const voidTxt = sectionText(p.parse, "void_items")
    const voidWarn = voidClauseFloorWarning(voidTxt)
    const cov = parseCoverageRatio(p.parse.sections, p.tender)
    console.log(`[演练③] ${id} 覆盖率 ${coveragePercent(cov)}%；分区合计 ${JSON.stringify(v.sectionSums)}；废标条款 ${voidTxt.split(/\r?\n/).filter(Boolean).length} 行`)
    console.log(`[演练③] 评分口径告警 ${v.mismatchWarnings.length} 条；下限告警 ${voidWarn ?? "无"}`)
    // 不变量：有分区就必须有合计；有废标正文就不该再报「仅解析到 1~4 条」
    //
    // 2026-10-31 修正：原断言恒为「必须 > 0」，但项目可能是在**模型不可用期间**解析的——
    // 那时分区内容是降级占位文本（〔系统降级 · 关键词检索原文〕「技术评分要求」AI 解析未完成…），
    // 本来就没有可提取的评分数值，sectionSums 为空是**正确行为**。
    // 实测反例：id=ebxc598wu8bcvpd（【UI测试】中医院信息化项目）tech_score 正文即降级占位。
    // 改为：仅在「分区含真实评分内容」时才要求有合计。
    const allSectionText = p.parse.sections.map((s) => String(s.content ?? "")).join("\n")
    const isDegraded = /系统降级|AI 解析未完成/.test(allSectionText)
    if (!isDegraded) {
      expect(Object.keys(v.sectionSums).length).toBeGreaterThan(0)
    } else {
      console.log("[演练③] 该项目解析为降级占位态（模型不可用期间产生），跳过 sectionSums 断言")
    }
    if (voidTxt.trim() && voidTxt.split(/\r?\n/).filter(Boolean).length >= 5) expect(voidWarn).toBeNull()
  })
})

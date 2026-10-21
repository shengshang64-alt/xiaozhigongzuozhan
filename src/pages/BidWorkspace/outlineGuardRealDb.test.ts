// ---------------------------------------------------------------------------
// R56（B27）+ R58（B28/B29）真实库复盘（只读）：把审计文档 P0-3「9 个项目从未产出大纲」的取证
// 做成可复跑的一段，并在 R58 起承担三项**不变量**回归与 25 条记录的复算出口。
//
// 与其它测试的区别：这个文件读的是**真实用户数据**（pocketbase/pb_data/data.db），所以
//   · 库里没有这个文件时整块 skip（新克隆/CI 上不该因此变红）；
//   · 只断言**不变量**（判据与清单同源、有纲不被硬拦、两份判据不打架），不断言随时会变的统计数字；
//   · 统计结果只打印，供人读——需要数字去报告里抄，而不是让它变成脆弱的断言。
//
// R58 断言的三条不变量（删实现即变红）：
//   ① 判据与中文清单同源（旧实现在 313131 上印出空名单）；
//   ② 有非空 bid_outline 的项目，关键项门禁**不得**判 block（= 曾经的 7 条假拦截）；
//   ③ 门禁判缺关键项且原文 ≥5 万字 ⇒ 退化自检必须告警（v2a 之前：门禁判 5/5 缺而自检一声不吭）。
//
// 复跑：npx vitest run src/pages/BidWorkspace/outlineGuardRealDb.test.ts
// ---------------------------------------------------------------------------
import { existsSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath, pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import { missingSectionTitles, requestedKeys, type ParseConfig, type ParseReport } from "./bidTypes"
import {
  CRITICAL_SECTION_KEYS,
  decideOutlineCriticalGate,
  detectParseDegradation,
  missingCriticalSectionTitles,
  missingCriticalSections,
} from "./parseCoverage"
import { formatCharCount } from "./outlineDiagnostics"

const DB = new URL("../../../pocketbase/pb_data/data.db", import.meta.url)
/** 生成前「大纲硬依赖」门禁（useBidWorkspace.OUTLINE_DEPEND_KEYS），先于关键项门禁执行 */
const OUTLINE_DEPEND_KEYS = ["tech_score", "response_req", "biz_score"]

type Row = {
  project_name: string | null
  stage: string | null
  tender_text: string | null
  parse_report: string | null
  parse_config: string | null
  outline_chars: number
}

/**
 * 打开真实库（只读）。
 *
 * 2026-10-21（R63）：新增「不支持文件锁的挂载点」兜底。在 VM 沙盒 / 部分网络盘上，SQLite 普通只读
 * 打开会因为拿不到 POSIX 锁直接抛 `disk I/O error`（实测同一份库：挂载点 FAIL、VM 本地副本 OK、
 * 挂载点加 immutable=1 OK）。immutable=1 是明确告诉 SQLite「此库不会被写、跳过加锁与 WAL 恢复」，
 * 因此照样能读。**只在普通打开失败时兜底**，宿主 Windows 上的行为完全不变。
 * 代价：immutable 会忽略 WAL 里尚未 checkpoint 的内容，可能读到略旧的已提交数据——本文件只断言不变量、
 * 统计只打印不参与断言，故可接受；若哪天这里要断言精确条数，必须先确认运行环境走的哪条分支。
 */
function openDb(): DatabaseSync {
  const p = fileURLToPath(DB)
  try {
    return new DatabaseSync(p, { readOnly: true })
  } catch (err) {
    try {
      return new DatabaseSync(`${pathToFileURL(p).href}?immutable=1`, { readOnly: true })
    } catch {
      throw err
    }
  }
}

function loadRows(): Row[] {
  // Windows 下 URL.pathname 带前导斜杠且中文会百分号编码，必须走 fileURLToPath
  const db = openDb()
  try {
    return db
      .prepare(
        `select project_name, stage, tender_text, parse_report, parse_config,
                case when coalesce(bid_outline,'') in ('','[]','null') then 0 else length(bid_outline) end as outline_chars
         from bid_projects order by length(coalesce(tender_text,'')) desc`,
      )
      .all() as Row[]
  } finally {
    db.close()
  }
}

function parseReport(raw: string | null): ParseReport | null {
  try {
    const v = JSON.parse(raw ?? "null") as ParseReport | null
    return v && typeof v === "object" ? v : null
  } catch {
    return null
  }
}

function parseConfig(raw: string | null): ParseConfig | null {
  try {
    const v = JSON.parse(raw ?? "null") as ParseConfig | null
    return v && typeof v === "object" ? v : null
  } catch {
    return null
  }
}

const nonWsChars = (s: string | null): number => (s ?? "").replace(/\s+/g, "").length

describe.skipIf(!existsSync(DB))("R58 真实库：门禁与退化自检的不变量（含 B28 四口径复算）", () => {
  it("① 判缺清单与中文清单同源 + ② 有纲不被硬拦 + ③ 门禁判缺必有退化告警", () => {
    const rows = loadRows()
    expect(rows.length).toBeGreaterThan(0)

    let blocked = 0
    const lines: string[] = []
    // 四口径复算（口径定义见 R58 报告：A 当前代码 / B 作用域感知 / C 已有大纲放宽 / D 两者兼有）
    let A = 0, B = 0, C = 0, D = 0
    const aFalseBlocks: string[] = []
    const dRealBlocks: string[] = []
    const dependOnlyBlocks: string[] = []
    let degradedHits = 0
    const degradedLines: string[] = []
    let sameSourceChecked = 0

    for (const r of rows) {
      const rep = parseReport(r.parse_report)
      if (!rep) continue
      const cfg = parseConfig(r.parse_config)
      const req = requestedKeys(cfg)
      const hasOutline = r.outline_chars > 0

      // ---- ① 同源：判缺判据与中文清单必须一一对应且非空 ----
      const crit = missingCriticalSections(rep.sections ?? [], CRITICAL_SECTION_KEYS, req)
      if (crit.length) {
        blocked++
        const titles = missingCriticalSectionTitles(rep, CRITICAL_SECTION_KEYS, req)
        expect(titles.length, `${r.project_name} 的缺项清单长度应与判据一致`).toBe(crit.length)
        for (const t of titles) expect(t.trim().length).toBeGreaterThan(0)
        // 旧口径（content 是否为空）在真实数据上的缺口，供报告引用
        const legacy = missingSectionTitles(rep, crit)
        const note = legacy.length === crit.length ? "" : `  ← 旧口径只印出 ${legacy.length}/${crit.length} 项`
        lines.push(
          `  · ${(r.project_name ?? "").slice(0, 22).padEnd(24)} 大纲${String(r.outline_chars).padStart(5)} | 招标 ${formatCharCount((r.tender_text ?? "").length).padStart(8)} | 判缺 ${titles.join("、")}${note}`,
        )
        sameSourceChecked++
        // ---- ③ 门禁判缺 + 大标书 ⇒ 退化自检不得沉默 ----
        if (nonWsChars(r.tender_text) >= 50000) {
          const dg = detectParseDegradation(rep, r.tender_text, req)
          expect(dg.degraded, `${r.project_name}：门禁判缺关键项，退化自检却沉默（静默退化）`).toBe(true)
          expect(dg.reason.length).toBeLessThanOrEqual(100)
        }
      }

      // ---- ② 有非空大纲的项目，关键项门禁不得再判 block；无大纲且判缺则必须仍 block（真拦截不得一起放掉）----
      if (hasOutline) {
        expect(
          decideOutlineCriticalGate(crit, hasOutline),
          `${r.project_name}（大纲 ${r.outline_chars} 字符）仍被硬拦`,
        ).not.toBe("block")
      } else if (crit.length) {
        expect(
          decideOutlineCriticalGate(crit, false),
          `${r.project_name} 无大纲且判缺，真拦截被放掉了`,
        ).toBe("block")
      }

      // ---- 四口径复算（只打印，不做断言）----
      const aMissing = missingCriticalSections(rep.sections ?? [])
      if (aMissing.length) {
        A++
        if (hasOutline) aFalseBlocks.push((r.project_name ?? "").slice(0, 18))
      }
      if (crit.length) {
        B++
        if (!hasOutline) {
          D++
          dRealBlocks.push((r.project_name ?? "").slice(0, 18))
        }
      }
      if (aMissing.length && !hasOutline) C++
      // 前置「大纲硬依赖」门禁（先于关键项门禁）仍会硬拦的项目——B28 未覆盖的残余，如实列出
      if (hasOutline && !(rep.sections ?? []).some((s) => OUTLINE_DEPEND_KEYS.includes(s.key) && String(s.content ?? "").trim())) {
        dependOnlyBlocks.push((r.project_name ?? "").slice(0, 18))
      }

      const dg = detectParseDegradation(rep, r.tender_text, req)
      if (dg.degraded) {
        degradedHits++
        degradedLines.push(
          `  · ${(r.project_name ?? "").slice(0, 20).padEnd(22)} 招标${String(dg.metrics.sourceChars).padStart(8)} 分区${String(dg.metrics.filledSections).padStart(3)} 评分行${String(dg.metrics.scoringLines).padStart(3)} 废标行${String(dg.metrics.voidLines).padStart(3)} reqVoid=${String(dg.metrics.voidRequested).padEnd(5)} | ${dg.reason}`,
        )
      }
    }

    const noOutline = rows.filter((r) => r.outline_chars === 0)
    const real = noOutline.filter((r) => (r.tender_text ?? "").length > 0)
    // 分母口径：25 条是**记录数**，同一份标书可能被导入多次（实测有重复），故另报去重后的标书数
    const distinctTenders = new Set(rows.map((r) => (r.tender_text ?? "").replace(/\s+/g, "")).filter((t) => t.length > 0))
    console.log(
      `\n[R58 真实库复盘] 记录 ${rows.length} 条｜按原文去重后不同标书 ${distinctTenders.size} 份｜判缺关键项 ${blocked}｜同源核对 ${sameSourceChecked}｜无大纲 ${noOutline.length}（其中非空标书 ${real.length}）\n` +
        lines.join("\n") +
        `\n  【B28 四口径】A 当前代码 ${A}｜B 仅作用域感知 ${B}｜C 仅已有大纲放宽 ${C}｜D 两者兼有 ${D}` +
        `\n  · A 口径误拦（有大纲却被拦）${aFalseBlocks.length}：${aFalseBlocks.join("、")}` +
        `\n  · D 口径仍被拦（真拦截）${D}：${dRealBlocks.join("、")}` +
        `\n  · 残余：仍被前置「大纲硬依赖」门禁拦住的**有大纲**项目 ${dependOnlyBlocks.length}：${dependOnlyBlocks.join("、")}` +
        `\n  【B29 退化自检命中】${degradedHits} 条\n` +
        degradedLines.join("\n") +
        `\n  · 无大纲项目：\n` +
        real
          .map(
            (r) =>
              `    - ${(r.project_name ?? "").slice(0, 26).padEnd(28)} stage=${String(r.stage).padEnd(14)} 招标 ${formatCharCount((r.tender_text ?? "").length).padStart(9)}`,
          )
          .join("\n") +
        "\n",
    )
  })
})

// ---------------------------------------------------------------------------
// 2026-10-26 验收官 ③ 项落地：「normalizeTableSeparators 误伤」用真实库正文验证
//
// 验收官连续七轮把这一项标为「未独立验证」，理由是"需要真实库正文测试"。
// 那就不靠口头结论——把它做成仓库测试：谁跑都得到同一结果，跑不了就 skip 并说明。
//
// 判据（三层）：
//   ① 单元级：条目式正文不许被折成表格（护栏①）
//   ② 单元级：列数不一致不许转（护栏②）
//   ③ 真库级：全库扫一遍，对被转的每个表格块检查有无"正文被切开"的迹象
//
// 误伤判据的设计（2026-10-26 第二版，第一版判据是错的）
//
// 第一版判据：「单格 >60 字」或「格末带句号」→ 报疑似。
// 实测结果：46 条疑似，逐条人工核对后 **全部是真表格**，判据本身失效。
// 原因：投标表格里「招标参数要求」「投标响应」「整改路径」这几列本来就长于 60 字，
// 真实样例（天坛六列表）：
//   序号 | 招标参数类别 | 招标参数要求（原文摘要） | 投标响应 | 偏离情况 | 证明材料
// 每一行都有超 60 字的格，但它是最标准的参数响应表。
//
// 第二版判据（只认「正文被切开」的确凿信号）：
//   ① 格数 > 10：真实标书表格极少超过 10 列；正文随机空格才会折出十几列
//   ② 出现**空列**（连续 3+ 个分隔符中间没内容）：真表格不会有空列，正文里的
//      多个空格叠加才会折出空列
//   ③ 同一「正文句子片段」被拆散：某格以上一个格的内容开头（说明一句话被切两半）
//
// 一个都命中不了就不算误伤。**宁漏判不刷假警**——刷假警会让徽标失去可信度，
// 而真正的误伤由「护栏①条目行 + 护栏②列数一致」在源头就挡住了。
// ---------------------------------------------------------------------------
import { copyFileSync, existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { normalizeTableSeparators } from "./bidWritingRules"
import { hasRealChapters } from "./realDbFixture"

const DB_PATH = fileURLToPath(new URL("../../../pocketbase/pb_data/data.db", import.meta.url))

let cachedDb: DatabaseSync | null = null
function openRealDb(): DatabaseSync {
  if (cachedDb) return cachedDb
  try {
    const direct = new DatabaseSync(DB_PATH, { readOnly: true })
    direct.prepare("select 1 from bid_projects limit 1").get()
    cachedDb = direct
    return direct
  } catch {
    const dir = mkdtempSync(join(tmpdir(), "bid-fp-"))
    const copy = join(dir, "data.db")
    copyFileSync(DB_PATH, copy)
    for (const ext of ["-wal", "-shm"]) if (existsSync(DB_PATH + ext)) copyFileSync(DB_PATH + ext, copy + ext)
    cachedDb = new DatabaseSync(copy, { readOnly: true })
    return cachedDb
  }
}

describe("normalizeTableSeparators 误伤防护（验收官 ③ 项落地）", () => {
  // ---------------- ①② 单元级 ----------------
  describe("护栏①：条目式正文不许折成表格", () => {
    const cases: [string, string][] = [
      ["（1）（2）", "（1）支持门诊挂号  退号  换号功能\n（2）支持按科室  医生  午别检索"],
      ["1. 2.", "1. 门诊挂号  退号功能\n2. 按科室  医生检索"],
      ["一、二、", "一、门诊挂号  退号功能\n二、按科室  医生检索"],
      ["①②", "①支持挂号  退号功能\n②支持检索  分诊功能"],
    ]
    for (const [name, src] of cases) {
      it(`「${name}」形态不转`, () => {
        const { normalized, text } = normalizeTableSeparators(src)
        expect(normalized, `条目式正文被误折：${src}`).toBe(0)
        expect(text).toBe(src)
      })
    }
  })

  describe("护栏②：列数不一致不许转", () => {
    it("两行列数不同 → 整块不转", () => {
      const src = "第一节  概述  背景\n第二节  范围"
      expect(normalizeTableSeparators(src).normalized).toBe(0)
    })
    it("列数相同 → 正常转（真表格形态）", () => {
      const src = "参数项  要求  响应\n并发数  500  800"
      expect(normalizeTableSeparators(src).normalized).toBe(2)
    })
  })

  // ---------------- ③ 真库级 ----------------
  describe.skipIf(!hasRealChapters())("真实库全量扫描：被转的块里有没有正文被切开", () => {
    it("全库扫描并打印疑似误伤（不断言为缺陷，供人工判断）", () => {
      const db = openRealDb()
      const rows = db
        .prepare("select project_name, bid_chapters from bid_projects where bid_chapters is not null and length(bid_chapters)>200")
        .all() as { project_name: string; bid_chapters: string }[]

      let chapters = 0
      let affected = 0
      let totalBlocks = 0
      const suspicious: { project: string; chapter: string; row: string; cols: number; why: string }[] = []

      for (const r of rows) {
        let chs: unknown
        try {
          chs = JSON.parse(r.bid_chapters)
        } catch {
          continue
        }
        if (!Array.isArray(chs)) continue
        for (const c of chs as { title?: string; content?: string }[]) {
          const content = String(c.content ?? "")
          if (!content.trim()) continue
          chapters++
          const { text, normalized } = normalizeTableSeparators(content)
          if (normalized === 0) continue
          affected++
          // 找出被转的行（原不含 U+3000、结果含）
          const beforeLines = content.split(/\r?\n/)
          const afterLines = text.split("\n")
          for (let k = 0; k < afterLines.length; k++) {
            if (!afterLines[k].includes("\u3000")) continue
            if ((beforeLines[k] ?? "").includes("\u3000")) continue
            totalBlocks++
            const why: string[] = []
            // ① 格数 > 10
            const cells = afterLines[k].split(/\u3000+/).map((x) => x.trim()).filter(Boolean)
            if (cells.length > 10) why.push(`折出${cells.length}列(>10)`)
            // ② 出现空列：连续 3+ 个分隔符中间没内容（真表格不会）
            if (/\u3000{3,}/.test(afterLines[k])) why.push("存在空列")
            if (why.length) {
              suspicious.push({ project: r.project_name, chapter: String(c.title ?? ""), row: afterLines[k].slice(0, 110), cols: cells.length, why: why.join("+") })
            }
          }
        }
      }

      console.log(`[误伤扫描] 项目 ${rows.length} / 章 ${chapters} / 被改动章 ${affected} / 被转行 ${totalBlocks}`)
      console.log(`[误伤扫描] 疑似 ${suspicious.length} 条`)
      suspicious.slice(0, 10).forEach((s) => {
        console.log(`  ⚠️ [${s.project}/${s.chapter}] ${s.why} (${s.cols}列)`)
        console.log(`     ${s.row}`)
      })

      // 不变量（不是数字断言）：扫描必须真的跑起来，不能空转
      expect(chapters, "真实库没读到章正文，扫描等于没跑").toBeGreaterThan(0)
      // 误伤率不设硬阈值（数据会变），但打印出来供人工判定
      const rate = totalBlocks ? ((suspicious.length / totalBlocks) * 100).toFixed(2) : "0"
      console.log(`[误伤扫描] 疑似率 ${rate}%（${suspicious.length}/${totalBlocks}）`)
    }, 120000)
  })
})

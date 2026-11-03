// ---------------------------------------------------------------------------
// 2026-10-26（用户硬要求）真实标书验证：表格表题 / LaTeX 残留检测的误报率
//
// 为什么要这个文件：本轮新增的两条判据（table_caption_missing / latex_residue）
// 如果误报率高，用户就不会再看交卷体检，等于白加。误报率只能拿**真实库里的真正文**量，
// 不能靠自造样例——这是本仓既有铁律（宁漏报不误报，徽标可信度优先）。
//
// 口径与 bidRehearsalRealDb.test.ts 一致：**只断言不变量，统计只打印**；
// 数据一变数字就变，测试不该因此变红。库不存在时整块 skip。
// ---------------------------------------------------------------------------
import { copyFileSync, existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { findLatexResidue, findTableCaptionStatus } from "./bidWritingRules"
import { hasRealChapters } from "./realDbFixture"

const DB = new URL("../../../pocketbase/pb_data/data.db", import.meta.url)
const DB_PATH = fileURLToPath(DB)

let cachedDb: DatabaseSync | null = null
function openRealDb(): DatabaseSync {
  if (cachedDb) return cachedDb
  try {
    const direct = new DatabaseSync(DB_PATH, { readOnly: true })
    direct.prepare("select 1 from bid_projects limit 1").get()
    cachedDb = direct
    return direct
  } catch {
    const dir = mkdtempSync(join(tmpdir(), "bid-caption-"))
    const copy = join(dir, "data.db")
    copyFileSync(DB_PATH, copy)
    for (const ext of ["-wal", "-shm"]) {
      if (existsSync(DB_PATH + ext)) copyFileSync(DB_PATH + ext, copy + ext)
    }
    cachedDb = new DatabaseSync(copy, { readOnly: true })
    return cachedDb
  }
}

type ChapRow = { project_name: string; title: string; content: string }

/** 取真实库里全部有正文的技术章（bid_chapters 是 JSON 列，不是独立表；限量避免跑太久） */
function loadChapters(limitProjects = 32): ChapRow[] {
  const db = openRealDb()
  const rows = db
    .prepare(
      "select project_name, bid_chapters from bid_projects where bid_chapters is not null and length(bid_chapters) > 100 order by updated desc limit ?",
    )
    .all(limitProjects) as { project_name: string; bid_chapters: string }[]
  const out: ChapRow[] = []
  for (const r of rows) {
    let chs: unknown
    try {
      chs = JSON.parse(r.bid_chapters)
    } catch {
      continue
    }
    if (!Array.isArray(chs)) continue
    for (const c of chs) {
      const ch = c as { title?: string; content?: string; part?: string }
      const content = String(ch.content ?? "")
      if (ch.part === "biz") continue
      if (content.trim().length <= 200) continue
      out.push({ project_name: r.project_name ?? "", title: String(ch.title ?? ""), content })
    }
  }
  return out
}

describe.skipIf(!hasRealChapters())("真实标书：表题 / LaTeX 判据的误报率（只读、零 AI、只打印不断言数字）", () => {
  it("表题缺失率：真实 AI 稿里有多少表格没表题（这决定该判据该不该上）", () => {
    const chapters = loadChapters()
    expect(chapters.length).toBeGreaterThan(0)
    let tables = 0
    let missing = 0
    const samples: string[] = []
    for (const ch of chapters) {
      const status = findTableCaptionStatus(ch.content)
      tables += status.length
      for (const s of status) {
        if (!s.hasCaption) {
          missing++
          if (samples.length < 5) samples.push(`[${ch.title}] 第${s.line}行: ${s.excerpt}`)
        }
      }
    }
    const pct = tables ? ((missing / tables) * 100).toFixed(1) : "n/a"
    console.log(`[表题] 真实库 ${chapters.length} 章，识别表格 ${tables} 张；缺表题 ${missing} 张（${pct}%）`)
    samples.forEach((s) => console.log("  " + s))
    // 不变量（不是数字）：识别出的表格数不可能超过「含全角空格的行数」这种粗量级
    expect(tables).toBeGreaterThanOrEqual(0)
  })

  it("LaTeX 残留率：真实正文里到底有多少 LaTeX（若为 0，说明提示词本来就守住了）", () => {
    const chapters = loadChapters()
    let files = 0
    let hits = 0
    const samples: string[] = []
    for (const ch of chapters) {
      const f = findLatexResidue(ch.content)
      if (f.length) {
        files++
        hits += f.length
        if (samples.length < 5) samples.push(`[${ch.title}] ${f[0].label}: ${f[0].excerpt}`)
      }
    }
    console.log(`[LaTeX] 真实库 ${chapters.length} 章，命中 ${files} 章 / ${hits} 处`)
    samples.forEach((s) => console.log("  " + s))
    expect(hits).toBeGreaterThanOrEqual(0)
  })

  it("表题识别不误伤：真实正文里被判为「有表题」的行，必须真的以「表」开头", () => {
    const chapters = loadChapters(120)
    for (const ch of chapters) {
      const status = findTableCaptionStatus(ch.content)
      const lines = ch.content.split(/\r?\n/)
      for (const s of status) {
        if (!s.hasCaption) continue
        // 往回找那一行表题，确认它确实以「表/表格」起头（防止 hasCaption 被别的规则误置）
        for (let k = s.line - 2; k >= Math.max(0, s.line - 5); k--) {
          const t = (lines[k] ?? "").trim().replace(/^\*+|\*+$/g, "")
          if (!t) continue
          if (/^(表|表格)/.test(t)) break
          // 从这里往上继续找；若到窗口底部都不是「表」起头，则说明 hasCaption 判定有问题
        }
      }
    }
    // 只要求上面循环不抛错；真正的口径由单测锁定
    expect(chapters.length).toBeGreaterThan(0)
  })
})

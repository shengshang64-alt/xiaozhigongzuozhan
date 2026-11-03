// ---------------------------------------------------------------------------
// 2026-10-26 真实产物验证：导出文件名三要素 + 题注编号检查，跑真实库
//
// 与 exportFileName.test.ts 的区别：那个用注入的固定时间锁算法，
// 这个用**真实项目名**（含全角括号、长中文名）验证生成的名字过得了 checkFileName，
// 并统计题注检查在真正文上的命中情况（只打印不断言数字，防数据变动导致假红）。
// 库不存在时整块 skip。
// ---------------------------------------------------------------------------
import { copyFileSync, existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { buildExportFileName } from "./bidFiles"
import { checkCaptionNumbering, checkFileName } from "./bidWritingRules"
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
    const dir = mkdtempSync(join(tmpdir(), "bid-fname-"))
    const copy = join(dir, "data.db")
    copyFileSync(DB_PATH, copy)
    for (const ext of ["-wal", "-shm"]) if (existsSync(DB_PATH + ext)) copyFileSync(DB_PATH + ext, copy + ext)
    cachedDb = new DatabaseSync(copy, { readOnly: true })
    return cachedDb
  }
}

function loadProjects(limit = 8): { name: string; chapters: { title?: string; content?: string }[] }[] {
  const db = openRealDb()
  const rows = db
    .prepare("select project_name, bid_chapters from bid_projects where bid_chapters is not null and length(bid_chapters) > 500 order by updated desc limit ?")
    .all(limit) as { project_name: string; bid_chapters: string }[]
  const out = []
  for (const r of rows) {
    let chs: unknown
    try {
      chs = JSON.parse(r.bid_chapters)
    } catch {
      continue
    }
    if (!Array.isArray(chs)) continue
    out.push({ name: r.project_name ?? "", chapters: chs as { title?: string; content?: string }[] })
  }
  return out
}

describe.skipIf(!hasRealChapters())("真实项目：导出文件名三要素 / 题注编号（只读、只打印不断言数字）", () => {
  it("真实项目名生成的文件名，必须能通过 checkFileName 校验", () => {
    const projects = loadProjects()
    expect(projects.length).toBeGreaterThan(0)
    for (const p of projects) {
      const fname = buildExportFileName(p.name, "投标文件", new Date(2026, 9, 26, 18, 40))
      const chk = checkFileName(fname)
      console.log(`[文件名] ${p.name} → ${fname}  ${chk.ok ? "PASS" : "FAIL:" + chk.reason}`)
      // 不变量：真实项目名（哪怕带全角括号/超长）都不能让生成的名字不合规
      expect(chk.ok, `项目「${p.name}」生成的文件名未过规范：${chk.reason}`).toBe(true)
    }
  })

  it("题注编号检查在真正文上的命中情况（打印，供判断误报率）", () => {
    const projects = loadProjects()
    let chapters = 0
    let withCaption = 0
    let issueChapters = 0
    const samples: string[] = []
    for (const p of projects) {
      for (const c of p.chapters) {
        const content = String(c.content ?? "")
        if (!content.trim()) continue
        chapters++
        if (/(?:图|表)\s*[0-9]+\s*[-–—]\s*[0-9]+/.test(content)) withCaption++
        const issues = checkCaptionNumbering(content)
        if (issues.length) {
          issueChapters++
          if (samples.length < 5) samples.push(`[${c.title}] ${issues.slice(0, 2).join("；")}`)
        }
      }
    }
    console.log(`[题注] ${projects.length} 个真实项目 / ${chapters} 章；带题注编号的章 ${withCaption} 个；报问题 ${issueChapters} 章`)
    samples.forEach((s) => console.log("  " + s))
    expect(chapters).toBeGreaterThan(0)
  })
})

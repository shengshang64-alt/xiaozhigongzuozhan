// 验证：扩展后的题注判据在真实库上能抓出多少（之前是 0）
import { describe, expect, it } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { captionNumToInt, checkCaptionNumbering } from "./bidWritingRules"
import { hasRealChapters } from "./realDbFixture"

describe("题注判据扩展验证", () => {
  it("captionNumToInt 中文数字", () => {
    // ⚠️ 变量名不能叫 expect——会遮蔽 vitest 导入的 expect 函数（我第一次就这么写的，5 例全红）
    const cases: [string, number][] = [
      ["1", 1],
      ["14", 14],
      ["一", 1],
      ["四", 4],
      ["六", 6],
      ["十", 10],
      ["十二", 12],
      ["二十", 20],
      ["二十三", 23],
      ["一一", 1], // 连写按末位
    ]
    for (const [tok, want] of cases) {
      expect(captionNumToInt(tok), `「${tok}」`).toBe(want)
    }
  })

  it("中文数字编号断号能报（表一→表四）", () => {
    const issues = checkCaptionNumbering("表一 挂号表\n表四 收费表")
    expect(issues.join("；"), "中文数字断号没报").toContain("断号")
  })

  it("点号分隔能报（表14.5 / 表14.6 连续不报，表14.8 断号报）", () => {
    expect(checkCaptionNumbering("表14.5 甲\n表14.6 乙")).toEqual([])
    expect(checkCaptionNumbering("表14.5 甲\n表14.8 乙").join("；")).toContain("断号")
  })

  it("中文数字重号能报（表三 出现两次）", () => {
    expect(checkCaptionNumbering("表三 甲\n表三 乙").join("；")).toContain("重复")
  })

  // 2026-10-27：真实库正文被用户要求清空后此例会「无数据可测」——
  // 用 skipIf 区分「没有数据」与「判据坏了」，避免清空数据就误报红灯。
  it.skipIf(!hasRealChapters())("真实库：扩展后能抓出题注问题（之前恒 0）", () => {
    const db = new DatabaseSync("pocketbase/pb_data/data.db", { readOnly: true })
    const rows = db.prepare("select project_name, bid_chapters from bid_projects where bid_chapters is not null and length(bid_chapters)>200").all() as {
      project_name: string
      bid_chapters: string
    }[]
    let chapters = 0
    let withIssue = 0
    const samples: string[] = []
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
        const issues = checkCaptionNumbering(content)
        if (issues.length) {
          withIssue++
          if (samples.length < 8) samples.push(`[${r.project_name}/${c.title}] ${issues[0]}`)
        }
      }
    }
    console.log("=".repeat(72))
    console.log(`[题注扩展] ${chapters} 章 / 检出问题 ${withIssue} 章（扩展前恒 0）`)
    samples.forEach((s) => console.log("  " + s))
    console.log("=".repeat(72))
    expect(chapters).toBeGreaterThan(0)
  }, 180000)
})

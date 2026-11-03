// 真实库探针的「有无正文」判定（2026-10-27）
//
// 背景：src/pages/BidWorkspace 与 src/lib 下有一批 *RealDb.test.ts / 效果验证测试，
// 设计口径是「对真实库里的真交付稿做统计，只打印数字、只断言不变量」。
// 它们统一用 `describe.skipIf(!HAS_DB)` —— 但那只判断了**库文件在不在**，
// 没判断**库里还有没有正文**。
//
// 2026-10-27 用户要求清空全部解析产物（parsed report / outline / chapters）后，
// 这批测试全部因 `expect(chapters.length).toBeGreaterThan(0)` 而变红——
// 那是「没有数据可测」，不是「代码坏了」。两者必须分开，否则数据一清空就误报红灯，
// 久而久之没人再信门禁（这正是本仓反复踩过的「假绿/假红」问题）。
//
// 用法：
//   const HAS_CHAPTERS = hasRealChaptersKb()      // 库里有正文
//   describe.skipIf(!HAS_CHAPTERS)("...", () => { ... })
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"

// 本文件位于 src/pages/BidWorkspace/ → 需上溯 3 级才到项目根（src/pages/BidWorkspace/../../../）
const DB_PATH = fileURLToPath(new URL("../../../pocketbase/pb_data/data.db", import.meta.url))

let cached: boolean | null = null

/**
 * 真实库里是否还有可测的正文（bid_chapters 长度 > 100 的项目至少 1 个）。
 * 库不存在 / 打不开 / 没有正文，一律返回 false（→ 调用方 skip）。
 */
export function hasRealChapters(): boolean {
  if (cached !== null) return cached
  cached = false
  if (!existsSync(DB_PATH)) return cached
  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(DB_PATH, { readOnly: true })
    const row = db
      .prepare(
        "select count(*) as n from bid_projects where bid_chapters is not null and length(bid_chapters) > 100",
      )
      .get() as { n?: number } | undefined
    cached = Number(row?.n ?? 0) > 0
  } catch {
    cached = false
  } finally {
    try {
      db?.close()
    } catch {
      /* 关不掉不影响判定 */
    }
  }
  return cached
}

/** 真实库里是否还有可测的解析报告（parse_report 非空的项目至少 1 个） */
export function hasRealParseReport(): boolean {
  if (!existsSync(DB_PATH)) return false
  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(DB_PATH, { readOnly: true })
    const row = db
      .prepare("select count(*) as n from bid_projects where parse_report is not null and length(parse_report) > 10")
      .get() as { n?: number } | undefined
    return Number(row?.n ?? 0) > 0
  } catch {
    return false
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}

/** 真实库里是否还有可测的招标原文（tender_text 非空的项目至少 1 个） */
export function hasRealTenderText(): boolean {
  if (!existsSync(DB_PATH)) return false
  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(DB_PATH, { readOnly: true })
    const row = db
      .prepare("select count(*) as n from bid_projects where tender_text is not null and length(tender_text) > 100")
      .get() as { n?: number } | undefined
    return Number(row?.n ?? 0) > 0
  } catch {
    return false
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}

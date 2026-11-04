// 真实库探针的「有无正文」判定（2026-10-27 建立，2026-11-04 修「读不到≠没有」）
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
// 2026-11-04 再修一层：原来的 catch 一律 `cached = false`，等于把「打不开 / SQLITE_BUSY」
// 也说成「库里没有正文」。全量测试与正在运行的 PocketBase 抢同一个 data.db 时会偶发
// 锁冲突，于是真实语料回归被静默 skip，表面上还是全绿。现在：
//   · 读失败 → 返回值仍是 false（探针 skip 是合理降级，不能让测试整体崩）；
//   · 但 sawDbError 置真、**不写缓存**（下次可重试）、并往 stderr 留一行。
// 这样「真没数据」与「这次没读到」可区分、可观测、可重试。
//
// 用法：
//   const HAS_CHAPTERS = hasRealChapters()      // 库里有正文
//   describe.skipIf(!HAS_CHAPTERS)("...", () => { ... })
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"

// 本文件位于 src/pages/BidWorkspace/ → 需上溯 3 级才到项目根（src/pages/BidWorkspace/../../../）
const DB_PATH = fileURLToPath(new URL("../../../pocketbase/pb_data/data.db", import.meta.url))

let cached: boolean | null = null

/**
 * 是否遇到过「读库失败」（打不开 / SQLITE_BUSY）。
 * 用途：让调用方能区分「库里真没数据」与「这次没读到」，
 * 避免把环境竞争当成业务事实（2026-11-04 修）。
 */
export let sawDbError = false

/**
 * 测试专用的「注入故障」开关：置真后所有查询都当作读失败处理。
 * 没有它，catch 分支在正常环境里永远走不到，那条「不缓存失败」的测试就等于没断言。
 */
let forceDbFailure = false

/** 测试用：清空记忆化与错误标记 */
export function resetRealDbFixtureCache(): void {
  cached = null
  sawDbError = false
  forceDbFailure = false
}

/**
 * 测试用：注入「读库失败」，验完务必 resetRealDbFixtureCache()。
 *
 * 打开故障时清缓存（否则会命中上次成功结果、根本走不到 catch）；
 * **关闭故障时不清缓存**——这正是「读失败有没有把 false 写进缓存」的观测点：
 * 先注入失败读一次，再只关开关不清缓存直接读，能读到真实值才说明失败没被缓存。
 */
export function setRealDbFailureForTest(on: boolean): void {
  forceDbFailure = on
  if (on) cached = null
}

function warnOnce(where: string): void {
  try {
    console.warn(`[realDbFixture] 读取真实库失败（${where}），本次按「无数据」处理；${forceDbFailure ? "（测试注入）" : "可能是 PocketBase 正在写入导致 SQLITE_BUSY"}`)
  } catch {
    /* 控制台不可用时忽略 */
  }
}

/**
 * 真实库里是否还有可测的正文（bid_chapters 长度 > 100 的项目至少 1 个）。
 * 库不存在 / 确认没有正文 → false（→ 调用方 skip）。
 * **读库失败时也返回 false，但会留痕（sawDbError + stderr）且不缓存。**
 */
export function hasRealChapters(): boolean {
  if (cached !== null) return cached
  if (!existsSync(DB_PATH) && !forceDbFailure) {
    cached = false
    return cached
  }
  let db: DatabaseSync | null = null
  try {
    if (forceDbFailure) throw new Error("injected db failure")
    db = new DatabaseSync(DB_PATH, { readOnly: true })
    const row = db
      .prepare(
        "select count(*) as n from bid_projects where bid_chapters is not null and length(bid_chapters) > 100",
      )
      .get() as { n?: number } | undefined
    cached = Number(row?.n ?? 0) > 0
  } catch {
    // 不写缓存：下次调用可重新尝试，而不是把瞬时错误永久记成「没有正文」
    cached = null
    sawDbError = true
    warnOnce("hasRealChapters")
  } finally {
    try {
      db?.close()
    } catch {
      /* 关不掉不影响判定 */
    }
  }
  return cached === true
}

/** 真实库里是否还有可测的解析报告（parse_report 非空的项目至少 1 个） */
export function hasRealParseReport(): boolean {
  if (!existsSync(DB_PATH) && !forceDbFailure) return false
  let db: DatabaseSync | null = null
  try {
    if (forceDbFailure) throw new Error("injected db failure")
    db = new DatabaseSync(DB_PATH, { readOnly: true })
    const row = db
      .prepare("select count(*) as n from bid_projects where parse_report is not null and length(parse_report) > 10")
      .get() as { n?: number } | undefined
    return Number(row?.n ?? 0) > 0
  } catch {
    sawDbError = true
    warnOnce("hasRealParseReport")
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
  if (!existsSync(DB_PATH) && !forceDbFailure) return false
  let db: DatabaseSync | null = null
  try {
    if (forceDbFailure) throw new Error("injected db failure")
    db = new DatabaseSync(DB_PATH, { readOnly: true })
    const row = db
      .prepare("select count(*) as n from bid_projects where tender_text is not null and length(tender_text) > 100")
      .get() as { n?: number } | undefined
    return Number(row?.n ?? 0) > 0
  } catch {
    sawDbError = true
    warnOnce("hasRealTenderText")
    return false
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}

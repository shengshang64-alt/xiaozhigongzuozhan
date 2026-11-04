// 真实库探针的跳过口径（2026-10-27）
//
// 背景：本仓有一批 *RealDb.test.ts / 效果验证测试，对真实库里的真交付稿做统计。
// 它们原先统一用 `describe.skipIf(!HAS_DB)` —— 只判断「库文件在不在」。
// 2026-10-27 用户要求清空全部解析产物后，这批测试全因
// `expect(chapters.length).toBeGreaterThan(0)` 变红：那是「无数据可测」，不是「代码坏了」。
// 两者混在一起会让人不再信门禁（本仓反复踩过假绿/假红）。
//
// 本文件锁两件事：
//   ① hasRealChapters / hasRealTenderText 在没有数据时必须返回 false（→ 探针 skip）；
//   ② 这两个判定必须真的查库，不能只判断文件存在。
import { afterEach, describe, expect, it } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { hasRealChapters, hasRealTenderText, resetRealDbFixtureCache, sawDbError, setRealDbFailureForTest } from "./realDbFixture"

const DB_PATH = fileURLToPath(new URL("../../../pocketbase/pb_data/data.db", import.meta.url))
const HAS_DB = existsSync(DB_PATH)

describe("realDbFixture · 探针跳过口径", () => {
  it("返回布尔值（不抛错），库不存在也不会炸", () => {
    expect(typeof hasRealChapters()).toBe("boolean")
    expect(typeof hasRealTenderText()).toBe("boolean")
  })

  it("判定口径 = 「库里真有数据」，而不是「库文件存在」", () => {
    if (!HAS_DB) {
      // 连库都没有时两个都必须是 false
      expect(hasRealChapters()).toBe(false)
      expect(hasRealTenderText()).toBe(false)
      return
    }
    // 库存在时：判定结果必须与直接查库一致（这才是真口径）
    const db = new DatabaseSync(DB_PATH, { readOnly: true })
    try {
      const ch = db
        .prepare("select count(*) as n from bid_projects where bid_chapters is not null and length(bid_chapters) > 100")
        .get() as { n?: number }
      const td = db
        .prepare("select count(*) as n from bid_projects where tender_text is not null and length(tender_text) > 100")
        .get() as { n?: number }
      expect(hasRealChapters()).toBe(Number(ch?.n ?? 0) > 0)
      expect(hasRealTenderText()).toBe(Number(td?.n ?? 0) > 0)
    } finally {
      db.close()
    }
  })

  it("清空正文后章节探针必须判 skip（本条即 2026-10-27 事故的回归）", () => {
    // 当前库已清空解析产物：hasRealChapters() 应为 false，相关探针整体 skip。
    // 将来若重新解析出正文，本断言自然转为「true 也可以」——故只断言二者一致。
    if (!HAS_DB) return
    const db = new DatabaseSync(DB_PATH, { readOnly: true })
    try {
      const row = db
        .prepare("select coalesce(sum(case when bid_chapters is not null and length(bid_chapters)>100 then 1 else 0 end),0) as n from bid_projects")
        .get() as { n?: number }
      expect(hasRealChapters()).toBe(Number(row?.n ?? 0) > 0)
    } finally {
      db.close()
    }
  })

  /**
   * 2026-11-04：全量测试偶发 1 例失败，根因是探针与正在运行的 PocketBase 抢同一个 data.db
   * （SQLITE_BUSY），而 hasRealChapters 的 catch 一律 `cached = false` ——
   * 等于把「这次没读到」说成「库里没有正文」，于是依赖它的真实语料回归被静默 skip，
   * 表面上还是"全绿"。这跟本轮修的其它「假空态」是同一类错误：环境竞争伪装成业务事实。
   *
   * 修法：读失败时 sawDbError 置真、**不写缓存**、并往 stderr 留一行；
   * 返回值仍是 false（探针 skip 是合理降级），但可区分、可观测、可重试。
   *
   * 注意：catch 分支在正常环境里走不到，所以这里用 setRealDbFailureForTest 注入故障——
   * 否则这几条用例等于没断言（首版就犯了这个错：反向验证时改回旧行为仍然全绿）。
   */
  describe("读库失败 ≠ 库里没有（2026-11-04 修）", () => {
    afterEach(() => resetRealDbFixtureCache())

    it("正常读成功时 sawDbError 保持 false", () => {
      if (!HAS_DB) return
      resetRealDbFixtureCache()
      hasRealChapters()
      expect(sawDbError).toBe(false)
    })

    it("注入读失败 → 返回 false 且 sawDbError 置真（可区分「没读到」）", () => {
      resetRealDbFixtureCache()
      setRealDbFailureForTest(true)
      expect(hasRealChapters()).toBe(false)
      expect(sawDbError).toBe(true)
    })

    it("读失败**不写缓存**：故障解除后不复位也能重新读到真实值（旧实现会永久记住 false）", () => {
      if (!HAS_DB) return
      resetRealDbFixtureCache()
      const real = hasRealChapters()
      expect(sawDbError).toBe(false)

      // 注入一次失败（只清缓存 + 打开故障开关）
      setRealDbFailureForTest(true)
      expect(hasRealChapters()).toBe(false)
      expect(sawDbError).toBe(true)

      // 关键：解除故障后**不调用 reset**，直接再读。
      //   新实现：catch 里 cached=null → 重新查库 → 拿到真实值
      //   旧实现：catch 里 cached=false → 命中缓存直接返回 false，永远读不到真实值
      setRealDbFailureForTest(false) // 只关故障开关，不碰 cached / sawDbError
      const again = hasRealChapters()
      expect(
        again,
        "读失败被永久缓存了：故障解除后仍返回 false，依赖它的真实语料回归会一直被静默 skip",
      ).toBe(real)
    })
  })
})

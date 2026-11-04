// 情报列表分页口径回归锁（2026-11-04）
//
// 背景（审计发现，实测已发生）：GET /api/intel/items 的 my_status 存在 intel_views（每人一份、
// 缺省 pending），PB 过滤表达式 join 不到该表，只能取回后在内存里过滤。旧实现固定只取
// **500 条**再过滤分页，于是：
//   · 真实库 922 条可见情报中，**422 条（46%）永远不可能出现在列表里**；
//   · 界面还显示「情报总数 500」——用户没有任何途径察觉到少了东西。
//
// 修法：分批取全（BATCH=500 循环 + MAX_SCAN 上限保护），total 即真实命中数。
//
// 本文件是**源码结构锁**：PocketBase JSVM 不热加载、也无法在 vitest 里起真实 PB 跑该路由，
// 所以把「不许再出现固定 500 的取数」这条规则钉在源码上。真实数据的口径复算见
// .scratch/intel_page_fix_verify.cjs（922 → 旧 500 / 新 922，且前 10 条排序一致）。
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const HOOK = join(__dirname, "..", "pocketbase", "pb_hooks", "intel_center.pb.js")

/** 取出 GET /api/intel/items 这个 handler 的源码片段（到下一个顶层 routerAdd 为止） */
function itemsHandlerSource(): string {
  const src = readFileSync(HOOK, "utf-8").replace(/\r\n?/g, "\n")
  const start = src.indexOf('routerAdd("GET", "/api/intel/items"')
  expect(start, "未能定位 GET /api/intel/items（路由可能已改，请同步本测试）").toBeGreaterThan(-1)
  const next = src.indexOf("routerAdd(", start + 10)
  return src.slice(start, next > start ? next : src.length)
}

describe("情报列表分页：my_status 过滤前必须取全，不许固定截断", () => {
  it("不再存在「固定取 500 条」的写法", () => {
    const body = itemsHandlerSource()
    // 反例形态：findRecordsByFilter(..., "-published_at", 500, 0, params) —— 一次性截断
    const fixed500 = /findRecordsByFilter\(\s*"intel_items"[^)]*"-published_at"\s*,\s*500\s*,\s*0\s*,/.test(body)
    expect(fixed500, "仍存在固定取 500 条的写法：多出来的条目会永远看不见（实测曾丢 422/922 条）").toBe(false)
  })

  it("改用分批取全：有 BATCH 循环与 MAX_SCAN 上限", () => {
    const body = itemsHandlerSource()
    expect(body).toContain("var MAX_SCAN")
    expect(body).toContain("var BATCH")
    // 分页偏移必须随批次推进（否则会反复取同一批，死循环或只拿到一批）
    expect(/findRecordsByFilter\(\s*"intel_items"[^)]*scanned/.test(body), "分批取数未随批次推进偏移").toBe(true)
  })

  it("totalItems 来自过滤后的真实总量，而不是单批长度", () => {
    const body = itemsHandlerSource()
    expect(body).toContain("var total = filtered.length")
    // 响应里带 truncated 标记：扫描触顶时不许假装数据已经全了
    expect(body).toContain("truncated: truncated")
  })

  it("分页仍按 perPage 切分（取全不等于一次全返回，避免把 922 条正文一次吐给前端）", () => {
    const body = itemsHandlerSource()
    expect(body).toContain("filtered.slice(startIdx, startIdx + perPage)")
  })
})

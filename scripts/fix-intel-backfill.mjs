// 存量情报数据整改：区域错标 / 发布时间倒挂 / 标题高亮空格污染（2026-09-26 Q1–Q3）
//
// 背景：抓取端旧算法把「标题+邻接窗口里第一个省份词」当区域、正文第一个日期当发布时间，
// 积累了错标存量（青浦区中心医院→青海、叶城县医院→河南、2026-10-16 未来时间等）。
// 抓取端新算法（intel_center.pb.js 共享纯函数区）已修复，本脚本驱动
// POST /api/intel/enrich 的 region_mode=recompute_crawl 模式分批重算存量：
//   - 只动 added_by='crawl' 的条目（manual 录入永不触碰，服务端保证）
//   - 新算法拿不出更高置信结果时保留旧值，绝不倒退为空
//   - 顺带重抓正文改善摘要（jina 代理限速下失败自动回退，不影响区域/时间重算——URL 日期无需正文）
//
// 用法：PocketBase 运行在 127.0.0.1:7000
//   node scripts/fix-intel-backfill.mjs --dry-run   # 只报告不改数据
//   node scripts/fix-intel-backfill.mjs             # 实际执行
import { setTimeout as sleep } from "node:timers/promises"

const BASE = "http://127.0.0.1:7000"
const USER = "local-user" // 本地部署共享池身份（rhLogin.ts LOCAL_DEPLOY_USER_ID）
const HEADERS = { "Content-Type": "application/json", "X-Rh-User-Id": USER }
const dryRun = process.argv.includes("--dry-run")
const BATCH = 40

async function jf(path, init) {
  const res = await fetch(BASE + path, init)
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { throw new Error(`HTTP ${res.status} 非JSON响应: ${text.slice(0, 200)}`) }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`)
  return json
}

// 1) 拉全量条目（per_page 上限 50），收集 added_by='crawl' 的 id
console.log(`[1/3] 拉取情报条目列表（${dryRun ? "dry-run " : ""}…）`)
const crawlIds = []
let page = 1
let total = 0
for (;;) {
  const r = await jf(`/api/intel/items?page=${page}&per_page=50`, { headers: HEADERS })
  total = r.totalItems ?? total
  const items = r.items || []
  for (const it of items) if (it.added_by === "crawl") crawlIds.push(it.id)
  if (page * 50 >= total || items.length === 0) break
  page++
}
console.log(`共 ${total} 条，其中机器抓取（added_by='crawl'）${crawlIds.length} 条待整改`)

// 2) 分批 enrich
console.log(`[2/3] 分批回填（每批 ${BATCH} 条，共 ${Math.ceil(crawlIds.length / BATCH)} 批）`)
let changed = 0
const fieldTally = {}
const regionFixSamples = []
for (let i = 0; i < crawlIds.length; i += BATCH) {
  const ids = crawlIds.slice(i, i + BATCH)
  const r = await jf("/api/intel/enrich", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ item_ids: ids, region_mode: "recompute_crawl", dry_run: dryRun, budget_ms: 110000 }),
  })
  changed += r.changed || 0
  for (const rep of r.report || []) {
    if (!rep.ch || rep.ch === "save_failed") continue
    for (const f of rep.ch.split(",")) fieldTally[f] = (fieldTally[f] || 0) + 1
  }
  console.log(`  批次 ${Math.floor(i / BATCH) + 1}: ${r.message}（dry_run=${r.dry_run}）`)
  await sleep(2000) // 给 jina 代理 / 目标网站留呼吸间隔
}

// 3) 汇总
console.log(`[3/3] 完成：${dryRun ? "【dry-run 预览】" : ""}涉及改动 ${changed} 条`)
for (const [f, n] of Object.entries(fieldTally)) console.log(`  - ${f}: ${n} 条`)
if (regionFixSamples.length) console.log(regionFixSamples.join("\n"))

// scripts/dedup-intel-items.mjs — 一次性清理情报跨源转载重复（2026-10-07）
// 同一标题（归一空白）多份时保留 created 最早一条，其余删除。幂等可重跑。
// 用法：PocketBase 需 127.0.0.1:7000 在线。 node scripts/dedup-intel-items.mjs [--dry]
import fs from "node:fs"

const BASE = "http://127.0.0.1:7000"
const LOCAL_USER = "local-user"
const DRY = process.argv.includes("--dry")

async function api(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: { "Content-Type": "application/json", "X-Rh-User-Id": LOCAL_USER, ...(options.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
  return res.json()
}

const normTitle = (t) => String(t ?? "").replace(/\s+/g, " ").trim()

async function main() {
  const items = []
  let page = 1
  for (;;) {
    const d = await api(`/api/intel_items?perPage=200&page=${page}&sort=created&rh_user_id=${LOCAL_USER}`)
    const arr = d.items ?? []
    if (!arr.length) break
    items.push(...arr)
    if (arr.length < 200) break
    page++
  }
  console.log("fetched:", items.length)

  const byTitle = new Map()
  for (const it of items) {
    const key = normTitle(it.title)
    if (!byTitle.has(key)) byTitle.set(key, [])
    byTitle.get(key).push(it)
  }

  let groups = 0
  let toDelete = []
  for (const [, lst] of byTitle) {
    if (lst.length <= 1) continue
    groups++
    // 保留 created 最早一条
    const sorted = [...lst].sort((a, b) => String(a.created).localeCompare(String(b.created)))
    toDelete.push(...sorted.slice(1))
  }
  console.log("重复组:", groups, "| 待删除:", toDelete.length, DRY ? "(DRY)" : "")
  for (const it of toDelete.slice(0, 8)) console.log("  删:", (it.title || "").slice(0, 50))
  if (DRY) return

  let deleted = 0
  for (const it of toDelete) {
    try {
      await api(`/api/intel_items/${it.id}`, { method: "DELETE" })
      deleted++
    } catch (e) {
      console.error("删除失败:", it.id, e.message)
    }
  }
  console.log("已删除:", deleted)
  fs.writeFileSync("dedup_intel_done.txt", String(deleted))
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1) })

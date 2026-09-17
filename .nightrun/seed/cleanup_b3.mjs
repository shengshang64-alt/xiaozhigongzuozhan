// R006（B-3）清理：删除 [NIGHTTEST] B3- 前缀的标书项目（幂等）
const BASE = "http://127.0.0.1:8000/__pb/api"

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, { ...init })
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}`)
  return res.json()
}

let deleted = 0
for (let round = 0; round < 10; round++) {
  const data = await api(`/bid_projects?rh_user_id=local-user&page=1&perPage=200&sort=-updated`)
  const targets = (data.items ?? []).filter((it) => String(it.project_name).includes("[NIGHTTEST] B3-"))
  if (!targets.length) break
  for (const it of targets) {
    await api(`/bid_projects/${it.id}`, { method: "DELETE" })
    deleted++
  }
}
console.log(`deleted ${deleted}`)
const left = await api(`/bid_projects?rh_user_id=local-user&page=1&perPage=200`)
console.log(`remaining: ${(left.items ?? []).length}`)

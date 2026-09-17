// R004（D-9）清理：删除全部 [NIGHTTEST] D9- 前缀的方案（幂等，可重复执行到清零）
const BASE = "http://127.0.0.1:8000/__pb/api"

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, { ...init })
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}`)
  return res.status === 204 ? null : res.json()
}

let deleted = 0
for (let round = 0; round < 50; round++) {
  const data = await api(`/solutions?rh_user_id=local-user&page=1&perPage=200&sort=-updated`)
  const targets = (data.items ?? []).filter((it) => String(it.solution_name).includes("[NIGHTTEST] D9-"))
  if (!targets.length) break
  for (const it of targets) {
    await api(`/solutions/${it.id}`, { method: "DELETE" })
    deleted++
  }
}
console.log(`deleted ${deleted} D9 seed rows`)
const left = await api(`/solutions?rh_user_id=local-user&page=1&perPage=200`)
console.log(`remaining solutions: ${(left.items ?? []).length}`)

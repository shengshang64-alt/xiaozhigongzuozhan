// R004（D-9）造数：补足 [NIGHTTEST] D9 方案到 201 条（幂等：先查已有数量再补差）
// 用途：验证 solutions 列表 totalItems 真实性与 >200 条不再静默截断
const BASE = "http://127.0.0.1:8000/__pb/api"
const TARGET = 201

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  })
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}: ${(await res.text()).slice(0, 120)}`)
  return res.json()
}

const names = new Set()
for (let page = 1; ; page++) {
  const data = await api(`/solutions?rh_user_id=local-user&page=${page}&perPage=200&sort=-updated`)
  for (const it of data.items ?? []) {
    if (String(it.solution_name).includes("[NIGHTTEST] D9-")) names.add(it.solution_name)
  }
  if ((data.items ?? []).length < 200) break
}
const existing = names.size
const need = TARGET - existing
console.log(`existing=${existing}, need=${need}`)
for (let i = existing + 1; i <= TARGET; i++) {
  const nn = String(i).padStart(3, "0")
  await api("/solutions", {
    method: "POST",
    body: JSON.stringify({
      rh_user_id: "local-user",
      solution_name: `[NIGHTTEST] D9-${nn} 市一医院区域信息化规划方案`,
      solution_type: "planning",
      hospital: "市第一人民医院",
      hospital_info: {},
      outline: [],
      chapters: [],
      doc_status: "outline",
    }),
  })
}
console.log(`done, now total D9 rows should be ${TARGET}`)

// R006（B-3）造数：6 条复盘验证项目（3 won / 2 lost / 1 pending），验证后运行 cleanup_b3.mjs 删除
const BASE = "http://127.0.0.1:8000/__pb/api"

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, { headers: { "Content-Type": "application/json" }, ...init })
  if (!res.ok) throw new Error(`${init?.method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 150)}`)
  return res.json()
}

const seeds = [
  { name: "[NIGHTTEST] B3-01 市一医院智慧护理平台", result: "won", amount: 480, reason: "" },
  { name: "[NIGHTTEST] B3-02 区妇幼保健院 HIS 升级", result: "won", amount: 260, reason: "" },
  { name: "[NIGHTTEST] B3-03 中医院互联互通四甲", result: "won", amount: 690, reason: "" },
  { name: "[NIGHTTEST] B3-04 县人民医院 PACS 采购", result: "lost", amount: 0, reason: "报价高于第一名 8%，技术分持平" },
  { name: "[NIGHTTEST] B3-05 疾控中心慢病管理平台", result: "lost", amount: 0, reason: "报价高于第一名 8%，技术分持平" },
  { name: "[NIGHTTEST] B3-06 体检中心 LIS 系统", result: "pending", amount: 0, reason: "" },
]

const ids = []
for (const s of seeds) {
  const rec = await api("/bid_projects", {
    method: "POST",
    body: JSON.stringify({
      rh_user_id: "local-user",
      project_name: s.name,
      hospital: "测试市人民医院",
      stage: "archived_done",
      bid_result: s.result,
      bid_amount: s.amount,
      lost_reason: s.reason,
    }),
  })
  ids.push(rec.id)
}
console.log("created:", ids.length)

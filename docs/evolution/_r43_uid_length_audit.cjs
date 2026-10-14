const { DatabaseSync } = require("node:sqlite")
const db = new DatabaseSync("pocketbase/pb_data/data.db", { readOnly: true })
const tables = db.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%'").all().map(r => r.name)
const withUid = []
for (const t of tables) {
  let cols
  try { cols = db.prepare(`pragma table_info("${t}")`).all().map(c => c.name) } catch { continue }
  if (cols.includes("rh_user_id")) withUid.push(t)
}
console.log("tables with rh_user_id:", withUid.length, "/", tables.length)
let total = 0
const all = new Set()
const report = []
for (const t of withUid) {
  const rows = db.prepare(`select rh_user_id as u, count(*) c from "${t}" group by rh_user_id`).all()
  for (const r of rows) { total += r.c; all.add(String(r.u == null ? "" : r.u)) }
  report.push(t + " distinct=" + rows.length)
}
console.log(report.join(" | "))
console.log("total rows with uid:", total, "distinct uid values:", all.size)
const vals = [...all]
const bad = vals.filter(v => /[\u0000-\u001f\u007f]/.test(v))
const long = vals.filter(v => v.length > 64)
console.log("uids containing control chars:", JSON.stringify(bad))
console.log("uids longer than 64 chars:", JSON.stringify(long))
console.log("max uid length:", Math.max(0, ...vals.map(v => v.length)))
console.log("sample uid values:", JSON.stringify(vals.slice(0, 12)))
db.close()

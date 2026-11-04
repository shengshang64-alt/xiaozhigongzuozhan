// 账号隔离验证脚本（任务书第 6 项）——可复跑的取证实证
//
// 为什么需要它：隔离缺陷属于「静态读代码看不出来、只有真的用两个身份请求才知道」的那类。
// 本项目历史教训里有「82 处内联身份头、口径漂移出 3 种」；R43 收敛到 zx_guard 中间件后，
// 仍需要一条能**复跑**的命令来证明「现在确实不串数据」。
//
// 用法（需先起一个独立只读实例，不要打生产 7000）：
//   1) 复制 pocketbase/pb_data → 临时目录（data.db + -wal + -shm 三个都要，否则数据不全）
//   2) 用仓库自带 pocketbase 起：serve --http=127.0.0.1:7099 --dir=<临时目录> \
//        --hooksDir=<repo>/pocketbase/pb_hooks --migrationsDir=<repo>/pocketbase/pb_migrations
//   3) node scripts/verify-account-isolation.mjs [baseUrl]
//   4) 取证完关实例、删副本
//
// 2026-11-04 实测结果（本库唯一真实跨用户数据：quotes 表 local-user×0 / sa03xruhigmthh8×3）：
//   local-user        → 200, totalItems=0
//   sa03xruhigmthh8   → 200, totalItems=3（只有自己的）
//   交集              → 空 ✓
//   local-user 越权取 B 的详情 → 403 无权操作该记录 ✓
//   未登录（空身份头）  → 401 ✓

const BASE = process.argv[2] || "http://127.0.0.1:7099"
const USER_A = "local-user"
const USER_B = "sa03xruhigmthh8"

async function listQuotes(uid) {
  const res = await fetch(`${BASE}/api/quotes?page=1&perPage=50`, {
    headers: uid ? { "X-Rh-User-Id": uid } : {},
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, total: body.totalItems, items: Array.isArray(body.items) ? body.items : [] }
}

const failures = []
const check = (name, ok, detail) => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`)
  if (!ok) failures.push(name)
}

const a = await listQuotes(USER_A)
const b = await listQuotes(USER_B)
console.log(`${USER_A}: HTTP ${a.status}, ${a.items.length} 条`)
console.log(`${USER_B}: HTTP ${b.status}, ${b.items.length} 条`)

const aIds = new Set(a.items.map((x) => x.id))
const bIds = new Set(b.items.map((x) => x.id))
const overlap = [...aIds].filter((id) => bIds.has(id))

check("两用户列表无交集（不串数据）", overlap.length === 0, overlap.length ? "交集: " + overlap.join(",") : "")
check("A 看不到 B 的记录", !bIds.size || [...bIds].every((id) => !aIds.has(id)))

if (bIds.size) {
  const bid = [...bIds][0]
  const res = await fetch(`${BASE}/api/quotes/${bid}`, { headers: { "X-Rh-User-Id": USER_A } })
  check("A 越权取 B 的详情被拒（403）", res.status === 403, `实际 HTTP ${res.status}`)
}

const anon = await listQuotes("")
check("未登录不可读私人数据（401）", anon.status === 401, `实际 HTTP ${anon.status}`)

console.log(failures.length ? `\n有 ${failures.length} 项未通过：${failures.join(" / ")}` : "\n全部通过")
process.exit(failures.length ? 1 : 0)

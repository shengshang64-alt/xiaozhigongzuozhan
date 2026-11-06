#!/usr/bin/env node
// ---------------------------------------------------------------------------
// 出口可达性验证（R2 · 整仓重构 · 部署壳）
//
// 为什么需要这个脚本：R2 的验收句是「另一台内网机打开增强功能不再默默降级」。
// 这件事**不能靠在本机浏览器点一遍**——本机的 127.0.0.1 恰好就是服务器，
// 写死地址的 bug 在本机永远复现不出来（这正是它活了这么久的原因）。
//
// 正确验法：从**出口地址**出发，检查两条同源前缀是否都能通到后端的真实服务：
//     <origin>/__pb/api/health   → PocketBase
//     <origin>/__sc/health       → sidecar（增强服务）
//
// 用法：
//   node scripts/health/verify-exit.mjs                      # 默认 http://127.0.0.1:8000
//   node scripts/health/verify-exit.mjs http://192.168.1.3:8000   # 按同事机的地址验
//
// 退出码：0 = 两条前缀都通；1 = 有不通的（会指出是哪一条、什么错）
// ---------------------------------------------------------------------------

const origin = (process.argv[2] ?? "http://127.0.0.1:8000").replace(/\/+$/, "")
const timeoutMs = Number(process.env.VERIFY_TIMEOUT_MS ?? 8000)

/** 单条探针：返回 { ok, detail }，绝不抛错（脚本要能一次报出全部问题）。 */
async function probe(path, { json = true } = {}) {
  const url = `${origin}${path}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) {
      // 404 通常意味着「出口没配这条前缀」，与「后端没起」是两件事
      const hint = res.status === 404 ? "（出口未配置该前缀，或后端路由不存在）" : ""
      return { ok: false, detail: `HTTP ${res.status}${hint}` }
    }
    if (!json) return { ok: true, detail: `HTTP ${res.status}` }
    const body = await res.json()
    return { ok: true, detail: JSON.stringify(body).slice(0, 160) }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
}

const checks = [
  {
    name: "前端页面",
    path: "/",
    json: false,
    fix: "前端没起：运行 start-local.cmd（或 npx vite --config vibex-local/vite.local.config.ts）",
  },
  {
    name: "PocketBase（/__pb）",
    path: "/__pb/api/health",
    fix: "PB 没起或 /__pb 反代缺失：确认 :7000 在跑，且出口（vite.proxy.ts / Caddy）配了 /__pb",
  },
  {
    name: "增强服务（/__sc）",
    path: "/__sc/health",
    fix: "sidecar 没起或 /__sc 反代缺失：确认 :7001 在跑（sidecar-supervisor.ps1），且出口配了 /__sc",
  },
]

console.log(`\n出口可达性验证：${origin}\n${"─".repeat(60)}`)

let failed = 0
for (const c of checks) {
  const r = await probe(c.path, { json: c.json ?? true })
  const mark = r.ok ? "✓" : "✗"
  console.log(`${mark} ${c.name.padEnd(18)} ${c.path}`)
  console.log(`    ${r.detail}`)
  if (!r.ok) {
    failed += 1
    console.log(`    → ${c.fix}`)
  }
}

console.log(`${"─".repeat(60)}`)
if (failed === 0) {
  console.log("全部可达：同事机用这个地址打开，增强功能应直接可用（不再静默降级）。\n")
} else {
  console.log(`${failed} 项不可达。按上面每项的 → 提示处理。\n`)
}
// 用 exitCode 而不是 process.exit()：Node 24 的 fetch 还持有 keep-alive 连接时
// 强退会触发 libuv 断言（win/async.c），表现为「脚本明明跑对了却崩一个异常」。
process.exitCode = failed === 0 ? 0 : 1

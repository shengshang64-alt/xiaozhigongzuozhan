// scripts/verify-team-auth.mjs — R-201 阶段A 后端链路端到端验证（开发调试用，可对本地 PB 重复执行）
// 用法: node scripts/verify-team-auth.mjs
const BASE = "http://127.0.0.1:7000"

async function req(method, path, { token, body } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body) headers["Content-Type"] = "application/json"
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  let data = null
  try { data = await res.json() } catch { /* empty */ }
  return { status: res.status, data }
}

function check(label, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`)
  if (!ok) process.exitCode = 1
}

// 1. status
const st = await req("GET", "/api/team/status")
check("GET /api/team/status", st.status === 200 && typeof st.data.needsSetup === "boolean", JSON.stringify(st.data))

// 2. setup（仅首次有效；已初始化时期望 403 already_initialized）
const su = await req("POST", "/api/team/setup", {
  body: { email: "admin@team.local", password: "Admin#12345", name: "系统管理员" },
})
check("POST /api/team/setup", su.status === 200 || (su.status === 403 && su.data.error === "already_initialized"), JSON.stringify(su.data))

// 3. 原生登录拿 token
const auth = await req("POST", "/api/collections/users/auth-with-password", {
  body: { identity: "admin@team.local", password: "Admin#12345" },
})
check("POST auth-with-password(admin)", auth.status === 200 && !!auth.data.token, `status=${auth.status}`)
const adminToken = auth.data?.token || ""
if (!adminToken) { console.log("admin token 获取失败，终止后续验证"); process.exit(1) }

// 4. 错误密码应 400
const bad = await req("POST", "/api/collections/users/auth-with-password", {
  body: { identity: "admin@team.local", password: "WrongPass123" },
})
check("POST auth-with-password(错误密码被拒)", bad.status === 400, `status=${bad.status}`)

// 5. me
const me = await req("GET", "/api/team/me", { token: adminToken })
check("GET /api/team/me(admin)", me.status === 200 && me.data.role === "admin", JSON.stringify(me.data))

// 6. me 无 token → 401
const meAnon = await req("GET", "/api/team/me")
check("GET /api/team/me(无token 401)", meAnon.status === 401, `status=${meAnon.status}`)

// 7. admin 建 viewer 成员（若已存在则登录之）
const mk = await req("POST", "/api/team/members", {
  token: adminToken,
  body: { email: "viewer@team.local", password: "Viewer#12345", name: "只读测试员", role: "viewer" },
})
check("POST /api/team/members(建 viewer)", mk.status === 200 || (mk.status === 409 && mk.data.error === "email_exists"), JSON.stringify(mk.data))

const vAuth = await req("POST", "/api/collections/users/auth-with-password", {
  body: { identity: "viewer@team.local", password: "Viewer#12345" },
})
check("POST auth-with-password(viewer)", vAuth.status === 200 && !!vAuth.data.token, `status=${vAuth.status}`)
const viewerToken = vAuth.data?.token || ""

// 8. viewer 写业务路由 → 403（服务端强制，且发生在落库前）
const vw = await req("POST", "/api/product_library", {
  token: viewerToken,
  body: { rh_user_id: "local-user", item_name: "__readonly_gate_probe__" },
})
check("viewer POST /api/product_library → 403", vw.status === 403 && vw.data?.error === "readonly_role", JSON.stringify(vw.data))

// 9. viewer 读路由不受影响
const vr = await req("GET", "/api/product_library?perPage=1")
check("viewer GET /api/product_library 200", vr.status === 200, `status=${vr.status}`)

// 10. 无 token 写不受影响（本地脚本兼容）——写入后立刻删除，不留垃圾
const nw = await req("POST", "/api/product_library", {
  body: { rh_user_id: "local-user", item_name: "__noauth_gate_probe__" },
})
check("无token POST /api/product_library 200(兼容脚本)", nw.status === 200 && !!nw.data?.id, `status=${nw.status}`)
if (nw.data?.id) await req("DELETE", `/api/product_library/${nw.data.id}`)

// 11. admin 列成员
const list = await req("GET", "/api/team/members", { token: adminToken })
check("GET /api/team/members(admin)", list.status === 200 && Array.isArray(list.data.items) && list.data.items.length >= 2, `count=${list.data?.items?.length}`)

// 12. viewer 调成员管理 → 403
const vList = await req("GET", "/api/team/members", { token: viewerToken })
check("GET /api/team/members(viewer 403)", vList.status === 403, `status=${vList.status}`)

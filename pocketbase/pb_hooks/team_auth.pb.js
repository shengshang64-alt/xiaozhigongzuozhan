/// <reference path="../pb_data/types.d.ts" />
// 团队登录与权限（R-201 阶段A）
// - 账号本体复用 PocketBase 原生 users auth collection（登录走 /api/collections/users/auth-with-password，
//   密码哈希/token 签发/续期全部由 PB 原生实现，服务端不落明文）。
// - 本文件只负责：team_members 档案集合（name/role）、首个管理员自助初始化、成员管理、token 校验、
//   viewer 角色服务端写拦截（routerUse 全局中间件）。
// - 阶段A 数据身份仍为共享池（X-Rh-User-Id=local-user），role 用于只读管控与入口显隐；
//   按 userId 的数据隔离在阶段B 实施（见 docs/02-需求规格-第二批.md R-201）。
//
// 路由（全部注册在 /api/team/*，走 __pb 代理）：
//   GET  /api/team/status   -> { needsSetup, userCount }
//   POST /api/team/setup    -> 仅当 users 为空时可用：{ email, password, name } 创建 admin
//   GET  /api/team/me       -> 校验 Authorization: Bearer <token>，返回 { id, email, name, role, active }
//   GET  /api/team/members  -> admin：成员列表
//   POST /api/team/members  -> admin：新增成员 { email, password, name, role }
//   PATCH /api/team/members/{id} -> admin：改姓名/角色/启停 { name?, role?, active? }
//
// !! PocketBase JSVM 约束：每个 handler 在独立 VM 实例中重新执行，文件顶层定义的函数/globalThis
// 挂载对 handler 内部均不可见（与 product_library 把 ensureCollLocal 内联进 handler 同一约束）。
// 因此以下所有 handler 一律自包含内联 helper，勿"优化"成顶层共享函数。

// team_members 集合在 bootstrap 建好，handler 内直接查找
onBootstrap(function (e) {
  e.next()
  try {
    try { $app.findCollectionByNameOrId("team_members"); return } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "team_members",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
        { name: "user_id", type: "text", required: true },
        { name: "name", type: "text", required: true },
        { name: "role", type: "text", required: true }, // admin | editor | viewer
        { name: "active", type: "bool" },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    try { $app.logger().info("team_members collection created") } catch (_) {}
  } catch (err) {
    try { $app.logger().error("team_auth bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// ---------------------------------------------------------------------------
// viewer 只读管控（服务端强制）：带合法 users token 且角色为 viewer 时，
// 拦截对业务路由的写操作（POST/PATCH/PUT/DELETE）。
// 无 token 请求不受影响（本地脚本/导入工具兼容）；/api/team/* 自身不拦截。
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 重要（实测坑）：JSVM 中间件里 e.next() 在下游 handler 返回错误（如 400）时会 throw。
// 若该 throw 被 try/catch 吞掉再二次调用 e.next()，会导致下游执行两次、响应变成 200 空 body
// （曾把原生 auth-with-password 的失败响应打坏）。因此 e.next()/拦截响应必须放在 try 之外。
// ---------------------------------------------------------------------------
routerUse(function (e) {
  var block = false
  try {
    var m = String(e.request.method || "").toUpperCase()
    if (m === "POST" || m === "PATCH" || m === "PUT" || m === "DELETE") {
      var path = String(e.request.url.path || "")
      if (path.indexOf("/api/") === 0 && path.indexOf("/api/team") !== 0 &&
          path.indexOf("/api/collections") !== 0 && path.indexOf("/api/health") !== 0 &&
          path.indexOf("/api/jsvm") !== 0 && path.indexOf("/api/_") !== 0 &&
          path.indexOf("/api/files") !== 0 && path.indexOf("/api/realtime") !== 0) {
        // 绝不触碰 PB 原生路由（requestInfo() 会消费 body，破坏原生表单绑定）
        var hh = (e.requestInfo() || {}).headers || {}
        var hv = hh["authorization"] || ""
        var token = String(Array.isArray(hv) ? (hv[0] || "") : hv).replace(/^Bearer\s+/i, "").trim()
        if (token) {
          var rec = $app.findAuthRecordByToken(token)
          if (rec) {
            var uid = String(rec.id)
            // token 必须属于 users 集合（Record 绑定无 collectionName 属性，用 findRecordById 验证归属）
            $app.findRecordById("users", uid)
            var found = $app.findRecordsByFilter("team_members", "user_id = {:uid}", "-created", 1, 0, { uid: uid })
            if (found.length > 0 && String(found[0].get("role")) === "viewer") block = true
          }
        }
      }
    }
  } catch (_) { /* 判定异常按放行处理 */ }
  if (block) return e.json(403, { error: "readonly_role", message: "当前账号为只读角色，无法执行写操作" })
  return e.next()
})

// GET /api/team/status
routerAdd("GET", "/api/team/status", function (e) {
  try {
    var n = -1
    try { n = $app.findRecordsByFilter("users", "", "-created", 1, 0).length } catch (_) { n = -1 }
    return e.json(200, { needsSetup: n === 0, userCount: n < 0 ? 0 : n })
  } catch (err) {
    return e.json(500, { error: "status_failed", message: String(err && err.message || err) })
  }
})

// POST /api/team/setup — 仅当 users 为空时可执行（首个管理员自助初始化）
routerAdd("POST", "/api/team/setup", function (e) {
  try {
    var n = -1
    try { n = $app.findRecordsByFilter("users", "", "-created", 1, 0).length } catch (_) { n = -1 }
    if (n !== 0) return e.json(403, { error: "already_initialized", message: "系统已完成初始化" })
    var body = e.requestInfo().body || {}
    var email = String(body.email || "").trim().toLowerCase()
    var password = String(body.password || "")
    var name = String(body.name || "").trim()
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return e.json(400, { error: "invalid_email", message: "邮箱格式不正确" })
    if (password.length < 8) return e.json(400, { error: "weak_password", message: "密码至少 8 位" })
    if (!name) return e.json(400, { error: "invalid_name", message: "请填写姓名" })
    var usersColl = $app.findCollectionByNameOrId("users")
    var rec = new Record(usersColl)
    rec.set("email", email)
    rec.setPassword(password)
    $app.save(rec)
    var mrec = new Record($app.findCollectionByNameOrId("team_members"))
    mrec.set("user_id", String(rec.id))
    mrec.set("name", name)
    mrec.set("role", "admin")
    mrec.set("active", true)
    $app.save(mrec)
    return e.json(200, { ok: true, userId: String(rec.id) })
  } catch (err) {
    return e.json(500, { error: "setup_failed", message: String(err && err.message || err) })
  }
})

// GET /api/team/me — 校验 Bearer token 返回当前登录人档案
routerAdd("GET", "/api/team/me", function (e) {
  try {
    var hh = (e.requestInfo() || {}).headers || {}
    var hv = hh["authorization"] || hh["Authorization"] || ""
    var token = String(Array.isArray(hv) ? (hv[0] || "") : hv).replace(/^Bearer\s+/i, "").trim()
    if (!token) return e.json(401, { error: "unauthorized", message: "请先登录" })
    var rec = null
    try { rec = $app.findAuthRecordByToken(token) } catch (_) { rec = null }
    if (!rec) return e.json(401, { error: "unauthorized", message: "登录状态已失效，请重新登录" })
    var uid = String(rec.id)
    try { $app.findRecordById("users", uid) } catch (_) {
      return e.json(401, { error: "unauthorized", message: "登录状态已失效，请重新登录" })
    }
    var email = ""
    try { email = String(rec.getString("email") || "") } catch (_) { email = "" }
    var m = null
    try {
      var mine = $app.findRecordsByFilter("team_members", "user_id = {:uid}", "-created", 1, 0, { uid: uid })
      m = mine.length > 0 ? mine[0] : null
    } catch (_) { m = null }
    return e.json(200, {
      id: uid, email: email,
      name: m ? String(m.get("name")) : email,
      role: m ? String(m.get("role")) : "viewer",
      active: m ? Boolean(m.get("active")) : false,
    })
  } catch (err) {
    return e.json(500, { error: "me_failed", message: String(err && err.message || err) })
  }
})

// GET /api/team/members — admin 成员列表
routerAdd("GET", "/api/team/members", function (e) {
  try {
    // requireAdmin 内联（handler 独立 VM 约束）
    var hh = (e.requestInfo() || {}).headers || {}
    var hv = hh["authorization"] || hh["Authorization"] || ""
    var token = String(Array.isArray(hv) ? (hv[0] || "") : hv).replace(/^Bearer\s+/i, "").trim()
    if (!token) return e.json(401, { error: "unauthorized", message: "请先登录" })
    var caller = null
    try { caller = $app.findAuthRecordByToken(token) } catch (_) { caller = null }
    if (!caller) return e.json(401, { error: "unauthorized", message: "登录状态已失效，请重新登录" })
    try { $app.findRecordById("users", String(caller.id)) } catch (_) {
      return e.json(401, { error: "unauthorized", message: "登录状态已失效，请重新登录" })
    }
    var myProfile = null
    try {
      var mine = $app.findRecordsByFilter("team_members", "user_id = {:uid}", "-created", 1, 0, { uid: String(caller.id) })
      myProfile = mine.length > 0 ? mine[0] : null
    } catch (_) { myProfile = null }
    if (!myProfile || String(myProfile.get("role")) !== "admin" || !Boolean(myProfile.get("active"))) {
      return e.json(403, { error: "forbidden", message: "仅管理员可执行此操作" })
    }
    var recs = $app.findRecordsByFilter("team_members", "", "-created", 200, 0)
    var items = []
    for (var i = 0; i < recs.length; i++) {
      items.push({
        id: String(recs[i].id),
        user_id: String(recs[i].get("user_id")),
        name: String(recs[i].get("name")),
        role: String(recs[i].get("role")),
        active: Boolean(recs[i].get("active")),
      })
    }
    return e.json(200, { items: items })
  } catch (err) {
    return e.json(500, { error: "members_list_failed", message: String(err && err.message || err) })
  }
})

// POST /api/team/members — admin 新增成员 { email, password, name, role }
routerAdd("POST", "/api/team/members", function (e) {
  try {
    var hh = (e.requestInfo() || {}).headers || {}
    var hv = hh["authorization"] || hh["Authorization"] || ""
    var token = String(Array.isArray(hv) ? (hv[0] || "") : hv).replace(/^Bearer\s+/i, "").trim()
    if (!token) return e.json(401, { error: "unauthorized", message: "请先登录" })
    var caller = null
    try { caller = $app.findAuthRecordByToken(token) } catch (_) { caller = null }
    if (!caller) return e.json(401, { error: "unauthorized", message: "登录状态已失效，请重新登录" })
    try { $app.findRecordById("users", String(caller.id)) } catch (_) {
      return e.json(401, { error: "unauthorized", message: "登录状态已失效，请重新登录" })
    }
    var myProfile = null
    try {
      var mine = $app.findRecordsByFilter("team_members", "user_id = {:uid}", "-created", 1, 0, { uid: String(caller.id) })
      myProfile = mine.length > 0 ? mine[0] : null
    } catch (_) { myProfile = null }
    if (!myProfile || String(myProfile.get("role")) !== "admin" || !Boolean(myProfile.get("active"))) {
      return e.json(403, { error: "forbidden", message: "仅管理员可执行此操作" })
    }
    var body = e.requestInfo().body || {}
    var email = String(body.email || "").trim().toLowerCase()
    var password = String(body.password || "")
    var name = String(body.name || "").trim()
    var role = String(body.role || "editor")
    if (["admin", "editor", "viewer"].indexOf(role) === -1) role = "editor"
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return e.json(400, { error: "invalid_email", message: "邮箱格式不正确" })
    if (password.length < 8) return e.json(400, { error: "weak_password", message: "密码至少 8 位" })
    if (!name) return e.json(400, { error: "invalid_name", message: "请填写姓名" })
    try {
      var dup = $app.findRecordsByFilter("users", "email = {:em}", "-created", 1, 0, { em: email })
      if (dup.length > 0) return e.json(409, { error: "email_exists", message: "该邮箱已注册" })
    } catch (_) {}
    var usersColl = $app.findCollectionByNameOrId("users")
    var rec = new Record(usersColl)
    rec.set("email", email)
    rec.setPassword(password)
    $app.save(rec)
    var mrec = new Record($app.findCollectionByNameOrId("team_members"))
    mrec.set("user_id", String(rec.id))
    mrec.set("name", name)
    mrec.set("role", role)
    mrec.set("active", true)
    $app.save(mrec)
    return e.json(200, { ok: true, userId: String(rec.id) })
  } catch (err) {
    return e.json(500, { error: "member_create_failed", message: String(err && err.message || err) })
  }
})

// PATCH /api/team/members/{id} — admin 改姓名/角色/启停
routerAdd("PATCH", "/api/team/members/{id}", function (e) {
  try {
    var hh = (e.requestInfo() || {}).headers || {}
    var hv = hh["authorization"] || hh["Authorization"] || ""
    var token = String(Array.isArray(hv) ? (hv[0] || "") : hv).replace(/^Bearer\s+/i, "").trim()
    if (!token) return e.json(401, { error: "unauthorized", message: "请先登录" })
    var caller = null
    try { caller = $app.findAuthRecordByToken(token) } catch (_) { caller = null }
    if (!caller) return e.json(401, { error: "unauthorized", message: "登录状态已失效，请重新登录" })
    try { $app.findRecordById("users", String(caller.id)) } catch (_) {
      return e.json(401, { error: "unauthorized", message: "登录状态已失效，请重新登录" })
    }
    var myProfile = null
    try {
      var mine = $app.findRecordsByFilter("team_members", "user_id = {:uid}", "-created", 1, 0, { uid: String(caller.id) })
      myProfile = mine.length > 0 ? mine[0] : null
    } catch (_) { myProfile = null }
    if (!myProfile || String(myProfile.get("role")) !== "admin" || !Boolean(myProfile.get("active"))) {
      return e.json(403, { error: "forbidden", message: "仅管理员可执行此操作" })
    }
    var id = e.request.pathValue("id")
    var rec = null
    try { rec = $app.findRecordById("team_members", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var body = e.requestInfo().body || {}
    // R47/F19（团队管理误操作护栏）：在应用变更前拦两种“权限减少”操作——
    // 1) 不能停用/改角色自己的档案（前端 isSelf 只是藏按钮，这里防直连接口把自己锁出门）；
    // 2) 不能停用/降级最后一个可用管理员（否则 /api/team/* 写接口全 403，系统无法自救）。
    // 改姓名、对非最后管理员的常规启停/升降级均不受影响；不新增字段、不改集合 schema。
    var willActive = body.active !== undefined ? Boolean(body.active) : Boolean(rec.get("active"))
    var willRole = String(rec.get("role"))
    if (body.role !== undefined && ["admin", "editor", "viewer"].indexOf(String(body.role)) !== -1) willRole = String(body.role)
    var losesAdminRights = (Boolean(rec.get("active")) && !willActive) || (String(rec.get("role")) === "admin" && willRole !== "admin")
    if (losesAdminRights) {
      if (String(rec.get("user_id")) === String(caller.id)) {
        return e.json(400, { error: "self_lockout", message: "不能停用或修改自己的账号角色，如需移交权限请先由其他管理员操作" })
      }
      var admins = []
      try { admins = $app.findRecordsByFilter("team_members", "role = 'admin' && active = true", "-created", 50, 0) } catch (_) { admins = [] }
      var otherActiveAdmins = 0
      for (var ai = 0; ai < admins.length; ai++) { if (String(admins[ai].id) !== String(rec.id)) otherActiveAdmins++ }
      if (otherActiveAdmins === 0) {
        return e.json(400, { error: "last_admin", message: "该账号是最后一个可用管理员，停用或降级会导致团队失去管理权限，已拦截" })
      }
    }
    if (body.name !== undefined && String(body.name).trim()) rec.set("name", String(body.name).trim())
    if (body.role !== undefined && ["admin", "editor", "viewer"].indexOf(String(body.role)) !== -1) rec.set("role", String(body.role))
    if (body.active !== undefined) rec.set("active", Boolean(body.active))
    $app.save(rec)
    return e.json(200, { ok: true })
  } catch (err) {
    return e.json(500, { error: "member_update_failed", message: String(err && err.message || err) })
  }
})

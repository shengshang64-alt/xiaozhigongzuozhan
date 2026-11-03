/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/zx_guard.pb.js — 全站统一身份守卫 + 数据库每日自动备份
//
// 身份约定（R43 收敛：全站唯一取值处 = 本文件顶部的 routerUse 中间件）：
//  - 只信 vibex 网关注入（本地由前端 vibexAuthHeaders 携带）的 X-Rh-User-Id 头，
//    客户端 query/body 里的 rh_user_id 一律不再作为身份依据（IDOR 修复核心）。
//  - 中间件把规整后的身份写进请求上下文（e.set("rhUserId", ...)），所有 handler 统一
//    用 e.get("rhUserId") 读取；缺失/空串 = 未登录，由各路由自行 401。改口径只动这一处。
//  - 收敛前 40 个钩子各自内联了 182 份「读头 → 规整」副本 —— 因为 PocketBase 每个
//    handler 跑在独立 VM 隔离里，文件级 function/var 在 handler 内不可见（实测：
//    文件级 const/var/function 一律 ReferenceError，globalThis 不跨隔离）。
//    R43 起副本全部删除，改由中间件一处取值。
//  - zxReqUser(e)：参考实现（读中间件值）；zxIsOwner(rec, uid)：记录归属判断。
//
// 备份策略（不使用 cronAdd，遵守 pb-hook-lint 红线）：
//  - PB 启动时（onBootstrap）+ 情报中心 tick 轮（每日惰性检查）+ 手动 GET /api/zx/backup。
//  - VACUUM INTO 生成一致性快照（WAL 模式下安全），文件名 data-YYYY-MM-DD.db，每天一份；
//    保留最近 KEEP_BACKUPS 份，更旧的自动清理。
//  - 只用 var / function；5xx 一律 { error, message, fingerprint }。

// ---------------------------------------------------------------------------
// 身份中间件：全站唯一取值处（R43）
//   每个请求进入时读一次 X-Rh-User-Id，规整为「去控制字符 → trim → 截 64 字符」，
//   写进请求上下文。缺失/空串记为空串（= 未登录），各路由据此自行 401。
//   测试锚点：scripts/pbHooksIdentity.test.ts 抽取本标记之间的代码直接执行，
//   锁死口径（头名优先级 / 控制字符 / 空白 / 长度截断 / e.next() 续链）。
// ---------------------------------------------------------------------------
// __ZX_IDENTITY_MIDDLEWARE_BEGIN__
routerUse(function (e) {
  var h = (e.requestInfo() || {}).headers || {}
  var raw = h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || ""
  e.set("rhUserId", String(raw == null ? "" : raw).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64))
  return e.next()
})
// __ZX_IDENTITY_MIDDLEWARE_END__
var ZX_KEEP_BACKUPS = 7

// ---------------------------------------------------------------------------
// 身份 helper（参考实现；业务钩子统一走中间件注入的 e.get("rhUserId")）
// ---------------------------------------------------------------------------

function zxReqUser(e) {
  return String(e.get("rhUserId") || "")
}

function zxUnauthJson(e) {
  return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
}

function zxIsOwner(rec, uid) {
  if (!uid) return false
  var fields = ["rh_user_id", "owner_id"]
  for (var i = 0; i < fields.length; i++) {
    try {
      if (String(rec.get(fields[i]) || "") === uid) return true
    } catch (_) {}
  }
  return false
}

// ---------------------------------------------------------------------------
// 备份参考实现（仅供文档参考；因 PB Goja prewarm 机制，handler 无法调用
// 文件级 function，实际备份逻辑已内联到 onBootstrap 和 /api/zx/backup 中）
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 启动即备份一次（异步安全：VACUUM INTO 是库内一致读，不阻塞其他请求太久）
// ---------------------------------------------------------------------------

onBootstrap(function (e) {
  e.next()
  try {
    // 启动时异步触发备份（内联全部逻辑，不依赖文件级函数）
    var today = new Date().toISOString().slice(0, 10)
    var dir = $filepath.join(String($app.dataDir()), "backups")
    try { $os.mkdirAll(dir, 511) } catch (_) {}
    var dest = $filepath.join(dir, "data-" + today + ".db")
    try { $os.stat(dest) } catch (_) {
      var tmp = dest + ".tmp"
      try { $os.remove(tmp) } catch (_) {}
      $app.db().newQuery("VACUUM INTO '" + String(tmp).replace(/'/g, "''") + "'").execute()
      $os.rename(tmp, dest)
      try { $app.logger().info("zx backup created: " + dest) } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("zx bootstrap backup: " + String(err && err.message || err)) } catch (_) {}
  }
})

// ---------------------------------------------------------------------------
// GET /api/zx/backup — 登录用户可查备份状态（顺带触发今日备份）
// ---------------------------------------------------------------------------

routerAdd("GET", "/api/zx/backup", function (e) {
  try {
    // 身份从中间件注入的请求上下文读取（PB Goja handler 不保留文件级作用域）
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    // 内联备份逻辑
    var today = new Date().toISOString().slice(0, 10)
    var dir = $filepath.join(String($app.dataDir()), "backups")
    try { $os.mkdirAll(dir, 511) } catch (_) {}
    var dest = $filepath.join(dir, "data-" + today + ".db")
    var res
    try { $os.stat(dest); res = { ok: true, skipped: true, file: dest } } catch (_) {
      var tmp = dest + ".tmp"
      try { $os.remove(tmp) } catch (_) {}
      $app.db().newQuery("VACUUM INTO '" + String(tmp).replace(/'/g, "''") + "'").execute()
      $os.rename(tmp, dest)
      // prune
      var names = []
      try {
        var entries = $os.readDir(dir)
        for (var pi = 0; pi < entries.length; pi++) {
          var pn = String(entries[pi].name())
          if (/^data-\d{4}-\d{2}-\d{2}\.db$/.test(pn)) names.push(pn)
        }
      } catch (_) {}
      names.sort()
      while (names.length > 7) { var old = names.shift(); try { $os.remove($filepath.join(dir, old)) } catch (_) {} }
      res = { ok: true, file: dest }
    }
    var files = []
    try {
      var entries2 = $os.readDir(dir)
      for (var i = 0; i < entries2.length; i++) {
        var n = String(entries2[i].name())
        if (/^data-\d{4}-\d{2}-\d{2}\.db$/.test(n)) {
          var size = 0
          try { size = Number(entries2[i].info().size()) } catch (_) {}
          files.push({ name: n, bytes: size })
        }
      }
    } catch (_) {}
    files.sort(function (a, b) { return a.name < b.name ? 1 : -1 })
    return e.json(200, { ok: true, backup: res, keep: 7, files: files })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "backup_status_failed", message: "读取备份状态失败，请稍后重试", fingerprint: "zx-backup-" + String(err && err.message || err).replace(/[^a-zA-Z0-9]/g, "_").slice(0, 80) })
  }
})

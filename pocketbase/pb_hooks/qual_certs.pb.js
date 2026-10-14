// pb_hooks/qual_certs.pb.js — 资质证书台账 + 到期预警（2026-09-28 路线图最高价值项）
//
// 背景：投标材料里最容易出事的不是方案，是证书过期（docs/06 §一.1：一旦漏了或过期直接废标）。
// 结构化台账：证照名/类别/编号/发证机关/有效期起止/适用范围/对外可提供/关联文件。
// 到期三档预警：已过期 / ≤30天(critical) / ≤90天(warning)，summary 路由一次返回。
//
// 安全约定（与 product_library.pb.js 同款）：
//  - 身份只认 vibex 网关注入的 X-Rh-User-Id，缺失一律 401；行级隔离 rh_user_id
//  - get/update/delete 校验记录归属；5xx 一律 { error, message, fingerprint } 三字段
//  - ⚠️ 重要：PB 会把回调重定位到生成的 pb.js 执行，文件顶层作用域对回调不可见——
//    所有 helper 必须**内联在每个回调内部**（zx_guard 顶层常量即因此从未生效）。
//    onBootstrap 自愈建表 + 各路由内 ensureCollLocal（幂等，只增不改，不触碰其他集合）。

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("qual_certs") } catch (_) { existing = null }
    if (existing) {
      var changed = false
      function hasField(name) {
        try { return !!existing.fields.getByName(name) } catch (_) {}
        try {
          for (var i = 0; i < existing.fields.length; i++) {
            if (String(existing.fields[i].name) === String(name)) return true
          }
        } catch (_) {}
        return false
      }
      var FIELDS1 = [
        { name: "rh_user_id", type: "text", required: true },
        { name: "cert_name", type: "text", required: true },
        { name: "category", type: "text" },
        { name: "cert_no", type: "text" },
        { name: "issuer", type: "text" },
        { name: "valid_from", type: "text" },
        { name: "valid_to", type: "text" },
        { name: "scope", type: "text" },
        { name: "external_ok", type: "bool" },
        { name: "file_ref", type: "text" },
        { name: "notes", type: "text" },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ]
      for (var fi = 0; fi < FIELDS1.length; fi++) {
        if (!hasField(FIELDS1[fi].name)) {
          try { existing.fields.add(new Field(FIELDS1[fi])); changed = true } catch (_) {}
        }
      }
      if (changed) {
        $app.save(existing)
        try { $app.logger().info("qual_certs collection upgraded") } catch (_) {}
      }
    } else {
      var col0 = new Collection({
        type: "base",
        name: "qual_certs",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: "rh_user_id", type: "text", required: true },
          { name: "cert_name", type: "text", required: true },
          { name: "category", type: "text" },
          { name: "cert_no", type: "text" },
          { name: "issuer", type: "text" },
          { name: "valid_from", type: "text" },
          { name: "valid_to", type: "text" },
          { name: "scope", type: "text" },
          { name: "external_ok", type: "bool" },
          { name: "file_ref", type: "text" },
          { name: "notes", type: "text" },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col0)
      try { $app.logger().info("qual_certs collection created") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("qual_certs bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

function qualUid(e) {
  return String(e.get("rhUserId") || "")
}

// GET /api/qual_certs?page=1&perPage=100&category=... — 本人台账列表（按 valid_to 升序，临期在前）
routerAdd("GET", "/api/qual_certs", function (e) {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    try { $app.findCollectionByNameOrId("qual_certs") } catch (_) {
      var col = new Collection({
        type: "base", name: "qual_certs",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: "rh_user_id", type: "text", required: true },
          { name: "cert_name", type: "text", required: true },
          { name: "category", type: "text" },
          { name: "cert_no", type: "text" },
          { name: "issuer", type: "text" },
          { name: "valid_from", type: "text" },
          { name: "valid_to", type: "text" },
          { name: "scope", type: "text" },
          { name: "external_ok", type: "bool" },
          { name: "file_ref", type: "text" },
          { name: "notes", type: "text" },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
    }
    var query = (e.requestInfo() || {}).query || {}
    var page = parseInt(String(query.page || "1"), 10) || 1
    var perPage = parseInt(String(query.perPage || "100"), 10) || 100
    if (perPage > 500) perPage = 500
    var filterParts = ["rh_user_id = {:rh_user_id}"]
    var params = { rh_user_id: uid }
    if (query.category !== undefined && query.category !== "") {
      filterParts.push("category = {:category}")
      params.category = String(query.category)
    }
    var records = $app.findRecordsByFilter("qual_certs", filterParts.join(" && "), "valid_to", perPage, (page - 1) * perPage, params)
    var items = []
    for (var i = 0; i < records.length; i++) items.push(records[i].publicExport())
    var totalItems = items.length
    try {
      var countRecords = $app.findRecordsByFilter("qual_certs", filterParts.join(" && "), "valid_to", 100000, 0, params)
      totalItems = countRecords.length
    } catch (err2) {}
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: totalItems })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("qual_certs list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// GET /api/qual_certs/summary — 到期三档统计（必须在 /{id} 路由之前注册）
routerAdd("GET", "/api/qual_certs/summary", function (e) {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    try { $app.findCollectionByNameOrId("qual_certs") } catch (_) {
      var col = new Collection({
        type: "base", name: "qual_certs",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: "rh_user_id", type: "text", required: true },
          { name: "cert_name", type: "text", required: true },
          { name: "category", type: "text" },
          { name: "cert_no", type: "text" },
          { name: "issuer", type: "text" },
          { name: "valid_from", type: "text" },
          { name: "valid_to", type: "text" },
          { name: "scope", type: "text" },
          { name: "external_ok", type: "bool" },
          { name: "file_ref", type: "text" },
          { name: "notes", type: "text" },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
    }
    var records = $app.findRecordsByFilter("qual_certs", "rh_user_id = {:rh_user_id}", "valid_to", 500, 0, { rh_user_id: uid })
    var buckets = { expired: 0, critical: 0, warning: 0, ok: 0, unknown: 0 }
    var alerts = []
    // R228(r2-r010)：改与客户端一致的本地零点，消除 00:00-08:00 UTC 与本地日期错位导致的分档漂移
    var _nowD = new Date()
    _nowD.setHours(0, 0, 0, 0)
    var todayMs = _nowD.getTime()
    for (var i = 0; i < records.length; i++) {
      var r = records[i]
      var validTo = String(r.get("valid_to") || "").trim()
      var b = "unknown"
      if (validTo) {
        var toMs = new Date(validTo + "T00:00:00").getTime()
        if (!isNaN(toMs)) {
          var days = Math.round((toMs - todayMs) / 86400000)
          if (days < 0) b = "expired"
          else if (days <= 30) b = "critical"
          else if (days <= 90) b = "warning"
          else b = "ok"
        }
      }
      buckets[b] += 1
      if (b === "expired" || b === "critical" || b === "warning") {
        alerts.push({
          id: r.id,
          cert_name: String(r.get("cert_name") || ""),
          category: String(r.get("category") || ""),
          valid_to: validTo,
          bucket: b,
          days_left: b === "expired" ? null : Math.round((new Date(validTo + "T00:00:00").getTime() - todayMs) / 86400000),
        })
      }
    }
    alerts.sort(function (a, b2) {
      var wa = a.bucket === "expired" ? -1 : 1
      var wb = b2.bucket === "expired" ? -1 : 1
      if (wa !== wb) return wa - wb
      return (a.days_left === null ? 99999 : a.days_left) - (b2.days_left === null ? 99999 : b2.days_left)
    })
    return e.json(200, { ok: true, total: records.length, buckets: buckets, alerts: alerts })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("qual_certs summary: " + msg) } catch (_) {}
    return e.json(500, { error: "summary_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// POST /api/qual_certs — 新增（cert_name 必填）
routerAdd("POST", "/api/qual_certs", function (e) {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    try { $app.findCollectionByNameOrId("qual_certs") } catch (_) {
      var col = new Collection({
        type: "base", name: "qual_certs",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: "rh_user_id", type: "text", required: true },
          { name: "cert_name", type: "text", required: true },
          { name: "category", type: "text" },
          { name: "cert_no", type: "text" },
          { name: "issuer", type: "text" },
          { name: "valid_from", type: "text" },
          { name: "valid_to", type: "text" },
          { name: "scope", type: "text" },
          { name: "external_ok", type: "bool" },
          { name: "file_ref", type: "text" },
          { name: "notes", type: "text" },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
    }
    var body = (e.requestInfo() || {}).body || {}
    var certName = String(body.cert_name || "").trim()
    if (!certName) return e.json(400, { error: "cert_name_required", message: "证照名称不能为空" })
    var rec = new Record($app.findCollectionByNameOrId("qual_certs"))
    rec.set("rh_user_id", uid)
    rec.set("cert_name", certName.slice(0, 120))
    rec.set("category", String(body.category || "").trim().slice(0, 40))
    rec.set("cert_no", String(body.cert_no || "").trim().slice(0, 120))
    rec.set("issuer", String(body.issuer || "").trim().slice(0, 160))
    rec.set("valid_from", String(body.valid_from || "").trim().slice(0, 10))
    rec.set("valid_to", String(body.valid_to || "").trim().slice(0, 10))
    rec.set("scope", String(body.scope || "").trim().slice(0, 200))
    rec.set("external_ok", body.external_ok === true)
    rec.set("file_ref", String(body.file_ref || "").trim().slice(0, 300))
    rec.set("notes", String(body.notes || "").trim().slice(0, 1000))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("qual_certs create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// GET /api/qual_certs/{id}
routerAdd("GET", "/api/qual_certs/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("qual_certs", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    if (String(rec.get("rh_user_id") || "") !== uid) return e.json(403, { error: "forbidden", message: "无权操作该记录" })
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "get_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// PATCH /api/qual_certs/{id} — 局部更新
routerAdd("PATCH", "/api/qual_certs/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var rec = null
    try { rec = $app.findRecordById("qual_certs", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    if (String(rec.get("rh_user_id") || "") !== uid) return e.json(403, { error: "forbidden", message: "无权操作该记录" })
    var body = (e.requestInfo() || {}).body || {}
    var strFields = ["cert_name", "category", "cert_no", "issuer", "valid_from", "valid_to", "scope", "file_ref", "notes"]
    var limits = { cert_name: 120, category: 40, cert_no: 120, issuer: 160, valid_from: 10, valid_to: 10, scope: 200, file_ref: 300, notes: 1000 }
    for (var si = 0; si < strFields.length; si++) {
      var f = strFields[si]
      if (body[f] !== undefined) rec.set(f, String(body[f] || "").trim().slice(0, limits[f]))
    }
    if (body.external_ok !== undefined) rec.set("external_ok", body.external_ok === true)
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// DELETE /api/qual_certs/{id}
routerAdd("DELETE", "/api/qual_certs/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var rec = null
    try { rec = $app.findRecordById("qual_certs", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    if (String(rec.get("rh_user_id") || "") !== uid) return e.json(403, { error: "forbidden", message: "无权操作该记录" })
    $app.delete(rec)
    return e.json(200, { ok: true })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "delete_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

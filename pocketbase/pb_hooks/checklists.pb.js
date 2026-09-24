/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/checklists.pb.js — 业务 collection + REST CRUD 路由 (self-contained)
//
// 由 mcp__rh-pb-hooks__install_business_collection 装. 不要直接 Read+Write 这个文件.
// 业务字段: rh_user_id:text, checklist_name:text, hospital:text, rating_targets:json, source_mode:text, customer_raw:text, items:json, total_amount:number, status:text
// 路由: list,get,create,update,delete
// list filter 字段: rh_user_id
// list 默认排序: -updated

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("checklists") } catch (_) { existing = null }
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
      function addField(def) {
        if (hasField(def.name)) return
        try { existing.fields.add(new Field(def)); changed = true } catch (_) {}
      }
      addField({ name: 'rh_user_id', type: 'text', required: true })
      addField({ name: 'checklist_name', type: 'text', required: true })
      addField({ name: 'hospital', type: 'text' })
      addField({ name: 'rating_targets', type: 'json' })
      addField({ name: 'source_mode', type: 'text' })
      addField({ name: 'customer_raw', type: 'text' })
      addField({ name: 'items', type: 'json' })
      addField({ name: 'total_amount', type: 'number' })
      addField({ name: 'status', type: 'text' })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) {
        $app.save(existing)
        try { $app.logger().info("checklists collection upgraded") } catch (_) {}
      }
    } else {
      var col = new Collection({
        type: "base",
        name: "checklists",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'checklist_name', type: 'text', required: true },
          { name: 'hospital', type: 'text' },
          { name: 'rating_targets', type: 'json' },
          { name: 'source_mode', type: 'text' },
          { name: 'customer_raw', type: 'text' },
          { name: 'items', type: 'json' },
          { name: 'total_amount', type: 'number' },
          { name: 'status', type: 'text' },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
      try { $app.logger().info("checklists collection created") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("checklists bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/checklists?page=1&perPage=50&sort=-created&rh_user_id=...
routerAdd("GET", "/api/checklists", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("checklists") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "checklists",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'checklist_name', type: 'text', required: true },
          { name: 'hospital', type: 'text' },
          { name: 'rating_targets', type: 'json' },
          { name: 'source_mode', type: 'text' },
          { name: 'customer_raw', type: 'text' },
          { name: 'items', type: 'json' },
          { name: 'total_amount', type: 'number' },
          { name: 'status', type: 'text' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("checklists")
  }
  try {
    ensureCollLocal()
    var info = e.requestInfo()
    var query = info.query || {}
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var page = parseInt(String(query.page || "1"), 10) || 1
    var perPage = parseInt(String(query.perPage || "50"), 10) || 50
    if (perPage > 200) perPage = 200
    var sort = String(query.sort || "-updated")
    var filterParts = []
    var params = {}
    filterParts.push("rh_user_id = {:rh_user_id}")
      params.rh_user_id = __uid
    var filter = filterParts.length > 0 ? filterParts.join(" && ") : ""
    var records = filter
      ? $app.findRecordsByFilter("checklists", filter, sort, perPage, (page - 1) * perPage, params)
      : $app.findRecordsByFilter("checklists", "", sort, perPage, (page - 1) * perPage)
    var items = []
    for (var i = 0; i < records.length; i++) {
      items.push(records[i].publicExport())
    }
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: items.length })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("checklists list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// GET /api/checklists/{id}
routerAdd("GET", "/api/checklists/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("checklists", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var __own = false
    try { __own = (String(rec.get("rh_user_id")||"") === __uid) } catch(_x) {}
    if (!__own) { try { __own = (String(rec.get("owner_id")||"") === __uid) } catch(_x) {} }
    if (!__own) return e.json(403, { error: "forbidden", message: "无权操作该记录" })
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "get_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// POST /api/checklists  body 字段: rh_user_id, checklist_name, hospital, rating_targets, source_mode, customer_raw, items, total_amount, status
routerAdd("POST", "/api/checklists", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("checklists") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "checklists",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'checklist_name', type: 'text', required: true },
          { name: 'hospital', type: 'text' },
          { name: 'rating_targets', type: 'json' },
          { name: 'source_mode', type: 'text' },
          { name: 'customer_raw', type: 'text' },
          { name: 'items', type: 'json' },
          { name: 'total_amount', type: 'number' },
          { name: 'status', type: 'text' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("checklists")
  }
  try {
    var coll = ensureCollLocal()
    var body = e.requestInfo().body || {}
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var rec = new Record(coll)
    rec.set("rh_user_id", __uid)
    rec.set("checklist_name", body.checklist_name === undefined || body.checklist_name === null ? "" : String(body.checklist_name))
    rec.set("hospital", body.hospital === undefined || body.hospital === null ? "" : String(body.hospital))
    rec.set("rating_targets", body.rating_targets)
    rec.set("source_mode", body.source_mode === undefined || body.source_mode === null ? "" : String(body.source_mode))
    rec.set("customer_raw", body.customer_raw === undefined || body.customer_raw === null ? "" : String(body.customer_raw))
    rec.set("items", body.items)
    rec.set("total_amount", (body.total_amount === undefined || body.total_amount === null) ? 0 : Number(body.total_amount))
    rec.set("status", body.status === undefined || body.status === null ? "" : String(body.status))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("checklists create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// PATCH /api/checklists/{id}  body 字段同 POST, 只更新 body 里出现的字段
routerAdd("PATCH", "/api/checklists/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("checklists", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var __own = false
    try { __own = (String(rec.get("rh_user_id")||"") === __uid) } catch(_x) {}
    if (!__own) { try { __own = (String(rec.get("owner_id")||"") === __uid) } catch(_x) {} }
    if (!__own) return e.json(403, { error: "forbidden", message: "无权操作该记录" })
    var body = e.requestInfo().body || {}
    // IDOR fix: owner transfer disabled
    if ("checklist_name" in body) rec.set("checklist_name", body.checklist_name === undefined || body.checklist_name === null ? "" : String(body.checklist_name))
    if ("hospital" in body) rec.set("hospital", body.hospital === undefined || body.hospital === null ? "" : String(body.hospital))
    if ("rating_targets" in body) rec.set("rating_targets", body.rating_targets)
    if ("source_mode" in body) rec.set("source_mode", body.source_mode === undefined || body.source_mode === null ? "" : String(body.source_mode))
    if ("customer_raw" in body) rec.set("customer_raw", body.customer_raw === undefined || body.customer_raw === null ? "" : String(body.customer_raw))
    if ("items" in body) rec.set("items", body.items)
    if ("total_amount" in body) rec.set("total_amount", (body.total_amount === undefined || body.total_amount === null) ? 0 : Number(body.total_amount))
    if ("status" in body) rec.set("status", body.status === undefined || body.status === null ? "" : String(body.status))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// DELETE /api/checklists/{id}
routerAdd("DELETE", "/api/checklists/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("checklists", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var __own = false
    try { __own = (String(rec.get("rh_user_id")||"") === __uid) } catch(_x) {}
    if (!__own) { try { __own = (String(rec.get("owner_id")||"") === __uid) } catch(_x) {} }
    if (!__own) return e.json(403, { error: "forbidden", message: "无权操作该记录" })
    $app.delete(rec)
    return e.json(200, { ok: true })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "delete_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

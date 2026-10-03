/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/opportunities.pb.js — 业务 collection + REST CRUD 路由 (self-contained)
//
// 由 mcp__rh-pb-hooks__install_business_collection 装. 不要直接 Read+Write 这个文件.
// 业务字段: rh_user_id:text, customer_id:text, customer_name:text, opp_name:text, stage:text, expected_amount:number, expected_close_date:text, next_action:text, ref_type:text, ref_id:text, ref_name:text, lost_reason:text, notes:text, next_follow_date:text
// 路由: list,get,create,update,delete
// list filter 字段: rh_user_id,customer_id,stage
// list 默认排序: -updated

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("opportunities") } catch (_) { existing = null }
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
      addField({ name: 'customer_id', type: 'text', required: true })
      addField({ name: 'customer_name', type: 'text', max: 120 })
      addField({ name: 'opp_name', type: 'text', required: true })
      addField({ name: 'stage', type: 'text', required: true, max: 20 })
      addField({ name: 'expected_amount', type: 'number' })
      addField({ name: 'expected_close_date', type: 'text', max: 20 })
      addField({ name: 'next_action', type: 'text' })
      addField({ name: 'ref_type', type: 'text', max: 20 })
      addField({ name: 'ref_id', type: 'text', max: 40 })
      addField({ name: 'ref_name', type: 'text', max: 160 })
      addField({ name: 'lost_reason', type: 'text', max: 300 })
      addField({ name: 'notes', type: 'text' })
      addField({ name: 'next_follow_date', type: 'text', max: 20 })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) {
        $app.save(existing)
        try { $app.logger().info("opportunities collection upgraded") } catch (_) {}
      }
    } else {
      var col = new Collection({
        type: "base",
        name: "opportunities",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'customer_id', type: 'text', required: true },
          { name: 'customer_name', type: 'text', max: 120 },
          { name: 'opp_name', type: 'text', required: true },
          { name: 'stage', type: 'text', required: true, max: 20 },
          { name: 'expected_amount', type: 'number' },
          { name: 'expected_close_date', type: 'text', max: 20 },
          { name: 'next_action', type: 'text' },
          { name: 'ref_type', type: 'text', max: 20 },
          { name: 'ref_id', type: 'text', max: 40 },
          { name: 'ref_name', type: 'text', max: 160 },
          { name: 'lost_reason', type: 'text', max: 300 },
          { name: 'notes', type: 'text' },
          { name: 'next_follow_date', type: 'text', max: 20 },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
      try { $app.logger().info("opportunities collection created") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("opportunities bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/opportunities?page=1&perPage=50&sort=-created&rh_user_id=...&customer_id=...&stage=...
routerAdd("GET", "/api/opportunities", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("opportunities") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "opportunities",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'customer_id', type: 'text', required: true },
          { name: 'customer_name', type: 'text', max: 120 },
          { name: 'opp_name', type: 'text', required: true },
          { name: 'stage', type: 'text', required: true, max: 20 },
          { name: 'expected_amount', type: 'number' },
          { name: 'expected_close_date', type: 'text', max: 20 },
          { name: 'next_action', type: 'text' },
          { name: 'ref_type', type: 'text', max: 20 },
          { name: 'ref_id', type: 'text', max: 40 },
          { name: 'ref_name', type: 'text', max: 160 },
          { name: 'lost_reason', type: 'text', max: 300 },
          { name: 'notes', type: 'text' },
          { name: 'next_follow_date', type: 'text', max: 20 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("opportunities")
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
    if (query.customer_id !== undefined && query.customer_id !== "") {
      filterParts.push("customer_id = {:customer_id}")
      params.customer_id = String(query.customer_id)
    }
    if (query.stage !== undefined && query.stage !== "") {
      filterParts.push("stage = {:stage}")
      params.stage = String(query.stage)
    }
    var filter = filterParts.length > 0 ? filterParts.join(" && ") : ""
    var records = filter
      ? $app.findRecordsByFilter("opportunities", filter, sort, perPage, (page - 1) * perPage, params)
      : $app.findRecordsByFilter("opportunities", "", sort, perPage, (page - 1) * perPage)
    var items = []
    for (var i = 0; i < records.length; i++) {
      items.push(records[i].publicExport())
    }
    var totalItems = items.length
    try {
      var countRecords = filter
        ? $app.findRecordsByFilter("opportunities", filter, sort, 100000, 0, params)
        : $app.findRecordsByFilter("opportunities", "", sort, 100000, 0)
      totalItems = countRecords.length
    } catch (err2) {}
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: totalItems })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("opportunities list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// GET /api/opportunities/{id}
routerAdd("GET", "/api/opportunities/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("opportunities", id) } catch (_) { rec = null }
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
// POST /api/opportunities  body 字段: rh_user_id, customer_id, customer_name, opp_name, stage, expected_amount, expected_close_date, next_action, ref_type, ref_id, ref_name, lost_reason, notes, next_follow_date
routerAdd("POST", "/api/opportunities", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("opportunities") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "opportunities",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'customer_id', type: 'text', required: true },
          { name: 'customer_name', type: 'text', max: 120 },
          { name: 'opp_name', type: 'text', required: true },
          { name: 'stage', type: 'text', required: true, max: 20 },
          { name: 'expected_amount', type: 'number' },
          { name: 'expected_close_date', type: 'text', max: 20 },
          { name: 'next_action', type: 'text' },
          { name: 'ref_type', type: 'text', max: 20 },
          { name: 'ref_id', type: 'text', max: 40 },
          { name: 'ref_name', type: 'text', max: 160 },
          { name: 'lost_reason', type: 'text', max: 300 },
          { name: 'notes', type: 'text' },
          { name: 'next_follow_date', type: 'text', max: 20 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("opportunities")
  }
  try {
    var coll = ensureCollLocal()
    var body = e.requestInfo().body || {}
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var rec = new Record(coll)
    rec.set("rh_user_id", __uid)
    rec.set("customer_id", body.customer_id === undefined || body.customer_id === null ? "" : String(body.customer_id))
    rec.set("customer_name", body.customer_name === undefined || body.customer_name === null ? "" : String(body.customer_name))
    rec.set("opp_name", body.opp_name === undefined || body.opp_name === null ? "" : String(body.opp_name))
    rec.set("stage", body.stage === undefined || body.stage === null ? "" : String(body.stage))
    rec.set("expected_amount", (body.expected_amount === undefined || body.expected_amount === null) ? 0 : Number(body.expected_amount))
    rec.set("expected_close_date", body.expected_close_date === undefined || body.expected_close_date === null ? "" : String(body.expected_close_date))
    rec.set("next_action", body.next_action === undefined || body.next_action === null ? "" : String(body.next_action))
    rec.set("ref_type", body.ref_type === undefined || body.ref_type === null ? "" : String(body.ref_type))
    rec.set("ref_id", body.ref_id === undefined || body.ref_id === null ? "" : String(body.ref_id))
    rec.set("ref_name", body.ref_name === undefined || body.ref_name === null ? "" : String(body.ref_name))
    rec.set("lost_reason", body.lost_reason === undefined || body.lost_reason === null ? "" : String(body.lost_reason))
    rec.set("notes", body.notes === undefined || body.notes === null ? "" : String(body.notes))
    rec.set("next_follow_date", body.next_follow_date === undefined || body.next_follow_date === null ? "" : String(body.next_follow_date))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("opportunities create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// PATCH /api/opportunities/{id}  body 字段同 POST, 只更新 body 里出现的字段
routerAdd("PATCH", "/api/opportunities/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("opportunities", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var __own = false
    try { __own = (String(rec.get("rh_user_id")||"") === __uid) } catch(_x) {}
    if (!__own) { try { __own = (String(rec.get("owner_id")||"") === __uid) } catch(_x) {} }
    if (!__own) return e.json(403, { error: "forbidden", message: "无权操作该记录" })
    var body = e.requestInfo().body || {}
    // IDOR fix: owner transfer disabled
    if ("customer_id" in body) rec.set("customer_id", body.customer_id === undefined || body.customer_id === null ? "" : String(body.customer_id))
    if ("customer_name" in body) rec.set("customer_name", body.customer_name === undefined || body.customer_name === null ? "" : String(body.customer_name))
    if ("opp_name" in body) rec.set("opp_name", body.opp_name === undefined || body.opp_name === null ? "" : String(body.opp_name))
    if ("stage" in body) rec.set("stage", body.stage === undefined || body.stage === null ? "" : String(body.stage))
    if ("expected_amount" in body) rec.set("expected_amount", (body.expected_amount === undefined || body.expected_amount === null) ? 0 : Number(body.expected_amount))
    if ("expected_close_date" in body) rec.set("expected_close_date", body.expected_close_date === undefined || body.expected_close_date === null ? "" : String(body.expected_close_date))
    if ("next_action" in body) rec.set("next_action", body.next_action === undefined || body.next_action === null ? "" : String(body.next_action))
    if ("ref_type" in body) rec.set("ref_type", body.ref_type === undefined || body.ref_type === null ? "" : String(body.ref_type))
    if ("ref_id" in body) rec.set("ref_id", body.ref_id === undefined || body.ref_id === null ? "" : String(body.ref_id))
    if ("ref_name" in body) rec.set("ref_name", body.ref_name === undefined || body.ref_name === null ? "" : String(body.ref_name))
    if ("lost_reason" in body) rec.set("lost_reason", body.lost_reason === undefined || body.lost_reason === null ? "" : String(body.lost_reason))
    if ("notes" in body) rec.set("notes", body.notes === undefined || body.notes === null ? "" : String(body.notes))
    if ("next_follow_date" in body) rec.set("next_follow_date", body.next_follow_date === undefined || body.next_follow_date === null ? "" : String(body.next_follow_date))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// DELETE /api/opportunities/{id}
routerAdd("DELETE", "/api/opportunities/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("opportunities", id) } catch (_) { rec = null }
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

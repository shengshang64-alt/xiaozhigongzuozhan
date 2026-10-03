/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/check_mappings.pb.js — 业务 collection + REST CRUD 路由 (self-contained)
//
// 由 mcp__rh-pb-hooks__install_business_collection 装. 不要直接 Read+Write 这个文件.
// 业务字段: customer_norm:text, company_product_name:text, product_id:text, hit_count:number
// 路由: list,get,create,update,delete
// list filter 字段: (none)
// list 默认排序: -hit_count

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("check_mappings") } catch (_) { existing = null }
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
      addField({ name: 'customer_norm', type: 'text', required: true })
      addField({ name: 'company_product_name', type: 'text', required: true })
      addField({ name: 'product_id', type: 'text' })
      addField({ name: 'hit_count', type: 'number' })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) {
        $app.save(existing)
        try { $app.logger().info("check_mappings collection upgraded") } catch (_) {}
      }
    } else {
      var col = new Collection({
        type: "base",
        name: "check_mappings",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: 'customer_norm', type: 'text', required: true },
          { name: 'company_product_name', type: 'text', required: true },
          { name: 'product_id', type: 'text' },
          { name: 'hit_count', type: 'number' },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
      try { $app.logger().info("check_mappings collection created") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("check_mappings bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/check_mappings?page=1&perPage=50&sort=-created
routerAdd("GET", "/api/check_mappings", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("check_mappings") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "check_mappings",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'customer_norm', type: 'text', required: true },
          { name: 'company_product_name', type: 'text', required: true },
          { name: 'product_id', type: 'text' },
          { name: 'hit_count', type: 'number' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("check_mappings")
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
    var sort = String(query.sort || "-hit_count")
    var filterParts = []
    var params = {}
    // no list_filter_fields configured
    var filter = filterParts.length > 0 ? filterParts.join(" && ") : ""
    var records = filter
      ? $app.findRecordsByFilter("check_mappings", filter, sort, perPage, (page - 1) * perPage, params)
      : $app.findRecordsByFilter("check_mappings", "", sort, perPage, (page - 1) * perPage)
    var items = []
    for (var i = 0; i < records.length; i++) {
      items.push(records[i].publicExport())
    }
    var totalItems = items.length
    try {
      var countRecords = filter
        ? $app.findRecordsByFilter("check_mappings", filter, sort, 100000, 0, params)
        : $app.findRecordsByFilter("check_mappings", "", sort, 100000, 0)
      totalItems = countRecords.length
    } catch (err2) {}
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: totalItems })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("check_mappings list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// GET /api/check_mappings/{id}
routerAdd("GET", "/api/check_mappings/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("check_mappings", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "get_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// POST /api/check_mappings  body 字段: customer_norm, company_product_name, product_id, hit_count
routerAdd("POST", "/api/check_mappings", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("check_mappings") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "check_mappings",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'customer_norm', type: 'text', required: true },
          { name: 'company_product_name', type: 'text', required: true },
          { name: 'product_id', type: 'text' },
          { name: 'hit_count', type: 'number' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("check_mappings")
  }
  try {
    var coll = ensureCollLocal()
    var body = e.requestInfo().body || {}
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var rec = new Record(coll)
    rec.set("customer_norm", body.customer_norm === undefined || body.customer_norm === null ? "" : String(body.customer_norm))
    rec.set("company_product_name", body.company_product_name === undefined || body.company_product_name === null ? "" : String(body.company_product_name))
    rec.set("product_id", body.product_id === undefined || body.product_id === null ? "" : String(body.product_id))
    rec.set("hit_count", (body.hit_count === undefined || body.hit_count === null) ? 0 : Number(body.hit_count))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("check_mappings create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// PATCH /api/check_mappings/{id}  body 字段同 POST, 只更新 body 里出现的字段
routerAdd("PATCH", "/api/check_mappings/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("check_mappings", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var body = e.requestInfo().body || {}
    if ("customer_norm" in body) rec.set("customer_norm", body.customer_norm === undefined || body.customer_norm === null ? "" : String(body.customer_norm))
    if ("company_product_name" in body) rec.set("company_product_name", body.company_product_name === undefined || body.company_product_name === null ? "" : String(body.company_product_name))
    if ("product_id" in body) rec.set("product_id", body.product_id === undefined || body.product_id === null ? "" : String(body.product_id))
    if ("hit_count" in body) rec.set("hit_count", (body.hit_count === undefined || body.hit_count === null) ? 0 : Number(body.hit_count))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// DELETE /api/check_mappings/{id}
routerAdd("DELETE", "/api/check_mappings/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("check_mappings", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    $app.delete(rec)
    return e.json(200, { ok: true })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "delete_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

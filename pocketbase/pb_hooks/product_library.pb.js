/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/product_library.pb.js — 业务 collection + REST CRUD 路由 (self-contained)
//
// 由 mcp__rh-pb-hooks__install_business_collection 装. 不要直接 Read+Write 这个文件.
// 业务字段: rh_user_id:text, item_name:text, spec:text, unit:text, ref_price:number, category:text
// 路由: list,get,create,update,delete
// list filter 字段: rh_user_id,category
// list 默认排序: -created

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("product_library") } catch (_) { existing = null }
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
      addField({ name: 'item_name', type: 'text', required: true })
      addField({ name: 'spec', type: 'text' })
      addField({ name: 'unit', type: 'text' })
      addField({ name: 'ref_price', type: 'number' })
      addField({ name: 'category', type: 'text' })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) {
        $app.save(existing)
        try { $app.logger().info("product_library collection upgraded") } catch (_) {}
      }
    } else {
      var col = new Collection({
        type: "base",
        name: "product_library",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'item_name', type: 'text', required: true },
          { name: 'spec', type: 'text' },
          { name: 'unit', type: 'text' },
          { name: 'ref_price', type: 'number' },
          { name: 'category', type: 'text' },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
      try { $app.logger().info("product_library collection created") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("product_library bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/product_library?page=1&perPage=50&sort=-created&rh_user_id=...&category=...
routerAdd("GET", "/api/product_library", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("product_library") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "product_library",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'item_name', type: 'text', required: true },
          { name: 'spec', type: 'text' },
          { name: 'unit', type: 'text' },
          { name: 'ref_price', type: 'number' },
          { name: 'category', type: 'text' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("product_library")
  }
  try {
    ensureCollLocal()
    var info = e.requestInfo()
    var query = info.query || {}
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var page = parseInt(String(query.page || "1"), 10) || 1
    var perPage = parseInt(String(query.perPage || "50"), 10) || 50
    if (perPage > 200) perPage = 200
    var sort = String(query.sort || "-created")
    var filterParts = []
    var params = {}
    filterParts.push("rh_user_id = {:rh_user_id}")
      params.rh_user_id = __uid
    if (query.category !== undefined && query.category !== "") {
      filterParts.push("category = {:category}")
      params.category = String(query.category)
    }
    var filter = filterParts.length > 0 ? filterParts.join(" && ") : ""
    var records = filter
      ? $app.findRecordsByFilter("product_library", filter, sort, perPage, (page - 1) * perPage, params)
      : $app.findRecordsByFilter("product_library", "", sort, perPage, (page - 1) * perPage)
    var items = []
    for (var i = 0; i < records.length; i++) {
      items.push(records[i].publicExport())
    }
    var totalItems = items.length
    try {
      var countRecords = filter
        ? $app.findRecordsByFilter("product_library", filter, sort, 100000, 0, params)
        : $app.findRecordsByFilter("product_library", "", sort, 100000, 0)
      totalItems = countRecords.length
    } catch (err2) {}
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: totalItems })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("product_library list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// GET /api/product_library/{id}
routerAdd("GET", "/api/product_library/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("product_library", id) } catch (_) { rec = null }
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
// POST /api/product_library  body 字段: rh_user_id, item_name, spec, unit, ref_price, category
routerAdd("POST", "/api/product_library", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("product_library") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "product_library",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'item_name', type: 'text', required: true },
          { name: 'spec', type: 'text' },
          { name: 'unit', type: 'text' },
          { name: 'ref_price', type: 'number' },
          { name: 'category', type: 'text' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("product_library")
  }
  try {
    var coll = ensureCollLocal()
    var body = e.requestInfo().body || {}
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var rec = new Record(coll)
    rec.set("rh_user_id", __uid)
    rec.set("item_name", body.item_name === undefined || body.item_name === null ? "" : String(body.item_name))
    rec.set("spec", body.spec === undefined || body.spec === null ? "" : String(body.spec))
    rec.set("unit", body.unit === undefined || body.unit === null ? "" : String(body.unit))
    rec.set("ref_price", (body.ref_price === undefined || body.ref_price === null) ? 0 : Number(body.ref_price))
    rec.set("category", body.category === undefined || body.category === null ? "" : String(body.category))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("product_library create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// PATCH /api/product_library/{id}  body 字段同 POST, 只更新 body 里出现的字段
routerAdd("PATCH", "/api/product_library/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("product_library", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var __own = false
    try { __own = (String(rec.get("rh_user_id")||"") === __uid) } catch(_x) {}
    if (!__own) { try { __own = (String(rec.get("owner_id")||"") === __uid) } catch(_x) {} }
    if (!__own) return e.json(403, { error: "forbidden", message: "无权操作该记录" })
    var body = e.requestInfo().body || {}
    // IDOR fix: owner transfer disabled
    if ("item_name" in body) rec.set("item_name", body.item_name === undefined || body.item_name === null ? "" : String(body.item_name))
    if ("spec" in body) rec.set("spec", body.spec === undefined || body.spec === null ? "" : String(body.spec))
    if ("unit" in body) rec.set("unit", body.unit === undefined || body.unit === null ? "" : String(body.unit))
    if ("ref_price" in body) rec.set("ref_price", (body.ref_price === undefined || body.ref_price === null) ? 0 : Number(body.ref_price))
    if ("category" in body) rec.set("category", body.category === undefined || body.category === null ? "" : String(body.category))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// DELETE /api/product_library/{id}
routerAdd("DELETE", "/api/product_library/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("product_library", id) } catch (_) { rec = null }
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

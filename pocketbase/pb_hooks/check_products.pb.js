/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/check_products.pb.js — 业务 collection + REST CRUD 路由 (self-contained)
//
// 由 mcp__rh-pb-hooks__install_business_collection 装. 不要直接 Read+Write 这个文件.
// 业务字段: is_builtin:bool, in_company:bool, category:text, product_line:text, product_name:text, module_name:text, module_func:text, description:text, charge_mode:text, unit_price:number, status:text, rating_tags:json, tech_params:json
// 路由: list,get,create,update,delete
// list filter 字段: (none)
// list 默认排序: -created

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("check_products") } catch (_) { existing = null }
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
      addField({ name: 'is_builtin', type: 'bool' })
      addField({ name: 'in_company', type: 'bool' })
      addField({ name: 'category', type: 'text' })
      addField({ name: 'product_line', type: 'text' })
      addField({ name: 'product_name', type: 'text' })
      addField({ name: 'module_name', type: 'text' })
      addField({ name: 'module_func', type: 'text' })
      addField({ name: 'description', type: 'text' })
      addField({ name: 'charge_mode', type: 'text' })
      addField({ name: 'unit_price', type: 'number' })
      addField({ name: 'status', type: 'text' })
      addField({ name: 'rating_tags', type: 'json' })
      addField({ name: 'tech_params', type: 'json' })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) {
        $app.save(existing)
        try { $app.logger().info("check_products collection upgraded") } catch (_) {}
      }
    } else {
      var col = new Collection({
        type: "base",
        name: "check_products",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: 'is_builtin', type: 'bool' },
          { name: 'in_company', type: 'bool' },
          { name: 'category', type: 'text' },
          { name: 'product_line', type: 'text' },
          { name: 'product_name', type: 'text' },
          { name: 'module_name', type: 'text' },
          { name: 'module_func', type: 'text' },
          { name: 'description', type: 'text' },
          { name: 'charge_mode', type: 'text' },
          { name: 'unit_price', type: 'number' },
          { name: 'status', type: 'text' },
          { name: 'rating_tags', type: 'json' },
          { name: 'tech_params', type: 'json' },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
      try { $app.logger().info("check_products collection created") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("check_products bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/check_products?page=1&perPage=50&sort=-created
routerAdd("GET", "/api/check_products", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("check_products") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "check_products",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'is_builtin', type: 'bool' },
          { name: 'in_company', type: 'bool' },
          { name: 'category', type: 'text' },
          { name: 'product_line', type: 'text' },
          { name: 'product_name', type: 'text' },
          { name: 'module_name', type: 'text' },
          { name: 'module_func', type: 'text' },
          { name: 'description', type: 'text' },
          { name: 'charge_mode', type: 'text' },
          { name: 'unit_price', type: 'number' },
          { name: 'status', type: 'text' },
          { name: 'rating_tags', type: 'json' },
          { name: 'tech_params', type: 'json' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("check_products")
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
    var sort = String(query.sort || "-created")
    var filterParts = []
    var params = {}
    // no list_filter_fields configured
    var filter = filterParts.length > 0 ? filterParts.join(" && ") : ""
    var records = filter
      ? $app.findRecordsByFilter("check_products", filter, sort, perPage, (page - 1) * perPage, params)
      : $app.findRecordsByFilter("check_products", "", sort, perPage, (page - 1) * perPage)
    var items = []
    for (var i = 0; i < records.length; i++) {
      items.push(records[i].publicExport())
    }
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: items.length })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("check_products list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// GET /api/check_products/{id}
routerAdd("GET", "/api/check_products/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("check_products", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "get_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// POST /api/check_products  body 字段: is_builtin, in_company, category, product_line, product_name, module_name, module_func, description, charge_mode, unit_price, status, rating_tags, tech_params
routerAdd("POST", "/api/check_products", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("check_products") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "check_products",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'is_builtin', type: 'bool' },
          { name: 'in_company', type: 'bool' },
          { name: 'category', type: 'text' },
          { name: 'product_line', type: 'text' },
          { name: 'product_name', type: 'text' },
          { name: 'module_name', type: 'text' },
          { name: 'module_func', type: 'text' },
          { name: 'description', type: 'text' },
          { name: 'charge_mode', type: 'text' },
          { name: 'unit_price', type: 'number' },
          { name: 'status', type: 'text' },
          { name: 'rating_tags', type: 'json' },
          { name: 'tech_params', type: 'json' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("check_products")
  }
  try {
    var coll = ensureCollLocal()
    var body = e.requestInfo().body || {}
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var rec = new Record(coll)
    rec.set("is_builtin", !!body.is_builtin)
    rec.set("in_company", !!body.in_company)
    rec.set("category", body.category === undefined || body.category === null ? "" : String(body.category))
    rec.set("product_line", body.product_line === undefined || body.product_line === null ? "" : String(body.product_line))
    rec.set("product_name", body.product_name === undefined || body.product_name === null ? "" : String(body.product_name))
    rec.set("module_name", body.module_name === undefined || body.module_name === null ? "" : String(body.module_name))
    rec.set("module_func", body.module_func === undefined || body.module_func === null ? "" : String(body.module_func))
    rec.set("description", body.description === undefined || body.description === null ? "" : String(body.description))
    rec.set("charge_mode", body.charge_mode === undefined || body.charge_mode === null ? "" : String(body.charge_mode))
    rec.set("unit_price", (body.unit_price === undefined || body.unit_price === null) ? 0 : Number(body.unit_price))
    rec.set("status", body.status === undefined || body.status === null ? "" : String(body.status))
    rec.set("rating_tags", body.rating_tags)
    rec.set("tech_params", body.tech_params)
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("check_products create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// PATCH /api/check_products/{id}  body 字段同 POST, 只更新 body 里出现的字段
routerAdd("PATCH", "/api/check_products/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("check_products", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var body = e.requestInfo().body || {}
    if ("is_builtin" in body) rec.set("is_builtin", !!body.is_builtin)
    if ("in_company" in body) rec.set("in_company", !!body.in_company)
    if ("category" in body) rec.set("category", body.category === undefined || body.category === null ? "" : String(body.category))
    if ("product_line" in body) rec.set("product_line", body.product_line === undefined || body.product_line === null ? "" : String(body.product_line))
    if ("product_name" in body) rec.set("product_name", body.product_name === undefined || body.product_name === null ? "" : String(body.product_name))
    if ("module_name" in body) rec.set("module_name", body.module_name === undefined || body.module_name === null ? "" : String(body.module_name))
    if ("module_func" in body) rec.set("module_func", body.module_func === undefined || body.module_func === null ? "" : String(body.module_func))
    if ("description" in body) rec.set("description", body.description === undefined || body.description === null ? "" : String(body.description))
    if ("charge_mode" in body) rec.set("charge_mode", body.charge_mode === undefined || body.charge_mode === null ? "" : String(body.charge_mode))
    if ("unit_price" in body) rec.set("unit_price", (body.unit_price === undefined || body.unit_price === null) ? 0 : Number(body.unit_price))
    if ("status" in body) rec.set("status", body.status === undefined || body.status === null ? "" : String(body.status))
    if ("rating_tags" in body) rec.set("rating_tags", body.rating_tags)
    if ("tech_params" in body) rec.set("tech_params", body.tech_params)
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// DELETE /api/check_products/{id}
routerAdd("DELETE", "/api/check_products/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("check_products", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    $app.delete(rec)
    return e.json(200, { ok: true })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "delete_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

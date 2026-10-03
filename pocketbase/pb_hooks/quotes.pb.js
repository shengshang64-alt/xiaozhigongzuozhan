/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/quotes.pb.js — 业务 collection + REST CRUD 路由 (self-contained)
//
// 由 mcp__rh-pb-hooks__install_business_collection 装. 不要直接 Read+Write 这个文件.
// 业务字段: rh_user_id:text, quote_name:text, ref_type:text, ref_id:text, ref_name:text, groups:json, tax_note:text, version:text, opportunity_id:text, opportunity_name:text
// 路由: list,get,create,update,delete
// list filter 字段: rh_user_id
// list 默认排序: -updated

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("quotes") } catch (_) { existing = null }
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
      addField({ name: 'quote_name', type: 'text', required: true })
      addField({ name: 'ref_type', type: 'text' })
      addField({ name: 'ref_id', type: 'text' })
      addField({ name: 'ref_name', type: 'text' })
      addField({ name: 'groups', type: 'json' })
      addField({ name: 'tax_note', type: 'text' })
      addField({ name: 'version', type: 'text' })
      addField({ name: 'opportunity_id', type: 'text', max: 64 })
      addField({ name: 'opportunity_name', type: 'text', max: 200 })
      // R79 quote-history-2 第一步：结单沉淀样本元数据（医院等级/床位/模块组合 + 成交样本标记）
      addField({ name: 'won_sample', type: 'bool' })
      addField({ name: 'hospital_level_txt', type: 'text', max: 20 })
      addField({ name: 'beds_total', type: 'number' })
      addField({ name: 'modules_summary', type: 'text', max: 500 })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) {
        $app.save(existing)
        try { $app.logger().info("quotes collection upgraded") } catch (_) {}
      }
    } else {
      var col = new Collection({
        type: "base",
        name: "quotes",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'quote_name', type: 'text', required: true },
          { name: 'ref_type', type: 'text' },
          { name: 'ref_id', type: 'text' },
          { name: 'ref_name', type: 'text' },
          { name: 'groups', type: 'json' },
          { name: 'tax_note', type: 'text' },
          { name: 'version', type: 'text' },
          { name: 'opportunity_id', type: 'text', max: 64 },
          { name: 'opportunity_name', type: 'text', max: 200 },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
      try { $app.logger().info("quotes collection created") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("quotes bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/quotes?page=1&perPage=50&sort=-created&rh_user_id=...
routerAdd("GET", "/api/quotes", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("quotes") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "quotes",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'quote_name', type: 'text', required: true },
          { name: 'ref_type', type: 'text' },
          { name: 'ref_id', type: 'text' },
          { name: 'ref_name', type: 'text' },
          { name: 'groups', type: 'json' },
          { name: 'tax_note', type: 'text' },
          { name: 'version', type: 'text' },
          { name: 'opportunity_id', type: 'text', max: 64 },
          { name: 'opportunity_name', type: 'text', max: 200 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("quotes")
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
    if (query.q !== undefined && String(query.q) !== "") {
      filterParts.push("(quote_name ~ {:q_kw} || ref_name ~ {:q_kw2})")
      params.q_kw = "%" + String(query.q) + "%"
      params.q_kw2 = "%" + String(query.q) + "%"
    }
    var filter = filterParts.length > 0 ? filterParts.join(" && ") : ""
    var records = filter
      ? $app.findRecordsByFilter("quotes", filter, sort, perPage, (page - 1) * perPage, params)
      : $app.findRecordsByFilter("quotes", "", sort, perPage, (page - 1) * perPage)
    var items = []
    for (var i = 0; i < records.length; i++) {
      items.push(records[i].publicExport())
    }
    var totalItems = items.length
    try {
      var countRecords = filter
        ? $app.findRecordsByFilter("quotes", filter, sort, 100000, 0, params)
        : $app.findRecordsByFilter("quotes", "", sort, 100000, 0)
      totalItems = countRecords.length
    } catch (err2) {}
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: totalItems })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("quotes list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// GET /api/quotes/{id}
routerAdd("GET", "/api/quotes/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("quotes", id) } catch (_) { rec = null }
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
// POST /api/quotes  body 字段: rh_user_id, quote_name, ref_type, ref_id, ref_name, groups, tax_note, version, opportunity_id, opportunity_name
routerAdd("POST", "/api/quotes", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("quotes") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "quotes",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'quote_name', type: 'text', required: true },
          { name: 'ref_type', type: 'text' },
          { name: 'ref_id', type: 'text' },
          { name: 'ref_name', type: 'text' },
          { name: 'groups', type: 'json' },
          { name: 'tax_note', type: 'text' },
          { name: 'version', type: 'text' },
          { name: 'opportunity_id', type: 'text', max: 64 },
          { name: 'opportunity_name', type: 'text', max: 200 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("quotes")
  }
  try {
    var coll = ensureCollLocal()
    var body = e.requestInfo().body || {}
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var rec = new Record(coll)
    rec.set("rh_user_id", __uid)
    rec.set("quote_name", body.quote_name === undefined || body.quote_name === null ? "" : String(body.quote_name))
    rec.set("ref_type", body.ref_type === undefined || body.ref_type === null ? "" : String(body.ref_type))
    rec.set("ref_id", body.ref_id === undefined || body.ref_id === null ? "" : String(body.ref_id))
    rec.set("ref_name", body.ref_name === undefined || body.ref_name === null ? "" : String(body.ref_name))
    rec.set("groups", body.groups)
    rec.set("tax_note", body.tax_note === undefined || body.tax_note === null ? "" : String(body.tax_note))
    rec.set("version", body.version === undefined || body.version === null ? "" : String(body.version))
    rec.set("opportunity_id", body.opportunity_id === undefined || body.opportunity_id === null ? "" : String(body.opportunity_id))
    rec.set("opportunity_name", body.opportunity_name === undefined || body.opportunity_name === null ? "" : String(body.opportunity_name))
    // R79：结单沉淀字段透传（won_sample bool / hospital_level text / beds_total number / modules_summary text）
    rec.set("won_sample", body.won_sample === true)
    rec.set("hospital_level_txt", body.hospital_level === undefined || body.hospital_level === null ? "" : String(body.hospital_level).slice(0, 20))
    rec.set("beds_total", body.beds_total === undefined || body.beds_total === null || isNaN(Number(body.beds_total)) ? 0 : Number(body.beds_total))
    rec.set("modules_summary", body.modules_summary === undefined || body.modules_summary === null ? "" : String(body.modules_summary).slice(0, 500))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("quotes create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// PATCH /api/quotes/{id}  body 字段同 POST, 只更新 body 里出现的字段
routerAdd("PATCH", "/api/quotes/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("quotes", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var __own = false
    try { __own = (String(rec.get("rh_user_id")||"") === __uid) } catch(_x) {}
    if (!__own) { try { __own = (String(rec.get("owner_id")||"") === __uid) } catch(_x) {} }
    if (!__own) return e.json(403, { error: "forbidden", message: "无权操作该记录" })
    var body = e.requestInfo().body || {}
    // IDOR fix: owner transfer disabled
    if ("quote_name" in body) rec.set("quote_name", body.quote_name === undefined || body.quote_name === null ? "" : String(body.quote_name))
    if ("ref_type" in body) rec.set("ref_type", body.ref_type === undefined || body.ref_type === null ? "" : String(body.ref_type))
    if ("ref_id" in body) rec.set("ref_id", body.ref_id === undefined || body.ref_id === null ? "" : String(body.ref_id))
    if ("ref_name" in body) rec.set("ref_name", body.ref_name === undefined || body.ref_name === null ? "" : String(body.ref_name))
    if ("groups" in body) rec.set("groups", body.groups)
    if ("tax_note" in body) rec.set("tax_note", body.tax_note === undefined || body.tax_note === null ? "" : String(body.tax_note))
    if ("version" in body) rec.set("version", body.version === undefined || body.version === null ? "" : String(body.version))
    // R79：结单沉淀字段 PATCH 透传
    if ("won_sample" in body) rec.set("won_sample", body.won_sample === true)
    if ("hospital_level" in body) rec.set("hospital_level_txt", body.hospital_level === null ? "" : String(body.hospital_level).slice(0, 20))
    if ("beds_total" in body) rec.set("beds_total", isNaN(Number(body.beds_total)) ? 0 : Number(body.beds_total))
    if ("modules_summary" in body) rec.set("modules_summary", body.modules_summary === null ? "" : String(body.modules_summary).slice(0, 500))
    if ("opportunity_id" in body) rec.set("opportunity_id", body.opportunity_id === undefined || body.opportunity_id === null ? "" : String(body.opportunity_id))
    if ("opportunity_name" in body) rec.set("opportunity_name", body.opportunity_name === undefined || body.opportunity_name === null ? "" : String(body.opportunity_name))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// DELETE /api/quotes/{id}
routerAdd("DELETE", "/api/quotes/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("quotes", id) } catch (_) { rec = null }
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

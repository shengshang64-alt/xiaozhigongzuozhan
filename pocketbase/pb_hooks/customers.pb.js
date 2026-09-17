/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/customers.pb.js — 业务 collection + REST CRUD 路由 (self-contained)
//
// 由 mcp__rh-pb-hooks__install_business_collection 装. 不要直接 Read+Write 这个文件.
// 业务字段: rh_user_id:text, hospital_name:text, hospital_type:text, level:text, region:text, address:text, website:text, outpatient_daily:number, outpatient_yearly:number, beds_total:number, beds_icu:number, beds_or:number, key_departments:json, contacts:json, notes:text, ai_generated_fields:json, last_follow_at:text
// 路由: list,get,create,update,delete
// list filter 字段: rh_user_id,hospital_type,region
// list 默认排序: -updated

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("customers") } catch (_) { existing = null }
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
      addField({ name: 'hospital_name', type: 'text', required: true })
      addField({ name: 'hospital_type', type: 'text', max: 30 })
      addField({ name: 'level', type: 'text', max: 30 })
      addField({ name: 'region', type: 'text', max: 50 })
      addField({ name: 'address', type: 'text', max: 200 })
      addField({ name: 'website', type: 'text', max: 300 })
      addField({ name: 'outpatient_daily', type: 'number' })
      addField({ name: 'outpatient_yearly', type: 'number' })
      addField({ name: 'beds_total', type: 'number' })
      addField({ name: 'beds_icu', type: 'number' })
      addField({ name: 'beds_or', type: 'number' })
      addField({ name: 'key_departments', type: 'json' })
      addField({ name: 'contacts', type: 'json' })
      addField({ name: 'notes', type: 'text' })
      addField({ name: 'ai_generated_fields', type: 'json' })
      addField({ name: 'last_follow_at', type: 'text', max: 40 })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) {
        $app.save(existing)
        try { $app.logger().info("customers collection upgraded") } catch (_) {}
      }
    } else {
      var col = new Collection({
        type: "base",
        name: "customers",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'hospital_name', type: 'text', required: true },
          { name: 'hospital_type', type: 'text', max: 30 },
          { name: 'level', type: 'text', max: 30 },
          { name: 'region', type: 'text', max: 50 },
          { name: 'address', type: 'text', max: 200 },
          { name: 'website', type: 'text', max: 300 },
          { name: 'outpatient_daily', type: 'number' },
          { name: 'outpatient_yearly', type: 'number' },
          { name: 'beds_total', type: 'number' },
          { name: 'beds_icu', type: 'number' },
          { name: 'beds_or', type: 'number' },
          { name: 'key_departments', type: 'json' },
          { name: 'contacts', type: 'json' },
          { name: 'notes', type: 'text' },
          { name: 'ai_generated_fields', type: 'json' },
          { name: 'last_follow_at', type: 'text', max: 40 },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
      try { $app.logger().info("customers collection created") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("customers bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/customers?page=1&perPage=50&sort=-created&rh_user_id=...&hospital_type=...&region=...
routerAdd("GET", "/api/customers", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("customers") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "customers",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'hospital_name', type: 'text', required: true },
          { name: 'hospital_type', type: 'text', max: 30 },
          { name: 'level', type: 'text', max: 30 },
          { name: 'region', type: 'text', max: 50 },
          { name: 'address', type: 'text', max: 200 },
          { name: 'website', type: 'text', max: 300 },
          { name: 'outpatient_daily', type: 'number' },
          { name: 'outpatient_yearly', type: 'number' },
          { name: 'beds_total', type: 'number' },
          { name: 'beds_icu', type: 'number' },
          { name: 'beds_or', type: 'number' },
          { name: 'key_departments', type: 'json' },
          { name: 'contacts', type: 'json' },
          { name: 'notes', type: 'text' },
          { name: 'ai_generated_fields', type: 'json' },
          { name: 'last_follow_at', type: 'text', max: 40 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("customers")
  }
  try {
    ensureCollLocal()
    var info = e.requestInfo()
    var query = info.query || {}
    var page = parseInt(String(query.page || "1"), 10) || 1
    var perPage = parseInt(String(query.perPage || "50"), 10) || 50
    if (perPage > 200) perPage = 200
    var sort = String(query.sort || "-updated")
    var filterParts = []
    var params = {}
    if (query.rh_user_id !== undefined && query.rh_user_id !== "") {
      filterParts.push("rh_user_id = {:rh_user_id}")
      params.rh_user_id = String(query.rh_user_id)
    }
    if (query.hospital_type !== undefined && query.hospital_type !== "") {
      filterParts.push("hospital_type = {:hospital_type}")
      params.hospital_type = String(query.hospital_type)
    }
    if (query.region !== undefined && query.region !== "") {
      filterParts.push("region = {:region}")
      params.region = String(query.region)
    }
    if (query.q !== undefined && String(query.q) !== "") {
      filterParts.push("hospital_name ~ {:q_kw}")
      params.q_kw = "%" + String(query.q) + "%"
    }
    var filter = filterParts.length > 0 ? filterParts.join(" && ") : ""
    var records = filter
      ? $app.findRecordsByFilter("customers", filter, sort, perPage, (page - 1) * perPage, params)
      : $app.findRecordsByFilter("customers", "", sort, perPage, (page - 1) * perPage)
    var items = []
    for (var i = 0; i < records.length; i++) {
      items.push(records[i].publicExport())
    }
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: items.length })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("customers list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// GET /api/customers/{id}
routerAdd("GET", "/api/customers/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("customers", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "get_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// POST /api/customers  body 字段: rh_user_id, hospital_name, hospital_type, level, region, address, website, outpatient_daily, outpatient_yearly, beds_total, beds_icu, beds_or, key_departments, contacts, notes, ai_generated_fields, last_follow_at
routerAdd("POST", "/api/customers", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("customers") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "customers",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'hospital_name', type: 'text', required: true },
          { name: 'hospital_type', type: 'text', max: 30 },
          { name: 'level', type: 'text', max: 30 },
          { name: 'region', type: 'text', max: 50 },
          { name: 'address', type: 'text', max: 200 },
          { name: 'website', type: 'text', max: 300 },
          { name: 'outpatient_daily', type: 'number' },
          { name: 'outpatient_yearly', type: 'number' },
          { name: 'beds_total', type: 'number' },
          { name: 'beds_icu', type: 'number' },
          { name: 'beds_or', type: 'number' },
          { name: 'key_departments', type: 'json' },
          { name: 'contacts', type: 'json' },
          { name: 'notes', type: 'text' },
          { name: 'ai_generated_fields', type: 'json' },
          { name: 'last_follow_at', type: 'text', max: 40 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("customers")
  }
  try {
    var coll = ensureCollLocal()
    var body = e.requestInfo().body || {}
    var rec = new Record(coll)
    rec.set("rh_user_id", body.rh_user_id === undefined || body.rh_user_id === null ? "" : String(body.rh_user_id))
    rec.set("hospital_name", body.hospital_name === undefined || body.hospital_name === null ? "" : String(body.hospital_name))
    rec.set("hospital_type", body.hospital_type === undefined || body.hospital_type === null ? "" : String(body.hospital_type))
    rec.set("level", body.level === undefined || body.level === null ? "" : String(body.level))
    rec.set("region", body.region === undefined || body.region === null ? "" : String(body.region))
    rec.set("address", body.address === undefined || body.address === null ? "" : String(body.address))
    rec.set("website", body.website === undefined || body.website === null ? "" : String(body.website))
    rec.set("outpatient_daily", (body.outpatient_daily === undefined || body.outpatient_daily === null) ? 0 : Number(body.outpatient_daily))
    rec.set("outpatient_yearly", (body.outpatient_yearly === undefined || body.outpatient_yearly === null) ? 0 : Number(body.outpatient_yearly))
    rec.set("beds_total", (body.beds_total === undefined || body.beds_total === null) ? 0 : Number(body.beds_total))
    rec.set("beds_icu", (body.beds_icu === undefined || body.beds_icu === null) ? 0 : Number(body.beds_icu))
    rec.set("beds_or", (body.beds_or === undefined || body.beds_or === null) ? 0 : Number(body.beds_or))
    rec.set("key_departments", body.key_departments)
    rec.set("contacts", body.contacts)
    rec.set("notes", body.notes === undefined || body.notes === null ? "" : String(body.notes))
    rec.set("ai_generated_fields", body.ai_generated_fields)
    rec.set("last_follow_at", body.last_follow_at === undefined || body.last_follow_at === null ? "" : String(body.last_follow_at))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("customers create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// PATCH /api/customers/{id}  body 字段同 POST, 只更新 body 里出现的字段
routerAdd("PATCH", "/api/customers/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("customers", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var body = e.requestInfo().body || {}
    if ("rh_user_id" in body) rec.set("rh_user_id", body.rh_user_id === undefined || body.rh_user_id === null ? "" : String(body.rh_user_id))
    if ("hospital_name" in body) rec.set("hospital_name", body.hospital_name === undefined || body.hospital_name === null ? "" : String(body.hospital_name))
    if ("hospital_type" in body) rec.set("hospital_type", body.hospital_type === undefined || body.hospital_type === null ? "" : String(body.hospital_type))
    if ("level" in body) rec.set("level", body.level === undefined || body.level === null ? "" : String(body.level))
    if ("region" in body) rec.set("region", body.region === undefined || body.region === null ? "" : String(body.region))
    if ("address" in body) rec.set("address", body.address === undefined || body.address === null ? "" : String(body.address))
    if ("website" in body) rec.set("website", body.website === undefined || body.website === null ? "" : String(body.website))
    if ("outpatient_daily" in body) rec.set("outpatient_daily", (body.outpatient_daily === undefined || body.outpatient_daily === null) ? 0 : Number(body.outpatient_daily))
    if ("outpatient_yearly" in body) rec.set("outpatient_yearly", (body.outpatient_yearly === undefined || body.outpatient_yearly === null) ? 0 : Number(body.outpatient_yearly))
    if ("beds_total" in body) rec.set("beds_total", (body.beds_total === undefined || body.beds_total === null) ? 0 : Number(body.beds_total))
    if ("beds_icu" in body) rec.set("beds_icu", (body.beds_icu === undefined || body.beds_icu === null) ? 0 : Number(body.beds_icu))
    if ("beds_or" in body) rec.set("beds_or", (body.beds_or === undefined || body.beds_or === null) ? 0 : Number(body.beds_or))
    if ("key_departments" in body) rec.set("key_departments", body.key_departments)
    if ("contacts" in body) rec.set("contacts", body.contacts)
    if ("notes" in body) rec.set("notes", body.notes === undefined || body.notes === null ? "" : String(body.notes))
    if ("ai_generated_fields" in body) rec.set("ai_generated_fields", body.ai_generated_fields)
    if ("last_follow_at" in body) rec.set("last_follow_at", body.last_follow_at === undefined || body.last_follow_at === null ? "" : String(body.last_follow_at))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// DELETE /api/customers/{id}
routerAdd("DELETE", "/api/customers/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("customers", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    $app.delete(rec)
    return e.json(200, { ok: true })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "delete_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

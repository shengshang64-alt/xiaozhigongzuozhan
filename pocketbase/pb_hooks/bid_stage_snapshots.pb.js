/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/bid_stage_snapshots.pb.js — 业务 collection + REST CRUD 路由 (self-contained)
//
// 由 mcp__rh-pb-hooks__install_business_collection 装. 不要直接 Read+Write 这个文件.
// 业务字段: rh_user_id:text, project_id:text, stage:text, label:text, payload:json
// 路由: list,get,create,update,delete
// list filter 字段: rh_user_id,project_id,stage
// list 默认排序: -created

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("bid_stage_snapshots") } catch (_) { existing = null }
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
      addField({ name: 'project_id', type: 'text', required: true })
      addField({ name: 'stage', type: 'text' })
      addField({ name: 'label', type: 'text', max: 200 })
      addField({ name: 'payload', type: 'json' })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) {
        $app.save(existing)
        try { $app.logger().info("bid_stage_snapshots collection upgraded") } catch (_) {}
      }
    } else {
      var col = new Collection({
        type: "base",
        name: "bid_stage_snapshots",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'project_id', type: 'text', required: true },
          { name: 'stage', type: 'text' },
          { name: 'label', type: 'text', max: 200 },
          { name: 'payload', type: 'json' },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
      try { $app.logger().info("bid_stage_snapshots collection created") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("bid_stage_snapshots bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/bid_stage_snapshots?page=1&perPage=50&sort=-created&rh_user_id=...&project_id=...&stage=...
routerAdd("GET", "/api/bid_stage_snapshots", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("bid_stage_snapshots") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "bid_stage_snapshots",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'project_id', type: 'text', required: true },
          { name: 'stage', type: 'text' },
          { name: 'label', type: 'text', max: 200 },
          { name: 'payload', type: 'json' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("bid_stage_snapshots")
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
    if (query.project_id !== undefined && query.project_id !== "") {
      filterParts.push("project_id = {:project_id}")
      params.project_id = String(query.project_id)
    }
    if (query.stage !== undefined && query.stage !== "") {
      filterParts.push("stage = {:stage}")
      params.stage = String(query.stage)
    }
    var filter = filterParts.length > 0 ? filterParts.join(" && ") : ""
    var records = filter
      ? $app.findRecordsByFilter("bid_stage_snapshots", filter, sort, perPage, (page - 1) * perPage, params)
      : $app.findRecordsByFilter("bid_stage_snapshots", "", sort, perPage, (page - 1) * perPage)
    var items = []
    for (var i = 0; i < records.length; i++) {
      items.push(records[i].publicExport())
    }
    var totalItems = items.length
    try {
      var countRecords = filter
        ? $app.findRecordsByFilter("bid_stage_snapshots", filter, sort, 100000, 0, params)
        : $app.findRecordsByFilter("bid_stage_snapshots", "", sort, 100000, 0)
      totalItems = countRecords.length
    } catch (err2) {}
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: totalItems })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("bid_stage_snapshots list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// GET /api/bid_stage_snapshots/{id}
routerAdd("GET", "/api/bid_stage_snapshots/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("bid_stage_snapshots", id) } catch (_) { rec = null }
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
// POST /api/bid_stage_snapshots  body 字段: rh_user_id, project_id, stage, label, payload
routerAdd("POST", "/api/bid_stage_snapshots", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("bid_stage_snapshots") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "bid_stage_snapshots",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'project_id', type: 'text', required: true },
          { name: 'stage', type: 'text' },
          { name: 'label', type: 'text', max: 200 },
          { name: 'payload', type: 'json' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("bid_stage_snapshots")
  }
  try {
    var coll = ensureCollLocal()
    var body = e.requestInfo().body || {}
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var rec = new Record(coll)
    rec.set("rh_user_id", __uid)
    rec.set("project_id", body.project_id === undefined || body.project_id === null ? "" : String(body.project_id))
    rec.set("stage", body.stage === undefined || body.stage === null ? "" : String(body.stage))
    rec.set("label", body.label === undefined || body.label === null ? "" : String(body.label))
    rec.set("payload", body.payload)
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("bid_stage_snapshots create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// PATCH /api/bid_stage_snapshots/{id}  body 字段同 POST, 只更新 body 里出现的字段
routerAdd("PATCH", "/api/bid_stage_snapshots/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("bid_stage_snapshots", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var __own = false
    try { __own = (String(rec.get("rh_user_id")||"") === __uid) } catch(_x) {}
    if (!__own) { try { __own = (String(rec.get("owner_id")||"") === __uid) } catch(_x) {} }
    if (!__own) return e.json(403, { error: "forbidden", message: "无权操作该记录" })
    var body = e.requestInfo().body || {}
    // IDOR fix: owner transfer disabled
    if ("project_id" in body) rec.set("project_id", body.project_id === undefined || body.project_id === null ? "" : String(body.project_id))
    if ("stage" in body) rec.set("stage", body.stage === undefined || body.stage === null ? "" : String(body.stage))
    if ("label" in body) rec.set("label", body.label === undefined || body.label === null ? "" : String(body.label))
    if ("payload" in body) rec.set("payload", body.payload)
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// DELETE /api/bid_stage_snapshots/{id}
routerAdd("DELETE", "/api/bid_stage_snapshots/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("bid_stage_snapshots", id) } catch (_) { rec = null }
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

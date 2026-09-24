/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/projects.pb.js — 业务 collection + REST CRUD 路由 (self-contained)
//
// 由 mcp__rh-pb-hooks__install_business_collection 装. 不要直接 Read+Write 这个文件.
// 业务字段: rh_user_id:text, project_name:text, project_type:text, hospital:text, progress:number, deadline:date, notes:text
// 路由: list,get,create,update,delete
// list filter 字段: rh_user_id
// list 默认排序: -created

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("projects") } catch (_) { existing = null }
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
      addField({ name: 'rh_user_id', type: 'text', required: true, max: 64 })
      addField({ name: 'project_name', type: 'text', required: true, max: 120 })
      addField({ name: 'project_type', type: 'text', required: true, max: 20 })
      addField({ name: 'hospital', type: 'text', max: 120 })
      addField({ name: 'progress', type: 'number' })
      addField({ name: 'deadline', type: 'date' })
      addField({ name: 'notes', type: 'text' })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) {
        $app.save(existing)
        try { $app.logger().info("projects collection upgraded") } catch (_) {}
      }
    } else {
      var col = new Collection({
        type: "base",
        name: "projects",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: 'rh_user_id', type: 'text', required: true, max: 64 },
          { name: 'project_name', type: 'text', required: true, max: 120 },
          { name: 'project_type', type: 'text', required: true, max: 20 },
          { name: 'hospital', type: 'text', max: 120 },
          { name: 'progress', type: 'number' },
          { name: 'deadline', type: 'date' },
          { name: 'notes', type: 'text' },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
      try { $app.logger().info("projects collection created") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("projects bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/projects?page=1&perPage=50&sort=-created&rh_user_id=...
routerAdd("GET", "/api/projects", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("projects") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "projects",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true, max: 64 },
          { name: 'project_name', type: 'text', required: true, max: 120 },
          { name: 'project_type', type: 'text', required: true, max: 20 },
          { name: 'hospital', type: 'text', max: 120 },
          { name: 'progress', type: 'number' },
          { name: 'deadline', type: 'date' },
          { name: 'notes', type: 'text' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("projects")
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
    filterParts.push("rh_user_id = {:rh_user_id}")
      params.rh_user_id = __uid
    var filter = filterParts.length > 0 ? filterParts.join(" && ") : ""
    var records = filter
      ? $app.findRecordsByFilter("projects", filter, sort, perPage, (page - 1) * perPage, params)
      : $app.findRecordsByFilter("projects", "", sort, perPage, (page - 1) * perPage)
    var items = []
    for (var i = 0; i < records.length; i++) {
      items.push(records[i].publicExport())
    }
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: items.length })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("projects list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// GET /api/projects/{id}
routerAdd("GET", "/api/projects/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("projects", id) } catch (_) { rec = null }
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
// POST /api/projects  body 字段: rh_user_id, project_name, project_type, hospital, progress, deadline, notes
routerAdd("POST", "/api/projects", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("projects") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "projects",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true, max: 64 },
          { name: 'project_name', type: 'text', required: true, max: 120 },
          { name: 'project_type', type: 'text', required: true, max: 20 },
          { name: 'hospital', type: 'text', max: 120 },
          { name: 'progress', type: 'number' },
          { name: 'deadline', type: 'date' },
          { name: 'notes', type: 'text' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("projects")
  }
  try {
    var coll = ensureCollLocal()
    var body = e.requestInfo().body || {}
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var rec = new Record(coll)
    rec.set("rh_user_id", __uid)
    rec.set("project_name", body.project_name === undefined || body.project_name === null ? "" : String(body.project_name))
    rec.set("project_type", body.project_type === undefined || body.project_type === null ? "" : String(body.project_type))
    rec.set("hospital", body.hospital === undefined || body.hospital === null ? "" : String(body.hospital))
    rec.set("progress", (body.progress === undefined || body.progress === null) ? 0 : Number(body.progress))
    rec.set("deadline", body.deadline === undefined || body.deadline === null ? "" : String(body.deadline))
    rec.set("notes", body.notes === undefined || body.notes === null ? "" : String(body.notes))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("projects create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// PATCH /api/projects/{id}  body 字段同 POST, 只更新 body 里出现的字段
routerAdd("PATCH", "/api/projects/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("projects", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var __own = false
    try { __own = (String(rec.get("rh_user_id")||"") === __uid) } catch(_x) {}
    if (!__own) { try { __own = (String(rec.get("owner_id")||"") === __uid) } catch(_x) {} }
    if (!__own) return e.json(403, { error: "forbidden", message: "无权操作该记录" })
    var body = e.requestInfo().body || {}
    // IDOR fix: owner transfer disabled
    if ("project_name" in body) rec.set("project_name", body.project_name === undefined || body.project_name === null ? "" : String(body.project_name))
    if ("project_type" in body) rec.set("project_type", body.project_type === undefined || body.project_type === null ? "" : String(body.project_type))
    if ("hospital" in body) rec.set("hospital", body.hospital === undefined || body.hospital === null ? "" : String(body.hospital))
    if ("progress" in body) rec.set("progress", (body.progress === undefined || body.progress === null) ? 0 : Number(body.progress))
    if ("deadline" in body) rec.set("deadline", body.deadline === undefined || body.deadline === null ? "" : String(body.deadline))
    if ("notes" in body) rec.set("notes", body.notes === undefined || body.notes === null ? "" : String(body.notes))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// DELETE /api/projects/{id}
routerAdd("DELETE", "/api/projects/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("projects", id) } catch (_) { rec = null }
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

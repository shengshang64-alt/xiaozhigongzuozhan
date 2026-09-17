/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/intel_prefs.pb.js — 业务 collection + REST CRUD 路由 (self-contained)
//
// 由 mcp__rh-pb-hooks__install_business_collection 装. 不要直接 Read+Write 这个文件.
// 业务字段: owner_id:text, region_focus:text, focus_sources:json, focus_topics:json
// 路由: list,get,create,update,delete
// list filter 字段: owner_id
// list 默认排序: -created

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("intel_prefs") } catch (_) { existing = null }
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
      addField({ name: 'owner_id', type: 'text', required: true })
      addField({ name: 'region_focus', type: 'text' })
      addField({ name: 'focus_sources', type: 'json' })
      addField({ name: 'focus_topics', type: 'json' })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) {
        $app.save(existing)
        try { $app.logger().info("intel_prefs collection upgraded") } catch (_) {}
      }
    } else {
      var col = new Collection({
        type: "base",
        name: "intel_prefs",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: 'owner_id', type: 'text', required: true },
          { name: 'region_focus', type: 'text' },
          { name: 'focus_sources', type: 'json' },
          { name: 'focus_topics', type: 'json' },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
      try { $app.logger().info("intel_prefs collection created") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("intel_prefs bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/intel_prefs?page=1&perPage=50&sort=-created&owner_id=...
routerAdd("GET", "/api/intel_prefs", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("intel_prefs") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "intel_prefs",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'owner_id', type: 'text', required: true },
          { name: 'region_focus', type: 'text' },
          { name: 'focus_sources', type: 'json' },
          { name: 'focus_topics', type: 'json' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("intel_prefs")
  }
  try {
    ensureCollLocal()
    var info = e.requestInfo()
    var query = info.query || {}
    var page = parseInt(String(query.page || "1"), 10) || 1
    var perPage = parseInt(String(query.perPage || "50"), 10) || 50
    if (perPage > 200) perPage = 200
    var sort = String(query.sort || "-created")
    var filterParts = []
    var params = {}
    if (query.owner_id !== undefined && query.owner_id !== "") {
      filterParts.push("owner_id = {:owner_id}")
      params.owner_id = String(query.owner_id)
    }
    var filter = filterParts.length > 0 ? filterParts.join(" && ") : ""
    var records = filter
      ? $app.findRecordsByFilter("intel_prefs", filter, sort, perPage, (page - 1) * perPage, params)
      : $app.findRecordsByFilter("intel_prefs", "", sort, perPage, (page - 1) * perPage)
    var items = []
    for (var i = 0; i < records.length; i++) {
      items.push(records[i].publicExport())
    }
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: items.length })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("intel_prefs list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// GET /api/intel_prefs/{id}
routerAdd("GET", "/api/intel_prefs/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("intel_prefs", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "get_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// POST /api/intel_prefs  body 字段: owner_id, region_focus, focus_sources, focus_topics
routerAdd("POST", "/api/intel_prefs", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("intel_prefs") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "intel_prefs",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'owner_id', type: 'text', required: true },
          { name: 'region_focus', type: 'text' },
          { name: 'focus_sources', type: 'json' },
          { name: 'focus_topics', type: 'json' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("intel_prefs")
  }
  try {
    var coll = ensureCollLocal()
    var body = e.requestInfo().body || {}
    var rec = new Record(coll)
    rec.set("owner_id", body.owner_id === undefined || body.owner_id === null ? "" : String(body.owner_id))
    rec.set("region_focus", body.region_focus === undefined || body.region_focus === null ? "" : String(body.region_focus))
    rec.set("focus_sources", body.focus_sources)
    rec.set("focus_topics", body.focus_topics)
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("intel_prefs create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// PATCH /api/intel_prefs/{id}  body 字段同 POST, 只更新 body 里出现的字段
routerAdd("PATCH", "/api/intel_prefs/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("intel_prefs", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var body = e.requestInfo().body || {}
    if ("owner_id" in body) rec.set("owner_id", body.owner_id === undefined || body.owner_id === null ? "" : String(body.owner_id))
    if ("region_focus" in body) rec.set("region_focus", body.region_focus === undefined || body.region_focus === null ? "" : String(body.region_focus))
    if ("focus_sources" in body) rec.set("focus_sources", body.focus_sources)
    if ("focus_topics" in body) rec.set("focus_topics", body.focus_topics)
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// DELETE /api/intel_prefs/{id}
routerAdd("DELETE", "/api/intel_prefs/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("intel_prefs", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    $app.delete(rec)
    return e.json(200, { ok: true })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "delete_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

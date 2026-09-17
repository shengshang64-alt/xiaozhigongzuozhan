/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/ppt_decks.pb.js — 业务 collection + REST CRUD 路由 (self-contained)
//
// 由 mcp__rh-pb-hooks__install_business_collection 装. 不要直接 Read+Write 这个文件.
// 业务字段: rh_user_id:text, deck_name:text, deck_type:text, audience:text, duration_min:number, material_ref:text, slides:json, doc_status:text
// 路由: list,get,create,update,delete
// list filter 字段: rh_user_id
// list 默认排序: -updated

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("ppt_decks") } catch (_) { existing = null }
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
      addField({ name: 'deck_name', type: 'text', required: true })
      addField({ name: 'deck_type', type: 'text' })
      addField({ name: 'audience', type: 'text' })
      addField({ name: 'duration_min', type: 'number' })
      addField({ name: 'material_ref', type: 'text' })
      addField({ name: 'slides', type: 'json' })
      addField({ name: 'doc_status', type: 'text' })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) {
        $app.save(existing)
        try { $app.logger().info("ppt_decks collection upgraded") } catch (_) {}
      }
    } else {
      var col = new Collection({
        type: "base",
        name: "ppt_decks",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'deck_name', type: 'text', required: true },
          { name: 'deck_type', type: 'text' },
          { name: 'audience', type: 'text' },
          { name: 'duration_min', type: 'number' },
          { name: 'material_ref', type: 'text' },
          { name: 'slides', type: 'json' },
          { name: 'doc_status', type: 'text' },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
      try { $app.logger().info("ppt_decks collection created") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("ppt_decks bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/ppt_decks?page=1&perPage=50&sort=-created&rh_user_id=...
routerAdd("GET", "/api/ppt_decks", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("ppt_decks") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "ppt_decks",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'deck_name', type: 'text', required: true },
          { name: 'deck_type', type: 'text' },
          { name: 'audience', type: 'text' },
          { name: 'duration_min', type: 'number' },
          { name: 'material_ref', type: 'text' },
          { name: 'slides', type: 'json' },
          { name: 'doc_status', type: 'text' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("ppt_decks")
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
    if (query.q !== undefined && String(query.q) !== "") {
      filterParts.push("deck_name ~ {:q_kw}")
      params.q_kw = "%" + String(query.q) + "%"
    }
    var filter = filterParts.length > 0 ? filterParts.join(" && ") : ""
    var records = filter
      ? $app.findRecordsByFilter("ppt_decks", filter, sort, perPage, (page - 1) * perPage, params)
      : $app.findRecordsByFilter("ppt_decks", "", sort, perPage, (page - 1) * perPage)
    var items = []
    for (var i = 0; i < records.length; i++) {
      items.push(records[i].publicExport())
    }
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: items.length })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("ppt_decks list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// GET /api/ppt_decks/{id}
routerAdd("GET", "/api/ppt_decks/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("ppt_decks", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "get_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// POST /api/ppt_decks  body 字段: rh_user_id, deck_name, deck_type, audience, duration_min, material_ref, slides, doc_status
routerAdd("POST", "/api/ppt_decks", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("ppt_decks") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "ppt_decks",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'deck_name', type: 'text', required: true },
          { name: 'deck_type', type: 'text' },
          { name: 'audience', type: 'text' },
          { name: 'duration_min', type: 'number' },
          { name: 'material_ref', type: 'text' },
          { name: 'slides', type: 'json' },
          { name: 'doc_status', type: 'text' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("ppt_decks")
  }
  try {
    var coll = ensureCollLocal()
    var body = e.requestInfo().body || {}
    var rec = new Record(coll)
    rec.set("rh_user_id", body.rh_user_id === undefined || body.rh_user_id === null ? "" : String(body.rh_user_id))
    rec.set("deck_name", body.deck_name === undefined || body.deck_name === null ? "" : String(body.deck_name))
    rec.set("deck_type", body.deck_type === undefined || body.deck_type === null ? "" : String(body.deck_type))
    rec.set("audience", body.audience === undefined || body.audience === null ? "" : String(body.audience))
    rec.set("duration_min", (body.duration_min === undefined || body.duration_min === null) ? 0 : Number(body.duration_min))
    rec.set("material_ref", body.material_ref === undefined || body.material_ref === null ? "" : String(body.material_ref))
    rec.set("slides", body.slides)
    rec.set("doc_status", body.doc_status === undefined || body.doc_status === null ? "" : String(body.doc_status))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("ppt_decks create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// PATCH /api/ppt_decks/{id}  body 字段同 POST, 只更新 body 里出现的字段
routerAdd("PATCH", "/api/ppt_decks/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("ppt_decks", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var body = e.requestInfo().body || {}
    if ("rh_user_id" in body) rec.set("rh_user_id", body.rh_user_id === undefined || body.rh_user_id === null ? "" : String(body.rh_user_id))
    if ("deck_name" in body) rec.set("deck_name", body.deck_name === undefined || body.deck_name === null ? "" : String(body.deck_name))
    if ("deck_type" in body) rec.set("deck_type", body.deck_type === undefined || body.deck_type === null ? "" : String(body.deck_type))
    if ("audience" in body) rec.set("audience", body.audience === undefined || body.audience === null ? "" : String(body.audience))
    if ("duration_min" in body) rec.set("duration_min", (body.duration_min === undefined || body.duration_min === null) ? 0 : Number(body.duration_min))
    if ("material_ref" in body) rec.set("material_ref", body.material_ref === undefined || body.material_ref === null ? "" : String(body.material_ref))
    if ("slides" in body) rec.set("slides", body.slides)
    if ("doc_status" in body) rec.set("doc_status", body.doc_status === undefined || body.doc_status === null ? "" : String(body.doc_status))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// DELETE /api/ppt_decks/{id}
routerAdd("DELETE", "/api/ppt_decks/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("ppt_decks", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    $app.delete(rec)
    return e.json(200, { ok: true })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "delete_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

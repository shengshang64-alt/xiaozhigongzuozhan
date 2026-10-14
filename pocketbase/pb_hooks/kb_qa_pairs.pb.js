/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/kb_qa_pairs.pb.js — 业务 collection + REST CRUD 路由 (self-contained)
//
// 由 mcp__rh-pb-hooks__install_business_collection 装. 不要直接 Read+Write 这个文件.
// 业务字段: rh_user_id:text, question:text, answer:text, category:text, status:text, source:text, visibility:text
// 路由: list,get,create,update,delete
// list filter 字段: rh_user_id,status,category,visibility
// list 默认排序: -updated

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("kb_qa_pairs") } catch (_) { existing = null }
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
      addField({ name: 'rh_user_id', type: 'text', required: true, max: 100 })
      addField({ name: 'question', type: 'text', required: true, max: 1000 })
      addField({ name: 'answer', type: 'text', max: 20000 })
      addField({ name: 'category', type: 'text', max: 40 })
      addField({ name: 'status', type: 'text', max: 20 })
      addField({ name: 'source', type: 'text', max: 40 })
      addField({ name: 'visibility', type: 'text', max: 20 })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) {
        $app.save(existing)
        try { $app.logger().info("kb_qa_pairs collection upgraded") } catch (_) {}
      }
    } else {
      var col = new Collection({
        type: "base",
        name: "kb_qa_pairs",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: 'rh_user_id', type: 'text', required: true, max: 100 },
          { name: 'question', type: 'text', required: true, max: 1000 },
          { name: 'answer', type: 'text', max: 20000 },
          { name: 'category', type: 'text', max: 40 },
          { name: 'status', type: 'text', max: 20 },
          { name: 'source', type: 'text', max: 40 },
          { name: 'visibility', type: 'text', max: 20 },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
      try { $app.logger().info("kb_qa_pairs collection created") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("kb_qa_pairs bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/kb_qa_pairs?page=1&perPage=50&sort=-created&rh_user_id=...&status=...&category=...&visibility=...
routerAdd("GET", "/api/kb_qa_pairs", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("kb_qa_pairs") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "kb_qa_pairs",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true, max: 100 },
          { name: 'question', type: 'text', required: true, max: 1000 },
          { name: 'answer', type: 'text', max: 20000 },
          { name: 'category', type: 'text', max: 40 },
          { name: 'status', type: 'text', max: 20 },
          { name: 'source', type: 'text', max: 40 },
          { name: 'visibility', type: 'text', max: 20 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("kb_qa_pairs")
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
    var sort = String(query.sort || "-updated")
    var filterParts = []
    var params = {}
    if (query.rh_user_id !== undefined && query.rh_user_id !== "") {
      filterParts.push("rh_user_id = {:rh_user_id}")
      params.rh_user_id = String(query.rh_user_id)
    }
    if (query.status !== undefined && query.status !== "") {
      filterParts.push("status = {:status}")
      params.status = String(query.status)
    }
    if (query.category !== undefined && query.category !== "") {
      filterParts.push("category = {:category}")
      params.category = String(query.category)
    }
    if (query.visibility !== undefined && query.visibility !== "") {
      filterParts.push("visibility = {:visibility}")
      params.visibility = String(query.visibility)
    }
    var filter = filterParts.length > 0 ? filterParts.join(" && ") : ""
    var records = filter
      ? $app.findRecordsByFilter("kb_qa_pairs", filter, sort, perPage, (page - 1) * perPage, params)
      : $app.findRecordsByFilter("kb_qa_pairs", "", sort, perPage, (page - 1) * perPage)
    var items = []
    for (var i = 0; i < records.length; i++) {
      items.push(records[i].publicExport())
    }
    var totalItems = items.length
    try {
      var countRecords = filter
        ? $app.findRecordsByFilter("kb_qa_pairs", filter, sort, 100000, 0, params)
        : $app.findRecordsByFilter("kb_qa_pairs", "", sort, 100000, 0)
      totalItems = countRecords.length
    } catch (err2) {}
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: totalItems })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("kb_qa_pairs list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// GET /api/kb_qa_pairs/{id}
routerAdd("GET", "/api/kb_qa_pairs/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("kb_qa_pairs", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "get_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// POST /api/kb_qa_pairs  body 字段: rh_user_id, question, answer, category, status, source, visibility
routerAdd("POST", "/api/kb_qa_pairs", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("kb_qa_pairs") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "kb_qa_pairs",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true, max: 100 },
          { name: 'question', type: 'text', required: true, max: 1000 },
          { name: 'answer', type: 'text', max: 20000 },
          { name: 'category', type: 'text', max: 40 },
          { name: 'status', type: 'text', max: 20 },
          { name: 'source', type: 'text', max: 40 },
          { name: 'visibility', type: 'text', max: 20 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("kb_qa_pairs")
  }
  try {
    var coll = ensureCollLocal()
    var body = e.requestInfo().body || {}
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var rec = new Record(coll)
    rec.set("rh_user_id", __uid)
    rec.set("question", body.question === undefined || body.question === null ? "" : String(body.question))
    rec.set("answer", body.answer === undefined || body.answer === null ? "" : String(body.answer))
    rec.set("category", body.category === undefined || body.category === null ? "" : String(body.category))
    rec.set("status", body.status === undefined || body.status === null ? "" : String(body.status))
    rec.set("source", body.source === undefined || body.source === null ? "" : String(body.source))
    rec.set("visibility", body.visibility === undefined || body.visibility === null ? "" : String(body.visibility))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("kb_qa_pairs create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// PATCH /api/kb_qa_pairs/{id}  body 字段同 POST, 只更新 body 里出现的字段
routerAdd("PATCH", "/api/kb_qa_pairs/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("kb_qa_pairs", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var body = e.requestInfo().body || {}
    // IDOR fix: owner transfer disabled
    if ("question" in body) rec.set("question", body.question === undefined || body.question === null ? "" : String(body.question))
    if ("answer" in body) rec.set("answer", body.answer === undefined || body.answer === null ? "" : String(body.answer))
    if ("category" in body) rec.set("category", body.category === undefined || body.category === null ? "" : String(body.category))
    if ("status" in body) rec.set("status", body.status === undefined || body.status === null ? "" : String(body.status))
    if ("source" in body) rec.set("source", body.source === undefined || body.source === null ? "" : String(body.source))
    if ("visibility" in body) rec.set("visibility", body.visibility === undefined || body.visibility === null ? "" : String(body.visibility))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// DELETE /api/kb_qa_pairs/{id}
routerAdd("DELETE", "/api/kb_qa_pairs/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("kb_qa_pairs", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    $app.delete(rec)
    return e.json(200, { ok: true })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "delete_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

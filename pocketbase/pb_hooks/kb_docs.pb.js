/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/kb_docs.pb.js — 业务 collection + REST CRUD 路由 (self-contained)
//
// 由 mcp__rh-pb-hooks__install_business_collection 装. 不要直接 Read+Write 这个文件.
// 业务字段: rh_user_id:text, title:text, folder_path:text, content:text, doc_format:text, visibility:text, summary:text, keywords:json, source_file_name:text, uploader_name:text, doc_category:text, ai_context_mode:text, retrieval_weight:number, is_sensitive:bool, kb_track:text, kb_bucket:text
// 路由: list,get,create,update,delete
// list filter 字段: rh_user_id,visibility,folder_path,doc_format,kb_track,kb_bucket
// list 默认排序: -updated

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("kb_docs") } catch (_) { existing = null }
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
      addField({ name: 'title', type: 'text', required: true, max: 300 })
      addField({ name: 'folder_path', type: 'text', max: 500 })
      addField({ name: 'content', type: 'text', max: 500000 })
      addField({ name: 'doc_format', type: 'text', max: 20 })
      addField({ name: 'visibility', type: 'text', max: 20 })
      addField({ name: 'summary', type: 'text', max: 1000 })
      addField({ name: 'keywords', type: 'json' })
      addField({ name: 'source_file_name', type: 'text', max: 300 })
      addField({ name: 'uploader_name', type: 'text', max: 100 })
      addField({ name: 'doc_category', type: 'text', max: 40 })
      addField({ name: 'ai_context_mode', type: 'text', max: 20 })
      addField({ name: 'retrieval_weight', type: 'number' })
      addField({ name: 'is_sensitive', type: 'bool' })
      addField({ name: 'kb_track', type: 'text', max: 40 })
      addField({ name: 'kb_bucket', type: 'text', max: 40 })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) {
        $app.save(existing)
        try { $app.logger().info("kb_docs collection upgraded") } catch (_) {}
      }
    } else {
      var col = new Collection({
        type: "base",
        name: "kb_docs",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: 'rh_user_id', type: 'text', required: true, max: 100 },
          { name: 'title', type: 'text', required: true, max: 300 },
          { name: 'folder_path', type: 'text', max: 500 },
          { name: 'content', type: 'text', max: 500000 },
          { name: 'doc_format', type: 'text', max: 20 },
          { name: 'visibility', type: 'text', max: 20 },
          { name: 'summary', type: 'text', max: 1000 },
          { name: 'keywords', type: 'json' },
          { name: 'source_file_name', type: 'text', max: 300 },
          { name: 'uploader_name', type: 'text', max: 100 },
          { name: 'doc_category', type: 'text', max: 40 },
          { name: 'ai_context_mode', type: 'text', max: 20 },
          { name: 'retrieval_weight', type: 'number' },
          { name: 'is_sensitive', type: 'bool' },
          { name: 'kb_track', type: 'text', max: 40 },
          { name: 'kb_bucket', type: 'text', max: 40 },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
      try { $app.logger().info("kb_docs collection created") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("kb_docs bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/kb_docs?page=1&perPage=50&sort=-created&rh_user_id=...&visibility=...&folder_path=...&doc_format=...
routerAdd("GET", "/api/kb_docs", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("kb_docs") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "kb_docs",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true, max: 100 },
          { name: 'title', type: 'text', required: true, max: 300 },
          { name: 'folder_path', type: 'text', max: 500 },
          { name: 'content', type: 'text', max: 500000 },
          { name: 'doc_format', type: 'text', max: 20 },
          { name: 'visibility', type: 'text', max: 20 },
          { name: 'summary', type: 'text', max: 1000 },
          { name: 'keywords', type: 'json' },
          { name: 'source_file_name', type: 'text', max: 300 },
          { name: 'uploader_name', type: 'text', max: 100 },
          { name: 'doc_category', type: 'text', max: 40 },
          { name: 'ai_context_mode', type: 'text', max: 20 },
          { name: 'retrieval_weight', type: 'number' },
          { name: 'is_sensitive', type: 'bool' },
          { name: 'kb_track', type: 'text', max: 40 },
          { name: 'kb_bucket', type: 'text', max: 40 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("kb_docs")
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
    if (query.rh_user_id !== undefined && query.rh_user_id !== "") {
      filterParts.push("rh_user_id = {:rh_user_id}")
      params.rh_user_id = String(query.rh_user_id)
    }
    if (query.visibility !== undefined && query.visibility !== "") {
      filterParts.push("visibility = {:visibility}")
      params.visibility = String(query.visibility)
    }
    if (query.folder_path !== undefined && query.folder_path !== "") {
      filterParts.push("folder_path = {:folder_path}")
      params.folder_path = String(query.folder_path)
    }
    if (query.doc_format !== undefined && query.doc_format !== "") {
      filterParts.push("doc_format = {:doc_format}")
      params.doc_format = String(query.doc_format)
    }
    if (query.kb_track !== undefined && query.kb_track !== "") {
      filterParts.push("kb_track = {:kb_track}")
      params.kb_track = String(query.kb_track)
    }
    if (query.kb_bucket !== undefined && query.kb_bucket !== "") {
      filterParts.push("kb_bucket = {:kb_bucket}")
      params.kb_bucket = String(query.kb_bucket)
    }
    if (query.q !== undefined && String(query.q) !== "") {
      filterParts.push("(title ~ {:q_kw} || source_file_name ~ {:q_kw2})")
      params.q_kw = "%" + String(query.q) + "%"
      params.q_kw2 = "%" + String(query.q) + "%"
    }
    var filter = filterParts.length > 0 ? filterParts.join(" && ") : ""
    var records = filter
      ? $app.findRecordsByFilter("kb_docs", filter, sort, perPage, (page - 1) * perPage, params)
      : $app.findRecordsByFilter("kb_docs", "", sort, perPage, (page - 1) * perPage)
    var items = []
    for (var i = 0; i < records.length; i++) {
      items.push(records[i].publicExport())
    }
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: items.length })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("kb_docs list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// GET /api/kb_docs/{id}
routerAdd("GET", "/api/kb_docs/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("kb_docs", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "get_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// POST /api/kb_docs  body 字段: rh_user_id, title, folder_path, content, doc_format, visibility, summary, keywords, source_file_name, uploader_name, doc_category, ai_context_mode, retrieval_weight, is_sensitive
routerAdd("POST", "/api/kb_docs", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("kb_docs") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "kb_docs",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true, max: 100 },
          { name: 'title', type: 'text', required: true, max: 300 },
          { name: 'folder_path', type: 'text', max: 500 },
          { name: 'content', type: 'text', max: 500000 },
          { name: 'doc_format', type: 'text', max: 20 },
          { name: 'visibility', type: 'text', max: 20 },
          { name: 'summary', type: 'text', max: 1000 },
          { name: 'keywords', type: 'json' },
          { name: 'source_file_name', type: 'text', max: 300 },
          { name: 'uploader_name', type: 'text', max: 100 },
          { name: 'doc_category', type: 'text', max: 40 },
          { name: 'ai_context_mode', type: 'text', max: 20 },
          { name: 'retrieval_weight', type: 'number' },
          { name: 'is_sensitive', type: 'bool' },
          { name: 'kb_track', type: 'text', max: 40 },
          { name: 'kb_bucket', type: 'text', max: 40 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("kb_docs")
  }
  try {
    var coll = ensureCollLocal()
    var body = e.requestInfo().body || {}
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var rec = new Record(coll)
    rec.set("rh_user_id", __uid)
    rec.set("title", body.title === undefined || body.title === null ? "" : String(body.title))
    rec.set("folder_path", body.folder_path === undefined || body.folder_path === null ? "" : String(body.folder_path))
    rec.set("content", body.content === undefined || body.content === null ? "" : String(body.content))
    rec.set("doc_format", body.doc_format === undefined || body.doc_format === null ? "" : String(body.doc_format))
    rec.set("visibility", body.visibility === undefined || body.visibility === null ? "" : String(body.visibility))
    rec.set("summary", body.summary === undefined || body.summary === null ? "" : String(body.summary))
    rec.set("keywords", body.keywords)
    rec.set("source_file_name", body.source_file_name === undefined || body.source_file_name === null ? "" : String(body.source_file_name))
    rec.set("uploader_name", body.uploader_name === undefined || body.uploader_name === null ? "" : String(body.uploader_name))
    rec.set("doc_category", body.doc_category === undefined || body.doc_category === null ? "" : String(body.doc_category))
    rec.set("ai_context_mode", body.ai_context_mode === undefined || body.ai_context_mode === null ? "" : String(body.ai_context_mode))
    rec.set("retrieval_weight", (body.retrieval_weight === undefined || body.retrieval_weight === null) ? 0 : Number(body.retrieval_weight))
    rec.set("is_sensitive", !!body.is_sensitive)
    rec.set("kb_track", body.kb_track === undefined || body.kb_track === null ? "" : String(body.kb_track))
    rec.set("kb_bucket", body.kb_bucket === undefined || body.kb_bucket === null ? "" : String(body.kb_bucket))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("kb_docs create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// PATCH /api/kb_docs/{id}  body 字段同 POST, 只更新 body 里出现的字段
routerAdd("PATCH", "/api/kb_docs/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("kb_docs", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var body = e.requestInfo().body || {}
    // IDOR fix: owner transfer disabled
    if ("title" in body) rec.set("title", body.title === undefined || body.title === null ? "" : String(body.title))
    if ("folder_path" in body) rec.set("folder_path", body.folder_path === undefined || body.folder_path === null ? "" : String(body.folder_path))
    if ("content" in body) rec.set("content", body.content === undefined || body.content === null ? "" : String(body.content))
    if ("doc_format" in body) rec.set("doc_format", body.doc_format === undefined || body.doc_format === null ? "" : String(body.doc_format))
    if ("visibility" in body) rec.set("visibility", body.visibility === undefined || body.visibility === null ? "" : String(body.visibility))
    if ("summary" in body) rec.set("summary", body.summary === undefined || body.summary === null ? "" : String(body.summary))
    if ("keywords" in body) rec.set("keywords", body.keywords)
    if ("source_file_name" in body) rec.set("source_file_name", body.source_file_name === undefined || body.source_file_name === null ? "" : String(body.source_file_name))
    if ("uploader_name" in body) rec.set("uploader_name", body.uploader_name === undefined || body.uploader_name === null ? "" : String(body.uploader_name))
    if ("doc_category" in body) rec.set("doc_category", body.doc_category === undefined || body.doc_category === null ? "" : String(body.doc_category))
    if ("ai_context_mode" in body) rec.set("ai_context_mode", body.ai_context_mode === undefined || body.ai_context_mode === null ? "" : String(body.ai_context_mode))
    if ("retrieval_weight" in body) rec.set("retrieval_weight", (body.retrieval_weight === undefined || body.retrieval_weight === null) ? 0 : Number(body.retrieval_weight))
    if ("is_sensitive" in body) rec.set("is_sensitive", !!body.is_sensitive)
    if ("kb_track" in body) rec.set("kb_track", body.kb_track === undefined || body.kb_track === null ? "" : String(body.kb_track))
    if ("kb_bucket" in body) rec.set("kb_bucket", body.kb_bucket === undefined || body.kb_bucket === null ? "" : String(body.kb_bucket))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// DELETE /api/kb_docs/{id}
routerAdd("DELETE", "/api/kb_docs/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("kb_docs", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    $app.delete(rec)
    return e.json(200, { ok: true })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "delete_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

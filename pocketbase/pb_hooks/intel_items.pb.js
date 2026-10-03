/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/intel_items.pb.js — 业务 collection + REST CRUD 路由 (self-contained)
//
// 由 mcp__rh-pb-hooks__install_business_collection 装. 不要直接 Read+Write 这个文件.
// 业务字段: source_id:text, source_name:text, title:text, url:text, content_snippet:text, item_type:text, summary:text, tags:json, region:text, item_status:text, added_by:text, owner_id:text, published_at:text, visibility:text, structured:json
// 路由: list,get,create,update,delete
// list filter 字段: item_type,item_status,owner_id,source_id
// list 默认排序: -published_at

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("intel_items") } catch (_) { existing = null }
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
      addField({ name: 'source_id', type: 'text', max: 40 })
      addField({ name: 'source_name', type: 'text', max: 100 })
      addField({ name: 'title', type: 'text', required: true, max: 300 })
      addField({ name: 'url', type: 'text', max: 600 })
      addField({ name: 'content_snippet', type: 'text', max: 2500 })
      addField({ name: 'item_type', type: 'text', max: 20 })
      addField({ name: 'summary', type: 'text', max: 600 })
      addField({ name: 'tags', type: 'json' })
      addField({ name: 'region', type: 'text', max: 50 })
      addField({ name: 'item_status', type: 'text', max: 20 })
      addField({ name: 'added_by', type: 'text', max: 20 })
      addField({ name: 'owner_id', type: 'text', max: 60 })
      addField({ name: 'published_at', type: 'text', max: 40 })
      addField({ name: 'visibility', type: 'text' })
      addField({ name: 'structured', type: 'json' })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) {
        $app.save(existing)
        try { $app.logger().info("intel_items collection upgraded") } catch (_) {}
      }
    } else {
      var col = new Collection({
        type: "base",
        name: "intel_items",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: 'source_id', type: 'text', max: 40 },
          { name: 'source_name', type: 'text', max: 100 },
          { name: 'title', type: 'text', required: true, max: 300 },
          { name: 'url', type: 'text', max: 600 },
          { name: 'content_snippet', type: 'text', max: 2500 },
          { name: 'item_type', type: 'text', max: 20 },
          { name: 'summary', type: 'text', max: 600 },
          { name: 'tags', type: 'json' },
          { name: 'region', type: 'text', max: 50 },
          { name: 'item_status', type: 'text', max: 20 },
          { name: 'added_by', type: 'text', max: 20 },
          { name: 'owner_id', type: 'text', max: 60 },
          { name: 'published_at', type: 'text', max: 40 },
          { name: 'visibility', type: 'text' },
          { name: 'structured', type: 'json' },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
      try { $app.logger().info("intel_items collection created") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("intel_items bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/intel_items?page=1&perPage=50&sort=-created&item_type=...&item_status=...&owner_id=...&source_id=...
routerAdd("GET", "/api/intel_items", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("intel_items") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "intel_items",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'source_id', type: 'text', max: 40 },
          { name: 'source_name', type: 'text', max: 100 },
          { name: 'title', type: 'text', required: true, max: 300 },
          { name: 'url', type: 'text', max: 600 },
          { name: 'content_snippet', type: 'text', max: 2500 },
          { name: 'item_type', type: 'text', max: 20 },
          { name: 'summary', type: 'text', max: 600 },
          { name: 'tags', type: 'json' },
          { name: 'region', type: 'text', max: 50 },
          { name: 'item_status', type: 'text', max: 20 },
          { name: 'added_by', type: 'text', max: 20 },
          { name: 'owner_id', type: 'text', max: 60 },
          { name: 'published_at', type: 'text', max: 40 },
          { name: 'visibility', type: 'text' },
          { name: 'structured', type: 'json' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("intel_items")
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
    var sort = String(query.sort || "-published_at")
    var filterParts = []
    var params = {}
    if (query.item_type !== undefined && query.item_type !== "") {
      filterParts.push("item_type = {:item_type}")
      params.item_type = String(query.item_type)
    }
    if (query.item_status !== undefined && query.item_status !== "") {
      filterParts.push("item_status = {:item_status}")
      params.item_status = String(query.item_status)
    }
    if (query.owner_id !== undefined && query.owner_id !== "") {
      filterParts.push("owner_id = {:owner_id}")
      params.owner_id = String(query.owner_id)
    }
    if (query.source_id !== undefined && query.source_id !== "") {
      filterParts.push("source_id = {:source_id}")
      params.source_id = String(query.source_id)
    }
    if (query.q !== undefined && String(query.q) !== "") {
      filterParts.push("title ~ {:q_kw}")
      params.q_kw = "%" + String(query.q) + "%"
    }
    var filter = filterParts.length > 0 ? filterParts.join(" && ") : ""
    var records = filter
      ? $app.findRecordsByFilter("intel_items", filter, sort, perPage, (page - 1) * perPage, params)
      : $app.findRecordsByFilter("intel_items", "", sort, perPage, (page - 1) * perPage)
    var items = []
    for (var i = 0; i < records.length; i++) {
      items.push(records[i].publicExport())
    }
    var totalItems = items.length
    try {
      var countRecords = filter
        ? $app.findRecordsByFilter("intel_items", filter, sort, 100000, 0, params)
        : $app.findRecordsByFilter("intel_items", "", sort, 100000, 0)
      totalItems = countRecords.length
    } catch (err2) {}
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: totalItems })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("intel_items list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// GET /api/intel_items/{id}
routerAdd("GET", "/api/intel_items/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("intel_items", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "get_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// POST /api/intel_items  body 字段: source_id, source_name, title, url, content_snippet, item_type, summary, tags, region, item_status, added_by, owner_id, published_at, visibility
routerAdd("POST", "/api/intel_items", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("intel_items") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "intel_items",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'source_id', type: 'text', max: 40 },
          { name: 'source_name', type: 'text', max: 100 },
          { name: 'title', type: 'text', required: true, max: 300 },
          { name: 'url', type: 'text', max: 600 },
          { name: 'content_snippet', type: 'text', max: 2500 },
          { name: 'item_type', type: 'text', max: 20 },
          { name: 'summary', type: 'text', max: 600 },
          { name: 'tags', type: 'json' },
          { name: 'region', type: 'text', max: 50 },
          { name: 'item_status', type: 'text', max: 20 },
          { name: 'added_by', type: 'text', max: 20 },
          { name: 'owner_id', type: 'text', max: 60 },
          { name: 'published_at', type: 'text', max: 40 },
          { name: 'visibility', type: 'text' },
          { name: 'structured', type: 'json' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("intel_items")
  }
  try {
    var coll = ensureCollLocal()
    var body = e.requestInfo().body || {}
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var rec = new Record(coll)
    rec.set("source_id", body.source_id === undefined || body.source_id === null ? "" : String(body.source_id))
    rec.set("source_name", body.source_name === undefined || body.source_name === null ? "" : String(body.source_name))
    rec.set("title", body.title === undefined || body.title === null ? "" : String(body.title))
    rec.set("url", body.url === undefined || body.url === null ? "" : String(body.url))
    rec.set("content_snippet", body.content_snippet === undefined || body.content_snippet === null ? "" : String(body.content_snippet))
    rec.set("item_type", body.item_type === undefined || body.item_type === null ? "" : String(body.item_type))
    rec.set("summary", body.summary === undefined || body.summary === null ? "" : String(body.summary))
    rec.set("tags", body.tags)
    rec.set("region", body.region === undefined || body.region === null ? "" : String(body.region))
    rec.set("item_status", body.item_status === undefined || body.item_status === null ? "" : String(body.item_status))
    rec.set("added_by", body.added_by === undefined || body.added_by === null ? "" : String(body.added_by))
    rec.set("owner_id", __uid)
    rec.set("published_at", body.published_at === undefined || body.published_at === null ? "" : String(body.published_at))
    rec.set("visibility", body.visibility === undefined || body.visibility === null ? "" : String(body.visibility))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("intel_items create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// PATCH /api/intel_items/{id}  body 字段同 POST, 只更新 body 里出现的字段
routerAdd("PATCH", "/api/intel_items/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("intel_items", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var body = e.requestInfo().body || {}
    if ("source_id" in body) rec.set("source_id", body.source_id === undefined || body.source_id === null ? "" : String(body.source_id))
    if ("source_name" in body) rec.set("source_name", body.source_name === undefined || body.source_name === null ? "" : String(body.source_name))
    if ("title" in body) rec.set("title", body.title === undefined || body.title === null ? "" : String(body.title))
    if ("url" in body) rec.set("url", body.url === undefined || body.url === null ? "" : String(body.url))
    if ("content_snippet" in body) rec.set("content_snippet", body.content_snippet === undefined || body.content_snippet === null ? "" : String(body.content_snippet))
    if ("item_type" in body) rec.set("item_type", body.item_type === undefined || body.item_type === null ? "" : String(body.item_type))
    if ("summary" in body) rec.set("summary", body.summary === undefined || body.summary === null ? "" : String(body.summary))
    if ("tags" in body) rec.set("tags", body.tags)
    if ("region" in body) rec.set("region", body.region === undefined || body.region === null ? "" : String(body.region))
    if ("item_status" in body) rec.set("item_status", body.item_status === undefined || body.item_status === null ? "" : String(body.item_status))
    if ("added_by" in body) rec.set("added_by", body.added_by === undefined || body.added_by === null ? "" : String(body.added_by))
    if ("owner_id" in body) rec.set("owner_id", body.owner_id === undefined || body.owner_id === null ? "" : String(body.owner_id))
    if ("published_at" in body) rec.set("published_at", body.published_at === undefined || body.published_at === null ? "" : String(body.published_at))
    if ("visibility" in body) rec.set("visibility", body.visibility === undefined || body.visibility === null ? "" : String(body.visibility))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// DELETE /api/intel_items/{id}
routerAdd("DELETE", "/api/intel_items/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("intel_items", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    $app.delete(rec)
    return e.json(200, { ok: true })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "delete_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

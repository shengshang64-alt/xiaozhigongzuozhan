/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/format_templates.pb.js — 格式刷新工具 · 格式模板库（第一阶段）
//
// 背景：用户上传一份「标准化格式方案 docx」，前端解析出各级标题 / 正文 / 页边距等
// 原始格式规范（FormatSpec），并可桥接映射为标书/方案导出所用的 FormatSettings。
// 本 collection 持久化这些模板（只存 JSON，不存原件），供团队复用与「导出前套用」。
//
// 字段：
//   name             模板名（必填）
//   spec             原始格式规范 FormatSpec（任意字体名 / pt / twips 边距）
//   format_settings  映射后的 FormatSettings（供标书/方案导出直接套用）
//   notes            映射近似说明（数组）
//   source_file_name 识别来源文件名
//   is_default       是否默认模板（同批最多一个为 true）
//   sort / created / updated
//
// ⚠️ JSVM 约束（见 doc_templates.pb.js 头注）：每个 routerAdd handler 独立 VM 重跑，
//    helper 必须内联，勿上提到顶层。
//
// 路由：GET /api/format_templates(list)      GET /api/format_templates/{id}
//       POST /api/format_templates           PATCH /api/format_templates/{id}
//       DELETE /api/format_templates/{id}

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("format_templates") } catch (_) { existing = null }
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
      addField({ name: "name", type: "text", required: true, max: 300 })
      addField({ name: "spec", type: "json" })
      addField({ name: "format_settings", type: "json" })
      addField({ name: "notes", type: "json" })
      addField({ name: "source_file_name", type: "text", max: 300 })
      addField({ name: "is_default", type: "bool" })
      addField({ name: "sort", type: "number" })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) { $app.save(existing) }
    } else {
      var col = new Collection({
        type: "base",
        name: "format_templates",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: "name", type: "text", required: true, max: 300 },
          { name: "spec", type: "json" },
          { name: "format_settings", type: "json" },
          { name: "notes", type: "json" },
          { name: "source_file_name", type: "text", max: 300 },
          { name: "is_default", type: "bool" },
          { name: "sort", type: "number" },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
    }
  } catch (err) {
    try { $app.logger().error("format_templates bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/format_templates?q=&default=1
routerAdd("GET", "/api/format_templates", function (e) {
  try {
    try { $app.findCollectionByNameOrId("format_templates") } catch (_) {
      return e.json(200, { items: [], page: 1, perPage: 0, totalItems: 0 })
    }
    var info = e.requestInfo()
    var query = info.query || {}
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var sort = String(query.sort || "-created")
    var filter = ""
    var params = {}
    var parts = []
    if (query.q !== undefined && String(query.q) !== "") {
      parts.push("name ~ {:q}")
      params.q = "%" + String(query.q) + "%"
    }
    if (String(query.default || "") === "true" || String(query.default || "") === "1") {
      parts.push("is_default = true")
    }
    filter = parts.join(" && ")
    var records = filter
      ? $app.findRecordsByFilter("format_templates", filter, sort, 200, 0, params)
      : $app.findRecordsByFilter("format_templates", "", sort, 200, 0)
    var items = []
    for (var i = 0; i < records.length; i++) { items.push(records[i].publicExport()) }
    return e.json(200, { items: items, page: 1, perPage: items.length, totalItems: items.length })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// GET /api/format_templates/{id}
routerAdd("GET", "/api/format_templates/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("format_templates", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "get_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// POST /api/format_templates
routerAdd("POST", "/api/format_templates", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("format_templates") } catch (_) {}
    return null
  }
  try {
    var coll = ensureCollLocal()
    if (!coll) return e.json(500, { error: "coll_missing" })
    var body = e.requestInfo().body || {}
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!body.name) return e.json(400, { error: "name_required" })
    var isDefault = body.is_default === true || String(body.is_default) === "true"
    if (isDefault) {
      // 设默认前清掉其它默认
      try {
        var olds = $app.findRecordsByFilter("format_templates", "is_default = true", "-created", 0, 0)
        for (var k = 0; k < olds.length; k++) { olds[k].set("is_default", false); $app.save(olds[k]) }
      } catch (_) {}
    }
    var rec = new Record(coll)
    rec.set("name", String(body.name).slice(0, 300))
    rec.set("spec", body.spec === undefined ? {} : body.spec)
    rec.set("format_settings", body.format_settings === undefined ? {} : body.format_settings)
    rec.set("notes", Array.isArray(body.notes) ? body.notes : [])
    rec.set("source_file_name", body.source_file_name === undefined ? "" : String(body.source_file_name).slice(0, 300))
    rec.set("is_default", isDefault)
    rec.set("sort", (body.sort === undefined || body.sort === null) ? 0 : Number(body.sort))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("format_templates create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// PATCH /api/format_templates/{id}
routerAdd("PATCH", "/api/format_templates/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("format_templates", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var body = e.requestInfo().body || {}
    if ("name" in body) rec.set("name", String(body.name || "").slice(0, 300))
    if ("spec" in body) rec.set("spec", body.spec)
    if ("format_settings" in body) rec.set("format_settings", body.format_settings)
    if ("notes" in body) rec.set("notes", Array.isArray(body.notes) ? body.notes : [])
    if ("source_file_name" in body) rec.set("source_file_name", String(body.source_file_name || "").slice(0, 300))
    if ("sort" in body) rec.set("sort", Number(body.sort) || 0)
    if ("is_default" in body) {
      var want = body.is_default === true || String(body.is_default) === "true"
      if (want) {
        try {
          var olds = $app.findRecordsByFilter("format_templates", "is_default = true", "-created", 0, 0)
          for (var k = 0; k < olds.length; k++) {
            if (olds[k].id !== rec.id) { olds[k].set("is_default", false); $app.save(olds[k]) }
          }
        } catch (_) {}
      }
      rec.set("is_default", want)
    }
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// DELETE /api/format_templates/{id}
routerAdd("DELETE", "/api/format_templates/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __h = (e.requestInfo()||{}).headers||{}
    var __uid = String(__h["x_rh_user_id"]||__h["X-Rh-User-Id"]||__h["x-rh-user-id"]||"").trim().slice(0,64)
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("format_templates", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    $app.delete(rec)
    return e.json(200, { ok: true })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "delete_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

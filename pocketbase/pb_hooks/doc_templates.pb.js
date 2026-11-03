/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/doc_templates.pb.js — 公司标准化模版库（R-203）业务 collection + REST CRUD + 原件下载
//
// 背景：公司标准库《03公司标准化模版》（智业软件）解析入库。每条记录 = 一个模版/范本/规范,
// 带场景标签（scenario, 与售前工作台页面一一映射）、章节骨架（skeleton JSON）、
// 格式要点（format_notes, 供 AI 生成链路注入）与使用说明（usage_notes）。
// 原件存放于 dataDir()/template-library/<stored_name>（pb_data 不入库, 由 scripts/import-company-templates.mjs 拷贝）。
//
// ⚠️ JSVM 约束（实测, 见 team_auth.pb.js 头注）: 每个 routerAdd handler 在独立 VM 实例重跑,
// 顶层 function / globalThis 挂载对 handler 不可见 — ensureCollLocal 等 helper 必须内联, 勿"优化"上提。
//
// 路由: GET /api/doc_templates(list, filter: scenario/kind/active)
//       GET /api/doc_templates/{id}
//       POST /api/doc_templates
//       PATCH /api/doc_templates/{id}
//       DELETE /api/doc_templates/{id}
//       GET /api/doc_templates/{id}/download   （原件附件下载, 只认 template-library 目录内 stored_name）

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("doc_templates") } catch (_) { existing = null }
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
      addField({ name: "scenario", type: "text", max: 40 })
      addField({ name: "kind", type: "text", max: 40 })
      addField({ name: "tags", type: "json" })
      addField({ name: "file_name", type: "text", max: 300 })
      addField({ name: "stored_name", type: "text", max: 300 })
      addField({ name: "source_path", type: "text", max: 1000 })
      addField({ name: "format_notes", type: "text", max: 20000 })
      addField({ name: "usage_notes", type: "text", max: 20000 })
      addField({ name: "skeleton", type: "json" })
      addField({ name: "version", type: "text", max: 40 })
      addField({ name: "active", type: "bool" })
      addField({ name: "sort", type: "number" })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) { $app.save(existing) }
    } else {
      var col = new Collection({
        type: "base",
        name: "doc_templates",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: "name", type: "text", required: true, max: 300 },
          { name: "scenario", type: "text", max: 40 },
          { name: "kind", type: "text", max: 40 },
          { name: "tags", type: "json" },
          { name: "file_name", type: "text", max: 300 },
          { name: "stored_name", type: "text", max: 300 },
          { name: "source_path", type: "text", max: 1000 },
          { name: "format_notes", type: "text", max: 20000 },
          { name: "usage_notes", type: "text", max: 20000 },
          { name: "skeleton", type: "json" },
          { name: "version", type: "text", max: 40 },
          { name: "active", type: "bool" },
          { name: "sort", type: "number" },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
    }
  } catch (err) {
    try { $app.logger().error("doc_templates bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/doc_templates?page=&perPage=&sort=&scenario=&kind=
routerAdd("GET", "/api/doc_templates", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("doc_templates") } catch (_) {}
    return null
  }
  try {
    if (!ensureCollLocal()) return e.json(200, { items: [], page: 1, perPage: 0, totalItems: 0 })
    var info = e.requestInfo()
    var query = info.query || {}
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var page = parseInt(String(query.page || "1"), 10) || 1
    var perPage = parseInt(String(query.perPage || "100"), 10) || 100
    if (perPage > 200) perPage = 200
    var sort = String(query.sort || "sort,created")
    var filterParts = []
    var params = {}
    if (query.scenario !== undefined && query.scenario !== "") {
      filterParts.push("scenario = {:scenario}")
      params.scenario = String(query.scenario)
    }
    if (query.kind !== undefined && query.kind !== "") {
      filterParts.push("kind = {:kind}")
      params.kind = String(query.kind)
    }
    if (query.active !== undefined && String(query.active) !== "") {
      filterParts.push("active = {:active}")
      params.active = String(query.active) === "true"
    }
    if (query.q !== undefined && String(query.q) !== "") {
      filterParts.push("(name ~ {:q} || file_name ~ {:q2})")
      params.q = "%" + String(query.q) + "%"
      params.q2 = "%" + String(query.q) + "%"
    }
    var filter = filterParts.length > 0 ? filterParts.join(" && ") : ""
    var records = filter
      ? $app.findRecordsByFilter("doc_templates", filter, sort, perPage, (page - 1) * perPage, params)
      : $app.findRecordsByFilter("doc_templates", "", sort, perPage, (page - 1) * perPage)
    var items = []
    for (var i = 0; i < records.length; i++) { items.push(records[i].publicExport()) }
    var totalItems = items.length
    try {
      var countRecords = filter
        ? $app.findRecordsByFilter("doc_templates", filter, sort, 100000, 0, params)
        : $app.findRecordsByFilter("doc_templates", "", sort, 100000, 0)
      totalItems = countRecords.length
    } catch (err2) {}
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: totalItems })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// GET /api/doc_templates/{id}
routerAdd("GET", "/api/doc_templates/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("doc_templates", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "get_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// POST /api/doc_templates
routerAdd("POST", "/api/doc_templates", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("doc_templates") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "doc_templates",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
        { name: "name", type: "text", required: true, max: 300 },
        { name: "scenario", type: "text", max: 40 },
        { name: "kind", type: "text", max: 40 },
        { name: "tags", type: "json" },
        { name: "file_name", type: "text", max: 300 },
        { name: "stored_name", type: "text", max: 300 },
        { name: "source_path", type: "text", max: 1000 },
        { name: "format_notes", type: "text", max: 20000 },
        { name: "usage_notes", type: "text", max: 20000 },
        { name: "skeleton", type: "json" },
        { name: "version", type: "text", max: 40 },
        { name: "active", type: "bool" },
        { name: "sort", type: "number" },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("doc_templates")
  }
  try {
    var coll = ensureCollLocal()
    var body = e.requestInfo().body || {}
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!body.name) return e.json(400, { error: "name_required" })
    var rec = new Record(coll)
    rec.set("name", String(body.name))
    rec.set("scenario", body.scenario === undefined || body.scenario === null ? "" : String(body.scenario))
    rec.set("kind", body.kind === undefined || body.kind === null ? "" : String(body.kind))
    rec.set("tags", body.tags)
    rec.set("file_name", body.file_name === undefined || body.file_name === null ? "" : String(body.file_name))
    rec.set("stored_name", body.stored_name === undefined || body.stored_name === null ? "" : String(body.stored_name))
    rec.set("source_path", body.source_path === undefined || body.source_path === null ? "" : String(body.source_path))
    rec.set("format_notes", body.format_notes === undefined || body.format_notes === null ? "" : String(body.format_notes))
    rec.set("usage_notes", body.usage_notes === undefined || body.usage_notes === null ? "" : String(body.usage_notes))
    rec.set("skeleton", body.skeleton)
    rec.set("version", body.version === undefined || body.version === null ? "" : String(body.version))
    rec.set("active", body.active === undefined ? true : !!body.active)
    rec.set("sort", (body.sort === undefined || body.sort === null) ? 0 : Number(body.sort))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("doc_templates create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// PATCH /api/doc_templates/{id}
routerAdd("PATCH", "/api/doc_templates/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("doc_templates", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var body = e.requestInfo().body || {}
    var simpleText = ["name", "scenario", "kind", "file_name", "stored_name", "source_path", "format_notes", "usage_notes", "version"]
    for (var i = 0; i < simpleText.length; i++) {
      var k = simpleText[i]
      if (k in body) rec.set(k, body[k] === undefined || body[k] === null ? "" : String(body[k]))
    }
    if ("tags" in body) rec.set("tags", body.tags)
    if ("skeleton" in body) rec.set("skeleton", body.skeleton)
    if ("active" in body) rec.set("active", !!body.active)
    if ("sort" in body) rec.set("sort", Number(body.sort) || 0)
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// DELETE /api/doc_templates/{id}
routerAdd("DELETE", "/api/doc_templates/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("doc_templates", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    $app.delete(rec)
    return e.json(200, { ok: true })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "delete_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// GET /api/doc_templates/{id}/download — 原件附件下载。
// 只允许 dataDir()/template-library/ 下的 stored_name（防穿越: 不含 / \ .. 与盘符冒号）。
routerAdd("GET", "/api/doc_templates/{id}/download", function (e) {
  try {
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("doc_templates", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var stored = String(rec.get("stored_name") || "")
    if (!stored || stored.indexOf("..") >= 0 || /[\/\\:*?<>|]/.test(stored)) {
      return e.json(400, { error: "bad_file", message: "模版文件名不合法" })
    }
    var abs = $app.dataDir() + "/template-library/" + stored
    var file = null
    try { file = $filesystem.fileFromPath(abs) } catch (_) { file = null }
    if (!file) return e.json(404, { error: "file_missing", message: "模版原件不存在，请重新运行导入脚本" })
    var extIdx = stored.lastIndexOf(".")
    var ext = extIdx >= 0 ? stored.slice(extIdx + 1).toLowerCase() : ""
    var ctype = "application/octet-stream"
    if (ext === "docx" || ext === "dotx") { ctype = "application/vnd.openxmlformats-officedocument.wordprocessingml.template" }
    if (ext === "xlsx") { ctype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
    if (ext === "potx" || ext === "pptx") { ctype = "application/vnd.openxmlformats-officedocument.presentationml.template" }
    if (ext === "pdf") { ctype = "application/pdf" }
    var displayName = String(rec.get("file_name") || stored)
    // ⚠️ JSVM 绑定是 Go http.Header 的小写包装方法 set()（大写 Set 不存在会 throw）
    try {
      e.response.header().set("Content-Disposition", "attachment; filename=\"" + stored.replace(/"/g, "") + "\"; filename*=UTF-8''" + encodeURIComponent(displayName))
    } catch (_) {}
    return e.stream(200, ctype, file.reader.open())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "download_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

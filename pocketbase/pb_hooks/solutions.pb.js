/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/solutions.pb.js — 业务 collection + REST CRUD 路由 (self-contained)
//
// 由 mcp__rh-pb-hooks__install_business_collection 装. 不要直接 Read+Write 这个文件.
// 业务字段: rh_user_id:text, solution_name:text, solution_type:text, hospital:text, hospital_info:json, outline:json, chapters:json, doc_status:text
// 路由: list,get,create,update,delete
// list filter 字段: rh_user_id,solution_type,doc_status
// list 默认排序: -updated

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("solutions") } catch (_) { existing = null }
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
      addField({ name: 'solution_name', type: 'text', required: true })
      addField({ name: 'solution_type', type: 'text', required: true })
      addField({ name: 'hospital', type: 'text' })
      addField({ name: 'hospital_info', type: 'json' })
      addField({ name: 'outline', type: 'json' })
      addField({ name: 'chapters', type: 'json' })
      addField({ name: 'doc_status', type: 'text' })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) {
        $app.save(existing)
        try { $app.logger().info("solutions collection upgraded") } catch (_) {}
      }
    } else {
      var col = new Collection({
        type: "base",
        name: "solutions",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'solution_name', type: 'text', required: true },
          { name: 'solution_type', type: 'text', required: true },
          { name: 'hospital', type: 'text' },
          { name: 'hospital_info', type: 'json' },
          { name: 'outline', type: 'json' },
          { name: 'chapters', type: 'json' },
          { name: 'doc_status', type: 'text' },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
      try { $app.logger().info("solutions collection created") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("solutions bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/solutions?page=1&perPage=50&sort=-created&rh_user_id=...&solution_type=...&doc_status=...
routerAdd("GET", "/api/solutions", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("solutions") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "solutions",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'solution_name', type: 'text', required: true },
          { name: 'solution_type', type: 'text', required: true },
          { name: 'hospital', type: 'text' },
          { name: 'hospital_info', type: 'json' },
          { name: 'outline', type: 'json' },
          { name: 'chapters', type: 'json' },
          { name: 'doc_status', type: 'text' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("solutions")
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
    if (query.solution_type !== undefined && query.solution_type !== "") {
      filterParts.push("solution_type = {:solution_type}")
      params.solution_type = String(query.solution_type)
    }
    if (query.doc_status !== undefined && query.doc_status !== "") {
      filterParts.push("doc_status = {:doc_status}")
      params.doc_status = String(query.doc_status)
    }
    if (query.q !== undefined && String(query.q) !== "") {
      filterParts.push("solution_name ~ {:q_kw}")
      params.q_kw = "%" + String(query.q) + "%"
    }
    var filter = filterParts.length > 0 ? filterParts.join(" && ") : ""
    var records = filter
      ? $app.findRecordsByFilter("solutions", filter, sort, perPage, (page - 1) * perPage, params)
      : $app.findRecordsByFilter("solutions", "", sort, perPage, (page - 1) * perPage)
    var items = []
    for (var i = 0; i < records.length; i++) {
      items.push(records[i].publicExport())
    }
    // R004（D-9）：totalItems 返回过滤后的真总数（原恒等于 items.length，调用方无法得知还有更多页）。
    // 注：PB v0.40 JSVM 无 countRecordsByFilter，用 findRecordsByFilter 大 limit 计数（本地单用户规模开销可忽略）
    var totalItems = items.length
    try {
      var countRecords = filter
        ? $app.findRecordsByFilter("solutions", filter, sort, 100000, 0, params)
        : $app.findRecordsByFilter("solutions", "", sort, 100000, 0)
      totalItems = countRecords.length
    } catch (err2) {}
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: totalItems })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("solutions list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// GET /api/solutions/{id}
routerAdd("GET", "/api/solutions/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("solutions", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "get_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// POST /api/solutions  body 字段: rh_user_id, solution_name, solution_type, hospital, hospital_info, outline, chapters, doc_status
routerAdd("POST", "/api/solutions", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("solutions") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "solutions",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'solution_name', type: 'text', required: true },
          { name: 'solution_type', type: 'text', required: true },
          { name: 'hospital', type: 'text' },
          { name: 'hospital_info', type: 'json' },
          { name: 'outline', type: 'json' },
          { name: 'chapters', type: 'json' },
          { name: 'doc_status', type: 'text' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("solutions")
  }
  try {
    var coll = ensureCollLocal()
    var body = e.requestInfo().body || {}
    var rec = new Record(coll)
    rec.set("rh_user_id", body.rh_user_id === undefined || body.rh_user_id === null ? "" : String(body.rh_user_id))
    rec.set("solution_name", body.solution_name === undefined || body.solution_name === null ? "" : String(body.solution_name))
    rec.set("solution_type", body.solution_type === undefined || body.solution_type === null ? "" : String(body.solution_type))
    rec.set("hospital", body.hospital === undefined || body.hospital === null ? "" : String(body.hospital))
    rec.set("hospital_info", body.hospital_info)
    rec.set("outline", body.outline)
    rec.set("chapters", body.chapters)
    rec.set("doc_status", body.doc_status === undefined || body.doc_status === null ? "" : String(body.doc_status))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("solutions create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// PATCH /api/solutions/{id}  body 字段同 POST, 只更新 body 里出现的字段
routerAdd("PATCH", "/api/solutions/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("solutions", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var body = e.requestInfo().body || {}
    if ("rh_user_id" in body) rec.set("rh_user_id", body.rh_user_id === undefined || body.rh_user_id === null ? "" : String(body.rh_user_id))
    if ("solution_name" in body) rec.set("solution_name", body.solution_name === undefined || body.solution_name === null ? "" : String(body.solution_name))
    if ("solution_type" in body) rec.set("solution_type", body.solution_type === undefined || body.solution_type === null ? "" : String(body.solution_type))
    if ("hospital" in body) rec.set("hospital", body.hospital === undefined || body.hospital === null ? "" : String(body.hospital))
    if ("hospital_info" in body) rec.set("hospital_info", body.hospital_info)
    if ("outline" in body) rec.set("outline", body.outline)
    if ("chapters" in body) rec.set("chapters", body.chapters)
    if ("doc_status" in body) rec.set("doc_status", body.doc_status === undefined || body.doc_status === null ? "" : String(body.doc_status))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// DELETE /api/solutions/{id}
routerAdd("DELETE", "/api/solutions/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("solutions", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    $app.delete(rec)
    return e.json(200, { ok: true })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "delete_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/intel_sources.pb.js — 业务 collection + REST CRUD 路由 (self-contained)
//
// 由 mcp__rh-pb-hooks__install_business_collection 装. 不要直接 Read+Write 这个文件.
// 业务字段: source_name:text, url:text, source_type:text, is_builtin:bool, owner_id:text, enabled:bool, last_fetch_at:text, last_status:text, last_error:text, fetched_count:number
// 路由: list
// list filter 字段: owner_id,source_type,is_builtin,enabled
// list 默认排序: -created

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("intel_sources") } catch (_) { existing = null }
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
      addField({ name: 'source_name', type: 'text', required: true, max: 100 })
      addField({ name: 'url', type: 'text', required: true, max: 500 })
      addField({ name: 'source_type', type: 'text', max: 20 })
      addField({ name: 'is_builtin', type: 'bool' })
      addField({ name: 'owner_id', type: 'text', max: 60 })
      addField({ name: 'enabled', type: 'bool' })
      addField({ name: 'last_fetch_at', type: 'text', max: 40 })
      addField({ name: 'last_status', type: 'text', max: 20 })
      addField({ name: 'last_error', type: 'text', max: 500 })
      addField({ name: 'fetched_count', type: 'number' })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) {
        $app.save(existing)
        try { $app.logger().info("intel_sources collection upgraded") } catch (_) {}
      }
    } else {
      var col = new Collection({
        type: "base",
        name: "intel_sources",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: 'source_name', type: 'text', required: true, max: 100 },
          { name: 'url', type: 'text', required: true, max: 500 },
          { name: 'source_type', type: 'text', max: 20 },
          { name: 'is_builtin', type: 'bool' },
          { name: 'owner_id', type: 'text', max: 60 },
          { name: 'enabled', type: 'bool' },
          { name: 'last_fetch_at', type: 'text', max: 40 },
          { name: 'last_status', type: 'text', max: 20 },
          { name: 'last_error', type: 'text', max: 500 },
          { name: 'fetched_count', type: 'number' },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
      try { $app.logger().info("intel_sources collection created") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("intel_sources bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/intel_sources?page=1&perPage=50&sort=-created&owner_id=...&source_type=...&is_builtin=...&enabled=...
routerAdd("GET", "/api/intel_sources", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("intel_sources") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "intel_sources",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'source_name', type: 'text', required: true, max: 100 },
          { name: 'url', type: 'text', required: true, max: 500 },
          { name: 'source_type', type: 'text', max: 20 },
          { name: 'is_builtin', type: 'bool' },
          { name: 'owner_id', type: 'text', max: 60 },
          { name: 'enabled', type: 'bool' },
          { name: 'last_fetch_at', type: 'text', max: 40 },
          { name: 'last_status', type: 'text', max: 20 },
          { name: 'last_error', type: 'text', max: 500 },
          { name: 'fetched_count', type: 'number' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("intel_sources")
  }
  try {
    ensureCollLocal()
    var info = e.requestInfo()
    var query = info.query || {}
    // 身份门（与 F-SEC-05 同一批收口）：身份只认 zx_guard 中间件注入的 e.get("rhUserId")
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var page = parseInt(String(query.page || "1"), 10) || 1
    var perPage = parseInt(String(query.perPage || "50"), 10) || 50
    if (perPage > 200) perPage = 200
    var sort = String(query.sort || "-created")
    var filterParts = []
    var params = {}
    // 可见范围：内置源（owner_id 为空）+ 本人的自定义源；不再接受客户端自报 owner_id 越权读他人源
    filterParts.push("(owner_id = '' || owner_id = {:owner_id})")
    params.owner_id = __uid
    if (query.source_type !== undefined && query.source_type !== "") {
      filterParts.push("source_type = {:source_type}")
      params.source_type = String(query.source_type)
    }
    if (query.is_builtin !== undefined && query.is_builtin !== "") {
      filterParts.push("is_builtin = {:is_builtin}")
      params.is_builtin = String(query.is_builtin)
    }
    if (query.enabled !== undefined && query.enabled !== "") {
      filterParts.push("enabled = {:enabled}")
      params.enabled = String(query.enabled)
    }
    var filter = filterParts.join(" && ")
    var records = filter
      ? $app.findRecordsByFilter("intel_sources", filter, sort, perPage, (page - 1) * perPage, params)
      : $app.findRecordsByFilter("intel_sources", "", sort, perPage, (page - 1) * perPage)
    var items = []
    for (var i = 0; i < records.length; i++) {
      items.push(records[i].publicExport())
    }
    var totalItems = items.length
    try {
      var countRecords = filter
        ? $app.findRecordsByFilter("intel_sources", filter, sort, 100000, 0, params)
        : $app.findRecordsByFilter("intel_sources", "", sort, 100000, 0)
      totalItems = countRecords.length
    } catch (err2) {}
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: totalItems })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("intel_sources list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

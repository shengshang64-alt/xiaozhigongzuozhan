/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/model_configs.pb.js — 业务 collection + REST CRUD 路由 (self-contained)
//
// 由 mcp__rh-pb-hooks__install_business_collection 装. 不要直接 Read+Write 这个文件.
// 业务字段: rh_user_id:text, config_name:text, base_url:text, api_key:text, models:json, default_model:text, is_platform:bool, last_check_status:text, last_check_error:text, last_checked_at:date
// 路由: list
// list filter 字段: rh_user_id
// list 默认排序: -created

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("model_configs") } catch (_) { existing = null }
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
      addField({ name: 'rh_user_id', type: 'text', required: true, max: 60 })
      addField({ name: 'config_name', type: 'text', required: true, max: 80 })
      addField({ name: 'base_url', type: 'text', required: true, max: 500 })
      addField({ name: 'api_key', type: 'text', max: 1200 })
      addField({ name: 'models', type: 'json' })
      addField({ name: 'default_model', type: 'text', max: 200 })
      addField({ name: 'is_platform', type: 'bool' })
      addField({ name: 'last_check_status', type: 'text', max: 20 })
      addField({ name: 'last_check_error', type: 'text', max: 500 })
      addField({ name: 'last_checked_at', type: 'date' })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) {
        $app.save(existing)
        try { $app.logger().info("model_configs collection upgraded") } catch (_) {}
      }
    } else {
      var col = new Collection({
        type: "base",
        name: "model_configs",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: 'rh_user_id', type: 'text', required: true, max: 60 },
          { name: 'config_name', type: 'text', required: true, max: 80 },
          { name: 'base_url', type: 'text', required: true, max: 500 },
          { name: 'api_key', type: 'text', max: 1200 },
          { name: 'models', type: 'json' },
          { name: 'default_model', type: 'text', max: 200 },
          { name: 'is_platform', type: 'bool' },
          { name: 'last_check_status', type: 'text', max: 20 },
          { name: 'last_check_error', type: 'text', max: 500 },
          { name: 'last_checked_at', type: 'date' },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
      try { $app.logger().info("model_configs collection created") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("model_configs bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/model_configs?page=1&perPage=50&sort=-created&rh_user_id=...
routerAdd("GET", "/api/model_configs", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("model_configs") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "model_configs",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true, max: 60 },
          { name: 'config_name', type: 'text', required: true, max: 80 },
          { name: 'base_url', type: 'text', required: true, max: 500 },
          { name: 'api_key', type: 'text', max: 1200 },
          { name: 'models', type: 'json' },
          { name: 'default_model', type: 'text', max: 200 },
          { name: 'is_platform', type: 'bool' },
          { name: 'last_check_status', type: 'text', max: 20 },
          { name: 'last_check_error', type: 'text', max: 500 },
          { name: 'last_checked_at', type: 'date' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("model_configs")
  }
  try {
    ensureCollLocal()
    var info = e.requestInfo()
    var query = info.query || {}
    // 身份门（F-SEC-05 / D-SEC-01 / 重构优先级 1）：身份只认 zx_guard 中间件注入的
    // e.get("rhUserId")，缺失一律 401；客户端传入的 rh_user_id 不再作为身份依据。
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var page = parseInt(String(query.page || "1"), 10) || 1
    var perPage = parseInt(String(query.perPage || "50"), 10) || 50
    if (perPage > 200) perPage = 200
    var sort = String(query.sort || "-created")
    var filterParts = []
    var params = {}
    // 归属由服务端强制：只能读到自己的配置
    filterParts.push("rh_user_id = {:rh_user_id}")
    params.rh_user_id = __uid
    var filter = filterParts.join(" && ")
    var records = $app.findRecordsByFilter("model_configs", filter, sort, perPage, (page - 1) * perPage, params)
    var items = []
    for (var i = 0; i < records.length; i++) {
      // api_key 一律掩码：任何响应体不含完整密钥（老路由补的门，新路由 /api/model-gw/configs 本就脱敏）
      var exp = records[i].publicExport()
      var rawKey = ''
      try { rawKey = String(records[i].get("api_key") || "") } catch (_x) { rawKey = '' }
      exp.api_key = ''
      exp.has_key = !!rawKey
      items.push(exp)
    }
    var totalItems = items.length
    try {
      var countRecords = $app.findRecordsByFilter("model_configs", filter, sort, 100000, 0, params)
      totalItems = countRecords.length
    } catch (err2) {}
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: totalItems })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("model_configs list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/competitors.pb.js — 竞品分析档案 collection + REST CRUD 路由 (self-contained)
//
// 多源数据整合（见记忆「竞品分析模块多源数据整合要求」）：
//   - 软著维度：《医疗信息化公司软件著作权汇总.xlsx》—— legal_name / software_copyrights / earliest_cr_date / latest_cr_date
//   - 业绩维度：《25年医疗行业订单分析（售前版）.pptx》—— bid_amount_5y / regions / amount_structure / customer_profile /
//                positioning / products / certifications / ai_evolution / xinchuang
//   - 公开信息：官网 / 微信公众号 + 重要动态 —— website / wechat / summary / threat_notes
// 取不到的信息留空并在 source 标注「待核实」，遵循防幻觉诚实兜底规范，绝不编造。
// 路由: list,get,create,update,delete；list filter: name,visibility；默认排序: -software_copyrights,-updated
// 鉴权沿用 kb_docs 约定：只认 X-Rh-User-Id 请求头，缺失返回 401（阶段A 共享池，数据隔离留阶段B）。
//
// ⚠️ PocketBase JSVM 作用域隔离（见记忆「PocketBase JSVM handler scope isolation」）：
//    文件顶层的 function/var 声明对 routerAdd/onBootstrap 回调不可见，故每个回调内部逻辑自包含，
//    不得引用跨回调的顶层 helper。集合的创建统一放在 onBootstrap（启动时执行一次），
//    各路由回调假定集合已存在，需要集合对象处用 $app.findCollectionByNameOrId 内联获取。

// 启动时建集合（不存在则创建；已存在则幂等补字段）。onBootstrap 每次进程启动执行一次。
onBootstrap(function (e) {
  e.next()
  try {
    var FIELDS = [
      { name: "rh_user_id", type: "text", required: true, max: 100 },
      { name: "name", type: "text", required: true, max: 100 },
      { name: "legal_name", type: "text", max: 300 },
      { name: "website", type: "text", max: 300 },
      { name: "wechat", type: "text", max: 200 },
      { name: "software_copyrights", type: "number" },
      { name: "earliest_cr_date", type: "text", max: 32 },
      { name: "latest_cr_date", type: "text", max: 32 },
      { name: "positioning", type: "text", max: 2000 },
      { name: "products", type: "text", max: 4000 },
      { name: "bid_amount_5y", type: "text", max: 500 },
      { name: "regions", type: "text", max: 2000 },
      { name: "amount_structure", type: "text", max: 2000 },
      { name: "customer_profile", type: "text", max: 2000 },
      { name: "certifications", type: "text", max: 2000 },
      { name: "ai_evolution", type: "text", max: 2000 },
      { name: "xinchuang", type: "text", max: 2000 },
      { name: "strengths", type: "text", max: 4000 },
      { name: "weaknesses", type: "text", max: 4000 },
      { name: "threat_notes", type: "text", max: 4000 },
      { name: "summary", type: "text", max: 2000 },
      { name: "keywords", type: "json" },
      { name: "source", type: "text", max: 500 },
      { name: "visibility", type: "text", max: 20 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ]
    var existing = null
    try { existing = $app.findCollectionByNameOrId("competitors") } catch (_) { existing = null }
    if (!existing) {
      var col = new Collection({
        type: "base",
        name: "competitors",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: FIELDS,
      })
      $app.save(col)
      try { $app.logger().info("competitors collection created") } catch (_) {}
      return
    }
    // 已存在：幂等补新增字段（轮次升级）
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
    for (var f = 0; f < FIELDS.length; f++) addField(FIELDS[f])
    if (changed) {
      $app.save(existing)
      try { $app.logger().info("competitors collection upgraded") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("competitors bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/competitors?page&perPage&sort&name&visibility&q
routerAdd("GET", "/api/competitors", function (e) {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var info = e.requestInfo()
    var query = info.query || {}
    var page = parseInt(String(query.page || "1"), 10) || 1
    var perPage = parseInt(String(query.perPage || "50"), 10) || 50
    if (perPage > 200) perPage = 200
    var sort = String(query.sort || "-software_copyrights,-updated")
    var filterParts = []
    var params = {}
    if (query.name !== undefined && query.name !== "") {
      filterParts.push("name = {:name}")
      params.name = String(query.name)
    }
    if (query.visibility !== undefined && query.visibility !== "") {
      filterParts.push("visibility = {:visibility}")
      params.visibility = String(query.visibility)
    }
    if (query.q !== undefined && String(query.q) !== "") {
      filterParts.push("(name ~ {:q_kw} || legal_name ~ {:q_kw2} || positioning ~ {:q_kw3} || summary ~ {:q_kw4})")
      params.q_kw = String(query.q)
      params.q_kw2 = String(query.q)
      params.q_kw3 = String(query.q)
      params.q_kw4 = String(query.q)
    }
    var filter = filterParts.length > 0 ? filterParts.join(" && ") : ""
    var records = filter
      ? $app.findRecordsByFilter("competitors", filter, sort, perPage, (page - 1) * perPage, params)
      : $app.findRecordsByFilter("competitors", "", sort, perPage, (page - 1) * perPage)
    var items = []
    for (var i = 0; i < records.length; i++) items.push(records[i].publicExport())
    var totalItems = items.length
    try {
      var countRecords = filter
        ? $app.findRecordsByFilter("competitors", filter, sort, 100000, 0, params)
        : $app.findRecordsByFilter("competitors", "", sort, 100000, 0)
      totalItems = countRecords.length
    } catch (err2) {}
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: totalItems })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("competitors list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// GET /api/competitors/{id}
routerAdd("GET", "/api/competitors/{id}", function (e) {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("competitors", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "get_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// POST /api/competitors
routerAdd("POST", "/api/competitors", function (e) {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var coll = null
    try { coll = $app.findCollectionByNameOrId("competitors") } catch (_) { coll = null }
    if (!coll) return e.json(500, { error: "collection_missing", message: "competitors 集合未初始化，请重启 PocketBase" })
    var body = e.requestInfo().body || {}
    var name = body.name === undefined || body.name === null ? "" : String(body.name).trim()
    if (!name) return e.json(400, { error: "name_required", message: "公司名称不能为空" })
    var rec = new Record(coll)
    rec.set("rh_user_id", uid)
    rec.set("name", name)
    rec.set("legal_name", body.legal_name == null ? "" : String(body.legal_name))
    rec.set("website", body.website == null ? "" : String(body.website))
    rec.set("wechat", body.wechat == null ? "" : String(body.wechat))
    rec.set("software_copyrights", body.software_copyrights == null ? 0 : Number(body.software_copyrights))
    rec.set("earliest_cr_date", body.earliest_cr_date == null ? "" : String(body.earliest_cr_date))
    rec.set("latest_cr_date", body.latest_cr_date == null ? "" : String(body.latest_cr_date))
    rec.set("positioning", body.positioning == null ? "" : String(body.positioning))
    rec.set("products", body.products == null ? "" : String(body.products))
    rec.set("bid_amount_5y", body.bid_amount_5y == null ? "" : String(body.bid_amount_5y))
    rec.set("regions", body.regions == null ? "" : String(body.regions))
    rec.set("amount_structure", body.amount_structure == null ? "" : String(body.amount_structure))
    rec.set("customer_profile", body.customer_profile == null ? "" : String(body.customer_profile))
    rec.set("certifications", body.certifications == null ? "" : String(body.certifications))
    rec.set("ai_evolution", body.ai_evolution == null ? "" : String(body.ai_evolution))
    rec.set("xinchuang", body.xinchuang == null ? "" : String(body.xinchuang))
    rec.set("strengths", body.strengths == null ? "" : String(body.strengths))
    rec.set("weaknesses", body.weaknesses == null ? "" : String(body.weaknesses))
    rec.set("threat_notes", body.threat_notes == null ? "" : String(body.threat_notes))
    rec.set("summary", body.summary == null ? "" : String(body.summary))
    rec.set("keywords", body.keywords)
    rec.set("source", body.source == null ? "" : String(body.source))
    rec.set("visibility", body.visibility == null || body.visibility === "" ? "team" : String(body.visibility))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("competitors create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// PATCH /api/competitors/{id}  只更新 body 里出现的字段
routerAdd("PATCH", "/api/competitors/{id}", function (e) {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("competitors", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    // F-SEC-03/04：personal 竞品条目仅归属人可改（visibility=team 的共享条目维持团队可协作，
    // 创建时默认即 team，见本文件 POST 的 visibility 兜底）；与 kb_docs / intel_items 同口径。
    var __own = false
    try { __own = (String(rec.get("rh_user_id") || "") === uid) } catch (_ownErr) {}
    if (!__own) { try { __own = (String(rec.get("visibility") || "") !== "personal") } catch (_visErr) {} }
    if (!__own) return e.json(403, { error: "forbidden", message: "无权操作该记录" })
    var body = e.requestInfo().body || {}
    var strFields = ["name", "legal_name", "website", "wechat", "earliest_cr_date", "latest_cr_date",
      "positioning", "products", "bid_amount_5y", "regions", "amount_structure", "customer_profile",
      "certifications", "ai_evolution", "xinchuang", "strengths", "weaknesses", "threat_notes",
      "summary", "source", "visibility"]
    for (var i = 0; i < strFields.length; i++) {
      var f = strFields[i]
      if (f in body) rec.set(f, body[f] == null ? "" : String(body[f]))
    }
    if ("software_copyrights" in body) rec.set("software_copyrights", body.software_copyrights == null ? 0 : Number(body.software_copyrights))
    if ("keywords" in body) rec.set("keywords", body.keywords)
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// DELETE /api/competitors/{id}
routerAdd("DELETE", "/api/competitors/{id}", function (e) {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("competitors", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    // F-SEC-03/04：personal 竞品条目仅归属人可删（team 共享条目维持团队可协作）
    var __own = false
    try { __own = (String(rec.get("rh_user_id") || "") === uid) } catch (_ownErr) {}
    if (!__own) { try { __own = (String(rec.get("visibility") || "") !== "personal") } catch (_visErr) {} }
    if (!__own) return e.json(403, { error: "forbidden", message: "无权操作该记录" })
    $app.delete(rec)
    return e.json(200, { ok: true })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "delete_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

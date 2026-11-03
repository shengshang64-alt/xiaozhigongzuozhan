/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/material_library.pb.js — 素材库（R-008，需求提示词 §6 + 需求记录 §七 Q-A/Q-B/Q-C 落地口径）
//
// 存储选型（Q-013 用户全权授权后取「路 B」）：图片不走本地 materials/ 目录（PocketBase
// 摸不到宿主机任意路径，Vite dev 也没有文件读写接口），改走集合，原图/缩略图以 dataURL
// 文本字段落库——与 ppt_decks 内嵌 base64 图片同一通道同一量级，导出 PPTX 天然内嵌（Q-B）。
// 记录按 rh_user_id 隔离（Q-C）；授权链以 license + source_url 字段留档替代目录版 licenses/
// 快照（图库来源缺任一项后端直接拒绝入库）。
//
// ⚠️ 双集合拆分（r213 实测教训）：JSVM 的 dbx Query 不支持 .one()/.all()（Go 侧直接 panic），
//    count/统计只能走 findRecordsByFilter 全量捞——而它会把**整行所有字段**（含数 MB 的
//    image_data）水合进 Goja。因此把原图拆到 material_library_data（单字段一行），
//    material_library 只留元数据 + 400px 缩略图（单条 ~40KB，列表/统计/计数随便捞）。
//    原图只在 GET {id} 全量与 POST 入库时读写。
//
// ⚠️ JSVM 每个 routerAdd handler 独立 VM 重跑（见 format_templates.pb.js 头注）：
//    helper/常量必须内联进各 handler，勿上提到顶层。
//
// material_library 字段：
//   owner            rh_user_id（按用户隔离）
//   name             素材名（必填）
//   category         分类（01_架构图 / 02_系统截图 / 03_现场照片 / 04_资质案例 / 05_图库素材 / 99_未分类）
//   tags / tags_text 标签数组（json）/ 标签拼接文本（供 q 模糊检索）
//   source           pexels|unsplash|pixabay|internal|manual
//   source_url       授权/来源页 URL（图库来源必填）
//   license          授权说明（图库来源必填）
//   license_checked  授权是否已核验
//   width / height / bytes  原图尺寸与字节数
//   sha256           内容哈希（同 owner 内去重）
//   orientation      landscape|portrait|square
//   photographer     图库作者
//   usage            被 PPT 引用次数
//   note             备注
//   thumb_data       缩略图 dataURL（长边 400px）
//   trashed          软删除（回收站；purge 才真删）
//   created / updated
// material_library_data 字段：
//   owner            冗余（便于硬删/清库按 owner 批量处理）
//   material         素材 id（一一对应）
//   image_data       原图 dataURL（仅 GET {id} 全量返回）
//
// 路由（对外契约不受拆分影响）：
//   GET  /api/materials?q=&category=&source=&trashed=1&page=&perPage=&mode=meta|thumbs
//   GET  /api/materials/{id}                      （全量，含 image_data）
//   POST /api/materials                           （sha256 去重；图库来源强制 license+source_url）
//   PATCH /api/materials/{id}                     （仅元数据；原图不可改）
//   POST /api/materials/{id}/usage                （usage+1）
//   POST /api/materials/{id}/restore              （回收站恢复）
//   DELETE /api/materials/{id}?hard=1             （默认软删；hard=1 真删，连带原图行）
//   POST /api/materials-trash/purge               （清空回收站，连带原图行）
//   GET  /api/materials-stats                     （总览统计）

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("material_library") } catch (_) { existing = null }
    if (existing) {
      var changed = false
      function hasField(coll, name) {
        try { return !!coll.fields.getByName(name) } catch (_) {}
        try {
          for (var i = 0; i < coll.fields.length; i++) {
            if (String(coll.fields[i].name) === String(name)) return true
          }
        } catch (_) {}
        return false
      }
      function addField(coll, def) {
        if (hasField(coll, def.name)) return
        try { coll.fields.add(new Field(def)); changed = true } catch (_) {}
      }
      addField(existing, { name: "owner", type: "text", required: true, max: 64 })
      addField(existing, { name: "name", type: "text", required: true, max: 300 })
      addField(existing, { name: "category", type: "text", max: 100 })
      addField(existing, { name: "tags", type: "json" })
      addField(existing, { name: "tags_text", type: "text", max: 2000 })
      addField(existing, { name: "source", type: "text", max: 20 })
      addField(existing, { name: "source_url", type: "text", max: 1000 })
      addField(existing, { name: "license", type: "text", max: 200 })
      addField(existing, { name: "license_checked", type: "bool" })
      addField(existing, { name: "width", type: "number" })
      addField(existing, { name: "height", type: "number" })
      addField(existing, { name: "bytes", type: "number" })
      addField(existing, { name: "sha256", type: "text", max: 64 })
      addField(existing, { name: "orientation", type: "text", max: 20 })
      addField(existing, { name: "photographer", type: "text", max: 200 })
      addField(existing, { name: "usage", type: "number" })
      addField(existing, { name: "note", type: "text", max: 2000 })
      addField(existing, { name: "thumb_data", type: "json" })
      addField(existing, { name: "trashed", type: "bool" })
      addField(existing, { name: "created", type: "autodate", onCreate: true })
      addField(existing, { name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      if (changed) { $app.save(existing) }
    } else {
      var col = new Collection({
        type: "base",
        name: "material_library",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: "owner", type: "text", required: true, max: 64 },
          { name: "name", type: "text", required: true, max: 300 },
          { name: "category", type: "text", max: 100 },
          { name: "tags", type: "json" },
          { name: "tags_text", type: "text", max: 2000 },
          { name: "source", type: "text", max: 20 },
          { name: "source_url", type: "text", max: 1000 },
          { name: "license", type: "text", max: 200 },
          { name: "license_checked", type: "bool" },
          { name: "width", type: "number" },
          { name: "height", type: "number" },
          { name: "bytes", type: "number" },
          { name: "sha256", type: "text", max: 64 },
          { name: "orientation", type: "text", max: 20 },
          { name: "photographer", type: "text", max: 200 },
          { name: "usage", type: "number" },
          { name: "note", type: "text", max: 2000 },
          { name: "thumb_data", type: "json" },
          { name: "trashed", type: "bool" },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
    }
    // 原图大字段独立集合（见头注「双集合拆分」）
    var dataCol = null
    try { dataCol = $app.findCollectionByNameOrId("material_library_data") } catch (_) { dataCol = null }
    if (!dataCol) {
      $app.save(new Collection({
        type: "base",
        name: "material_library_data",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: "owner", type: "text", required: true, max: 64 },
          { name: "material", type: "text", required: true, max: 20 },
          { name: "image_data", type: "json" },
        ],
      }))
    }
  } catch (err) {
    try { $app.logger().error("material_library bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/materials — 分页列表（默认带 thumb_data；mode=meta 只出元数据，供 PPT 本地命中批量拉）
routerAdd("GET", "/api/materials", function (e) {
  // ⚠️ 内联 helper：JSVM handler 独立 VM，勿上提
  function uidOf() {
    return String(e.get("rhUserId") || "")
  }
  function exportMode(rec, mode) {
    var it = rec.publicExport()
    if (mode === "meta") delete it.thumb_data
    return it
  }
  try {
    var __uid = uidOf()
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    try { $app.findCollectionByNameOrId("material_library") } catch (_) {
      return e.json(200, { items: [], page: 1, perPage: 0, totalItems: 0 })
    }
    var query = (e.requestInfo() || {}).query || {}
    var mode = String(query.mode || "thumbs")
    var perPage = Math.min(Math.max(Number(query.perPage) || 60, 1), 120)
    var page = Math.max(Number(query.page) || 1, 1)
    var parts = ["owner = {:uid}", String(query.trashed) === "1" ? "trashed = true" : "trashed = false"]
    var params = { uid: __uid }
    if (query.category !== undefined && String(query.category) !== "") { parts.push("category = {:cat}"); params.cat = String(query.category) }
    if (query.source !== undefined && String(query.source) !== "") { parts.push("source = {:src}"); params.src = String(query.source) }
    if (query.q !== undefined && String(query.q) !== "") { parts.push("(name ~ {:q} || tags_text ~ {:q})"); params.q = "%" + String(query.q) + "%" }
    if (query.sha256 !== undefined && String(query.sha256) !== "") { parts.push("sha256 = {:sha}"); params.sha = String(query.sha256) }
    var filter = parts.join(" && ")
    // 计数与 hasMore：一次多捞 1 条判 hasMore；总数用大 limit 全捞后取 length（元数据行小，可承受）
    var records = $app.findRecordsByFilter("material_library", filter, "-created", perPage + 1, (page - 1) * perPage, params)
    var hasMore = records.length > perPage
    if (hasMore) records = records.slice(0, perPage)
    var total = 0
    try { total = $app.findRecordsByFilter("material_library", filter, "-created", 10000, 0, params).length } catch (_) { total = records.length }
    var items = []
    for (var i = 0; i < records.length; i++) items.push(exportMode(records[i], mode))
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: total, hasMore: hasMore })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// GET /api/materials/{id} — 全量（含 image_data，供预览/PPT 插入）
routerAdd("GET", "/api/materials/{id}", function (e) {
  function uidOf() {
    return String(e.get("rhUserId") || "")
  }
  try {
    var __uid = uidOf()
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("material_library", id) } catch (_) { rec = null }
    if (!rec || rec.getString("owner") !== __uid) return e.json(404, { error: "not_found" })
    var it = rec.publicExport()
    try {
      var dataRec = $app.findFirstRecordByFilter("material_library_data", "material = {:mid}", { mid: id })
      // ⚠️ json 字段经 getString() 拿到的是 JSON 编码文本（带外层引号），parse 还原原始 dataURL
      var s = dataRec.getString("image_data") || ""
      if (s.length >= 2 && s.charAt(0) === "\"" && s.charAt(s.length - 1) === "\"") {
        try { s = JSON.parse(s) } catch (_) { /* 已是裸串就照用 */ }
      }
      it.image_data = typeof s === "string" ? s : ""
    } catch (_) { it.image_data = "" }
    return e.json(200, it)
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "get_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// POST /api/materials — 入库（sha256 去重；图库来源强制授权链；原图写 material_library_data）
routerAdd("POST", "/api/materials", function (e) {
  function uidOf() {
    return String(e.get("rhUserId") || "")
  }
  function metaOnly(rec) {
    var it = rec.publicExport()
    delete it.image_data
    return it
  }
  try {
    var __uid = uidOf()
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var coll = null
    try { coll = $app.findCollectionByNameOrId("material_library") } catch (_) { coll = null }
    if (!coll) return e.json(500, { error: "coll_missing" })
    var body = (e.requestInfo() || {}).body || {}
    if (!body.name) return e.json(400, { error: "name_required", message: "缺少素材名" })
    var imageData = String(body.image_data || "")
    if (imageData.indexOf("data:image/") !== 0) return e.json(400, { error: "image_required", message: "缺少图片数据（dataURL）" })
    if (imageData.length > 9 * 1024 * 1024) return e.json(413, { error: "image_too_large", message: "图片过大（>6MB），请压缩后再入库" })
    var source = String(body.source || "manual")
    if (["manual", "internal", "pexels", "unsplash", "pixabay"].indexOf(source) < 0) source = "manual"
    var license = String(body.license || "").slice(0, 200)
    var sourceUrl = String(body.source_url || "").slice(0, 1000)
    if (["pexels", "unsplash", "pixabay"].indexOf(source) >= 0 && (!license || !sourceUrl)) {
      // 医疗材料对外使用授权链必须可追溯：图库来源缺授权说明或来源页链接一律拒绝入库
      return e.json(400, { error: "license_required", message: "图库素材必须带授权说明与来源页链接，缺任一项不入库" })
    }
    var sha = String(body.sha256 || "").slice(0, 64)
    if (sha) {
      var dup = null
      try { dup = $app.findRecordsByFilter("material_library", "owner = {:uid} && sha256 = {:sha} && trashed = false", "-created", 1, 0, { uid: __uid, sha: sha }) } catch (_) { dup = null }
      if (dup && dup.length > 0) {
        return e.json(200, { duplicated: true, item: metaOnly(dup[0]) })
      }
    }
    var tags = Array.isArray(body.tags) ? body.tags.map(function (t) { return String(t).slice(0, 60) }) : []
    var rec = new Record(coll)
    rec.set("owner", __uid)
    rec.set("name", String(body.name).slice(0, 300))
    rec.set("category", String(body.category || "99_未分类").slice(0, 100))
    rec.set("tags", tags)
    rec.set("tags_text", tags.join(" ").slice(0, 2000))
    rec.set("source", source)
    rec.set("source_url", sourceUrl)
    rec.set("license", license || (source === "internal" ? "公司内部素材" : "本地上传素材"))
    rec.set("license_checked", body.license_checked === true || String(body.license_checked) === "true")
    rec.set("width", Number(body.width) || 0)
    rec.set("height", Number(body.height) || 0)
    rec.set("bytes", Number(body.bytes) || 0)
    rec.set("sha256", sha)
    rec.set("orientation", ["landscape", "portrait", "square"].indexOf(String(body.orientation || "")) >= 0 ? String(body.orientation) : "landscape")
    rec.set("photographer", String(body.photographer || "").slice(0, 200))
    rec.set("usage", 0)
    rec.set("note", String(body.note || "").slice(0, 2000))
    rec.set("thumb_data", String(body.thumb_data || ""))
    rec.set("trashed", false)
    $app.save(rec)
    // 原图落独立集合；失败则回滚元数据行，不留「看得见打不开」的脏数据
    try {
      var dataColl = $app.findCollectionByNameOrId("material_library_data")
      var dataRec = new Record(dataColl)
      dataRec.set("owner", __uid)
      dataRec.set("material", rec.id)
      dataRec.set("image_data", imageData)
      $app.save(dataRec)
    } catch (dataErr) {
      try { $app.delete(rec) } catch (_) {}
      throw dataErr
    }
    return e.json(200, { duplicated: false, item: metaOnly(rec) })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("material_library create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// PATCH /api/materials/{id} — 仅元数据可改（原图/哈希入库后不可变，保授权链可信）
routerAdd("PATCH", "/api/materials/{id}", function (e) {
  function uidOf() {
    return String(e.get("rhUserId") || "")
  }
  try {
    var __uid = uidOf()
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("material_library", id) } catch (_) { rec = null }
    if (!rec || rec.getString("owner") !== __uid) return e.json(404, { error: "not_found" })
    var body = (e.requestInfo() || {}).body || {}
    if ("name" in body) rec.set("name", String(body.name || "").slice(0, 300))
    if ("category" in body) rec.set("category", String(body.category || "").slice(0, 100))
    if ("tags" in body) {
      var tags = Array.isArray(body.tags) ? body.tags.map(function (t) { return String(t).slice(0, 60) }) : []
      rec.set("tags", tags)
      rec.set("tags_text", tags.join(" ").slice(0, 2000))
    }
    if ("note" in body) rec.set("note", String(body.note || "").slice(0, 2000))
    if ("license" in body) rec.set("license", String(body.license || "").slice(0, 200))
    if ("license_checked" in body) rec.set("license_checked", body.license_checked === true || String(body.license_checked) === "true")
    if ("photographer" in body) rec.set("photographer", String(body.photographer || "").slice(0, 200))
    if ("source_url" in body) rec.set("source_url", String(body.source_url || "").slice(0, 1000))
    $app.save(rec)
    var it = rec.publicExport()
    return e.json(200, it)
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// POST /api/materials/{id}/usage — 被 PPT 引用一次 +1（元数据行小，直接改）
routerAdd("POST", "/api/materials/{id}/usage", function (e) {
  function uidOf() {
    return String(e.get("rhUserId") || "")
  }
  try {
    var __uid = uidOf()
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("material_library", id) } catch (_) { rec = null }
    if (!rec || rec.getString("owner") !== __uid) return e.json(404, { error: "not_found" })
    rec.set("usage", (rec.getInt("usage") || 0) + 1)
    $app.save(rec)
    return e.json(200, { ok: true, usage: rec.getInt("usage") || 0 })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "usage_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// POST /api/materials/{id}/restore — 回收站恢复
routerAdd("POST", "/api/materials/{id}/restore", function (e) {
  function uidOf() {
    return String(e.get("rhUserId") || "")
  }
  try {
    var __uid = uidOf()
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("material_library", id) } catch (_) { rec = null }
    if (!rec || rec.getString("owner") !== __uid) return e.json(404, { error: "not_found" })
    rec.set("trashed", false)
    $app.save(rec)
    return e.json(200, { ok: true })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "restore_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// DELETE /api/materials/{id} — 默认软删（回收站）；?hard=1 真删（连带原图行）
routerAdd("DELETE", "/api/materials/{id}", function (e) {
  function uidOf() {
    return String(e.get("rhUserId") || "")
  }
  try {
    var __uid = uidOf()
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("material_library", id) } catch (_) { rec = null }
    if (!rec || rec.getString("owner") !== __uid) return e.json(404, { error: "not_found" })
    var hard = String(((e.requestInfo() || {}).query || {}).hard || "") === "1"
    if (hard) {
      try {
        var dataRec = $app.findFirstRecordByFilter("material_library_data", "material = {:mid}", { mid: id })
        if (dataRec) $app.delete(dataRec)
      } catch (_) { /* 原图行缺失也算删干净 */ }
      $app.delete(rec)
    } else {
      rec.set("trashed", true)
      $app.save(rec)
    }
    return e.json(200, { ok: true, hard: hard })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "delete_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// POST /api/materials-trash/purge — 清空回收站（连带原图行）
routerAdd("POST", "/api/materials-trash/purge", function (e) {
  function uidOf() {
    return String(e.get("rhUserId") || "")
  }
  try {
    var __uid = uidOf()
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var records = []
    try { records = $app.findRecordsByFilter("material_library", "owner = {:uid} && trashed = true", "-created", 10000, 0, { uid: __uid }) } catch (_) { records = [] }
    var n = 0
    for (var i = 0; i < records.length; i++) {
      try {
        var dataRec = $app.findFirstRecordByFilter("material_library_data", "material = {:mid}", { mid: records[i].id })
        if (dataRec) $app.delete(dataRec)
      } catch (_) { /* 原图行缺失照删元数据 */ }
      $app.delete(records[i])
      n++
    }
    return e.json(200, { ok: true, purged: n })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "purge_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// GET /api/materials-stats — 总览统计（元数据行小，全量聚合可承受）
routerAdd("GET", "/api/materials-stats", function (e) {
  function uidOf() {
    return String(e.get("rhUserId") || "")
  }
  try {
    var __uid = uidOf()
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    try { $app.findCollectionByNameOrId("material_library") } catch (_) {
      return e.json(200, { total: 0, trashed: 0, bytes: 0, categories: [], sources: [] })
    }
    var records = []
    try { records = $app.findRecordsByFilter("material_library", "owner = {:uid}", "-created", 10000, 0, { uid: __uid }) } catch (_) { records = [] }
    var total = 0, trashed = 0, bytes = 0
    var catMap = {}, srcMap = {}
    for (var i = 0; i < records.length; i++) {
      var r = records[i]
      if (r.getBool("trashed")) { trashed++; continue }
      total++
      bytes += r.getInt("bytes") || 0
      var cat = r.getString("category") || "99_未分类"
      var src = r.getString("source") || "manual"
      catMap[cat] = (catMap[cat] || 0) + 1
      srcMap[src] = (srcMap[src] || 0) + 1
    }
    var categories = [], sources = []
    for (var c in catMap) categories.push({ name: c, count: catMap[c] })
    for (var s in srcMap) sources.push({ name: s, count: srcMap[s] })
    categories.sort(function (a, b) { return b.count - a.count })
    sources.sort(function (a, b) { return b.count - a.count })
    return e.json(200, { total: total, trashed: trashed, bytes: bytes, categories: categories, sources: sources })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "stats_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

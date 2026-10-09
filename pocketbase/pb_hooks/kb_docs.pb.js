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
      addField({ name: 'kb_section', type: 'text', max: 40 })
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
          { name: 'kb_section', type: 'text', max: 40 },
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
          { name: 'kb_section', type: 'text', max: 40 },
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
    if (query.kb_section !== undefined && query.kb_section !== "") {
      filterParts.push("kb_section = {:kb_section}")
      params.kb_section = String(query.kb_section)
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
    // R80/B-01：slim=1 时正文置空（知识库列表页只取元数据，正文按需走 /api/kb_docs/{id} 单条补拉）；
    // 不带 slim 参数的调用行为完全不变（向后兼容）
    var slim = String(query.slim || "") === "1"
    for (var i = 0; i < records.length; i++) {
      var item = records[i].publicExport()
      if (slim) item.content = ""
      items.push(item)
    }
    var totalItems = items.length
    try {
      var countRecords = filter
        ? $app.findRecordsByFilter("kb_docs", filter, sort, 100000, 0, params)
        : $app.findRecordsByFilter("kb_docs", "", sort, 100000, 0)
      totalItems = countRecords.length
    } catch (err2) {}
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: totalItems })
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

// ---------------------------------------------------------------------------
// POST /api/kb_docs/import-solution — 2026-10-07 用户需求：本地方案整合入知识库
// body: { solution_id, visibility? }
// 把方案各成稿章节逐章入库（kb_section 按章节用途自动分类），幂等键
// source_file_name = "solimp:<solution_id>:<idx>"，重复调用覆盖更新不重复建。
// 零 AI 零费用；章节用途/赛道派生规则与 src/lib/kbTaxonomy.ts 同步维护。
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/kb_docs/import-solution", function (e) {
  var norm = function (s) { return String(s == null ? "" : s).trim() }
  var h = (e.requestInfo() || {}).headers || {}
  var userId = norm(h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || "")
  if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录" })
  var body = e.requestInfo().body || {}
  var solutionId = norm(body.solution_id)
  if (!solutionId) return e.json(200, { ok: false, code: "bad_request", message: "缺少 solution_id" })

  var sol = null
  try { sol = $app.findRecordById("solutions", solutionId) } catch (_) { sol = null }
  if (!sol) return e.json(200, { ok: false, code: "not_found", message: "方案不存在" })
  var solUserId = norm(sol.get("rh_user_id") || "")
  if (solUserId !== userId) return e.json(200, { ok: false, code: "forbidden", message: "只能整合自己的方案" })

  var chapters = sol.get("chapters")
  try { chapters = JSON.parse(chapters || "[]") } catch (_) { chapters = [] }
  if (!chapters.length) return e.json(200, { ok: false, code: "empty", message: "该方案还没有成稿章节" })

  var solName = norm(sol.get("solution_name") || "未命名方案")
  var solVis = norm(sol.get("visibility") || "") === "public" ? "public" : "personal"
  var wantPublic = body.visibility === "public"
  var targetVis = wantPublic ? "public" : solVis

  // 章节用途/赛道派生（与 src/lib/kbTaxonomy.ts 同步维护；Goja 回调自持一份）
  var SECTION_RULES = [
    ["架构图", /架构图|拓扑图|系统架构|总体架构|网络架构|应用架构|架构设计/],
    ["流程图", /流程图|泳道图|业务流程图|业务流程/],
    ["需求分析", /需求分析|需求调研|需求理解|业务需求|功能需求|用户需求|需求规格|需求响应/],
    ["建设要求", /建设要求|建设内容|采购需求|技术要求|招标要求|采购要求|考核要求|建设标准|响应要求/],
    ["售后方案", /售后服务|售后方案|运维方案|运维服务|维保|质保|驻场|巡检|服务承诺/],
    ["培训方案", /培训/],
    ["安全保障", /安全保障|安全方案|等级保护|等保|应急预案|应急响应|备份|容灾|数据安全|网络安全/],
    ["建设背景", /建设背景|项目背景|政策背景|背景分析|现状分析|政策依据|发展现状/],
    ["实施方案", /实施方案|项目实施|实施部署|部署方案|上线方案|割接|数据迁移|进度计划|项目组织|人员配备|项目管理|施工组织/],
    ["设计方案", /设计方案|总体设计|功能设计|数据库设计|技术方案|建设方案|总体建设|方案设计|技术架构|应用架构|技术路线/],
    ["项目案例", /项目案例|同类案例|业绩案例|成功案例|典型案例/],
  ]
  var TRACK_RULES = [
    ["电子病历评级", /电子病历.{0,8}(评级|过级|升级|分级|五[级6]|六[级7]|七[级8])|病历评级|分级评价|EMR[4567]/i],
    ["互联互通评级", /互联互通|标准化成熟度|信息互联互通|四甲|集成平台.{0,4}测评/],
    ["医共体建设", /医共体|医联体|县域.{0,4}(医疗|卫生|影像|心电)|紧密型|区域.{0,3}(医疗|卫生)中心|分级诊疗/],
    ["DRG-DIP医保", /DRG|DIP|医保支付|医保结算|病种分值|医保基金|飞行检查|支付方式/],
    ["信创改造", /信创|国产化|自主可控|麒麟|统信|达梦|人大金仓|鲲鹏|海光/],
    ["数据安全", /等级保护|等保[二三四]级|数据安全|密码改造|国密|灾备|容灾|数据脱敏|防勒索|网络安全|态势感知|隐私/],
    ["中医医院", /中医|中药|辨证|治未病|中医药|中西医结合/],
    ["运营管理HRP", /HRP|绩效|国考|成本核算|运营管理|经济核算/],
    ["互联网医院", /互联网医院|互联网诊疗|在线问诊|远程医疗|远程会诊|掌上医院/],
    ["集成平台", /集成平台|信息集成|ESB|HL7|数据中心|CDR|ODR|数据治理|数据中台|健康大脑|全民健康/],
    ["移动医疗", /移动医疗|移动护理|移动医生|床旁|移动医保/],
    ["智慧医院", /智慧医院|智慧服务|智慧管理|智慧医疗|全流程|一院多区|一院两区/],
    ["HIS系统", /HIS|医院信息系统|门诊住院|收费结算|电子病历系统|一体化.{0,4}(管理|系统)/],
  ]
  var firstHit = function (rules, hay) {
    for (var i = 0; i < rules.length; i++) {
      try { if (rules[i][1].test(hay)) return rules[i][0] } catch (_) {}
    }
    return ""
  }

  var ensureColl = function () {
    try { return $app.findCollectionByNameOrId("kb_docs") } catch (_) { return null }
  }
  var coll = ensureColl()
  if (!coll) return e.json(500, { error: "no_collection", message: "kb_docs 集合缺失" })

  var imported = 0, updated = 0, skipped = 0
  for (var ci = 0; ci < chapters.length; ci++) {
    var ch = chapters[ci]
    var content = norm(ch && ch.content)
    var chTitle = norm(ch && ch.title)
    if (!content || content.length < 100) { skipped++; continue }
    var key = "solimp:" + solutionId + ":" + ci
    var docTitle = (solName + "·" + (chTitle || ("第" + (ci + 1) + "章"))).slice(0, 280)
    var hay = docTitle + "\n" + content.slice(0, 2000)
    var section = firstHit(SECTION_RULES, hay) || "其他"
    var track = firstHit(TRACK_RULES, hay) || "通用"
    var summary = content.slice(0, 400)
    var keywords = [solName, chTitle, "方案整合", section].filter(Boolean)

    var existing = null
    try { existing = $app.findFirstRecordByFilter("kb_docs", "rh_user_id={:u} && source_file_name={:k}", { u: userId, k: key }) } catch (_) { existing = null }

    if (existing) {
      existing.set("title", docTitle)
      existing.set("content", content.slice(0, 500000))
      existing.set("summary", summary.slice(0, 1000))
      existing.set("keywords", JSON.stringify(keywords))
      existing.set("kb_section", section)
      existing.set("kb_track", track)
      existing.set("kb_bucket", "方案素材")
      existing.set("visibility", targetVis)
      existing.set("updated", new Date().toISOString())
      $app.save(existing)
      updated++
    } else {
      var rec = new Record(coll)
      rec.set("rh_user_id", userId)
      rec.set("title", docTitle)
      rec.set("folder_path", "方案整合/" + solName)
      rec.set("content", content.slice(0, 500000))
      rec.set("doc_format", "md")
      rec.set("visibility", targetVis)
      rec.set("summary", summary.slice(0, 1000))
      rec.set("keywords", JSON.stringify(keywords))
      rec.set("source_file_name", key)
      rec.set("uploader_name", "方案整合")
      rec.set("doc_category", "技术方案")
      rec.set("ai_context_mode", "original")
      rec.set("is_sensitive", false)
      rec.set("kb_track", track)
      rec.set("kb_bucket", "方案素材")
      rec.set("kb_section", section)
      $app.save(rec)
      imported++
    }
  }
  $app.logger().info("kb import-solution done", "solution", solutionId, "imported", imported, "updated", updated, "skipped", skipped)
  return e.json(200, { ok: true, imported: imported, updated: updated, skipped: skipped, total_chapters: chapters.length })
})


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
          { name: 'kb_section', type: 'text', max: 40 },
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
    rec.set("kb_section", body.kb_section === undefined || body.kb_section === null ? "" : String(body.kb_section))
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
    if ("kb_section" in body) rec.set("kb_section", body.kb_section === undefined || body.kb_section === null ? "" : String(body.kb_section))
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

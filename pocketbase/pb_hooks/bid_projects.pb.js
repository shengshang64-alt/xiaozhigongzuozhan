/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/bid_projects.pb.js — 业务 collection + REST CRUD 路由 (self-contained)
//
// 由 mcp__rh-pb-hooks__install_business_collection 装. 不要直接 Read+Write 这个文件.
// 业务字段: rh_user_id:text, project_name:text, tender_no:text, hospital:text, bid_open_date:date, stage:text, tender_text:text, parse_report:json, bid_outline:json, bid_chapters:json, response_map:json, dup_report:json, void_check:json, ai_review:json, manual_review:json, parse_config:json, opportunity_id:text, bid_result:text, bid_amount:number, lost_reason:text, result_synced_at:date, target_pages:number, outline_level:number, figures_enabled:bool, clause_granularity:text, section_words:number, bid_defense:json, submission_check:json, stage_gates:json, archived:bool, deleted_at:text, gen_options:json, global_facts:text, orchestration:json, max_figures:number, compilation_basis_extra:json, basis_style:text, format_settings:json, format_check_items:json, ref_template_text:text, ref_materials_text:text, identity_words:text
// 路由: list,get,create,update,delete
// list filter 字段: rh_user_id,stage
// list 默认排序: -updated

onBootstrap(function (e) {
  e.next()
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("bid_projects") } catch (_) { existing = null }
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
      addField({ name: 'project_name', type: 'text', required: true })
      addField({ name: 'tender_no', type: 'text' })
      addField({ name: 'hospital', type: 'text' })
      addField({ name: 'bid_open_date', type: 'date' })
      addField({ name: 'stage', type: 'text' })
      addField({ name: 'tender_text', type: 'text' })
      addField({ name: 'parse_report', type: 'json' })
      addField({ name: 'bid_outline', type: 'json' })
      addField({ name: 'bid_chapters', type: 'json' })
      addField({ name: 'response_map', type: 'json' })
      addField({ name: 'dup_report', type: 'json' })
      addField({ name: 'void_check', type: 'json' })
      addField({ name: 'ai_review', type: 'json' })
      addField({ name: 'manual_review', type: 'json' })
      addField({ name: 'parse_config', type: 'json' })
      addField({ name: 'opportunity_id', type: 'text' })
      addField({ name: 'bid_result', type: 'text' })
      addField({ name: 'bid_amount', type: 'number' })
      addField({ name: 'lost_reason', type: 'text' })
      addField({ name: 'result_synced_at', type: 'date' })
      addField({ name: 'target_pages', type: 'number' })
      addField({ name: 'outline_level', type: 'number' })
      addField({ name: 'figures_enabled', type: 'bool' })
      addField({ name: 'clause_granularity', type: 'text' })
      addField({ name: 'section_words', type: 'number' })
      addField({ name: 'bid_defense', type: 'json' })
      addField({ name: 'submission_check', type: 'json' })
      addField({ name: 'stage_gates', type: 'json' })
      addField({ name: 'archived', type: 'bool' })
      addField({ name: 'deleted_at', type: 'text' })
      addField({ name: 'gen_options', type: 'json' })
      addField({ name: 'global_facts', type: 'text' })
      addField({ name: 'orchestration', type: 'json' })
      addField({ name: 'max_figures', type: 'number' })
      addField({ name: 'compilation_basis_extra', type: 'json' })
      addField({ name: 'basis_style', type: 'text', max: 16 })
      addField({ name: 'format_settings', type: 'json' })
      addField({ name: 'format_check_items', type: 'json' })
      addField({ name: 'ref_template_text', type: 'text' })
      addField({ name: 'ref_materials_text', type: 'text' })
      addField({ name: 'identity_words', type: 'text' })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      // 用户反馈轮（2026-09-18）：长文本字段存量 max=5000 拦截十万字级招标文件保存（500 update_failed）——
      // 按既有字段修复模式把 max 放宽为不限（0）；只放宽不收紧，幂等
      var LONG_TEXT_FIELDS = ["tender_text", "ref_template_text", "ref_materials_text", "global_facts", "identity_words"]
      for (var lti = 0; lti < LONG_TEXT_FIELDS.length; lti++) {
        try {
          var lf = existing.fields.getByName(LONG_TEXT_FIELDS[lti])
          try { $app.logger().info("bid_projects field max probe", "field", LONG_TEXT_FIELDS[lti], "max", String(lf && lf.max), "type", String(lf && lf.type)) } catch (_) {}
          if (lf && lf.max > 0) { lf.max = 0; changed = true }
        } catch (err) {
          try { $app.logger().warn("bid_projects field repair err", "field", LONG_TEXT_FIELDS[lti], "err", String(err)) } catch (_) {}
        }
      }
      if (changed) {
        $app.save(existing)
        try { $app.logger().info("bid_projects collection upgraded") } catch (_) {}
      }
    } else {
      var col = new Collection({
        type: "base",
        name: "bid_projects",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'project_name', type: 'text', required: true },
          { name: 'tender_no', type: 'text' },
          { name: 'hospital', type: 'text' },
          { name: 'bid_open_date', type: 'date' },
          { name: 'stage', type: 'text' },
          { name: 'tender_text', type: 'text' },
          { name: 'parse_report', type: 'json' },
          { name: 'bid_outline', type: 'json' },
          { name: 'bid_chapters', type: 'json' },
          { name: 'response_map', type: 'json' },
          { name: 'dup_report', type: 'json' },
          { name: 'void_check', type: 'json' },
          { name: 'ai_review', type: 'json' },
          { name: 'manual_review', type: 'json' },
          { name: 'parse_config', type: 'json' },
          { name: 'opportunity_id', type: 'text' },
          { name: 'bid_result', type: 'text' },
          { name: 'bid_amount', type: 'number' },
          { name: 'lost_reason', type: 'text' },
          { name: 'result_synced_at', type: 'date' },
          { name: 'target_pages', type: 'number' },
          { name: 'outline_level', type: 'number' },
          { name: 'figures_enabled', type: 'bool' },
          { name: 'clause_granularity', type: 'text' },
          { name: 'section_words', type: 'number' },
          { name: 'bid_defense', type: 'json' },
          { name: 'submission_check', type: 'json' },
          { name: 'stage_gates', type: 'json' },
          { name: 'archived', type: 'bool' },
          { name: 'deleted_at', type: 'text' },
          { name: 'gen_options', type: 'json' },
          { name: 'global_facts', type: 'text' },
          { name: 'orchestration', type: 'json' },
          { name: 'max_figures', type: 'number' },
          { name: 'compilation_basis_extra', type: 'json' },
          { name: 'basis_style', type: 'text', max: 16 },
          { name: 'format_settings', type: 'json' },
          { name: 'format_check_items', type: 'json' },
          { name: 'ref_template_text', type: 'text' },
          { name: 'ref_materials_text', type: 'text' },
          { name: 'identity_words', type: 'text' },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      })
      $app.save(col)
      try { $app.logger().info("bid_projects collection created") } catch (_) {}
    }
  } catch (err) {
    try { $app.logger().error("bid_projects bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
})

// GET /api/bid_projects?page=1&perPage=50&sort=-created&rh_user_id=...&stage=...
routerAdd("GET", "/api/bid_projects", function (e) {
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("bid_projects") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "bid_projects",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'project_name', type: 'text', required: true },
          { name: 'tender_no', type: 'text' },
          { name: 'hospital', type: 'text' },
          { name: 'bid_open_date', type: 'date' },
          { name: 'stage', type: 'text' },
          { name: 'tender_text', type: 'text' },
          { name: 'parse_report', type: 'json' },
          { name: 'bid_outline', type: 'json' },
          { name: 'bid_chapters', type: 'json' },
          { name: 'response_map', type: 'json' },
          { name: 'dup_report', type: 'json' },
          { name: 'void_check', type: 'json' },
          { name: 'ai_review', type: 'json' },
          { name: 'manual_review', type: 'json' },
          { name: 'parse_config', type: 'json' },
          { name: 'opportunity_id', type: 'text' },
          { name: 'bid_result', type: 'text' },
          { name: 'bid_amount', type: 'number' },
          { name: 'lost_reason', type: 'text' },
          { name: 'result_synced_at', type: 'date' },
          { name: 'target_pages', type: 'number' },
          { name: 'outline_level', type: 'number' },
          { name: 'figures_enabled', type: 'bool' },
          { name: 'clause_granularity', type: 'text' },
          { name: 'section_words', type: 'number' },
          { name: 'bid_defense', type: 'json' },
          { name: 'submission_check', type: 'json' },
          { name: 'stage_gates', type: 'json' },
          { name: 'archived', type: 'bool' },
          { name: 'deleted_at', type: 'text' },
          { name: 'gen_options', type: 'json' },
          { name: 'global_facts', type: 'text' },
          { name: 'orchestration', type: 'json' },
          { name: 'max_figures', type: 'number' },
          { name: 'compilation_basis_extra', type: 'json' },
          { name: 'basis_style', type: 'text', max: 16 },
          { name: 'format_settings', type: 'json' },
          { name: 'format_check_items', type: 'json' },
          { name: 'ref_template_text', type: 'text' },
          { name: 'ref_materials_text', type: 'text' },
          { name: 'identity_words', type: 'text' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("bid_projects")
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
    if (query.stage !== undefined && query.stage !== "") {
      filterParts.push("stage = {:stage}")
      params.stage = String(query.stage)
    }
    var filter = filterParts.length > 0 ? filterParts.join(" && ") : ""
    var records = filter
      ? $app.findRecordsByFilter("bid_projects", filter, sort, perPage, (page - 1) * perPage, params)
      : $app.findRecordsByFilter("bid_projects", "", sort, perPage, (page - 1) * perPage)
    var items = []
    for (var i = 0; i < records.length; i++) {
      items.push(records[i].publicExport())
    }
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: items.length })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("bid_projects list: " + msg) } catch (_) {}
    return e.json(500, { error: "list_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// GET /api/bid_projects/{id}
routerAdd("GET", "/api/bid_projects/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("bid_projects", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "get_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// POST /api/bid_projects  body 字段: rh_user_id, project_name, tender_no, hospital, bid_open_date, stage, tender_text, parse_report, bid_outline, bid_chapters, response_map, dup_report, void_check, ai_review, manual_review, parse_config, opportunity_id, bid_result, bid_amount, lost_reason, result_synced_at, target_pages, outline_level, figures_enabled, clause_granularity, section_words, bid_defense, submission_check, stage_gates, archived, deleted_at, gen_options, global_facts, orchestration, max_figures, compilation_basis_extra, basis_style, format_settings, format_check_items, ref_template_text, ref_materials_text, identity_words
routerAdd("POST", "/api/bid_projects", function (e) {
  try {
    var collFix2 = $app.findCollectionByNameOrId("bid_projects")
    if (collFix2) {
      var needFix2 = false
      var LTF2 = ["tender_text", "ref_template_text", "ref_materials_text", "global_facts", "identity_words"]
      for (var li2 = 0; li2 < LTF2.length; li2++) {
        var f2 = collFix2.fields.getByName(LTF2[li2])
        if (f2 && f2.max > 0) { f2.max = 0; needFix2 = true }
      }
      if (needFix2) $app.save(collFix2)
    }
  } catch (_) {}
  function ensureCollLocal() {
    try { return $app.findCollectionByNameOrId("bid_projects") } catch (_) {}
    var col = new Collection({
      type: "base",
      name: "bid_projects",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
          { name: 'rh_user_id', type: 'text', required: true },
          { name: 'project_name', type: 'text', required: true },
          { name: 'tender_no', type: 'text' },
          { name: 'hospital', type: 'text' },
          { name: 'bid_open_date', type: 'date' },
          { name: 'stage', type: 'text' },
          { name: 'tender_text', type: 'text' },
          { name: 'parse_report', type: 'json' },
          { name: 'bid_outline', type: 'json' },
          { name: 'bid_chapters', type: 'json' },
          { name: 'response_map', type: 'json' },
          { name: 'dup_report', type: 'json' },
          { name: 'void_check', type: 'json' },
          { name: 'ai_review', type: 'json' },
          { name: 'manual_review', type: 'json' },
          { name: 'parse_config', type: 'json' },
          { name: 'opportunity_id', type: 'text' },
          { name: 'bid_result', type: 'text' },
          { name: 'bid_amount', type: 'number' },
          { name: 'lost_reason', type: 'text' },
          { name: 'result_synced_at', type: 'date' },
          { name: 'target_pages', type: 'number' },
          { name: 'outline_level', type: 'number' },
          { name: 'figures_enabled', type: 'bool' },
          { name: 'clause_granularity', type: 'text' },
          { name: 'section_words', type: 'number' },
          { name: 'bid_defense', type: 'json' },
          { name: 'submission_check', type: 'json' },
          { name: 'stage_gates', type: 'json' },
          { name: 'archived', type: 'bool' },
          { name: 'deleted_at', type: 'text' },
          { name: 'gen_options', type: 'json' },
          { name: 'global_facts', type: 'text' },
          { name: 'orchestration', type: 'json' },
          { name: 'max_figures', type: 'number' },
          { name: 'compilation_basis_extra', type: 'json' },
          { name: 'basis_style', type: 'text', max: 16 },
          { name: 'format_settings', type: 'json' },
          { name: 'format_check_items', type: 'json' },
          { name: 'ref_template_text', type: 'text' },
          { name: 'ref_materials_text', type: 'text' },
          { name: 'identity_words', type: 'text' },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("bid_projects")
  }
  try {
    var coll = ensureCollLocal()
    var body = e.requestInfo().body || {}
    var rec = new Record(coll)
    rec.set("rh_user_id", body.rh_user_id === undefined || body.rh_user_id === null ? "" : String(body.rh_user_id))
    rec.set("project_name", body.project_name === undefined || body.project_name === null ? "" : String(body.project_name))
    rec.set("tender_no", body.tender_no === undefined || body.tender_no === null ? "" : String(body.tender_no))
    rec.set("hospital", body.hospital === undefined || body.hospital === null ? "" : String(body.hospital))
    rec.set("bid_open_date", body.bid_open_date === undefined || body.bid_open_date === null ? "" : String(body.bid_open_date))
    rec.set("stage", body.stage === undefined || body.stage === null ? "" : String(body.stage))
    rec.set("tender_text", body.tender_text === undefined || body.tender_text === null ? "" : String(body.tender_text))
    rec.set("parse_report", body.parse_report)
    rec.set("bid_outline", body.bid_outline)
    rec.set("bid_chapters", body.bid_chapters)
    rec.set("response_map", body.response_map)
    rec.set("dup_report", body.dup_report)
    rec.set("void_check", body.void_check)
    rec.set("ai_review", body.ai_review)
    rec.set("manual_review", body.manual_review)
    rec.set("parse_config", body.parse_config)
    rec.set("opportunity_id", body.opportunity_id === undefined || body.opportunity_id === null ? "" : String(body.opportunity_id))
    rec.set("bid_result", body.bid_result === undefined || body.bid_result === null ? "" : String(body.bid_result))
    rec.set("bid_amount", (body.bid_amount === undefined || body.bid_amount === null) ? 0 : Number(body.bid_amount))
    rec.set("lost_reason", body.lost_reason === undefined || body.lost_reason === null ? "" : String(body.lost_reason))
    rec.set("result_synced_at", body.result_synced_at === undefined || body.result_synced_at === null ? "" : String(body.result_synced_at))
    rec.set("target_pages", (body.target_pages === undefined || body.target_pages === null) ? 0 : Number(body.target_pages))
    rec.set("outline_level", (body.outline_level === undefined || body.outline_level === null) ? 0 : Number(body.outline_level))
    rec.set("figures_enabled", !!body.figures_enabled)
    rec.set("clause_granularity", body.clause_granularity === undefined || body.clause_granularity === null ? "" : String(body.clause_granularity))
    rec.set("section_words", (body.section_words === undefined || body.section_words === null) ? 0 : Number(body.section_words))
    rec.set("bid_defense", body.bid_defense)
    rec.set("submission_check", body.submission_check)
    rec.set("stage_gates", body.stage_gates)
    rec.set("archived", !!body.archived)
    rec.set("deleted_at", body.deleted_at === undefined || body.deleted_at === null ? "" : String(body.deleted_at))
    rec.set("gen_options", body.gen_options)
    rec.set("global_facts", body.global_facts === undefined || body.global_facts === null ? "" : String(body.global_facts))
    rec.set("orchestration", body.orchestration)
    rec.set("max_figures", (body.max_figures === undefined || body.max_figures === null) ? 0 : Number(body.max_figures))
    rec.set("compilation_basis_extra", body.compilation_basis_extra)
    rec.set("basis_style", body.basis_style === undefined || body.basis_style === null ? "" : String(body.basis_style))
    rec.set("format_settings", body.format_settings)
    rec.set("format_check_items", body.format_check_items)
    rec.set("ref_template_text", body.ref_template_text === undefined || body.ref_template_text === null ? "" : String(body.ref_template_text))
    rec.set("ref_materials_text", body.ref_materials_text === undefined || body.ref_materials_text === null ? "" : String(body.ref_materials_text))
    rec.set("identity_words", body.identity_words === undefined || body.identity_words === null ? "" : String(body.identity_words))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("bid_projects create: " + msg) } catch (_) {}
    return e.json(500, { error: "create_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// PATCH /api/bid_projects/{id}  body 字段同 POST, 只更新 body 里出现的字段
routerAdd("PATCH", "/api/bid_projects/{id}", function (e) {
  try {
    // 用户反馈轮（2026-09-18）：长文本字段 max 懒修复（存量 max=5000 拦截十万字级招标文件保存）；
    // Goja 跨 routerAdd 不共享顶层函数/变量，故内联；检查幂等——max 已为 0 时只读不写
    try {
      var collFix = $app.findCollectionByNameOrId("bid_projects")
      if (collFix) {
        var needFix = false
        var LTF = ["tender_text", "ref_template_text", "ref_materials_text", "global_facts", "identity_words"]
        for (var li = 0; li < LTF.length; li++) {
          var f0 = collFix.fields.getByName(LTF[li])
          if (li === 0) throw new Error("probe-max=" + String(f0 && f0.max) + "-type=" + String(f0 && f0.type) + "-need=" + String(needFix))
          if (f0 && f0.max > 0) { f0.max = 0; needFix = true }
        }
        if (needFix) $app.save(collFix)
      }
    } catch (_) {}
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("bid_projects", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var body = e.requestInfo().body || {}
    if ("rh_user_id" in body) rec.set("rh_user_id", body.rh_user_id === undefined || body.rh_user_id === null ? "" : String(body.rh_user_id))
    if ("project_name" in body) rec.set("project_name", body.project_name === undefined || body.project_name === null ? "" : String(body.project_name))
    if ("tender_no" in body) rec.set("tender_no", body.tender_no === undefined || body.tender_no === null ? "" : String(body.tender_no))
    if ("hospital" in body) rec.set("hospital", body.hospital === undefined || body.hospital === null ? "" : String(body.hospital))
    if ("bid_open_date" in body) rec.set("bid_open_date", body.bid_open_date === undefined || body.bid_open_date === null ? "" : String(body.bid_open_date))
    if ("stage" in body) rec.set("stage", body.stage === undefined || body.stage === null ? "" : String(body.stage))
    if ("tender_text" in body) rec.set("tender_text", body.tender_text === undefined || body.tender_text === null ? "" : String(body.tender_text))
    if ("parse_report" in body) rec.set("parse_report", body.parse_report)
    if ("bid_outline" in body) rec.set("bid_outline", body.bid_outline)
    if ("bid_chapters" in body) rec.set("bid_chapters", body.bid_chapters)
    if ("response_map" in body) rec.set("response_map", body.response_map)
    if ("dup_report" in body) rec.set("dup_report", body.dup_report)
    if ("void_check" in body) rec.set("void_check", body.void_check)
    if ("ai_review" in body) rec.set("ai_review", body.ai_review)
    if ("manual_review" in body) rec.set("manual_review", body.manual_review)
    if ("parse_config" in body) rec.set("parse_config", body.parse_config)
    if ("opportunity_id" in body) rec.set("opportunity_id", body.opportunity_id === undefined || body.opportunity_id === null ? "" : String(body.opportunity_id))
    if ("bid_result" in body) rec.set("bid_result", body.bid_result === undefined || body.bid_result === null ? "" : String(body.bid_result))
    if ("bid_amount" in body) rec.set("bid_amount", (body.bid_amount === undefined || body.bid_amount === null) ? 0 : Number(body.bid_amount))
    if ("lost_reason" in body) rec.set("lost_reason", body.lost_reason === undefined || body.lost_reason === null ? "" : String(body.lost_reason))
    if ("result_synced_at" in body) rec.set("result_synced_at", body.result_synced_at === undefined || body.result_synced_at === null ? "" : String(body.result_synced_at))
    if ("target_pages" in body) rec.set("target_pages", (body.target_pages === undefined || body.target_pages === null) ? 0 : Number(body.target_pages))
    if ("outline_level" in body) rec.set("outline_level", (body.outline_level === undefined || body.outline_level === null) ? 0 : Number(body.outline_level))
    if ("figures_enabled" in body) rec.set("figures_enabled", !!body.figures_enabled)
    if ("clause_granularity" in body) rec.set("clause_granularity", body.clause_granularity === undefined || body.clause_granularity === null ? "" : String(body.clause_granularity))
    if ("section_words" in body) rec.set("section_words", (body.section_words === undefined || body.section_words === null) ? 0 : Number(body.section_words))
    if ("bid_defense" in body) rec.set("bid_defense", body.bid_defense)
    if ("submission_check" in body) rec.set("submission_check", body.submission_check)
    if ("stage_gates" in body) rec.set("stage_gates", body.stage_gates)
    if ("archived" in body) rec.set("archived", !!body.archived)
    if ("deleted_at" in body) rec.set("deleted_at", body.deleted_at === undefined || body.deleted_at === null ? "" : String(body.deleted_at))
    if ("gen_options" in body) rec.set("gen_options", body.gen_options)
    if ("global_facts" in body) rec.set("global_facts", body.global_facts === undefined || body.global_facts === null ? "" : String(body.global_facts))
    if ("orchestration" in body) rec.set("orchestration", body.orchestration)
    if ("max_figures" in body) rec.set("max_figures", (body.max_figures === undefined || body.max_figures === null) ? 0 : Number(body.max_figures))
    if ("compilation_basis_extra" in body) rec.set("compilation_basis_extra", body.compilation_basis_extra)
    if ("basis_style" in body) rec.set("basis_style", body.basis_style === undefined || body.basis_style === null ? "" : String(body.basis_style))
    if ("format_settings" in body) rec.set("format_settings", body.format_settings)
    if ("format_check_items" in body) rec.set("format_check_items", body.format_check_items)
    if ("ref_template_text" in body) rec.set("ref_template_text", body.ref_template_text === undefined || body.ref_template_text === null ? "" : String(body.ref_template_text))
    if ("ref_materials_text" in body) rec.set("ref_materials_text", body.ref_materials_text === undefined || body.ref_materials_text === null ? "" : String(body.ref_materials_text))
    if ("identity_words" in body) rec.set("identity_words", body.identity_words === undefined || body.identity_words === null ? "" : String(body.identity_words))
    $app.save(rec)
    return e.json(200, rec.publicExport())
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "update_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})
// DELETE /api/bid_projects/{id}
routerAdd("DELETE", "/api/bid_projects/{id}", function (e) {
  try {
    var id = e.request.pathValue("id")
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("bid_projects", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    $app.delete(rec)
    return e.json(200, { ok: true })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "delete_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

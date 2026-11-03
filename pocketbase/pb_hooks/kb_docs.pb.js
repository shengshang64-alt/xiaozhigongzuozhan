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
      addField({ name: 'kb_scenes', type: 'text', max: 200 })
      addField({ name: 'kb_audience', type: 'text', max: 30 })
      addField({ name: 'scene_reason', type: 'text', max: 300 })
      addField({ name: 'scene_risks', type: 'text', max: 300 })
      addField({ name: 'extract_score', type: 'number' })
      addField({ name: 'kb_section', type: 'text', max: 40 })
      // P1-4（2026-10-25）：软删除时间戳（空串=在册）。DELETE 路由置时间戳而非物理删除，
      // 列表路由排除已删行；A2 增量同步经 since 携带墓碑（updated 随置删前进）。
      addField({ name: 'deleted_at', type: 'text', max: 30 })
      // 2026-10-28（DSB6，用户已授权改表结构）：案例/素材的结构化字段。
      // 现状：kb_docs 7,002 条全是纯文本，项目案例 320 篇里能抽出金额/年份/医院名的有 287 篇（89.7%），
      // 但没有字段可存，检索只能靠全文模糊匹配。本字段存抽取结果 JSON（金额/年份/医院/系统清单等）。
      //
      // 类型选 json 而非 text：PocketBase 对 json 字段做合法 JSON 校验，能挡住「写进一个坏 JSON 字符串」；
      // 而 text 会原样收下任何内容（2026-10-27 归档页白屏事故就是 JSON 数组列被写成空字符串导致的）。
      //
      // 兼容性：可空、无默认值、不 required。既有 7002 行保持 NULL，前端一律按「无结构化数据」处理，
      // 不改变任何现有读写路径（6 个写路由 + kbCore 全部不读此字段，属纯增量）。
      addField({ name: 'structured', type: 'json' })
      // 抽取版本：同一篇文档重抽时可判断结果新旧，避免用旧抽取器结果覆盖新口径
      addField({ name: 'structured_ver', type: 'text', max: 20 })
      addField({ name: "created", type: "autodate", onCreate: true })
      addField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true })
      // P1-3 性能修复（2026-10-13）：列表路由默认 sort=-updated，无索引时 SQLite 对
      // 6998 篇、正文最大 500KB 的大表全表扫描排序——实测单页 1.3s（无排序仅 1ms），
      // 前端全量翻页（35 页×200）冷加载 15s+，是计数修复后仅剩的瓶颈。
      // 建 updated 单列索引后走索引顺序扫描、只回表当页 50/200 行。
      // 幂等：schema 已含同名索引则跳过；DB 侧由 $app.save 迁移执行 CREATE INDEX。
      var IDX_KB_DOCS_UPDATED = "idx_kb_docs_updated"
      var IDX_KB_DOCS_UPDATED_SQL = "CREATE INDEX " + IDX_KB_DOCS_UPDATED + " ON kb_docs (updated)"
      var idxAlready = false
      try {
        var curIdx = existing.indexes || []
        for (var ii = 0; ii < curIdx.length; ii++) {
          if (String(curIdx[ii]).indexOf(IDX_KB_DOCS_UPDATED) >= 0) { idxAlready = true; break }
        }
      } catch (_) {}
      if (!idxAlready) {
        try {
          var mergedIdx = []
          try {
            var srcIdx = existing.indexes || []
            for (var jj = 0; jj < srcIdx.length; jj++) mergedIdx.push(String(srcIdx[jj]))
          } catch (_) {}
          mergedIdx.push(IDX_KB_DOCS_UPDATED_SQL)
          existing.indexes = mergedIdx
          changed = true
        } catch (__eIdx) {
          try { $app.logger().warn("kb_docs index add skipped: " + String(__eIdx && __eIdx.message || __eIdx)) } catch (_) {}
        }
      }
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
        { name: 'kb_scenes', type: 'text', max: 200 },
        { name: 'kb_audience', type: 'text', max: 30 },
        { name: 'scene_reason', type: 'text', max: 300 },
        { name: 'scene_risks', type: 'text', max: 300 },
        { name: 'extract_score', type: 'number' },
          { name: 'kb_section', type: 'text', max: 40 },
          { name: 'deleted_at', type: 'text', max: 30 },
          // 2026-10-28（DSB6）：案例/素材结构化抽取结果（见上方 existing 分支同名注释）
          { name: 'structured', type: 'json' },
          { name: 'structured_ver', type: 'text', max: 20 },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
        // P1-3：updated 单列索引，避免列表 sort=-updated 全表扫描（见上方 existing 分支注释）
        indexes: [
          "CREATE INDEX idx_kb_docs_updated ON kb_docs (updated)",
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
        { name: 'kb_scenes', type: 'text', max: 200 },
        { name: 'kb_audience', type: 'text', max: 30 },
        { name: 'scene_reason', type: 'text', max: 300 },
        { name: 'scene_risks', type: 'text', max: 300 },
        { name: 'extract_score', type: 'number' },
          { name: 'kb_section', type: 'text', max: 40 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_kb_docs_updated ON kb_docs (updated)",
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("kb_docs")
  }
  try {
    ensureCollLocal()
    var info = e.requestInfo()
    var query = info.query || {}
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var page = parseInt(String(query.page || "1"), 10) || 1
    var perPage = parseInt(String(query.perPage || "50"), 10) || 50
    if (perPage > 200) perPage = 200
    var sort = String(query.sort || "-updated")
    // __KB_PARAMS_BEGIN__（测试提取锚点：scripts/kbDocsCount.test.ts 提取本标记至计数段
    // 结束标记之间的代码执行，依赖作用域变量 query/sort；增改请同步该测试）
    // P1-3：过滤条件单一数据源——eqs（[{field,value}] 精确匹配）+ qKw（标题/文件名模糊搜索）。
    // 由此同源派生两条消费路径，杜绝两处逻辑漂移：
    //   ① filter 字符串（下方分页拉取 findRecordsByFilter 用，字段顺序与历史实现完全一致）；
    //   ② dbx 表达式（计数 countRecords 用，SQL count 不加载记录）。
    var eqs = []
    var qKw = ""
    if (query.rh_user_id !== undefined && query.rh_user_id !== "") eqs.push({ field: "rh_user_id", value: String(query.rh_user_id) })
    if (query.visibility !== undefined && query.visibility !== "") eqs.push({ field: "visibility", value: String(query.visibility) })
    if (query.folder_path !== undefined && query.folder_path !== "") eqs.push({ field: "folder_path", value: String(query.folder_path) })
    if (query.doc_format !== undefined && query.doc_format !== "") eqs.push({ field: "doc_format", value: String(query.doc_format) })
    if (query.kb_track !== undefined && query.kb_track !== "") eqs.push({ field: "kb_track", value: String(query.kb_track) })
    if (query.kb_bucket !== undefined && query.kb_bucket !== "") eqs.push({ field: "kb_bucket", value: String(query.kb_bucket) })
    if (query.kb_section !== undefined && query.kb_section !== "") eqs.push({ field: "kb_section", value: String(query.kb_section) })
    if (query.q !== undefined && String(query.q) !== "") qKw = String(query.q)
    // P1-4（2026-10-25）：软删除语义——在册行 deleted_at 为空串。恒进 eqs（排除已删）；
    // 计数快速路径因此从「无过滤 <1ms」变为「等值表达式 ~190ms」，正确性优先（原热路径
    // 无法表达 != ''；见 __exprOk 处 2026-10-13 踩坑记录，hashExp 等值可用）。
    // A2 的 since 增量拉取刻意带 includeDeleted=1 以携带墓碑行（deleted_at 非空）。
    var __includeDeleted = String(query.includeDeleted || "") === "1"
    if (!__includeDeleted) eqs.push({ field: "deleted_at", value: "" })
    // A2（2026-10-25）：增量同步游标——只取 updated 严格大于 since 的行（客户端语料快照
    // 增量拉取）。range 条件刻意不进 eqs：计数快速路径（dbx 等值表达式）不覆盖范围过滤，
    // since 场景一律走 load-and-count 回落（增量行数通常个位数，成本可忽略，语义与分页同源）。
    var qSince = ""
    if (query.since !== undefined && String(query.since) !== "") qSince = String(query.since)
    var filterParts = []
    var params = {}
    for (var fi = 0; fi < eqs.length; fi++) {
      filterParts.push(eqs[fi].field + " = {:" + eqs[fi].field + "}")
      params[eqs[fi].field] = eqs[fi].value
    }
    if (qSince) {
      filterParts.push("updated > {:since}")
      params.since = qSince
    }
    if (qKw) {
      filterParts.push("(title ~ {:q_kw} || source_file_name ~ {:q_kw2})")
      params.q_kw = "%" + qKw + "%"
      params.q_kw2 = "%" + qKw + "%"
    }
    var filter = filterParts.length > 0 ? filterParts.join(" && ") : ""
    // __KB_PARAMS_END__
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
    // P1-3 性能修复（2026-10-13）：原实现每次列表请求都 findRecordsByFilter(..., 100000, 0)
    // 把全部记录（含最大 500KB 的 content 正文）加载进内存只为了数个数——实测单请求 5.48s，
    // 6998 篇文档翻 35 页累计 25s+，是知识库首屏慢的真凶（与前端并发度无关：35 并发只会把 PB 打超时）。
    // 修复分两步（均已实测验证）：
    //   第一步 计数：无过滤热路径走 $app.countRecords("kb_docs")（<1ms）；纯精确过滤走
    //   $app.countRecords + $dbx.hashExp/and 表达式（~190ms，SQL count 不加载记录）；
    //   q 搜索保持 load-and-count（原因见下方 __exprOk 处注释，正确性优先）。
    //   第二步 索引：onBootstrap 给 kb_docs 建 idx_kb_docs_updated 单列索引，消除列表默认
    //   sort=-updated 的全表扫描——实测单页拉取 1.3s → 15-45ms，前端全量冷加载 15-25s → 1.3s。
    // 任何一步异常都回落原实现，绝不退化成"只有一页"而丢数据。
    // 实现约束（2026-10-13 踩坑记录，改此段前必读）：
    //   ① Goja 跨 routerAdd 不共享顶层函数/变量（见 bid_projects.pb.js:408），逻辑必须内联在本路由内；
    //   ② $app.db().newQuery() 的 one/all 需 Go 指针类型会 panic，勿用；
    //   ③ countRecords 只接受 dbx.Expression、不收过滤字符串；$dbx 全局在本版本 JSVM 可用（探针实测）。
    // __KB_COUNT_BEGIN__（测试提取锚点：scripts/kbDocsCount.test.ts 提取本标记间的代码执行，
    // 依赖作用域变量 eqs/qKw/filter/params/sort/totalItems；增改此段请同步该测试）
    try {
      var __hasFilter = eqs.length > 0 || !!qKw || !!qSince
      var __cntExpr = null
      // __exprOk：仅「无过滤」与「纯精确过滤（无 q）」走 SQL count 快速路径。
      // q 搜索刻意不走——本构建 JSVM 的 dbx 表达式能力受限（2026-10-13 探针实证）：
      //   ① $dbx.exp(raw, params) 无论带参还是手工字面量都静默返回 0（命名参数未绑定 → LIKE NULL）；
      //   ② LikeExp 的 Escape(false) 方法未绑定到 JSVM（Object has no member 'Escape'）；
      //   ③ 唯一可用的 or+like 默认转义，又与分页 filter 的裸 %q% 通配语义不一致
      //      （搜 "100%" 会计数 0 但列表实出 22 条，自相矛盾）。
      // q 为交互式搜索而非冷加载热路径，load-and-count 在 updated 索引下约 200-350ms 可接受，
      // 且与分页用同一 filter 字符串，totalItems 与实际可见条目永远一致。
      var __exprOk = eqs.length > 0 && !qKw && !qSince
      try {
        if (__exprOk) {
          var __exprs = []
          for (var ei = 0; ei < eqs.length; ei++) {
            var __pair = {}
            __pair[eqs[ei].field] = eqs[ei].value
            __exprs.push($dbx.hashExp(__pair))
          }
          __cntExpr = __exprs[0]
          for (var ci = 1; ci < __exprs.length; ci++) {
            __cntExpr = $dbx.and(__cntExpr, __exprs[ci])
          }
        }
      } catch (__eExpr) { __exprOk = false; __cntExpr = null }
      try {
        if (__exprOk && __cntExpr !== null) {
          var __cnt = $app.countRecords("kb_docs", __cntExpr)
          if (typeof __cnt === "number" && __cnt >= 0) {
            totalItems = __cnt
          } else {
            throw new Error("count_not_number")
          }
        } else if (!__hasFilter) {
          var __cntAll = $app.countRecords("kb_docs")
          if (typeof __cntAll === "number" && __cntAll >= 0) {
            totalItems = __cntAll
          } else {
            throw new Error("count_all_not_number")
          }
        } else {
          throw new Error("use_fallback_count")
        }
      } catch (__eCnt) {
        // 计数快速路径不可用（q 搜索 / 表达式构建失败 / countRecords 异常 / 返回值非法）：
        // 回落原实现（全量加载计数，慢但正确；带过滤时用同一 filter 字符串，语义不变）
        totalItems = filter
          ? $app.findRecordsByFilter("kb_docs", filter, sort, 100000, 0, params).length
          : $app.findRecordsByFilter("kb_docs", "", sort, 100000, 0).length
      }
    } catch (err2) {
      // 兜底计数（load-and-count）也失败：与原版语义一致——异常向上抛，由路由外层 catch
      // 返回 500，绝不静默返回"只有一页"的错误总数（静默 200 + 错总数比 500 更误导）。
      throw err2
    }
    // __KB_COUNT_END__
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
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("kb_docs", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    // F-SEC-03/04：personal 记录仅归属人可访问（team 记录维持团队可协作）；
    // 归属判断内联在本路由内（Goja 跨 routerAdd 不共享顶层函数，见 zx_guard 说明）
    var __own = false
    try { __own = (String(rec.get("rh_user_id") || "") === __uid) } catch (_ownErr) {}
    if (!__own) { try { __own = (String(rec.get("visibility") || "") !== "personal") } catch (_visErr) {} }
    if (!__own) return e.json(403, { error: "forbidden", message: "无权操作该记录" })
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
  var userId = norm(String(e.get("rhUserId") || ""))
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
        { name: 'kb_scenes', type: 'text', max: 200 },
        { name: 'kb_audience', type: 'text', max: 30 },
        { name: 'scene_reason', type: 'text', max: 300 },
        { name: 'scene_risks', type: 'text', max: 300 },
        { name: 'extract_score', type: 'number' },
          { name: 'kb_section', type: 'text', max: 40 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_kb_docs_updated ON kb_docs (updated)",
      ],
    })
    $app.save(col)
    return $app.findCollectionByNameOrId("kb_docs")
  }
  try {
    var coll = ensureCollLocal()
    var body = e.requestInfo().body || {}
    var __uid = String(e.get("rhUserId") || "")
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
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("kb_docs", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    // F-SEC-03/04：personal 记录仅归属人可访问（team 记录维持团队可协作）；
    // 归属判断内联在本路由内（Goja 跨 routerAdd 不共享顶层函数，见 zx_guard 说明）
    var __own = false
    try { __own = (String(rec.get("rh_user_id") || "") === __uid) } catch (_ownErr) {}
    if (!__own) { try { __own = (String(rec.get("visibility") || "") !== "personal") } catch (_visErr) {} }
    if (!__own) return e.json(403, { error: "forbidden", message: "无权操作该记录" })
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
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    if (!id) return e.json(400, { error: "id_required" })
    var rec = null
    try { rec = $app.findRecordById("kb_docs", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    // F-SEC-03/04：personal 记录仅归属人可访问（team 记录维持团队可协作）；
    // 归属判断内联在本路由内（Goja 跨 routerAdd 不共享顶层函数，见 zx_guard 说明）
    var __own = false
    try { __own = (String(rec.get("rh_user_id") || "") === __uid) } catch (_ownErr) {}
    if (!__own) { try { __own = (String(rec.get("visibility") || "") !== "personal") } catch (_visErr) {} }
    if (!__own) return e.json(403, { error: "forbidden", message: "无权操作该记录" })
    // P1-4：软删除——置 deleted_at（updated 随 autodate 前进，A2 since 增量即携带墓碑）。
    // 物理删除不再提供；回收站/恢复走 /api/kb_docs_deleted 与 /api/kb_docs/{id}/restore。
    rec.set("deleted_at", new Date().toISOString().replace("T", " ").substring(0, 19) + ".000Z")
    $app.save(rec)
    return e.json(200, { ok: true, deletedAt: rec.getString("deleted_at") })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "delete_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

// P1-4（2026-10-25）：已删文档列表（回收站数据源）——仅返回软删除行，按置删时间倒序。
// 归属口径与主列表一致：team 行全员可见，personal 行仅归属人可见。
routerAdd("GET", "/api/kb_docs_deleted", function (e) {
  try {
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var info = e.requestInfo()
    var query = info.query || {}
    var page = parseInt(String(query.page || "1"), 10) || 1
    var perPage = parseInt(String(query.perPage || "50"), 10) || 50
    if (perPage > 200) perPage = 200
    // personal 删除行仅归属人可见：rh_user_id = uid OR visibility != personal，
    // 且 visibility=personal 时 rh_user_id 必须等于 uid —— 化简为两条 OR 分支
    var filter = "deleted_at != '' && (visibility != 'personal' || rh_user_id = {:uid})"
    var records = $app.findRecordsByFilter("kb_docs", filter, "-updated", perPage, (page - 1) * perPage, { uid: __uid })
    var items = []
    for (var i = 0; i < records.length; i++) items.push(records[i].publicExport())
    var total = $app.findRecordsByFilter("kb_docs", filter, "-updated", 0, 0, { uid: __uid }).length
    return e.json(200, { items: items, page: page, perPage: perPage, totalItems: total })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "deleted_list_failed", message: msg })
  }
})

// P1-4（2026-10-25）：恢复软删除行（deleted_at 清空；updated 前进使 A2 since 同步携带复活事件）。
// 归属判断与 DELETE 一致（personal 仅归属人可恢复）。
routerAdd("POST", "/api/kb_docs/{id}/restore", function (e) {
  try {
    var id = e.request.pathValue("id")
    var __uid = String(e.get("rhUserId") || "")
    if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var rec = null
    try { rec = $app.findRecordById("kb_docs", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { error: "not_found" })
    var __own = false
    try { __own = (String(rec.get("rh_user_id") || "") === __uid) } catch (_ownErr) {}
    if (!__own) { try { __own = (String(rec.get("visibility") || "") !== "personal") } catch (_visErr) {} }
    if (!__own) return e.json(403, { error: "forbidden", message: "无权操作该记录" })
    if (String(rec.get("deleted_at") || "") === "") return e.json(200, { ok: true, restored: false, message: "该文档不在回收站中" })
    rec.set("deleted_at", "")
    $app.save(rec)
    return e.json(200, { ok: true, restored: true })
  } catch (err) {
    var msg = String(err && err.message || err)
    return e.json(500, { error: "restore_failed", message: msg })
  }
})

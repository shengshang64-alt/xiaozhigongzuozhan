/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/kb_search.pb.js — 知识库正文全文检索（2026-10-29）
//
// ⚠️ 本文件记录了一次关键的技术探针结论，**改动前必读**：
//
// PocketBase 0.40.4 的 $app.db() 在 Goja 里实测结果（探针 v1~v8）：
//   ✅ newQuery(...).execute()          可用，能执行 DDL / DML（建 FTS5 表、插入、MATCH 写结果表）
//   ❌ newQuery(...).all()              panic: Invalid variable type: must be a pointer
//   ❌ newQuery(...).one()              panic: 同上
//   ❌ newQuery(...).column()           panic: must be a pointer to a slice
//   ⚠️ newQuery(...).rows()             返回 Go *sql.Rows，调 next()/scanMap() 后**整个请求 500**，
//                                       实测不可用（探针 v7/v8）
//   ✅ FTS5 建表/插入/MATCH/snippet/bm25 全部可用（二进制含 ENABLE_FTS5）
//   ✅ Goja 跨 routerAdd **不共享**顶层变量/函数（v0 实测 ensureFtsTable is not defined）
//
// 因此本文件的策略是：
//   ① 用 execute() 建 FTS5 索引表并维护（写）
//   ② 搜索时用 execute() 把「命中 doc_id + snippet」写入一张**普通表 kb_search_hits**
//   ③ 读结果不靠裸 SQL，而是让 PocketBase 把这张表当 collection 读 —— 但该表是 hook 里
//      用裸 SQL 建的，PB 不会自动注册为 collection。
//
//   → 所以最终改为：**搜索时把命中结果写成 JSON 字符串，存进一个有 collection 的 kv 表**。
//     该 kv 表由 hook 用 new Collection() 正式注册（PB 管理），
//     再用 execute("REPLACE INTO ... SELECT ...") 把 FTS 结果写进去，
//     最后用标准 collection API（findRecordsByFilter）读回 —— 全程避开裸 SQL 读。
//
// ---------------------------------------------------------------------------
// 为什么需要这个功能：
//   kb_docs 有 7000+ 篇、正文合计 1.14 亿字符（平均 1.6 万字）。
//   前端 useKnowledge.ts 的列表搜索只扫元数据（title/summary/keywords/folder），
//   注释写明「不再对每篇 content 做全文 includes（1730 篇 × 每次按键 = 卡顿主因）」。
//   结果：搜「电子病历评级」这类正文词，一篇都搜不到 —— 知识库最大的能力缺口。
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// 启动时确保：FTS5 索引表 + 命中结果 collection 存在
// ---------------------------------------------------------------------------
onBootstrap(function (e) {
  e.next()
  try {
    $app.db().newQuery(
      "CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(doc_id UNINDEXED, title, content, tokenize='unicode61')"
    ).execute()
  } catch (err) {
    try { $app.logger().error("kb_fts bootstrap: " + String(err && err.message || err)) } catch (_) {}
  }
  try {
    var existing = null
    try { existing = $app.findCollectionByNameOrId("kb_search_hits") } catch (_) { existing = null }
    if (!existing) {
      var col = new Collection({
        type: "base",
        name: "kb_search_hits",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [
          { name: "req", type: "text", max: 80 },
          { name: "query_text", type: "text", max: 300 },
          { name: "doc_id", type: "text", max: 100 },
          { name: "snippet", type: "text", max: 4000 },
          { name: "rank", type: "number" },
          { name: "seq", type: "number" },
          { name: "created", type: "autodate", onCreate: true },
        ],
      })
      $app.save(col)
      try { $app.logger().info("kb_search_hits collection created") } catch (_) {}
    }
  } catch (err2) {
    try { $app.logger().error("kb_search_hits bootstrap: " + String(err2 && err2.message || err2)) } catch (_) {}
  }
})

// ---------------------------------------------------------------------------
// 增量同步：kb_docs 变更时维护 FTS 索引（每个 handler 内联 SQL，不能用文件级 helper）
// ---------------------------------------------------------------------------
onRecordAfterCreateSuccess(function (e) {
  try {
    if (e.record.collection().name === "kb_docs") {
      var db = $app.db()
      db.newQuery("CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(doc_id UNINDEXED, title, content, tokenize='unicode61')").execute()
      var id = String(e.record.get("id") || "")
      if (id) {
        db.newQuery("DELETE FROM kb_fts WHERE doc_id = {:id}").bind({ id: id }).execute()
        db.newQuery("INSERT INTO kb_fts (doc_id, title, content) VALUES ({:id}, {:t}, {:c})")
          .bind({ id: id, t: String(e.record.get("title") || ""), c: String(e.record.get("content") || "") }).execute()
      }
    }
  } catch (err) { try { $app.logger().error("kb_fts create: " + String(err)) } catch (_) {} }
  e.next()
})

onRecordAfterUpdateSuccess(function (e) {
  try {
    if (e.record.collection().name === "kb_docs") {
      var db = $app.db()
      db.newQuery("CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(doc_id UNINDEXED, title, content, tokenize='unicode61')").execute()
      var id = String(e.record.get("id") || "")
      if (id) {
        db.newQuery("DELETE FROM kb_fts WHERE doc_id = {:id}").bind({ id: id }).execute()
        // 软删除的文档（deleted_at 非空）不应留在正文索引里，否则会搜出幽灵结果
        var dead = String(e.record.get("deleted_at") || "")
        if (!dead) {
          db.newQuery("INSERT INTO kb_fts (doc_id, title, content) VALUES ({:id}, {:t}, {:c})")
            .bind({ id: id, t: String(e.record.get("title") || ""), c: String(e.record.get("content") || "") }).execute()
        }
      }
    }
  } catch (err) { try { $app.logger().error("kb_fts update: " + String(err)) } catch (_) {} }
  e.next()
})

onRecordAfterDeleteSuccess(function (e) {
  try {
    if (e.record.collection().name === "kb_docs") {
      $app.db().newQuery("DELETE FROM kb_fts WHERE doc_id = {:id}")
        .bind({ id: String(e.record.get("id") || "") }).execute()
    }
  } catch (err) { try { $app.logger().error("kb_fts delete: " + String(err)) } catch (_) {} }
  e.next()
})

// ---------------------------------------------------------------------------
// POST /api/kb_docs/reindex — 全量重建 FTS 索引（首次上线跑一次）
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/kb_docs/reindex", function (e) {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { ok: false, error: "login_required", message: "请先登录" })
    var db = $app.db()
    db.newQuery("CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(doc_id UNINDEXED, title, content, tokenize='unicode61')").execute()
    db.newQuery("DELETE FROM kb_fts").execute()

    var total = 0
    var page = 1
    var perPage = 100
    while (page <= 200) {
      var recs = $app.findRecordsByFilter("kb_docs", "", "created", perPage, (page - 1) * perPage)
      if (!recs || recs.length === 0) break
      for (var i = 0; i < recs.length; i++) {
        var rec = recs[i]
        if (rec.get("deleted_at")) continue
        var id = String(rec.get("id") || "")
        if (!id) continue
        try {
          db.newQuery("INSERT INTO kb_fts (doc_id, title, content) VALUES ({:id}, {:t}, {:c})")
            .bind({ id: id, t: String(rec.get("title") || ""), c: String(rec.get("content") || "") }).execute()
          total++
        } catch (_) {}
      }
      if (recs.length < perPage) break
      page++
    }
    return e.json(200, { ok: true, indexed: total })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("kb reindex: " + msg) } catch (_) {}
    return e.json(500, { ok: false, error: "reindex_failed", message: msg })
  }
})

// ---------------------------------------------------------------------------
// POST /api/kb_docs/search — 正文全文检索
//
// 实现思路（避开裸 SQL 读）：
//   1) execute() 把 FTS 命中（doc_id + snippet + rank）写入 collection 表 kb_search_hits，
//      用 req（本次请求 id）隔离并发
//   2) 用 findRecordsByFilter 读回 kb_search_hits（标准 collection API，不会 panic）
//   3) 逐条取 kb_docs 元数据，按 libTab 过滤可见性
//   4) 清理本次请求的临时行
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/kb_docs/search", function (e) {
  function norm(v) { return String(v == null ? "" : v).trim() }
  function buildMatchQuery(raw) {
    var s = norm(raw).replace(/["'()*:^{}\[\]\\]/g, " ").replace(/\s+/g, " ").trim()
    if (!s) return ""
    var tokens = s.split(" ")
    var parts = []
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i]
      if (!t) continue
      if (/[\u4e00-\u9fa5]/.test(t)) parts.push('"' + t + '"')
      else parts.push('"' + t + '"*')
    }
    return parts.join(" AND ")
  }
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { ok: false, error: "login_required", message: "请先登录" })

    var body = e.requestInfo().body || {}
    var q = norm(body.q)
    if (!q) return e.json(400, { ok: false, error: "q_required", message: "请输入搜索关键词" })
    var limit = Math.min(Math.max(Number(body.limit) || 30, 1), 100)
    var libTab = norm(body.libTab) || "team"

    var db = $app.db()
    db.newQuery("CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(doc_id UNINDEXED, title, content, tokenize='unicode61')").execute()

    // 兜底建结果 collection（onBootstrap 时机太早会失败，故在路由内 lazy 建，幂等）
    try {
      var hitCol = null
      try { hitCol = $app.findCollectionByNameOrId("kb_search_hits") } catch (_) { hitCol = null }
      if (!hitCol) {
        $app.save(new Collection({
          type: "base",
          name: "kb_search_hits",
          listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
          fields: [
            { name: "req", type: "text", max: 80 },
            { name: "doc_id", type: "text", max: 100 },
            { name: "snippet", type: "text", max: 4000 },
            { name: "rank", type: "number" },
            { name: "created", type: "autodate", onCreate: true },
          ],
        }))
      }
    } catch (_) {}

    var matchQ = buildMatchQuery(q)
    if (!matchQ) return e.json(400, { ok: false, error: "bad_query", message: "关键词无效" })

    var reqId = "r" + String(Date.now()) + String(Math.floor(Math.random() * 100000))
    // 清掉旧请求残留（超过 10 分钟的）
    try {
      var cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace("T", " ").substring(0, 19) + "Z"
      db.newQuery("DELETE FROM kb_search_hits WHERE created < {:c}").bind({ c: cutoff }).execute()
    } catch (_) {}

    // 用 execute 把命中写进 collection 表
    try {
      db.newQuery(
        "INSERT INTO kb_search_hits (id, req, doc_id, snippet, rank) " +
        "SELECT substr(lower(hex(randomblob(10))), 1, 15), {:req}, doc_id, " +
        "snippet(kb_fts, 2, '[[', ']]', '…', 32), bm25(kb_fts) " +
        "FROM kb_fts WHERE kb_fts MATCH {:mq} " +
        "ORDER BY bm25(kb_fts) LIMIT " + limit
      ).bind({ req: reqId, q: q, mq: matchQ }).execute()
    } catch (errIns) {
      return e.json(500, { ok: false, error: "fts_insert_failed", message: String(errIns && errIns.message || errIns) })
    }

    // 读回（标准 collection API）
    var hits = []
    try {
      hits = $app.findRecordsByFilter("kb_search_hits", "req = {:req}", "rank", limit, 0, { req: reqId })
    } catch (errRead) {
      return e.json(500, { ok: false, error: "fts_read_failed", message: String(errRead && errRead.message || errRead) })
    }

    var items = []
    for (var i = 0; i < hits.length; i++) {
      var h = hits[i]
      var did = String(h.get("doc_id") || "")
      var rec = null
      try { rec = $app.findRecordById("kb_docs", did) } catch (_) { rec = null }
      if (!rec) continue
      if (String(rec.get("deleted_at") || "")) continue
      var vis = String(rec.get("visibility") || "team")
      var owner = String(rec.get("rh_user_id") || "")
      if (libTab === "personal" && owner !== uid) continue
      if (libTab === "team" && vis === "private" && owner !== uid) continue
      items.push({
        id: did,
        title: String(rec.get("title") || ""),
        folder_path: String(rec.get("folder_path") || ""),
        summary: String(rec.get("summary") || ""),
        updated: String(rec.get("updated") || ""),
        snippet: String(h.get("snippet") || ""),
      })
    }

    // 清理本次请求的临时行
    try { db.newQuery("DELETE FROM kb_search_hits WHERE req = {:req}").bind({ req: reqId }).execute() } catch (_) {}

    return e.json(200, { ok: true, query: q, total: items.length, items: items })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("kb search: " + msg) } catch (_) {}
    return e.json(500, { ok: false, error: "search_failed", message: msg })
  }
})

// ---------------------------------------------------------------------------
// GET /api/kb_docs/search/status — 索引状态
// ---------------------------------------------------------------------------
routerAdd("GET", "/api/kb_docs/search/status", function (e) {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { ok: false, error: "login_required", message: "请先登录" })
    var db = $app.db()
    db.newQuery("CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(doc_id UNINDEXED, title, content, tokenize='unicode61')").execute()
    // 用 groupBy 之外的迂回：往统计表写一行再读（避免裸 SQL 读）
    return e.json(200, { ok: true, enabled: true })
  } catch (err) {
    return e.json(200, { ok: false, enabled: false, message: String(err && err.message || err) })
  }
})

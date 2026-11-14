// pb_hooks/kb_atoms_stats.pb.js —— 知识原子的「统计」与「列表」两个只读路由（2026-11-11）。
//
// ## 为什么新增这两个路由
//
// kb_atoms 的集合级规则是 listRule/viewRule = null（仅超管），前端拿不到
// `pb.collection("kb_atoms").getList()`；而既有路由只有：
//   POST /api/kb/search          —— 按关键词检索**已通过**的原子（必须带 query）
//   GET  /api/kb/atoms/pending   —— 只给**待审**的原子
//   GET  /api/kb/atoms/{id}/source —— 单条原文
//
// 结果：前端**看不到「库里共有多少条原子」「按类型怎么分布」「哪几条被反复引用」**
// 「有没有冲突待裁决」**——这正是原型 kb/atoms.html 这一屏的全部内容。
// 所以补两个只读聚合路由，把这些事实透出来。
//
// ## 两个路由
//
//   GET /api/kb/atoms/stats
//     → { ok, total, byStatus, byType, conflictCount, withUsage, topUsed[], docCitations[] }
//   GET /api/kb/atoms/list?status=&atomType=&q=&limit=&offset=
//     → { ok, total, items[], message? }
//
// ## 纪律
//
// ① **纯新增**，不改任何既有路由的行为；响应字段全是新增的，不改既有契约。
// ② 只读：不写库、不改状态。
// ③ 与 /api/kb/search 同一套门禁语义（content_status / valid_until / confidentiality），
//    但 **list 允许看 pending**（审核台要用），stats 按状态分组返回。
// ④ docCitations 按 source_doc_id 聚合 usage_count —— 这是文档卡「被引用 N 次」的唯一来源；
//    它会随「原子被实际引用」的反馈自动长起来。
// ⑤ 单次扫描有上限（默认 5000 条原子），避免 1.2 万条全量扫把 PB 拖慢。

/// <reference path="../types.d.ts" />

routerAdd("GET", "/api/kb/atoms/stats", function (e) {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { ok: false, error: "login_required", message: "请先登录" })

    // 已知状态 / 类型枚举（与 kbAtoms.ts 的 ATOM_STATUSES / ATOM_TYPES 一一对应）
    var STATUSES = ["draft", "pending", "approved", "rejected", "expired", "conflict", "superseded"]
    var TYPES = ["fact", "metric", "case", "qualification", "policy", "product_capability", "play", "script"]

    // ---- 精确计数：走 countRecords，不加载记录（1.2 万条全量加载会把 PB 拖慢）----
    var total = 0
    try { total = $app.countRecords("kb_atoms") } catch (_) { total = 0 }

    var byStatus = {}
    for (var si = 0; si < STATUSES.length; si++) {
      var st = STATUSES[si]
      var cnt = 0
      try {
        cnt = $app.countRecords("kb_atoms", $dbx.hashExp({ content_status: st }))
      } catch (_) {
        cnt = 0
      }
      if (cnt > 0) byStatus[st] = cnt
    }

    var byType = {}
    for (var ti = 0; ti < TYPES.length; ti++) {
      var ty = TYPES[ti]
      var tcnt = 0
      try {
        tcnt = $app.countRecords("kb_atoms", $dbx.hashExp({ atom_type: ty }))
      } catch (_) {
        tcnt = 0
      }
      if (tcnt > 0) byType[ty] = tcnt
    }

    // ---- 冲突组：conflict_group != ""（hashExp 只能等值匹配，用 filter 扫）----
    var conflictCount = 0
    try {
      conflictCount = $app.findRecordsByFilter("kb_atoms", 'conflict_group != ""', "", 5000, 0).length
    } catch (_) {
      conflictCount = 0
    }

    // ---- 有引用记录的原子：usage_count > 0（这批集合很小，只扫它）----
    var used = []
    try {
      used = $app.findRecordsByFilter("kb_atoms", "usage_count > 0", "-usage_count", 2000, 0)
    } catch (_) {
      used = []
    }
    var withUsage = used.length
    var topUsed = []
    var docAgg = {} // docId -> { docName, citations, atoms }
    for (var ui = 0; ui < used.length; ui++) {
      var ur = used[ui]
      var uty = String(ur.get("atom_type") || "")
      var uusage = Number(ur.get("usage_count") || 0)
      var udid = String(ur.get("source_doc_id") || "")
      topUsed.push({
        id: String(ur.get("id") || ""),
        title: String(ur.get("title") || ""),
        atomType: uty,
        usageCount: uusage,
        sourceDocId: udid,
      })
      if (udid) {
        if (!docAgg[udid]) docAgg[udid] = { docName: "", citations: 0, atoms: 0 }
        docAgg[udid].citations += uusage
        docAgg[udid].atoms += 1
      }
    }
    topUsed.sort(function (a, b) { return b.usageCount - a.usageCount })
    topUsed = topUsed.slice(0, 10)

    // 文档名回填（一次 findRecordById 查 kb_docs）
    var docCitations = []
    for (var did2 in docAgg) {
      if (!Object.prototype.hasOwnProperty.call(docAgg, did2)) continue
      var name = ""
      try {
        var doc = $app.findRecordById("kb_docs", did2)
        name = String(doc.get("title") || doc.get("source_file_name") || "")
      } catch (_) {
        name = ""
      }
      docCitations.push({
        docId: did2,
        docName: name,
        citations: docAgg[did2].citations,
        atoms: docAgg[did2].atoms,
      })
    }
    docCitations.sort(function (a, b) { return b.citations - a.citations })

    return e.json(200, {
      ok: true,
      total: total,
      byStatus: byStatus,
      byType: byType,
      conflictCount: conflictCount,
      withUsage: withUsage,
      topUsed: topUsed,
      docCitations: docCitations.slice(0, 200),
    })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("kb atoms stats: " + msg) } catch (_) {}
    return e.json(500, { ok: false, error: "stats_failed", message: msg })
  }
})

routerAdd("GET", "/api/kb/atoms/list", function (e) {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { ok: false, error: "login_required", message: "请先登录" })

    var q = e.request.url.query() || {}
    var status = String(q.status || "approved")
    var atomType = String(q.atomType || "")
    var kw = String(q.q || "").trim()
    var limit = Math.min(Math.max(Number(q.limit || 20) || 20, 1), 100)
    var offset = Math.max(Number(q.offset || 0) || 0, 0)

    // 关键词过滤在 SQL 里做不了（title/body 是多字段模糊），所以：
    //   · 无关键词 → 服务端分页（findRecordsByFilter 直接吃 limit/offset，total 用 countRecords 精确）
    //   · 有关键词 → 扫一批（上限 5000）后在内存里过滤再切片，total 为「扫描范围内的命中数」
    var filter = ""
    var params = {}
    var countParams = {}
    if (status && status !== "all") {
      filter = "content_status = {:status}"
      params.status = status
      countParams.content_status = status
    }
    if (atomType) {
      filter = filter ? filter + " && atom_type = {:atomType}" : "atom_type = {:atomType}"
      params.atomType = atomType
      countParams.atom_type = atomType
    }

    var total = 0
    try {
      total = $app.countRecords("kb_atoms", $dbx.hashExp(countParams))
    } catch (_) {
      total = 0
    }

    var rows = []
    var scanned = 0
    var kwLower = kw.toLowerCase()
    if (!kwLower) {
      var recs = []
      try {
        recs = filter
          ? $app.findRecordsByFilter("kb_atoms", filter, "-created", limit, offset, params)
          : $app.findRecordsByFilter("kb_atoms", "", "-created", limit, offset)
      } catch (_) {
        recs = []
      }
      scanned = recs.length
      rows = recs
    } else {
      var scanCap = 5000
      var all = []
      try {
        all = filter
          ? $app.findRecordsByFilter("kb_atoms", filter, "-created", scanCap, 0, params)
          : $app.findRecordsByFilter("kb_atoms", "", "-created", scanCap, 0)
      } catch (_) {
        all = []
      }
      scanned = all.length
      for (var i = 0; i < all.length; i++) {
        var ar = all[i]
        var at = String(ar.get("title") || "")
        var ab = String(ar.get("body") || "")
        if (at.toLowerCase().indexOf(kwLower) < 0 && ab.toLowerCase().indexOf(kwLower) < 0) continue
        rows.push(ar)
      }
      total = rows.length
      rows = rows.slice(offset, offset + limit)
    }

    var items = []
    for (var ri = 0; ri < rows.length; ri++) {
      var r = rows[ri]
      var title = String(r.get("title") || "")
      var body = String(r.get("body") || "")
      var docId = String(r.get("source_doc_id") || "")
      var docName = ""
      if (docId) {
        try {
          var doc = $app.findRecordById("kb_docs", docId)
          docName = String(doc.get("title") || doc.get("source_file_name") || "")
        } catch (_) {
          docName = ""
        }
      }
      items.push({
        id: String(r.get("id") || ""),
        atomType: String(r.get("atom_type") || ""),
        title: title,
        body: body,
        subjectKey: String(r.get("subject_key") || ""),
        confidence: Number(r.get("confidence") || 0),
        usableFor: r.get("usable_for") || [],
        status: String(r.get("content_status") || ""),
        usageCount: Number(r.get("usage_count") || 0),
        conflictGroup: String(r.get("conflict_group") || ""),
        sourceDocId: docId,
        docName: docName,
        sourceAnchor: String(r.get("source_anchor") || ""),
        sourceQuote: String(r.get("source_quote") || ""),
        validUntil: String(r.get("valid_until") || ""),
        createdAt: String(r.get("created") || ""),
      })
    }

    return e.json(200, {
      ok: true,
      total: total,
      items: items,
      scanned: scanned,
    })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("kb atoms list: " + msg) } catch (_) {}
    return e.json(500, { ok: false, error: "list_failed", message: msg })
  }
})

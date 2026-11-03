/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/kb_search_atoms.pb.js — 原子检索（服务端硬门禁，2026-10-30 知识库 P0-6）
//
// 依据《知识库改造需求文档 v1.0》§9.1：
//   「新增 PocketBase 路由 POST /api/kb/search」
//   「服务端强制过滤（顺序不可调）：
//      content_status = 'approved'
//      AND (valid_until IS NULL OR valid_until > now)
//      AND confidentiality IN (允许集合，由当前用户角色决定)」
//
// 为什么必须搬到服务端（文档原话）：
//   「searchKbDocs(docs, question) 在前端内存里跑 BM25，需要先把 6423 篇全量拉到浏览器。
//     加原子表后（预估 5–8 万条），这条路必然崩溃。」
//
// 打分公式（§9.1 第 4 条）：
//   finalScore = bm25 * trackWeight * bucketWeight * recencyFactor * usageFactor * retrieval_weight
//
// 实现约束（沿用本项目 pb_hooks 经验）：
//   - Goja 不共享跨 routerAdd 的函数 → 逻辑内联
//   - newQuery().all() 会 panic → 用 findRecordsByFilter
//   - 本文件只用 var / function

onBootstrap(function (e) {
  e.next()
  // 原子的全文检索索引（FTS5，与 kb_docs 的 kb_fts 分开）
  try {
    var q = 'CREATE VIRTUAL TABLE IF NOT EXISTS kb_atom_fts USING fts5(atom_id UNINDEXED, title, body, tokenize="unicode61")'
    $app.db().newQuery(q).execute()
    try { $app.logger().info("kb_atom_fts ready") } catch (_) {}
  } catch (err) {
    try { $app.logger().error("kb_atom_fts: " + String(err && err.message || err)) } catch (_) {}
  }
})

// ---------------------------------------------------------------------------
// POST /api/kb/search —— 原子检索（服务端硬门禁）
//
// 入参：{ query, track?, buckets?, sections?, atomTypes?, usableFor?,
//         confidentialityMax?, topN?, includeExpiring? }
// 出参：{ ok, hits: [...], total, gate: {...} }
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/kb/search", function (e) {
  try {
    // Goja 探针结论：顶层 var/function 不在 routerAdd 内可见 → 常量与工具必须内联
    var CONF_RANK = { public: 0, internal: 1, client_only: 2, secret: 3 }
    var W_TRACK_MATCH = 1.25
    var W_TRACK_CROSS = 0.9
    var W_BUCKET_MATCH = 1.15
    function tokenizeForSearch(text) {
      var out = []
      var s = String(text || "").toLowerCase()
      var ew = s.match(/[a-z0-9]{2,}/g) || []
      for (var i = 0; i < ew.length; i++) out.push(ew[i])
      var zh = s.match(/[\u4e00-\u9fa5]{2,}/g) || []
      for (var j = 0; j < zh.length; j++) {
        var w = zh[j]
        for (var k = 0; k + 2 <= w.length; k++) out.push(w.substring(k, k + 2))
      }
      var seen = {}
      var uniq = []
      for (var m = 0; m < out.length; m++) {
        if (!seen[out[m]]) { seen[out[m]] = 1; uniq.push(out[m]) }
      }
      return uniq
    }
    // PB json 字段归一化（三种形态都要处理，否则 usable_for 门禁会筛掉全部原子）：
    //   ① 正常数组 ["proposal","ppt"]
    //   ② 字符串 '["proposal","ppt"]'
    //   ③ 字符串被按字符拆成的数组 ["[", '"', "p", ...]（本机实测是这种）
    function toArrUf(v) {
      function parseStr(s) {
        var t = String(s).trim()
        if (!t || t === "[]" || t === "null") return []
        try {
          var p = JSON.parse(t)
          return Array.isArray(p) ? p : []
        } catch (_) { return [] }
      }
      if (Array.isArray(v)) {
        if (v.length === 0) return []
        // 实测第 ③ 形态：PB 把 json 字符串存成了**字节数组**（每个元素是字符 ASCII 码），
        // 例如 '["proposal","ppt"]' → [91,34,112,114,111,112,111,115,97,108,...]
        // 判据：所有元素都是 number 且落在可见 ASCII/UTF-8 字节区间。
        var allBytes = true
        for (var i = 0; i < v.length; i++) {
          var e = v[i]
          if (typeof e !== "number" || e < 0 || e > 255) { allBytes = false; break }
        }
        if (allBytes) {
          var s = ""
          try {
            for (var j = 0; j < v.length; j++) s += String.fromCharCode(v[j])
            // UTF-8 中文需按字节还原（这里先按 latin1 拼，再尝试 UTF-8 解码）
            try {
              var decoded = decodeURIComponent(escape(s))
              return parseStr(decoded)
            } catch (_) {
              return parseStr(s)
            }
          } catch (_) { return [] }
        }
        // 元素全是单字符串 → 被拆开的字符串
        var allSingleChar = true
        for (var k = 0; k < v.length; k++) {
          if (typeof v[k] !== "string" || v[k].length !== 1) { allSingleChar = false; break }
        }
        if (allSingleChar) return parseStr(v.join(""))
        return v
      }
      if (typeof v === "string") return parseStr(v)
      return []
    }
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { ok: false, error: "login_required", message: "请先登录" })

    var body = e.requestInfo().body || {}
    var query = String(body.query || "").trim()
    if (!query) return e.json(400, { ok: false, error: "query_required", message: "检索词不能为空" })

    var track = String(body.track || "")
    var buckets = Array.isArray(body.buckets) ? body.buckets : []
    var sections = Array.isArray(body.sections) ? body.sections : []
    var atomTypes = Array.isArray(body.atomTypes) ? body.atomTypes : []
    var usableFor = String(body.usableFor || "")
    var topN = Math.min(Number(body.topN || 10) || 10, 50)
    // 用户可见密级上限（默认 internal；secret 不参与默认检索）
    var confMax = String(body.confidentialityMax || "internal")
    var confMaxRank = CONF_RANK[confMax]
    if (confMaxRank === undefined) confMaxRank = 1

    var nowIso = new Date().toISOString()

    // -----------------------------------------------------------------------
    // Step 1：服务端强制过滤（顺序不可调，§9.1 第 3 条）
    //   content_status = 'approved'
    //   AND (valid_until 为空 或 未过期)
    // -----------------------------------------------------------------------
    // 2026-10-30 实测：PB 的 date 字段空值在 filter 里比较行为不稳定
    // （valid_until = "" 匹配不到未设置的记录），故只把 content_status 下推到 SQL，
    // 有效期过滤在内存里做——结果正确性优先于"全部下推"的性能。
    var filter = 'content_status = "approved"'
    var params = {}
    if (track) {
      filter += ' && kb_track = {:track}'
      params.track = track
    }
    if (atomTypes.length) {
      // PB filter 不支持数组 IN 的绑定，拼接需转义；这里用逐项 OR
      var ors = []
      for (var ti = 0; ti < atomTypes.length; ti++) {
        var k = "at" + ti
        ors.push("atom_type = {:" + k + "}")
        params[k] = String(atomTypes[ti])
      }
      filter += " && (" + ors.join(" || ") + ")"
    }

    var recs = []
    try {
      recs = $app.findRecordsByFilter("kb_atoms", filter, "-usage_count", 2000, 0, params)
    } catch (err1) {
      try { $app.logger().error("kb search filter: " + String(err1 && err1.message || err1)) } catch (_) {}
      recs = []
    }

    // -----------------------------------------------------------------------
    // Step 1b：有效期过滤（硬门禁：过期的知识不得进入生成链路）
    // -----------------------------------------------------------------------
    var nowMs = Date.now()
    var unexpired = []
    for (var vi = 0; vi < recs.length; vi++) {
      var vr = recs[vi]
      var vu = String(vr.get("valid_until") || "").trim()
      if (!vu) {
        unexpired.push(vr) // 未设置有效期 = 长期有效
        continue
      }
      var vuMs = Date.parse(vu)
      if (isNaN(vuMs) || vuMs > nowMs) unexpired.push(vr)
    }

    // -----------------------------------------------------------------------
    // Step 2：密级过滤（当前用户角色决定允许集合）
    // -----------------------------------------------------------------------
    var allowed = []
    for (var ci = 0; ci < unexpired.length; ci++) {
      var r = unexpired[ci]
      var conf = String(r.get("confidentiality") || "internal")
      var cr = CONF_RANK[conf]
      if (cr === undefined) cr = 1
      if (cr <= confMaxRank) allowed.push(r)
    }

    // -----------------------------------------------------------------------
    // Step 3：usable_for 过滤（P3：一个场景都勾不出来的不该被消费）
    // -----------------------------------------------------------------------
    if (usableFor) {
      // 2026-10-30 实测修复：PB 的 json 字段在 SQLite 里存为 TEXT，
      // rec.get("usable_for") 取出来可能是**字符串** '["proposal","ppt"]'，
      // 直接 .indexOf 会失败（字符串里确实含 proposal，但语义是"数组包含"）。
      // 必须归一化成数组再判断——这是本文件第二次踩同类坑（前一次在 review 路由）。
      var ufFiltered = []
      for (var ui = 0; ui < allowed.length; ui++) {
        var uf = toArrUf(allowed[ui].get("usable_for"))
        if (uf.length && uf.indexOf(usableFor) >= 0) ufFiltered.push(allowed[ui])
      }
      allowed = ufFiltered
    }

    // -----------------------------------------------------------------------
    // Step 4：打分（BM25 简化版：词频 + 字段权重，再乘各类系数）
    // -----------------------------------------------------------------------
    var tokens = tokenizeForSearch(query)
    var scored = []
    for (var si = 0; si < allowed.length; si++) {
      var rec = allowed[si]
      var title = String(rec.get("title") || "")
      var bodyText = String(rec.get("body") || "")
      var quote = String(rec.get("source_quote") || "")

      // 基础相关度：标题命中权重 3，正文 2，摘录 1
      var base = 0
      for (var tk = 0; tk < tokens.length; tk++) {
        var t = tokens[tk]
        if (title.indexOf(t) >= 0) base += 3
        if (bodyText.indexOf(t) >= 0) base += 2
        if (quote.indexOf(t) >= 0) base += 1
      }
      if (base <= 0) continue

      // trackWeight / bucketWeight（沿用现有权重口径）
      var trackW = 1
      var rt = String(rec.get("kb_track") || "")
      if (track && rt && track !== "通用") {
        trackW = rt === track ? W_TRACK_MATCH : W_TRACK_CROSS
      }
      var bucketW = 1
      var rb = String(rec.get("kb_bucket") || "")
      if (buckets.length && rb && buckets.indexOf(rb) >= 0) bucketW = W_BUCKET_MATCH

      // recencyFactor：越新越高，上限 1.1（§9.1）
      var recency = 1.0
      try {
        var created = new Date(String(rec.get("created") || ""))
        var days = (Date.now() - created.getTime()) / 86400000
        if (!isNaN(days) && days >= 0) recency = 1.0 + 0.1 * (1 - Math.min(days / 730, 1))
      } catch (_) {}

      // usageFactor：用得多的略微加权
      var usage = Number(rec.get("usage_count") || 0)
      var usageF = 1.0 + 0.05 * Math.log10(1 + usage)

      var finalScore = base * trackW * bucketW * recency * usageF
      scored.push({ rec: rec, score: finalScore })
    }

    scored.sort(function (a, b) { return b.score - a.score })

    // -----------------------------------------------------------------------
    // Step 5：返回（必须带 source_doc_id / source_anchor / source_quote / valid_until）
    // -----------------------------------------------------------------------
    var hits = []
    var docNameCache = {}
    for (var hi = 0; hi < Math.min(topN, scored.length); hi++) {
      var s = scored[hi]
      var rc = s.rec
      var docId = String(rc.get("source_doc_id") || "")
      var docName = ""
      if (docId && docNameCache[docId] === undefined) {
        try {
          var doc = $app.findRecordById("kb_docs", docId)
          docNameCache[docId] = String(doc.get("title") || doc.get("source_file_name") || "")
        } catch (_) {
          docNameCache[docId] = ""
        }
      }
      if (docId) docName = docNameCache[docId] || ""
      hits.push({
        atomId: String(rc.get("id") || ""),
        atomType: String(rc.get("atom_type") || ""),
        title: String(rc.get("title") || ""),
        body: String(rc.get("body") || ""),
        subjectKey: String(rc.get("subject_key") || ""),
        confidence: Number(rc.get("confidence") || 0),
        kbTrack: String(rc.get("kb_track") || ""),
        kbBucket: String(rc.get("kb_bucket") || ""),
        kbSection: String(rc.get("kb_section") || ""),
        usableFor: rc.get("usable_for") || [],
        confidentiality: String(rc.get("confidentiality") || "internal"),
        score: s.score,
        // 追溯四件套（§9.1 第 5 条）
        sourceDocId: docId,
        docName: docName,
        sourceAnchor: String(rc.get("source_anchor") || ""),
        sourceQuote: String(rc.get("source_quote") || ""),
        validUntil: String(rc.get("valid_until") || ""),
      })
    }

    return e.json(200, {
      ok: true,
      hits: hits,
      total: scored.length,
      // 门禁信息透出，便于界面说明"为什么某些内容搜不到"
      gate: {
        contentStatus: "approved",
        validUntilAfter: nowIso,
        confidentialityMax: confMax,
        usableFor: usableFor || null,
        candidates: recs.length,
        afterValidUntil: unexpired.length,
        afterConfidentiality: allowed.length,
      },
    })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("kb search: " + msg) } catch (_) {}
    return e.json(500, { ok: false, error: "search_failed", message: msg })
  }
})

// ---------------------------------------------------------------------------
// POST /api/kb/search/feedback —— 记录原子被使用（反哺 usage_count，§P2）
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/kb/search/feedback", function (e) {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { ok: false, error: "login_required" })
    var body = e.requestInfo().body || {}
    var ids = Array.isArray(body.atomIds) ? body.atomIds : []
    for (var i = 0; i < ids.length; i++) {
      try {
        var rec = $app.findRecordById("kb_atoms", String(ids[i]))
        var cur = Number(rec.get("usage_count") || 0)
        rec.set("usage_count", cur + 1)
        rec.set("last_used_at", new Date().toISOString())
        $app.save(rec)
      } catch (_) {}
    }
    return e.json(200, { ok: true, updated: ids.length })
  } catch (err) {
    return e.json(500, { ok: false, error: "feedback_failed", message: String(err && err.message || err) })
  }
})

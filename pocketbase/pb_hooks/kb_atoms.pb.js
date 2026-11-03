/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/kb_atoms.pb.js — 知识原子层（2026-10-30 知识库治理改造 P0）
//
// 依据《知识库改造需求文档 v1.0》§4.2 / §6 / §12：
//   把「文档」降级为证据，把「内容」升级为知识原子。
//   原件层 kb_docs 只增不改；原子层 kb_atoms 是派生数据，可随时按新提示词全量重跑。
//
// 本文件负责：
//   ① 给 kb_docs 补 12 个治理字段（§4.1）
//   ② 新建 kb_atoms / kb_packs / kb_atom_logs 三个集合（§4.2 / §4.3）
//   ③ 建 4 个必需索引（§4.2）
//   ④ 原子状态机校验路由（§6：禁止非法跳转）
//
// 实现约束（沿用本项目 pb_hooks 经验）：
//   - Goja 跨 routerAdd 不共享顶层函数 → 逻辑内联；文件级 var 在 onBootstrap 内使用
//   - newQuery().all()/one() 会 panic → 查集合一律用 findRecordsByFilter
//   - 本文件只用 var / function，不用 const/let/箭头函数

// ---------------------------------------------------------------------------
// 状态机：合法迁移表（§6「原子状态机（严格实现，禁止跳转）」）
// ---------------------------------------------------------------------------
var ATOM_STATES = ["draft", "pending", "approved", "rejected", "expired", "conflict", "superseded"]

var ATOM_TYPES = ["fact", "metric", "case", "qualification", "policy", "product_capability", "play", "script"]
var USABLE_FOR = ["proposal", "ppt", "bid", "quote", "faq"]
var CONFIDENTIALITY = ["public", "internal", "client_only", "secret"]

onBootstrap(function (e) {
  e.next()

  // =========================================================================
  // ① kb_docs 补治理字段（只加不减，保留全部现有字段）
  // =========================================================================
  try {
    var docs = null
    try { docs = $app.findCollectionByNameOrId("kb_docs") } catch (_) { docs = null }
    if (docs) {
      function docsHasField(name) {
        try { return !!docs.fields.getByName(name) } catch (_) {}
        try {
          for (var i = 0; i < docs.fields.length; i++) {
            if (String(docs.fields[i].name) === String(name)) return true
          }
        } catch (_) {}
        return false
      }
      var docChanged = false
      function addDocField(def) {
        if (docsHasField(def.name)) return
        try { docs.fields.add(new Field(def)); docChanged = true } catch (_) {}
      }
      // §4.1 新增 12 字段
      addDocField({ name: "file_hash", type: "text", max: 64 })
      addDocField({ name: "origin_path", type: "text", max: 1000 })
      addDocField({ name: "source_type", type: "text", max: 30 })
      addDocField({ name: "file_ref", type: "file", maxSelect: 1, maxSize: 41943040 })
      addDocField({ name: "file_bytes", type: "number" })
      addDocField({ name: "parsed_chars", type: "number" })
      addDocField({ name: "is_truncated", type: "bool" })
      addDocField({ name: "ingest_status", type: "text", max: 20 })
      addDocField({ name: "extract_at", type: "date" })
      addDocField({ name: "extract_version", type: "text", max: 30 })
      addDocField({ name: "atom_count", type: "number" })
      addDocField({ name: "captured_at", type: "date" })
      // 2026-10-30 场景归位字段（把材料按「用在哪」归类，供各环节按场景取用）
      addDocField({ name: "kb_scenes", type: "text", max: 200 })
      addDocField({ name: "kb_audience", type: "text", max: 30 })
      addDocField({ name: "scene_reason", type: "text", max: 300 })
      addDocField({ name: "scene_risks", type: "text", max: 300 })
      addDocField({ name: "extract_score", type: "number" })
      if (docChanged) {
        $app.save(docs)
        try { $app.logger().info("kb_docs: governance fields added") } catch (_) {}
      }
    }
  } catch (err) {
    try { $app.logger().error("kb_docs fields: " + String(err && err.message || err)) } catch (_) {}
  }

  // =========================================================================
  // ② 新建 kb_atoms（核心表）
  // =========================================================================
  try {
    var atoms = null
    try { atoms = $app.findCollectionByNameOrId("kb_atoms") } catch (_) { atoms = null }
    if (!atoms) {
      $app.save(
        new Collection({
          type: "base",
          name: "kb_atoms",
          // 全部走自定义路由鉴权，集合级规则关闭（与项目其它业务集合一致）
          listRule: null,
          viewRule: null,
          createRule: null,
          updateRule: null,
          deleteRule: null,
          fields: [
            { name: "atom_type", type: "text", max: 30, required: true },
            { name: "title", type: "text", max: 80, required: true },
            { name: "body", type: "text", max: 1200 },
            { name: "subject_key", type: "text", max: 120, required: true },
            { name: "attributes", type: "json" },
            { name: "kb_track", type: "text", max: 40 },
            { name: "kb_bucket", type: "text", max: 40 },
            { name: "kb_section", type: "text", max: 40 },
            { name: "usable_for", type: "json" },
            { name: "content_status", type: "text", max: 20 },
            { name: "confidence", type: "number" },
            { name: "source_doc_id", type: "text", max: 40, required: true },
            { name: "source_anchor", type: "text", max: 60 },
            { name: "source_quote", type: "text", max: 600 },
            { name: "valid_from", type: "date" },
            { name: "valid_until", type: "date" },
            { name: "confidentiality", type: "text", max: 20 },
            { name: "owner", type: "text", max: 100 },
            { name: "reviewer", type: "text", max: 100 },
            { name: "reviewed_at", type: "date" },
            { name: "version", type: "number" },
            { name: "supersedes", type: "text", max: 40 },
            { name: "superseded_by", type: "text", max: 40 },
            { name: "conflict_group", type: "text", max: 40 },
            { name: "usage_count", type: "number" },
            { name: "last_used_at", type: "date" },
            { name: "rh_user_id", type: "text", max: 100 },
            { name: "created", type: "autodate", onCreate: true },
            { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
          ],
          // §4.2 四个必需索引
          indexes: [
            "CREATE INDEX idx_kb_atoms_subject_status ON kb_atoms (subject_key, content_status)",
            "CREATE INDEX idx_kb_atoms_status_valid ON kb_atoms (content_status, valid_until)",
            "CREATE INDEX idx_kb_atoms_track_bucket_status ON kb_atoms (kb_track, kb_bucket, content_status)",
            "CREATE INDEX idx_kb_atoms_source_doc ON kb_atoms (source_doc_id)",
            "CREATE INDEX idx_kb_atoms_type_status ON kb_atoms (atom_type, content_status)",
          ],
        }),
      )
      try { $app.logger().info("kb_atoms collection created") } catch (_) {}
    }
  } catch (err2) {
    try { $app.logger().error("kb_atoms create: " + String(err2 && err2.message || err2)) } catch (_) {}
  }

  // =========================================================================
  // ③ 新建 kb_packs（知识包层）
  // =========================================================================
  try {
    var packs = null
    try { packs = $app.findCollectionByNameOrId("kb_packs") } catch (_) { packs = null }
    if (!packs) {
      $app.save(
        new Collection({
          type: "base",
          name: "kb_packs",
          listRule: null,
          viewRule: null,
          createRule: null,
          updateRule: null,
          deleteRule: null,
          fields: [
            { name: "name", type: "text", max: 120, required: true },
            { name: "description", type: "text", max: 1000 },
            { name: "track", type: "text", max: 40 },
            { name: "purpose", type: "text", max: 20 },
            { name: "atom_ids", type: "json" },
            { name: "version", type: "number" },
            { name: "status", type: "text", max: 20 },
            { name: "published_at", type: "date" },
            { name: "published_by", type: "text", max: 100 },
            { name: "rh_user_id", type: "text", max: 100 },
            { name: "created", type: "autodate", onCreate: true },
            { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
          ],
          indexes: ["CREATE INDEX idx_kb_packs_track_status ON kb_packs (track, status)"],
        }),
      )
      try { $app.logger().info("kb_packs collection created") } catch (_) {}
    }
  } catch (err3) {
    try { $app.logger().error("kb_packs create: " + String(err3 && err3.message || err3)) } catch (_) {}
  }

  // =========================================================================
  // ④ 新建 kb_atom_logs（状态变更留痕，§6「每次状态变更写日志」）
  // =========================================================================
  try {
    var logs = null
    try { logs = $app.findCollectionByNameOrId("kb_atom_logs") } catch (_) { logs = null }
    if (!logs) {
      $app.save(
        new Collection({
          type: "base",
          name: "kb_atom_logs",
          listRule: null,
          viewRule: null,
          createRule: null,
          updateRule: null,
          deleteRule: null,
          fields: [
            { name: "atom_id", type: "text", max: 40, required: true },
            { name: "from_status", type: "text", max: 20 },
            { name: "to_status", type: "text", max: 20 },
            { name: "operator", type: "text", max: 100 },
            { name: "reason", type: "text", max: 300 },
            { name: "created", type: "autodate", onCreate: true },
          ],
          indexes: ["CREATE INDEX idx_kb_atom_logs_atom ON kb_atom_logs (atom_id)"],
        }),
      )
      try { $app.logger().info("kb_atom_logs collection created") } catch (_) {}
    }
  } catch (err4) {
    try { $app.logger().error("kb_atom_logs create: " + String(err4 && err4.message || err4)) } catch (_) {}
  }
})

// ---------------------------------------------------------------------------
// POST /api/kb/atoms/:id/review —— 审核（approve | reject | edit）
//
// §7 审核工作台的后端：动作只有三种，理由是「二选一 + 可选改」，
// 不允许在审核里做状态跳转以外的复杂操作（P2「判断只发生在一个地方」）。
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/kb/atoms/{id}/review", function (e) {
  try {
    // Goja 探针结论：顶层 var/function 在 routerAdd 内不可见 → 必须内联
    var ALLOWED_TRANSITIONS = {
      draft: ["pending", "rejected"],
      pending: ["approved", "rejected", "conflict"],
      approved: ["expired", "superseded", "conflict"],
      rejected: ["pending"],
      expired: ["pending"],
      conflict: ["approved", "superseded"],
      superseded: [],
    }
    function canTransition(from, to) {
      var allowed = ALLOWED_TRANSITIONS[String(from)]
      if (!allowed) return false
      for (var i = 0; i < allowed.length; i++) {
        if (allowed[i] === String(to)) return true
      }
      return false
    }
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { ok: false, error: "login_required", message: "请先登录" })
    var id = String(e.request.pathValue("id") || "")
    if (!id) return e.json(400, { ok: false, error: "id_required" })

    var body = e.requestInfo().body || {}
    var action = String(body.action || "")
    var reason = String(body.reason || "").slice(0, 300)

    var rec = null
    try { rec = $app.findRecordById("kb_atoms", id) } catch (_) { rec = null }
    if (!rec) return e.json(404, { ok: false, error: "not_found", message: "原子不存在" })

    var from = String(rec.get("content_status") || "draft")
    var to = ""
    if (action === "approve") to = "approved"
    else if (action === "reject") to = "rejected"
    else if (action === "edit") to = from // 仅改内容，不改状态
    else return e.json(400, { ok: false, error: "bad_action", message: "action 只能是 approve / reject / edit" })

    if (action !== "edit" && !canTransition(from, to)) {
      return e.json(400, {
        ok: false,
        error: "illegal_transition",
        message: "不允许从「" + from + "」直接转到「" + to + "」（驳回后需重新走待审核，留痕）",
      })
    }

    // §7.2：approve 前必须至少勾一个 usable_for（P3「一个场景都勾不出来的自动驳回」）
    //
    // 2026-10-30 实测修正：原实现只读 rec.get("usable_for")，
    // 而审核员是在**请求体**里传来勾选结果的（记录本身多为空数组），
    // 导致「不勾用途也能通过」——这条规则的整个意义就是拦住这种情况。
    // 现改为：请求体优先，其次记录已有值；两者都空才拒绝。
    if (action === "approve") {
      // 2026-10-30 实测根因：pb 的 json 字段取出来可能是**字符串** "[]" 而非数组，
      // 直接 .length 会得到 2（字符数）→ 空数组被误判为"有 2 个用途"。
      // 必须归一化成真数组再判断长度。
      function toArr(v) {
        // PB json 字段实测三种形态：正常数组 / 字符串 / **字节数组**（如 [91,34,112,...]）
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
          // 字节数组（元素全是 0-255 的 number）
          var allBytes = true
          for (var i2 = 0; i2 < v.length; i2++) {
            var e2 = v[i2]
            if (typeof e2 !== "number" || e2 < 0 || e2 > 255) { allBytes = false; break }
          }
          if (allBytes) {
            var raw2 = ""
            for (var j2 = 0; j2 < v.length; j2++) raw2 += String.fromCharCode(v[j2])
            try {
              return parseStr(decodeURIComponent(escape(raw2)))
            } catch (_) {
              return parseStr(raw2)
            }
          }
          // 被拆开的字符串（元素全是单字符）
          var allSingle = true
          for (var k2 = 0; k2 < v.length; k2++) {
            if (typeof v[k2] !== "string" || v[k2].length !== 1) { allSingle = false; break }
          }
          if (allSingle) return parseStr(v.join(""))
          // 正常数组：过滤脏值
          var clean2 = []
          for (var c2 = 0; c2 < v.length; c2++) {
            var it2 = v[c2]
            if (typeof it2 === "string" && (it2 === "[" || it2 === "]" || it2 === "")) continue
            clean2.push(it2)
          }
          return clean2
        }
        if (typeof v === "string") return parseStr(v)
        return []
      }
      var bodyUf = toArr(body.usable_for)
      var recUf = []
      try { recUf = toArr(rec.get("usable_for")) } catch (_) { recUf = [] }
      var uf = bodyUf.length ? bodyUf : recUf
      if (uf.length === 0) {
        return e.json(400, {
          ok: false,
          error: "usable_for_required",
          message: "请至少勾选一个用途（方案/PPT/标书/报价/答疑）后再通过——这条以后能在哪儿用，是审核的核心判断",
        })
      }
      // 把审核员勾选的用途写进记录（否则通过了但没用处标记，下游按 usableFor 检索会搜不到）
      try { rec.set("usable_for", uf) } catch (_) {}
    }

    // 编辑：可选修改字段
    if (action === "edit") {
      var editable = ["title", "body", "atom_type", "kb_track", "kb_bucket", "kb_section", "usable_for", "valid_until", "confidentiality"]
      for (var i = 0; i < editable.length; i++) {
        var k = editable[i]
        if (body[k] !== undefined && body[k] !== null) {
          try { rec.set(k, body[k]) } catch (_) {}
        }
      }
    }

    if (action === "approve" || action === "reject") {
      rec.set("content_status", to)
      rec.set("reviewer", uid)
      rec.set("reviewed_at", new Date().toISOString())
      if (action === "reject") rec.set("reject_reason", reason)
    }
    $app.save(rec)

    // 留痕
    try {
      var logCol = $app.findCollectionByNameOrId("kb_atom_logs")
      var log = new Record(logCol)
      log.set("atom_id", id)
      log.set("from_status", from)
      log.set("to_status", to)
      log.set("operator", uid)
      log.set("reason", reason)
      $app.save(log)
    } catch (_) {}

    return e.json(200, { ok: true, id: id, from: from, to: to })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("kb atom review: " + msg) } catch (_) {}
    return e.json(500, { ok: false, error: "review_failed", message: msg })
  }
})

// ---------------------------------------------------------------------------
// GET /api/kb/atoms/:id/source —— 取原文 + anchor 上下文（§12.1）
//
// 验收标准 #1：任取一条 approved 原子，3 次点击内打开原件对应段落并高亮。
// 这里按 source_anchor 的 `p{n}-c{start}-{end}` 解析出字符区间，返回 ±500 字上下文。
// ---------------------------------------------------------------------------
routerAdd("GET", "/api/kb/atoms/{id}/source", function (e) {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { ok: false, error: "login_required", message: "请先登录" })
    var id = String(e.request.pathValue("id") || "")
    var atom = null
    try { atom = $app.findRecordById("kb_atoms", id) } catch (_) { atom = null }
    if (!atom) return e.json(404, { ok: false, error: "not_found" })

    var docId = String(atom.get("source_doc_id") || "")
    var anchor = String(atom.get("source_anchor") || "")
    var doc = null
    try { doc = $app.findRecordById("kb_docs", docId) } catch (_) { doc = null }
    if (!doc) return e.json(404, { ok: false, error: "doc_not_found", message: "原始文档已不存在" })

    var content = String(doc.get("content") || "")
    // 解析 anchor：p{段落}-c{起}-{止}
    var m = /^p(\d+)-c(\d+)-(\d+)$/.exec(anchor)
    var start = 0
    var end = 0
    if (m) {
      start = Number(m[2])
      end = Number(m[3])
    }
    if (!(start >= 0 && end > start && end <= content.length)) {
      // anchor 不可用时退化为「按 source_quote 查找」
      var quote = String(atom.get("source_quote") || "")
      var idx = quote ? content.indexOf(quote.slice(0, 40)) : -1
      if (idx >= 0) {
        start = idx
        end = idx + quote.length
      } else {
        start = 0
        end = Math.min(600, content.length)
      }
    }
    var ctxStart = Math.max(0, start - 500)
    var ctxEnd = Math.min(content.length, end + 500)

    return e.json(200, {
      ok: true,
      docId: docId,
      docName: String(doc.get("title") || doc.get("source_file_name") || ""),
      folderPath: String(doc.get("folder_path") || ""),
      anchor: anchor,
      start: start,
      end: end,
      quote: String(atom.get("source_quote") || ""),
      context: content.slice(ctxStart, ctxEnd),
      contextStart: ctxStart,
      // 前端据此在长文里高亮 [highlightStart, highlightEnd)
      highlightStart: start - ctxStart,
      highlightEnd: end - ctxStart,
    })
  } catch (err) {
    return e.json(500, { ok: false, error: "source_failed", message: String(err && err.message || err) })
  }
})

// ---------------------------------------------------------------------------
// GET /api/kb/atoms/pending —— 审核队列（§7.3 排序：冲突优先 → 高潜力 → 近期 → 低置信）
// ---------------------------------------------------------------------------
routerAdd("GET", "/api/kb/atoms/pending", function (e) {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { ok: false, error: "login_required", message: "请先登录" })
    var q = e.request.url.query() || {}
    var limit = Math.min(Number(q.limit || 50) || 50, 200)
    var track = String(q.track || "")
    var onlyConflict = q.conflict === "1"
    var maxConf = Number(q.maxConfidence || 0)

    // 只查待审（含低置信强制 pending），排序在内存里做（Goja 不支持复杂 SQL 排序）
    var filter = 'content_status = "pending"'
    if (track) filter += ' && kb_track = {:track}'
    if (onlyConflict) filter += ' && conflict_group != ""'
    var params = track ? { track: track } : {}
    var recs = []
    try {
      recs = $app.findRecordsByFilter("kb_atoms", filter, "-created", 500, 0, params)
    } catch (_) {
      recs = []
    }

    var items = []
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i]
      var conf = Number(r.get("confidence") || 0)
      if (maxConf > 0 && conf > maxConf) continue
      items.push({
        id: String(r.get("id") || ""),
        atom_type: String(r.get("atom_type") || ""),
        title: String(r.get("title") || ""),
        body: String(r.get("body") || ""),
        subject_key: String(r.get("subject_key") || ""),
        confidence: conf,
        kb_track: String(r.get("kb_track") || ""),
        kb_bucket: String(r.get("kb_bucket") || ""),
        usable_for: r.get("usable_for") || [],
        source_doc_id: String(r.get("source_doc_id") || ""),
        source_anchor: String(r.get("source_anchor") || ""),
        source_quote: String(r.get("source_quote") || ""),
        conflict_group: String(r.get("conflict_group") || ""),
        valid_until: String(r.get("valid_until") || ""),
      })
    }

    // §7.3 默认排序：冲突组优先 → 高 usage 潜力（case/metric）→ 低置信最后
    function rank(it) {
      var s = 0
      if (it.conflict_group) s += 1000
      if (it.atom_type === "case" || it.atom_type === "metric") s += 100
      if (it.atom_type === "qualification" || it.atom_type === "policy") s += 50
      return s
    }
    items.sort(function (a, b) {
      var d = rank(b) - rank(a)
      if (d !== 0) return d
      return b.confidence - a.confidence
    })

    return e.json(200, { ok: true, total: items.length, items: items.slice(0, limit) })
  } catch (err) {
    return e.json(500, { ok: false, error: "pending_failed", message: String(err && err.message || err) })
  }
})

// ---------------------------------------------------------------------------
// POST /api/kb/atoms —— 批量创建原子（抽取服务写入入口，§12.1）
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/kb/atoms", function (e) {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { ok: false, error: "login_required", message: "请先登录" })
    var body = e.requestInfo().body || {}
    var list = Array.isArray(body.atoms) ? body.atoms : []
    if (!list.length) return e.json(400, { ok: false, error: "atoms_required", message: "atoms 不能为空" })
    if (list.length > 200) return e.json(400, { ok: false, error: "too_many", message: "单次最多 200 条" })

    var col = $app.findCollectionByNameOrId("kb_atoms")
    var created = 0
    var skipped = 0
    for (var i = 0; i < list.length; i++) {
      var a = list[i] || {}
      // 最小校验：类型/标题/主题键/来源必填（Schema 层已在服务端做正则校验，这里只做存在性）
      if (!a.atom_type || !a.title || !a.subject_key || !a.source_doc_id) {
        skipped++
        continue
      }
      try {
        var rec = new Record(col)
        rec.set("atom_type", String(a.atom_type))
        rec.set("title", String(a.title).slice(0, 80))
        rec.set("body", String(a.body || "").slice(0, 1200))
        rec.set("subject_key", String(a.subject_key).slice(0, 120))
        if (a.attributes) rec.set("attributes", a.attributes)
        rec.set("kb_track", String(a.kb_track || ""))
        rec.set("kb_bucket", String(a.kb_bucket || ""))
        rec.set("kb_section", String(a.kb_section || ""))
        rec.set("usable_for", Array.isArray(a.usable_for) ? a.usable_for : [])
        // 低置信强制 pending（§4.2：<0.55 强制进 pending）
        var conf = Number(a.confidence || 0)
        rec.set("confidence", conf)
        rec.set("content_status", conf > 0 && conf < 0.55 ? "pending" : String(a.content_status || "pending"))
        rec.set("source_doc_id", String(a.source_doc_id))
        rec.set("source_anchor", String(a.source_anchor || ""))
        rec.set("source_quote", String(a.source_quote || "").slice(0, 600))
        if (a.valid_from) rec.set("valid_from", String(a.valid_from))
        if (a.valid_until) rec.set("valid_until", String(a.valid_until))
        rec.set("confidentiality", String(a.confidentiality || "internal"))
        rec.set("owner", String(a.owner || uid))
        rec.set("version", Number(a.version || 1))
        rec.set("usage_count", 0)
        rec.set("rh_user_id", uid)
        $app.save(rec)
        created++
      } catch (_) {
        skipped++
      }
    }

    // 回填 kb_docs.atom_count（列表页展示用，§4.1 冗余字段）
    try {
      var docId = String(body.source_doc_id || (list[0] && list[0].source_doc_id) || "")
      if (docId) {
        var doc = $app.findRecordById("kb_docs", docId)
        var cnt = $app.countRecords("kb_atoms", $dbx.hashExp({ source_doc_id: docId }))
        doc.set("atom_count", cnt)
        doc.set("extract_at", new Date().toISOString())
        doc.set("ingest_status", "extracted")
        $app.save(doc)
      }
    } catch (_) {}

    return e.json(200, { ok: true, created: created, skipped: skipped })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("kb atoms create: " + msg) } catch (_) {}
    return e.json(500, { ok: false, error: "create_failed", message: msg })
  }
})

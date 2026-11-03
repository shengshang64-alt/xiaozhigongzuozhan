// model_gateway.pb.js — 模型配置管理 + 统一模型网关（自定义代理路由，手写）
// 安全约定：
//  - 身份只认 vibex 网关注入的 X-Rh-User-Id，缺失一律 401
//  - api_key 以 XOR-hex 混淆存储，任何响应只回脱敏形式（sk-***后4位），日志绝不打印明文
//  - 所有 helper/常量 self-contained 在每个 routerAdd 回调内部（Goja 并发安全）
//  - 5xx 一律 { error, message, fingerprint } 三字段

// ---------------------------------------------------------------------------
// GET /api/model-gw/configs — 当前用户配置列表（api_key 脱敏）
// ---------------------------------------------------------------------------
routerAdd("GET", "/api/model-gw/configs", (e) => {
  try {
    var norm = function (s) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, "").trim() }
    var userId = norm(String(e.get("rhUserId") || ""))
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再管理模型配置" })
    var fingerprint = function (where) { return "mgw-" + where + "-" + new Date().getTime().toString(36) + "-" + Math.floor(Math.random() * 1000000).toString(36) }
    var SECRET = "mgw-app-d61cf9ef4f3a43a9ac231816a7e5d501"
    var unxorHex = function (hx) {
      var out = ""
      for (var i = 0; i + 1 < String(hx).length; i += 2) {
        var c = parseInt(String(hx).substr(i, 2), 16)
        if (isNaN(c)) return ""
        out += String.fromCharCode(c ^ SECRET.charCodeAt((i / 2) % SECRET.length))
      }
      return out
    }
    var maskKey = function (plain) {
      if (!plain) return ""
      if (String(plain).length <= 4) return "****"
      return "sk-***" + String(plain).slice(-4)
    }
    var pub = function (rec) {
      var m = []
      try { var rawM = rec.getString("models"); if (rawM) { var pm = JSON.parse(rawM); if (pm && typeof pm.length === "number") m = pm } } catch (err) { m = [] }
      var plain = rec.get("api_key") ? unxorHex(rec.get("api_key")) : ""
      return {
        id: rec.id,
        config_name: String(rec.get("config_name") || ""),
        base_url: String(rec.get("base_url") || ""),
        api_key_masked: maskKey(plain),
        has_key: !!plain,
        models: m || [],
        default_model: String(rec.get("default_model") || ""),
        is_platform: !!rec.get("is_platform"),
        last_check_status: String(rec.get("last_check_status") || ""),
        last_check_error: String(rec.get("last_check_error") || ""),
        last_checked_at: String(rec.get("last_checked_at") || ""),
        created: String(rec.get("created") || ""),
        updated: String(rec.get("updated") || "")
      }
    }
    // 平台内置配置行惰性创建（全系统默认兜底）
    var platform = null
    try { platform = $app.findFirstRecordByFilter("model_configs", "rh_user_id={:u} && is_platform=true", { u: userId }) } catch (err) { platform = null }
    if (!platform) {
      var coll = $app.findCollectionByNameOrId("model_configs")
      platform = new Record(coll)
      platform.set("rh_user_id", userId)
      platform.set("config_name", "平台内置")
      platform.set("base_url", "platform://builtin")
      platform.set("api_key", "")
      platform.set("models", [{ id: "gpt-5.5", enabled: true }])
      platform.set("default_model", "gpt-5.5")
      platform.set("is_platform", true)
      platform.set("last_check_status", "ok")
      $app.save(platform)
    }
    var rows = $app.findRecordsByFilter("model_configs", "rh_user_id={:u} && is_platform=false", "-created", 100, 0, { u: userId })
    var items = [pub(platform)]
    for (var i = 0; i < rows.length; i++) items.push(pub(rows[i]))
    return e.json(200, { ok: true, items: items })
  } catch (ex) {
    $app.logger().error("model-gw configs list failed", "err", String(ex))
    return e.json(500, { error: "model_gateway_error", message: "读取模型配置失败，请稍后重试", fingerprint: "mgw-list-" + new Date().getTime().toString(36) })
  }
})

// ---------------------------------------------------------------------------
// POST /api/model-gw/configs — 新建配置（先连通性检测再落库）
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/model-gw/configs", (e) => {
  try {
    var norm = function (s) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, "").trim() }
    var userId = norm(String(e.get("rhUserId") || ""))
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再管理模型配置" })
    var SECRET = "mgw-app-d61cf9ef4f3a43a9ac231816a7e5d501"
    var xorHex = function (s) {
      var out = ""
      for (var i = 0; i < String(s).length; i++) {
        var c = (String(s).charCodeAt(i) ^ SECRET.charCodeAt(i % SECRET.length)) & 0xff
        out += ("0" + c.toString(16)).slice(-2)
      }
      return out
    }
    // R301：429 原文分类（与 chat / test / refresh-models 路由同口径，各自自包含以保 Goja 并发安全）
    var rateReason = function (raw) {
      var detail = ""
      var code = ""
      try {
        var dj = JSON.parse(typeof raw === "string" ? raw : "")
        if (dj) {
          if (dj.error) {
            if (dj.error.message) detail = String(dj.error.message)
            if (dj.error.code) code = String(dj.error.code)
          }
          if (!detail && dj.message) detail = String(dj.message)
          if (!code && dj.code) code = String(dj.code)
        }
      } catch (e) { detail = "" }
      if (!detail && typeof raw === "string" && raw) detail = raw.slice(0, 200)
      var hay = (code + " " + detail).toLowerCase()
      // R301 口径校准（实测原文坐实）：quota 必须由原文直接说「额度/账户」才能成立。
      // 原式含 exceed.{0,12}(limit|quota)，把实测的 "inference exceeds tpm/rpm limit"
      // （纯速率限制，退避 25s 即成功）误判成额度耗尽→误导用户去充值。
      // 去掉 exceed 泛匹配，改由 freq 族显式承接 tpm/rpm/exceeds 句式。
      var quota = /insufficient[_\s-]*(balance|quota|credit)|quota[_\s-]*(exhaust|exceed|limit)|exceed[a-z]*[_\s-]*(your[_\s-]*(current[_\s-]*)?)?(quota|billing|balance)|balance[_\s-]*(insufficient|exceed|not[_\s-]*enough)|billing|arrears|account[_\s-]*(expired|deactivated|suspended)|余额不足|额度不足|额度耗尽|配额耗尽|超出额度|欠费|账户已/.test(hay)
      var freq = /rate.?limit|too\s*many|qps|concurren|requests?\s+per|frequency|tpm|rpm|token[_\s-]*budget|exceed[a-z]*[_\s-]*(your[_\s-]*)?(token|tpm|rpm)|限流|频率|并发|过于?频繁|请求过多/.test(hay)
      return { kind: quota ? "quota" : (freq ? "freq" : "unknown"), code: code, detail: detail.slice(0, 200) }
    }
    var rateMessage = function (r) {
      if (r.kind === "quota") return "接口额度或余额不足（HTTP 429），请到该模型平台充值或提高配额后重试"
      if (r.kind === "freq") return "对方接口请求频率超限（HTTP 429），请稍后重试"
      return "对方接口限流或余额不足（HTTP 429），请稍后重试"
    }
    var fetchModels = function (baseUrl, apiKey) {
      var b = String(baseUrl).replace(/\/+$/, "")
      var urls = b.slice(-3) === "/v1" ? [b + "/models"] : [b + "/v1/models", b + "/models"]
      var sawNotFound = false
      for (var i = 0; i < urls.length; i++) {
        try {
          var res = $http.send({
            url: urls[i],
            method: "GET",
            headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
            timeout: 20
          })
          if (res.statusCode === 404) { sawNotFound = true; continue }
          if (res.statusCode === 401 || res.statusCode === 403) return { ok: false, message: "认证失败，请检查 API Key 是否有效" }
          if (res.statusCode === 429) {
            var rr = rateReason(res.raw)
            return { ok: false, code: "rate_limit", message: rateMessage(rr) }
          }
          if (res.statusCode >= 500) return { ok: false, message: "对方服务暂时不可用（HTTP " + res.statusCode + "），请稍后重试" }
          if (res.statusCode !== 200) return { ok: false, message: "接口返回异常（HTTP " + res.statusCode + "）" }
          var data = null
          try { data = JSON.parse(typeof res.raw === "string" ? res.raw : "") } catch (err2) { return { ok: false, message: "返回格式异常，不是有效的 OpenAI 兼容接口" } }
          var arr = data ? data.data : null
          if (!arr || typeof arr.length !== "number") return { ok: false, message: "返回格式异常，未找到模型列表字段" }
          var ids = []
          for (var j = 0; j < arr.length; j++) {
            var mid = norm(arr[j] ? arr[j].id : "")
            if (mid && ids.indexOf(mid) < 0) ids.push(mid)
          }
          if (!ids.length) return { ok: false, message: "该地址下没有可用模型" }
          return { ok: true, ids: ids }
        } catch (err) {
          var msg = String((err && err.message) || err || "")
          if (/timeout|deadline|Timeout/i.test(msg)) return { ok: false, message: "连接超时，请检查接口地址是否可访问" }
        }
      }
      if (sawNotFound) return { ok: false, message: "返回格式异常，该地址下未找到模型列表接口（/v1/models）" }
      return { ok: false, message: "接口地址无法连通，请检查地址是否正确" }
    }
    var body = e.requestInfo().body || {}
    var configName = norm(body.config_name).slice(0, 80)
    var baseUrl = norm(body.base_url).slice(0, 500)
    var apiKey = norm(body.api_key).slice(0, 500)
    if (!configName) return e.json(200, { ok: false, code: "bad_request", message: "请填写配置名称" })
    if (!/^https?:\/\//i.test(baseUrl)) return e.json(200, { ok: false, code: "bad_request", message: "接口地址必须以 http:// 或 https:// 开头" })
    if (!apiKey) return e.json(200, { ok: false, code: "bad_request", message: "请填写 API Key" })
    var dup = null
    try { dup = $app.findFirstRecordByFilter("model_configs", "rh_user_id={:u} && is_platform=false && config_name={:n}", { u: userId, n: configName }) } catch (err) { dup = null }
    if (dup) return e.json(200, { ok: false, code: "dup_name", message: "已存在同名配置，请换一个名称" })
    var check = fetchModels(baseUrl, apiKey)
    if (!check.ok) return e.json(200, { ok: false, code: "check_failed", message: check.message })
    var models = []
    for (var k = 0; k < check.ids.length; k++) models.push({ id: check.ids[k], enabled: false })
    var coll = $app.findCollectionByNameOrId("model_configs")
    var rec = new Record(coll)
    rec.set("rh_user_id", userId)
    rec.set("config_name", configName)
    rec.set("base_url", baseUrl)
    rec.set("api_key", xorHex(apiKey))
    rec.set("models", models)
    rec.set("default_model", "")
    rec.set("is_platform", false)
    // 2026-10-31 修复：原来创建配置时无条件写 last_check_status="ok"，
    // 但这只是"记录已创建"，并未验证 Key 是否有效。实测 5 个配置全部显示 ok，
    // 实际有 2 个 Key 已失效（402 余额不足 / 模型不可用）、1 个被 Cloudflare 拦。
    // 用户看到"ok"以为配好了，实际用不了——这是误导。
    // 改为 "unchecked"：只有真正调通 /api/model-gw/test 才算 ok / failed。
    rec.set("last_check_status", "unchecked")
    rec.set("last_check_error", "")
    rec.set("last_checked_at", "")
    $app.save(rec)
    $app.logger().info("model-gw config created", "user", userId, "config", rec.id, "models", models.length)
    return e.json(200, {
      ok: true,
      config: {
        id: rec.id, config_name: configName, base_url: baseUrl,
        api_key_masked: "sk-***" + apiKey.slice(-4), has_key: true,
        models: models, default_model: "", is_platform: false,
        last_check_status: "ok", last_check_error: "", last_checked_at: String(rec.get("last_checked_at") || ""),
        created: String(rec.get("created") || ""), updated: String(rec.get("updated") || "")
      }
    })
  } catch (ex) {
    $app.logger().error("model-gw create failed", "err", String(ex))
    return e.json(500, { error: "model_gateway_error", message: "保存模型配置失败，请稍后重试", fingerprint: "mgw-create-" + new Date().getTime().toString(36) })
  }
})

// ---------------------------------------------------------------------------
// PATCH /api/model-gw/configs/{id} — 编辑（Key 空 = 不改；改地址/Key 重拉模型；
// default_model 跨配置互斥）
// ---------------------------------------------------------------------------
routerAdd("PATCH", "/api/model-gw/configs/{id}", (e) => {
  try {
    var norm = function (s) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, "").trim() }
    var userId = norm(String(e.get("rhUserId") || ""))
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再管理模型配置" })
    var SECRET = "mgw-app-d61cf9ef4f3a43a9ac231816a7e5d501"
    // R301：429 原文分类（与 chat / test / refresh-models / POST configs 路由同口径，各自自包含以保 Goja 并发安全）
    var rateReason = function (raw) {
      var detail = ""
      var code = ""
      try {
        var dj = JSON.parse(typeof raw === "string" ? raw : "")
        if (dj) {
          if (dj.error) {
            if (dj.error.message) detail = String(dj.error.message)
            if (dj.error.code) code = String(dj.error.code)
          }
          if (!detail && dj.message) detail = String(dj.message)
          if (!code && dj.code) code = String(dj.code)
        }
      } catch (e) { detail = "" }
      if (!detail && typeof raw === "string" && raw) detail = raw.slice(0, 200)
      var hay = (code + " " + detail).toLowerCase()
      // R301 口径校准（实测原文坐实）：quota 必须由原文直接说「额度/账户」才能成立。
      // 原式含 exceed.{0,12}(limit|quota)，把实测的 "inference exceeds tpm/rpm limit"
      // （纯速率限制，退避 25s 即成功）误判成额度耗尽→误导用户去充值。
      // 去掉 exceed 泛匹配，改由 freq 族显式承接 tpm/rpm/exceeds 句式。
      var quota = /insufficient[_\s-]*(balance|quota|credit)|quota[_\s-]*(exhaust|exceed|limit)|exceed[a-z]*[_\s-]*(your[_\s-]*(current[_\s-]*)?)?(quota|billing|balance)|balance[_\s-]*(insufficient|exceed|not[_\s-]*enough)|billing|arrears|account[_\s-]*(expired|deactivated|suspended)|余额不足|额度不足|额度耗尽|配额耗尽|超出额度|欠费|账户已/.test(hay)
      var freq = /rate.?limit|too\s*many|qps|concurren|requests?\s+per|frequency|tpm|rpm|token[_\s-]*budget|exceed[a-z]*[_\s-]*(your[_\s-]*)?(token|tpm|rpm)|限流|频率|并发|过于?频繁|请求过多/.test(hay)
      return { kind: quota ? "quota" : (freq ? "freq" : "unknown"), code: code, detail: detail.slice(0, 200) }
    }
    var rateMessage = function (r) {
      if (r.kind === "quota") return "接口额度或余额不足（HTTP 429），请到该模型平台充值或提高配额后重试"
      if (r.kind === "freq") return "对方接口请求频率超限（HTTP 429），请稍后重试"
      return "对方接口限流或余额不足（HTTP 429），请稍后重试"
    }
    var xorHex = function (s) {
      var out = ""
      for (var i = 0; i < String(s).length; i++) {
        var c = (String(s).charCodeAt(i) ^ SECRET.charCodeAt(i % SECRET.length)) & 0xff
        out += ("0" + c.toString(16)).slice(-2)
      }
      return out
    }
    var unxorHex = function (hx) {
      var out = ""
      for (var i = 0; i + 1 < String(hx).length; i += 2) {
        var c = parseInt(String(hx).substr(i, 2), 16)
        if (isNaN(c)) return ""
        out += String.fromCharCode(c ^ SECRET.charCodeAt((i / 2) % SECRET.length))
      }
      return out
    }
    var maskKey = function (plain) {
      if (!plain) return ""
      if (String(plain).length <= 4) return "****"
      return "sk-***" + String(plain).slice(-4)
    }
    var pub = function (rec) {
      var m = []
      try { var rawM = rec.getString("models"); if (rawM) { var pm = JSON.parse(rawM); if (pm && typeof pm.length === "number") m = pm } } catch (err) { m = [] }
      var plain = rec.get("api_key") ? unxorHex(rec.get("api_key")) : ""
      return {
        id: rec.id,
        config_name: String(rec.get("config_name") || ""),
        base_url: String(rec.get("base_url") || ""),
        api_key_masked: maskKey(plain),
        has_key: !!plain,
        models: m || [],
        default_model: String(rec.get("default_model") || ""),
        is_platform: !!rec.get("is_platform"),
        last_check_status: String(rec.get("last_check_status") || ""),
        last_check_error: String(rec.get("last_check_error") || ""),
        last_checked_at: String(rec.get("last_checked_at") || ""),
        created: String(rec.get("created") || ""),
        updated: String(rec.get("updated") || "")
      }
    }
    var fetchModels = function (baseUrl, apiKey) {
      var b = String(baseUrl).replace(/\/+$/, "")
      var urls = b.slice(-3) === "/v1" ? [b + "/models"] : [b + "/v1/models", b + "/models"]
      var sawNotFound = false
      for (var i = 0; i < urls.length; i++) {
        try {
          var res = $http.send({
            url: urls[i],
            method: "GET",
            headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
            timeout: 20
          })
          if (res.statusCode === 404) { sawNotFound = true; continue }
          if (res.statusCode === 401 || res.statusCode === 403) return { ok: false, message: "认证失败，请检查 API Key 是否有效" }
          if (res.statusCode === 429) {
            var rr = rateReason(res.raw)
            return { ok: false, code: "rate_limit", message: rateMessage(rr) }
          }
          if (res.statusCode >= 500) return { ok: false, message: "对方服务暂时不可用（HTTP " + res.statusCode + "），请稍后重试" }
          if (res.statusCode !== 200) return { ok: false, message: "接口返回异常（HTTP " + res.statusCode + "）" }
          var data = null
          try { data = JSON.parse(typeof res.raw === "string" ? res.raw : "") } catch (err2) { return { ok: false, message: "返回格式异常，不是有效的 OpenAI 兼容接口" } }
          var arr = data ? data.data : null
          if (!arr || typeof arr.length !== "number") return { ok: false, message: "返回格式异常，未找到模型列表字段" }
          var ids = []
          for (var j = 0; j < arr.length; j++) {
            var mid = norm(arr[j] ? arr[j].id : "")
            if (mid && ids.indexOf(mid) < 0) ids.push(mid)
          }
          if (!ids.length) return { ok: false, message: "该地址下没有可用模型" }
          return { ok: true, ids: ids }
        } catch (err) {
          var msg = String((err && err.message) || err || "")
          if (/timeout|deadline|Timeout/i.test(msg)) return { ok: false, message: "连接超时，请检查接口地址是否可访问" }
        }
      }
      if (sawNotFound) return { ok: false, message: "返回格式异常，该地址下未找到模型列表接口（/v1/models）" }
      return { ok: false, message: "接口地址无法连通，请检查地址是否正确" }
    }
    var id = norm(e.request.pathValue("id"))
    var rec = null
    try { rec = $app.findRecordById("model_configs", id) } catch (err) { rec = null }
    if (!rec || String(rec.get("rh_user_id")) !== userId) return e.json(404, { ok: false, code: "not_found", message: "配置不存在或无权访问" })
    var body = e.requestInfo().body || {}
    var isPlatform = !!rec.get("is_platform")
    var stored = []
    try { var rawS = rec.getString("models"); if (rawS) { var ps = JSON.parse(rawS); if (ps && typeof ps.length === "number") stored = ps } } catch (err3) { stored = [] }

    if (isPlatform) {
      // 平台行只允许启停内置模型与设默认
      if (body.models && typeof body.models.length === "number") {
        var want = {}
        for (var a = 0; a < body.models.length; a++) {
          if (body.models[a] && body.models[a].id) want[norm(body.models[a].id)] = body.models[a].enabled !== false
        }
        var mergedP = []
        for (var b1 = 0; b1 < stored.length; b1++) {
          var sid = String(stored[b1] && stored[b1].id ? stored[b1].id : "")
          if (!sid) continue
          mergedP.push({ id: sid, enabled: Object.prototype.hasOwnProperty.call(want, sid) ? !!want[sid] : !!stored[b1].enabled })
        }
        stored = mergedP
        rec.set("models", stored)
      }
    } else {
      var newName = norm(body.config_name).slice(0, 80)
      if (newName) rec.set("config_name", newName)
      var newBase = norm(body.base_url).slice(0, 500)
      var newKey = norm(body.api_key).slice(0, 500)
      var effBase = newBase ? newBase : String(rec.get("base_url") || "")
      var needCheck = (!!newBase && newBase !== String(rec.get("base_url") || "")) || !!newKey
      if (needCheck) {
        if (newBase && !/^https?:\/\//i.test(newBase)) return e.json(200, { ok: false, code: "bad_request", message: "接口地址必须以 http:// 或 https:// 开头" })
        var effKeyPlain = newKey ? newKey : (rec.get("api_key") ? unxorHex(rec.get("api_key")) : "")
        if (!effKeyPlain) return e.json(200, { ok: false, code: "bad_request", message: "请填写 API Key" })
        var check = fetchModels(effBase, effKeyPlain)
        if (!check.ok) {
          rec.set("last_check_status", "error")
          rec.set("last_check_error", check.message.slice(0, 500))
          rec.set("last_checked_at", new Date().toISOString())
          $app.save(rec)
          return e.json(200, { ok: false, code: "check_failed", message: check.message, config: pub(rec) })
        }
        var enabledMap = {}
        for (var c1 = 0; c1 < stored.length; c1++) {
          if (stored[c1] && stored[c1].id) enabledMap[String(stored[c1].id)] = !!stored[c1].enabled
        }
        var merged = []
        for (var d1 = 0; d1 < check.ids.length; d1++) {
          merged.push({ id: check.ids[d1], enabled: Object.prototype.hasOwnProperty.call(enabledMap, check.ids[d1]) ? enabledMap[check.ids[d1]] : false })
        }
        stored = merged
        rec.set("models", stored)
        rec.set("base_url", effBase)
        if (newKey) rec.set("api_key", xorHex(newKey))
        rec.set("last_check_status", "ok")
        rec.set("last_check_error", "")
        rec.set("last_checked_at", new Date().toISOString())
      } else if (body.models && typeof body.models.length === "number") {
        var want2 = {}
        for (var f = 0; f < body.models.length; f++) {
          if (body.models[f] && body.models[f].id) want2[norm(body.models[f].id)] = body.models[f].enabled !== false
        }
        var merged2 = []
        for (var g = 0; g < stored.length; g++) {
          var sid2 = String(stored[g] && stored[g].id ? stored[g].id : "")
          if (!sid2) continue
          merged2.push({ id: sid2, enabled: Object.prototype.hasOwnProperty.call(want2, sid2) ? !!want2[sid2] : !!stored[g].enabled })
        }
        stored = merged2
        rec.set("models", stored)
      }
    }

    // 设为默认（全局唯一，跨配置互斥）
    var newDefault = norm(body.default_model).slice(0, 200)
    if (newDefault) {
      var found = false
      for (var m1 = 0; m1 < stored.length; m1++) {
        if (String(stored[m1] && stored[m1].id ? stored[m1].id : "") === newDefault) {
          found = true
          stored[m1] = { id: newDefault, enabled: true }
        }
      }
      if (!found) return e.json(200, { ok: false, code: "model_not_found", message: "该配置下不存在这个模型，请先刷新模型列表" })
      rec.set("models", stored)
      rec.set("default_model", newDefault)
      var others = $app.findRecordsByFilter("model_configs", "rh_user_id={:u}", "-created", 200, 0, { u: userId })
      for (var o = 0; o < others.length; o++) {
        if (others[o].id !== rec.id && String(others[o].get("default_model") || "") !== "") {
          others[o].set("default_model", "")
          $app.save(others[o])
        }
      }
    }
    if (body.clear_default === true && String(rec.get("default_model") || "") !== "") {
      rec.set("default_model", "")
      $app.save(rec)
      // 无任何默认时回退平台内置
      var anyDefault = null
      try { anyDefault = $app.findFirstRecordByFilter("model_configs", "rh_user_id={:u} && default_model!=''", { u: userId }) } catch (err4) { anyDefault = null }
      if (!anyDefault) {
        var prow = null
        try { prow = $app.findFirstRecordByFilter("model_configs", "rh_user_id={:u} && is_platform=true", { u: userId }) } catch (err5) { prow = null }
        if (prow) { prow.set("default_model", "gpt-5.5"); $app.save(prow) }
      }
    }
    $app.save(rec)
    return e.json(200, { ok: true, config: pub(rec) })
  } catch (ex) {
    $app.logger().error("model-gw update failed", "err", String(ex))
    return e.json(500, { error: "model_gateway_error", message: "更新模型配置失败，请稍后重试", fingerprint: "mgw-patch-" + new Date().getTime().toString(36) })
  }
})

// ---------------------------------------------------------------------------
// DELETE /api/model-gw/configs/{id} — 删除（校验归属；默认被删自动回退平台）
// ---------------------------------------------------------------------------
routerAdd("DELETE", "/api/model-gw/configs/{id}", (e) => {
  try {
    var norm = function (s) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, "").trim() }
    var userId = norm(String(e.get("rhUserId") || ""))
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再管理模型配置" })
    var id = norm(e.request.pathValue("id"))
    var rec = null
    try { rec = $app.findRecordById("model_configs", id) } catch (err) { rec = null }
    if (!rec || String(rec.get("rh_user_id")) !== userId) return e.json(404, { ok: false, code: "not_found", message: "配置不存在或无权访问" })
    if (rec.get("is_platform")) return e.json(200, { ok: false, code: "PLATFORM_PROTECTED", message: "平台内置配置不可删除，可以将其停用" })
    var hadDefault = String(rec.get("default_model") || "") !== ""
    $app.delete(rec)
    if (hadDefault) {
      var prow = null
      try { prow = $app.findFirstRecordByFilter("model_configs", "rh_user_id={:u} && is_platform=true", { u: userId }) } catch (err2) { prow = null }
      if (prow && String(prow.get("default_model") || "") === "") {
        prow.set("default_model", "gpt-5.5")
        $app.save(prow)
      }
    }
    $app.logger().info("model-gw config deleted", "user", userId, "config", id)
    return e.json(200, { ok: true })
  } catch (ex) {
    $app.logger().error("model-gw delete failed", "err", String(ex))
    return e.json(500, { error: "model_gateway_error", message: "删除模型配置失败，请稍后重试", fingerprint: "mgw-del-" + new Date().getTime().toString(36) })
  }
})

// ---------------------------------------------------------------------------
// POST /api/model-gw/configs/{id}/refresh-models — 重拉模型列表
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/model-gw/configs/{id}/refresh-models", (e) => {
  try {
    var norm = function (s) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, "").trim() }
    var userId = norm(String(e.get("rhUserId") || ""))
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再管理模型配置" })
    var SECRET = "mgw-app-d61cf9ef4f3a43a9ac231816a7e5d501"
    var unxorHex = function (hx) {
      var out = ""
      for (var i = 0; i + 1 < String(hx).length; i += 2) {
        var c = parseInt(String(hx).substr(i, 2), 16)
        if (isNaN(c)) return ""
        out += String.fromCharCode(c ^ SECRET.charCodeAt((i / 2) % SECRET.length))
      }
      return out
    }
    var maskKey = function (plain) {
      if (!plain) return ""
      if (String(plain).length <= 4) return "****"
      return "sk-***" + String(plain).slice(-4)
    }
    // R301：429 原文分类（与 chat / test 路由同口径，各自自包含以保 Goja 并发安全）
    var rateReason = function (raw) {
      var detail = ""
      var code = ""
      try {
        var dj = JSON.parse(typeof raw === "string" ? raw : "")
        if (dj) {
          if (dj.error) {
            if (dj.error.message) detail = String(dj.error.message)
            if (dj.error.code) code = String(dj.error.code)
          }
          if (!detail && dj.message) detail = String(dj.message)
          if (!code && dj.code) code = String(dj.code)
        }
      } catch (e) { detail = "" }
      if (!detail && typeof raw === "string" && raw) detail = raw.slice(0, 200)
      var hay = (code + " " + detail).toLowerCase()
      // R301 口径校准（实测原文坐实）：quota 必须由原文直接说「额度/账户」才能成立。
      // 原式含 exceed.{0,12}(limit|quota)，把实测的 "inference exceeds tpm/rpm limit"
      // （纯速率限制，退避 25s 即成功）误判成额度耗尽→误导用户去充值。
      // 去掉 exceed 泛匹配，改由 freq 族显式承接 tpm/rpm/exceeds 句式。
      var quota = /insufficient[_\s-]*(balance|quota|credit)|quota[_\s-]*(exhaust|exceed|limit)|exceed[a-z]*[_\s-]*(your[_\s-]*(current[_\s-]*)?)?(quota|billing|balance)|balance[_\s-]*(insufficient|exceed|not[_\s-]*enough)|billing|arrears|account[_\s-]*(expired|deactivated|suspended)|余额不足|额度不足|额度耗尽|配额耗尽|超出额度|欠费|账户已/.test(hay)
      var freq = /rate.?limit|too\s*many|qps|concurren|requests?\s+per|frequency|tpm|rpm|token[_\s-]*budget|exceed[a-z]*[_\s-]*(your[_\s-]*)?(token|tpm|rpm)|限流|频率|并发|过于?频繁|请求过多/.test(hay)
      return { kind: quota ? "quota" : (freq ? "freq" : "unknown"), code: code, detail: detail.slice(0, 200) }
    }
    var rateMessage = function (r) {
      if (r.kind === "quota") return "接口额度或余额不足（HTTP 429），请到该模型平台充值或提高配额后重试"
      if (r.kind === "freq") return "对方接口请求频率超限（HTTP 429），请稍后重试"
      return "对方接口限流或余额不足（HTTP 429），请稍后重试"
    }
    var pub = function (rec, models) {
      var plain = rec.get("api_key") ? unxorHex(rec.get("api_key")) : ""
      return {
        id: rec.id,
        config_name: String(rec.get("config_name") || ""),
        base_url: String(rec.get("base_url") || ""),
        api_key_masked: maskKey(plain),
        has_key: !!plain,
        models: models,
        default_model: String(rec.get("default_model") || ""),
        is_platform: !!rec.get("is_platform"),
        last_check_status: String(rec.get("last_check_status") || ""),
        last_check_error: String(rec.get("last_check_error") || ""),
        last_checked_at: String(rec.get("last_checked_at") || ""),
        created: String(rec.get("created") || ""),
        updated: String(rec.get("updated") || "")
      }
    }
    var id = norm(e.request.pathValue("id"))
    var rec = null
    try { rec = $app.findRecordById("model_configs", id) } catch (err) { rec = null }
    if (!rec || String(rec.get("rh_user_id")) !== userId) return e.json(404, { ok: false, code: "not_found", message: "配置不存在或无权访问" })
    var stored = []
    try { var rawS = rec.getString("models"); if (rawS) { var ps = JSON.parse(rawS); if (ps && typeof ps.length === "number") stored = ps } } catch (err3) { stored = [] }
    if (rec.get("is_platform")) {
      rec.set("last_check_status", "ok")
      rec.set("last_check_error", "")
      rec.set("last_checked_at", new Date().toISOString())
      $app.save(rec)
      return e.json(200, { ok: true, config: pub(rec, stored) })
    }
    var plainKey = rec.get("api_key") ? unxorHex(rec.get("api_key")) : ""
    if (!plainKey) {
      rec.set("last_check_status", "error")
      rec.set("last_check_error", "缺少 API Key，请先编辑配置补填")
      rec.set("last_checked_at", new Date().toISOString())
      $app.save(rec)
      return e.json(200, { ok: false, code: "check_failed", message: "缺少 API Key，请先编辑配置补填", config: pub(rec, stored) })
    }
    var b = String(rec.get("base_url") || "").replace(/\/+$/, "")
    var urls = b.slice(-3) === "/v1" ? [b + "/models"] : [b + "/v1/models", b + "/models"]
    var result = null
    var sawNotFound = false
    for (var i = 0; i < urls.length && !result; i++) {
      try {
        var res = $http.send({
          url: urls[i],
          method: "GET",
          headers: { "Authorization": "Bearer " + plainKey, "Content-Type": "application/json" },
          timeout: 20
        })
        if (res.statusCode === 404) { sawNotFound = true; continue }
        if (res.statusCode === 401 || res.statusCode === 403) { result = { ok: false, message: "认证失败，请检查 API Key 是否有效" }; break }
        if (res.statusCode === 429) {
          var rr = rateReason(res.raw)
          try { $app.logger().warn("model-gw refresh-models upstream 429", "config", id, "kind", rr.kind, "code", rr.code, "detail", rr.detail) } catch (lg) {}
          result = { ok: false, code: "rate_limit", message: rateMessage(rr) }
          break
        }
        if (res.statusCode >= 500) { result = { ok: false, message: "对方服务暂时不可用（HTTP " + res.statusCode + "），请稍后重试" }; break }
        if (res.statusCode !== 200) { result = { ok: false, message: "接口返回异常（HTTP " + res.statusCode + "）" }; break }
        var data = null
        try { data = JSON.parse(typeof res.raw === "string" ? res.raw : "") } catch (err2) { result = { ok: false, message: "返回格式异常，不是有效的 OpenAI 兼容接口" }; break }
        var arr = data ? data.data : null
        if (!arr || typeof arr.length !== "number") { result = { ok: false, message: "返回格式异常，未找到模型列表字段" }; break }
        var ids = []
        for (var j = 0; j < arr.length; j++) {
          var mid = norm(arr[j] ? arr[j].id : "")
          if (mid && ids.indexOf(mid) < 0) ids.push(mid)
        }
        if (!ids.length) { result = { ok: false, message: "该地址下没有可用模型" }; break }
        result = { ok: true, ids: ids }
      } catch (err4) {
        var msg = String((err4 && err4.message) || err4 || "")
        if (/timeout|deadline|Timeout/i.test(msg)) { result = { ok: false, message: "连接超时，请检查接口地址是否可访问" }; break }
      }
    }
    if (!result) result = sawNotFound
      ? { ok: false, message: "返回格式异常，该地址下未找到模型列表接口（/v1/models）" }
      : { ok: false, message: "接口地址无法连通，请检查地址是否正确" }
    rec.set("last_checked_at", new Date().toISOString())
    if (!result.ok) {
      rec.set("last_check_status", "error")
      rec.set("last_check_error", result.message.slice(0, 500))
      $app.save(rec)
      return e.json(200, { ok: false, code: "check_failed", message: result.message, config: pub(rec, stored) })
    }
    var enabledMap = {}
    for (var c1 = 0; c1 < stored.length; c1++) {
      if (stored[c1] && stored[c1].id) enabledMap[String(stored[c1].id)] = !!stored[c1].enabled
    }
    var merged = []
    for (var d1 = 0; d1 < result.ids.length; d1++) {
      merged.push({ id: result.ids[d1], enabled: Object.prototype.hasOwnProperty.call(enabledMap, result.ids[d1]) ? enabledMap[result.ids[d1]] : false })
    }
    rec.set("models", merged)
    // 默认模型若已不在新列表中，清掉并回退平台
    var dm = String(rec.get("default_model") || "")
    if (dm && result.ids.indexOf(dm) < 0) {
      rec.set("default_model", "")
      var prow = null
      try { prow = $app.findFirstRecordByFilter("model_configs", "rh_user_id={:u} && is_platform=true", { u: userId }) } catch (err5) { prow = null }
      if (prow && String(prow.get("default_model") || "") === "") { prow.set("default_model", "gpt-5.5"); $app.save(prow) }
    }
    rec.set("last_check_status", "ok")
    rec.set("last_check_error", "")
    $app.save(rec)
    return e.json(200, { ok: true, config: pub(rec, merged) })
  } catch (ex) {
    $app.logger().error("model-gw refresh failed", "err", String(ex))
    return e.json(500, { error: "model_gateway_error", message: "刷新模型列表失败，请稍后重试", fingerprint: "mgw-refresh-" + new Date().getTime().toString(36) })
  }
})

// ---------------------------------------------------------------------------
// POST /api/model-gw/test — 固定测试消息（OpenAI 兼容 /chat/completions）
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/model-gw/test", (e) => {
  try {
    var norm = function (s) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, "").trim() }
    var userId = norm(String(e.get("rhUserId") || ""))
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再管理模型配置" })
    var SECRET = "mgw-app-d61cf9ef4f3a43a9ac231816a7e5d501"
    var unxorHex = function (hx) {
      var out = ""
      for (var i = 0; i + 1 < String(hx).length; i += 2) {
        var c = parseInt(String(hx).substr(i, 2), 16)
        if (isNaN(c)) return ""
        out += String.fromCharCode(c ^ SECRET.charCodeAt((i / 2) % SECRET.length))
      }
      return out
    }
    // 测试链路同样受「推理模型吃满预算 → content 空」影响（测试消息固定 200 token 预算，
    // 推理模型几乎必空）。与 chat 路由同构修复：读 reasoning_content 兜底 + 判定预算耗尽后升预算重试。
    var TEST_MIN_RETRY_TOKENS = 1024
    var TEST_RETRY_FACTOR = 4
    var TEST_MAX_TOKENS = 16384
    // R301：429 原文分类（与 chat 路由同口径，各自自包含以保Goja 并发安全）
    var rateReason = function (raw) {
      var detail = ""
      var code = ""
      try {
        var dj = JSON.parse(typeof raw === "string" ? raw : "")
        if (dj) {
          if (dj.error) {
            if (dj.error.message) detail = String(dj.error.message)
            if (dj.error.code) code = String(dj.error.code)
          }
          if (!detail && dj.message) detail = String(dj.message)
          if (!code && dj.code) code = String(dj.code)
        }
      } catch (e) { detail = "" }
      if (!detail && typeof raw === "string" && raw) detail = raw.slice(0, 200)
      var hay = (code + " " + detail).toLowerCase()
      // R301 口径校准（实测原文坐实）：quota 必须由原文直接说「额度/账户」才能成立。
      // 原式含 exceed.{0,12}(limit|quota)，把实测的 "inference exceeds tpm/rpm limit"
      // （纯速率限制，退避 25s 即成功）误判成额度耗尽→误导用户去充值。
      // 去掉 exceed 泛匹配，改由 freq 族显式承接 tpm/rpm/exceeds 句式。
      var quota = /insufficient[_\s-]*(balance|quota|credit)|quota[_\s-]*(exhaust|exceed|limit)|exceed[a-z]*[_\s-]*(your[_\s-]*(current[_\s-]*)?)?(quota|billing|balance)|balance[_\s-]*(insufficient|exceed|not[_\s-]*enough)|billing|arrears|account[_\s-]*(expired|deactivated|suspended)|余额不足|额度不足|额度耗尽|配额耗尽|超出额度|欠费|账户已/.test(hay)
      var freq = /rate.?limit|too\s*many|qps|concurren|requests?\s+per|frequency|tpm|rpm|token[_\s-]*budget|exceed[a-z]*[_\s-]*(your[_\s-]*)?(token|tpm|rpm)|限流|频率|并发|过于?频繁|请求过多/.test(hay)
      return { kind: quota ? "quota" : (freq ? "freq" : "unknown"), code: code, detail: detail.slice(0, 200) }
    }
    var rateMessage = function (r) {
      if (r.kind === "quota") return "接口额度或余额不足（HTTP 429），请到该模型平台充值或提高配额后重试"
      if (r.kind === "freq") return "对方接口请求频率超限（HTTP 429），请稍后重试"
      return "对方接口限流或余额不足（HTTP 429），请稍后重试"
    }
    var testChatOnce = function (baseUrl, apiKey, model, messages, maxTokens, timeoutSec) {
      var b = String(baseUrl).replace(/\/+$/, "")
      var urls = [b + "/chat/completions", b + "/v1/chat/completions"]
      var started = new Date().getTime()
      var lastStatus = 0
      // R39：与 chatOnce 同口径——「测试连通性」也要真测一次对话，
      // 否则 opencode.ai 这类「/models 通、chat 400」的通道会被标成健康可用（本次事故根因之一）。
      var hdrs = { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" }
      if (/opencode\.ai/i.test(b)) {
        hdrs["x-opencode-session"] = "xiaozhi-bid-" + String(model || "go").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40)
        hdrs["User-Agent"] = "xiaozhi-presales-desk/1.0"
      }
      for (var i = 0; i < urls.length; i++) {
        try {
          var res = $http.send({
            url: urls[i],
            method: "POST",
            headers: hdrs,
            body: JSON.stringify({ model: model, messages: messages, stream: false, max_tokens: maxTokens }),
            timeout: timeoutSec
          })
          lastStatus = res.statusCode
          if (res.statusCode === 404 && i === 0) continue
          var elapsed = new Date().getTime() - started
          if (res.statusCode === 401 || res.statusCode === 403) return { ok: false, message: "认证失败，请检查 API Key 是否有效" }
          if (res.statusCode === 429) {
            var rr = rateReason(res.raw)
            try { $app.logger().warn("model-gw test upstream 429", "model", model, "kind", rr.kind, "code", rr.code, "detail", rr.detail) } catch (lg) {}
            return { ok: false, code: "rate_limit", message: rateMessage(rr) }
          }
          if (res.statusCode >= 500) return { ok: false, message: "对方服务暂时不可用（HTTP " + res.statusCode + "），请稍后重试" }
          if (res.statusCode !== 200) {
            var detail = ""
            try { var dj = JSON.parse(typeof res.raw === "string" ? res.raw : ""); if (dj && dj.error && dj.error.message) detail = String(dj.error.message).slice(0, 200) } catch (e2) { detail = "" }
            return { ok: false, message: "接口返回异常（HTTP " + res.statusCode + "）" + (detail ? "：" + detail : "") }
          }
          var data = null
          try { data = JSON.parse(typeof res.raw === "string" ? res.raw : "") } catch (e3) { return { ok: false, message: "返回格式异常，无法解析上游响应（对方可能返回了非 JSON 内容）" } }
          var choice = (data && data.choices && data.choices.length) ? data.choices[0] : null
          var msgObj = choice && choice.message ? choice.message : null
          var usage = (data && data.usage) ? data.usage : null
          var text = msgObj ? String(msgObj.content == null ? "" : msgObj.content) : ""
          if (!text && msgObj) {
            var rc = msgObj.reasoning_content != null ? msgObj.reasoning_content : msgObj.reasoning
            if (rc != null && String(rc) !== "") text = String(rc)
          }
          if (!text) {
            var reasoningUsed = usage && usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens
              ? Number(usage.completion_tokens_details.reasoning_tokens) : 0
            var truncated = String(choice && choice.finish_reason ? choice.finish_reason : "") === "length"
            if (reasoningUsed > 0 || truncated || (msgObj && (msgObj.reasoning_content != null || msgObj.reasoning != null))) {
              return {
                ok: false,
                retryReasoning: true,
                message: "推理型模型本次把输出预算全部消耗在思考阶段，未产出正文（已自动提升预算重试仍失败）。"
                  + "该模型可正常使用，但不适合短文本测试——请在模型配置页确认其输出上限，或改用非推理模型。"
              }
            }
            return { ok: false, message: "返回格式异常：上游响应中没有任何正文内容（content 与 reasoning_content 均为空），请检查该模型 ID 是否正确" }
          }
          return { ok: true, text: text, elapsed_ms: elapsed, usage: usage }
        } catch (err) {
          var msg = String((err && err.message) || err || "")
          if (/timeout|deadline|Timeout/i.test(msg)) return { ok: false, message: "请求超时，对方接口未在限定时间内返回" }
          if (i === urls.length - 1) return { ok: false, message: "接口地址无法连通，请检查配置" }
        }
      }
      return { ok: false, message: "接口返回异常（HTTP " + lastStatus + "）" }
    }
    var doChat = function (baseUrl, apiKey, model, messages, maxTokens, timeoutSec) {
      var first = testChatOnce(baseUrl, apiKey, model, messages, maxTokens, timeoutSec)
      if (first.ok || !first.retryReasoning) return first
      var escalated = Math.min(TEST_MAX_TOKENS, Math.max(maxTokens * TEST_RETRY_FACTOR, TEST_MIN_RETRY_TOKENS))
      if (escalated <= maxTokens) return first
      $app.logger().warn("model-gw test reasoning budget exhausted, retrying with larger max_tokens",
        "model", model, "from", maxTokens, "to", escalated)
      return testChatOnce(baseUrl, apiKey, model, messages, escalated, timeoutSec)
    }
    var body = e.requestInfo().body || {}
    var configId = norm(body.config_id)
    var model = norm(body.model).slice(0, 200)
    if (!configId || !model) return e.json(200, { ok: false, code: "bad_request", message: "缺少配置或模型参数" })
    var rec = null
    try { rec = $app.findRecordById("model_configs", configId) } catch (err) { rec = null }
    if (!rec || String(rec.get("rh_user_id")) !== userId) return e.json(404, { ok: false, code: "not_found", message: "配置不存在或无权访问" })
    if (rec.get("is_platform")) return e.json(200, { ok: false, code: "platform_model", message: "平台内置模型由前端直接走平台通道测试" })
    var plainKey = rec.get("api_key") ? unxorHex(rec.get("api_key")) : ""
    if (!plainKey) return e.json(200, { ok: false, code: "no_key", message: "该配置缺少 API Key，请先编辑补填" })
    var r = doChat(String(rec.get("base_url") || ""), plainKey, model, [{ role: "user", content: "请用一句话介绍你自己" }], TEST_MIN_RETRY_TOKENS, 60)
    if (!r.ok) return e.json(200, { ok: false, code: r.code === "rate_limit" ? "rate_limit" : "upstream_error", kind: r.kind || "", detail: r.detail || "", message: r.message })
    return e.json(200, { ok: true, reply: r.text, elapsed_ms: r.elapsed_ms, usage: r.usage })
  } catch (ex) {
    $app.logger().error("model-gw test failed", "err", String(ex))
    return e.json(500, { error: "model_gateway_error", message: "模型测试失败，请稍后重试", fingerprint: "mgw-test-" + new Date().getTime().toString(36) })
  }
})

// ---------------------------------------------------------------------------
// POST /api/model-gw/chat — 统一网关（解析默认/指定配置转发出站；
// 无可用个人配置返回 fallback_to_platform 由前端回退平台模型）
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/model-gw/chat", (e) => {
  try {
    var norm = function (s) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, "").trim() }
    var userId = norm(String(e.get("rhUserId") || ""))
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再使用模型网关" })
    var SECRET = "mgw-app-d61cf9ef4f3a43a9ac231816a7e5d501"
    var unxorHex = function (hx) {
      var out = ""
      for (var i = 0; i + 1 < String(hx).length; i += 2) {
        var c = parseInt(String(hx).substr(i, 2), 16)
        if (isNaN(c)) return ""
        out += String.fromCharCode(c ^ SECRET.charCodeAt((i / 2) % SECRET.length))
      }
      return out
    }
    var sanitizeMessages = function (raw) {
      var out = []
      if (!raw || typeof raw.length !== "number") return out
      for (var i = 0; i < raw.length && out.length < 80; i++) {
        var m = raw[i]
        if (!m) continue
        var role = norm(m.role)
        if (role !== "system" && role !== "user" && role !== "assistant") continue
        var content = m.content
        if (typeof content === "string") {
          out.push({ role: role, content: content.slice(0, 100000) })
        } else if (content && typeof content.length === "number") {
          var parts = []
          for (var j = 0; j < content.length && parts.length < 20; j++) {
            var p = content[j]
            if (p && p.type === "text" && typeof p.text === "string") parts.push({ type: "text", text: String(p.text).slice(0, 100000) })
          }
          if (parts.length) out.push({ role: role, content: parts })
        }
      }
      return out
    }
    // T13（2026-09-28）：推理型模型（deepseek-v4 等）会把 max_tokens 全部耗在思考上，content 返回空。
    // 缺陷修复（2026-10-12 实测坐实）：原实现把这种「预算耗尽」当成硬失败，直接返回
    //   「返回格式异常，回复内容为空」——文案掩盖真实成因，且不自动恢复（实测 max_tokens=30 时 5/5 全失败，
    //   同一模型 max_tokens=40 即成功；usage 实测 reasoning_tokens=106，即预算全被思考吃掉）。
    // 现为三级兜底：
    //   ① 解析层读 reasoning_content 兜底（部分方言把正文放思考字段）；
    //   ② 判定「思考耗尽预算」（content 空但有 reasoning_content 或 finish_reason=length）时，
    //      自动提升 max_tokens 重试一次（×4，下限 1024，上限 16384），不做无意义的人工重试；
    //   ③ 仍失败才报错，且文案直说真实原因，不再用「格式异常」误导排查方向。
    var MIN_REASONING_RETRY_TOKENS = 1024
    var REASONING_RETRY_FACTOR = 4
    var MAX_CHAT_TOKENS = 16384
    // R301 缺陷修复（2026-10-13 实测坐实）：429 分支原先在解析 res.raw **之前**就 return，
    // 上游那句能区分「限流」与「余额不足」的 error.message 被整段丢弃 → 网关只能回一句
    // 「限流或余额不足，请稍后重试」。后果实测坐实：xiaomi/mimo-v2.6-pro 与
    // Intern/deepseek-v4-flash-vision 连续 4 次 429，无法判定是「等一会儿就好」还是
    // 「必须去充值」，运维与用户都拿不到可行动结论（唯一可判的旁证是同账号
    // 大模型/deepseek-v4-flash 退避 8s 后成功，证明该网关存在真实拥塞窗口）。
    // 现补：① 先解析上游原文并分类；② 按分类给出可执行文案；
    // ③ 原文进服务端日志（不进 UI 返回体，避免把上游内部信息泄给前端）。
    // 分类只看「额度/余额」族词与「频率/QPS」族词两组，命中顺序即口径：
    // 额度族优先（额度耗尽时也常同时报 rate limit，不能被误判成「等一会就好」）。
    var rateReason = function (raw) {
      var detail = ""
      var code = ""
      try {
        var dj = JSON.parse(typeof raw === "string" ? raw : "")
        if (dj) {
          if (dj.error) {
            if (dj.error.message) detail = String(dj.error.message)
            if (dj.error.code) code = String(dj.error.code)
          }
          if (!detail && dj.message) detail = String(dj.message)
          if (!code && dj.code) code = String(dj.code)
        }
      } catch (e) { detail = "" }
      if (!detail && typeof raw === "string" && raw) detail = raw.slice(0, 200)
      var hay = (code + " " + detail).toLowerCase()
      // R301 口径校准（实测原文坐实）：quota 必须由原文直接说「额度/账户」才能成立。
      // 原式含 exceed.{0,12}(limit|quota)，把实测的 "inference exceeds tpm/rpm limit"
      // （纯速率限制，退避 25s 即成功）误判成额度耗尽→误导用户去充值。
      // 去掉 exceed 泛匹配，改由 freq 族显式承接 tpm/rpm/exceeds 句式。
      var quota = /insufficient[_\s-]*(balance|quota|credit)|quota[_\s-]*(exhaust|exceed|limit)|exceed[a-z]*[_\s-]*(your[_\s-]*(current[_\s-]*)?)?(quota|billing|balance)|balance[_\s-]*(insufficient|exceed|not[_\s-]*enough)|billing|arrears|account[_\s-]*(expired|deactivated|suspended)|余额不足|额度不足|额度耗尽|配额耗尽|超出额度|欠费|账户已/.test(hay)
      var freq = /rate.?limit|too\s*many|qps|concurren|requests?\s+per|frequency|tpm|rpm|token[_\s-]*budget|exceed[a-z]*[_\s-]*(your[_\s-]*)?(token|tpm|rpm)|限流|频率|并发|过于?频繁|请求过多/.test(hay)
      var kind = quota ? "quota" : (freq ? "freq" : "unknown")
      return { kind: kind, code: code, detail: detail.slice(0, 200) }
    }
    var rateMessage = function (r) {
      if (r.kind === "quota") return "接口额度或余额不足（HTTP 429），请到该模型平台充值或提高配额后重试"
      if (r.kind === "freq") return "对方接口请求频率超限（HTTP 429），请稍后重试"
      return "对方接口限流或余额不足（HTTP 429），请稍后重试"
    }
    // 单次出站：URL 兜底 + 关思考参数兼容 + 响应解析。
    // 「思考耗尽预算」以 retryReasoning 标记返回，交外层 doChat 升预算重试（此处不自行重试，避免与 URL 循环纠缠）。
    var chatOnce = function (baseUrl, apiKey, model, messages, maxTokens, temperature, timeoutSec, disableThinking) {
      var b = String(baseUrl).replace(/\/+$/, "")
      var urls = [b + "/chat/completions", b + "/v1/chat/completions"]
      var payload = { model: model, messages: messages, stream: false, max_tokens: maxTokens }
      if (typeof temperature === "number" && !isNaN(temperature)) payload.temperature = temperature
      if (disableThinking) {
        payload.thinking = { type: "disabled" }
        payload.reasoning_effort = "none"
      }
      var tryPayload = payload
      var started = new Date().getTime()
      var lastStatus = 0
      // R39（实测坐实）：OpenCode 的 GO 端点对非官方客户端强制要求会话标识头，缺省直接 400
      // 「Request is missing x-opencode-session and cannot be routed efficiently」——
      // 标书整本 22 段全灭、解析覆盖率掉到 2% 就是这么来的（而 /models 连通性检查返回 200，
      // 配置页一直显示「ok」，真因被彻底埋掉）。按其文档补两件事：① 同一模型给稳定 session 头
      // （便于上游路由与提示缓存）；② 自称应用 UA 而非通用 SDK 名。仅 opencode.ai 生效，其它通道零变化。
      var hdrs = { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" }
      if (/opencode\.ai/i.test(b)) {
        hdrs["x-opencode-session"] = "xiaozhi-bid-" + String(model || "go").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40)
        hdrs["User-Agent"] = "xiaozhi-presales-desk/1.0"
      }
      for (var i = 0; i < urls.length; i++) {
        try {
          var res = $http.send({
            url: urls[i],
            method: "POST",
            headers: hdrs,
            body: JSON.stringify(tryPayload),
            timeout: timeoutSec
          })
          lastStatus = res.statusCode
          if (res.statusCode === 404 && i === 0) continue
          // 严格网关拒收关思考参数（400）→ 去参重试当前 URL 一次
          if (disableThinking && res.statusCode === 400 && tryPayload === payload) {
            var stripped = {}
            for (var k in payload) if (k !== "thinking" && k !== "reasoning_effort") stripped[k] = payload[k]
            tryPayload = stripped
            i -= 1
            continue
          }
          var elapsed = new Date().getTime() - started
          if (res.statusCode === 401 || res.statusCode === 403) return { ok: false, message: "认证失败，请检查所配置模型的 API Key 是否有效" }
          if (res.statusCode === 429) {
            var rr = rateReason(res.raw)
            try { $app.logger().warn("model-gw upstream 429", "model", model, "kind", rr.kind, "code", rr.code, "detail", rr.detail) } catch (lg) {}
            return { ok: false, code: "rate_limit", kind: rr.kind, detail: rr.detail, message: rateMessage(rr) }
          }
          if (res.statusCode >= 500) return { ok: false, message: "所配置模型的服务暂时不可用（HTTP " + res.statusCode + "），请稍后重试" }
          if (res.statusCode !== 200) {
            var detail = ""
            try { var dj = JSON.parse(typeof res.raw === "string" ? res.raw : ""); if (dj && dj.error && dj.error.message) detail = String(dj.error.message).slice(0, 200) } catch (e2) { detail = "" }
            return { ok: false, message: "接口返回异常（HTTP " + res.statusCode + "）" + (detail ? "：" + detail : "") }
          }
          var data = null
          try { data = JSON.parse(typeof res.raw === "string" ? res.raw : "") } catch (e3) { return { ok: false, message: "返回格式异常，无法解析上游响应（对方可能返回了非 JSON 内容）" } }
          var choice = (data && data.choices && data.choices.length) ? data.choices[0] : null
          var msgObj = choice && choice.message ? choice.message : null
          var usage = (data && data.usage) ? data.usage : null
          var text = msgObj ? String(msgObj.content == null ? "" : msgObj.content) : ""
          // 兜底 ①：部分推理方言把正文写在 reasoning_content，content 留空
          if (!text && msgObj) {
            var rc = msgObj.reasoning_content != null ? msgObj.reasoning_content : msgObj.reasoning
            if (rc != null && String(rc) !== "") text = String(rc)
          }
          if (!text) {
            // 兜底 ②判定：content 空 + 有思考痕迹，或因长度被截断 → 交外层升预算重试
            var reasoningUsed = usage && usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens
              ? Number(usage.completion_tokens_details.reasoning_tokens) : 0
            var truncated = String(choice && choice.finish_reason ? choice.finish_reason : "") === "length"
            if (reasoningUsed > 0 || truncated || (msgObj && (msgObj.reasoning_content != null || msgObj.reasoning != null))) {
              return {
                ok: false,
                retryReasoning: true,
                reasoning_tokens: reasoningUsed,
                message: "推理型模型本次把输出预算全部消耗在思考阶段，未产出正文（已自动提升预算重试仍失败）。"
                  + "请改用非推理模型，或在模型配置页为该模型设置更大的输出上限。"
              }
            }
            return { ok: false, message: "返回格式异常：上游响应中没有任何正文内容（content 与 reasoning_content 均为空），请检查该模型 ID 是否正确" }
          }
          return { ok: true, text: text, elapsed_ms: elapsed, usage: usage }
        } catch (err) {
          var msg = String((err && err.message) || err || "")
          if (/timeout|deadline|Timeout/i.test(msg)) return { ok: false, message: "请求超时，对方接口未在限定时间内返回，可稍后重试或切换模型" }
          // T13：EOF/断连按限流口径返回（前端 isRateLimitError 命中后退避+熔断，不再逐项硬撞）
          if (/EOF|connection\s*reset|broken\s*pipe|ECONNRESET|socket/i.test(msg)) return { ok: false, message: "所配置模型的接口限流或连接被对方关闭（EOF），请稍后重试或切换模型" }
          if (i === urls.length - 1) return { ok: false, message: "接口地址无法连通，请检查模型配置" }
        }
      }
      return { ok: false, message: "接口返回异常（HTTP " + lastStatus + "）" }
    }
    // 出站总控：单次失败且判定为「思考耗尽预算」时升预算重试一次（仅一次，避免无界重试与重复计费）
    var doChat = function (baseUrl, apiKey, model, messages, maxTokens, temperature, timeoutSec, disableThinking) {
      var first = chatOnce(baseUrl, apiKey, model, messages, maxTokens, temperature, timeoutSec, disableThinking)
      if (first.ok || !first.retryReasoning) return first
      var escalated = Math.min(MAX_CHAT_TOKENS, Math.max(maxTokens * REASONING_RETRY_FACTOR, MIN_REASONING_RETRY_TOKENS))
      if (escalated <= maxTokens) return first
      $app.logger().warn("model-gw chat reasoning budget exhausted, retrying with larger max_tokens",
        "model", model, "from", maxTokens, "to", escalated)
      return chatOnce(baseUrl, apiKey, model, messages, escalated, temperature, timeoutSec, disableThinking)
    }
    var body = e.requestInfo().body || {}
    var messages = sanitizeMessages(body.messages)
    if (!messages.length) return e.json(200, { ok: false, code: "bad_request", message: "messages 不能为空" })
    var maxTokens = parseInt(body.max_tokens, 10)
    if (isNaN(maxTokens) || maxTokens <= 0) maxTokens = 2048
    // R216 缺陷修复：调用方给的预算若低于推理模型思考下限，一律抬到下限——
    // 否则推理模型 100% 把预算耗在思考上、content 恒空，表现为「随机失败」（实测 30 必败 / 40 可成）
    if (maxTokens < MIN_REASONING_RETRY_TOKENS) maxTokens = MIN_REASONING_RETRY_TOKENS
    if (maxTokens > MAX_CHAT_TOKENS) maxTokens = MAX_CHAT_TOKENS
    var temperature = typeof body.temperature === "number" ? body.temperature : null
    if (temperature !== null && (temperature < 0 || temperature > 2)) temperature = null

    var rec = null
    var configId = norm(body.config_id)
    var wantModel = norm(body.model).slice(0, 200)
    if (configId) {
      try { rec = $app.findRecordById("model_configs", configId) } catch (err) { rec = null }
      if (!rec || String(rec.get("rh_user_id")) !== userId) {
        return e.json(200, { ok: false, code: "fallback_to_platform", message: "未找到该模型配置，将回退平台内置模型" })
      }
    } else {
      // 解析当前用户的全局默认配置（个人配置且模型已启用）
      var rows = $app.findRecordsByFilter("model_configs", "rh_user_id={:u} && default_model!='' && is_platform=false", "-updated", 10, 0, { u: userId })
      if (!rows.length) {
        // R302 兜底修复：没有任何配置声明 default_model 时，原实现直接落「平台内置」，
        // 而平台内置的 gpt-5.5 在本地自用域恒未启用（rh 未登录必 412）——结果是全部 AI 功能
        // 一律报「尚未配置个人模型」。实测复现：清空 default_model 后调用必返回 fallback_to_platform。
        // 改为顺位取「有启用模型且带 Key 的个人配置」（按 -updated），与配置页
        // 「启用列表第一个」兜底口径一致，保证至少还能用起来。
        var pool = $app.findRecordsByFilter("model_configs", "rh_user_id={:u} && is_platform=false", "-updated", 20, 0, { u: userId })
        for (var pi = 0; pi < pool.length; pi++) {
          var pStored = []
          try {
            var pRaw = pool[pi].getString("models")
            if (pRaw) { var pPs = JSON.parse(pRaw); if (pPs && typeof pPs.length === "number") pStored = pPs }
          } catch (errP) { pStored = [] }
          var pEnabled = false
          for (var pj = 0; pj < pStored.length; pj++) {
            if (pStored[pj] && pStored[pj].enabled) { pEnabled = true; break }
          }
          if (pEnabled && pool[pi].get("api_key")) { rows = [pool[pi]]; break }
        }
        if (!rows.length) return e.json(200, { ok: false, code: "fallback_to_platform", message: "尚未配置个人模型，将使用平台内置模型" })
      }
      rec = rows[0]
    }
    if (rec.get("is_platform")) return e.json(200, { ok: false, code: "fallback_to_platform", message: "默认模型为平台内置模型" })
    var stored = []
    try { var rawS = rec.getString("models"); if (rawS) { var ps = JSON.parse(rawS); if (ps && typeof ps.length === "number") stored = ps } } catch (err3) { stored = [] }
    var useModel = wantModel || String(rec.get("default_model") || "")
    // R302：自动选模型时不能「取第一个启用模型就硬发」——实测 opecode 21 个启用模型里
    // 10 个已在上游下线（upstream_error），第一个 deepseek-v4-flash 恰好是死的；
    // 只挑一个必然再次失败。改为按「配置默认 → 其余启用项」逐个试，最多 4 个，
    // 遇账号级失败（限流 / 额度 / 鉴权）立即停手，避免无界重试与重复计费。
    var autoPick = !wantModel
    var modelCandidates = []
    if (useModel) modelCandidates.push(useModel)
    if (autoPick) {
      for (var q = 0; q < stored.length; q++) {
        if (!stored[q] || !stored[q].enabled) continue
        var qid = String(stored[q].id)
        if (qid && modelCandidates.indexOf(qid) < 0) modelCandidates.push(qid)
      }
    }
    if (!modelCandidates.length) return e.json(200, { ok: false, code: "fallback_to_platform", message: "该配置下没有已启用的模型，将回退平台内置模型" })
    var isModelEnabled = function (mid) {
      for (var t = 0; t < stored.length; t++) {
        if (String(stored[t] && stored[t].id ? stored[t].id : "") === mid) return !!stored[t].enabled
      }
      return false
    }
    if (!autoPick && !isModelEnabled(useModel)) {
      return e.json(200, { ok: false, code: "model_disabled", message: "模型「" + useModel + "」已停用，请在模型配置页启用或改用其他模型" })
    }
    var plainKey = rec.get("api_key") ? unxorHex(rec.get("api_key")) : ""
    if (!plainKey) return e.json(200, { ok: false, code: "fallback_to_platform", message: "该配置缺少 API Key，将回退平台内置模型" })
    var lastErr = null
    var tried = 0
    for (var ci = 0; ci < modelCandidates.length && tried < 4; ci++) {
      var tryModel = modelCandidates[ci]
      if (!isModelEnabled(tryModel)) continue
      tried++
      var r = doChat(String(rec.get("base_url") || ""), plainKey, tryModel, messages, maxTokens, temperature, 120, body.disable_thinking === true)
      if (r.ok) {
        $app.logger().info("model-gw chat ok", "user", userId, "config", rec.id, "model", tryModel, "elapsed_ms", r.elapsed_ms, "tried", tried)
        return e.json(200, { ok: true, text: r.text, model: tryModel, config_name: String(rec.get("config_name") || ""), elapsed_ms: r.elapsed_ms, usage: r.usage })
      }
      lastErr = r
      // 账号级失败换模型也没用：限流 / 额度 / 鉴权，立即停手
      if (r.code === "rate_limit") break
      if (/认证|额度|余额|欠费|Key|api.?key/i.test(String(r.message || ""))) break
    }
    if (lastErr) {
      return e.json(200, { ok: false, code: lastErr.code === "rate_limit" ? "rate_limit" : "upstream_error", kind: lastErr.kind || "", detail: lastErr.detail || "", message: lastErr.message })
    }
    return e.json(200, { ok: false, code: "fallback_to_platform", message: "该配置下没有可用的已启用模型，将回退平台内置模型" })
  } catch (ex) {
    $app.logger().error("model-gw chat failed", "err", String(ex))
    // T13：上游断连（EOF/reset）实测在大批量解析时成串出现（触发对方限流/配额/服务波动）——
    // 映射为含「限流」字样的可读文案，前端 isRateLimitError 命中后退避重试+熔断，不再逐项硬撞
    var exMsg = String((ex && ex.message) || ex || "")
    if (/EOF|connection\s*reset|broken\s*pipe|ECONNRESET|socket/i.test(exMsg)) {
      return e.json(200, { ok: false, code: "upstream_error", message: "所配置模型的接口限流或连接被对方关闭（EOF），请稍后重试或切换模型" })
    }
    return e.json(500, { error: "model_gateway_error", message: "模型网关处理失败，请稍后重试", fingerprint: "mgw-chat-" + new Date().getTime().toString(36) })
  }
})

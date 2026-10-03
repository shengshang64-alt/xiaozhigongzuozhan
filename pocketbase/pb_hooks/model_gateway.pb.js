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
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || "")
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
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || "")
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
          if (res.statusCode === 429) return { ok: false, message: "对方接口限流（HTTP 429），请稍后重试" }
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
    rec.set("last_check_status", "ok")
    rec.set("last_check_error", "")
    rec.set("last_checked_at", new Date().toISOString())
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
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || "")
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
          if (res.statusCode === 429) return { ok: false, message: "对方接口限流（HTTP 429），请稍后重试" }
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
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || "")
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
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || "")
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
        if (res.statusCode === 429) { result = { ok: false, message: "对方接口限流（HTTP 429），请稍后重试" }; break }
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
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || "")
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
    var doChat = function (baseUrl, apiKey, model, messages, maxTokens, timeoutSec) {
      var b = String(baseUrl).replace(/\/+$/, "")
      var urls = [b + "/chat/completions", b + "/v1/chat/completions"]
      var started = new Date().getTime()
      var lastStatus = 0
      for (var i = 0; i < urls.length; i++) {
        try {
          var res = $http.send({
            url: urls[i],
            method: "POST",
            headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ model: model, messages: messages, stream: false, max_tokens: maxTokens }),
            timeout: timeoutSec
          })
          lastStatus = res.statusCode
          if (res.statusCode === 404 && i === 0) continue
          var elapsed = new Date().getTime() - started
          if (res.statusCode === 401 || res.statusCode === 403) return { ok: false, message: "认证失败，请检查 API Key 是否有效" }
          if (res.statusCode === 429) return { ok: false, message: "对方接口限流或余额不足（HTTP 429），请稍后重试" }
          if (res.statusCode >= 500) return { ok: false, message: "对方服务暂时不可用（HTTP " + res.statusCode + "），请稍后重试" }
          if (res.statusCode !== 200) {
            var detail = ""
            try { var dj = JSON.parse(typeof res.raw === "string" ? res.raw : ""); if (dj && dj.error && dj.error.message) detail = String(dj.error.message).slice(0, 200) } catch (e2) { detail = "" }
            return { ok: false, message: "接口返回异常（HTTP " + res.statusCode + "）" + (detail ? "：" + detail : "") }
          }
          var data = null
          try { data = JSON.parse(typeof res.raw === "string" ? res.raw : "") } catch (e3) { return { ok: false, message: "返回格式异常，无法解析回复内容" } }
          var text = ""
          if (data && data.choices && data.choices.length && data.choices[0] && data.choices[0].message) text = String(data.choices[0].message.content || "")
          if (!text) return { ok: false, message: "返回格式异常，回复内容为空" }
          return { ok: true, text: text, elapsed_ms: elapsed }
        } catch (err) {
          var msg = String((err && err.message) || err || "")
          if (/timeout|deadline|Timeout/i.test(msg)) return { ok: false, message: "请求超时，对方接口未在限定时间内返回" }
          if (i === urls.length - 1) return { ok: false, message: "接口地址无法连通，请检查配置" }
        }
      }
      return { ok: false, message: "接口返回异常（HTTP " + lastStatus + "）" }
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
    var r = doChat(String(rec.get("base_url") || ""), plainKey, model, [{ role: "user", content: "请用一句话介绍你自己" }], 200, 60)
    if (!r.ok) return e.json(200, { ok: false, code: "upstream_error", message: r.message })
    return e.json(200, { ok: true, reply: r.text, elapsed_ms: r.elapsed_ms })
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
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || "")
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
    // T13（2026-09-28）：推理型模型（deepseek-v4 等）会把 max_tokens 全部耗在思考上，content 返回空
    // → 前端报「返回格式异常，回复内容为空」（解析批量失败实锤）。解析类调用带 disable_thinking=true，
    //   出站补两家主流方言关闭思考参数；个别严格网关若 400 拒收未知参数，去掉重试一次。
    var doChat = function (baseUrl, apiKey, model, messages, maxTokens, temperature, timeoutSec, disableThinking) {
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
      for (var i = 0; i < urls.length; i++) {
        try {
          var res = $http.send({
            url: urls[i],
            method: "POST",
            headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
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
          if (res.statusCode === 429) return { ok: false, message: "所配置模型的接口限流或余额不足（HTTP 429），请稍后重试或切换模型" }
          if (res.statusCode >= 500) return { ok: false, message: "所配置模型的服务暂时不可用（HTTP " + res.statusCode + "），请稍后重试" }
          if (res.statusCode !== 200) {
            var detail = ""
            try { var dj = JSON.parse(typeof res.raw === "string" ? res.raw : ""); if (dj && dj.error && dj.error.message) detail = String(dj.error.message).slice(0, 200) } catch (e2) { detail = "" }
            return { ok: false, message: "接口返回异常（HTTP " + res.statusCode + "）" + (detail ? "：" + detail : "") }
          }
          var data = null
          try { data = JSON.parse(typeof res.raw === "string" ? res.raw : "") } catch (e3) { return { ok: false, message: "返回格式异常，无法解析回复内容" } }
          var text = ""
          if (data && data.choices && data.choices.length && data.choices[0] && data.choices[0].message) text = String(data.choices[0].message.content || "")
          if (!text) return { ok: false, message: "返回格式异常，回复内容为空" }
          return { ok: true, text: text, elapsed_ms: elapsed, usage: data.usage || null }
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
    var body = e.requestInfo().body || {}
    var messages = sanitizeMessages(body.messages)
    if (!messages.length) return e.json(200, { ok: false, code: "bad_request", message: "messages 不能为空" })
    var maxTokens = parseInt(body.max_tokens, 10)
    if (isNaN(maxTokens) || maxTokens <= 0) maxTokens = 2048
    if (maxTokens > 16384) maxTokens = 16384
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
      if (!rows.length) return e.json(200, { ok: false, code: "fallback_to_platform", message: "尚未配置个人模型，将使用平台内置模型" })
      rec = rows[0]
    }
    if (rec.get("is_platform")) return e.json(200, { ok: false, code: "fallback_to_platform", message: "默认模型为平台内置模型" })
    var stored = []
    try { var rawS = rec.getString("models"); if (rawS) { var ps = JSON.parse(rawS); if (ps && typeof ps.length === "number") stored = ps } } catch (err3) { stored = [] }
    var useModel = wantModel || String(rec.get("default_model") || "")
    if (!useModel) {
      for (var s = 0; s < stored.length; s++) {
        if (stored[s] && stored[s].enabled) { useModel = String(stored[s].id); break }
      }
    }
    if (!useModel) return e.json(200, { ok: false, code: "fallback_to_platform", message: "该配置下没有已启用的模型，将回退平台内置模型" })
    var enabledOk = false
    for (var t = 0; t < stored.length; t++) {
      if (String(stored[t] && stored[t].id ? stored[t].id : "") === useModel && stored[t].enabled) enabledOk = true
    }
    if (!enabledOk) return e.json(200, { ok: false, code: "model_disabled", message: "模型「" + useModel + "」已停用，请在模型配置页启用或改用其他模型" })
    var plainKey = rec.get("api_key") ? unxorHex(rec.get("api_key")) : ""
    if (!plainKey) return e.json(200, { ok: false, code: "fallback_to_platform", message: "该配置缺少 API Key，将回退平台内置模型" })
    var r = doChat(String(rec.get("base_url") || ""), plainKey, useModel, messages, maxTokens, temperature, 120, body.disable_thinking === true)
    if (!r.ok) return e.json(200, { ok: false, code: "upstream_error", message: r.message })
    $app.logger().info("model-gw chat ok", "user", userId, "config", rec.id, "model", useModel, "elapsed_ms", r.elapsed_ms)
    return e.json(200, { ok: true, text: r.text, model: useModel, config_name: String(rec.get("config_name") || ""), elapsed_ms: r.elapsed_ms, usage: r.usage })
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

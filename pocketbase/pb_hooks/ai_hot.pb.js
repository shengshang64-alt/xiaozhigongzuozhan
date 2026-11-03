// ai_hot.pb.js — AI 动态（AIHOT 行业咨讯 RSS 的服务端代理）
// 背景：aihot.news 的公开 RSS（/feed，约 50 条精选）不带 CORS 响应头，本地工作台页面
// 无法跨域直取；由本路由服务端出站透传，解析/缓存/转情报均在 src/lib/aiHotFeed.ts。
// 安全约定（与 intel_center.pb.js 对齐）：
//  - 身份只认 vibex 网关注入的 X-Rh-User-Id，缺失一律 401
//  - Goja 并发安全：helper self-contained 在回调内；只用 var / function
//  - 5xx 一律 { error, message, fingerprint } 三字段；$http.send timeout 8s
//  - 零 LLM 调用（纯 RSS 透传，无 AI 费用）；不发送任何本地数据（纯入站公开咨讯）
//  - 不用 cronAdd（pb-hook-lint 禁止）：拉取时机=用户进入「AI 动态」页 / 手动刷新
routerAdd("GET", "/api/ai_hot/feed", function (e) {
  var __uid = String(e.get("rhUserId") || "")
  if (!__uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
  try {
    var res = $http.send({
      url: "https://aihot.news/feed",
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "application/rss+xml, application/xml, text/xml",
      },
      timeout: 8,
    })
    if (!res || res.statusCode !== 200) {
      return e.json(502, { error: "aihot_fetch_failed", message: "AIHOT 返回 HTTP " + (res && res.statusCode), fingerprint: "http" + (res && res.statusCode) })
    }
    return e.json(200, { xml: String(res.raw || ""), fetched_at: new Date().toISOString() })
  } catch (err) {
    var msg = String((err && err.message) || err)
    try { $app.logger().error("ai_hot feed: " + msg) } catch (_) {}
    return e.json(502, { error: "aihot_unreachable", message: "拉取 AIHOT 咨讯失败：" + msg, fingerprint: msg.substring(0, 80) })
  }
})

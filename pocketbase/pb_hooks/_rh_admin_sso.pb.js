/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/_rh_admin_sso.pb.js — 平台「管理后台」免密登入 (drop-in, 新老 app 通用)
// 由 VibeX control 维护并按需下发; 请勿手改。安全: 仅当请求头 X-Rh-Admin-Sso 等于容器内
// 注入的 VIBEX_TASK_INDEX_TOKEN 时才签发 superuser 短期 token (该 secret 不下发浏览器)。

routerAdd("POST", "/__rh_admin_sso", function (e) {
  var expected = $os.getenv("VIBEX_TASK_INDEX_TOKEN")
  var got = ""
  try {
    // PB 把请求头名归一为小写+下划线 (X-Rh-Admin-Sso -> x_rh_admin_sso)。
    var hdrs = e.requestInfo().headers || {}
    got = hdrs["x_rh_admin_sso"] || hdrs["X-Rh-Admin-Sso"] || hdrs["x-rh-admin-sso"] || ""
  } catch (_) {}
  if (!expected || !got || String(got) !== expected) {
    return e.json(403, { code: "FORBIDDEN" })
  }
  var email = "rh-platform-admin@vibex.local"
  var rec = null
  try {
    rec = $app.findAuthRecordByEmail("_superusers", email)
  } catch (_) {
    rec = null
  }
  if (!rec) {
    var col = $app.findCollectionByNameOrId("_superusers")
    rec = new Record(col)
    rec.setEmail(email)
    rec.setPassword($security.randomString(40))
    $app.save(rec)
  }
  var token = rec.newStaticAuthToken(15 * 60 * 1000000000)
  return e.json(200, { token: token, record: rec })
})

// intel_center.pb.js — 情报中心：内置信息源种子 + 切片抓取（tick 门控）+ 手动抓取 + 信息源管理 + 情报流查询
// 安全约定：
//  - 身份只认 vibex 网关注入的 X-Rh-User-Id，需要登录的路由缺失一律 401
//  - 所有 helper/常量 self-contained 在每个回调内部（Goja 并发安全）
//  - 只用 var / function；时间戳一律 new Date().toISOString()
//  - 5xx 一律 { error, message, fingerprint } 三字段
//  - 抓取环节不调用任何 LLM（零 AI 费用）；抓不到是常态，如实记录 last_status/last_error
//  - 定时抓取不用 cronAdd（pb-hook-lint 禁止）：由前端页面挂载时/驻留期间触发
//    POST /api/intel/tick，服务端以「最近一轮距今 >= 30 分钟」做门控，每轮最多
//    抓 3 个到期启用源（切片防吃满），单源出站超时 15s。
//  - 医疗信息化相关性过滤：抓取条目（tick / fetch-now 两条路径）不命中 medicalRelevant
//    直接跳过不入库；手动录入不过滤。
//  - 可见性模型：visibility ∈ {public, personal, ''}；内置源抓取 = public/owner_id=''，
//    自定义源抓取 = personal/owner_id=源归属人；手动录入由前端按「公开到团队」开关写入。
//    查询 where 用 visibility!='personal' || owner_id={:u}（'' 视同 public，兼容未迁移存量）。
//  - 每人独立确认状态：intel_views(rh_user_id/item_id/view_status)；GET items 的
//    item_status 查询参数语义 = 按本人 my_status 过滤（内存过滤 + 内存分页，数据量小）。

// ---------------------------------------------------------------------------
// 内置信息源种子为惰性幂等逻辑（本 PB 构建未暴露 onServe）：
// GET /api/intel/sources 与 POST /api/intel/tick 每次执行前检查，
// is_builtin=true 且同名不存在才插入，重复调用零副作用。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// POST /api/intel/tick — 定时抓取轮（前端触发，服务端 30 分钟门控）：
// 距最近一轮 >= 30 分钟才真正执行；每轮最多抓 3 个到期（last_fetch_at 最旧的）
// 启用源，单源超时 15s；不满足门控直接返回 ran=false，零开销。
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/intel/tick", (e) => {
  try {
    // 惰性幂等种子：内置源缺失才插入
    var BUILTIN = [
      { n: "国家卫健委 · 新闻发布", u: "https://www.nhc.gov.cn/wjw/xwfbh/index.shtml", t: "policy" },
      { n: "国家医保局 · 政策文件", u: "https://www.nhsa.gov.cn/col/col107/index.html", t: "policy" },
      { n: "工业和信息化部 · 新闻动态", u: "https://www.miit.gov.cn/xwdt/gxdt/sjdt/index.html", t: "policy" },
      { n: "国家卫健委统计信息中心", u: "http://www.statinfo.org/", t: "policy" },
      { n: "中国政府采购网 · 中央公告", u: "https://www.ccgp.gov.cn/cggg/zygg/", t: "bid" },
      { n: "全国公共资源交易平台 · 交易信息", u: "https://www.ggzy.gov.cn/information/html/a/010001/index.shtml", t: "bid" },
      { n: "卫宁健康 · 新闻动态", u: "https://www.winning.com.cn/news/", t: "competitor" },
      { n: "东软集团 · 新闻中心", u: "https://www.neusoft.com.cn/news/", t: "competitor" },
      { n: "创业慧康 · 公司新闻", u: "https://www.b-soft.com.cn/news/", t: "competitor" },
      { n: "东华医为 · 新闻动态", u: "https://www.dhc.com.cn/news/", t: "competitor" },
      { n: "HIT专家网 · 行业资讯", u: "https://www.hit180.com/", t: "media" },
      { n: "CHIMA · 中国医院协会信息管理分会", u: "http://www.chima.org.cn/", t: "media" },
      { n: "动脉网 · 医疗产业资讯", u: "https://www.vbdata.cn/", t: "media" }
    ]
    var seedColl = $app.findCollectionByNameOrId("intel_sources")
    for (var b = 0; b < BUILTIN.length; b++) {
      var bExists = null
      try { bExists = $app.findFirstRecordByFilter("intel_sources", "is_builtin=true && source_name={:bn}", { bn: BUILTIN[b].n }) } catch (errSeed) { bExists = null }
      if (bExists) continue
      var bRec = new Record(seedColl)
      bRec.set("source_name", BUILTIN[b].n)
      bRec.set("url", BUILTIN[b].u)
      bRec.set("source_type", BUILTIN[b].t)
      bRec.set("is_builtin", true)
      bRec.set("owner_id", "")
      bRec.set("enabled", true)
      bRec.set("last_fetch_at", "")
      bRec.set("last_status", "")
      bRec.set("last_error", "")
      bRec.set("fetched_count", 0)
      $app.save(bRec)
    }
    // 门控：最近一次任何源的抓取时间距今不足 30 分钟 → 本轮跳过
    var latest = null
    try {
      var latestRows = $app.findRecordsByFilter("intel_sources", "last_fetch_at!=''", "-last_fetch_at", 1, 0)
      if (latestRows.length) latest = latestRows[0]
    } catch (errG) { latest = null }
    if (latest) {
      var lastAt = new Date(String(latest.get("last_fetch_at")))
      var cutoff = new Date()
      cutoff.setMinutes(cutoff.getMinutes() - 30)
      if (lastAt > cutoff) return e.json(200, { ok: true, ran: false, added: 0, message: "距上一轮抓取不足 30 分钟，本轮跳过" })
    }
    var unesc = function (s) {
      return String(s).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&ldquo;|&rdquo;/g, "").replace(/\s+/g, " ").trim()
    }
    var absUrl = function (href, base) {
      var h = String(href).replace(/#.*$/, "")
      if (/^https?:\/\//i.test(h)) return h
      if (/^\/\//.test(h)) return "https:" + h
      var om = String(base).match(/^https?:\/\/[^\/]+/i)
      var origin = om ? om[0] : ""
      if (/^\//.test(h)) return origin + h
      var dir = String(base).replace(/\/[^\/]*$/, "/")
      return dir + h
    }
    // 医疗信息化相关性 v2（2026-09-16 建设导向收紧）：噪音行全域拦截（版权/备案/页脚，
    // 堵「页脚自带医院+信息二字自证相关」的口子）；强词=医疗信息化建设主题直接命中；
    // 宽松兜底须 领域词 AND 建设主题词 AND 建设动作词 三命中（纯行业新闻/会议通知不收）
    var noiseRe = /版权|All Rights|ICP 备|备案号|友情链接|隐私政策|使用条款|网站地图/i
    var medicalRelevant = function (title, snippet) {
      var text = String(title || "") + " " + String(snippet || "")
      if (noiseRe.test(String(title || ""))) return false
      if (/电子病历|互联互通|智慧医院|互联网医院|卫生信息化|医疗信息化|医院信息|数字医院|智慧医疗|医保平台|远程医疗|全民健康|医疗数据|卫健|CDSS|临床决策|智慧病房|智慧服务|\bHIS\b|\bLIS\b|\bPACS\b|\bEMR\b|\bCDR\b|\bHRP\b/i.test(text)) return true
      var domainHit = /医疗|医院|卫生|临床|医保|卫健委|医疗机构/.test(text)
      var topicHit = /信息化|数字化|数字化转型|智慧|集成平台|数据中心|信创|国产化|人工智能|\bAI\b|等保|信息系统|信息平台/.test(text)
      var actionHit = /项目|建设|招标|中标|采购|比选|遴选|公告|公示|上线|开工|政策|规划|方案|测试|验收|升级|改造|转型|转变|集成|互联|实施|部署|标准|规范|通知|结果|评审|立项/.test(text)
      return domainHit && topicHit && actionHit
    }
    // 省份区域词表本地抽取（零 AI）：全称 + 多字简称（单字简称误报率高，刻意排除）；
    // 多命中取正文中位置最先者，同位置取更长词。
    var REGION_WORDS = [
      { w: "黑龙江", r: "黑龙江" }, { w: "内蒙古", r: "内蒙古" }, { w: "内蒙", r: "内蒙古" },
      { w: "北京", r: "北京" }, { w: "天津", r: "天津" }, { w: "上海", r: "上海" }, { w: "重庆", r: "重庆" },
      { w: "河北", r: "河北" }, { w: "山西", r: "山西" }, { w: "辽宁", r: "辽宁" }, { w: "吉林", r: "吉林" },
      { w: "江苏", r: "江苏" }, { w: "浙江", r: "浙江" }, { w: "安徽", r: "安徽" }, { w: "福建", r: "福建" },
      { w: "江西", r: "江西" }, { w: "山东", r: "山东" }, { w: "河南", r: "河南" }, { w: "湖北", r: "湖北" },
      { w: "湖南", r: "湖南" }, { w: "广东", r: "广东" }, { w: "海南", r: "海南" }, { w: "四川", r: "四川" },
      { w: "贵州", r: "贵州" }, { w: "云南", r: "云南" }, { w: "陕西", r: "陕西" }, { w: "甘肃", r: "甘肃" },
      { w: "青海", r: "青海" }, { w: "台湾", r: "台湾" }, { w: "广西", r: "广西" }, { w: "西藏", r: "西藏" },
      { w: "宁夏", r: "宁夏" }, { w: "新疆", r: "新疆" }, { w: "香港", r: "香港" }, { w: "澳门", r: "澳门" },
      { w: "深圳", r: "深圳" }, { w: "大连", r: "大连" }, { w: "青岛", r: "青岛" }, { w: "宁波", r: "宁波" }, { w: "厦门", r: "厦门" }
    ]
    var extractRegion = function (title, snippet) {
      var text = String(title || "") + " " + String(snippet || "")
      var best = ""
      var bestPos = -1
      for (var ri = 0; ri < REGION_WORDS.length; ri++) {
        var rpos = text.indexOf(REGION_WORDS[ri].w)
        if (rpos < 0) continue
        if (bestPos < 0 || rpos < bestPos || (rpos === bestPos && REGION_WORDS[ri].w.length > best.length)) {
          bestPos = rpos
          best = REGION_WORDS[ri].r
        }
      }
      return best
    }
    var badTitleRe = /^(首页|关于|联系|更多|下载|登录|注册|English|网站地图|版权所有|声明|导航|返回|上一页|下一页|查看更多|点击进入|附件|搜索|订阅|邮箱|微信|微博|APP)/i
    var dateOnlyRe = /^[\d\s\-\/年月日.:：()\[\]，,周星期]+$/
    var crawlOne = function (src) {
      var url = String(src.get("url") || "")
      var res = null
      try {
        res = $http.send({
          url: url,
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9"
          },
          timeout: 15
        })
      } catch (err) {
        var emsg = String((err && err.message) || err || "")
        src.set("last_fetch_at", new Date().toISOString())
        src.set("last_status", "error")
        src.set("last_error", (/timeout|deadline/i.test(emsg) ? "抓取超时（15s），该网站可能无法访问" : "无法连接：" + emsg).slice(0, 400))
        $app.save(src)
        return 0
      }
      if (res.statusCode !== 200) {
        src.set("last_fetch_at", new Date().toISOString())
        src.set("last_status", "error")
        src.set("last_error", "对方返回 HTTP " + res.statusCode)
        $app.save(src)
        return 0
      }
      var html = typeof res.raw === "string" ? res.raw.slice(0, 600000) : ""
      var existing = {}
      try {
        var rows = $app.findRecordsByFilter("intel_items", "source_id={:s}", "-published_at", 500, 0, { s: src.id })
        for (var r = 0; r < rows.length; r++) existing[String(rows[r].get("url") || "")] = true
      } catch (err2) { existing = {} }
      var itemColl = $app.findCollectionByNameOrId("intel_items")
      var isBuiltin = !!src.get("is_builtin")
      var srcOwner = String(src.get("owner_id") || "")
      var re = /<a\s[^>]*?href\s*=\s*["']([^"'\s>]+)["'][^>]*>([\s\S]{0,500}?)<\/a>/gi
      var m = null
      var seen = {}
      var added = 0
      var skippedIrrelevant = 0
      re.lastIndex = 0
      while ((m = re.exec(html)) !== null && added < 10) {
        var href = unesc(m[1])
        var title = unesc(String(m[2]).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
        if (!title || title.length < 8 || title.length > 200) continue
        if (badTitleRe.test(title)) continue
        if (dateOnlyRe.test(title)) continue
        if (/^(javascript|mailto):/i.test(href)) continue
        var full = absUrl(href, url)
        if (!/^https?:\/\//i.test(full)) continue
        if (seen[full] || existing[full]) continue
        seen[full] = true
        var block = html.slice(Math.max(0, m.index - 800), m.index + 800)
        var snippet = unesc(String(block).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
        snippet = snippet.replace(title, " ").replace(/\s+/g, " ").trim().slice(0, 600)
        // 医疗信息化相关性过滤：不命中直接跳过不入库
        if (!medicalRelevant(title, snippet)) { skippedIrrelevant++; continue }
        var dup = null
        try { dup = $app.findFirstRecordByFilter("intel_items", "url={:u}", { u: full }) } catch (err3) { dup = null }
        if (dup) { existing[full] = true; continue }
        var pubAt = ""
        var dm = snippet.match(/(20\d{2})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})/)
        if (dm) {
          var mm = String(dm[2]).length < 2 ? "0" + dm[2] : dm[2]
          var dd = String(dm[3]).length < 2 ? "0" + dm[3] : dm[3]
          pubAt = dm[1] + "-" + mm + "-" + dd
        }
        if (!pubAt) pubAt = new Date().toISOString().slice(0, 10)
        var item = new Record(itemColl)
        item.set("source_id", src.id)
        item.set("source_name", String(src.get("source_name") || ""))
        item.set("title", title.slice(0, 300))
        item.set("url", full.slice(0, 600))
        item.set("content_snippet", snippet)
        item.set("item_type", String(src.get("source_type") || "policy"))
        item.set("summary", "")
        item.set("tags", [])
        item.set("region", extractRegion(title, snippet))
        item.set("item_status", "pending")
        item.set("added_by", "crawl")
        item.set("owner_id", isBuiltin ? "" : srcOwner)
        item.set("visibility", isBuiltin ? "public" : "personal")
        item.set("published_at", pubAt)
        $app.save(item)
        existing[full] = true
        added++
      }
      src.set("last_fetch_at", new Date().toISOString())
      src.set("last_status", "ok")
      src.set("last_error", "")
      src.set("fetched_count", Number(src.get("fetched_count") || 0) + added)
      $app.save(src)
      $app.logger().info("intel-center crawled", "source", String(src.get("source_name") || ""), "added", added, "skipped_irrelevant", skippedIrrelevant)
      return added
    }
    var due = $app.findRecordsByFilter("intel_sources", "enabled=true", "last_fetch_at", 3, 0)
    var total = 0
    for (var i = 0; i < due.length; i++) total += crawlOne(due[i])
    $app.logger().info("intel-center tick round done", "sources", due.length, "new_items", total)
    return e.json(200, { ok: true, ran: true, added: total, sources_checked: due.length, message: total > 0 ? ("本轮抓取新增 " + total + " 条待确认情报") : "本轮抓取完成，没有新条目" })
  } catch (ex) {
    $app.logger().error("intel tick failed", "err", String(ex))
    return e.json(500, { error: "intel_error", message: "定时抓取轮执行失败", fingerprint: "intel-tick-" + Math.floor(Math.random() * 1000000000).toString(36) })
  }
})

// ---------------------------------------------------------------------------
// GET /api/intel/sources — 内置源（全员）+ 本人自定义源；未登录只回内置源
// ---------------------------------------------------------------------------
routerAdd("GET", "/api/intel/sources", (e) => {
  try {
    // 惰性幂等种子：内置源缺失才插入
    var BUILTIN = [
      { n: "国家卫健委 · 新闻发布", u: "https://www.nhc.gov.cn/wjw/xwfbh/index.shtml", t: "policy" },
      { n: "国家医保局 · 政策文件", u: "https://www.nhsa.gov.cn/col/col107/index.html", t: "policy" },
      { n: "工业和信息化部 · 新闻动态", u: "https://www.miit.gov.cn/xwdt/gxdt/sjdt/index.html", t: "policy" },
      { n: "国家卫健委统计信息中心", u: "http://www.statinfo.org/", t: "policy" },
      { n: "中国政府采购网 · 中央公告", u: "https://www.ccgp.gov.cn/cggg/zygg/", t: "bid" },
      { n: "全国公共资源交易平台 · 交易信息", u: "https://www.ggzy.gov.cn/information/html/a/010001/index.shtml", t: "bid" },
      { n: "卫宁健康 · 新闻动态", u: "https://www.winning.com.cn/news/", t: "competitor" },
      { n: "东软集团 · 新闻中心", u: "https://www.neusoft.com.cn/news/", t: "competitor" },
      { n: "创业慧康 · 公司新闻", u: "https://www.b-soft.com.cn/news/", t: "competitor" },
      { n: "东华医为 · 新闻动态", u: "https://www.dhc.com.cn/news/", t: "competitor" },
      { n: "HIT专家网 · 行业资讯", u: "https://www.hit180.com/", t: "media" },
      { n: "CHIMA · 中国医院协会信息管理分会", u: "http://www.chima.org.cn/", t: "media" },
      { n: "动脉网 · 医疗产业资讯", u: "https://www.vbdata.cn/", t: "media" }
    ]
    var seedColl = $app.findCollectionByNameOrId("intel_sources")
    for (var b = 0; b < BUILTIN.length; b++) {
      var bExists = null
      try { bExists = $app.findFirstRecordByFilter("intel_sources", "is_builtin=true && source_name={:bn}", { bn: BUILTIN[b].n }) } catch (errSeed) { bExists = null }
      if (bExists) continue
      var bRec = new Record(seedColl)
      bRec.set("source_name", BUILTIN[b].n)
      bRec.set("url", BUILTIN[b].u)
      bRec.set("source_type", BUILTIN[b].t)
      bRec.set("is_builtin", true)
      bRec.set("owner_id", "")
      bRec.set("enabled", true)
      bRec.set("last_fetch_at", "")
      bRec.set("last_status", "")
      bRec.set("last_error", "")
      bRec.set("fetched_count", 0)
      $app.save(bRec)
    }
    var norm = function (s) { return String(s == null ? "" : s).trim() }
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || "")
    var pub = function (rec) {
      return {
        id: rec.id,
        source_name: String(rec.get("source_name") || ""),
        url: String(rec.get("url") || ""),
        source_type: String(rec.get("source_type") || ""),
        is_builtin: !!rec.get("is_builtin"),
        owner_id: String(rec.get("owner_id") || ""),
        enabled: !!rec.get("enabled"),
        last_fetch_at: String(rec.get("last_fetch_at") || ""),
        last_status: String(rec.get("last_status") || ""),
        last_error: String(rec.get("last_error") || ""),
        fetched_count: Number(rec.get("fetched_count") || 0),
        created: String(rec.get("created") || "")
      }
    }
    var items = []
    var builtin = $app.findRecordsByFilter("intel_sources", "is_builtin=true", "created", 100, 0)
    for (var i = 0; i < builtin.length; i++) items.push(pub(builtin[i]))
    if (userId) {
      var mine = $app.findRecordsByFilter("intel_sources", "is_builtin=false && owner_id={:u}", "-created", 100, 0, { u: userId })
      for (var j = 0; j < mine.length; j++) items.push(pub(mine[j]))
    }
    return e.json(200, { ok: true, items: items })
  } catch (ex) {
    $app.logger().error("intel sources list failed", "err", String(ex))
    return e.json(500, { error: "intel_error", message: "读取信息源列表失败，请稍后重试", fingerprint: "intel-src-list-" + Math.floor(Math.random() * 1000000000).toString(36) })
  }
})

// ---------------------------------------------------------------------------
// POST /api/intel/sources — 添加自定义源（登录；仅本人可见可改删）
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/intel/sources", (e) => {
  try {
    var norm = function (s) { return String(s == null ? "" : s).trim() }
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || "")
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再添加信息源" })
    var body = e.requestInfo().body || {}
    var name = norm(body.source_name).slice(0, 100)
    var url = norm(body.url).slice(0, 500)
    var stype = norm(body.source_type)
    if (stype !== "policy" && stype !== "competitor" && stype !== "bid" && stype !== "media") stype = "policy"
    if (!name) return e.json(200, { ok: false, code: "bad_request", message: "请填写信息源名称" })
    if (!/^https?:\/\//i.test(url)) return e.json(200, { ok: false, code: "bad_request", message: "网址必须以 http:// 或 https:// 开头" })
    var dup = null
    try { dup = $app.findFirstRecordByFilter("intel_sources", "owner_id={:u} && url={:l}", { u: userId, l: url }) } catch (err) { dup = null }
    if (dup) return e.json(200, { ok: false, code: "dup_url", message: "已添加过这个网址的信息源" })
    var coll = $app.findCollectionByNameOrId("intel_sources")
    var rec = new Record(coll)
    rec.set("source_name", name)
    rec.set("url", url)
    rec.set("source_type", stype)
    rec.set("is_builtin", false)
    rec.set("owner_id", userId)
    rec.set("enabled", true)
    rec.set("last_fetch_at", "")
    rec.set("last_status", "")
    rec.set("last_error", "")
    rec.set("fetched_count", 0)
    $app.save(rec)
    return e.json(200, {
      ok: true,
      source: {
        id: rec.id, source_name: name, url: url, source_type: stype, is_builtin: false,
        owner_id: userId, enabled: true, last_fetch_at: "", last_status: "", last_error: "",
        fetched_count: 0, created: String(rec.get("created") || "")
      }
    })
  } catch (ex) {
    $app.logger().error("intel source create failed", "err", String(ex))
    return e.json(500, { error: "intel_error", message: "添加信息源失败，请稍后重试", fingerprint: "intel-src-add-" + Math.floor(Math.random() * 1000000000).toString(36) })
  }
})

// ---------------------------------------------------------------------------
// PATCH /api/intel/sources/{id} — 内置源仅启停；自定义源本人可全量编辑
// ---------------------------------------------------------------------------
routerAdd("PATCH", "/api/intel/sources/{id}", (e) => {
  try {
    var norm = function (s) { return String(s == null ? "" : s).trim() }
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || "")
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再管理信息源" })
    var id = norm(e.request.pathValue("id"))
    var rec = null
    try { rec = $app.findRecordById("intel_sources", id) } catch (err) { rec = null }
    if (!rec) return e.json(404, { ok: false, code: "not_found", message: "信息源不存在" })
    var body = e.requestInfo().body || {}
    if (rec.get("is_builtin")) {
      if (body.enabled === true || body.enabled === false) rec.set("enabled", body.enabled)
    } else {
      if (String(rec.get("owner_id") || "") !== userId) return e.json(404, { ok: false, code: "not_found", message: "信息源不存在或无权修改" })
      if (body.source_name != null) {
        var nn = norm(body.source_name).slice(0, 100)
        if (!nn) return e.json(200, { ok: false, code: "bad_request", message: "信息源名称不能为空" })
        rec.set("source_name", nn)
      }
      if (body.url != null) {
        var nu = norm(body.url).slice(0, 500)
        if (!/^https?:\/\//i.test(nu)) return e.json(200, { ok: false, code: "bad_request", message: "网址必须以 http:// 或 https:// 开头" })
        rec.set("url", nu)
      }
      if (body.source_type != null) {
        var nt = norm(body.source_type)
        if (nt !== "policy" && nt !== "competitor" && nt !== "bid" && nt !== "media") nt = "policy"
        rec.set("source_type", nt)
      }
      if (body.enabled === true || body.enabled === false) rec.set("enabled", body.enabled)
    }
    $app.save(rec)
    return e.json(200, {
      ok: true,
      source: {
        id: rec.id, source_name: String(rec.get("source_name") || ""), url: String(rec.get("url") || ""),
        source_type: String(rec.get("source_type") || ""), is_builtin: !!rec.get("is_builtin"),
        owner_id: String(rec.get("owner_id") || ""), enabled: !!rec.get("enabled"),
        last_fetch_at: String(rec.get("last_fetch_at") || ""), last_status: String(rec.get("last_status") || ""),
        last_error: String(rec.get("last_error") || ""), fetched_count: Number(rec.get("fetched_count") || 0),
        created: String(rec.get("created") || "")
      }
    })
  } catch (ex) {
    $app.logger().error("intel source update failed", "err", String(ex))
    return e.json(500, { error: "intel_error", message: "更新信息源失败，请稍后重试", fingerprint: "intel-src-patch-" + Math.floor(Math.random() * 1000000000).toString(36) })
  }
})

// ---------------------------------------------------------------------------
// DELETE /api/intel/sources/{id} — 仅自定义源、仅本人可删
// ---------------------------------------------------------------------------
routerAdd("DELETE", "/api/intel/sources/{id}", (e) => {
  try {
    var norm = function (s) { return String(s == null ? "" : s).trim() }
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || "")
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再管理信息源" })
    var id = norm(e.request.pathValue("id"))
    var rec = null
    try { rec = $app.findRecordById("intel_sources", id) } catch (err) { rec = null }
    if (!rec || String(rec.get("owner_id") || "") !== userId) return e.json(404, { ok: false, code: "not_found", message: "信息源不存在或无权删除" })
    if (rec.get("is_builtin")) return e.json(200, { ok: false, code: "BUILTIN_PROTECTED", message: "内置信息源不可删除，可以将其停用" })
    $app.delete(rec)
    return e.json(200, { ok: true })
  } catch (ex) {
    $app.logger().error("intel source delete failed", "err", String(ex))
    return e.json(500, { error: "intel_error", message: "删除信息源失败，请稍后重试", fingerprint: "intel-src-del-" + Math.floor(Math.random() * 1000000000).toString(36) })
  }
})

// ---------------------------------------------------------------------------
// POST /api/intel/fetch-now — 登录用户手动触发单源抓取（同步返回新增条数与状态）
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/intel/fetch-now", (e) => {
  try {
    var norm = function (s) { return String(s == null ? "" : s).trim() }
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || "")
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再手动抓取" })
    var body = e.requestInfo().body || {}
    var id = norm(body.source_id)
    if (!id) return e.json(200, { ok: false, code: "bad_request", message: "缺少信息源参数" })
    var src = null
    try { src = $app.findRecordById("intel_sources", id) } catch (err) { src = null }
    if (!src) return e.json(404, { ok: false, code: "not_found", message: "信息源不存在" })
    if (!src.get("is_builtin") && String(src.get("owner_id") || "") !== userId) {
      return e.json(404, { ok: false, code: "not_found", message: "信息源不存在或无权操作" })
    }
    var unesc = function (s) {
      return String(s).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&ldquo;|&rdquo;/g, "").replace(/\s+/g, " ").trim()
    }
    var absUrl = function (href, base) {
      var hh = String(href).replace(/#.*$/, "")
      if (/^https?:\/\//i.test(hh)) return hh
      if (/^\/\//.test(hh)) return "https:" + hh
      var om = String(base).match(/^https?:\/\/[^\/]+/i)
      var origin = om ? om[0] : ""
      if (/^\//.test(hh)) return origin + hh
      var dir = String(base).replace(/\/[^\/]*$/, "/")
      return dir + hh
    }
    // 医疗信息化相关性 v2（2026-09-16 建设导向收紧）：噪音行全域拦截（版权/备案/页脚，
    // 堵「页脚自带医院+信息二字自证相关」的口子）；强词=医疗信息化建设主题直接命中；
    // 宽松兜底须 领域词 AND 建设主题词 AND 建设动作词 三命中（纯行业新闻/会议通知不收）
    var noiseRe = /版权|All Rights|ICP 备|备案号|友情链接|隐私政策|使用条款|网站地图/i
    var medicalRelevant = function (title, snippet) {
      var text = String(title || "") + " " + String(snippet || "")
      if (noiseRe.test(String(title || ""))) return false
      if (/电子病历|互联互通|智慧医院|互联网医院|卫生信息化|医疗信息化|医院信息|数字医院|智慧医疗|医保平台|远程医疗|全民健康|医疗数据|卫健|CDSS|临床决策|智慧病房|智慧服务|\bHIS\b|\bLIS\b|\bPACS\b|\bEMR\b|\bCDR\b|\bHRP\b/i.test(text)) return true
      var domainHit = /医疗|医院|卫生|临床|医保|卫健委|医疗机构/.test(text)
      var topicHit = /信息化|数字化|数字化转型|智慧|集成平台|数据中心|信创|国产化|人工智能|\bAI\b|等保|信息系统|信息平台/.test(text)
      var actionHit = /项目|建设|招标|中标|采购|比选|遴选|公告|公示|上线|开工|政策|规划|方案|测试|验收|升级|改造|转型|转变|集成|互联|实施|部署|标准|规范|通知|结果|评审|立项/.test(text)
      return domainHit && topicHit && actionHit
    }
    // 省份区域词表本地抽取（零 AI）：全称 + 多字简称（单字简称误报率高，刻意排除）；
    // 多命中取正文中位置最先者，同位置取更长词。
    var REGION_WORDS = [
      { w: "黑龙江", r: "黑龙江" }, { w: "内蒙古", r: "内蒙古" }, { w: "内蒙", r: "内蒙古" },
      { w: "北京", r: "北京" }, { w: "天津", r: "天津" }, { w: "上海", r: "上海" }, { w: "重庆", r: "重庆" },
      { w: "河北", r: "河北" }, { w: "山西", r: "山西" }, { w: "辽宁", r: "辽宁" }, { w: "吉林", r: "吉林" },
      { w: "江苏", r: "江苏" }, { w: "浙江", r: "浙江" }, { w: "安徽", r: "安徽" }, { w: "福建", r: "福建" },
      { w: "江西", r: "江西" }, { w: "山东", r: "山东" }, { w: "河南", r: "河南" }, { w: "湖北", r: "湖北" },
      { w: "湖南", r: "湖南" }, { w: "广东", r: "广东" }, { w: "海南", r: "海南" }, { w: "四川", r: "四川" },
      { w: "贵州", r: "贵州" }, { w: "云南", r: "云南" }, { w: "陕西", r: "陕西" }, { w: "甘肃", r: "甘肃" },
      { w: "青海", r: "青海" }, { w: "台湾", r: "台湾" }, { w: "广西", r: "广西" }, { w: "西藏", r: "西藏" },
      { w: "宁夏", r: "宁夏" }, { w: "新疆", r: "新疆" }, { w: "香港", r: "香港" }, { w: "澳门", r: "澳门" },
      { w: "深圳", r: "深圳" }, { w: "大连", r: "大连" }, { w: "青岛", r: "青岛" }, { w: "宁波", r: "宁波" }, { w: "厦门", r: "厦门" }
    ]
    var extractRegion = function (title, snippet) {
      var text = String(title || "") + " " + String(snippet || "")
      var best = ""
      var bestPos = -1
      for (var ri = 0; ri < REGION_WORDS.length; ri++) {
        var rpos = text.indexOf(REGION_WORDS[ri].w)
        if (rpos < 0) continue
        if (bestPos < 0 || rpos < bestPos || (rpos === bestPos && REGION_WORDS[ri].w.length > best.length)) {
          bestPos = rpos
          best = REGION_WORDS[ri].r
        }
      }
      return best
    }
    var badTitleRe = /^(首页|关于|联系|更多|下载|登录|注册|English|网站地图|版权所有|声明|导航|返回|上一页|下一页|查看更多|点击进入|附件|搜索|订阅|邮箱|微信|微博|APP)/i
    var dateOnlyRe = /^[\d\s\-\/年月日.:：()\[\]，,周星期]+$/
    var url = String(src.get("url") || "")
    var res = null
    try {
      res = $http.send({
        url: url,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9"
        },
        timeout: 15
      })
    } catch (err2) {
      var emsg = String((err2 && err2.message) || err2 || "")
      var failMsg = /timeout|deadline/i.test(emsg) ? "抓取超时（15s），该网站可能无法访问" : "无法连接该网站：" + emsg.slice(0, 200)
      src.set("last_fetch_at", new Date().toISOString())
      src.set("last_status", "error")
      src.set("last_error", failMsg.slice(0, 400))
      $app.save(src)
      return e.json(200, { ok: false, code: "fetch_failed", message: failMsg, added: 0, source_id: src.id })
    }
    if (res.statusCode !== 200) {
      src.set("last_fetch_at", new Date().toISOString())
      src.set("last_status", "error")
      src.set("last_error", "对方返回 HTTP " + res.statusCode)
      $app.save(src)
      return e.json(200, { ok: false, code: "fetch_failed", message: "抓取失败：对方网站返回 HTTP " + res.statusCode, added: 0, source_id: src.id })
    }
    var html = typeof res.raw === "string" ? res.raw.slice(0, 600000) : ""
    var existing = {}
    try {
      var rows = $app.findRecordsByFilter("intel_items", "source_id={:s}", "-published_at", 500, 0, { s: src.id })
      for (var r = 0; r < rows.length; r++) existing[String(rows[r].get("url") || "")] = true
    } catch (err3) { existing = {} }
    var itemColl = $app.findCollectionByNameOrId("intel_items")
    var isBuiltin = !!src.get("is_builtin")
    var srcOwner = String(src.get("owner_id") || "")
    var re = /<a\s[^>]*?href\s*=\s*["']([^"'\s>]+)["'][^>]*>([\s\S]{0,500}?)<\/a>/gi
    var m = null
    var seen = {}
    var added = 0
    var skippedIrrelevant = 0
    re.lastIndex = 0
    while ((m = re.exec(html)) !== null && added < 10) {
      var href = unesc(m[1])
      var title = unesc(String(m[2]).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
      if (!title || title.length < 8 || title.length > 200) continue
      if (badTitleRe.test(title)) continue
      if (dateOnlyRe.test(title)) continue
      if (/^(javascript|mailto):/i.test(href)) continue
      var full = absUrl(href, url)
      if (!/^https?:\/\//i.test(full)) continue
      if (seen[full] || existing[full]) continue
      seen[full] = true
      var block = html.slice(Math.max(0, m.index - 800), m.index + 800)
      var snippet = unesc(String(block).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
      snippet = snippet.replace(title, " ").replace(/\s+/g, " ").trim().slice(0, 600)
      // 医疗信息化相关性过滤：不命中直接跳过不入库
      if (!medicalRelevant(title, snippet)) { skippedIrrelevant++; continue }
      var dup = null
      try { dup = $app.findFirstRecordByFilter("intel_items", "url={:u}", { u: full }) } catch (err4) { dup = null }
      if (dup) { existing[full] = true; continue }
      var pubAt = ""
      var dm = snippet.match(/(20\d{2})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})/)
      if (dm) {
        var mm = String(dm[2]).length < 2 ? "0" + dm[2] : dm[2]
        var dd = String(dm[3]).length < 2 ? "0" + dm[3] : dm[3]
        pubAt = dm[1] + "-" + mm + "-" + dd
      }
      if (!pubAt) pubAt = new Date().toISOString().slice(0, 10)
      var item = new Record(itemColl)
      item.set("source_id", src.id)
      item.set("source_name", String(src.get("source_name") || ""))
      item.set("title", title.slice(0, 300))
      item.set("url", full.slice(0, 600))
      item.set("content_snippet", snippet)
      item.set("item_type", String(src.get("source_type") || "policy"))
      item.set("summary", "")
      item.set("tags", [])
      item.set("region", extractRegion(title, snippet))
      item.set("item_status", "pending")
      item.set("added_by", "crawl")
      item.set("owner_id", isBuiltin ? "" : srcOwner)
      item.set("visibility", isBuiltin ? "public" : "personal")
      item.set("published_at", pubAt)
      $app.save(item)
      existing[full] = true
      added++
    }
    src.set("last_fetch_at", new Date().toISOString())
    src.set("last_status", "ok")
    src.set("last_error", "")
    src.set("fetched_count", Number(src.get("fetched_count") || 0) + added)
    $app.save(src)
    $app.logger().info("intel-center fetch-now", "user", userId, "source", String(src.get("source_name") || ""), "added", added, "skipped_irrelevant", skippedIrrelevant)
    return e.json(200, {
      ok: true,
      added: added,
      skipped_irrelevant: skippedIrrelevant,
      source_id: src.id,
      message: added > 0 ? ("抓取完成，新增 " + added + " 条待确认情报") : "抓取完成，没有发现新的医疗信息化相关条目（已抓过、内容不相关或页面结构无法解析）",
      source: {
        last_fetch_at: String(src.get("last_fetch_at") || ""),
        last_status: String(src.get("last_status") || ""),
        last_error: String(src.get("last_error") || ""),
        fetched_count: Number(src.get("fetched_count") || 0)
      }
    })
  } catch (ex) {
    $app.logger().error("intel fetch-now failed", "err", String(ex))
    return e.json(500, { error: "intel_error", message: "手动抓取失败，请稍后重试", fingerprint: "intel-fetch-" + Math.floor(Math.random() * 1000000000).toString(36) })
  }
})

// ---------------------------------------------------------------------------
// POST /api/intel/fetch-url — 登录用户抓取单页链接（支持公众号文章页），
// 返回 { ok, title, snippet } 供手动录入弹窗预填；失败返回中文原因可手填。
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/intel/fetch-url", (e) => {
  try {
    var norm = function (s) { return String(s == null ? "" : s).trim() }
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || "")
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再抓取链接" })
    var body = e.requestInfo().body || {}
    var url = norm(body.url).slice(0, 600)
    if (!/^https?:\/\//i.test(url)) return e.json(200, { ok: false, code: "bad_request", message: "链接必须以 http:// 或 https:// 开头" })
    var unesc = function (s) {
      return String(s).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&ldquo;|&rdquo;/g, "").replace(/\s+/g, " ").trim()
    }
    var res = null
    try {
      res = $http.send({
        url: url,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1 MicroMessenger/8.0.40",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9"
        },
        timeout: 15
      })
    } catch (err) {
      var emsg = String((err && err.message) || err || "")
      var failMsg = /timeout|deadline/i.test(emsg)
        ? "抓取超时（15s），该链接暂时打不开，可手动填写标题与正文"
        : "无法打开该链接：" + emsg.slice(0, 200) + "，可手动填写标题与正文"
      return e.json(200, { ok: false, code: "fetch_failed", message: failMsg })
    }
    if (res.statusCode !== 200) {
      return e.json(200, { ok: false, code: "fetch_failed", message: "抓取失败：对方网站返回 HTTP " + res.statusCode + "，可手动填写标题与正文" })
    }
    var html = typeof res.raw === "string" ? res.raw.slice(0, 800000) : ""
    if (!html) return e.json(200, { ok: false, code: "empty_page", message: "该页面内容为空或编码无法解析，可手动填写标题与正文" })
    // 微信错误提示页守卫：参数错误 / 内容已删除 / 环境异常 / 需在微信客户端打开
    if (/weui-msg|global_error|参数错误|环境异常|该内容已被发布者删除|此内容因违规无法查看|请在微信客户端打开/.test(html) && !/<div[^>]+id\s*=\s*["']js_content["'][^>]*>[\s\S]{50,}/i.test(html)) {
      return e.json(200, { ok: false, code: "wx_error_page", message: "该链接打开的是微信提示页（链接不完整、内容已删除或需在微信内打开），请复制完整的公众号文章链接重试，或手动填写标题与正文" })
    }
    var title = ""
    var tm = html.match(/<meta[^>]+(?:property|name)\s*=\s*["'](?:og:title|twitter:title)["'][^>]+content\s*=\s*["']([^"']{2,300})["']/i)
    if (!tm) tm = html.match(/<meta[^>]+content\s*=\s*["']([^"']{2,300})["'][^>]+(?:property|name)\s*=\s*["'](?:og:title|twitter:title)["']/i)
    if (!tm) tm = html.match(/<title[^>]*>([\s\S]{1,400}?)<\/title>/i)
    if (tm) title = unesc(String(tm[1]).replace(/<[^>]+>/g, " "))
    // 去掉微信等站点标题尾巴
    title = title.replace(/\s*[-_|–—]\s*(微信公众平台|微信|Weixin|MP)\s*$/i, "").trim()
    var snippet = ""
    var dm = html.match(/<meta[^>]+(?:property|name)\s*=\s*["'](?:og:description|description|twitter:description)["'][^>]+content\s*=\s*["']([^"']{2,800})["']/i)
    if (!dm) dm = html.match(/<meta[^>]+content\s*=\s*["']([^"']{2,800})["'][^>]+(?:property|name)\s*=\s*["'](?:og:description|description|twitter:description)["']/i)
    if (dm) snippet = unesc(dm[1])
    if (!snippet) {
      var bodyM = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
      var rawText = bodyM ? bodyM[1] : html
      snippet = unesc(rawText.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    }
    snippet = snippet.slice(0, 600)
    if (!title && !snippet) {
      return e.json(200, { ok: false, code: "parse_failed", message: "未能从该页面解析出标题或正文（部分公众号文章需要在微信内打开），可手动填写" })
    }
    $app.logger().info("intel fetch-url ok", "user", userId, "has_title", !!title, "snippet_len", snippet.length)
    return e.json(200, { ok: true, title: title.slice(0, 300), snippet: snippet })
  } catch (ex) {
    $app.logger().error("intel fetch-url failed", "err", String(ex))
    return e.json(500, { error: "intel_error", message: "抓取链接失败，请稍后重试", fingerprint: "intel-fetch-url-" + Math.floor(Math.random() * 1000000000).toString(36) })
  }
})

// ---------------------------------------------------------------------------
// POST /api/intel/items/{id}/view — 登录用户写/更新本人对某条情报的状态
// （pending|confirmed|ignored，存 intel_views，每人独立互不影响）
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/intel/items/{id}/view", (e) => {
  try {
    var norm = function (s) { return String(s == null ? "" : s).trim() }
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || "")
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再标记情报状态" })
    var id = norm(e.request.pathValue("id"))
    var body = e.requestInfo().body || {}
    var vs = norm(body.view_status)
    if (vs !== "pending" && vs !== "confirmed" && vs !== "ignored") {
      return e.json(200, { ok: false, code: "bad_request", message: "状态值不合法（pending/confirmed/ignored）" })
    }
    var item = null
    try { item = $app.findRecordById("intel_items", id) } catch (err) { item = null }
    if (!item) return e.json(404, { ok: false, code: "not_found", message: "情报条目不存在" })
    var vis = String(item.get("visibility") || "")
    var own = String(item.get("owner_id") || "")
    if (vis === "personal" && own !== userId) {
      return e.json(404, { ok: false, code: "not_found", message: "情报条目不存在或无权操作" })
    }
    var rec = null
    try { rec = $app.findFirstRecordByFilter("intel_views", "rh_user_id={:u} && item_id={:i}", { u: userId, i: id }) } catch (err2) { rec = null }
    if (rec) {
      rec.set("view_status", vs)
      $app.save(rec)
    } else {
      var coll = $app.findCollectionByNameOrId("intel_views")
      rec = new Record(coll)
      rec.set("rh_user_id", userId)
      rec.set("item_id", id)
      rec.set("view_status", vs)
      $app.save(rec)
    }
    return e.json(200, { ok: true, item_id: id, my_status: vs })
  } catch (ex) {
    $app.logger().error("intel item view failed", "err", String(ex))
    return e.json(500, { error: "intel_error", message: "更新情报状态失败，请稍后重试", fingerprint: "intel-view-" + Math.floor(Math.random() * 1000000000).toString(36) })
  }
})

// ---------------------------------------------------------------------------
// GET /api/intel/items — 情报流（公共条目全员可见 + 本人个人条目；类型/我的状态/
// 关键词/标签/时间过滤；-published_at 排序；分页；附全站标签聚合）
// 执行前做存量懒迁移（幂等）：visibility='' 的旧条目按相关性删除/去重/补 public。
// item_status 查询参数语义 = 按本人 my_status（intel_views）过滤，内存过滤+分页。
// ---------------------------------------------------------------------------
routerAdd("GET", "/api/intel/items", (e) => {
  try {
    var norm = function (s) { return String(s == null ? "" : s).trim() }
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || "")
    var q = (e.requestInfo() || {}).query || {}
    var qv = function (key) {
      var v = q[key]
      if (v && typeof v === "object" && typeof v.length === "number") v = v[0]
      return norm(v)
    }

    // ---- 存量懒迁移（幂等，每次最多处理 300 条 visibility='' 的旧条目） ----
    var noiseRe = /版权|All Rights|ICP 备|备案号|友情链接|隐私政策|使用条款|网站地图/i
    var medicalRelevant = function (title, snippet) {
      var text = String(title || "") + " " + String(snippet || "")
      if (noiseRe.test(String(title || ""))) return false
      if (/电子病历|互联互通|智慧医院|互联网医院|卫生信息化|医疗信息化|医院信息|数字医院|智慧医疗|医保平台|远程医疗|全民健康|医疗数据|卫健|CDSS|临床决策|智慧病房|智慧服务|\bHIS\b|\bLIS\b|\bPACS\b|\bEMR\b|\bCDR\b|\bHRP\b/i.test(text)) return true
      var domainHit = /医疗|医院|卫生|临床|医保|卫健委|医疗机构/.test(text)
      var topicHit = /信息化|数字化|数字化转型|智慧|集成平台|数据中心|信创|国产化|人工智能|\bAI\b|等保|信息系统|信息平台/.test(text)
      var actionHit = /项目|建设|招标|中标|采购|比选|遴选|公告|公示|上线|开工|政策|规划|方案|测试|验收|升级|改造|转型|转变|集成|互联|实施|部署|标准|规范|通知|结果|评审|立项/.test(text)
      return domainHit && topicHit && actionHit
    }
    // 省份区域词表本地抽取（零 AI）：与 tick / fetch-now 同口径，本回调自持一份用于存量回填
    var REGION_WORDS = [
      { w: "黑龙江", r: "黑龙江" }, { w: "内蒙古", r: "内蒙古" }, { w: "内蒙", r: "内蒙古" },
      { w: "北京", r: "北京" }, { w: "天津", r: "天津" }, { w: "上海", r: "上海" }, { w: "重庆", r: "重庆" },
      { w: "河北", r: "河北" }, { w: "山西", r: "山西" }, { w: "辽宁", r: "辽宁" }, { w: "吉林", r: "吉林" },
      { w: "江苏", r: "江苏" }, { w: "浙江", r: "浙江" }, { w: "安徽", r: "安徽" }, { w: "福建", r: "福建" },
      { w: "江西", r: "江西" }, { w: "山东", r: "山东" }, { w: "河南", r: "河南" }, { w: "湖北", r: "湖北" },
      { w: "湖南", r: "湖南" }, { w: "广东", r: "广东" }, { w: "海南", r: "海南" }, { w: "四川", r: "四川" },
      { w: "贵州", r: "贵州" }, { w: "云南", r: "云南" }, { w: "陕西", r: "陕西" }, { w: "甘肃", r: "甘肃" },
      { w: "青海", r: "青海" }, { w: "台湾", r: "台湾" }, { w: "广西", r: "广西" }, { w: "西藏", r: "西藏" },
      { w: "宁夏", r: "宁夏" }, { w: "新疆", r: "新疆" }, { w: "香港", r: "香港" }, { w: "澳门", r: "澳门" },
      { w: "深圳", r: "深圳" }, { w: "大连", r: "大连" }, { w: "青岛", r: "青岛" }, { w: "宁波", r: "宁波" }, { w: "厦门", r: "厦门" }
    ]
    var extractRegion = function (title, snippet) {
      var text = String(title || "") + " " + String(snippet || "")
      var best = ""
      var bestPos = -1
      for (var ri = 0; ri < REGION_WORDS.length; ri++) {
        var rpos = text.indexOf(REGION_WORDS[ri].w)
        if (rpos < 0) continue
        if (bestPos < 0 || rpos < bestPos || (rpos === bestPos && REGION_WORDS[ri].w.length > best.length)) {
          bestPos = rpos
          best = REGION_WORDS[ri].r
        }
      }
      return best
    }
    var migDeleted = 0
    var migMarked = 0
    try {
      var migRows = $app.findRecordsByFilter("intel_items", "visibility=''", "created", 300, 0)
      for (var mi = 0; mi < migRows.length; mi++) {
        var mrow = migRows[mi]
        var mtitle = String(mrow.get("title") || "")
        var msnippet = String(mrow.get("content_snippet") || "")
        if (!medicalRelevant(mtitle, msnippet)) {
          $app.delete(mrow)
          migDeleted++
          continue
        }
        var murl = String(mrow.get("url") || "")
        var olderDup = null
        if (murl) {
          try { olderDup = $app.findFirstRecordByFilter("intel_items", "url={:mu} && created<{:mc}", { mu: murl, mc: String(mrow.get("created")) }) } catch (errD) { olderDup = null }
        }
        if (olderDup) {
          $app.delete(mrow)
          migDeleted++
          continue
        }
        mrow.set("visibility", "public")
        $app.save(mrow)
        migMarked++
      }
      if (migDeleted > 0 || migMarked > 0) {
        $app.logger().info("intel items lazy migration", "deleted", migDeleted, "marked_public", migMarked)
      }
    } catch (errMig) {
      $app.logger().warn("intel items lazy migration skipped", "err", String(errMig))
    }

    // ---- region 存量懒迁移（幂等，每次最多回填 300 条 region='' 且 added_by='crawl'） ----
    var migRegion = 0
    try {
      var rRows = $app.findRecordsByFilter("intel_items", "region='' && added_by='crawl'", "created", 300, 0)
      for (var rgi = 0; rgi < rRows.length; rgi++) {
        var rgVal = extractRegion(String(rRows[rgi].get("title") || ""), String(rRows[rgi].get("content_snippet") || ""))
        if (!rgVal) continue
        rRows[rgi].set("region", rgVal)
        $app.save(rRows[rgi])
        migRegion++
      }
      if (migRegion > 0) {
        $app.logger().info("intel items region backfill", "filled", migRegion)
      }
    } catch (errRg) {
      $app.logger().warn("intel items region backfill skipped", "err", String(errRg))
    }

    // ---- 本人状态表（intel_views）----
    var viewMap = {}
    if (userId) {
      try {
        var vrows = $app.findRecordsByFilter("intel_views", "rh_user_id={:vu}", "-created", 3000, 0, { vu: userId })
        for (var vi = 0; vi < vrows.length; vi++) {
          viewMap[String(vrows[vi].get("item_id") || "")] = String(vrows[vi].get("view_status") || "pending")
        }
      } catch (errV) { viewMap = {} }
    }

    // ---- 过滤条件（状态不进 SQL，改为按 my_status 内存过滤）----
    var where = ["(visibility!='personal' || owner_id={:u})"]
    var params = { u: userId || "__anon__" }
    var statusRaw = qv("item_status") || "pending,confirmed"
    var allowed = { pending: true, confirmed: true, ignored: true }
    var stList = []
    var stParts = statusRaw.split(",")
    for (var s = 0; s < stParts.length; s++) {
      var sv = norm(stParts[s])
      if (allowed[sv] && stList.indexOf(sv) < 0) stList.push(sv)
    }
    if (!stList.length) stList = ["pending", "confirmed"]
    var typeRaw = qv("item_type")
    if (typeRaw === "policy" || typeRaw === "competitor" || typeRaw === "bid" || typeRaw === "media") {
      where.push("item_type={:tp}")
      params.tp = typeRaw
    }
    var kw = qv("q").slice(0, 100)
    if (kw) {
      where.push("(title ~ {:k1} || content_snippet ~ {:k2} || summary ~ {:k3})")
      params.k1 = "%" + kw + "%"
      params.k2 = "%" + kw + "%"
      params.k3 = "%" + kw + "%"
    }
    var tag = qv("tag").slice(0, 40)
    if (tag) {
      where.push("tags ~ {:tg}")
      params.tg = '%"' + tag + '"%'
    }
    var regionQ = qv("region").slice(0, 30)
    if (regionQ) {
      // 循环 12：省份级筛选归并计划单列市（深圳→广东 等）；__none__ = 区域未知
      var SUB_PLAN = { "广东": ["深圳"], "辽宁": ["大连"], "山东": ["青岛"], "浙江": ["宁波"], "福建": ["厦门"] }
      if (regionQ === "__none__") {
        where.push("region=''")
      } else {
        var subs = SUB_PLAN[regionQ] || []
        if (subs.length) {
          var ors = ["region={:rg}"]
          params.rg = regionQ
          for (var si2 = 0; si2 < subs.length; si2++) {
            ors.push("region={:rs" + si2 + "}")
            params["rs" + si2] = subs[si2]
          }
          where.push("(" + ors.join(" || ") + ")")
        } else {
          where.push("region={:rg}")
          params.rg = regionQ
        }
      }
    }
    var sourceQ = qv("source_id").slice(0, 40)
    if (sourceQ) {
      where.push("source_id={:si}")
      params.si = sourceQ
    }
    var since = qv("since")
    if (/^20\d{2}-\d{2}-\d{2}$/.test(since)) {
      where.push("published_at>={:sn}")
      params.sn = since
    }
    var whereSql = where.join(" && ")
    var page = parseInt(qv("page"), 10)
    if (isNaN(page) || page < 1) page = 1
    var perPage = parseInt(qv("per_page"), 10)
    if (isNaN(perPage) || perPage < 1) perPage = 10
    if (perPage > 50) perPage = 50
    var pub = function (rec) {
      var tg = []
      try { var rawT = rec.getString("tags"); if (rawT) { var pt = JSON.parse(rawT); if (pt && typeof pt.length === "number") tg = pt } } catch (err) { tg = [] }
      return {
        id: rec.id,
        source_id: String(rec.get("source_id") || ""),
        source_name: String(rec.get("source_name") || ""),
        title: String(rec.get("title") || ""),
        url: String(rec.get("url") || ""),
        content_snippet: String(rec.get("content_snippet") || ""),
        item_type: String(rec.get("item_type") || ""),
        summary: String(rec.get("summary") || ""),
        tags: tg,
        region: String(rec.get("region") || ""),
        item_status: String(rec.get("item_status") || ""),
        added_by: String(rec.get("added_by") || ""),
        owner_id: String(rec.get("owner_id") || ""),
        visibility: String(rec.get("visibility") || ""),
        published_at: String(rec.get("published_at") || ""),
        created: String(rec.get("created") || ""),
        updated: String(rec.get("updated") || "")
      }
    }
    // 先按其他条件查（上限 500 条），按 my_status 内存过滤后再分页（数据量小可接受）
    var rows = $app.findRecordsByFilter("intel_items", whereSql, "-published_at", 500, 0, params)
    var filtered = []
    for (var i = 0; i < rows.length; i++) {
      var myStatus = viewMap[rows[i].id] || "pending"
      if (stList.indexOf(myStatus) < 0) continue
      var obj = pub(rows[i])
      obj.my_status = myStatus
      filtered.push(obj)
    }
    var total = filtered.length
    var startIdx = (page - 1) * perPage
    var items = filtered.slice(startIdx, startIdx + perPage)
    var allTags = []
    try {
      var trows = $app.findRecordsByFilter("intel_items", "(visibility!='personal' || owner_id={:u2})", "-published_at", 300, 0, { u2: userId || "__anon__" })
      for (var j = 0; j < trows.length; j++) {
        var tj = []
        try { var rt = trows[j].getString("tags"); if (rt) { var pt2 = JSON.parse(rt); if (pt2 && typeof pt2.length === "number") tj = pt2 } } catch (err3) { tj = [] }
        for (var k = 0; k < tj.length && allTags.length < 30; k++) {
          var tv = String(tj[k] || "")
          if (tv && allTags.indexOf(tv) < 0) allTags.push(tv)
        }
      }
    } catch (err4) { allTags = [] }
    return e.json(200, { ok: true, items: items, page: page, perPage: perPage, totalItems: total, allTags: allTags })
  } catch (ex) {
    $app.logger().error("intel items list failed", "err", String(ex))
    return e.json(500, { error: "intel_error", message: "读取情报列表失败，请稍后重试", fingerprint: "intel-items-" + Math.floor(Math.random() * 1000000000).toString(36) })
  }
})

// ---------------------------------------------------------------------------
// POST /api/intel/cleanup-irrelevant — 存量不相关条目一键清理（先预览命中，确认后删除）
// 清理范围：我可见的蜘蛛采集条目（公共+我的）；手动录入条目不动。口径与采集过滤 v2 一致。
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/intel/cleanup-irrelevant", (e) => {
  try {
    var norm = function (s) { return String(s == null ? "" : s).trim() }
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || "")
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再清理情报" })
    var body = e.requestInfo().body || {}
    var doDelete = body.confirm === true
    // 相关性 v2 反向判定（与采集过滤同口径；按约定在回调内自持一份，不跨文件共享）
    var noiseRe = /版权|All Rights|ICP 备|备案号|友情链接|隐私政策|使用条款|网站地图/i
    var isIrrelevant = function (title, snippet) {
      var text = String(title || "") + " " + String(snippet || "")
      if (noiseRe.test(String(title || ""))) return true
      if (/电子病历|互联互通|智慧医院|互联网医院|卫生信息化|医疗信息化|医院信息|数字医院|智慧医疗|医保平台|远程医疗|全民健康|医疗数据|卫健|CDSS|临床决策|智慧病房|智慧服务|\bHIS\b|\bLIS\b|\bPACS\b|\bEMR\b|\bCDR\b|\bHRP\b/i.test(text)) return false
      var domainHit = /医疗|医院|卫生|临床|医保|卫健委|医疗机构/.test(text)
      var topicHit = /信息化|数字化|数字化转型|智慧|集成平台|数据中心|信创|国产化|人工智能|\bAI\b|等保|信息系统|信息平台/.test(text)
      var actionHit = /项目|建设|招标|中标|采购|比选|遴选|公告|公示|上线|开工|政策|规划|方案|测试|验收|升级|改造|转型|转变|集成|互联|实施|部署|标准|规范|通知|结果|评审|立项/.test(text)
      return !(domainHit && topicHit && actionHit)
    }
    var rows = $app.findRecordsByFilter("intel_items", "(visibility='public' || owner_id={:u}) && added_by='crawl'", "-created", 2000, 0, { u: userId })
    var bad = []
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i]
      var snip = String(r.get("content_snippet") || "") + " " + String(r.get("summary") || "")
      if (isIrrelevant(String(r.get("title") || ""), snip)) bad.push(r)
    }
    if (!doDelete) {
      var samples = []
      for (var s = 0; s < bad.length && s < 10; s++) samples.push(String(bad[s].get("title") || "").slice(0, 60))
      return e.json(200, { ok: true, confirm: false, count: bad.length, samples: samples })
    }
    var deleted = 0
    for (var d = 0; d < bad.length; d++) {
      try { $app.delete(bad[d]); deleted++ } catch (errD) { /* 单条失败不中断整批 */ }
    }
    $app.logger().info("intel cleanup done", "user", userId, "deleted", deleted)
    return e.json(200, { ok: true, confirm: true, deleted: deleted })
  } catch (ex) {
    $app.logger().error("intel cleanup failed", "err", String(ex))
    return e.json(500, { error: "intel_error", message: "清理失败，请稍后重试", fingerprint: "intel-cleanup-" + Math.floor(Math.random() * 1000000000).toString(36) })
  }
})

// ---------------------------------------------------------------------------
// GET /api/intel/prefs — 个人展示偏好（按账号隔离；无记录返回默认界面值）
// 默认：region_focus='' (全国) / focus_sources=[] (不锁源) / focus_topics=预设词表
// ---------------------------------------------------------------------------
routerAdd("GET", "/api/intel/prefs", (e) => {
  try {
    var norm = function (s) { return String(s == null ? "" : s).trim() }
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || "")
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再读取个人偏好" })
    var DEFAULT_TOPICS = ["HIS", "EMR", "集成平台", "数据中心", "人工智能", "信创", "智慧医院", "互联互通", "招标"]
    var rec = null
    try { rec = $app.findFirstRecordByFilter("intel_prefs", "owner_id={:u}", { u: userId }) } catch (err) { rec = null }
    if (!rec) {
      return e.json(200, { ok: true, is_default: true, prefs: { region_focus: "", focus_sources: [], focus_topics: DEFAULT_TOPICS } })
    }
    var parseList = function (rec2, fieldName) {
      var out = []
      try {
        var raw = rec2.getString(fieldName)
        if (raw) {
          var parsed = JSON.parse(raw)
          if (parsed && typeof parsed.length === "number") {
            for (var pi = 0; pi < parsed.length && out.length < 30; pi++) {
              var pv = norm(parsed[pi]).slice(0, 30)
              if (pv && out.indexOf(pv) < 0) out.push(pv)
            }
          }
        }
      } catch (errP) { out = [] }
      return out
    }
    return e.json(200, {
      ok: true,
      is_default: false,
      prefs: {
        region_focus: norm(rec.get("region_focus")).slice(0, 20),
        focus_sources: parseList(rec, "focus_sources"),
        focus_topics: parseList(rec, "focus_topics")
      }
    })
  } catch (ex) {
    $app.logger().error("intel prefs get failed", "err", String(ex))
    return e.json(500, { error: "intel_error", message: "读取个人偏好失败，请稍后重试", fingerprint: "intel-prefs-get-" + Math.floor(Math.random() * 1000000000).toString(36) })
  }
})

// ---------------------------------------------------------------------------
// POST /api/intel/prefs — 保存个人展示偏好（upsert 本人记录）
// body 三字段白名单归一化：region_focus ≤20 字；focus_sources / focus_topics
// 数组 ≤30 项、每项 ≤30 字、去空去重。
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/intel/prefs", (e) => {
  try {
    var norm = function (s) { return String(s == null ? "" : s).trim() }
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(h["x_rh_user_id"] || h["X-Rh-User-Id"] || h["x-rh-user-id"] || "")
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再保存个人偏好" })
    var body = e.requestInfo().body || {}
    var regionFocus = norm(body.region_focus).slice(0, 20)
    var normList = function (v) {
      var out = []
      if (v && typeof v === "object" && typeof v.length === "number") {
        for (var li = 0; li < v.length && out.length < 30; li++) {
          var lv = norm(v[li]).slice(0, 30)
          if (lv && out.indexOf(lv) < 0) out.push(lv)
        }
      }
      return out
    }
    var focusSources = normList(body.focus_sources)
    var focusTopics = normList(body.focus_topics)
    var rec = null
    try { rec = $app.findFirstRecordByFilter("intel_prefs", "owner_id={:u}", { u: userId }) } catch (err) { rec = null }
    if (!rec) {
      var coll = $app.findCollectionByNameOrId("intel_prefs")
      rec = new Record(coll)
      rec.set("owner_id", userId)
    }
    rec.set("region_focus", regionFocus)
    rec.set("focus_sources", focusSources)
    rec.set("focus_topics", focusTopics)
    $app.save(rec)
    $app.logger().info("intel prefs saved", "user", userId, "region", regionFocus, "sources", focusSources.length, "topics", focusTopics.length)
    return e.json(200, {
      ok: true,
      prefs: { region_focus: regionFocus, focus_sources: focusSources, focus_topics: focusTopics }
    })
  } catch (ex) {
    $app.logger().error("intel prefs save failed", "err", String(ex))
    return e.json(500, { error: "intel_error", message: "保存个人偏好失败，请稍后重试", fingerprint: "intel-prefs-save-" + Math.floor(Math.random() * 1000000000).toString(36) })
  }
})

// pb_hooks/competitor_evidence.pb.js — 竞品分析外部权威源拉回（批次 X2）
//
// 3 个 POST 路由，全部要求 X-Rh-User-Id 头；任一失败静默回退空数组，不阻断 X1 内部事实分析：
//   1) /api/competitor-evidence/bid-records        — 中国政府采购网按厂商搜索中标结果
//   2) /api/competitor-evidence/listed-announcements — 上市公司公告（SSE/SZSE）
//   3) /api/competitor-evidence/copyright-live     — 中国版权保护中心实时软著
//
// 设计约束：
//   - 外发内容仅公司名 / 法人名 / 时间窗口，不含我方客户名单与内部方案（合规红线）
//   - 政府站 .gov.cn 走 r.jina.ai 代理（同 intel_center 批次 A 口径）；CFCA/SM2 国密证书直连必失败
//   - 每路由 $http.send timeout ≤ 8s；单次调用总预算前端限 3s（并行），失败静默
//   - Goja 并发安全：所有 helper self-contained 在回调内；只用 var / function
//   - 日志：$app.logger().info("competitor-evidence", ...) 便于审计
//   - 不入库（避免与情报中心 intel_items 混）；每次现拉，用完即弃

// ---------------------------------------------------------------------------
// POST /api/competitor-evidence/bid-records
//   body: { company: string, legal_name?: string, window_days?: number }
//   res:  { records: [{ id, title, url, published_at, buyer, amount_raw }], error?: string }
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/competitor-evidence/bid-records", (e) => {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })

    var body = e.requestInfo().body || {}
    var company = String(body.company || "").trim().slice(0, 40)
    var legalName = String(body.legal_name || "").trim().slice(0, 60)
    var windowDays = parseInt(String(body.window_days || "730"), 10) || 730
    if (windowDays < 30) windowDays = 30
    if (windowDays > 1825) windowDays = 1825
    if (!company && !legalName) return e.json(200, { records: [], error: "缺少 company 或 legal_name" })

    var q = company || legalName
    var __UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "zh-CN,zh;q=0.9" }

    // ccgp 检索 URL：结果列表 HTML 里含 <a href="...ggg...">标题</a> + <span class="time">YYYY-MM-DD</span>
    // 该站非 .gov.cn 结尾但同为政府采购官方站，直连一般可用；若失败则回退 jina 代理
    var searchUrl = "http://search.ccgp.gov.cn/bxsearch?searchtype=2&page_index=1&bidType=0&kw=" + encodeURIComponent(q)
    var html = ""
    try {
      var r1 = $http.send({ url: searchUrl, method: "GET", headers: __UA, timeout: 6 })
      if (r1 && r1.statusCode === 200 && typeof r1.raw === "string") html = r1.raw.slice(0, 400000)
    } catch (err1) {
      try {
        var r2 = $http.send({ url: "https://r.jina.ai/" + searchUrl, method: "GET", headers: __UA, timeout: 8 })
        if (r2 && r2.statusCode === 200 && typeof r2.raw === "string") html = String(r2.raw).slice(0, 400000)
      } catch (err2) {
        return e.json(200, { records: [], error: "外部站点不可达：" + String(err2 && err2.message || err2) })
      }
    }
    if (!html) return e.json(200, { records: [], error: "未拿到列表页内容" })

    // 简易抓取：匹配 <a href="(ccgp 详细 URL)" ...>(标题)</a> ... <span class="time">YYYY-MM-DD</span>
    // 不追求完美（HTML 解析在 Goja 里成本过高），命中即返回，前端二次展示时若字段缺失会自然降级。
    var decodeEnt = function (s) {
      return String(s || "")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&#x([0-9a-fA-F]+);/g, function (m2, hh) { try { return String.fromCharCode(parseInt(hh, 16)) } catch (e) { return " " } })
        .replace(/&#(\d+);/g, function (m3, dd) { try { return String.fromCharCode(parseInt(dd, 10)) } catch (e) { return " " } })
    }

    var now = new Date().getTime()
    var cutoff = now - windowDays * 24 * 3600 * 1000
    var records = []
    var seen = {}
    // ccgp 结果列表常见结构：<ul class="vT_js_list_lineA clearfix"><li>... <a href="URL" ...>TITLE</a> ... <span class="time">DATE</span>
    var re = /<a[^>]+href="(https?:\/\/[^"]*ccgp[^"]*|https?:\/\/www\.ccgp\.gov\.cn[^"]*)"[^>]*>([^<]{8,200})<\/a>[\s\S]{0,600}?<span[^>]*class="[^"]*time[^"]*"[^>]*>\s*(\d{4}-\d{2}-\d{2})/gi
    var m
    while ((m = re.exec(html)) !== null && records.length < 20) {
      var url = m[1]
      var title = decodeEnt(String(m[2]).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
      var pubDate = m[3]
      if (!title || title.length < 8) continue
      if (seen[url]) continue
      seen[url] = true
      var ts = new Date(pubDate + "T00:00:00Z").getTime()
      if (ts && ts < cutoff) continue
      // 从 title 简单提取"XX医院/XX中心"作为 buyer 猜测；无强匹配则空
      var buyerMatch = title.match(/([^，,（(]{2,25}(?:医院|卫生中心|卫生院|卫生健康委|卫健|保健院|疾病控制|医学中心))/)
      var buyer = buyerMatch ? buyerMatch[1] : ""
      // 金额不在列表页出现，留空（前端不显示）
      records.push({
        id: String(records.length + 1) + "-" + pubDate,
        title: title.slice(0, 200),
        url: url,
        published_at: pubDate,
        buyer: buyer.slice(0, 60),
        amount_raw: "",
      })
    }
    try { $app.logger().info("competitor-evidence", "bid-records", "uid=" + uid, "q=" + q, "hits=" + records.length) } catch (_) {}
    return e.json(200, { records: records })
  } catch (err) {
    try { $app.logger().error("competitor-evidence bid-records 500", String(err && err.message || err)) } catch (_) {}
    return e.json(500, { error: "internal", message: "外部源抓取异常", fingerprint: "ce-bid-" + new Date().getTime() })
  }
})

// ---------------------------------------------------------------------------
// POST /api/competitor-evidence/listed-announcements
//   body: { legal_name: string }
//   res:  { announcements: [{ id, title, url, published_at, exchange }], error?: string }
//
// X2 首批实现：走东方财富/巨潮的公开搜索接口不稳定 + 需要 CSRF，本次先返回空 + 明确原因；
// 若后续接入官方 API 或有稳定爬虫，替换实现即可，前端 API 契约不变。
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/competitor-evidence/listed-announcements", (e) => {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var body = e.requestInfo().body || {}
    var legalName = String(body.legal_name || "").trim().slice(0, 60)
    if (!legalName) return e.json(200, { announcements: [], error: "缺少 legal_name" })

    // 巨潮资讯 (cninfo) 公开搜索：POST 需要 form 参数 + Referer；先尝试一次，失败退回空
    var html = ""
    var __UA = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": "http://www.cninfo.com.cn/new/fulltextSearch?notautosubmit=&keyWord=",
      "X-Requested-With": "XMLHttpRequest",
    }
    try {
      var form = "product=column_cninfo&column=search_history&type=&searchtext=" + encodeURIComponent(legalName) + "&sortType=time&pageSize=20&pageNum=1"
      var r1 = $http.send({ url: "http://www.cninfo.com.cn/new/fulltextSearch/full", method: "POST", headers: __UA, body: form, timeout: 6 })
      if (r1 && r1.statusCode === 200 && typeof r1.raw === "string") html = r1.raw
    } catch (err1) {
      html = ""
    }
    if (!html) {
      return e.json(200, {
        announcements: [],
        error: "外部接口不稳定（cninfo 无响应），回退空数组；如需该维度请手工补充",
      })
    }
    var parsed = null
    try { parsed = JSON.parse(html) } catch (_) { parsed = null }
    var list = (parsed && Array.isArray(parsed.anns)) ? parsed.anns : []
    var out = []
    for (var i = 0; i < list.length && out.length < 10; i++) {
      var it = list[i] || {}
      var title = String(it.title || it.secureName || "").replace(/<[^>]+>/g, "").trim()
      if (!title) continue
      var url = String(it.url || it.urlPre || "")
      var pubAt = String(it.date || it.noticeDate || "").slice(0, 10)
      out.push({
        id: String(it.announcementId || ("ann-" + i)),
        title: title.slice(0, 200),
        url: url,
        published_at: pubAt,
        exchange: String(it.column || it.exchangeName || "").slice(0, 20),
      })
    }
    try { $app.logger().info("competitor-evidence", "listed-announcements", "uid=" + uid, "name=" + legalName, "hits=" + out.length) } catch (_) {}
    return e.json(200, { announcements: out })
  } catch (err) {
    try { $app.logger().error("competitor-evidence listed-announcements 500", String(err && err.message || err)) } catch (_) {}
    return e.json(500, { error: "internal", message: "外部源解析异常", fingerprint: "ce-ann-" + new Date().getTime() })
  }
})

// ---------------------------------------------------------------------------
// POST /api/competitor-evidence/copyright-live
//   body: { owner: string }
//   res:  { available: false, reason: string } — X2 首批固定返回不可用，UI 明确显示回退到本地基线
//
// 说明：中国版权保护中心 (ccopyright.com.cn) 查询接口有验证码与频控，不适合作为服务端定时拉取源；
//      当前使用本地 13,505 条 Excel 基线（public/data/competitor-copyrights.json），登记事实可核对。
//      若批次 X2.5 引入第三方版权数据 API，替换本路由实现即可，前端契约保持 available/reason 两字段。
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/competitor-evidence/copyright-live", (e) => {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var body = e.requestInfo().body || {}
    var owner = String(body.owner || "").trim().slice(0, 60)
    // 保留 owner 参数以便未来切换；当前固定回退
    return e.json(200, {
      available: false,
      reason: owner
        ? "外部接口暂不可用（版权保护中心接口有验证码），已回退本地 13,505 条 Excel 基线"
        : "缺少 owner；已回退本地基线",
    })
  } catch (err) {
    try { $app.logger().error("competitor-evidence copyright-live 500", String(err && err.message || err)) } catch (_) {}
    return e.json(500, { error: "internal", message: "路由异常", fingerprint: "ce-crx-" + new Date().getTime() })
  }
})

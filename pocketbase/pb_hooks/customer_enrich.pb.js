/// <reference path="../pb_data/types.d.ts" />
// pb_hooks/customer_enrich.pb.js — 客户官网抓取补全（R-210）
//
// 目标：给一个医院名（+可选官网），服务端抓取医院官网首页与"医院概况/简介"页，
//       去掉 HTML 标签后返回干净正文，供前端复用既有的"文本→大模型抽取→回填档案"管线。
// 设计：本文件只做"抓取 + 清洗正文"，不调用大模型、不写库；抽取/回填/成本确认全部在
//       前端（useCustomerManagement.runFetchSite）复用 buildExtractMessages/parseProfileJson。
// 约定：Goja 回调自持 helper，不跨文件共享；鉴权沿用 X-Rh-User-Id 头（与 intel fetch-url 一致）。
// 编码：utf-8 页直接取正文；GBK/GB2312/GB18030 老站回传原始字节(base64)，由前端 TextDecoder 解码（见返回体 binSections）。
//       医院门诊量/床位/领导常在子页：本 handler 会多页抓取（概况/领导二级详情/信息公开）+ 百科/公示/年报兜底，
//       按段配额不互相截断。抓取为尽力而为，结果需人工核实（前端已用 ai_generated_fields 标注）。

// POST /api/customers/fetch-site  body: { name: string, website?: string }
// 返回: { ok, url, introUrl, title, text, message? }
routerAdd("POST", "/api/customers/fetch-site", (e) => {
  var norm = function (s) { return String(s == null ? "" : s).trim() }
  var unesc = function (s) {
    return String(s)
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&ldquo;|&rdquo;|&mdash;|&hellip;/g, " ").replace(/&#\d+;/g, " ")
  }
  var absUrl = function (href, base) {
    var h = String(href).replace(/#.*$/, "")
    if (/^https?:\/\//i.test(h)) return h
    if (/^\/\//.test(h)) return "https:" + h
    if (/^\//.test(h)) {
      var bm = String(base).match(/^(https?:\/\/[^\/]+)/i)
      return bm ? bm[1] + h : ""
    }
    var dir = String(base).replace(/\/[^\/]*$/, "/")
    return dir + h
  }
  // 去标签→干净可读正文：删脚本/样式/注释，标签转空格，实体还原，压缩空白
  var cleanText = function (html, cap) {
    var t = String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(noscript|svg|iframe)[\s\S]*?<\/\1>/gi, " ")
    t = t.replace(/<[^>]+>/g, " ")
    t = unesc(t)
    // 去除不可见字符与多余空白
    t = t.replace(/\u3000/g, " ").replace(/[\t\r]+/g, " ").replace(/ {2,}/g, " ").replace(/\n{2,}/g, "\n").trim()
    return t.slice(0, cap || 6000)
  }
  // jina 代理兜底（r.jina.ai）：2026-10-09 R215 实测本地网络不可达(000 超时)——
  // 退化为「末次直抓一次」：新拨连接再试原 URL，仍失败返回 null（绝不向上抛，
  // 修复此前 tryJina 未定义导致 fetchHtml/fetchPageObj 兜底分支直接 ReferenceError 崩溃）。
  var tryJina = function (url) {
    try {
      var res = $http.send({
        url: url, method: "GET", timeout: 20,
                  headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Referer": String(url).replace(/^(https?:\/\/[^/]+).*/i, "$1/")
          }
      })
      if (res && res.statusCode === 200 && typeof res.raw === "string" && res.raw.length > 200) return res.raw
    } catch (eCap) { try { console.log("cfs-catch", "where", "tryJina", "err", String(eCap)) } catch (_) {} }
    return null
  }
  var fetchHtml = function (url) {
    // 2026-10-07 P18：PB $http.send 复用已断开的 keep-alive 连接会抛 GoError: EOF 且不自动重试——
    // 空闲后首个请求必失败。此处显式重试一次（新拨连接），仍失败再走 jina 代理。
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        var res = $http.send({
          url: url, method: "GET", timeout: 15,
                    headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Referer": String(url).replace(/^(https?:\/\/[^/]+).*/i, "$1/")
          }
        })
        if (res.statusCode !== 200) {
          var jh1 = tryJina(url)
          if (jh1) return jh1
          return null
        }
        return typeof res.raw === "string" ? res.raw.slice(0, 800000) : null
      } catch (err) {
        if (attempt === 0) continue
        var jh2 = tryJina(url)
        if (jh2) return jh2
        return null
      }
    }
    return null
  }
  // 从官网首页里找"医院概况/简介/介绍"类内链
  var findIntroLink = function (html, base) {
    var re = /<a\s[^>]*?href\s*=\s*["']([^"'\s>]+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi
    var m, seen = {}
    while ((m = re.exec(html)) !== null) {
      var href = unesc(m[1]).trim()
      var label = unesc(String(m[2]).replace(/<[^>]+>/g, " ")).replace(/\s+/g, "").trim()
      if (/^(javascript|mailto|tel):/i.test(href)) continue
      if (!/医院概况|医院简介|医院介绍|走进医院|走进我们|医院情况|医院情况|总机|概况|简介|About/i.test(label)) continue
      var full = absUrl(href, base)
      if (!/^https?:\/\//i.test(full) || seen[full]) continue
      seen[full] = true
      return full
    }
    return ""
  }
  // 通用：按标签文本正则收集内链（用于"领导班子""信息公开/预决算"等补充页），最多 limit 个
  var findLinksByLabel = function (html, base, labelRe, limit) {
    var re = /<a\s[^>]*?href\s*=\s*["']([^"'\s>]+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi
    var out = [], seen = {}, m
    while ((m = re.exec(html)) !== null) {
      var href = unesc(m[1]).trim()
      var label = unesc(String(m[2]).replace(/<[^>]+>/g, " ")).replace(/\s+/g, "").trim()
      if (/^(javascript|mailto|tel):/i.test(href)) continue
      if (!labelRe.test(label)) continue
      var full = absUrl(href, base)
      if (!/^https?:\/\//i.test(full) || seen[full]) continue
      seen[full] = true
      out.push(full)
      if (out.length >= (limit || 2)) break
    }
    return out
  }
  // 抓一个页面的正文（去标签），带每页字数上限
  var fetchPageText = function (url, cap) {
    var h = fetchHtml(url)
    if (!h) return ""
    var bM = h.match(/<body[^>]*>([\s\S]*)<\/body>/i)
    return cleanText(bM ? bM[1] : h, cap || 2500)
  }

  // 收集候选真实图片：og:image 优先，其次正文 <img>（含懒加载属性）；过滤 logo/图标/二维码/超大方向
  var collectImages = function (html, base) {
    var out = []
    var seen = {}
    var bad = /logo|icon|sprite|avatar|qr|qrcode|weixin|wechat|wechatmp|1x1|spacer|blank|loading|placeholder|emotion|favicon|banner-bg|bg\.|background|nav-|btn-|close|arrow/i
    var push = function (u) {
      u = unesc(String(u || "")).trim()
      if (!u || /^data:/i.test(u)) return
      var full = absUrl(u, base)
      if (!/^https?:\/\/\w/i.test(full)) return
      if (bad.test(full)) return
      if (seen[full]) return
      seen[full] = true
      out.push(full)
    }
    var og = html.match(/<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']+)["']/i)
    if (og) push(og[1])
    var re = /<img\b[^>]*>/gi
    var m
    while ((m = re.exec(html)) !== null) {
      var tag = m[0]
      // 明显很小的图（width/height < 100）跳过
      var w = tag.match(/\bwidth\s*=\s*["']?(\d+)/i)
      var h = tag.match(/\bheight\s*=\s*["']?(\d+)/i)
      if ((w && +w[1] < 100) || (h && +h[1] < 100)) continue
      var src =
        (tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1] ||
        (tag.match(/\bdata-original\s*=\s*["']([^"']+)["']/i) || [])[1] ||
        (tag.match(/\bdata-src\s*=\s*["']([^"']+)["']/i) || [])[1] ||
        (tag.match(/\bdata-lazy-src\s*=\s*["']([^"']+)["']/i) || [])[1]
      push(src)
      if (out.length >= 24) break
    }
    return out.slice(0, 16)
  }

  // Bing 搜索发现官网（best-effort；被拦则失败）
  var discoverSite = function (name) {
    var q = encodeURIComponent(name + " 官网")
    var html = fetchHtml("https://www.bing.com/search?q=" + q)
    if (!html) return ""
    var re = /<h2[^>]*>\s*<a[^>]*?href\s*=\s*["'](https?:\/\/[^"']+)["']/gi
    var m
    while ((m = re.exec(html)) !== null) {
      var u = unesc(m[1])
      if (/bing\.com|microsoft|\.msn\.|baike\.|baidu|sohu|so\.com|zhihu|weixin|gov\.cn\/navi/i.test(u)) continue
      return u
    }
    return ""
  }

  // 把原始字节 Array<number> 转 base64（Goja 无 btoa；供 GBK 页回传前端原生 TextDecoder 解码）
  var B64C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  var bytesToB64 = function (bytes) {
    var out = "", i = 0, n = bytes.length
    for (; i + 2 < n; i += 3) {
      var c1 = bytes[i] & 255, c2 = bytes[i + 1] & 255, c3 = bytes[i + 2] & 255
      out += B64C.charAt(c1 >> 2) + B64C.charAt(((c1 & 3) << 4) | (c2 >> 4)) + B64C.charAt(((c2 & 15) << 2) | (c3 >> 6)) + B64C.charAt(c3 & 63)
    }
    var rem = n - i
    if (rem === 1) { var a = bytes[i] & 255; out += B64C.charAt(a >> 2) + B64C.charAt((a & 3) << 4) + "==" }
    else if (rem === 2) { var a1 = bytes[i] & 255, a2 = bytes[i + 1] & 255; out += B64C.charAt(a1 >> 2) + B64C.charAt(((a1 & 3) << 4) | (a2 >> 4)) + B64C.charAt((a2 & 15) << 2) + "=" }
    return out
  }
  // 从响应头/meta 判定字符集；返回 'utf8' 或 TextDecoder 可用的 gbk/gb18030 标签
  var detectEncoding = function (res, headStr) {
    var cs = ""
    try {
      var hh = (res && res.headers && (res.headers["Content-Type"] || res.headers["content-type"])) || []
      if (hh[0]) { var m0 = String(hh[0]).match(/charset\s*=\s*["']?([\w-]+)/i); if (m0) cs = m0[1] }
    } catch (_) {}
    if (!cs && headStr) { var mm = String(headStr).slice(0, 4096).match(/<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i); if (mm) cs = mm[1] }
    cs = String(cs).toLowerCase()
    if (/gb18030/.test(cs)) return "gb18030"
    if (/gbk|gb_2312|gb2312/.test(cs)) return "gbk"
    return "utf8"
  }
  // 抓取页面：utf8 返回 {enc:'utf8', html}；非 utf8 返回 {enc, b64, html(乱码仅用于提链接)}
  var fetchPageObj = function (url) {
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
      var res = $http.send({
        url: url, method: "GET", timeout: 15,
                  headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Referer": String(url).replace(/^(https?:\/\/[^/]+).*/i, "$1/")
          }
      })
      if (!res || res.statusCode !== 200) {
        if (/\.gov\.cn/i.test(url)) {
          var jmd = tryJina(url)
          if (jmd) return { enc: "utf8", html: "<body>" + jmd + "</body>", b64: "" }
        }
        if (attempt === 0) continue
        return null
      }
      var raw = typeof res.raw === "string" ? res.raw : ""
      var enc = detectEncoding(res, raw)
      if (enc !== "utf8") {
        var bytes = res.body
        if (!bytes || bytes.length == null) return { enc: enc, html: raw, b64: "" }
        var capped = bytes.length > 240000 ? bytes.slice(0, 240000) : bytes
        return { enc: enc, html: raw, b64: bytesToB64(capped) }
      }
      return { enc: "utf8", html: raw.slice(0, 800000), b64: "" }
      } catch (err) {
        if (attempt === 0) continue
        if (/\.gov\.cn/i.test(url)) {
          var jmd2 = tryJina(url)
          if (jmd2) return { enc: "utf8", html: "<body>" + jmd2 + "</body>", b64: "" }
        }
        return null
      }
    }
    return null
  }
  // 按标签正则 OR href 关键词提内链（GBK 站标签乱码时靠 href 兜底），最多 limit 个
  var findLinksByHints = function (html, base, labelRe, hrefRe, limit) {
    var re = /<a\s[^>]*?href\s*=\s*["']([^"'\s>]+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi
    var out = [], seen = {}, m
    while ((m = re.exec(html)) !== null) {
      var href = unesc(m[1]).trim()
      var label = unesc(String(m[2]).replace(/<[^>]+>/g, " ")).replace(/\s+/g, "").trim()
      if (/^(javascript|mailto|tel):/i.test(href)) continue
      if (!((labelRe && labelRe.test(label)) || (hrefRe && hrefRe.test(href)))) continue
      var full = absUrl(href, base)
      if (!/^https?:\/\//i.test(full) || seen[full]) continue
      seen[full] = true
      out.push(full)
      if (out.length >= (limit || 2)) break
    }
    return out
  }

  try {
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(String(e.get("rhUserId") || ""))
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再抓取官网" })
    var body = e.requestInfo().body || {}
    var name = norm(body.name).slice(0, 80)
    if (!name) return e.json(200, { ok: false, code: "bad_request", message: "缺少医院名称" })

    var site = norm(body.website || body.url).slice(0, 500)
    if (site && !/^https?:\/\//i.test(site)) site = "https://" + site.replace(/^\/+/, "")

    // direct 模式：把传入的 URL 当作具体文章页（如公众号文章链接）直接抓正文，不做官网发现
    if (body.direct) {
      if (!site) return e.json(200, { ok: false, code: "bad_request", message: "粘贴链接补全需要提供文章地址" })
      var dHtml = fetchHtml(site)
      if (!dHtml) return e.json(200, { ok: false, code: "fetch_failed", url: site, message: "链接打不开或超时（微信文章可能有防盗链/需登录）：" + site })
      var dTitle = ""
      var dtm = dHtml.match(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i)
      if (dtm) dTitle = unesc(dtm[1]).replace(/\s+/g, " ").trim()
      var dBody = dHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)
      var dText = cleanText(dBody ? dBody[1] : dHtml, 7000)
      if (!dText || dText.length < 30) return e.json(200, { ok: false, code: "thin_page", url: site, message: "该链接正文过少或需 JS 渲染/需登录，无法抽取" })
      $app.logger().info("customer fetch-site direct ok", "user", userId, "url", site, "len", dText.length)
      return e.json(200, { ok: true, url: site, title: dTitle.slice(0, 200), text: dText, images: [] })
    }

    if (!site) {
      site = discoverSite(name)
      if (!site) return e.json(200, { ok: false, code: "no_site", message: "未提供官网且自动发现失败，请先在档案填写官网或用「AI匹配」补全官网后重试" })
    }

    var homeObj = fetchPageObj(site)
    if (!homeObj || !homeObj.html) return e.json(200, { ok: false, code: "fetch_failed", url: site, message: "官网打不开或超时：" + site })
    var homeHtml = homeObj.html

    var title = ""
    var tm = homeHtml.match(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i)
    if (tm) title = unesc(tm[1]).replace(/\s+/g, " ").trim()

    var text = ""
    var binSections = []
    var sources = []
    var TOTAL = 16000

    // 按段配额累加：utf8 段清洗后并入 text；非 utf8 段回推原始字节交由前端解码（不占用 text 预算）
    var pushObj = function (label, obj, budget) {
      if (!obj) return
      if (obj.enc && obj.enc !== "utf8") {
        if (obj.b64) { binSections.push({ label: label, encoding: obj.enc, bytesB64: obj.b64 }); if (sources.indexOf(label) < 0) sources.push(label) }
        return
      }
      if (!obj.html || text.length >= TOTAL) return
      var bM = obj.html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
      var t = cleanText(bM ? bM[1] : obj.html, Math.min(budget, TOTAL - text.length))
      if (t && t.length > 15) { text += (text ? "\n" : "") + "【" + label + "】\n" + t; if (sources.indexOf(label) < 0) sources.push(label) }
    }

    // 概况（首页正文兜底 + 最多 2 个概况内链）
    var introUrls = findLinksByHints(homeHtml, site, /医院概况|医院简介|医院介绍|走进医院|走进我们|医院情况|概况|简介|About/i, /gywm|yygk|about|jianjie|introduce|profile/i, 2)
    var introOk = false
    for (var ii = 0; ii < introUrls.length; ii++) {
      var iobj = fetchPageObj(introUrls[ii])
      if (iobj && (iobj.b64 || (iobj.html && iobj.html.length > 200))) { var before = text.length; pushObj("医院概况", iobj, 6000); if (text.length > before || iobj.b64) introOk = true }
    }
    if (!introOk) pushObj("官网首页", homeObj, 3000)

    // 领导班子（列表页 + 跟进二级详情页，喂给 leadership[]）
    var leaderUrls = findLinksByHints(homeHtml, site, /领导班子|现任领导|领导团队|医院领导|党政领导|领导之窗/, /ldjs|lingdao|lead|leader|executive/i, 2)
    var leaderPages = 0
    for (var li = 0; li < leaderUrls.length && leaderPages < 6; li++) {
      var lobj = fetchPageObj(leaderUrls[li])
      if (!lobj) continue
      pushObj("领导班子", lobj, 3000); leaderPages++
      if (!lobj.html) continue
      var sub = findLinksByHints(lobj.html, leaderUrls[li], /院长|书记|副院长|总会计师|纪委书记|党委副书记|主任|委员/, /detail|content|show|news|item|\.html|p-\d/i, 6)
      for (var si = 0; si < sub.length && leaderPages < 6; si++) {
        var sobj = fetchPageObj(sub[si])
        if (sobj && (sobj.b64 || (sobj.html && sobj.html.length > 200))) { pushObj("领导班子", sobj, 1500); leaderPages++ }
      }
    }

    // 信息公开/预决算（年收入）
    var finUrls = findLinksByHints(homeHtml, site, /信息公开|预决算|部门决算|决算公开|财务公开|年度预算|预算决算/, /xxgk|ysjs|juesuan|budget|finance|annual|report/i, 2)
    for (var fi = 0; fi < finUrls.length; fi++) pushObj("信息公开·预决算", fetchPageObj(finUrls[fi]), 2500)

    // 多来源兜底（best-effort：百科/公示/年报），失败只跳过、不阻塞官网主路径
    var searchFetch = function (query, label) {
      try {
        var r = fetchPageObj("https://www.bing.com/search?q=" + encodeURIComponent(query))
        if (!r || !r.html) return
        var re = /<h2[^>]*>\s*<a[^>]*?href\s*=\s*["'](https?:\/\/[^"']+)["']/gi
        var m
        while ((m = re.exec(r.html)) !== null) {
          var u = unesc(m[1])
          if (/bing\.com|microsoft|\.msn\.|aiqicha|qcc|tianyancha|360\.com|so\.com|weixin|\/privacy|\/settings|\/account/i.test(u)) continue
          pushObj(label, fetchPageObj(u), 2500)
          break
        }
      } catch (_) {}
    }
    if (text.length < TOTAL) searchFetch(name + " 百度百科 医院 等级 床位", "百科")
    if (text.length < TOTAL) searchFetch(name + " 卫生健康委 医院等级 评审 公示", "公示")
    if (text.length < TOTAL) searchFetch(name + " 部门决算 预算公开 收支", "年报")

    text = text.slice(0, TOTAL)
    if ((!text || text.length < 30) && binSections.length === 0) {
      return e.json(200, { ok: false, code: "thin_page", url: site, message: "已打开官网但正文过少（可能是图片站/需JS渲染），可改用「AI匹配」或粘贴简介文本" })
    }

    $app.logger().info("customer fetch-site ok", "user", userId, "name", name, "url", site, "intro", introUrls[0] || "-", "len", text.length, "bin", binSections.length)
    var images = collectImages(homeHtml, site)

    // ---- 商机线索（2026-10-07 用户需求：从医院官网/卫健委/政府网站同步信息化相关商机） ----
    // 只收标题带「信息化/智慧/系统/平台/软件/数据/信创/电子病历/互联互通/评级」等 IT 词的公告；
    // 设备采购/食堂/后勤/基建类自然被滤掉。每条 {title,url,src}，最多 15 条，尽力而为不阻塞主路径。
    var leadsError = ""
    try {
    var itRe = /信息化|智慧|智能|系统集成|信息平台|软件|数据中台|数据中心|数据治理|信创|国产化|互联网医院|电子病历|互联互通|医院信息|医疗信息|HIS|EMR|LIS|PACS|RIS|评级|测评|等保|机房|网络安全|运维服务|升级改造|一体化/i
    var leads = []
    var leadSeen = {}
    var pushLead = function (lt, lu, ls) {
      lt = unesc(String(lt || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
      lu = String(lu || "")
      if (lt.length < 10 || lt.length > 120) return
      if (!/^https?:\/\//i.test(lu)) return
      if (!itRe.test(lt)) return
      var key = lt.slice(0, 24)
      if (leadSeen[key]) return
      leadSeen[key] = true
      leads.push({ title: lt.slice(0, 120), url: lu.slice(0, 500), src: ls })
    }
    var collectLeadAnchors = function (html, base, srcName) {
      var re = /<a\s[^>]*?href\s*=\s*["']([^"'\s>]+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi
      var m
      while ((m = re.exec(html)) !== null && leads.length < 12) {
        var href = unesc(m[1]).trim()
        var label = unesc(String(m[2]).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
        if (/^(javascript|mailto|tel):/i.test(href)) continue
        if (label.length < 10 || label.length > 120) continue
        if (!/(公告|招标|采购|中标|遴选|成交|结果公示|询价|竞争性磋商)/.test(label) && !/zhaobiao|zbgg|cggg|zhongbiao|gonggao/i.test(href)) continue
        pushLead(label, absUrl(href, base), srcName)
      }
    }
    // ① 官网首页公告类锚点 + 通知公告/招标采购栏目页（1 层）
    collectLeadAnchors(homeHtml, site, "官网")
    var noticeUrls = findLinksByHints(homeHtml, site, /通知公告|公告公示|招标采购|院内公告|采购信息|招标信息/, /zbgg|zhaobiao|cggg|zhongbiao|gonggao|tongzhi|news|notice/i, 2)
    for (var ni2 = 0; ni2 < noticeUrls.length && leads.length < 12; ni2++) {
      var nobj2 = fetchPageObj(noticeUrls[ni2])
      if (nobj2 && nobj2.html) collectLeadAnchors(nobj2.html, noticeUrls[ni2], "官网·公告栏")
    }
    // ② 卫健委/政府网站/权威源检索（Bing best-effort；gov.cn 优先，全部须信息化相关）
    var govQueries = [name + " 信息化 招标公告", name + " 信息化建设 中标 结果公示"]
    for (var qi = 0; qi < govQueries.length && leads.length < 15; qi++) {
      var shtml = fetchHtml("https://www.bing.com/search?q=" + encodeURIComponent(govQueries[qi]))
      if (!shtml) continue
      var sre = /<h2[^>]*>\s*<a[^>]*?href\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi
      var sm
      while ((sm = sre.exec(shtml)) !== null && leads.length < 15) {
        var su = unesc(sm[1])
        var st = unesc(String(sm[2]).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
        if (/bing\.com|microsoft|\.msn\.|baike\.|baidu|sohu|zhihu|weixin|so\.com|qcc|tianyancha/i.test(su)) continue
        if (st.length < 10 || st.length > 120) continue
        if (!itRe.test(st)) continue
        var skey2 = st.slice(0, 24)
        if (leadSeen[skey2]) continue
        leadSeen[skey2] = true
        leads.push({ title: st.slice(0, 120), url: su.slice(0, 500), src: /\.gov\.cn/i.test(su) ? "政府网站" : "权威检索" })
      }
    }
    } catch (exLeads) { leadsError = String(exLeads && exLeads.message || exLeads) }

    return e.json(200, { ok: true, url: site, introUrl: introUrls[0] || "", title: title.slice(0, 200), text: text, binSections: binSections, sources: sources, images: images, leads: leads, leadsError: leadsError })
  } catch (ex) {
    $app.logger().error("customer fetch-site failed", "err", String(ex))
    return e.json(500, { error: "fetch_site_failed", message: "抓取官网失败：" + String(ex).slice(0, 200), fingerprint: "cfs-" + Math.floor(Math.random() * 1e9).toString(36) })
  }
})

// POST /api/customers/fetch-image  body: { url: string }
// 目的：服务端代下载远程图片并返回 dataURL，绕开浏览器跨域/画布污染，供导出 .pptx 直接嵌入。
// 返回: { ok, dataUrl, mime, bytes }  或  { ok:false, code, message }
routerAdd("POST", "/api/customers/fetch-image", (e) => {
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  // 手写 base64（Goja 无 btoa）：输入按“每 charCode 即一字节”的原始字节串
  var b64encode = function (bytes) {
    var out = ""
    var i = 0
    var n = bytes.length
    for (; i + 2 < n; i += 3) {
      var c1 = bytes[i] & 255, c2 = bytes[i + 1] & 255, c3 = bytes[i + 2] & 255
      out += B64.charAt(c1 >> 2) + B64.charAt(((c1 & 3) << 4) | (c2 >> 4)) +
        B64.charAt(((c2 & 15) << 2) | (c3 >> 6)) + B64.charAt(c3 & 63)
    }
    var rem = n - i
    if (rem === 1) {
      var a = bytes[i] & 255
      out += B64.charAt(a >> 2) + B64.charAt((a & 3) << 4) + "=="
    } else if (rem === 2) {
      var a1 = bytes[i] & 255, a2 = bytes[i + 1] & 255
      out += B64.charAt(a1 >> 2) + B64.charAt(((a1 & 3) << 4) | (a2 >> 4)) + B64.charAt((a2 & 15) << 2) + "="
    }
    return out
  }
  var guessMime = function (url) {
    var u = String(url).toLowerCase()
    if (/\.png(\?|#|$)/.test(u)) return "image/png"
    if (/\.gif(\?|#|$)/.test(u)) return "image/gif"
    if (/\.webp(\?|#|$)/.test(u)) return "image/webp"
    if (/\.(bmp|svg)(\?|#|$)/.test(u)) return "image/svg+xml"
    return "image/jpeg"
  }
  try {
    var h = (e.requestInfo() || {}).headers || {}
    var userId = String(e.get("rhUserId") || "")
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录" })
    var body = e.requestInfo().body || {}
    var url = String(body.url || "").trim().slice(0, 1000)
    if (!/^https?:\/\/\w/i.test(url)) return e.json(200, { ok: false, code: "bad_request", message: "图片地址无效" })

    var res = $http.send({
      url: url,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Referer": url.replace(/^(https?:\/\/[^/]+).*/i, "$1/"),
      },
      timeout: 20,
    })
    var status = res && res.statusCode ? res.statusCode : 0
    if (status < 200 || status >= 400) {
      return e.json(200, { ok: false, code: "http_" + status, message: "图片下载失败（HTTP " + status + "）" })
    }
    var bytes = res.body // 原始字节切片（Array<number>），不经 UTF-8 解码，无损
    if (!bytes || bytes.length == null) return e.json(200, { ok: false, code: "no_body", message: "图片内容为空" })
    var n = bytes.length
    if (n > 6 * 1024 * 1024) return e.json(200, { ok: false, code: "too_large", message: "图片过大（>6MB），换一张较小的" })
    if (n < 24) return e.json(200, { ok: false, code: "empty_body", message: "图片内容过短，可能不是图片", bytes: n })
    var ct = ""
    try {
      var hh = (res.headers && (res.headers["Content-Type"] || res.headers["content-type"])) || []
      if (hh && hh[0]) ct = String(hh[0]).split(";")[0].trim()
    } catch (e4) { /* ignore */ }
    if (!/^image\//i.test(ct)) ct = guessMime(url)
    var b64 = b64encode(bytes)
    return e.json(200, { ok: true, dataUrl: "data:" + ct + ";base64," + b64, mime: ct, bytes: n })
  } catch (ex) {
    $app.logger().error("customer fetch-image failed", "err", String(ex))
    return e.json(500, { error: "fetch_image_failed", message: "抓取图片失败: " + String(ex), fingerprint: "cfi-" + Math.floor(Math.random() * 1e9).toString(36) })
  }
})

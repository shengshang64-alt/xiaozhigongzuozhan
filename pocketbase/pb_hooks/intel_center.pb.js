// intel_center.pb.js — 情报中心：内置信息源种子/纠偏/去重 + 到期驱动抓取（tick）+ 手动抓取 + 信息源管理 + 情报流查询
// 安全约定：
//  - 身份只认 vibex 网关注入的 X-Rh-User-Id，需要登录的路由缺失一律 401
//  - 有状态 helper/常量仍 self-contained 在各回调内部（Goja 并发安全）；「无状态的纯函数」
//    收敛到文件头共享纯函数区（__intel* 前缀，只读入参，2026-09-26 起取代四份漂移拷贝）
//  - 只用 var / function；时间戳一律 new Date().toISOString()
//  - 5xx 一律 { error, message, fingerprint } 三字段
//  - 抓取环节不调用任何 LLM（零 AI 费用）；抓不到是常态，如实记录 last_status/last_error
//  - 定时抓取不用 cronAdd（pb-hook-lint 禁止）：由前端页面挂载时/驻留期间触发
//    POST /api/intel/tick。到期判定按「单源维度」：enabled 且 last_fetch_at 为空或
//    距今 >= 30 分钟的源才算到期；每轮最多 10 个源、总耗时预算 60s，单源出站超时 15s。
//    2026-09-18 修正：原实现用「全局最近一轮距今 >= 30 分钟」做门控且每轮固定只抓 3 个源，
//    带来两个致命问题 —— ①手动抓取任意一个源会把全局门控推后 30 分钟，整轮自动抓取被压制；
//    ②13 个内置源要 5 轮（2.5 小时）才轮完一遍，用户看到的就是「同步不出来数据」。
//  - 医疗信息化相关性过滤：抓取条目（tick / fetch-now 两条路径）不命中 medicalRelevant
//    直接跳过不入库；手动录入不过滤。
//  - 可见性模型：visibility ∈ {public, personal, ''}；内置源抓取 = public/owner_id=''，
//    自定义源抓取 = personal/owner_id=源归属人；手动录入由前端按「公开到团队」开关写入。
//    查询 where 用 visibility!='personal' || owner_id={:u}（'' 视同 public，兼容未迁移存量）。
//  - 每人独立确认状态：intel_views(rh_user_id/item_id/view_status)；GET items 的
//    item_status 查询参数语义 = 按本人 my_status 过滤（内存过滤 + 内存分页，数据量小）。

// ---------------------------------------------------------------------------
// 内置信息源种子只由 GET /api/intel/sources 负责（本 PB 构建未暴露 onServe 全局钩子）：
//  - 种子写入包在单个 runInTransaction 内，避免 React StrictMode 双挂载导致两个并发 GET
//    同时「查都查不到 → 各插一条」的重复播种 —— 历史库里 13 个内置源被插成 24 条的根因。
//  - 同一次读取顺带做自愈去重：同名内置源只保留 1 条（保留优先级：有情报条目 > 有抓取历史
//    > 最早创建），删除前先把被删记录名下的 intel_items.source_id 改挂到保留记录。
//  - tick 不再播种，保证种子的唯一写入方是 GET，从结构上消除多写入方竞态。
// ---------------------------------------------------------------------------

// ===========================================================================
// 共享纯函数（2026-09-26 质量整改 Q1–Q4，见 docs/全局质量规范-测试与交付门槛.md）
// 重要：PocketBase v0.40 会把 routerAdd 回调重定位到生成的 pb.js 中执行，本文件顶层作用域
// 对回调不可见（zx_guard.pb.js 的顶层常量即因此从未生效）。所以共享函数必须以「镜像」形式
// 存在于每个用到的回调内部（tick / fetch-now / items 迁移 / enrich 四处，由
// scripts/intelShared.test.ts 用 ===INTEL-SHARED-BEGIN/END=== 标记强制逐字节一致，杜绝漂移）。
// 修改算法时：只改一处 → 拷贝同步其余三处镜像 → 运行 pnpm test（镜像不一致会立刻红）。
// ===========================================================================

// ---------------------------------------------------------------------------
// POST /api/intel/tick — 定时抓取轮（前端页面挂载时 / 驻留期间每 15 分钟触发）：
// 到期判定按单源维度（enabled && (last_fetch_at 为空 || 距今 >= FETCH_INTERVAL_MIN)）；
// 到期源超过 MAX_SOURCES_PER_ROUND 或累计耗时超过 ROUND_BUDGET_MS 时本轮停止，
// 剩下的源留给下一轮，保证单个 tick 请求的响应时间可控。
// 种子播种不在此处进行（见文件头「内置信息源种子」说明）。
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/intel/tick", (e) => {
  try {
    // ==== 共享纯函数镜像（唯一事实来源，scripts/intelShared.test.ts 强制 4 份逐字节一致） ====
    // ===INTEL-SHARED-BEGIN===
    // 共享纯函数区（2026-09-26 质量整改 Q1–Q4，见 docs/全局质量规范-测试与交付门槛.md）
    // 此前 REGION_WORDS/extractRegion 等在 tick / fetch-now / items 迁移 / enrich 四处各持一份拷贝，
    // 改一处漏三处是「多拷贝漂移」。现统一收敛到顶层一份：
    //  - Goja 单 VM 启动时顺序加载全部 pb_hooks，顶层 var 全局可见（zx_guard.pb.js 顶层常量同款先例）；
    //  - 以下函数全部只读入参、无可变共享态，请求间并发安全；
    //  - 命名带 __intel 前缀，避免与其他 hook 文件的全局名冲突。
    // ===========================================================================

    // 省份区域词表（零 AI）：全称 + 多字简称（单字简称误报率高，刻意排除）
    var __INTEL_REGION_WORDS = [
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
    var __intelRegionByWord = function (s) {
      var t = String(s || "")
      for (var i = 0; i < __INTEL_REGION_WORDS.length; i++) {
        if (t.indexOf(__INTEL_REGION_WORDS[i].w) >= 0) return __INTEL_REGION_WORDS[i].r
      }
      return ""
    }

    // 标题剥标签：内联高亮标签（政采网搜索结果会给关键词套 <font>）必须替换为空串。
    // 旧实现替换为空格，导致「青浦区中心 医院」这类关键词两侧插空格的标题污染并入库。
    var __intelTitleFromHtml = function (rawHtml) {
      return unescInt(String(rawHtml || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim()
    }
    // 实体解码（与各回调内 unesc 同口径；独立一份供顶层函数使用）
    var unescInt = function (s) {
      return String(s).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&ldquo;|&rdquo;/g, "").replace(/\s+/g, " ").trim()
    }

    // 区域抽取 v2（分层证据优先级，取代旧「标题+邻接窗口里第一个省份词」）：
    //  1) 采购人归属：条目块「采购人：××」值中的省份词（最强证据：采购人属地即项目属地）
    //  2) 递交地：「在××省政府采购网 / 在××市政府采购网」中的省份词
    //  3) 标题本体中的省份词（次强：标题主体是项目名；注意代理机构名也可能出现在标题里，
    //     所以排序在 1)/2) 之后）
    //  4) 条目自身块的面包屑「…公告 | 省份 | …」
    //  5) 兜底：条目自身块内第一个省份词（调用方必须保证传入的是「条目自身块」而非 ±800 邻接窗口，
    //     否则邻接条目的代理机构名会重演「青浦区→青海」错标）
    var __intelRegion = function (title, ownBlock, strict) {
      var t = String(title || "")
      var b = String(ownBlock || "")
      var mp = b.match(/采购人[：:]\s*([^，,。;；|\n]{2,30})/)
      if (mp) { var r1 = __intelRegionByWord(mp[1]); if (r1) return r1 }
      var mg = b.match(/在([^，,。;；|\n]{2,14}?(?:省|自治区)政府采购网)|在([^，,。;；|\n]{1,8}?市)政府采购网/)
      if (mg) { var r2 = __intelRegionByWord(mg[1] || mg[2] || ""); if (r2) return r2 }
      var r3 = __intelRegionByWord(t)
      if (r3) return r3
      // 4.5) 代理机构属地（条目自身块内为强证据）：块里可能有多个「代理机构：」（开头的是邻接噪声），
      // ccgp 列表行元数据「时间戳 | 采购人 | 代理机构」总在末尾 → 从最后一个往前找省份词
      var maAll = b.match(/代理机构[：:]\s*([^，,。;；|\n]{2,30})/g)
      if (maAll) {
        for (var ai = maAll.length - 1; ai >= 0; ai--) {
          var r45 = __intelRegionByWord(maAll[ai].replace(/^代理机构[：:]\s*/, ""))
          if (r45) return r45
        }
      }
      var mb = b.match(/[|｜]\s*([^|｜，,。;；\s]{2,8})\s*[|｜]/)
      if (mb) { var r4 = __intelRegionByWord(mb[1]); if (r4) return r4 }
      // strict 模式（存量重算专用）：弱证据兜底不参与——宁可保留旧值，绝不因邻接噪声改错
      if (strict) return ""
      return __intelRegionByWord(b)
    }

    var __intelValidDate = function (y, mo, d) {
      var yy = parseInt(y, 10), mm = parseInt(mo, 10), dd = parseInt(d, 10)
      if (!(yy >= 2020 && yy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return ""
      var mmS = mm < 10 ? "0" + mm : "" + mm
      var ddS = dd < 10 ? "0" + dd : "" + dd
      var iso = yy + "-" + mmS + "-" + ddS
      // 未来日期守卫（2026-10-20）：发布时间不可能是未来。原判据只把年份卡在 2020..2100，
      // 而 __intelPubAt 的最后一条优先级是在**全文**里扫日期（仅排除递交/截止/开标上下文），
      // 于是源页里混着的课程日期、政策路线图年份、版权行一旦被抽中就会入库成未来时间——
      // 实测 HIT专家网「培训班招生」页抽出 2027-04-29 / 2027-01-03。列表按 -published_at
      // 排序，未来日期会永远置顶。留 1 天容差吸收时区差（源多为 date-only，此处按 UTC 零点解释）。
      // 注意：本函数因此不再是纯函数（依赖当前时间）。既有 Q2 用例全部使用过去的日期，
      // 故不受影响；将来新增用例不要用固定未来日期，否则会随真实时间变红。
      if (iso > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) return ""
      return iso
    }

    // 发布时间抽取 v2（发布时间 ≠ 正文第一个日期：政采网公告正文第一个日期是投标截止时间，
    // 旧实现拿它当发布时间入库，导致列表按「发布时刻」排序实为按截止时间倒挂）。
    // 优先级：URL 内嵌日期（ccgp t20260925_x.htm / /202609/ 目录）> 「发布时间：」标签
    //   > 列表条目自带时间戳（2026.09.25 11:38:54）> 正文日期（排除递交/截止/开标上下文）> 空串由调用方兜底
    var __intelPubAt = function (url, ownBlock, body) {
      var u = String(url || "")
      var mu = u.match(/t(20\d{2})(\d{2})(\d{2})_\w*\.htm/i) || u.match(/\/(20\d{2})(\d{2})(\d{2})\//)
      if (mu) { var d0 = __intelValidDate(mu[1], mu[2], mu[3]); if (d0) return d0 }
      var b = String(ownBlock || "")
      var bd = String(body || "")
      var text = bd ? bd + "\n" + b : b
      var ml = text.match(/(?:发布时间|发布日期|公布时间|公告发布|发布日期日期)[：:]\s*(20\d{2})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})/)
      if (ml) { var d1 = __intelValidDate(ml[1], ml[2], ml[3]); if (d1) return d1 }
      var ms = b.match(/(20\d{2})\.(\d{1,2})\.(\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/)
      if (ms) { var d2 = __intelValidDate(ms[1], ms[2], ms[3]); if (d2) return d2 }
      var re = /(20\d{2})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})/g
      var m4
      while ((m4 = re.exec(text)) !== null) {
        var before = text.slice(Math.max(0, m4.index - 20), m4.index)
        // after 只看同句（在句读处截断）：下一句的「递交/截止」不能株连本句的发布日期
        var afterRaw = text.slice(m4.index, m4.index + 40)
        var cutAt = afterRaw.search(/[。；！？，]/)
        var after = cutAt >= 0 ? afterRaw.slice(0, cutAt) : afterRaw
        if (/递交|截止|开标|投标|报名|响应文件|资格预审|澄清|答疑|询问|质疑/.test(before + after)) continue
        var d3 = __intelValidDate(m4[1], m4[2], m4[3])
        if (d3) return d3
      }
      return ""
    }

    // 招标/中标结构化字段（零 AI，2026-11-02 起随抓取直接写入 structured）。
    // 只写明确命中的键；无命中返回 {}，调用方不落成空对象。字段口径与 /api/intel/extract-bid 一致。
    var __intelExtractBid = function (title, text) {
      var out = {}
      var full = String(title || "") + "\n" + String(text || "")
      var grab = function (resList) {
        for (var gi = 0; gi < resList.length; gi++) {
          var mm = full.match(resList[gi])
          if (mm && mm[1]) return String(mm[1]).replace(/\s+/g, " ").trim().slice(0, 160)
        }
        return ""
      }
      var ORG_TAIL = "医院|卫生院|保健院|卫健委|卫生健康委|公司|集团|大学|学院|中心|研究院|研究所|事务所|银行|学校|委员会|管委会|管理局|管理处|政府|局|厅|部|厂|站"
      // 采购人：正文显式标签最强；没有再取标题开头机构名（贪婪到机构尾词，避免只取到「北京大学」）
      var buyer = grab([
        /(?:采购人|招标人|招标单位|采购单位|采购人名称|招标人名称|项目建设单位)\s*[:：为]\s*(?:名称)?\s*([^\s，。；;:：、()（）]{2,40}(?:医院|卫生院|保健院|卫健委|卫生健康委|公司|集团|大学|学院|中心|研究院|研究所|事务所|银行|学校|委员会|管委会|管理局|管理处|政府|局|厅|部|厂|站))/,
        new RegExp("^([\\u4e00-\\u9fa5A-Za-z0-9（）()·]{2,45}(?:" + ORG_TAIL + "))"),
      ])
      if (buyer && buyer.length >= 4) out.buyer = buyer.replace(/^关于/, "").slice(0, 60)
      var budget = grab([
        /(?:预算金额|采购预算|最高限价|控制价|估算价|预算总价|项目预算|资金预算|概算|预算)\s*[:：为]?\s*(?:人民币)?\s*([\d,，.]+\s*(?:万元|亿元|元))/,
      ])
      if (budget) out.budget = budget.replace(/\s+/g, "")
      var deadline = grab([
        /(?:投标截止|递交截止|报名截止|获取[^\n]{0,8}?截止|开标时间|截止时间|截止日期|响应文件截止)\s*[:：为至]?\s*(20\d{2}[-/年.]\d{1,2}[-/月.]\d{1,2}\s*日?(?:\s*\d{1,2}[:：]\d{1,2}(?:[:：]\d{1,2})?\s*(?:时|分)?)?)/,
      ])
      if (deadline) out.deadline = deadline.replace(/\s+/g, "")
      var code = grab([
        /(?:招标编号|采购编号|项目编号|谈判编号|询价编号|比选编号|证券项目编号)\s*[:：为]?\s*([A-Za-z0-9][A-Za-z0-9\-_./·]{3,39})/,
      ])
      if (code) out.code = code
      var winner = grab([
        /(?:中标(?:人|单位|供应商|公司)|成交(?:供应商|人|单位)|第一中标(?:候选人|供应商))\s*[:：为]\s*([^\s，。；;:：、]{2,40}(?:公司|集团|医院|中心|研究院|事务所|大学|厂|行))/,
      ])
      if (winner) out.winner = winner
      var won = grab([
        /(?:中标金额|成交金额|中标价|成交价格|合同金额)\s*[:：为]?\s*(?:人民币)?\s*([\d,，.]+\s*(?:万元|亿元|元))/,
      ])
      if (won) out.won_amount = won.replace(/\s+/g, "")
      return out
    }

    // 标题历史污染清洗（存量数据）：抓取端旧实现把高亮标签剥成空格，标题里留下「医院」两侧空格。
    // 中文排版中汉字之间的空格几乎不可能是刻意的，汉字/中文标点之间的空格安全折叠；
    // 英文/数字之间的空格保留（"CT MRI"这类不吃掉）。
    var __intelCleanTitleSpacing = function (t) {
      return String(t || "").replace(/([\u4e00-\u9fa5）】」》、，。；：？！])\s+([\u4e00-\u9fa5（【「《])/g, "$1$2")
    }

    // 从一段正文文本里构造「去标题」片段（供摘要用）：允许标题在文本里被空白打断
    // （旧实现 replace(title," ") 因高亮空格污染永远匹配不上，导致摘要里残留半截标题）。
    var __intelTextWithoutTitle = function (text, title) {
      var t = String(text || "")
      var ttl = String(title || "")
      if (!ttl) return t
      var esc = ttl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      try {
        var fuzzy = esc.split("").join("\\s*")
        return t.replace(new RegExp(fuzzy), " ")
      } catch (eReg) {
        return t.split(ttl).join(" ")
      }
    }
    // ===INTEL-SHARED-END===

    // 信息源健康（2026-11-02）：死链（404/DNS/拒连）连续 3 次自动停用；
    // 反爬 403/412、5xx、超时绝不自动停用——可恢复错误不能误判成死链。
    var __intelFailureKind = function (msg) {
      var s = String(msg || "")
      if (/HTTP 404|no such host|NXDOMAIN|connection refused|No connection could be made/i.test(s)) return "dead"
      if (/HTTP (403|412)|HTTP 5\d\d|timeout|deadline|tls|x509|超时/i.test(s)) return "transient"
      return "other"
    }
    var __intelNoteFetchError = function (src, msg) {
      var n = Number(src.get("failure_count") || 0) + 1
      var kind = __intelFailureKind(msg)
      var note = String(msg || "抓取失败").slice(0, 360)
      if (kind === "dead" && n >= 3) {
        src.set("enabled", false)
        note += "；连续 " + n + " 次失效，已自动停用（更换网址后可手动启用）"
      }
      src.set("failure_count", n)
      src.set("last_fetch_at", new Date().toISOString())
      src.set("last_status", "error")
      src.set("last_error", note)
      $app.save(src)
      return { kind: kind, count: n, disabled: kind === "dead" && n >= 3 }
    }
    var __intelNoteFetchOk = function (src, added) {
      src.set("failure_count", 0)
      src.set("last_success_at", new Date().toISOString())
      src.set("last_fetch_at", new Date().toISOString())
      src.set("last_status", "ok")
      src.set("last_error", "")
      src.set("fetched_count", Number(src.get("fetched_count") || 0) + Number(added || 0))
      $app.save(src)
    }

    // 单源冷却期（分钟）：与 UI 文案「每 30 分钟自动抓取一轮到期的启用源」保持一致
    var FETCH_INTERVAL_MIN = 30
    // 单轮上限（个）：限制单次请求内抓取的源数量。批次 A 从 10→12，与内置源从 13→29 扩容匹配，
    // 保证新加的厂商源/评级源/招标搜索源/行业媒体源在 2.5 轮内都能排到一次抓取。
    var MAX_SOURCES_PER_ROUND = 12
    // 单轮耗时预算（毫秒）：即使未达源数量上限，超预算也立即停止本轮
    var ROUND_BUDGET_MS = 60000
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
    // 医疗信息化相关性 v3（2026-10-07 用户口径收紧：只收「医疗软件信息化/智慧医院建设」——
    // HIS、EMR、集成平台、数据中心、一体化系统、电子病历/互联互通/智慧服务/智慧管理评级、
    // 智慧医院建设、信创等。v2 的「核心医疗词单独命中即收」会让养生/疫苗/义诊/抢救等
    // 纯临床生活新闻刷屏情报流，是「太乱」的根因，v3 要求必须命中医疗IT主题词）。
    // 判定顺序：噪音行 → 非医疗行业（医学院/医科大学 先剥离再判）→ 强词命中即收 →
    // 纯临床生活噪声 → 弱判定（医疗词 AND 医疗IT词 双命中）。
    var noiseRe = /版权|All Rights|ICP 备|备案号|友情链接|隐私政策|使用条款|网站地图/i
    var medicalRelevant = function (title, snippet) {
      var t = String(title || "")
      if (!t) return false
      if (noiseRe.test(t)) return false
      // 相关性只看标题（多行业厂商页面 snippet 满是医疗词，用 snippet 必误放行）
      var tForIndustry = t.replace(/医学院|医科大学|医学高等专科/g, "医院")
      var otherIndustry = /电信|运营商|能源|电力|电网|交通|轨交|地铁|航空|金融|银行|保险|证券|制造|工业互联|政务|海关|税务|教育|校园|教学|学院|水利|水文|矿山|钢铁|冶金|汽车|座舱|行泊|车联|车载|石化|化工|煤炭|矿业|烟草|邮政|物流|供应链|地产|园区|文旅|旅游|游戏|传媒|自媒体|流媒体|媒体采访|消防|救援|认证工程师|证书|药企|制药|医药公司|生物制药|农业|农机|光伏|农田|环保|色谱|开挖|信号分析仪/i
      if (otherIndustry.test(tForIndustry)) return false
      // v3.1（2026-10-08 用户口径再收紧）：数据中心类硬件/网络产品营销无医疗语境一律不收
      // ——华为 DCS/DME/光网、东软 IDC 等曾靠裸「数据中心」强词放行
      var infraNonMedical = /数据中心(互联|虚拟化|管理|服务|双活|光网)|（DCS）|（DME）|（HCI）|\(DCS\)|\(DME\)|\(HCI\)|IDC(数据中心|机房|服务)|智算中心|算力中心/i
      if (infraNonMedical.test(t)) return false
      // 强词=医疗IT主题词表（评级/系统/平台/厂商），命中即收；临床词无法误导。
      // v3.1：去掉裸「数据中心」「互联互通」（保留 医院数据中心/医疗数据中心/互联互通测评/评级/标准化成熟度/医院信息互联互通 等带语境形态）
      var strongT = /电子病历|智慧医院|互联网医院|智慧医疗|智慧服务|智慧病房|智慧管理|智慧后勤|卫生信息化|医疗信息化|医院信息化|区域卫生信息|全民健康信息|数字医院|数字健康|互联网\+医疗|AI\+医疗|AI医疗|医疗健康信息|远程医疗|医院信息|医疗信息|临床信息系统|医院信息系统|医疗信息系统|医院数据中心|医疗数据中心|集成平台|一体化系统|一体化平台|信息平台|信息系统|信息中心|信创|国产化|CDSS|临床决策|医疗大模型|医疗人工智能|医疗AI|医学人工智能|医疗知识图谱|医院物联网|医疗物联网|移动护理|移动查房|掌上医院|电子病历评级|电子病历分级|电子病历应用水平|互联互通测评|互联互通评级|互联互通标准化成熟度|智慧服务评级|智慧服务分级|智慧服务测评|智慧管理评级|智慧管理分级|医院信息标准化|医院信息互联互通|智慧医院分级|DRG|DIP|医保信息化|医保信息平台|医保信息系统|医保电子凭证|健康医疗大数据|医疗大数据|华为医疗|腾讯健康|京东健康|阿里云医疗|百度灵医|东软集团|卫宁健康|创业慧康|东华医为|和仁科技|麦迪科技|万达信息|久远银海|嘉和美康|讯飞医疗|药品集采|集中带量采购|带量采购|集采|医保支付|医保目录|医保谈判|医疗服务价格|公立医院绩效考核|绩效考核|国考|医保改革|医疗改革|医保基金|双通道|按病种付费|检查检验结果互认|\bHIS\b|\bEMR\b|\bLIS\b|\bPACS\b|\bCDR\b|\bHRP\b|\bMMIT\b/i
      if (strongT.test(t)) return true
      // 纯临床/生活健康内容（患者救治、养生科普、号表通知等）→ 拒：是「医疗新闻」不是「医疗信息化」。
      // v3.1：补行业活动噪声（竞赛/巡讲/事迹/收官/落幕等——健康报、人民网源的高频杂音）
      var clinicalNoise = /养生|食疗|药膳|疫苗|辟谣|义诊|科普|健康指南|健康提醒|健康素养|天气预报|寒潮|降温|高温|节气|停诊|排班|义卖|锦旗|感谢信|坚守|抢救|成功救治|假日门诊|节假日门诊|门诊时间|就诊提示|挂号|流感|中暑|献血|急救常识|用药提醒|成功开展|首例手术|救治|竞赛|巡讲|先进事迹|技能大赛|比武|圆满收官|圆满举办|成功举办|顺利举办|落幕/i
      if (clinicalNoise.test(t)) return false
      // v3.2（2026-10-08 R209）：工程/物业/设备采购黑名单——医院三个字不等于医疗信息化，
      // 「污水站运维」「空调自控」这类含医院+运维/系统被弱判定误收者一律拒（强词命中优先于此，不误杀真信息化）
      var facilityNoise = /污水站|污水处理|给排水|电梯|扶梯|中央空调|通风空调|暖通|新风(?!险)|空调|配电房|供配电|变压器|发电机|UPS电源|锅炉|空气能|太阳能|绿化|园林|景观|保安|安保|保洁|洗涤|被服|食堂|餐饮|物业|后勤|基建|土建|桩基|基坑|幕墙|装饰装修|装修|装饰|改扩建|改建|扩建|施工(?!图)|监理|工程造价|整体搬迁|拆除|印刷|差旅|租车|班车|公务用车/i.test(t)
      if (facilityNoise) return false
      // v4（2026-10-15 用户口径：情报中心只要医疗软件信息化行业的信息）：硬件/耗材采购公告不是行业情报。
      // 必须「设备词 + 采购公告形态」**同时**命中才拒——单看设备词会误杀「医疗设备联网安全」这类安全议题。
      var deviceProcurement = /内窥镜|支气管镜|扫描仪|正电子发射|磁共振|超声|呼吸机|监护仪|麻醉机|药柜|纯水|合成模块|试剂|耗材|器械|检验设备|影像设备|屏蔽改造|设备机房|标识标牌|窗帘|家具/i
      var procurementForm = /招标公告|中标(结果)?公告|成交公告|询价公告|竞争性磋商|竞争性谈判|单一来源|采购公告|更正公告|废标公告|采购项目|重新招标|变更公告/i
      if (deviceProcurement.test(t) && procurementForm.test(t)) return false
      // 弱判定：医疗词 AND 医疗IT词 双命中才收（单独临床词不再放行）
      var medHit = /医|院|卫|健康/i.test(t)
      var itHit = /信息化|数字化|智慧|智能|系统|平台|软件|数据|信创|国产化|人工智能|\bAI\b|大数据|云计算|云化|上云|等保|网络安全|信息安全|集成|接口|机房|弱电|电子|互联网|线上|运维|测评|评级|分级评价|应用水平|解决方案|中台/i.test(t)
      return medHit && itHit
    }
    // 区域抽取：统一走顶层 __intelRegion（分层证据优先级），见文件头共享纯函数区
    var badTitleRe = /^(首页|关于|联系|更多|下载|登录|注册|English|网站地图|版权所有|声明|导航|返回|上一页|下一页|查看更多|点击进入|附件|搜索|订阅|邮箱|微信|微博|APP)/i
    var dateOnlyRe = /^[\d\s\-\/年月日.:：()\[\]，,周星期]+$/
    // 批次 A（政府站正文代理）：进程内 URL 缓存，同一次 tick 内多次 crawlOne 复用，规避 r.jina.ai 免费档 20 RPM 限额
    var __jinaCache = {}
    var crawlOne = function (src) {
      // 正文抓取预算（零 AI 加固）：每源最多深抓 __maxBody 条、且整体不超过 __bodyDeadline 毫秒，
      // 避免「列表页邻接噪声」当正文；超时/数量任一触发则后续条目回退邻接 snippet。
      // 批次 A 扩容：__maxBody 5→10、__bodyDeadline 9s→18s，配合新增 .gov.cn 走 r.jina.ai 代理后单条耗时上升。
      var __bodyDeadline = new Date().getTime() + 18000
      var __maxBody = 10
      var __UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "zh-CN,zh;q=0.9" }
      var decodeEnt = function (s) {
        return String(s).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&(ldquo|rdquo|mdash|ndash|middot|hellip|ensp|emsp);/g, " ").replace(/&#x([0-9a-fA-F]+);/g, function (m2, hh) { try { return String.fromCharCode(parseInt(hh, 16)) } catch (e) { return " " } }).replace(/&#(\d+);/g, function (m3, dd) { try { return String.fromCharCode(parseInt(dd, 10)) } catch (e) { return " " } })
      }
      var htmlToArticle = function (rawHtml) {
        if (!rawHtml) return ""
        var h = String(rawHtml)
        var seg = h
        var mA = h.match(/<article[\s\S]*?<\/article>/i)
        if (mA) { seg = mA[0] }
        else {
          var mC = h.match(/<div[^>]+class="[^"]*(content|article|TRS_Editor|zoom|viewT|Article|xl_content|cont)[^"]*"[\s\S]*?<\/div>/i)
          if (mC) seg = mC[0]
        }
        seg = seg.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<(nav|header|footer|aside|form|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
        seg = seg.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n").replace(/<[^>]+>/g, " ")
        seg = decodeEnt(seg)
        var lines = seg.split(/\n+/)
        var keep = []
        for (var li = 0; li < lines.length; li++) {
          var s = lines[li].replace(/\s+/g, " ").trim()
          if (!s) continue
          if (/版权|All Rights|ICP|备案|返回|打印|分享|关注|扫码|二维码|上一篇|下一篇|相关阅读|网站地图|登录|注册|首页|导航|广告|免责声明|联系我们/.test(s)) continue
          keep.push(s)
        }
        return keep.join("\n").slice(0, 4000)
      }
      var fetchArticleBody = function (linkUrl) {
        // 政府 .gov.cn 走 r.jina.ai 代理（批次 A）：CFCA/SM2 国密证书导致 Go HTTP 客户端不信任，
        // 直连必失败→正文抓取全部回退到列表 snippet，是「重要政策没体现」的根因。
        // 免费档无 Key、20 RPM；进程内 URL 缓存（同 tick 内多次 crawlOne 复用），失败静默回退直连。
        var isGov = /\.gov\.cn/i.test(String(linkUrl || ""))
        if (isGov) {
          if (__jinaCache[linkUrl]) return __jinaCache[linkUrl]
          try {
            var jr = $http.send({ url: "https://r.jina.ai/" + linkUrl, method: "GET", headers: __UA, timeout: 10 })
            if (jr && jr.statusCode === 200 && typeof jr.raw === "string" && jr.raw.length > 240) {
              var md = String(jr.raw)
                .replace(/^Title:\s.*\n/m, "")
                .replace(/^URL Source:.*\n/m, "")
                .replace(/^Markdown Content:\s*\n/m, "")
                .replace(/\n{2,}/g, "\n")
                .slice(0, 4000)
              __jinaCache[linkUrl] = md
              return md
            }
          } catch (eJin) { /* 代理失败回退直连 */ }
        }
        try {
          var rb = $http.send({ url: linkUrl, method: "GET", headers: __UA, timeout: 8 })
          if (!rb || rb.statusCode !== 200) return ""
          var raw = typeof rb.raw === "string" ? rb.raw.slice(0, 400000) : ""
          return htmlToArticle(raw)
        } catch (e) { return "" }
      }
      var __TAG_BANK = ["电子病历", "智慧医院", "互联网医院", "医疗信息化", "医院信息化", "区域卫生", "医共体", "医联体", "公共卫生", "疾控", "DRG", "DIP", "医保", "远程医疗", "医学影像", "检验", "临床", "护理", "手术机器人", "人工智能", "大模型", "医疗AI", "数字化", "信息化", "信创", "国产化", "数据中心", "云平台", "大数据", "5G", "智慧病房", "分级诊疗", "公立医院", "药品追溯", "药店", "处方", "集采", "中标", "招标", "采购", "政策", "规划", "标准", "指南", "解决方案"]
      var extractTags = function (text) {
        var t = String(text || "")
        var out = []
        for (var i = 0; i < __TAG_BANK.length; i++) { var w = __TAG_BANK[i]; if (t.indexOf(w) >= 0 && out.indexOf(w) < 0) { out.push(w); if (out.length >= 6) break } }
        return out
      }
      // B36 修复（2026-11-05）：makeSummary 内联 scrubIntel 调用，避免 JSON 元数据/列表残片污染摘要
      var makeSummary = function (text, ttl) {
        // B36 修复（2026-11-05）：内联 scrubIntel 逻辑避免 JSON/列表残片污染摘要
        // 先做基础清洗：去除 HTML/URL/图片路径/导航噪声（同 scrubIntel 的核心规则）
        var t = String(text || "")
        
        // HTML 标签剥除（核心）
        t = t.replace(/<script[\s\S]*?<\/script>/gi, " ")
        t = t.replace(/<style[\s\S]*?<\/style>/gi, " ")
        t = t.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        t = t.replace(/<svg[\s\S]*?<\/svg>/gi, " ")
        t = t.replace(/<!--[[\s\S]*?-->/g, " ")
        t = t.replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ")
        t = t.replace(/<br\s*\/?>/gi, "\n")
        t = t.replace(/\<(p|div|li|h[1-6]|tr|td|section|article)>/gi, "\n")
        t = t.replace(/<[^>]*>/g, " ")
        t = t.replace(/<[^>]*$/g, " ")
        
        // URL/图片路径剥除
        t = t.replace(/[\w:.=-]+\s*=\s*"[^"]*"/g, " ")
        t = t.replace(/[\w:.=-]+\s*=\s*'[^']*'/g, " ")
        t = t.replace(/[\w:.=-]+\s*=\s*[^\s"'<>]+/g, " ")
        t = t.replace(/[<>]/g, " ")
        t = t.replace(/[\w/.-]*\.(?:jpg|jpeg|png|gif|webp|bmp)["']?/gi, " ")
        
        // 实体字符解码
        t = t.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        t = t.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        t = t.replace(/&amp;/g, "&")
        
        // 标题替换 + 空格归一化
        if (ttl) t = t.split(String(ttl)).join(" ")
        t = t.replace(/\s+/g, " ").trim()
        
        if (t.length < 8) return ""
        
        // 逐行过滤导航噪声（同 scrubIntel 的 keep 逻辑）
        var lines = t.split(/\n+/)
        var keep = []
        for (var li = 0; li < lines.length; li++) {
          var line = lines[li].replace(/\s+/g, " ").trim()
          if (!line) continue
          if (/[{}]/.test(line)) continue  // JSON 元数据丢弃 ← B64-1 根因修复
          if (/https?:\/\/|\.php|\.aspx?\b|share\.php|weibo\.com|javascript:|\burl\s*[:=]/i.test(line)) continue
          if (/^[[{]/.test(line) || /;\s*$/.test(line)) continue
          // 常见导航词过滤
          if (/版权 |All Rights|ICP|备案 | 返回 | 打印 | 分享 | 关注 | 扫码 | 二维码 | 上一篇 | 下一篇 | 相关阅读 | 网站地图 | 登录 | 注册 | 首页 | 导航 | 广告 | 免责声明 | 联系我们 | 友情链接 | 隐私政策 | 使用条款/.test(line)) continue
          if (/^[\d\s\-\/年月日.:：()\[\]\uFF0C,周星期]+$/.test(line)) continue
          keep.push(line)
        }
        
        var cleaned = keep.join(" ").replace(/\s+/g, " ").trim()
        
        // 句子切分 + 长度控制（保持原有逻辑）
        var sents = []
        var cur = ""
        for (var i = 0; i < cleaned.length; i++) { var ch = cleaned.charAt(i); cur += ch; if ("。！？；!?;".indexOf(ch) >= 0) { sents.push(cur); cur = "" } }
        if (cur) sents.push(cur)
        var buf = ""
        for (var k = 0; k < sents.length; k++) {
          var sp = sents[k].trim()
          if (sp.length < 6) continue
          if (buf && buf.length + sp.length > 150) break
          buf += sp
          if (buf.length >= 90) break
        }
        if (!buf) buf = cleaned.slice(0, 140)
        return buf.slice(0, 300)
      }
      // 展示/入库深度清洗（镜像前端 intelBodyClean.displayizeIntel）：在成对标签之外，
      // 额外剥离抓取时被从中间截断的半截 HTML（`<img ... class=` 无右括号、`.jpg" border="0"`
      // 丢左括号、`ef="//service.weibo..."` 丢头）与内联 CSS/JS/URL/图片路径残片，逐行去导航噪声。
      // 自持一份（Goja 回调作用域隔离），只吃 ASCII 引号成对属性，保留中文全角引号等合法正文。
      var scrubIntel = function (raw, max) {
        var s = String(raw == null ? "" : raw)
        s = s.replace(/<script[\s\S]*?<\/script>/gi, " ")
        s = s.replace(/<style[\s\S]*?<\/style>/gi, " ")
        s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        s = s.replace(/<svg[\s\S]*?<\/svg>/gi, " ")
        s = s.replace(/<!--[\s\S]*?-->/g, " ")
        s = s.replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ")
        s = s.replace(/<br\s*\/?>/gi, "\n")
        s = s.replace(/<\/(p|div|li|h[1-6]|tr|td|section|article)>/gi, "\n")
        s = s.replace(/<[^>]*>/g, " ")
        s = s.replace(/<[^>]*$/g, " ")
        s = s.replace(/[\w:.=-]+\s*=\s*"[^"]*"/g, " ")
        s = s.replace(/[\w:.=-]+\s*=\s*'[^']*'/g, " ")
        s = s.replace(/[\w:.=-]+\s*=\s*[^\s"'<>]+/g, " ")
        s = s.replace(/[<>]/g, " ")
        s = s.replace(/[\w/.-]*\.(?:jpg|jpeg|png|gif|webp|bmp)["']?/gi, " ")
        s = s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        s = s.replace(/&#x([0-9a-fA-F]+);/g, function (m2, hh) { try { return String.fromCharCode(parseInt(hh, 16)) } catch (e2) { return " " } })
        s = s.replace(/&#(\d+);/g, function (m3, dd) { try { return String.fromCharCode(parseInt(dd, 10)) } catch (e3) { return " " } })
        s = s.replace(/&amp;/g, "&")
        var lines = s.split(/\n+/)
        var keep = []
        for (var li = 0; li < lines.length; li++) {
          var t = lines[li].replace(/\s+/g, " ").trim()
          if (!t) continue
          if (/[{}]/.test(t)) continue
          if (/https?:\/\/|\.php|\.aspx?\b|share\.php|weibo\.com|javascript:|\burl\s*[:=]/i.test(t)) continue
          if (/^[[{]/.test(t) || /;\s*$/.test(t)) continue
          if (/版权|All Rights|ICP|备案|返回|打印|分享|关注|扫码|二维码|上一篇|下一篇|相关阅读|网站地图|登录|注册|首页|导航|广告|免责声明|联系我们|友情链接|隐私政策|使用条款/.test(t)) continue
          if (/^[\d\s\-\/年月日.:：()\[\]，,周星期]+$/.test(t)) continue
          keep.push(t)
        }
        var out = keep.join(" ").replace(/\s+/g, " ").trim()
        if (max && out.length > max) out = out.slice(0, max)
        return out
      }
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
        __intelNoteFetchError(src, (/timeout|deadline/i.test(emsg) ? "抓取超时（15s），该网站可能无法访问" : "无法连接：" + emsg).slice(0, 400))
        return 0
      }
      if (res.statusCode !== 200) {
        __intelNoteFetchError(src, "对方返回 HTTP " + res.statusCode)
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
    var skippedDupTitle = 0
      var skippedDupTitle = 0
      re.lastIndex = 0
      while ((m = re.exec(html)) !== null && added < 20) {
        var href = unesc(m[1])
        var title = __intelTitleFromHtml(m[2]) // 2026-09-26 Q3 整改：高亮标签剥成空串，不再给关键词两侧插空格
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
        snippet = scrubIntel(snippet.replace(title, " "), 600)
        // 医疗信息化相关性过滤：不命中直接跳过不入库
        if (!medicalRelevant(title, snippet)) { skippedIrrelevant++; continue }
        var dup = null
        try { dup = $app.findFirstRecordByFilter("intel_items", "url={:u}", { u: full }) } catch (err3) { dup = null }
        if (dup) { existing[full] = true; continue }
        // 跨源转载去重（2026-10-07）：同题文章经多信源转发时 URL 不同，按归一标题再拦一道
        var normTitle = String(title || "").replace(/\s+/g, " ").trim().slice(0, 300)
        var dupT = null
        try { dupT = $app.findFirstRecordByFilter("intel_items", "title={:t}", { t: normTitle }) } catch (errT) { dupT = null }
        if (dupT) { skippedDupTitle++; continue }
        // 追进原文抓正文（清洗导航/页脚噪声）；失败/过短则回退列表页邻接 snippet。
        // 注意：政府 .gov.cn 多为 CFCA/SM2 证书，Go $http 默认不信任 → 正文抓取会失败并回退；
        // 因此摘要/标签只在「真的抓到正文」时生成，绝不用导航噪声 snippet 伪造摘要（避免误导）。
        var body = ""
        if (added < __maxBody && new Date().getTime() < __bodyDeadline) body = fetchArticleBody(full)
        var hasBody = !!(body && body.length > 120)
        var finalSnippet = hasBody && body.length > snippet.length ? scrubIntel(body, 2400) : snippet
        var enrichText = (title + " " + (hasBody ? body : "")).slice(0, 3000)
      // 发布时间 v2（2026-09-26 Q2 整改）：URL 内嵌日期 > 发布时间标签 > 条目时间戳 > 正文日期（排除截止上下文）。
      // 旧实现取正文第一个日期，政采网公告第一个日期是投标截止时间 → 列表「按发布时刻」实为按截止时间倒挂。
      var pubAt = __intelPubAt(full, block, hasBody ? body : "")
      if (!pubAt) pubAt = new Date().toISOString().slice(0, 10)
        var item = new Record(itemColl)
        item.set("source_id", src.id)
        item.set("source_name", String(src.get("source_name") || ""))
        item.set("title", title.slice(0, 300))
        item.set("url", full.slice(0, 600))
        item.set("content_snippet", finalSnippet)
        item.set("item_type", String(src.get("source_type") || "policy"))
        item.set("summary", hasBody ? makeSummary(body, title) : "")
        // 招标结构化随抓取落库：不再等用户手动点「存量抽取」，新条目天然可按预算/截止筛选
        if (String(src.get("source_type") || "") === "bid" || /招标|中标|成交|采购|磋商|询价|开标/.test(title)) {
          var bs = __intelExtractBid(title, hasBody ? body : snippet)
          var bsKeys = 0
          for (var bk in bs) bsKeys++
          if (bsKeys > 0) item.set("structured", bs)
        }
        item.set("tags", extractTags(enrichText))
        item.set("region", __intelRegion(title, snippet))
        item.set("item_status", "pending")
        item.set("added_by", "crawl")
        item.set("owner_id", isBuiltin ? "" : srcOwner)
        item.set("visibility", isBuiltin ? "public" : "personal")
        item.set("published_at", pubAt)
        $app.save(item)
        existing[full] = true
        added++
      }
      __intelNoteFetchOk(src, added)
      $app.logger().info("intel-center crawled", "source", String(src.get("source_name") || ""), "added", added, "skipped_irrelevant", skippedIrrelevant)
      return added
    }
    // 到期源筛选：单源维度冷却（last_fetch_at 为空 = 从未抓取，视为立即到期）
    var enabledSources = []
    try {
      enabledSources = $app.findRecordsByFilter("intel_sources", "enabled=true", "", 200, 0)
    } catch (errSrc) { enabledSources = [] }
    var cutoffMs = new Date().getTime() - FETCH_INTERVAL_MIN * 60 * 1000
    var due = []
    for (var d = 0; d < enabledSources.length; d++) {
      var lfa = String(enabledSources[d].get("last_fetch_at") || "")
      if (!lfa) { due.push(enabledSources[d]); continue }
      var lfaMs = new Date(lfa).getTime()
      // 时间戳无法解析时按「到期」处理，避免脏数据把源永久冻死
      if (isNaN(lfaMs) || lfaMs <= cutoffMs) due.push(enabledSources[d])
    }
    // 排序：从未抓取的排最前，其余按 last_fetch_at 升序（最久没抓的先抓）
    due.sort(function (a, b) {
      var av = String(a.get("last_fetch_at") || "")
      var bv = String(b.get("last_fetch_at") || "")
      if (av === bv) return 0
      if (!av) return -1
      if (!bv) return 1
      return av < bv ? -1 : 1
    })
    if (due.length === 0) {
      return e.json(200, { ok: true, ran: false, added: 0, sources_checked: 0, due_total: 0, message: "所有启用信息源都在冷却期内，本轮无需抓取" })
    }
    var startedMs = new Date().getTime()
    var total = 0
    var checked = 0
    for (var i = 0; i < due.length; i++) {
      // 双约束：源数上限 + 耗时预算，任一触发即结束本轮（剩余源留待下一轮）
      if (checked >= MAX_SOURCES_PER_ROUND) break
      if (checked > 0 && new Date().getTime() - startedMs >= ROUND_BUDGET_MS) break
      total += crawlOne(due[i])
      checked++
    }
    $app.logger().info("intel-center tick round done", "due_total", due.length, "sources", checked, "new_items", total)
    var tail = due.length > checked ? ("，另有 " + (due.length - checked) + " 个到期源留待下一轮") : ""
    return e.json(200, {
      ok: true,
      ran: true,
      added: total,
      sources_checked: checked,
      due_total: due.length,
      message: total > 0
        ? ("本轮抓取新增 " + total + " 条待确认情报（检查 " + checked + " 个源" + tail + "）")
        : ("本轮抓取完成，没有新条目（检查 " + checked + " 个源" + tail + "）")
    })
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
    // 内置源规格表（唯一事实来源）：缺则插入、URL/类型漂移则纠偏。
    // 基础 13 家 URL 均已实测可抓（2026-09-18）；批次 A 新拓 16 家（厂商 5 / 评级 3 / 招标搜索 3 / 行业媒体 5），
    // 新站如首次抓取失败，last_error 会回报到 UI，不阻断旧站抓取，必要时下一轮手动禁用或换 URL。
    var BUILTIN = [
      // 基础 4 家政策 + 2 家招标 + 4 家竞品 + 3 家行业媒体（旧 13 家保持不变）
      { n: "国家卫健委 · 新闻发布", u: "https://www.nhc.gov.cn/wjw/xwfbh/index.shtml", t: "policy" },
      { n: "国家医保局 · 政策文件", u: "https://www.nhsa.gov.cn/", t: "policy" },
      { n: "工业和信息化部 · 新闻动态", u: "https://www.miit.gov.cn/xwdt/gxdt/sjdt/index.html", t: "policy" },
      { n: "国家卫健委统计信息中心", u: "http://www.statinfo.org/", t: "policy" },
      { n: "中国政府采购网 · 中央公告", u: "https://www.ccgp.gov.cn/cggg/zygg/", t: "bid" },
      { n: "全国公共资源交易平台 · 交易信息", u: "https://www.ggzy.gov.cn/", t: "bid" },
      { n: "卫宁健康 · 新闻动态", u: "https://www.winning.com.cn/news/", t: "competitor" },
      { n: "东软集团 · 新闻中心", u: "https://www.neusoft.com/cn/news/", t: "competitor" },
      { n: "创业慧康 · 公司新闻", u: "https://www.b-soft.com.cn/news/", t: "competitor" },
      { n: "东华医为 · 新闻动态", u: "https://www.dhc.com.cn/news/", t: "competitor" },
      { n: "HIT专家网 · 行业资讯", u: "https://www.hit180.com/", t: "media" },
      { n: "CHIMA · 中国医院协会信息管理分会", u: "http://www.chima.org.cn/", t: "media" },
      { n: "动脉网 · 医疗产业资讯", u: "https://www.vbdata.cn/", t: "media" },
      // 批次 A 新增 · 厂商动态 5 家（补齐主流 HIS/EMR/医保 IT 与云网头部）
      { n: "和仁科技 · 新闻动态", u: "https://www.herin.com.cn/xwzx/", t: "competitor" },
      { n: "麦迪科技 · 新闻中心", u: "https://www.medicomp.cn/news/", t: "competitor" },
      { n: "万达信息 · 新闻动态", u: "https://www.wondersgroup.com/news/", t: "competitor" },
      { n: "久远银海 · 医保信息化", u: "https://www.bai-holdings.com/xwdt/", t: "competitor" },
      { n: "华为 · 智慧医疗", u: "https://e.huawei.com/cn/industries/healthcare", t: "competitor" },
      // 批次 A 新增 · 评级 / 测评 3 家（电子病历 / 互联互通 / 智慧服务，售前硬需求）
      { n: "CHIMA · 通知公告", u: "http://www.chima.org.cn/Column/Column_View.aspx?colid=6", t: "policy" },
      { n: "国家卫健委 · 电子病历评级", u: "https://www.nhc.gov.cn/mohwsbwstjxxzx/s8553/list.shtml", t: "policy" },
      { n: "国家卫健委 · 互联互通测评", u: "https://www.nhc.gov.cn/mohwsbwstjxxzx/s8554/list.shtml", t: "policy" },
      // 批次 A 新增 · 招标搜索 3 家（医院 / 信息化关键词命中，补齐只有入口页的不足）
      { n: "中国政府采购网 · 医院搜索", u: "https://search.ccgp.gov.cn/bxsearch?searchtype=2&kw=%E5%8C%BB%E9%99%A2", t: "bid" },
      { n: "中国招标投标公共服务平台", u: "http://www.cebpubservice.com/", t: "bid" },
      { n: "剑鱼标讯 · 医院信息化", u: "https://www.jianyu360.cn/s/hypt", t: "bid" },
      // 批次 A 新增 · 行业媒体 5 家（专业垂直媒体，提升行业能见度）
      { n: "健康界 · 医院信息化", u: "https://www.cn-healthcare.com/", t: "media" },
      { n: "中国数字医学杂志", u: "http://www.zgszyx.org/", t: "media" },
      { n: "HIT 网 · 医疗 IT", u: "https://www.hitnet.org.cn/", t: "media" },
      { n: "医谷 · 医疗产业媒体", u: "https://m.medvalley.cn/", t: "media" },
      { n: "中国医院杂志", u: "http://www.chinahospital.org.cn/", t: "media" }
    ]
    // 内置源维护：整体放进单个事务，串行化「查 → 插/纠偏」与「同名去重」，
    // 避免 React StrictMode 双挂载下两个并发 GET 各插一条同名内置源。
    var txt = function (s) { return String(s == null ? "" : s).trim() }
    var seedColl = null
    try { seedColl = $app.findCollectionByNameOrId("intel_sources") } catch (errColl) { seedColl = null }
    if (seedColl) {
      try {
        $app.runInTransaction(function (txApp) {
          // 1) 自愈去重：同名内置源只保留 1 条。
          //    必须先于纠偏执行 —— 否则纠偏改的可能是随后被删掉的那条，存活记录反而留着旧 URL。
          var allBuiltin = []
          try { allBuiltin = txApp.findRecordsByFilter("intel_sources", "is_builtin=true", "", 500, 0) } catch (errAll) { allBuiltin = [] }
          var groups = {}
          var order = []
          for (var q = 0; q < allBuiltin.length; q++) {
            var nm = txt(allBuiltin[q].get("source_name"))
            if (!groups[nm]) { groups[nm] = []; order.push(nm) }
            groups[nm].push(allBuiltin[q])
          }
          for (var oi = 0; oi < order.length; oi++) {
            var grp = groups[order[oi]]
            if (grp.length < 2) continue
            // 保留优先级：名下有情报条目(100) > 有抓取历史(10) > 最早创建（同分保持先遇到者）
            var keeper = grp[0]
            var bestScore = -1
            for (var g = 0; g < grp.length; g++) {
              var sc = 0
              try {
                var own = txApp.findRecordsByFilter("intel_items", "source_id={:sid}", "", 1, 0, { sid: grp[g].id })
                if (own.length > 0) sc += 100
              } catch (errOwn) { sc += 0 }
              if (txt(grp[g].get("last_fetch_at"))) sc += 10
              if (sc > bestScore) { bestScore = sc; keeper = grp[g] }
            }
            for (var r = 0; r < grp.length; r++) {
              if (grp[r].id === keeper.id) continue
              // 先改挂情报条目再删源；改挂失败则整条跳过，留待下次自愈，绝不产生孤儿条目
              var orphan = []
              try { orphan = txApp.findRecordsByFilter("intel_items", "source_id={:sid}", "", 500, 0, { sid: grp[r].id }) } catch (errRe0) { continue }
              var repointOk = true
              for (var o = 0; o < orphan.length; o++) {
                try {
                  orphan[o].set("source_id", keeper.id)
                  txApp.save(orphan[o])
                } catch (errRe1) { repointOk = false; break }
              }
              if (!repointOk) continue
              try {
                txApp.delete(grp[r])
                try { $app.logger().warn("intel builtin source deduped", "name", order[oi], "removed", grp[r].id, "kept", keeper.id) } catch (errLog) { /* 记日志失败不影响去重结果 */ }
              } catch (errDel) { continue }
            }
          }
          // 2) 播种 / 纠偏：以 source_name 作业务主键（字段无唯一索引，靠事务串行化保证唯一）。
          //    去重后同名最多剩 1 条；对「全部」同名记录纠偏，避免保留记录与纠偏记录不是同一条。
          for (var b = 0; b < BUILTIN.length; b++) {
            var spec = BUILTIN[b]
            var hits = []
            try { hits = txApp.findRecordsByFilter("intel_sources", "is_builtin=true && source_name={:bn}", "", 20, 0, { bn: spec.n }) } catch (errFind) { hits = [] }
            if (hits.length === 0) {
              var bRec = new Record(txApp.findCollectionByNameOrId("intel_sources"))
              bRec.set("source_name", spec.n)
              bRec.set("url", spec.u)
              bRec.set("source_type", spec.t)
              bRec.set("is_builtin", true)
              bRec.set("owner_id", "")
              bRec.set("enabled", true)
              bRec.set("last_fetch_at", "")
              bRec.set("last_status", "")
              bRec.set("last_error", "")
              bRec.set("fetched_count", 0)
              txApp.save(bRec)
              continue
            }
            for (var hi = 0; hi < hits.length; hi++) {
              // URL / 类型漂移纠偏：站点改版后只改上面的规格常量，存量库自动跟上
              if (txt(hits[hi].get("url")) !== spec.u || txt(hits[hi].get("source_type")) !== spec.t) {
                hits[hi].set("url", spec.u)
                hits[hi].set("source_type", spec.t)
                // 地址已变，旧失败结论不再适用，重置失败态让下一轮重新抓一次
                if (txt(hits[hi].get("last_status")) === "error") {
                  hits[hi].set("last_status", "")
                  hits[hi].set("last_error", "")
                  hits[hi].set("last_fetch_at", "")
                }
                txApp.save(hits[hi])
              }
            }
          }
        })
      } catch (errSeedTx) {
        // 并发请求已抢先完成同一批维护（事务串行化保证只有一方写入），忽略即可
        try { $app.logger().info("intel sources seed/dedup skipped", "err", String(errSeedTx)) } catch (errLog2) { /* 忽略 */ }
      }
    }
    var norm = function (s) { return String(s == null ? "" : s).trim() }
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(String(e.get("rhUserId") || ""))
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
        failure_count: Number(rec.get("failure_count") || 0),
        last_success_at: String(rec.get("last_success_at") || ""),
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
    var userId = norm(String(e.get("rhUserId") || ""))
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
    var userId = norm(String(e.get("rhUserId") || ""))
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
    // 手动重新启用 = 明确的人工复核动作：清除连续失败计数，给源一次重新证明机会
    if (body.enabled === true) {
      rec.set("failure_count", 0)
      rec.set("last_status", "")
      rec.set("last_error", "")
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
        failure_count: Number(rec.get("failure_count") || 0), last_success_at: String(rec.get("last_success_at") || ""),
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
    var userId = norm(String(e.get("rhUserId") || ""))
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
    // ==== 共享纯函数镜像（唯一事实来源，scripts/intelShared.test.ts 强制 4 份逐字节一致） ====
    // ===INTEL-SHARED-BEGIN===
    // 共享纯函数区（2026-09-26 质量整改 Q1–Q4，见 docs/全局质量规范-测试与交付门槛.md）
    // 此前 REGION_WORDS/extractRegion 等在 tick / fetch-now / items 迁移 / enrich 四处各持一份拷贝，
    // 改一处漏三处是「多拷贝漂移」。现统一收敛到顶层一份：
    //  - Goja 单 VM 启动时顺序加载全部 pb_hooks，顶层 var 全局可见（zx_guard.pb.js 顶层常量同款先例）；
    //  - 以下函数全部只读入参、无可变共享态，请求间并发安全；
    //  - 命名带 __intel 前缀，避免与其他 hook 文件的全局名冲突。
    // ===========================================================================

    // 省份区域词表（零 AI）：全称 + 多字简称（单字简称误报率高，刻意排除）
    var __INTEL_REGION_WORDS = [
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
    var __intelRegionByWord = function (s) {
      var t = String(s || "")
      for (var i = 0; i < __INTEL_REGION_WORDS.length; i++) {
        if (t.indexOf(__INTEL_REGION_WORDS[i].w) >= 0) return __INTEL_REGION_WORDS[i].r
      }
      return ""
    }

    // 标题剥标签：内联高亮标签（政采网搜索结果会给关键词套 <font>）必须替换为空串。
    // 旧实现替换为空格，导致「青浦区中心 医院」这类关键词两侧插空格的标题污染并入库。
    var __intelTitleFromHtml = function (rawHtml) {
      return unescInt(String(rawHtml || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim()
    }
    // 实体解码（与各回调内 unesc 同口径；独立一份供顶层函数使用）
    var unescInt = function (s) {
      return String(s).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&ldquo;|&rdquo;/g, "").replace(/\s+/g, " ").trim()
    }

    // 区域抽取 v2（分层证据优先级，取代旧「标题+邻接窗口里第一个省份词」）：
    //  1) 采购人归属：条目块「采购人：××」值中的省份词（最强证据：采购人属地即项目属地）
    //  2) 递交地：「在××省政府采购网 / 在××市政府采购网」中的省份词
    //  3) 标题本体中的省份词（次强：标题主体是项目名；注意代理机构名也可能出现在标题里，
    //     所以排序在 1)/2) 之后）
    //  4) 条目自身块的面包屑「…公告 | 省份 | …」
    //  5) 兜底：条目自身块内第一个省份词（调用方必须保证传入的是「条目自身块」而非 ±800 邻接窗口，
    //     否则邻接条目的代理机构名会重演「青浦区→青海」错标）
    var __intelRegion = function (title, ownBlock, strict) {
      var t = String(title || "")
      var b = String(ownBlock || "")
      var mp = b.match(/采购人[：:]\s*([^，,。;；|\n]{2,30})/)
      if (mp) { var r1 = __intelRegionByWord(mp[1]); if (r1) return r1 }
      var mg = b.match(/在([^，,。;；|\n]{2,14}?(?:省|自治区)政府采购网)|在([^，,。;；|\n]{1,8}?市)政府采购网/)
      if (mg) { var r2 = __intelRegionByWord(mg[1] || mg[2] || ""); if (r2) return r2 }
      var r3 = __intelRegionByWord(t)
      if (r3) return r3
      // 4.5) 代理机构属地（条目自身块内为强证据）：块里可能有多个「代理机构：」（开头的是邻接噪声），
      // ccgp 列表行元数据「时间戳 | 采购人 | 代理机构」总在末尾 → 从最后一个往前找省份词
      var maAll = b.match(/代理机构[：:]\s*([^，,。;；|\n]{2,30})/g)
      if (maAll) {
        for (var ai = maAll.length - 1; ai >= 0; ai--) {
          var r45 = __intelRegionByWord(maAll[ai].replace(/^代理机构[：:]\s*/, ""))
          if (r45) return r45
        }
      }
      var mb = b.match(/[|｜]\s*([^|｜，,。;；\s]{2,8})\s*[|｜]/)
      if (mb) { var r4 = __intelRegionByWord(mb[1]); if (r4) return r4 }
      // strict 模式（存量重算专用）：弱证据兜底不参与——宁可保留旧值，绝不因邻接噪声改错
      if (strict) return ""
      return __intelRegionByWord(b)
    }

    var __intelValidDate = function (y, mo, d) {
      var yy = parseInt(y, 10), mm = parseInt(mo, 10), dd = parseInt(d, 10)
      if (!(yy >= 2020 && yy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return ""
      var mmS = mm < 10 ? "0" + mm : "" + mm
      var ddS = dd < 10 ? "0" + dd : "" + dd
      var iso = yy + "-" + mmS + "-" + ddS
      // 未来日期守卫（2026-10-20）：发布时间不可能是未来。原判据只把年份卡在 2020..2100，
      // 而 __intelPubAt 的最后一条优先级是在**全文**里扫日期（仅排除递交/截止/开标上下文），
      // 于是源页里混着的课程日期、政策路线图年份、版权行一旦被抽中就会入库成未来时间——
      // 实测 HIT专家网「培训班招生」页抽出 2027-04-29 / 2027-01-03。列表按 -published_at
      // 排序，未来日期会永远置顶。留 1 天容差吸收时区差（源多为 date-only，此处按 UTC 零点解释）。
      // 注意：本函数因此不再是纯函数（依赖当前时间）。既有 Q2 用例全部使用过去的日期，
      // 故不受影响；将来新增用例不要用固定未来日期，否则会随真实时间变红。
      if (iso > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) return ""
      return iso
    }

    // 发布时间抽取 v2（发布时间 ≠ 正文第一个日期：政采网公告正文第一个日期是投标截止时间，
    // 旧实现拿它当发布时间入库，导致列表按「发布时刻」排序实为按截止时间倒挂）。
    // 优先级：URL 内嵌日期（ccgp t20260925_x.htm / /202609/ 目录）> 「发布时间：」标签
    //   > 列表条目自带时间戳（2026.09.25 11:38:54）> 正文日期（排除递交/截止/开标上下文）> 空串由调用方兜底
    var __intelPubAt = function (url, ownBlock, body) {
      var u = String(url || "")
      var mu = u.match(/t(20\d{2})(\d{2})(\d{2})_\w*\.htm/i) || u.match(/\/(20\d{2})(\d{2})(\d{2})\//)
      if (mu) { var d0 = __intelValidDate(mu[1], mu[2], mu[3]); if (d0) return d0 }
      var b = String(ownBlock || "")
      var bd = String(body || "")
      var text = bd ? bd + "\n" + b : b
      var ml = text.match(/(?:发布时间|发布日期|公布时间|公告发布|发布日期日期)[：:]\s*(20\d{2})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})/)
      if (ml) { var d1 = __intelValidDate(ml[1], ml[2], ml[3]); if (d1) return d1 }
      var ms = b.match(/(20\d{2})\.(\d{1,2})\.(\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/)
      if (ms) { var d2 = __intelValidDate(ms[1], ms[2], ms[3]); if (d2) return d2 }
      var re = /(20\d{2})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})/g
      var m4
      while ((m4 = re.exec(text)) !== null) {
        var before = text.slice(Math.max(0, m4.index - 20), m4.index)
        // after 只看同句（在句读处截断）：下一句的「递交/截止」不能株连本句的发布日期
        var afterRaw = text.slice(m4.index, m4.index + 40)
        var cutAt = afterRaw.search(/[。；！？，]/)
        var after = cutAt >= 0 ? afterRaw.slice(0, cutAt) : afterRaw
        if (/递交|截止|开标|投标|报名|响应文件|资格预审|澄清|答疑|询问|质疑/.test(before + after)) continue
        var d3 = __intelValidDate(m4[1], m4[2], m4[3])
        if (d3) return d3
      }
      return ""
    }

    // 招标/中标结构化字段（零 AI，2026-11-02 起随抓取直接写入 structured）。
    // 只写明确命中的键；无命中返回 {}，调用方不落成空对象。字段口径与 /api/intel/extract-bid 一致。
    var __intelExtractBid = function (title, text) {
      var out = {}
      var full = String(title || "") + "\n" + String(text || "")
      var grab = function (resList) {
        for (var gi = 0; gi < resList.length; gi++) {
          var mm = full.match(resList[gi])
          if (mm && mm[1]) return String(mm[1]).replace(/\s+/g, " ").trim().slice(0, 160)
        }
        return ""
      }
      var ORG_TAIL = "医院|卫生院|保健院|卫健委|卫生健康委|公司|集团|大学|学院|中心|研究院|研究所|事务所|银行|学校|委员会|管委会|管理局|管理处|政府|局|厅|部|厂|站"
      // 采购人：正文显式标签最强；没有再取标题开头机构名（贪婪到机构尾词，避免只取到「北京大学」）
      var buyer = grab([
        /(?:采购人|招标人|招标单位|采购单位|采购人名称|招标人名称|项目建设单位)\s*[:：为]\s*(?:名称)?\s*([^\s，。；;:：、()（）]{2,40}(?:医院|卫生院|保健院|卫健委|卫生健康委|公司|集团|大学|学院|中心|研究院|研究所|事务所|银行|学校|委员会|管委会|管理局|管理处|政府|局|厅|部|厂|站))/,
        new RegExp("^([\\u4e00-\\u9fa5A-Za-z0-9（）()·]{2,45}(?:" + ORG_TAIL + "))"),
      ])
      if (buyer && buyer.length >= 4) out.buyer = buyer.replace(/^关于/, "").slice(0, 60)
      var budget = grab([
        /(?:预算金额|采购预算|最高限价|控制价|估算价|预算总价|项目预算|资金预算|概算|预算)\s*[:：为]?\s*(?:人民币)?\s*([\d,，.]+\s*(?:万元|亿元|元))/,
      ])
      if (budget) out.budget = budget.replace(/\s+/g, "")
      var deadline = grab([
        /(?:投标截止|递交截止|报名截止|获取[^\n]{0,8}?截止|开标时间|截止时间|截止日期|响应文件截止)\s*[:：为至]?\s*(20\d{2}[-/年.]\d{1,2}[-/月.]\d{1,2}\s*日?(?:\s*\d{1,2}[:：]\d{1,2}(?:[:：]\d{1,2})?\s*(?:时|分)?)?)/,
      ])
      if (deadline) out.deadline = deadline.replace(/\s+/g, "")
      var code = grab([
        /(?:招标编号|采购编号|项目编号|谈判编号|询价编号|比选编号|证券项目编号)\s*[:：为]?\s*([A-Za-z0-9][A-Za-z0-9\-_./·]{3,39})/,
      ])
      if (code) out.code = code
      var winner = grab([
        /(?:中标(?:人|单位|供应商|公司)|成交(?:供应商|人|单位)|第一中标(?:候选人|供应商))\s*[:：为]\s*([^\s，。；;:：、]{2,40}(?:公司|集团|医院|中心|研究院|事务所|大学|厂|行))/,
      ])
      if (winner) out.winner = winner
      var won = grab([
        /(?:中标金额|成交金额|中标价|成交价格|合同金额)\s*[:：为]?\s*(?:人民币)?\s*([\d,，.]+\s*(?:万元|亿元|元))/,
      ])
      if (won) out.won_amount = won.replace(/\s+/g, "")
      return out
    }

    // 标题历史污染清洗（存量数据）：抓取端旧实现把高亮标签剥成空格，标题里留下「医院」两侧空格。
    // 中文排版中汉字之间的空格几乎不可能是刻意的，汉字/中文标点之间的空格安全折叠；
    // 英文/数字之间的空格保留（"CT MRI"这类不吃掉）。
    var __intelCleanTitleSpacing = function (t) {
      return String(t || "").replace(/([\u4e00-\u9fa5）】」》、，。；：？！])\s+([\u4e00-\u9fa5（【「《])/g, "$1$2")
    }

    // 从一段正文文本里构造「去标题」片段（供摘要用）：允许标题在文本里被空白打断
    // （旧实现 replace(title," ") 因高亮空格污染永远匹配不上，导致摘要里残留半截标题）。
    var __intelTextWithoutTitle = function (text, title) {
      var t = String(text || "")
      var ttl = String(title || "")
      if (!ttl) return t
      var esc = ttl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      try {
        var fuzzy = esc.split("").join("\\s*")
        return t.replace(new RegExp(fuzzy), " ")
      } catch (eReg) {
        return t.split(ttl).join(" ")
      }
    }
    // ===INTEL-SHARED-END===

    // 与 tick 同口径的信息源健康记账：死链连续 3 次自动停用，瞬时错误只累计不封杀
    var __intelFailureKind = function (msg) {
      var s = String(msg || "")
      if (/HTTP 404|no such host|NXDOMAIN|connection refused|No connection could be made/i.test(s)) return "dead"
      if (/HTTP (403|412)|HTTP 5\d\d|timeout|deadline|tls|x509|超时/i.test(s)) return "transient"
      return "other"
    }
    var __intelNoteFetchError = function (src, msg) {
      var n = Number(src.get("failure_count") || 0) + 1
      var kind = __intelFailureKind(msg)
      var note = String(msg || "抓取失败").slice(0, 360)
      if (kind === "dead" && n >= 3) {
        src.set("enabled", false)
        note += "；连续 " + n + " 次失效，已自动停用（更换网址后可手动启用）"
      }
      src.set("failure_count", n)
      src.set("last_fetch_at", new Date().toISOString())
      src.set("last_status", "error")
      src.set("last_error", note)
      $app.save(src)
    }
    var __intelNoteFetchOk = function (src, added) {
      src.set("failure_count", 0)
      src.set("last_success_at", new Date().toISOString())
      src.set("last_fetch_at", new Date().toISOString())
      src.set("last_status", "ok")
      src.set("last_error", "")
      src.set("fetched_count", Number(src.get("fetched_count") || 0) + Number(added || 0))
      $app.save(src)
    }

    var norm = function (s) { return String(s == null ? "" : s).trim() }
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(String(e.get("rhUserId") || ""))
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再手动抓取" })
    // 正文抓取预算（与 tick 同口径）：手动抓取单源，深抓上限 __maxBody 条 / __bodyDeadline 毫秒
    // 批次 A 扩容：__maxBody 5→10 / __bodyDeadline 9s→18s，与 tick 同比例，配合新增政府站代理开销
    var __bodyDeadline = new Date().getTime() + 18000
    var __maxBody = 10
    var __jinaCache = {}
    var __UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "zh-CN,zh;q=0.9" }
    var decodeEnt = function (s) {
      return String(s).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&(ldquo|rdquo|mdash|ndash|middot|hellip|ensp|emsp);/g, " ").replace(/&#x([0-9a-fA-F]+);/g, function (m2, hh) { try { return String.fromCharCode(parseInt(hh, 16)) } catch (e) { return " " } }).replace(/&#(\d+);/g, function (m3, dd) { try { return String.fromCharCode(parseInt(dd, 10)) } catch (e) { return " " } })
    }
    var htmlToArticle = function (rawHtml) {
      if (!rawHtml) return ""
      var h = String(rawHtml)
      var seg = h
      var mA = h.match(/<article[\s\S]*?<\/article>/i)
      if (mA) { seg = mA[0] }
      else {
        var mC = h.match(/<div[^>]+class="[^"]*(content|article|TRS_Editor|zoom|viewT|Article|xl_content|cont)[^"]*"[\s\S]*?<\/div>/i)
        if (mC) seg = mC[0]
      }
      seg = seg.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<(nav|header|footer|aside|form|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
      seg = seg.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n").replace(/<[^>]+>/g, " ")
      seg = decodeEnt(seg)
      var lines = seg.split(/\n+/)
      var keep = []
      for (var li = 0; li < lines.length; li++) {
        var s = lines[li].replace(/\s+/g, " ").trim()
        if (!s) continue
        if (/版权|All Rights|ICP|备案|返回|打印|分享|关注|扫码|二维码|上一篇|下一篇|相关阅读|网站地图|登录|注册|首页|导航|广告|免责声明|联系我们/.test(s)) continue
        keep.push(s)
      }
      return keep.join("\n").slice(0, 4000)
    }
    var fetchArticleBody = function (linkUrl) {
      // 政府 .gov.cn 走 r.jina.ai 代理（与 tick 同口径，批次 A）：CFCA/SM2 国密证书直连必失败，
      // 手动抓取同样需要代理才能拿到政策正文。失败静默回退直连。
      var isGov = /\.gov\.cn/i.test(String(linkUrl || ""))
      if (isGov) {
        if (__jinaCache[linkUrl]) return __jinaCache[linkUrl]
        try {
          var jr = $http.send({ url: "https://r.jina.ai/" + linkUrl, method: "GET", headers: __UA, timeout: 10 })
          if (jr && jr.statusCode === 200 && typeof jr.raw === "string" && jr.raw.length > 240) {
            var md = String(jr.raw)
              .replace(/^Title:\s.*\n/m, "")
              .replace(/^URL Source:.*\n/m, "")
              .replace(/^Markdown Content:\s*\n/m, "")
              .replace(/\n{2,}/g, "\n")
              .slice(0, 4000)
            __jinaCache[linkUrl] = md
            return md
          }
        } catch (eJin) { /* 代理失败回退直连 */ }
      }
      try {
        var rb = $http.send({ url: linkUrl, method: "GET", headers: __UA, timeout: 8 })
        if (!rb || rb.statusCode !== 200) return ""
        var raw = typeof rb.raw === "string" ? rb.raw.slice(0, 400000) : ""
        return htmlToArticle(raw)
      } catch (e) { return "" }
    }
    var __TAG_BANK = ["电子病历", "智慧医院", "互联网医院", "医疗信息化", "医院信息化", "区域卫生", "医共体", "医联体", "公共卫生", "疾控", "DRG", "DIP", "医保", "远程医疗", "医学影像", "检验", "临床", "护理", "手术机器人", "人工智能", "大模型", "医疗AI", "数字化", "信息化", "信创", "国产化", "数据中心", "云平台", "大数据", "5G", "智慧病房", "分级诊疗", "公立医院", "药品追溯", "药店", "处方", "集采", "中标", "招标", "采购", "政策", "规划", "标准", "指南", "解决方案"]
    var extractTags = function (text) {
      var t = String(text || "")
      var out = []
      for (var i = 0; i < __TAG_BANK.length; i++) { var w = __TAG_BANK[i]; if (t.indexOf(w) >= 0 && out.indexOf(w) < 0) { out.push(w); if (out.length >= 6) break } }
      return out
    }
    var makeSummary = function (text, ttl) {
        // B36 修复（2026-11-05）：内联 scrubIntel 逻辑避免 JSON/列表残片污染摘要
      var t = String(text || "").replace(/\s+/g, " ")
      if (ttl) t = t.split(String(ttl)).join(" ")
      t = t.replace(/\s+/g, " ").trim()
      if (t.length < 8) return ""
      var sents = []
      var cur = ""
      for (var i = 0; i < t.length; i++) { var ch = t.charAt(i); cur += ch; if ("。！？；!?;".indexOf(ch) >= 0) { sents.push(cur); cur = "" } }
      if (cur) sents.push(cur)
      var buf = ""
      for (var k = 0; k < sents.length; k++) {
        var sp = sents[k].trim()
        if (sp.length < 6) continue
        if (buf && buf.length + sp.length > 150) break
        buf += sp
        if (buf.length >= 90) break
      }
      if (!buf) buf = t.slice(0, 140)
      return buf.slice(0, 300)
    }
    // 展示/入库深度清洗（镜像前端 intelBodyClean.displayizeIntel）：见 tick 回调同名函数说明。
    var scrubIntel = function (raw, max) {
      var s = String(raw == null ? "" : raw)
      s = s.replace(/<script[\s\S]*?<\/script>/gi, " ")
      s = s.replace(/<style[\s\S]*?<\/style>/gi, " ")
      s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      s = s.replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      s = s.replace(/<!--[\s\S]*?-->/g, " ")
      s = s.replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ")
      s = s.replace(/<br\s*\/?>/gi, "\n")
      s = s.replace(/<\/(p|div|li|h[1-6]|tr|td|section|article)>/gi, "\n")
      s = s.replace(/<[^>]*>/g, " ")
      s = s.replace(/<[^>]*$/g, " ")
      s = s.replace(/[\w:.=-]+\s*=\s*"[^"]*"/g, " ")
      s = s.replace(/[\w:.=-]+\s*=\s*'[^']*'/g, " ")
      s = s.replace(/[\w:.=-]+\s*=\s*[^\s"'<>]+/g, " ")
      s = s.replace(/[<>]/g, " ")
      s = s.replace(/[\w/.-]*\.(?:jpg|jpeg|png|gif|webp|bmp)["']?/gi, " ")
      s = s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      s = s.replace(/&#x([0-9a-fA-F]+);/g, function (m2, hh) { try { return String.fromCharCode(parseInt(hh, 16)) } catch (e2) { return " " } })
      s = s.replace(/&#(\d+);/g, function (m3, dd) { try { return String.fromCharCode(parseInt(dd, 10)) } catch (e3) { return " " } })
      s = s.replace(/&amp;/g, "&")
      var lines = s.split(/\n+/)
      var keep = []
      for (var li = 0; li < lines.length; li++) {
        var t = lines[li].replace(/\s+/g, " ").trim()
        if (!t) continue
        if (/[{}]/.test(t)) continue
        if (/https?:\/\/|\.php|\.aspx?\b|share\.php|weibo\.com|javascript:|\burl\s*[:=]/i.test(t)) continue
        if (/^[[{]/.test(t) || /;\s*$/.test(t)) continue
        if (/版权|All Rights|ICP|备案|返回|打印|分享|关注|扫码|二维码|上一篇|下一篇|相关阅读|网站地图|登录|注册|首页|导航|广告|免责声明|联系我们|友情链接|隐私政策|使用条款/.test(t)) continue
        if (/^[\d\s\-\/年月日.:：()\[\]，,周星期]+$/.test(t)) continue
        keep.push(t)
      }
      var out = keep.join(" ").replace(/\s+/g, " ").trim()
      if (max && out.length > max) out = out.slice(0, max)
      return out
    }
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
    // 医疗信息化相关性 v3（2026-10-07 用户口径收紧：只收「医疗软件信息化/智慧医院建设」——
    // HIS、EMR、集成平台、数据中心、一体化系统、电子病历/互联互通/智慧服务/智慧管理评级、
    // 智慧医院建设、信创等。v2 的「核心医疗词单独命中即收」会让养生/疫苗/义诊/抢救等
    // 纯临床生活新闻刷屏情报流，是「太乱」的根因，v3 要求必须命中医疗IT主题词）。
    // 判定顺序：噪音行 → 非医疗行业（医学院/医科大学 先剥离再判）→ 强词命中即收 →
    // 纯临床生活噪声 → 弱判定（医疗词 AND 医疗IT词 双命中）。
    var noiseRe = /版权|All Rights|ICP 备|备案号|友情链接|隐私政策|使用条款|网站地图/i
    var medicalRelevant = function (title, snippet) {
      var t = String(title || "")
      if (!t) return false
      if (noiseRe.test(t)) return false
      // 相关性只看标题（多行业厂商页面 snippet 满是医疗词，用 snippet 必误放行）
      var tForIndustry = t.replace(/医学院|医科大学|医学高等专科/g, "医院")
      var otherIndustry = /电信|运营商|能源|电力|电网|交通|轨交|地铁|航空|金融|银行|保险|证券|制造|工业互联|政务|海关|税务|教育|校园|教学|学院|水利|水文|矿山|钢铁|冶金|汽车|座舱|行泊|车联|车载|石化|化工|煤炭|矿业|烟草|邮政|物流|供应链|地产|园区|文旅|旅游|游戏|传媒|自媒体|流媒体|媒体采访|消防|救援|认证工程师|证书|药企|制药|医药公司|生物制药|农业|农机|光伏|农田|环保|色谱|开挖|信号分析仪/i
      if (otherIndustry.test(tForIndustry)) return false
      // v3.1（2026-10-08 用户口径再收紧）：数据中心类硬件/网络产品营销无医疗语境一律不收
      // ——华为 DCS/DME/光网、东软 IDC 等曾靠裸「数据中心」强词放行
      var infraNonMedical = /数据中心(互联|虚拟化|管理|服务|双活|光网)|（DCS）|（DME）|（HCI）|\(DCS\)|\(DME\)|\(HCI\)|IDC(数据中心|机房|服务)|智算中心|算力中心/i
      if (infraNonMedical.test(t)) return false
      // 强词=医疗IT主题词表（评级/系统/平台/厂商），命中即收；临床词无法误导。
      // v3.1：去掉裸「数据中心」「互联互通」（保留 医院数据中心/医疗数据中心/互联互通测评/评级/标准化成熟度/医院信息互联互通 等带语境形态）
      var strongT = /电子病历|智慧医院|互联网医院|智慧医疗|智慧服务|智慧病房|智慧管理|智慧后勤|卫生信息化|医疗信息化|医院信息化|区域卫生信息|全民健康信息|数字医院|数字健康|互联网\+医疗|AI\+医疗|AI医疗|医疗健康信息|远程医疗|医院信息|医疗信息|临床信息系统|医院信息系统|医疗信息系统|医院数据中心|医疗数据中心|集成平台|一体化系统|一体化平台|信息平台|信息系统|信息中心|信创|国产化|CDSS|临床决策|医疗大模型|医疗人工智能|医疗AI|医学人工智能|医疗知识图谱|医院物联网|医疗物联网|移动护理|移动查房|掌上医院|电子病历评级|电子病历分级|电子病历应用水平|互联互通测评|互联互通评级|互联互通标准化成熟度|智慧服务评级|智慧服务分级|智慧服务测评|智慧管理评级|智慧管理分级|医院信息标准化|医院信息互联互通|智慧医院分级|DRG|DIP|医保信息化|医保信息平台|医保信息系统|医保电子凭证|健康医疗大数据|医疗大数据|华为医疗|腾讯健康|京东健康|阿里云医疗|百度灵医|东软集团|卫宁健康|创业慧康|东华医为|和仁科技|麦迪科技|万达信息|久远银海|嘉和美康|讯飞医疗|药品集采|集中带量采购|带量采购|集采|医保支付|医保目录|医保谈判|医疗服务价格|公立医院绩效考核|绩效考核|国考|医保改革|医疗改革|医保基金|双通道|按病种付费|检查检验结果互认|\bHIS\b|\bEMR\b|\bLIS\b|\bPACS\b|\bCDR\b|\bHRP\b|\bMMIT\b/i
      if (strongT.test(t)) return true
      // 纯临床/生活健康内容（患者救治、养生科普、号表通知等）→ 拒：是「医疗新闻」不是「医疗信息化」。
      // v3.1：补行业活动噪声（竞赛/巡讲/事迹/收官/落幕等——健康报、人民网源的高频杂音）
      var clinicalNoise = /养生|食疗|药膳|疫苗|辟谣|义诊|科普|健康指南|健康提醒|健康素养|天气预报|寒潮|降温|高温|节气|停诊|排班|义卖|锦旗|感谢信|坚守|抢救|成功救治|假日门诊|节假日门诊|门诊时间|就诊提示|挂号|流感|中暑|献血|急救常识|用药提醒|成功开展|首例手术|救治|竞赛|巡讲|先进事迹|技能大赛|比武|圆满收官|圆满举办|成功举办|顺利举办|落幕/i
      if (clinicalNoise.test(t)) return false
      // v3.2（2026-10-08 R209）：工程/物业/设备采购黑名单——医院三个字不等于医疗信息化，
      // 「污水站运维」「空调自控」这类含医院+运维/系统被弱判定误收者一律拒（强词命中优先于此，不误杀真信息化）
      var facilityNoise = /污水站|污水处理|给排水|电梯|扶梯|中央空调|通风空调|暖通|新风(?!险)|空调|配电房|供配电|变压器|发电机|UPS电源|锅炉|空气能|太阳能|绿化|园林|景观|保安|安保|保洁|洗涤|被服|食堂|餐饮|物业|后勤|基建|土建|桩基|基坑|幕墙|装饰装修|装修|装饰|改扩建|改建|扩建|施工(?!图)|监理|工程造价|整体搬迁|拆除|印刷|差旅|租车|班车|公务用车/i.test(t)
      if (facilityNoise) return false
      // v4（2026-10-15 用户口径：情报中心只要医疗软件信息化行业的信息）：硬件/耗材采购公告不是行业情报。
      // 必须「设备词 + 采购公告形态」**同时**命中才拒——单看设备词会误杀「医疗设备联网安全」这类安全议题。
      var deviceProcurement = /内窥镜|支气管镜|扫描仪|正电子发射|磁共振|超声|呼吸机|监护仪|麻醉机|药柜|纯水|合成模块|试剂|耗材|器械|检验设备|影像设备|屏蔽改造|设备机房|标识标牌|窗帘|家具/i
      var procurementForm = /招标公告|中标(结果)?公告|成交公告|询价公告|竞争性磋商|竞争性谈判|单一来源|采购公告|更正公告|废标公告|采购项目|重新招标|变更公告/i
      if (deviceProcurement.test(t) && procurementForm.test(t)) return false
      // 弱判定：医疗词 AND 医疗IT词 双命中才收（单独临床词不再放行）
      var medHit = /医|院|卫|健康/i.test(t)
      var itHit = /信息化|数字化|智慧|智能|系统|平台|软件|数据|信创|国产化|人工智能|\bAI\b|大数据|云计算|云化|上云|等保|网络安全|信息安全|集成|接口|机房|弱电|电子|互联网|线上|运维|测评|评级|分级评价|应用水平|解决方案|中台/i.test(t)
      return medHit && itHit
    }
    // 区域抽取：统一走顶层 __intelRegion（分层证据优先级），见文件头共享纯函数区
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
      __intelNoteFetchError(src, failMsg.slice(0, 400))
      return e.json(200, { ok: false, code: "fetch_failed", message: failMsg, added: 0, source_id: src.id })
    }
    if (res.statusCode !== 200) {
      __intelNoteFetchError(src, "对方返回 HTTP " + res.statusCode)
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
    var skippedDupTitle = 0
    re.lastIndex = 0
    while ((m = re.exec(html)) !== null && added < 20) {
      var href = unesc(m[1])
      var title = __intelTitleFromHtml(m[2]) // 2026-09-26 Q3 整改：高亮标签剥成空串，不再给关键词两侧插空格
      if (!title || title.length < 8 || title.length > 200) continue
      if (badTitleRe.test(title)) continue
      if (dateOnlyRe.test(title)) continue
      if (/^(javascript|mailto):/i.test(href)) continue
      var full = absUrl(href, url)
      if (!/^https?:\/\//i.test(full)) continue
      if (seen[full] || existing[full]) continue
      seen[full] = true
      // 条目自身块优先（2026-09-26 Q1/Q4 整改）：列表行里标题之后的内容属于本条；
      // 只在自身内容太短时才回看前一屏兜底，避免邻接条目的代理机构/省份混入本条区域与摘要。
      // 去标题用空白容忍匹配（旧 replace(title," ") 因高亮空格污染永远匹配不上，残留半截标题）。
      var flattenBlock = function (raw) {
        return unesc(String(raw).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
      }
      var block = html.slice(m.index, m.index + 900)
      var snippet = scrubIntel(__intelTextWithoutTitle(flattenBlock(block), title), 600)
      if (snippet.length < 60) {
        var bwdTxt = scrubIntel(__intelTextWithoutTitle(flattenBlock(html.slice(Math.max(0, m.index - 800), m.index)), title), 300)
        snippet = (snippet + " " + bwdTxt).trim().slice(0, 600)
      }
      snippet = snippet.replace(/^[|｜\s、，,。;；:：\-]+/, "")
      // 医疗信息化相关性过滤：不命中直接跳过不入库
      if (!medicalRelevant(title, snippet)) { skippedIrrelevant++; continue }
      var dup = null
      try { dup = $app.findFirstRecordByFilter("intel_items", "url={:u}", { u: full }) } catch (err4) { dup = null }
      if (dup) { existing[full] = true; continue }
      var normTitle = String(title || "").replace(/\s+/g, " ").trim().slice(0, 300)
      var dupT = null
      try { dupT = $app.findFirstRecordByFilter("intel_items", "title={:t}", { t: normTitle }) } catch (errT2) { dupT = null }
      if (dupT) { skippedDupTitle++; continue }
      // 追进原文抓正文（清洗导航/页脚噪声）；失败/过短则回退列表页邻接 snippet。注意 body 在本回调已是请求体对象，故正文用 artBody。
      // 政府 .gov.cn 多为 CFCA/SM2 证书，Go $http 不信任 → 抓不到正文时回退；摘要/标签只在真的抓到正文时生成，绝不用噪声 snippet 伪造。
      var artBody = ""
      if (added < __maxBody && new Date().getTime() < __bodyDeadline) artBody = fetchArticleBody(full)
      var hasBody = !!(artBody && artBody.length > 120)
      var finalSnippet = hasBody && artBody.length > snippet.length ? scrubIntel(artBody, 2400) : snippet
      var enrichText = (title + " " + (hasBody ? artBody : "")).slice(0, 3000)
      // 发布时间 v2（2026-09-26 Q2 整改，与 tick 同口径；本回调正文变量为 artBody）
      var pubAt = __intelPubAt(full, block, hasBody ? artBody : "")
      if (!pubAt) pubAt = new Date().toISOString().slice(0, 10)
      var item = new Record(itemColl)
      item.set("source_id", src.id)
      item.set("source_name", String(src.get("source_name") || ""))
      item.set("title", title.slice(0, 300))
      item.set("url", full.slice(0, 600))
      item.set("content_snippet", finalSnippet)
      item.set("item_type", String(src.get("source_type") || "policy"))
      item.set("summary", hasBody ? makeSummary(artBody, title) : "")
      if (String(src.get("source_type") || "") === "bid" || /招标|中标|成交|采购|磋商|询价|开标/.test(title)) {
        var bs = __intelExtractBid(title, hasBody ? artBody : snippet)
        var bsKeys = 0
        for (var bk in bs) bsKeys++
        if (bsKeys > 0) item.set("structured", bs)
      }
      item.set("tags", extractTags(enrichText))
      item.set("region", __intelRegion(title, snippet))
      item.set("item_status", "pending")
      item.set("added_by", "crawl")
      item.set("owner_id", isBuiltin ? "" : srcOwner)
      item.set("visibility", isBuiltin ? "public" : "personal")
      item.set("published_at", pubAt)
      $app.save(item)
      existing[full] = true
      added++
    }
    __intelNoteFetchOk(src, added)
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
    var userId = norm(String(e.get("rhUserId") || ""))
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
    var userId = norm(String(e.get("rhUserId") || ""))
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
    // ==== 共享纯函数镜像（唯一事实来源，scripts/intelShared.test.ts 强制 4 份逐字节一致） ====
    // ===INTEL-SHARED-BEGIN===
    // 共享纯函数区（2026-09-26 质量整改 Q1–Q4，见 docs/全局质量规范-测试与交付门槛.md）
    // 此前 REGION_WORDS/extractRegion 等在 tick / fetch-now / items 迁移 / enrich 四处各持一份拷贝，
    // 改一处漏三处是「多拷贝漂移」。现统一收敛到顶层一份：
    //  - Goja 单 VM 启动时顺序加载全部 pb_hooks，顶层 var 全局可见（zx_guard.pb.js 顶层常量同款先例）；
    //  - 以下函数全部只读入参、无可变共享态，请求间并发安全；
    //  - 命名带 __intel 前缀，避免与其他 hook 文件的全局名冲突。
    // ===========================================================================

    // 省份区域词表（零 AI）：全称 + 多字简称（单字简称误报率高，刻意排除）
    var __INTEL_REGION_WORDS = [
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
    var __intelRegionByWord = function (s) {
      var t = String(s || "")
      for (var i = 0; i < __INTEL_REGION_WORDS.length; i++) {
        if (t.indexOf(__INTEL_REGION_WORDS[i].w) >= 0) return __INTEL_REGION_WORDS[i].r
      }
      return ""
    }

    // 标题剥标签：内联高亮标签（政采网搜索结果会给关键词套 <font>）必须替换为空串。
    // 旧实现替换为空格，导致「青浦区中心 医院」这类关键词两侧插空格的标题污染并入库。
    var __intelTitleFromHtml = function (rawHtml) {
      return unescInt(String(rawHtml || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim()
    }
    // 实体解码（与各回调内 unesc 同口径；独立一份供顶层函数使用）
    var unescInt = function (s) {
      return String(s).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&ldquo;|&rdquo;/g, "").replace(/\s+/g, " ").trim()
    }

    // 区域抽取 v2（分层证据优先级，取代旧「标题+邻接窗口里第一个省份词」）：
    //  1) 采购人归属：条目块「采购人：××」值中的省份词（最强证据：采购人属地即项目属地）
    //  2) 递交地：「在××省政府采购网 / 在××市政府采购网」中的省份词
    //  3) 标题本体中的省份词（次强：标题主体是项目名；注意代理机构名也可能出现在标题里，
    //     所以排序在 1)/2) 之后）
    //  4) 条目自身块的面包屑「…公告 | 省份 | …」
    //  5) 兜底：条目自身块内第一个省份词（调用方必须保证传入的是「条目自身块」而非 ±800 邻接窗口，
    //     否则邻接条目的代理机构名会重演「青浦区→青海」错标）
    var __intelRegion = function (title, ownBlock, strict) {
      var t = String(title || "")
      var b = String(ownBlock || "")
      var mp = b.match(/采购人[：:]\s*([^，,。;；|\n]{2,30})/)
      if (mp) { var r1 = __intelRegionByWord(mp[1]); if (r1) return r1 }
      var mg = b.match(/在([^，,。;；|\n]{2,14}?(?:省|自治区)政府采购网)|在([^，,。;；|\n]{1,8}?市)政府采购网/)
      if (mg) { var r2 = __intelRegionByWord(mg[1] || mg[2] || ""); if (r2) return r2 }
      var r3 = __intelRegionByWord(t)
      if (r3) return r3
      // 4.5) 代理机构属地（条目自身块内为强证据）：块里可能有多个「代理机构：」（开头的是邻接噪声），
      // ccgp 列表行元数据「时间戳 | 采购人 | 代理机构」总在末尾 → 从最后一个往前找省份词
      var maAll = b.match(/代理机构[：:]\s*([^，,。;；|\n]{2,30})/g)
      if (maAll) {
        for (var ai = maAll.length - 1; ai >= 0; ai--) {
          var r45 = __intelRegionByWord(maAll[ai].replace(/^代理机构[：:]\s*/, ""))
          if (r45) return r45
        }
      }
      var mb = b.match(/[|｜]\s*([^|｜，,。;；\s]{2,8})\s*[|｜]/)
      if (mb) { var r4 = __intelRegionByWord(mb[1]); if (r4) return r4 }
      // strict 模式（存量重算专用）：弱证据兜底不参与——宁可保留旧值，绝不因邻接噪声改错
      if (strict) return ""
      return __intelRegionByWord(b)
    }

    var __intelValidDate = function (y, mo, d) {
      var yy = parseInt(y, 10), mm = parseInt(mo, 10), dd = parseInt(d, 10)
      if (!(yy >= 2020 && yy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return ""
      var mmS = mm < 10 ? "0" + mm : "" + mm
      var ddS = dd < 10 ? "0" + dd : "" + dd
      var iso = yy + "-" + mmS + "-" + ddS
      // 未来日期守卫（2026-10-20）：发布时间不可能是未来。原判据只把年份卡在 2020..2100，
      // 而 __intelPubAt 的最后一条优先级是在**全文**里扫日期（仅排除递交/截止/开标上下文），
      // 于是源页里混着的课程日期、政策路线图年份、版权行一旦被抽中就会入库成未来时间——
      // 实测 HIT专家网「培训班招生」页抽出 2027-04-29 / 2027-01-03。列表按 -published_at
      // 排序，未来日期会永远置顶。留 1 天容差吸收时区差（源多为 date-only，此处按 UTC 零点解释）。
      // 注意：本函数因此不再是纯函数（依赖当前时间）。既有 Q2 用例全部使用过去的日期，
      // 故不受影响；将来新增用例不要用固定未来日期，否则会随真实时间变红。
      if (iso > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) return ""
      return iso
    }

    // 发布时间抽取 v2（发布时间 ≠ 正文第一个日期：政采网公告正文第一个日期是投标截止时间，
    // 旧实现拿它当发布时间入库，导致列表按「发布时刻」排序实为按截止时间倒挂）。
    // 优先级：URL 内嵌日期（ccgp t20260925_x.htm / /202609/ 目录）> 「发布时间：」标签
    //   > 列表条目自带时间戳（2026.09.25 11:38:54）> 正文日期（排除递交/截止/开标上下文）> 空串由调用方兜底
    var __intelPubAt = function (url, ownBlock, body) {
      var u = String(url || "")
      var mu = u.match(/t(20\d{2})(\d{2})(\d{2})_\w*\.htm/i) || u.match(/\/(20\d{2})(\d{2})(\d{2})\//)
      if (mu) { var d0 = __intelValidDate(mu[1], mu[2], mu[3]); if (d0) return d0 }
      var b = String(ownBlock || "")
      var bd = String(body || "")
      var text = bd ? bd + "\n" + b : b
      var ml = text.match(/(?:发布时间|发布日期|公布时间|公告发布|发布日期日期)[：:]\s*(20\d{2})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})/)
      if (ml) { var d1 = __intelValidDate(ml[1], ml[2], ml[3]); if (d1) return d1 }
      var ms = b.match(/(20\d{2})\.(\d{1,2})\.(\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/)
      if (ms) { var d2 = __intelValidDate(ms[1], ms[2], ms[3]); if (d2) return d2 }
      var re = /(20\d{2})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})/g
      var m4
      while ((m4 = re.exec(text)) !== null) {
        var before = text.slice(Math.max(0, m4.index - 20), m4.index)
        // after 只看同句（在句读处截断）：下一句的「递交/截止」不能株连本句的发布日期
        var afterRaw = text.slice(m4.index, m4.index + 40)
        var cutAt = afterRaw.search(/[。；！？，]/)
        var after = cutAt >= 0 ? afterRaw.slice(0, cutAt) : afterRaw
        if (/递交|截止|开标|投标|报名|响应文件|资格预审|澄清|答疑|询问|质疑/.test(before + after)) continue
        var d3 = __intelValidDate(m4[1], m4[2], m4[3])
        if (d3) return d3
      }
      return ""
    }

    // 招标/中标结构化字段（零 AI，2026-11-02 起随抓取直接写入 structured）。
    // 只写明确命中的键；无命中返回 {}，调用方不落成空对象。字段口径与 /api/intel/extract-bid 一致。
    var __intelExtractBid = function (title, text) {
      var out = {}
      var full = String(title || "") + "\n" + String(text || "")
      var grab = function (resList) {
        for (var gi = 0; gi < resList.length; gi++) {
          var mm = full.match(resList[gi])
          if (mm && mm[1]) return String(mm[1]).replace(/\s+/g, " ").trim().slice(0, 160)
        }
        return ""
      }
      var ORG_TAIL = "医院|卫生院|保健院|卫健委|卫生健康委|公司|集团|大学|学院|中心|研究院|研究所|事务所|银行|学校|委员会|管委会|管理局|管理处|政府|局|厅|部|厂|站"
      // 采购人：正文显式标签最强；没有再取标题开头机构名（贪婪到机构尾词，避免只取到「北京大学」）
      var buyer = grab([
        /(?:采购人|招标人|招标单位|采购单位|采购人名称|招标人名称|项目建设单位)\s*[:：为]\s*(?:名称)?\s*([^\s，。；;:：、()（）]{2,40}(?:医院|卫生院|保健院|卫健委|卫生健康委|公司|集团|大学|学院|中心|研究院|研究所|事务所|银行|学校|委员会|管委会|管理局|管理处|政府|局|厅|部|厂|站))/,
        new RegExp("^([\\u4e00-\\u9fa5A-Za-z0-9（）()·]{2,45}(?:" + ORG_TAIL + "))"),
      ])
      if (buyer && buyer.length >= 4) out.buyer = buyer.replace(/^关于/, "").slice(0, 60)
      var budget = grab([
        /(?:预算金额|采购预算|最高限价|控制价|估算价|预算总价|项目预算|资金预算|概算|预算)\s*[:：为]?\s*(?:人民币)?\s*([\d,，.]+\s*(?:万元|亿元|元))/,
      ])
      if (budget) out.budget = budget.replace(/\s+/g, "")
      var deadline = grab([
        /(?:投标截止|递交截止|报名截止|获取[^\n]{0,8}?截止|开标时间|截止时间|截止日期|响应文件截止)\s*[:：为至]?\s*(20\d{2}[-/年.]\d{1,2}[-/月.]\d{1,2}\s*日?(?:\s*\d{1,2}[:：]\d{1,2}(?:[:：]\d{1,2})?\s*(?:时|分)?)?)/,
      ])
      if (deadline) out.deadline = deadline.replace(/\s+/g, "")
      var code = grab([
        /(?:招标编号|采购编号|项目编号|谈判编号|询价编号|比选编号|证券项目编号)\s*[:：为]?\s*([A-Za-z0-9][A-Za-z0-9\-_./·]{3,39})/,
      ])
      if (code) out.code = code
      var winner = grab([
        /(?:中标(?:人|单位|供应商|公司)|成交(?:供应商|人|单位)|第一中标(?:候选人|供应商))\s*[:：为]\s*([^\s，。；;:：、]{2,40}(?:公司|集团|医院|中心|研究院|事务所|大学|厂|行))/,
      ])
      if (winner) out.winner = winner
      var won = grab([
        /(?:中标金额|成交金额|中标价|成交价格|合同金额)\s*[:：为]?\s*(?:人民币)?\s*([\d,，.]+\s*(?:万元|亿元|元))/,
      ])
      if (won) out.won_amount = won.replace(/\s+/g, "")
      return out
    }

    // 标题历史污染清洗（存量数据）：抓取端旧实现把高亮标签剥成空格，标题里留下「医院」两侧空格。
    // 中文排版中汉字之间的空格几乎不可能是刻意的，汉字/中文标点之间的空格安全折叠；
    // 英文/数字之间的空格保留（"CT MRI"这类不吃掉）。
    var __intelCleanTitleSpacing = function (t) {
      return String(t || "").replace(/([\u4e00-\u9fa5）】」》、，。；：？！])\s+([\u4e00-\u9fa5（【「《])/g, "$1$2")
    }

    // 从一段正文文本里构造「去标题」片段（供摘要用）：允许标题在文本里被空白打断
    // （旧实现 replace(title," ") 因高亮空格污染永远匹配不上，导致摘要里残留半截标题）。
    var __intelTextWithoutTitle = function (text, title) {
      var t = String(text || "")
      var ttl = String(title || "")
      if (!ttl) return t
      var esc = ttl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      try {
        var fuzzy = esc.split("").join("\\s*")
        return t.replace(new RegExp(fuzzy), " ")
      } catch (eReg) {
        return t.split(ttl).join(" ")
      }
    }
    // ===INTEL-SHARED-END===

    var norm = function (s) { return String(s == null ? "" : s).trim() }
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(String(e.get("rhUserId") || ""))
    var q = (e.requestInfo() || {}).query || {}
    var qv = function (key) {
      var v = q[key]
      if (v && typeof v === "object" && typeof v.length === "number") v = v[0]
      return norm(v)
    }

    // ---- 存量懒迁移（幂等，每次最多处理 300 条 visibility='' 的旧条目） ----
    // 医疗信息化相关性 v3（2026-10-07 用户口径收紧：只收「医疗软件信息化/智慧医院建设」——
    // HIS、EMR、集成平台、数据中心、一体化系统、电子病历/互联互通/智慧服务/智慧管理评级、
    // 智慧医院建设、信创等。v2 的「核心医疗词单独命中即收」会让养生/疫苗/义诊/抢救等
    // 纯临床生活新闻刷屏情报流，是「太乱」的根因，v3 要求必须命中医疗IT主题词）。
    // 判定顺序：噪音行 → 非医疗行业（医学院/医科大学 先剥离再判）→ 强词命中即收 →
    // 纯临床生活噪声 → 弱判定（医疗词 AND 医疗IT词 双命中）。
    var noiseRe = /版权|All Rights|ICP 备|备案号|友情链接|隐私政策|使用条款|网站地图/i
    var medicalRelevant = function (title, snippet) {
      var t = String(title || "")
      if (!t) return false
      if (noiseRe.test(t)) return false
      // 相关性只看标题（多行业厂商页面 snippet 满是医疗词，用 snippet 必误放行）
      var tForIndustry = t.replace(/医学院|医科大学|医学高等专科/g, "医院")
      var otherIndustry = /电信|运营商|能源|电力|电网|交通|轨交|地铁|航空|金融|银行|保险|证券|制造|工业互联|政务|海关|税务|教育|校园|教学|学院|水利|水文|矿山|钢铁|冶金|汽车|座舱|行泊|车联|车载|石化|化工|煤炭|矿业|烟草|邮政|物流|供应链|地产|园区|文旅|旅游|游戏|传媒|自媒体|流媒体|媒体采访|消防|救援|认证工程师|证书|药企|制药|医药公司|生物制药|农业|农机|光伏|农田|环保|色谱|开挖|信号分析仪/i
      if (otherIndustry.test(tForIndustry)) return false
      // v3.1（2026-10-08 用户口径再收紧）：数据中心类硬件/网络产品营销无医疗语境一律不收
      // ——华为 DCS/DME/光网、东软 IDC 等曾靠裸「数据中心」强词放行
      var infraNonMedical = /数据中心(互联|虚拟化|管理|服务|双活|光网)|（DCS）|（DME）|（HCI）|\(DCS\)|\(DME\)|\(HCI\)|IDC(数据中心|机房|服务)|智算中心|算力中心/i
      if (infraNonMedical.test(t)) return false
      // 强词=医疗IT主题词表（评级/系统/平台/厂商），命中即收；临床词无法误导。
      // v3.1：去掉裸「数据中心」「互联互通」（保留 医院数据中心/医疗数据中心/互联互通测评/评级/标准化成熟度/医院信息互联互通 等带语境形态）
      var strongT = /电子病历|智慧医院|互联网医院|智慧医疗|智慧服务|智慧病房|智慧管理|智慧后勤|卫生信息化|医疗信息化|医院信息化|区域卫生信息|全民健康信息|数字医院|数字健康|互联网\+医疗|AI\+医疗|AI医疗|医疗健康信息|远程医疗|医院信息|医疗信息|临床信息系统|医院信息系统|医疗信息系统|医院数据中心|医疗数据中心|集成平台|一体化系统|一体化平台|信息平台|信息系统|信息中心|信创|国产化|CDSS|临床决策|医疗大模型|医疗人工智能|医疗AI|医学人工智能|医疗知识图谱|医院物联网|医疗物联网|移动护理|移动查房|掌上医院|电子病历评级|电子病历分级|电子病历应用水平|互联互通测评|互联互通评级|互联互通标准化成熟度|智慧服务评级|智慧服务分级|智慧服务测评|智慧管理评级|智慧管理分级|医院信息标准化|医院信息互联互通|智慧医院分级|DRG|DIP|医保信息化|医保信息平台|医保信息系统|医保电子凭证|健康医疗大数据|医疗大数据|华为医疗|腾讯健康|京东健康|阿里云医疗|百度灵医|东软集团|卫宁健康|创业慧康|东华医为|和仁科技|麦迪科技|万达信息|久远银海|嘉和美康|讯飞医疗|药品集采|集中带量采购|带量采购|集采|医保支付|医保目录|医保谈判|医疗服务价格|公立医院绩效考核|绩效考核|国考|医保改革|医疗改革|医保基金|双通道|按病种付费|检查检验结果互认|\bHIS\b|\bEMR\b|\bLIS\b|\bPACS\b|\bCDR\b|\bHRP\b|\bMMIT\b/i
      if (strongT.test(t)) return true
      // 纯临床/生活健康内容（患者救治、养生科普、号表通知等）→ 拒：是「医疗新闻」不是「医疗信息化」。
      // v3.1：补行业活动噪声（竞赛/巡讲/事迹/收官/落幕等——健康报、人民网源的高频杂音）
      var clinicalNoise = /养生|食疗|药膳|疫苗|辟谣|义诊|科普|健康指南|健康提醒|健康素养|天气预报|寒潮|降温|高温|节气|停诊|排班|义卖|锦旗|感谢信|坚守|抢救|成功救治|假日门诊|节假日门诊|门诊时间|就诊提示|挂号|流感|中暑|献血|急救常识|用药提醒|成功开展|首例手术|救治|竞赛|巡讲|先进事迹|技能大赛|比武|圆满收官|圆满举办|成功举办|顺利举办|落幕/i
      if (clinicalNoise.test(t)) return false
      // v3.2（2026-10-08 R209）：工程/物业/设备采购黑名单——医院三个字不等于医疗信息化，
      // 「污水站运维」「空调自控」这类含医院+运维/系统被弱判定误收者一律拒（强词命中优先于此，不误杀真信息化）
      var facilityNoise = /污水站|污水处理|给排水|电梯|扶梯|中央空调|通风空调|暖通|新风(?!险)|空调|配电房|供配电|变压器|发电机|UPS电源|锅炉|空气能|太阳能|绿化|园林|景观|保安|安保|保洁|洗涤|被服|食堂|餐饮|物业|后勤|基建|土建|桩基|基坑|幕墙|装饰装修|装修|装饰|改扩建|改建|扩建|施工(?!图)|监理|工程造价|整体搬迁|拆除|印刷|差旅|租车|班车|公务用车/i.test(t)
      if (facilityNoise) return false
      // v4（2026-10-15 用户口径：情报中心只要医疗软件信息化行业的信息）：硬件/耗材采购公告不是行业情报。
      // 必须「设备词 + 采购公告形态」**同时**命中才拒——单看设备词会误杀「医疗设备联网安全」这类安全议题。
      var deviceProcurement = /内窥镜|支气管镜|扫描仪|正电子发射|磁共振|超声|呼吸机|监护仪|麻醉机|药柜|纯水|合成模块|试剂|耗材|器械|检验设备|影像设备|屏蔽改造|设备机房|标识标牌|窗帘|家具/i
      var procurementForm = /招标公告|中标(结果)?公告|成交公告|询价公告|竞争性磋商|竞争性谈判|单一来源|采购公告|更正公告|废标公告|采购项目|重新招标|变更公告/i
      if (deviceProcurement.test(t) && procurementForm.test(t)) return false
      // 弱判定：医疗词 AND 医疗IT词 双命中才收（单独临床词不再放行）
      var medHit = /医|院|卫|健康/i.test(t)
      var itHit = /信息化|数字化|智慧|智能|系统|平台|软件|数据|信创|国产化|人工智能|\bAI\b|大数据|云计算|云化|上云|等保|网络安全|信息安全|集成|接口|机房|弱电|电子|互联网|线上|运维|测评|评级|分级评价|应用水平|解决方案|中台/i.test(t)
      return medHit && itHit
    }
    // 区域抽取走顶层 __intelRegion（共享纯函数区）
    var scrubIntel = function (raw, max) {
      var s = String(raw == null ? "" : raw)
      s = s.replace(/<script[\s\S]*?<\/script>/gi, " ")
      s = s.replace(/<style[\s\S]*?<\/style>/gi, " ")
      s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      s = s.replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      s = s.replace(/<!--[\s\S]*?-->/g, " ")
      s = s.replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ")
      s = s.replace(/<br\s*\/?>/gi, "\n")
      s = s.replace(/<\/(p|div|li|h[1-6]|tr|td|section|article)>/gi, "\n")
      s = s.replace(/<[^>]*>/g, " ")
      s = s.replace(/<[^>]*$/g, " ")
      s = s.replace(/[\w:.=-]+\s*=\s*"[^"]*"/g, " ")
      s = s.replace(/[\w:.=-]+\s*=\s*'[^']*'/g, " ")
      s = s.replace(/[\w:.=-]+\s*=\s*[^\s"'<>]+/g, " ")
      s = s.replace(/[<>]/g, " ")
      s = s.replace(/[\w/.-]*\.(?:jpg|jpeg|png|gif|webp|bmp)["']?/gi, " ")
      s = s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      s = s.replace(/&#x([0-9a-fA-F]+);/g, function (m2, hh) { try { return String.fromCharCode(parseInt(hh, 16)) } catch (e2) { return " " } })
      s = s.replace(/&#(\d+);/g, function (m3, dd) { try { return String.fromCharCode(parseInt(dd, 10)) } catch (e3) { return " " } })
      s = s.replace(/&amp;/g, "&")
      var lines = s.split(/\n+/)
      var keep = []
      for (var li = 0; li < lines.length; li++) {
        var t = lines[li].replace(/\s+/g, " ").trim()
        if (!t) continue
        if (/[{}]/.test(t)) continue
        if (/https?:\/\/|\.php|\.aspx?\b|share\.php|weibo\.com|javascript:|\burl\s*[:=]/i.test(t)) continue
        if (/^[[{]/.test(t) || /;\s*$/.test(t)) continue
        if (/版权|All Rights|ICP|备案|返回|打印|分享|关注|扫码|二维码|上一篇|下一篇|相关阅读|网站地图|登录|注册|首页|导航|广告|免责声明|联系我们|友情链接|隐私政策|使用条款/.test(t)) continue
        if (/^[\d\s\-\/年月日.:：()\[\]，,周星期]+$/.test(t)) continue
        keep.push(t)
      }
      var out = keep.join(" ").replace(/\s+/g, " ").trim()
      if (max && out.length > max) out = out.slice(0, max)
      return out
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
        var rgVal = __intelRegion(String(rRows[rgi].get("title") || ""), String(rRows[rgi].get("content_snippet") || ""))
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

    // ---- content_snippet 存量深度清洗（幂等）：剥离历史脏数据里的半截标签/属性对/图片路径/
    // 分享链接/CSS 残片。仅在 snippet 仍含垃圾标记时才回写，清洗后不再命中 → 对已干净数据零
    // 改动、可安全重复执行；与抓取入库环节用同一 scrubIntel 口径，避免只靠前端 displayizeIntel 兜底。
    var migSnip = 0
    try {
      var snipRows = $app.findRecordsByFilter("intel_items", "content_snippet != ''", "created", 2000, 0)
      for (var sp = 0; sp < snipRows.length; sp++) {
        var spRow = snipRows[sp]
        var spRaw = String(spRow.get("content_snippet") || "")
        if (!/[<>]|[\w:.=-]\s*=\s*["']|\.(jpg|jpeg|png|gif|webp|bmp)|weibo\.com|share\.php|\.php|\{|\}/i.test(spRaw)) continue
        var spClean = scrubIntel(spRaw, 2400)
        if (spClean !== spRaw) {
          spRow.set("content_snippet", spClean)
          $app.save(spRow)
          migSnip++
        }
      }
      if (migSnip > 0) {
        $app.logger().info("intel items content_snippet scrub", "cleaned", migSnip)
      }
    } catch (errSnip) {
      $app.logger().warn("intel items content_snippet scrub skipped", "err", String(errSnip))
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
      var st = null
      try { var rawS = rec.getString("structured"); if (rawS) { var ps2 = JSON.parse(rawS); if (ps2 && typeof ps2 === "object") st = ps2 } } catch (err) { st = null }
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
        structured: st,
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
    // 按 my_status 过滤必须先拿到「全部」匹配行再分页——my_status 存在 intel_views 里（每人一份，
    // 缺省 pending），PB 的过滤表达式 join 不到该表，只能在内存里拼。
    //
    // 2026-11-04 修（审计：分页失真）：旧实现固定只取 500 条再内存过滤，多的直接看不见，
    // 而且 totalItems 报的是「过滤后还剩几条」，两处一起错。真实库实测：922 条可见情报中
    // **422 条（46%）永远不可能出现在列表里**，界面还显示「情报总数 500」——用户完全无从察觉。
    // 现改为分批取全（每批 500，上限 MAX_SCAN 防失控），total 即为真实命中数。
    var MAX_SCAN = 5000
    var BATCH = 500
    var rows = []
    var scanned = 0
    while (scanned < MAX_SCAN) {
      var chunk = $app.findRecordsByFilter("intel_items", whereSql, "-published_at", BATCH, scanned, params)
      if (!chunk.length) break
      for (var ci = 0; ci < chunk.length; ci++) rows.push(chunk[ci])
      scanned += chunk.length
      // 最后一批没取满 = 已经到底，不必再发一次查询
      if (chunk.length < BATCH) break
    }
    var filtered = []
    for (var i = 0; i < rows.length; i++) {
      var myStatus = viewMap[rows[i].id] || "pending"
      if (stList.indexOf(myStatus) < 0) continue
      var obj = pub(rows[i])
      obj.my_status = myStatus
      filtered.push(obj)
    }
    var total = filtered.length
    // 扫描触顶时如实告知（宁可让界面显示「还有更多」的提示，也不要假装已经全了）
    var truncated = rows.length >= MAX_SCAN
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
    return e.json(200, { ok: true, items: items, page: page, perPage: perPage, totalItems: total, allTags: allTags, truncated: truncated })
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
    var userId = norm(String(e.get("rhUserId") || ""))
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再清理情报" })
    var body = e.requestInfo().body || {}
    var doDelete = body.confirm === true
    // 相关性 v3 反向判定（与采集过滤同口径，2026-10-07 用户口径收紧：只收医疗软件信息化；
    // 按约定在回调内自持一份，不跨文件共享）
    var noiseRe = /版权|All Rights|ICP 备|备案号|友情链接|隐私政策|使用条款|网站地图/i
    var isIrrelevant = function (title, snippet) {
      var t = String(title || "")
      if (!t) return true
      if (noiseRe.test(t)) return true
      var tForIndustry = t.replace(/医学院|医科大学|医学高等专科/g, "医院")
      var otherIndustry = /电信|运营商|能源|电力|电网|交通|轨交|地铁|航空|金融|银行|保险|证券|制造|工业互联|政务|海关|税务|教育|校园|教学|学院|水利|水文|矿山|钢铁|冶金|汽车|座舱|行泊|车联|车载|石化|化工|煤炭|矿业|烟草|邮政|物流|供应链|地产|园区|文旅|旅游|游戏|传媒|自媒体|流媒体|媒体采访|消防|救援|认证工程师|证书|药企|制药|医药公司|生物制药|农业|农机|光伏|农田|环保|色谱|开挖|信号分析仪/i
      if (otherIndustry.test(tForIndustry)) return true
      // v3.1（2026-10-08 与采集过滤同口径）：数据中心类硬件/网络产品营销无医疗语境 → 不相关
      var infraNonMedical = /数据中心(互联|虚拟化|管理|服务|双活|光网)|（DCS）|（DME）|（HCI）|\(DCS\)|\(DME\)|\(HCI\)|IDC(数据中心|机房|服务)|智算中心|算力中心/i
      if (infraNonMedical.test(t)) return true
      var strongT = /电子病历|智慧医院|互联网医院|智慧医疗|智慧服务|智慧病房|智慧管理|智慧后勤|卫生信息化|医疗信息化|医院信息化|区域卫生信息|全民健康信息|数字医院|数字健康|互联网\+医疗|AI\+医疗|AI医疗|医疗健康信息|远程医疗|医院信息|医疗信息|临床信息系统|医院信息系统|医疗信息系统|医院数据中心|医疗数据中心|集成平台|一体化系统|一体化平台|信息平台|信息系统|信息中心|信创|国产化|CDSS|临床决策|医疗大模型|医疗人工智能|医疗AI|医学人工智能|医疗知识图谱|医院物联网|医疗物联网|移动护理|移动查房|掌上医院|电子病历评级|电子病历分级|电子病历应用水平|互联互通测评|互联互通评级|互联互通标准化成熟度|智慧服务评级|智慧服务分级|智慧服务测评|智慧管理评级|智慧管理分级|医院信息标准化|医院信息互联互通|智慧医院分级|DRG|DIP|医保信息化|医保信息平台|医保信息系统|医保电子凭证|健康医疗大数据|医疗大数据|华为医疗|腾讯健康|京东健康|阿里云医疗|百度灵医|东软集团|卫宁健康|创业慧康|东华医为|和仁科技|麦迪科技|万达信息|久远银海|嘉和美康|讯飞医疗|药品集采|集中带量采购|带量采购|集采|医保支付|医保目录|医保谈判|医疗服务价格|公立医院绩效考核|绩效考核|国考|医保改革|医疗改革|医保基金|双通道|按病种付费|检查检验结果互认|\bHIS\b|\bEMR\b|\bLIS\b|\bPACS\b|\bCDR\b|\bHRP\b|\bMMIT\b/i
      if (strongT.test(t)) return false
      var clinicalNoise = /养生|食疗|药膳|疫苗|辟谣|义诊|科普|健康指南|健康提醒|健康素养|天气预报|寒潮|降温|高温|节气|停诊|排班|义卖|锦旗|感谢信|坚守|抢救|成功救治|假日门诊|节假日门诊|门诊时间|就诊提示|挂号|流感|中暑|献血|急救常识|用药提醒|成功开展|首例手术|救治|竞赛|巡讲|先进事迹|技能大赛|比武|圆满收官|圆满举办|成功举办|顺利举办|落幕/i
      if (clinicalNoise.test(t)) return true
      // v3.2（2026-10-08 R209 与采集过滤同口径）：工程/物业/设备采购 → 不相关
      var facilityNoise = /污水站|污水处理|给排水|电梯|扶梯|中央空调|通风空调|暖通|新风(?!险)|空调|配电房|供配电|变压器|发电机|UPS电源|锅炉|空气能|太阳能|绿化|园林|景观|保安|安保|保洁|洗涤|被服|食堂|餐饮|物业|后勤|基建|土建|桩基|基坑|幕墙|装饰装修|装修|装饰|改扩建|改建|扩建|施工(?!图)|监理|工程造价|整体搬迁|拆除|印刷|差旅|租车|班车|公务用车/i.test(t)
      if (facilityNoise) return true
      // v4（2026-10-15 用户口径：情报中心只要医疗软件信息化行业的信息）：硬件/耗材采购公告不是行业情报。
      // 必须「设备词 + 采购公告形态」**同时**命中才判无关——单看设备词会误杀「医疗设备联网安全」这类安全议题。
      var deviceProcurement = /内窥镜|支气管镜|扫描仪|正电子发射|磁共振|超声|呼吸机|监护仪|麻醉机|药柜|纯水|合成模块|试剂|耗材|器械|检验设备|影像设备|屏蔽改造|设备机房|标识标牌|窗帘|家具/i
      var procurementForm = /招标公告|中标(结果)?公告|成交公告|询价公告|竞争性磋商|竞争性谈判|单一来源|采购公告|更正公告|废标公告|采购项目|重新招标|变更公告/i
      if (deviceProcurement.test(t) && procurementForm.test(t)) return true
      var medHit = /医|院|卫|健康/i.test(t)
      var itHit = /信息化|数字化|智慧|智能|系统|平台|软件|数据|信创|国产化|人工智能|\bAI\b|大数据|云计算|云化|上云|等保|网络安全|信息安全|集成|接口|机房|弱电|电子|互联网|线上|运维|测评|评级|分级评价|应用水平|解决方案|中台/i.test(t)
      return !(medHit && itHit)
    }
    var rows = $app.findRecordsByFilter("intel_items", "(visibility='public' || owner_id={:u}) && added_by='crawl'", "-created", 2000, 0, { u: userId })
    var bad = []
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i]
      var snip = String(r.get("content_snippet") || "") + " " + String(r.get("summary") || "")
      if (isIrrelevant(String(r.get("title") || ""), snip)) bad.push(r)
    }
    // R-033 数据安全：备份模式——清理前先取全量命中记录导出本地留存（不删除）。
    // 口径与下方 delete 完全同一 bad 集合；前端据此「备份成功且数量对齐才发删除」。
    // 按 Goja 回调自持约定在本块内序列化一份，不跨文件共享 helper。
    if (body.backup === true) {
      var out = []
      for (var bi = 0; bi < bad.length; bi++) {
        var br = bad[bi]
        var btg = []
        try { var brt = br.getString("tags"); if (brt) { var bpt = JSON.parse(brt); if (bpt && typeof bpt.length === "number") btg = bpt } } catch (errT) { btg = [] }
        out.push({
          id: br.id,
          title: String(br.get("title") || ""),
          url: String(br.get("url") || ""),
          source_name: String(br.get("source_name") || ""),
          content_snippet: String(br.get("content_snippet") || ""),
          summary: String(br.get("summary") || ""),
          tags: btg,
          item_type: String(br.get("item_type") || ""),
          region: String(br.get("region") || ""),
          added_by: String(br.get("added_by") || ""),
          owner_id: String(br.get("owner_id") || ""),
          visibility: String(br.get("visibility") || ""),
          published_at: String(br.get("published_at") || ""),
          created: String(br.get("created") || ""),
          updated: String(br.get("updated") || "")
        })
      }
      return e.json(200, { ok: true, backup: true, count: out.length, items: out })
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
    var userId = norm(String(e.get("rhUserId") || ""))
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
    var userId = norm(String(e.get("rhUserId") || ""))
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

// ---------------------------------------------------------------------------
// POST /api/intel/enrich — 存量情报回填（重抓正文 → snippet 去噪 → summary/tags/region 重生成）
//  - body.item_ids：每次回填指定条目（≤40 条）；body.budget_ms：时间预算（默认 95000，上限 110000），
//    超预算未处理的条目在 pending_ids 返回 —— 服务端无状态，由批量驱动脚本续跑
//  - body.dedupe=true：全库去重一遍（同 URL 归并；同源同题（归一化标题）保留正文最完整一条）
//  - 诚实原则：summary 只在真的抓到正文时生成；明显垃圾旧摘要（含链接/HTML 残留）在抓不到正文时清空，
//    绝不用邻接噪声 snippet 伪造；region 只补空不覆盖；已有手工 tags 在新标签为空时保留
//  - helper 与 tick / fetch-now 同口径，回调内自持一份（Goja 并发安全 + 多拷贝一致性约定）
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/intel/enrich", (e) => {
  try {
    // ==== 共享纯函数镜像（唯一事实来源，scripts/intelShared.test.ts 强制 4 份逐字节一致） ====
    // ===INTEL-SHARED-BEGIN===
    // 共享纯函数区（2026-09-26 质量整改 Q1–Q4，见 docs/全局质量规范-测试与交付门槛.md）
    // 此前 REGION_WORDS/extractRegion 等在 tick / fetch-now / items 迁移 / enrich 四处各持一份拷贝，
    // 改一处漏三处是「多拷贝漂移」。现统一收敛到顶层一份：
    //  - Goja 单 VM 启动时顺序加载全部 pb_hooks，顶层 var 全局可见（zx_guard.pb.js 顶层常量同款先例）；
    //  - 以下函数全部只读入参、无可变共享态，请求间并发安全；
    //  - 命名带 __intel 前缀，避免与其他 hook 文件的全局名冲突。
    // ===========================================================================

    // 省份区域词表（零 AI）：全称 + 多字简称（单字简称误报率高，刻意排除）
    var __INTEL_REGION_WORDS = [
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
    var __intelRegionByWord = function (s) {
      var t = String(s || "")
      for (var i = 0; i < __INTEL_REGION_WORDS.length; i++) {
        if (t.indexOf(__INTEL_REGION_WORDS[i].w) >= 0) return __INTEL_REGION_WORDS[i].r
      }
      return ""
    }

    // 标题剥标签：内联高亮标签（政采网搜索结果会给关键词套 <font>）必须替换为空串。
    // 旧实现替换为空格，导致「青浦区中心 医院」这类关键词两侧插空格的标题污染并入库。
    var __intelTitleFromHtml = function (rawHtml) {
      return unescInt(String(rawHtml || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim()
    }
    // 实体解码（与各回调内 unesc 同口径；独立一份供顶层函数使用）
    var unescInt = function (s) {
      return String(s).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&ldquo;|&rdquo;/g, "").replace(/\s+/g, " ").trim()
    }

    // 区域抽取 v2（分层证据优先级，取代旧「标题+邻接窗口里第一个省份词」）：
    //  1) 采购人归属：条目块「采购人：××」值中的省份词（最强证据：采购人属地即项目属地）
    //  2) 递交地：「在××省政府采购网 / 在××市政府采购网」中的省份词
    //  3) 标题本体中的省份词（次强：标题主体是项目名；注意代理机构名也可能出现在标题里，
    //     所以排序在 1)/2) 之后）
    //  4) 条目自身块的面包屑「…公告 | 省份 | …」
    //  5) 兜底：条目自身块内第一个省份词（调用方必须保证传入的是「条目自身块」而非 ±800 邻接窗口，
    //     否则邻接条目的代理机构名会重演「青浦区→青海」错标）
    var __intelRegion = function (title, ownBlock, strict) {
      var t = String(title || "")
      var b = String(ownBlock || "")
      var mp = b.match(/采购人[：:]\s*([^，,。;；|\n]{2,30})/)
      if (mp) { var r1 = __intelRegionByWord(mp[1]); if (r1) return r1 }
      var mg = b.match(/在([^，,。;；|\n]{2,14}?(?:省|自治区)政府采购网)|在([^，,。;；|\n]{1,8}?市)政府采购网/)
      if (mg) { var r2 = __intelRegionByWord(mg[1] || mg[2] || ""); if (r2) return r2 }
      var r3 = __intelRegionByWord(t)
      if (r3) return r3
      // 4.5) 代理机构属地（条目自身块内为强证据）：块里可能有多个「代理机构：」（开头的是邻接噪声），
      // ccgp 列表行元数据「时间戳 | 采购人 | 代理机构」总在末尾 → 从最后一个往前找省份词
      var maAll = b.match(/代理机构[：:]\s*([^，,。;；|\n]{2,30})/g)
      if (maAll) {
        for (var ai = maAll.length - 1; ai >= 0; ai--) {
          var r45 = __intelRegionByWord(maAll[ai].replace(/^代理机构[：:]\s*/, ""))
          if (r45) return r45
        }
      }
      var mb = b.match(/[|｜]\s*([^|｜，,。;；\s]{2,8})\s*[|｜]/)
      if (mb) { var r4 = __intelRegionByWord(mb[1]); if (r4) return r4 }
      // strict 模式（存量重算专用）：弱证据兜底不参与——宁可保留旧值，绝不因邻接噪声改错
      if (strict) return ""
      return __intelRegionByWord(b)
    }

    var __intelValidDate = function (y, mo, d) {
      var yy = parseInt(y, 10), mm = parseInt(mo, 10), dd = parseInt(d, 10)
      if (!(yy >= 2020 && yy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return ""
      var mmS = mm < 10 ? "0" + mm : "" + mm
      var ddS = dd < 10 ? "0" + dd : "" + dd
      var iso = yy + "-" + mmS + "-" + ddS
      // 未来日期守卫（2026-10-20）：发布时间不可能是未来。原判据只把年份卡在 2020..2100，
      // 而 __intelPubAt 的最后一条优先级是在**全文**里扫日期（仅排除递交/截止/开标上下文），
      // 于是源页里混着的课程日期、政策路线图年份、版权行一旦被抽中就会入库成未来时间——
      // 实测 HIT专家网「培训班招生」页抽出 2027-04-29 / 2027-01-03。列表按 -published_at
      // 排序，未来日期会永远置顶。留 1 天容差吸收时区差（源多为 date-only，此处按 UTC 零点解释）。
      // 注意：本函数因此不再是纯函数（依赖当前时间）。既有 Q2 用例全部使用过去的日期，
      // 故不受影响；将来新增用例不要用固定未来日期，否则会随真实时间变红。
      if (iso > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) return ""
      return iso
    }

    // 发布时间抽取 v2（发布时间 ≠ 正文第一个日期：政采网公告正文第一个日期是投标截止时间，
    // 旧实现拿它当发布时间入库，导致列表按「发布时刻」排序实为按截止时间倒挂）。
    // 优先级：URL 内嵌日期（ccgp t20260925_x.htm / /202609/ 目录）> 「发布时间：」标签
    //   > 列表条目自带时间戳（2026.09.25 11:38:54）> 正文日期（排除递交/截止/开标上下文）> 空串由调用方兜底
    var __intelPubAt = function (url, ownBlock, body) {
      var u = String(url || "")
      var mu = u.match(/t(20\d{2})(\d{2})(\d{2})_\w*\.htm/i) || u.match(/\/(20\d{2})(\d{2})(\d{2})\//)
      if (mu) { var d0 = __intelValidDate(mu[1], mu[2], mu[3]); if (d0) return d0 }
      var b = String(ownBlock || "")
      var bd = String(body || "")
      var text = bd ? bd + "\n" + b : b
      var ml = text.match(/(?:发布时间|发布日期|公布时间|公告发布|发布日期日期)[：:]\s*(20\d{2})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})/)
      if (ml) { var d1 = __intelValidDate(ml[1], ml[2], ml[3]); if (d1) return d1 }
      var ms = b.match(/(20\d{2})\.(\d{1,2})\.(\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/)
      if (ms) { var d2 = __intelValidDate(ms[1], ms[2], ms[3]); if (d2) return d2 }
      var re = /(20\d{2})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})/g
      var m4
      while ((m4 = re.exec(text)) !== null) {
        var before = text.slice(Math.max(0, m4.index - 20), m4.index)
        // after 只看同句（在句读处截断）：下一句的「递交/截止」不能株连本句的发布日期
        var afterRaw = text.slice(m4.index, m4.index + 40)
        var cutAt = afterRaw.search(/[。；！？，]/)
        var after = cutAt >= 0 ? afterRaw.slice(0, cutAt) : afterRaw
        if (/递交|截止|开标|投标|报名|响应文件|资格预审|澄清|答疑|询问|质疑/.test(before + after)) continue
        var d3 = __intelValidDate(m4[1], m4[2], m4[3])
        if (d3) return d3
      }
      return ""
    }

    // 招标/中标结构化字段（零 AI，2026-11-02 起随抓取直接写入 structured）。
    // 只写明确命中的键；无命中返回 {}，调用方不落成空对象。字段口径与 /api/intel/extract-bid 一致。
    var __intelExtractBid = function (title, text) {
      var out = {}
      var full = String(title || "") + "\n" + String(text || "")
      var grab = function (resList) {
        for (var gi = 0; gi < resList.length; gi++) {
          var mm = full.match(resList[gi])
          if (mm && mm[1]) return String(mm[1]).replace(/\s+/g, " ").trim().slice(0, 160)
        }
        return ""
      }
      var ORG_TAIL = "医院|卫生院|保健院|卫健委|卫生健康委|公司|集团|大学|学院|中心|研究院|研究所|事务所|银行|学校|委员会|管委会|管理局|管理处|政府|局|厅|部|厂|站"
      // 采购人：正文显式标签最强；没有再取标题开头机构名（贪婪到机构尾词，避免只取到「北京大学」）
      var buyer = grab([
        /(?:采购人|招标人|招标单位|采购单位|采购人名称|招标人名称|项目建设单位)\s*[:：为]\s*(?:名称)?\s*([^\s，。；;:：、()（）]{2,40}(?:医院|卫生院|保健院|卫健委|卫生健康委|公司|集团|大学|学院|中心|研究院|研究所|事务所|银行|学校|委员会|管委会|管理局|管理处|政府|局|厅|部|厂|站))/,
        new RegExp("^([\\u4e00-\\u9fa5A-Za-z0-9（）()·]{2,45}(?:" + ORG_TAIL + "))"),
      ])
      if (buyer && buyer.length >= 4) out.buyer = buyer.replace(/^关于/, "").slice(0, 60)
      var budget = grab([
        /(?:预算金额|采购预算|最高限价|控制价|估算价|预算总价|项目预算|资金预算|概算|预算)\s*[:：为]?\s*(?:人民币)?\s*([\d,，.]+\s*(?:万元|亿元|元))/,
      ])
      if (budget) out.budget = budget.replace(/\s+/g, "")
      var deadline = grab([
        /(?:投标截止|递交截止|报名截止|获取[^\n]{0,8}?截止|开标时间|截止时间|截止日期|响应文件截止)\s*[:：为至]?\s*(20\d{2}[-/年.]\d{1,2}[-/月.]\d{1,2}\s*日?(?:\s*\d{1,2}[:：]\d{1,2}(?:[:：]\d{1,2})?\s*(?:时|分)?)?)/,
      ])
      if (deadline) out.deadline = deadline.replace(/\s+/g, "")
      var code = grab([
        /(?:招标编号|采购编号|项目编号|谈判编号|询价编号|比选编号|证券项目编号)\s*[:：为]?\s*([A-Za-z0-9][A-Za-z0-9\-_./·]{3,39})/,
      ])
      if (code) out.code = code
      var winner = grab([
        /(?:中标(?:人|单位|供应商|公司)|成交(?:供应商|人|单位)|第一中标(?:候选人|供应商))\s*[:：为]\s*([^\s，。；;:：、]{2,40}(?:公司|集团|医院|中心|研究院|事务所|大学|厂|行))/,
      ])
      if (winner) out.winner = winner
      var won = grab([
        /(?:中标金额|成交金额|中标价|成交价格|合同金额)\s*[:：为]?\s*(?:人民币)?\s*([\d,，.]+\s*(?:万元|亿元|元))/,
      ])
      if (won) out.won_amount = won.replace(/\s+/g, "")
      return out
    }

    // 标题历史污染清洗（存量数据）：抓取端旧实现把高亮标签剥成空格，标题里留下「医院」两侧空格。
    // 中文排版中汉字之间的空格几乎不可能是刻意的，汉字/中文标点之间的空格安全折叠；
    // 英文/数字之间的空格保留（"CT MRI"这类不吃掉）。
    var __intelCleanTitleSpacing = function (t) {
      return String(t || "").replace(/([\u4e00-\u9fa5）】」》、，。；：？！])\s+([\u4e00-\u9fa5（【「《])/g, "$1$2")
    }

    // 从一段正文文本里构造「去标题」片段（供摘要用）：允许标题在文本里被空白打断
    // （旧实现 replace(title," ") 因高亮空格污染永远匹配不上，导致摘要里残留半截标题）。
    var __intelTextWithoutTitle = function (text, title) {
      var t = String(text || "")
      var ttl = String(title || "")
      if (!ttl) return t
      var esc = ttl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      try {
        var fuzzy = esc.split("").join("\\s*")
        return t.replace(new RegExp(fuzzy), " ")
      } catch (eReg) {
        return t.split(ttl).join(" ")
      }
    }
    // ===INTEL-SHARED-END===

    var norm = function (s) { return String(s == null ? "" : s).trim() }
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(String(e.get("rhUserId") || ""))
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再回填存量情报" })
    var body = e.requestInfo().body || {}
    var dryRun = body.dry_run === true
    // region_mode：fill（默认，旧约定：region 只补空不覆盖）| recompute_crawl（2026-09-26 Q1/Q2 存量整改：
    // 对 added_by='crawl' 的条目用共享区新算法重算区域与发布时间、修复标题高亮空格污染；manual 条目永不触碰）
    var regionMode = body.region_mode === "recompute_crawl" ? "recompute_crawl" : "fill"
    var __jinaCache = {}
    var __UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "zh-CN,zh;q=0.9" }
    var decodeEnt = function (s) {
      return String(s).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&(ldquo|rdquo|mdash|ndash|middot|hellip|ensp|emsp);/g, " ").replace(/&#x([0-9a-fA-F]+);/g, function (m2, hh) { try { return String.fromCharCode(parseInt(hh, 16)) } catch (e) { return " " } }).replace(/&#(\d+);/g, function (m3, dd) { try { return String.fromCharCode(parseInt(dd, 10)) } catch (e) { return " " } })
    }
    var htmlToArticle = function (rawHtml) {
      if (!rawHtml) return ""
      var hh2 = String(rawHtml)
      var seg = hh2
      var mA = hh2.match(/<article[\s\S]*?<\/article>/i)
      if (mA) { seg = mA[0] }
      else {
        var mC = hh2.match(/<div[^>]+class="[^"]*(content|article|TRS_Editor|zoom|viewT|Article|xl_content|cont)[^"]*"[\s\S]*?<\/div>/i)
        if (mC) seg = mC[0]
      }
      seg = seg.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<(nav|header|footer|aside|form|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
      seg = seg.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n").replace(/<[^>]+>/g, " ")
      seg = decodeEnt(seg)
      var lines = seg.split(/\n+/)
      var keep = []
      for (var li = 0; li < lines.length; li++) {
        var s = lines[li].replace(/\s+/g, " ").trim()
        if (!s) continue
        if (/版权|All Rights|ICP|备案|返回|打印|分享|关注|扫码|二维码|上一篇|下一篇|相关阅读|网站地图|登录|注册|首页|导航|广告|免责声明|联系我们/.test(s)) continue
        keep.push(s)
      }
      return keep.join("\n").slice(0, 4000)
    }
    var fetchArticleBody = function (linkUrl) {
      // 政府 .gov.cn 走 r.jina.ai 代理（与 tick / fetch-now 同口径）：本回调一次处理多条 item_ids，
      // URL 缓存放外部变量，同一次回填中重复 URL 不会重复请求代理。
      var isGov = /\.gov\.cn/i.test(String(linkUrl || ""))
      if (isGov) {
        if (__jinaCache[linkUrl]) return __jinaCache[linkUrl]
        try {
          var jr = $http.send({ url: "https://r.jina.ai/" + linkUrl, method: "GET", headers: __UA, timeout: 10 })
          if (jr && jr.statusCode === 200 && typeof jr.raw === "string" && jr.raw.length > 240) {
            var md = String(jr.raw)
              .replace(/^Title:\s.*\n/m, "")
              .replace(/^URL Source:.*\n/m, "")
              .replace(/^Markdown Content:\s*\n/m, "")
              .replace(/\n{2,}/g, "\n")
              .slice(0, 4000)
            __jinaCache[linkUrl] = md
            return md
          }
        } catch (eJin2) { /* 代理失败回退直连 */ }
      }
      try {
        var rb = $http.send({ url: linkUrl, method: "GET", headers: __UA, timeout: 8 })
        if (!rb || rb.statusCode !== 200) return ""
        var raw = typeof rb.raw === "string" ? rb.raw.slice(0, 400000) : ""
        return htmlToArticle(raw)
      } catch (e2) { return "" }
    }
    var __TAG_BANK = ["电子病历", "智慧医院", "互联网医院", "医疗信息化", "医院信息化", "区域卫生", "医共体", "医联体", "公共卫生", "疾控", "DRG", "DIP", "医保", "远程医疗", "医学影像", "检验", "临床", "护理", "手术机器人", "人工智能", "大模型", "医疗AI", "数字化", "信息化", "信创", "国产化", "数据中心", "云平台", "大数据", "5G", "智慧病房", "分级诊疗", "公立医院", "药品追溯", "药店", "处方", "集采", "中标", "招标", "采购", "政策", "规划", "标准", "指南", "解决方案"]
    var extractTags = function (text) {
      var t = String(text || "")
      var out = []
      for (var i = 0; i < __TAG_BANK.length; i++) { var w = __TAG_BANK[i]; if (t.indexOf(w) >= 0 && out.indexOf(w) < 0) { out.push(w); if (out.length >= 6) break } }
      return out
    }
    var makeSummary = function (text, ttl) {
        // B36 修复（2026-11-05）：内联 scrubIntel 逻辑避免 JSON/列表残片污染摘要
      var t = String(text || "").replace(/\s+/g, " ")
      if (ttl) t = t.split(String(ttl)).join(" ")
      t = t.replace(/\s+/g, " ").trim()
      if (t.length < 8) return ""
      var sents = []
      var cur = ""
      for (var i = 0; i < t.length; i++) { var ch = t.charAt(i); cur += ch; if ("。！？；!?;".indexOf(ch) >= 0) { sents.push(cur); cur = "" } }
      if (cur) sents.push(cur)
      var buf = ""
      for (var k = 0; k < sents.length; k++) {
        var sp = sents[k].trim()
        if (sp.length < 6) continue
        if (buf && buf.length + sp.length > 150) break
        buf += sp
        if (buf.length >= 90) break
      }
      if (!buf) buf = t.slice(0, 140)
      return buf.slice(0, 300)
    }
    // 纯文本 snippet 去噪：按行剔除导航/页脚/残留 HTML/裸链接行（存量老数据是整块 HTML 拍平的）
    var noiseLineRe = /版权所有|All Rights|ICP ?备|备案号|友情链接|隐私政策|使用条款|网站地图|查看更多|查看详情|点击更|解决方案\/"|首页\s|导航|扫码|二维码|关注|分享|打印|上一篇|下一篇|广告|免责声明|联系我们|登录|注册/i
    var cleanSnippetText = function (sn) {
      var raw = decodeEnt(String(sn || ""))
      var lines = raw.split(/\n+/)
      var keep = []
      for (var li = 0; li < lines.length; li++) {
        var s = lines[li].replace(/\s+/g, " ").trim()
        if (!s) continue
        if (/<a\s|href=|<div|<span|<p\b|<li|<\/|src=|style=/i.test(s)) continue
        if (/^https?:\/\/\S+$/.test(s)) continue
        if (noiseLineRe.test(s)) continue
        keep.push(s)
      }
      return keep.join(" ").replace(/\s+/g, " ").trim().slice(0, 2400)
    }

    // ---- 去重模式：同 URL 归并 + 同源同（归一化）标题归并，保留正文最完整一条 ----
    if (body.dedupe === true) {
      var normT = function (t) { return String(t || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "").slice(0, 60) }
      var scoreOf = function (r) {
        return String(r.get("content_snippet") || "").length + (String(r.get("summary") || "") ? 100 : 0) + (extractTags(String(r.get("title") || "")).length ? 10 : 0)
      }
      var drows = []
      try { drows = $app.findRecordsByFilter("intel_items", "added_by!='manual'", "-created", 3000, 0) } catch (errD0) { drows = [] }
      var groupsUrl = {}
      var groupsTitle = {}
      for (var dr = 0; dr < drows.length; dr++) {
        var durl = String(drows[dr].get("url") || "")
        if (durl) {
          if (!groupsUrl[durl]) groupsUrl[durl] = []
          groupsUrl[durl].push(drows[dr])
        } else {
          var keyT = String(drows[dr].get("source_id") || "") + "|" + normT(drows[dr].get("title"))
          if (!groupsTitle[keyT]) groupsTitle[keyT] = []
          groupsTitle[keyT].push(drows[dr])
        }
      }
      var dropSet = {}
      var dropGroup = function (grp) {
        if (!grp || grp.length < 2) return
        var bestIdx = 0, bestScore = -1
        for (var gi = 0; gi < grp.length; gi++) {
          if (dropSet[grp[gi].id]) continue
          var gsc = scoreOf(grp[gi])
          if (gsc > bestScore) { bestScore = gsc; bestIdx = gi }
        }
        for (var gj = 0; gj < grp.length; gj++) {
          if (gj !== bestIdx && !dropSet[grp[gj].id]) dropSet[grp[gj].id] = grp[gj]
        }
      }
      for (var ku in groupsUrl) dropGroup(groupsUrl[ku])
      for (var kt in groupsTitle) dropGroup(groupsTitle[kt])
      var dedupDeleted = 0, dedupSample = []
      for (var kd in dropSet) {
        if (dedupSample.length < 8) dedupSample.push(String(dropSet[kd].get("title") || "").slice(0, 50))
        if (dryRun) { dedupDeleted++; continue }
        try { $app.delete(dropSet[kd]); dedupDeleted++ } catch (errD1) { /* 单条失败不中断 */ }
      }
      $app.logger().info("intel enrich dedupe", "user", userId, "scanned", drows.length, "deleted", dedupDeleted, "dry_run", dryRun)
      return e.json(200, { ok: true, mode: "dedupe", dry_run: dryRun, scanned: drows.length, deleted: dedupDeleted, samples: dedupSample })
    }

    // ---- item_ids 回填模式 ----
    var ids = body.item_ids
    if (typeof ids === "string") { try { ids = JSON.parse(ids) } catch (errP) { ids = [] } }
    if (!ids || typeof ids.length !== "number" || ids.length === 0) {
      return e.json(200, { ok: false, code: "bad_request", message: "item_ids 不能为空（或先调 dedupe 模式）" })
    }
    if (ids.length > 40) ids = ids.slice(0, 40)
    var budgetMs = parseInt(body.budget_ms, 10)
    if (isNaN(budgetMs) || budgetMs < 5000) budgetMs = 95000
    if (budgetMs > 110000) budgetMs = 110000
    var tStart = new Date().getTime()
    var doneIds = [], pendingIds = [], rep = []
    var changedCount = 0, refetched = 0, clearedSum = 0
    for (var ii = 0; ii < ids.length; ii++) {
      var pid = norm(ids[ii])
      if (!pid) continue
      if (new Date().getTime() - tStart > budgetMs) { pendingIds.push(pid); continue }
      var rec = null
      try { rec = $app.findRecordById("intel_items", pid) } catch (errF) { rec = null }
      if (!rec) { doneIds.push(pid); continue }
      var title = String(rec.get("title") || "")
      var url = String(rec.get("url") || "")
      var snipOld = String(rec.get("content_snippet") || "")
      var sumOld = String(rec.get("summary") || "")
      var tagsOld = []
      try { var rawT = rec.getString("tags"); if (rawT) { var pt = JSON.parse(rawT); if (pt && typeof pt.length === "number") tagsOld = pt } } catch (errT) { tagsOld = [] }
      var regOld = String(rec.get("region") || "")
      var artBody = /^https?:\/\//i.test(url) ? fetchArticleBody(url) : ""
      var hasBody = !!(artBody && artBody.length > 120)
      if (hasBody) refetched++
      var snipNew = hasBody ? artBody.slice(0, 2400) : cleanSnippetText(snipOld)
      var sumNew = sumOld
      var ch = []
      if (hasBody) {
        var made = makeSummary(artBody, title)
        if (made) sumNew = made
      } else if (sumOld && (/<a\s|href=|https?:\/\//i.test(sumOld) || noiseLineRe.test(sumOld))) {
        sumNew = ""
        clearedSum++
      }
      var tagsNew = tagsOld
      var tg = extractTags((title + " " + (hasBody ? artBody : snipNew)).slice(0, 3000))
      if (tg.length) tagsNew = tg
      // isCrawl / recompute 模式：存量错标整改只动机器写入（added_by='crawl'），manual 条目永不触碰
      var isCrawl = String(rec.get("added_by") || "") === "crawl"
      var doRecompute = regionMode === "recompute_crawl" && isCrawl
      var titleCur = title
      if (doRecompute) {
        // 标题高亮空格污染修复（Q3）：汉字/中文标点间的空格安全折叠，英文/数字间空格保留
        var titleFix = __intelCleanTitleSpacing(title)
        if (titleFix && titleFix !== title) { rec.set("title", titleFix); ch.push("title"); titleCur = titleFix }
      }
      var regNew = regOld
      if (doRecompute) {
        // 区域重算（Q1）：分层证据优先级；新算法拿不出值时保留旧值，绝不倒退为空
        var regCalc = __intelRegion(titleCur, snipNew, true) // strict：存量只认强证据，弱证据兜底不改旧值
        if (regCalc) regNew = regCalc
      } else if (!regNew) {
        regNew = __intelRegion(title, hasBody ? artBody : snipNew)
      }
      // 发布时间重算（Q2）：URL 内嵌日期 > 发布时间标签 > 条目时间戳 > 正文日期（排除截止上下文）
      var pubOld2 = String(rec.get("published_at") || "")
      if (doRecompute) {
        var pubCalc = __intelPubAt(url, snipNew, hasBody ? artBody : "")
        // 未来日期清理（2026-10-20）：旧算法没有未来守卫，源页里的课程日期/政策路线图年份会被抽成
        // 发布日并入库（实测 HIT专家网「培训班招生」页：2027-04-29、2027-01-03）。守卫补上后
        // __intelPubAt 对未来日期返回空串，而下面那行只在非空时才改值——所以存量坏值不会自动清掉，
        // 必须显式处理，否则界面上那个 2027 永远修不好。拿不到可信发布日就退回该条的入库时间
        // （created），绝不保留未来值。只在 recompute 模式生效（该模式只动机器写入的 crawl 条目）。
        var pubToday = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
        if (pubOld2 && pubOld2.slice(0, 10) > pubToday) {
          var pubFallback = String(rec.get("created") || "").slice(0, 10) || new Date().toISOString().slice(0, 10)
          rec.set("published_at", pubCalc && pubCalc <= pubToday ? pubCalc : pubFallback)
          ch.push("published_at_future_fixed")
        } else if (pubCalc && pubCalc !== pubOld2) {
          rec.set("published_at", pubCalc); ch.push("published_at")
        }
      }
      if (snipNew && snipNew !== snipOld) { rec.set("content_snippet", snipNew); ch.push("snippet") }
      if (sumNew !== sumOld) { rec.set("summary", sumNew); ch.push("summary") }
      if (tagsNew.join("|") !== tagsOld.join("|")) { rec.set("tags", tagsNew); ch.push("tags") }
      if (regNew !== regOld) { rec.set("region", regNew); ch.push("region") }
      if (ch.length && !dryRun) {
        try { $app.save(rec); changedCount++ } catch (errS) { ch = ["save_failed"] }
      }
      doneIds.push(pid)
      if (rep.length < 40) rep.push({ id: pid, body: hasBody ? 1 : 0, ch: ch.join(",") })
    }
    $app.logger().info("intel enrich run", "user", userId, "done", doneIds.length, "changed", changedCount, "refetched", refetched, "cleared", clearedSum, "dry_run", dryRun)
    return e.json(200, {
      ok: true, mode: "enrich", dry_run: dryRun,
      changed: changedCount, refetched: refetched, cleared_summary: clearedSum,
      done_ids: doneIds, pending_ids: pendingIds, report: rep,
      message: "回填完成 " + doneIds.length + " 条（更新 " + changedCount + "，重抓到正文 " + refetched + "，清垃圾摘要 " + clearedSum + "）"
    })
  } catch (ex) {
    $app.logger().error("intel enrich failed", "err", String(ex))
    return e.json(500, { error: "intel_error", message: "存量回填失败，请稍后重试", fingerprint: "intel-enrich-" + Math.floor(Math.random() * 1000000000).toString(36) })
  }
})

// ---------------------------------------------------------------------------
// POST /api/intel/extract-bid — 招标/中标类存量结构化抽取（零 AI，纯规则，保守口径）
//  - 从 标题+正文片段 抽 buyer/budget/deadline/code/winner/won_amount 写入 structured（json 字段）
//  - body.item_ids 限定处理范围；缺省 = 全部非手录、item_type='bid' 或标题含采购关键词的条目
//  - body.budget_ms 时间预算（默认 95000，上限 110000），未完成在 pending_ids 返回，驱动脚本续跑
//  - 保守原则：只写正则明确命中的键；无任何命中不写空对象；手动录入条目不动；已有 structured 仅补空缺键（body.overwrite=true 时允许刷新机抽值）
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/intel/extract-bid", (e) => {
  try {
    var norm = function (s) { return String(s == null ? "" : s).trim() }
    var h = (e.requestInfo() || {}).headers || {}
    var userId = norm(String(e.get("rhUserId") || ""))
    if (!userId) return e.json(401, { ok: false, code: "LOGIN_REQUIRED", message: "请先登录后再执行结构化抽取" })
    var body = e.requestInfo().body || {}
    var dryRun = body.dry_run === true
    var overwrite = body.overwrite === true
    var bidTitleRe = /招标|中标|成交|采购|竞标|磋商|询价|遴选|流标|废标|开标/
    var grab = function (txt, resList) {
      for (var gi = 0; gi < resList.length; gi++) {
        var mm = txt.match(resList[gi])
        if (mm && mm[1]) return String(mm[1]).replace(/\s+/g, " ").trim().slice(0, 120)
      }
      return ""
    }
    var ORG_TAIL = "医院|卫生院|保健院|卫健委|卫生健康委|公司|集团|大学|学院|中心|研究院|研究所|事务所|银行|学校|委员会|管委会|管理局|管理处|政府|局|厅|部|厂|站"
    var extractBid = function (title, text) {
      var out = {}
      var full = String(title || "") + "\n" + String(text || "")
      // 采购方：优先标题开头的机构名（贪婪取到最长机构尾词，如「北京大学第六医院」而非「北京大学」）；
      // 标题无机构时，才退到正文里「采购人/招标人…」带标签取值（正文可能是列表页邻接噪声，风险更高）
      var buyer = grab(full, [
        new RegExp("^([\\u4e00-\\u9fa5A-Za-z0-9（）()·]{2,30}(?:" + ORG_TAIL + "))"),
        new RegExp("(?:采购人|招标人|招标单位|采购单位|采购人名称|招标人名称|项目建设单位)\\s*[:：为]\\s*(?:名称)?\\s*([^\\s，。；;:：、()（）]{2,28}(?:" + ORG_TAIL + "))"),
      ])
      if (buyer && buyer.length >= 4) out.buyer = buyer.slice(0, 60)
      var budget = grab(full, [
        /(?:预算金额|采购预算|最高限价|控制价|估算价|预算总价|项目预算|资金预算|概算)\s*[:：为]?\s*(?:人民币)?\s*([\d,，.]+\s*(?:万元|亿元|元))/,
      ])
      if (budget) out.budget = budget.replace(/\s+/g, "")
      var deadline = grab(full, [
        /(?:投标截止|递交截止|报名截止|获取[^\n]{0,8}?截止|开标时间|截止时间|截止日期|响应文件截止)\s*[:：为至]?\s*(20\d{2}[-/年.]\d{1,2}[-/月.]\d{1,2}\s*日?(?:\s*\d{1,2}[:：]\d{1,2}(?:[:：]\d{1,2})?\s*(?:时|分)?)?)/,
      ])
      if (deadline) out.deadline = deadline.replace(/\s+/g, "")
      var code = grab(full, [
        /(?:招标编号|采购编号|项目编号|谈判编号|询价编号|比选编号|证券项目编号)\s*[:：为]?\s*([A-Za-z0-9][A-Za-z0-9\-_./·]{3,39})/,
      ])
      if (code) out.code = code
      var winner = grab(full, [
        /(?:中标(?:人|单位|供应商|公司)|成交(?:供应商|人|单位)|第一中标(?:候选人|供应商))\s*[:：为]\s*([^\s，。；;:：、]{2,40}(?:公司|集团|医院|中心|研究院|事务所|大学|厂|行))/,
      ])
      if (winner) out.winner = winner
      var won = grab(full, [
        /(?:中标金额|成交金额|中标价|成交价格|合同金额)\s*[:：为]?\s*(?:人民币)?\s*([\d,，.]+\s*(?:万元|亿元|元))/,
      ])
      if (won) out.won_amount = won.replace(/\s+/g, "")
      return out
    }

    // ---- 收集目标条目 ----
    var ids = body.item_ids
    if (typeof ids === "string") { try { ids = JSON.parse(ids) } catch (errP) { ids = [] } }
    var targets = []
    if (ids && typeof ids.length === "number" && ids.length > 0) {
      if (ids.length > 60) ids = ids.slice(0, 60)
      for (var qi = 0; qi < ids.length; qi++) {
        var qid = norm(ids[qi]); if (!qid) continue
        var qr = null
        try { qr = $app.findRecordById("intel_items", qid) } catch (errQ) { qr = null }
        if (qr) targets.push(qr)
      }
    } else {
      var brows = []
      try { brows = $app.findRecordsByFilter("intel_items", "added_by!='manual'", "-created", 2000, 0) } catch (errB) { brows = [] }
      for (var bi = 0; bi < brows.length; bi++) {
        var bt = String(brows[bi].get("title") || "")
        if (String(brows[bi].get("item_type") || "") === "bid" || bidTitleRe.test(bt)) targets.push(brows[bi])
      }
    }

    var budgetMs = parseInt(body.budget_ms, 10)
    if (isNaN(budgetMs) || budgetMs < 5000) budgetMs = 95000
    if (budgetMs > 110000) budgetMs = 110000
    var tStart = new Date().getTime()
    var doneIds = [], pendingIds = [], rep = []
    var updated = 0, hitField = { buyer: 0, budget: 0, deadline: 0, code: 0, winner: 0, won_amount: 0 }
    for (var ii = 0; ii < targets.length; ii++) {
      var rec = targets[ii]
      if (new Date().getTime() - tStart > budgetMs) {
        // 剩余条目交回驱动脚本：预算内不再开新条（单条最坏 = 一次正则扫描，直接续跑即可）
        for (var pj = ii; pj < targets.length; pj++) pendingIds.push(targets[pj].id)
        break
      }
      var title = String(rec.get("title") || "")
      var text = String(rec.get("content_snippet") || "") + "\n" + String(rec.get("summary") || "")
      var fresh = extractBid(title, text)
      var freshKeys = 0
      for (var fk in fresh) freshKeys++
      if (!freshKeys) { doneIds.push(rec.id); continue }
      // 合并已有值：只补空缺键，绝不覆盖已抽取/人工修正过的字段
      var merged = {}
      var oldRaw = ""
      try { oldRaw = rec.getString("structured") } catch (errG) { oldRaw = "" }
      if (oldRaw) { try { var oldObj = JSON.parse(oldRaw); if (oldObj && typeof oldObj === "object") merged = oldObj } catch (errP2) { merged = {} } }
      var addedKeys = []
      for (var k2 in fresh) {
        if (!merged[k2] || (overwrite && String(merged[k2]) !== String(fresh[k2]))) {
          if (String(merged[k2] || "") !== String(fresh[k2])) { merged[k2] = fresh[k2]; addedKeys.push(k2); hitField[k2]++ }
        }
      }
      if (addedKeys.length) {
        if (!dryRun) {
          try { rec.set("structured", merged); $app.save(rec); updated++ } catch (errS) { addedKeys = ["save_failed"] }
        } else { updated++ }
      }
      doneIds.push(rec.id)
      if (rep.length < 40 && addedKeys.length) rep.push({ id: rec.id, add: addedKeys.join(",") })
    }
    $app.logger().info("intel extract-bid run", "user", userId, "done", doneIds.length, "updated", updated, "dry_run", dryRun)
    return e.json(200, {
      ok: true, dry_run: dryRun,
      scanned: targets.length, updated: updated,
      hits: hitField,
      done_ids: doneIds, pending_ids: pendingIds, report: rep,
      message: "结构化抽取完成：" + targets.length + " 条扫描，" + updated + " 条写入（采购方 " + hitField.buyer + " / 预算 " + hitField.budget + " / 截止 " + hitField.deadline + " / 编号 " + hitField.code + " / 中标人 " + hitField.winner + " / 中标额 " + hitField.won_amount + "）"
    })
  } catch (ex) {
    $app.logger().error("intel extract-bid failed", "err", String(ex))
    return e.json(500, { error: "intel_error", message: "结构化抽取失败，请稍后重试", fingerprint: "intel-extract-" + Math.floor(Math.random() * 1000000000).toString(36) })
  }
})

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET /api/intel/source-stats — 源贡献度统计（2026-09-28 数据质量增量）
// 每启用源返回：近 7 天新增条数 / last_status / last_error 摘要，
// 供源管理面板识别「贡献源 vs 僵尸源」（抓取成功但 7 天 0 新增 = 内容不匹配需调关键词）。
routerAdd("GET", "/api/intel/source-stats", function (e) {
  try {
    var uid = String(e.get("rhUserId") || "")
    if (!uid) return e.json(401, { error: "login_required", message: "请先登录后再访问该数据" })
    var sources = $app.findRecordsByFilter("intel_sources", "enabled=true", "source_name", 200, 0)
    var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
    var stats = []
    for (var i = 0; i < sources.length; i++) {
      var src = sources[i]
      var week = 0
      try {
        var rows = $app.findRecordsByFilter("intel_items", "source_id={:sid} && created >= {:since}", "-created", 500, 0, { sid: src.id, since: weekAgo })
        week = rows.length
      } catch (eCnt) { week = -1 }
      stats.push({
        source_id: src.id,
        source_name: String(src.get("source_name") || ""),
        last_status: String(src.get("last_status") || ""),
        last_error: String(src.get("last_error") || "").slice(0, 80),
        week_added: week,
        total_fetched: Number(src.get("fetched_count") || 0),
      })
    }
    var zombies = stats.filter(function (s2) { return s2.last_status === "ok" && s2.week_added === 0 })
    return e.json(200, { ok: true, stats: stats, zombie_count: zombies.length, zombies: zombies.map(function (s3) { return s3.source_name }) })
  } catch (err) {
    var msg = String(err && err.message || err)
    try { $app.logger().error("intel source-stats: " + msg) } catch (_) {}
    return e.json(500, { error: "stats_failed", message: msg, fingerprint: msg.substring(0, 80) })
  }
})

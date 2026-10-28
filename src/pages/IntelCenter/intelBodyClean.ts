// ---------------------------------------------------------------------------
// intelBodyClean — 手动录入情报的标题/正文清洗（纯函数，零依赖）
//
// Round 26 (intel-data-01)：POST /api/intel_items 服务端对手动入库不做任何清洗，
// 粘贴进来的网页文本会带着 <script>/HTML 标签/实体编码/JSON 残留/导航版权行原样入库存档。
// 本模块在客户端持久化前镜像 pb_hooks/intel_center.pb.js 自动抓取链的清洗口径
// （该文件是红线不可动，且自动链已落地，这里只补手动录入这一缺口）：
//   剥 script/style/noscript/svg/HTML 注释 → <br>/块闭合转换行 → 去残留标签 → 解码常用实体
//   → 逐行剔除 JSON/JS 残留行、导航版权噪声行、纯日期行 → 归一空白并按 max 截断
// ---------------------------------------------------------------------------

/** 噪声行：导航/版权/页脚等页面骨架残留（镜像服务端 noiseRe 并扩充粘贴常见项） */
const NOISE_LINE_RE = /版权|All Rights|ICP 备|备案号|友情链接|隐私政策|使用条款|网站地图|扫一扫|扫码|关注公众号|联系我们|返回顶部|首页\s*[>|»]\s*|上一篇|下一篇|责任编辑|文章来源/i

/** 纯日期/编号行（镜像服务端 dateOnlyRe） */
const DATE_ONLY_RE = /^[\d\s\-/年月日.:：()[\]，,周星期]+$/

/** JSON / JS 代码残留行 */
const JSON_LINE_RE = /^[[{]|^["']?[\w$]+\s*[:=]\s*["'{[]|^[})\];,]+\s*$|^\s*(var|let|const|function|window\.|document\.|try|catch|if|else)\b|;\s*$/

/** 单行清洗：去 HTML 标签/实体/压缩空白（标题等单行字段用） */
export function cleanIntelLine(raw: string): string {
  return decodeEntities(
    stripBlocks(String(raw ?? "")).replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim()
}

export interface IntelBodyCleanResult {
  text: string
  /** 清洗后与原文不同（有内容被剥离/剔除） */
  changed: boolean
  /** 被剔除的行数（0 = 无整行剔除） */
  removedLines: number
}

/** 正文清洗：按 max 截断，默认 2000（对齐提交 body 的 slice 上限） */
export function cleanIntelBody(raw: string, max = 2000): IntelBodyCleanResult {
  const input = String(raw ?? "")
  let body = stripBlocks(input)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|td|section|article)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
  body = decodeEntities(body)
  let removedLines = 0
  const kept = body
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => {
      if (!line) return true // 空行只做分段，不计入剔除
      const drop = JSON_LINE_RE.test(line) || NOISE_LINE_RE.test(line) || DATE_ONLY_RE.test(line)
      if (drop) removedLines++
      return !drop
    })
  let text = kept.join("\n").replace(/\n{2,}/g, "\n").trim()
  if (text.length > max) text = `${text.slice(0, max)}…`
  return { text, changed: text !== input.trim(), removedLines }
}

/** URL / 分享链接行（weibo/qq 等社交分享参数、伪协议） */
const URL_LINE_RE = /https?:\/\/|\/\/|\.php|\.aspx?\b|\.(jpg|jpeg|png|gif|webp|bmp)\b|share\.php|weibo\.com|javascript:|void\(|\burl\s*[:=]|\bhttp\b/i
/** 含 CSS 选择器/声明残留的行 */
const CSS_LINE_RE = /[{}]/

/**
 * R53/F10：门户站务导航词——抓到门户/列表页首页时整片混入摘要的页面骨架词。
 * 单个词可能出现在正文里（如「政务服务改革」），所以按「行内切块命中率」判行，不逐词杀：
 * 无空格连写的正常摘要 = 1 块，永不误杀；导航残片按空格切开、导航词占比高即整行丢。
 */
const NAV_TOKEN_RE = /首页|网站支持|IPv6|长者助手|适老化|网站找错|网站纠错|无障碍|机构职能|政务动态|政务公开|政务服务|互动交流|要闻速递|工作动态|政声传递|各地动态|友情链接|网站地图|站内搜索|设为首页|加入收藏|上一页|下一页|网站群|版权所有|统计分析|数据发布|专题专栏|扫码关注/i
/** 分页/索引行：孤立数字串、「首页 上一页 1 2 3 下一页」类 */
const PAGER_LINE_RE = /^[\d\s]{1,24}$|^(?:首页|上一页|下一页|末页|尾页)[\d\s上一页下一页末页]*$/

/**
 * 展示层深度清洗（首页摘要 / 卡片副文本）：在 cleanIntelBody 的「成对标签」之外，
 * 额外对付抓取入库时被从中间截断的半截 HTML（`<img ... class=` 无右括号、
 * `.jpg" border="0"...>` 无左括号、`ef="//service.weibo..."` 丢头）与内联 CSS/JS 残片。
 * 仅供只读渲染使用；入库仍走 cleanIntelBody（两者互不影响，不动既有测试锁定的行为）。
 */
export function displayizeIntel(raw: string, max = 120): string {
  let s = decodeEntities(stripBlocks(String(raw ?? "")))
  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|td|section|article)>/gi, "\n")
    .replace(/<[^>]*>/g, " ") // 成对标签
    .replace(/<[^>]*$/g, " ") // 行尾悬挂未闭合标签（截断所致）
    // 属性对残留 key="..." / key='...' / key=裸值（无左尖括号的半截标签尾巴）
    .replace(/[\w:.-]+\s*=\s*"[^"]*"/g, " ")
    .replace(/[\w:.-]+\s*=\s*'[^']*'/g, " ")
    .replace(/[\w:.-]+\s*=\s*[^\s"'<>]+/g, " ")
    // R54/F21：孤儿残片——key 丢等号的 `in_more"`、value 丢 key 的 `="box"`（CHIMA/华为页实测形态）
    .replace(/="[^"]*"/g, " ")
    .replace(/\b[\w:.-]{2,}"/g, " ")
    .replace(/[<>]/g, " ") // 角度括号一律视为噪声
    .replace(/[\w/.-]*\.(?:jpg|jpeg|png|gif|webp|bmp)["']?/gi, " ") // 图片路径残片（含尾随半截引号）
    // 注：不删全/半角引号——中文引号 “” 是合法正文；标签残留中的 ASCII 引号已被上面「属性对」规则成对吃掉
  const kept: string[] = []
  for (const line of s.split(/\n+/)) {
    const t = line.replace(/\s+/g, " ").trim()
    if (!t) continue
    if (CSS_LINE_RE.test(t) || URL_LINE_RE.test(t)) continue
    if (JSON_LINE_RE.test(t) || NOISE_LINE_RE.test(t) || DATE_ONLY_RE.test(t)) continue
    if (PAGER_LINE_RE.test(t)) continue
    // R53/F10：行内按空白/分隔切块，导航词命中 ≥2 块、或占比 ≥0.5（≥3 块时）→ 判导航残片整行丢
    const blocks = t.split(/[\s|·、，,;；]+/).filter(Boolean)
    const navHits = blocks.filter((b) => NAV_TOKEN_RE.test(b)).length
    if (navHits >= 2 || (blocks.length >= 3 && navHits / blocks.length >= 0.5)) continue
    // R53/F10：门户变体——每个导航词独占一行（「机构职能」「政务动态」…），整行皆短导航词即丢；
    // 长度 ≤12 限定了只杀裸词行，正常句子哪怕含导航词也不会命中
    if (t.length <= 12 && blocks.length > 0 && blocks.every((b) => NAV_TOKEN_RE.test(b))) continue
    kept.push(t)
  }
  let text = kept.join(" ").replace(/\s+/g, " ").trim()
  if (text.length > max) text = `${text.slice(0, max)}…`
  return text
}

// ---------------------------------------------------------------------------
// R64：摘要（summary）展示层清洗——剥离「站点名前缀 + JSON 元数据块」
//
// 实测形态（源「健康报·卫健官方媒体」，2026-10-25 库内 11 条命中 9 条）：
//   －健康报网——健康门户 {"id":"514749","toptitle":"","title":" ","subtitle":"——论学习贯彻…",
//   "crtime":"2026-10-22 09:49:07","condition":"来源： 健康报 ","thumb": "","topic": "0"} □本报评论员…
// 即「站点名 + 页面 JSON 元数据 + 真正文」三段粘在一条 summary 里。
//
// 为什么必须单独处理（而不是直接丢给 displayizeIntel）：
//   displayizeIntel 的 CSS_LINE_RE 判据是「整行含花括号即丢」，而这段 JSON 与正文在同一行，
//   于是真正文会被一起丢掉 —— 首页（useHome.ts:206）对这批条目实际显示为「有摘要但空白」。
// 本函数先把元数据块剥掉，再交给 displayizeIntel，两页口径才一致。
// ---------------------------------------------------------------------------

/** 平衡的扁平 JSON 元数据块（至少含一个 "key": 才算，避免吃掉正文里的孤立花括号） */
const JSON_META_BLOB_RE = /\{[^{}]*"[^"]+"\s*:[^{}]*\}/g

/** 被截断到字符串末尾的半截 JSON（抓取时按长度截断所致，无右花括号） */
const JSON_META_TAIL_RE = /\{[^{}]*"[^"]+"\s*:[^{}]*$/

/**
 * 站点名前缀：仅当它**紧跟** JSON 元数据块时才算噪声。
 * 锚在 `{` 上，所以「健康报网 我院召开…」这类正常正文不会被误剥。
 */
const SITE_NAME_PREFIX_RE = /^[^\n{]{0,30}?(?:网|门户|官网|首页|日报|晚报)\s*(?=\{)/

/** 剥离站点名前缀与 JSON 元数据块（纯函数，不改入参） */
export function stripIntelMetaBlobs(raw: string): string {
  let s = String(raw ?? "")
  s = s.replace(SITE_NAME_PREFIX_RE, " ")
  // 连续多段元数据：逐段剥，最多 5 轮（病态输入兜底，正常 1 轮即稳定）
  for (let i = 0; i < 5; i++) {
    const next = s.replace(JSON_META_BLOB_RE, " ")
    if (next === s) break
    s = next
  }
  s = s.replace(JSON_META_TAIL_RE, " ")
  return s
}

/**
 * 摘要展示层清洗：剥元数据块 → displayizeIntel 深度清洗 → 按 max 截断。
 * 情报中心卡片/详情面板与首页动态卡共用同一口径。
 */
export function cleanIntelSummary(raw: string, max = 200): string {
  return displayizeIntel(stripIntelMetaBlobs(raw), max)
}

// ---------------------------------------------------------------------------
// R65：content_snippet（内容片段）展示层清洗——剥「更多…」导航词 + 列表页残片
//
// 实测形态（2026-10-28，库内 728 条 / 672 条有 content_snippet）：
//   A 形态 188 条：`更多... 更多... 2026-10-26 近日，由清华大学…`（导航词串 + 日期 + 真正文）
//   B 形态 342 条：`甘肃省…十项措施 2026-10-27 2026-10-26 江苏省印发《…》 2026-10-23`
//                  —— 整段是**同站其他文章的标题 + 日期**，与这条情报毫无关系。
//
// 为什么必须单独处理（而不是直接丢给 displayizeIntel）：
//   ① displayizeIntel 的行级判据认的是「导航词/URL/花括号」，认不出「更多…」这种
//      页面控件文案，也认不出「标题 + 日期」拼成的列表；
//   ② 首页动态卡（useHome.ts）与情报详情面板（IntelDetailPanel.tsx）都把这个字段
//      当摘要显示 —— 用户在标题下读到的其实是别人的标题列表，属于误导性内容。
//
// 处置原则：宁缺勿错。能确认是正文的段落留下，剩下的宁可返回空串
// （调用方已有「暂无摘要，进入情报中心用 AI 摘要打标」的兜底文案）。
// ---------------------------------------------------------------------------

/** 页面控件文案：「更多...」「多...」「…」等孤立 token（含被截断成「多...」的形态） */
const MORE_TOKEN_RE = /(?:^|\s)(?:更?多\s*)?(?:\.{2,}|…+)(?=\s|$)/g

/** 行首的裸日期（列表页每条前面的时间戳），只剥开头，正文里的日期不动 */
const LEADING_DATE_RE = /^(?:\d{4}-\d{2}-\d{2}|\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}-\d{2})[\s|·、,，;；]+/

/** 列表分隔用的日期戳（前需行首或空白、后需空白，避免把「0628-264110104017」这类编号当日期；
 *  前导空白由本正则吃掉、尾部用前瞻，连续两个日期才都能命中） */
const LIST_DATE_SPLIT_RE = /(?:^|\s)(?:\d{4}-\d{2}-\d{2}|\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}-\d{2})(?=\s|$)/g

/** 判定「像正文」的最短长度：标题一般 ≤40 字，正文段落远长于此 */
const LIST_MIN_PROSE_CHARS = 40

/** 剥「更多…」导航 token（最多 6 轮，正常 1 轮即稳定；病态输入兜底） */
export function stripMoreTokens(raw: string): string {
  let s = String(raw ?? "")
  for (let i = 0; i < 6; i++) {
    const next = s.replace(MORE_TOKEN_RE, " ").replace(/\s+/g, " ").trim()
    if (next === s) break
    s = next
  }
  return s
}

/** 中文 2/3-gram 集合（去标点空白，用于标题亲和度） */
function charGrams(s: string, n: number): Set<string> {
  const t = String(s ?? "").replace(/[\s\p{P}\p{S}]/gu, "")
  const out = new Set<string>()
  for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n))
  return out
}

function gramOverlap(a: Set<string>, b: Set<string>): number {
  let hit = 0
  for (const g of a) if (b.has(g)) hit++
  return hit
}

/**
 * 片段是否「属于这条情报」：用标题 3-gram 命中 ≥1 或 2-gram 命中 ≥2 判定。
 * 实测（R65 取证）：属于本文的片段 3-gram 命中 42~66，属于邻篇文章的命中 0 —— 分离度足够。
 * 标题为空时不做该判定（信息不足，不误杀）。
 */
function belongsToTitle(segment: string, title: string): boolean {
  const t = String(title ?? "").trim()
  if (!t) return true
  const seg3 = charGrams(segment, 3)
  const title3 = charGrams(t, 3)
  if (gramOverlap(title3, seg3) >= 1) return true
  return gramOverlap(charGrams(t, 2), charGrams(segment, 2)) >= 2
}

/**
 * 内容片段展示层清洗：深度清洗 → 剥「更多…」→ 剥行首裸日期 → 列表残片只留最长正文段。
 * 返回空串表示「这条片段里没有属于本条的正文」，调用方应显示兜底文案而不是空段落。
 */
export function cleanIntelSnippet(raw: string, opts: { title?: string; max?: number } = {}): string {
  const max = opts.max ?? 120
  const title = opts.title ?? ""
  let s = stripMoreTokens(displayizeIntel(raw, 600))
  // 行首裸日期（可能连续多枚）逐枚剥
  for (let i = 0; i < 4; i++) {
    const next = s.replace(LEADING_DATE_RE, "").trim()
    if (next === s) break
    s = next
  }
  if (!s) return ""
  const dateCount = (s.match(LIST_DATE_SPLIT_RE) ?? []).length
  if (dateCount >= 2) {
    // 列表残片：按日期戳切段，只保留最长的一段，且它必须「像正文」并「属于本条」
    const parts = s
      .split(LIST_DATE_SPLIT_RE)
      .map((x) => x.replace(/^[\s|·、,，;；:：]+|[\s|·、,，;；]+$/g, "").trim())
      .filter(Boolean)
    const best = parts.sort((a, b) => b.length - a.length)[0] ?? ""
    if (best.length < LIST_MIN_PROSE_CHARS) return ""
    if (!/[，。]/.test(best)) return "" // 标题型（无句读）不是正文
    if (!belongsToTitle(best, title)) return ""
    s = best
  }
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/**
 * R88/F23：判断一条情报条目是否"明显垃圾"（仅用于列表排序沉底，不改数据不隐藏）。
 * 保守：只命中确定性极高的残片/导航/空壳条目，宁漏不误杀。
 */
export function looksJunkIntel(title: string, snippet: string): boolean {
  const t = String(title ?? "").trim()
  // 空标题 / 短于 4 字符(去标点后)
  if (t.replace(/[\p{P}\p{S}\s]/gu, "").length < 4) return true
  // URL 路径 / 静态资源残片
  if (/^(?:https?:\/\/|[a-z]:\\|[./]|[a-z]{2,10}[/.])/i.test(t) && /\.(?:html?|jpe?g|png|gif|css|js|json|xml|pdf|zip|rar)\b/i.test(t)) return true
  // 纯导航词聚合（标题每个词都命中 NAV_TOKEN_RE）
  const words = t.split(/[\s|·、,，]+/).filter(Boolean)
  if (words.length >= 2 && words.every((w) => NAV_TOKEN_RE.test(w))) return true
  // snippet 主体是日期列表（同一条目 snippet 有 3 个以上 "20XX-XX-XX" 且标题也出现在 snippet 中→列表页抓取残片）
  const snipStr = String(snippet ?? "")
  const dateCnt = (snipStr.match(/20\d{2}-\d{2}-\d{2}/g) ?? []).length
  if (dateCnt >= 3 && snipStr.includes(t.slice(0, 10))) return true
  return false
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/** 剥 script/style/noscript/svg/注释块（镜像服务端 crawlOne 的整块剥离） */
function stripBlocks(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript\s*>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
}

/** 常用 HTML 实体解码（粘贴文本高频面，不引入 DOM 依赖） */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => {
      const n = Number(code)
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""
    })
}

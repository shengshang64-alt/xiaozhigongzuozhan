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

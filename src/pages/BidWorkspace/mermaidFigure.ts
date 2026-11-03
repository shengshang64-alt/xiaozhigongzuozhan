// ---------------------------------------------------------------------------
// T16（2026-09-29）Mermaid 配图支路（易标 illustration 管线的 mermaid 分支移植）：
//  - 文本模型输出 mermaid 源码 → 本地净化（剥围栏/白名单图型/长度上限）→ mermaid.parse 试渲染校验
//    → 失败把渲染错误回传模型修复（易标 MERMAID_REPAIR_ATTEMPTS 机制，本项目收敛为 1 次修复）；
//  - 浏览器端 mermaid.render 出 SVG → 复用 bidFiles 既有 SVG→canvas→PNG 链路进 Word
//    （易标走 Electron 离屏 CDP 截图，web 无此运行时，canvas 链路是等价替代）；
//  - mermaid 按需动态 import（~1MB 级依赖，不进首屏 chunk）。
// 纯模块：不 import bidTypes（供 bidTypes/solutionTypes 侧反向使用，避免环）。
// ---------------------------------------------------------------------------

export const MERMAID_MAX_CODE_CHARS = 4000

/** 允许的图型起点（对齐易标口径：只放行确定性能渲染的常规图型，克制优先；gantt=项目实施甘特图） */
const MERMAID_ALLOWED_START_RE =
  /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|mindmap|timeline|pie|gantt)\b/

/** 净化模型输出的 mermaid 源码：剥代码围栏、白名单起点、长度上限；不合格返回空串 */
export function sanitizeMermaidCode(raw: unknown): string {
  let s = String(raw ?? "").trim()
  s = s
    .replace(/^```[a-zA-Z]*\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim()
  if (!s || s.length > MERMAID_MAX_CODE_CHARS) return ""
  if (!MERMAID_ALLOWED_START_RE.test(s)) return ""
  return s
}

/** 惰性加载 mermaid ESM（vite 自动拆 chunk；渲染配置全局只初始化一次） */
type MermaidApi = (typeof import("mermaid"))["default"]
let mermaidPromise: Promise<MermaidApi> | null = null
async function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      const api = m.default
      // 2026-10-07：v12 neo look 的标签走 <foreignObject>，安全级别/look/htmlLabels 配置均关不掉；
      // 含 fo 的 SVG 进 <img>→canvas 会被跨源污染，Word 导出零配图（用户实报缺陷）。
      // 解法：渲染后 stripForeignObject 把 fo 就地替换为 <text>（见下），此处保持 strict 安全级。
      // themeVariables：标书配图观感——浅蓝主色、圆角、增大字号，甘特图分区着色。
      api.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: {
          primaryColor: "#E8F1FC",
          primaryBorderColor: "#2F6FBF",
          primaryTextColor: "#1A3A5C",
          lineColor: "#5B87B5",
          fontSize: "14px",
          fontFamily: "Microsoft YaHei, PingFang SC, sans-serif",
          ganttSectionBkgColor: "#EAF2FB",
          ganttAltSectionBkgColor: "#F7FAFE",
          ganttTaskBkgColor: "#7FB0E5",
          ganttTaskBorderColor: "#2F6FBF",
          ganttTodayLineColor: "#E06C5A",
        },
        flowchart: { curve: "basis", padding: 10 },
      })
      return api
    })
  }
  return mermaidPromise
}

/** mermaid.parse 试渲染校验：返回错误消息（null = 通过）。错误消息回传模型做修复提示。 */
export async function validateMermaidCode(code: string): Promise<string | null> {
  try {
    const mermaid = await loadMermaid()
    await mermaid.parse(code)
    return null
  } catch (e) {
    return e instanceof Error ? e.message.slice(0, 300) : "mermaid 语法解析失败"
  }
}

let renderSeq = 0

/**
 * 渲染结果缓存（T18+：Word 导出每张 mermaid 图现渲一次太慢——同 code 直接命中缓存；
 * 键为净化后的源码本身，上限 40 条 LRU 粗淘汰。mermaidCacheStats 供测试/诊断。）
 */
const mermaidSvgCache = new Map<string, string>()
const MERMAID_CACHE_MAX = 40

export function mermaidCacheStats(): { size: number } {
  return { size: mermaidSvgCache.size }
}

/**
 * mermaid 源码 → SVG 标记（编辑器内联展示与导出 PNG 共用）。
 * 渲染失败返回空串（调用方降级）；输出 SVG 补齐显式 width/height（mermaid 默认只给 max-width 样式，
 * canvas 转换需要确定尺寸——优先用 viewBox，缺省回退 640 宽）。
 */
export async function renderMermaidToSvg(code: string): Promise<string> {
  const src = sanitizeMermaidCode(code)
  if (!src) return ""
  const cached = mermaidSvgCache.get(src)
  if (cached) {
    // LRU 触碰：删了重插，让常用图留在缓存
    mermaidSvgCache.delete(src)
    mermaidSvgCache.set(src, cached)
    return cached
  }
  try {
    const mermaid = await loadMermaid()
    const id = `yibiao-mermaid-${Date.now()}-${renderSeq++}`
    const { svg } = await mermaid.render(id, src)
    if (!svg) return ""
    const normalized = stripForeignObject(normalizeMermaidSvgSize(svg))
    if (mermaidSvgCache.size >= MERMAID_CACHE_MAX) {
      const oldest = mermaidSvgCache.keys().next().value
      if (oldest !== undefined) mermaidSvgCache.delete(oldest)
    }
    mermaidSvgCache.set(src, normalized)
    return normalized
  } catch {
    return ""
  }
}

/** 补齐 SVG 根节点的 width/height 属性（mermaid 输出常只有 style:max-width 与 viewBox） */
function normalizeMermaidSvgSize(svg: string): string {
  const viewBoxMatch = svg.match(/viewBox="0\s+0\s+([\d.]+)\s+([\d.]+)"/)
  const hasSize = /<svg[^>]*\swidth="/.test(svg)
  if (hasSize || !viewBoxMatch) return svg
  const w = Math.max(320, Math.min(960, Math.round(Number(viewBoxMatch[1]) || 640)))
  const h = Math.max(160, Math.round(Number(viewBoxMatch[2]) || 320))
  return svg.replace(/<svg/, `<svg width="${w}" height="${h}"`)
}

/**
 * 2026-10-07：把 SVG 里的 <foreignObject>（mermaid v12 neo look 的 HTML 标签）就地替换为等位的
 * <text>。foreignObject 是 Word 导出零配图的根因——含 fo 的 SVG 装进 <img> 再画 canvas 会被
 * Chromium 跨源污染（SecurityError: tainted），figureToPng 全量降级【图】文字；v12 的
 * look/htmlLabels 配置关不掉 fo，只能在渲染后剥除。标签取 fo 内 textContent 按行拆 tspan，
 * 居中放在 fo 的包围盒中心；样式从节点 <g> 继承（fill 由 mermaid 主题给出）。
 */
export function stripForeignObject(svg: string): string {
  if (!svg.includes("foreignObject")) return svg
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml")
    if (doc.documentElement.nodeName === "parsererror") return svg
    const fos = [...doc.querySelectorAll("foreignObject")]
    for (const fo of fos) {
      const text = (fo.textContent ?? "").replace(/\s+/g, " ").trim()
      const parent = fo.parentNode
      if (!parent) continue
      const x = Number(fo.getAttribute("x") ?? 0)
      const y = Number(fo.getAttribute("y") ?? 0)
      const w = Number(fo.getAttribute("width") ?? 0)
      const h = Number(fo.getAttribute("height") ?? 0)
      const NS = "http://www.w3.org/2000/svg"
      const textEl = doc.createElementNS(NS, "text")
      textEl.setAttribute("x", String(x + w / 2))
      textEl.setAttribute("y", String(y + h / 2))
      textEl.setAttribute("text-anchor", "middle")
      textEl.setAttribute("dominant-baseline", "middle")
      const rawLines = text.split(/<br\s*\/?>|\n/i).filter(Boolean)
      const lines = (fo.innerHTML.includes("<br") ? fo.innerHTML.split(/<br\s*\/?>/i) : rawLines.length ? [text] : [""])
        .map((l) => l.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
        .filter(Boolean)
      const lineH = 18
      const startDy = -((Math.max(1, lines.length) - 1) * lineH) / 2
      lines.forEach((line, li) => {
        const tspan = doc.createElementNS(NS, "tspan")
        tspan.setAttribute("x", String(x + w / 2))
        tspan.setAttribute("dy", li === 0 ? String(startDy) : String(lineH))
        tspan.textContent = line
        textEl.appendChild(tspan)
      })
      parent.replaceChild(textEl, fo)
    }
    return new XMLSerializer().serializeToString(doc.documentElement)
  } catch {
    return svg
  }
}

/**
 * mermaid 配图修复循环（易标 prepareRenderableMermaid 语义）：
 * validate → 失败则把错误回传 regenerate 拿修复稿 → 再 validate；返回最终可用源码（修复仍失败返回空串，调用方弃图）。
 * regenerate 收到修复提示词构建产物，由调用方接 LLM——本模块不依赖 hook。
 */
export async function repairMermaidCode(input: {
  code: string
  regenerate: (badCode: string, error: string) => Promise<string>
}): Promise<string> {
  const code = sanitizeMermaidCode(input.code)
  if (!code) return ""
  let error = await validateMermaidCode(code)
  if (!error) return code
  try {
    const fixed = sanitizeMermaidCode(await input.regenerate(code, error))
    if (!fixed) return ""
    error = await validateMermaidCode(fixed)
    if (!error) return fixed
  } catch {
    /* 修复调用失败：弃用原图（返回空串），不阻塞正文生成 */
  }
  return ""
}

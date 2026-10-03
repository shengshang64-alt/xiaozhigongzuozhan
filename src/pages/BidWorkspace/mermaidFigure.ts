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

/** 允许的图型起点（对齐易标口径：只放行确定性能渲染的常规图型，克制优先） */
const MERMAID_ALLOWED_START_RE =
  /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|mindmap|timeline|pie)\b/

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
      api.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" })
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
    const normalized = normalizeMermaidSvgSize(svg)
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
 * mermaid 配图修复循环（易标 prepareRenderableMermaid 语义）：
 * validate → 失败则把错误回传 regenerate 拿修复稿 → 再 validate；返回最终可用源码（修复仍失败返回空串，调用方弃图）。
 * regenerate 收到修复提示词构建产物，由调用方接 LLM——本模块不依赖 hook。
 */
export async function repairMermaidCode(input: {
  code: string
  regenerate: (badCode: string, error: string) => Promise<string>
}): Promise<string> {
  let code = sanitizeMermaidCode(input.code)
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

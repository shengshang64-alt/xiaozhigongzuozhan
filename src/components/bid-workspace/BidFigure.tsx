import { useEffect, useMemo, useState } from "react"
import type { FigureSpec } from "@/pages/SolutionStudio/solutionTypes"
import { renderMermaidToSvg } from "@/pages/BidWorkspace/mermaidFigure"

// ---------------------------------------------------------------------------
// 章节配图：把 LLM 输出的结构化 figures 数据绘制为内联 SVG
// 颜色全部取自已烧进 :root 的设计 token（CSS 变量），导出 Word 时在运行时解析成具体色值
// ---------------------------------------------------------------------------

export type FigurePalette = {
  primary: string
  foreground: string
  mutedForeground: string
  card: string
  border: string
  muted: string
}

/**
 * token 值归一化：:root 里的 shadcn token 是 HSL 三元组（如「204 100% 50%」），
 * 直接塞进 SVG fill/stroke 或 canvas fillStyle 是非法色值（渲染默认黑）。
 * 这里把三元组转成合法 hsl()；已是 hex / rgb() / hsl() / 颜色名则原样返回。
 */
function normalizeTokenColor(v: string, fb: string): string {
  const t = (v ?? "").trim()
  if (!t) return fb
  const m = t.match(/^(-?[\d.]+)\s+([\d.]+%)\s+([\d.]+%)(?:\s*\/\s*[\d.]+%?)?$/)
  if (m) return `hsl(${m[1]}, ${m[2]}, ${m[3]})`
  return t
}

/** 运行时读取 :root token 值（SVG 独立成图时无法继承页面 CSS，导出 PNG 前用它替换变量） */
export function tokenPalette(): FigurePalette {
  const read = (n: string, fb: string) => {
    if (typeof window === "undefined") return fb
    const v = window.getComputedStyle(document.documentElement).getPropertyValue(n).trim()
    return normalizeTokenColor(v, fb)
  }
  return {
    primary: read("--primary", "black"),
    foreground: read("--foreground", "black"),
    mutedForeground: read("--muted-foreground", "black"),
    card: read("--card", "white"),
    border: read("--border", "black"),
    muted: read("--muted", "white"),
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function cut(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

const W = 640

function architectureSvg(spec: Extract<FigureSpec, { type: "architecture" }>, p: FigurePalette): { body: string; height: number } {
  const layers = spec.layers.slice(0, 6)
  const layerH = 56
  const gap = 10
  const pad = 8
  const height = pad * 2 + layers.length * layerH + Math.max(0, layers.length - 1) * gap
  let body = ""
  layers.forEach((layer, i) => {
    const y = pad + i * (layerH + gap)
    body += `<rect x="${pad}" y="${y}" width="${W - pad * 2}" height="${layerH}" rx="8" fill="${p.card}" stroke="${p.border}" stroke-width="1"/>`
    body += `<text x="${pad + 12}" y="${y + layerH / 2 + 4}" font-size="12" font-weight="600" fill="${p.foreground}">${esc(cut(layer.name, 8))}</text>`
    const mods = layer.modules.slice(0, 6)
    const x0 = pad + 110
    const avail = W - x0 - pad - 8
    const n = Math.max(1, mods.length)
    const bw = Math.min(140, (avail - (n - 1) * 8) / n)
    const by = y + (layerH - 32) / 2
    mods.forEach((m, j) => {
      const bx = x0 + j * (bw + 8)
      body += `<rect x="${bx}" y="${by}" width="${bw}" height="32" rx="6" fill="${p.primary}" fill-opacity="0.12" stroke="${p.primary}" stroke-opacity="0.45" stroke-width="1"/>`
      body += `<text x="${bx + bw / 2}" y="${by + 20}" font-size="11" text-anchor="middle" fill="${p.primary}">${esc(cut(m, 10))}</text>`
    })
  })
  return { body, height }
}

function flowSvg(spec: Extract<FigureSpec, { type: "flow" }>, p: FigurePalette): { body: string; height: number } {
  const steps = spec.steps.slice(0, 8)
  const stepH = 40
  const gap = 24
  const pad = 8
  const boxW = 240
  const bx = 60
  const branchRows = spec.branches?.length ? 1 : 0
  const height = pad * 2 + steps.length * stepH + (steps.length - 1) * gap + branchRows * 34
  let body = ""
  steps.forEach((s, i) => {
    const y = pad + i * (stepH + gap)
    body += `<rect x="${bx}" y="${y}" width="${boxW}" height="${stepH}" rx="8" fill="${p.primary}" fill-opacity="0.12" stroke="${p.primary}" stroke-opacity="0.5" stroke-width="1"/>`
    body += `<text x="${bx + boxW / 2}" y="${y + stepH / 2 + 4}" font-size="12" font-weight="600" text-anchor="middle" fill="${p.primary}">${esc(cut(s.name, 16))}</text>`
    if (s.desc) {
      body += `<text x="${bx + boxW + 16}" y="${y + stepH / 2 + 4}" font-size="10" fill="${p.mutedForeground}">${esc(cut(s.desc, 26))}</text>`
    }
    if (i < steps.length - 1) {
      const ax = bx + boxW / 2
      const ay = y + stepH
      body += `<line x1="${ax}" y1="${ay + 2}" x2="${ax}" y2="${ay + gap - 8}" stroke="${p.border}" stroke-width="2"/>`
      body += `<polygon points="${ax - 5},${ay + gap - 8} ${ax + 5},${ay + gap - 8} ${ax},${ay + gap - 1}" fill="${p.primary}"/>`
    }
  })
  if (branchRows) {
    const yb = pad + steps.length * stepH + (steps.length - 1) * gap + 4
    body += `<rect x="${pad}" y="${yb}" width="${W - pad * 2}" height="26" rx="13" fill="none" stroke="${p.border}" stroke-width="1" stroke-dasharray="4 3"/>`
    body += `<text x="${pad + 14}" y="${yb + 17}" font-size="10" fill="${p.mutedForeground}">分支：${esc(cut((spec.branches ?? []).join(" / "), 60))}</text>`
  }
  return { body, height }
}

function demoSvg(spec: Extract<FigureSpec, { type: "demo" }>, p: FigurePalette): { body: string; height: number } {
  // 2026-10 配图需求轮：写实系统界面示意——窗口标题栏 + 左侧菜单 + 页头 + 指标卡 + 数据表骨架，
  // 语义内容（菜单项/模块名）取自 LLM 输出，数据区用中性骨架条（不编造业务数值）
  const side = (spec.sidebar ?? []).slice(0, 8)
  const main = (spec.main ?? []).slice(0, 10)
  const pad = 8
  const titleH = 30
  const sideW = 150
  const mx = pad + sideW + 12
  const mw = W - mx - pad
  const pageTitle = main[0]?.block ?? ""
  const cards = main.slice(1, 5)
  const tableRows = main.slice(5, 10)
  const cardH = 52
  const rowH = 24
  const tableHeadH = 26
  const mainContentH =
    30 /* 页头 */ + (cards.length ? cardH + 10 : 0) + (tableRows.length || cards.length ? tableHeadH + Math.max(tableRows.length, 4) * rowH + 8 : 40)
  const contentH = Math.max(mainContentH, side.length * 30 + 12, 120)
  const height = titleH + contentH + pad
  let body = ""
  // 外框 + 标题栏（窗口圆点 + 居中标题）
  body += `<rect x="0" y="0" width="${W}" height="${height}" rx="10" fill="${p.card}" stroke="${p.border}" stroke-width="1"/>`
  body += `<rect x="1" y="1" width="${W - 2}" height="${titleH}" rx="9" fill="${p.muted}"/>`
  body += `<rect x="1" y="${titleH - 9}" width="${W - 2}" height="9" fill="${p.muted}"/>`
  body += `<circle cx="16" cy="${titleH / 2 + 1}" r="4" fill="#f87171"/><circle cx="30" cy="${titleH / 2 + 1}" r="4" fill="#fbbf24"/><circle cx="44" cy="${titleH / 2 + 1}" r="4" fill="#34d399"/>`
  body += `<text x="${W / 2}" y="${titleH / 2 + 4}" font-size="11" font-weight="600" text-anchor="middle" fill="${p.foreground}">${esc(cut(pageTitle || spec.title, 28))}</text>`
  // 左侧菜单
  body += `<rect x="${pad}" y="${titleH + pad}" width="${sideW}" height="${contentH - pad * 2}" rx="6" fill="${p.muted}" fill-opacity="0.55"/>`
  side.forEach((s, i) => {
    const y = titleH + pad + 10 + i * 30
    if (i === 0) {
      body += `<rect x="${pad + 6}" y="${y - 4}" width="${sideW - 12}" height="24" rx="5" fill="${p.primary}" fill-opacity="0.14"/>`
    }
    body += `<circle cx="${pad + 18}" cy="${y + 8}" r="2.5" fill="${i === 0 ? p.primary : p.border}"/>`
    body += `<text x="${pad + 28}" y="${y + 12}" font-size="11" fill="${i === 0 ? p.primary : p.mutedForeground}" font-weight="${i === 0 ? 600 : 400}">${esc(cut(s, 11))}</text>`
  })
  // 页头（模块名 + 操作按钮占位）
  body += `<text x="${mx}" y="${titleH + pad + 20}" font-size="13" font-weight="700" fill="${p.foreground}">${esc(cut(pageTitle, 16))}</text>`
  body += `<rect x="${W - pad - 64}" y="${titleH + pad + 6}" width="60" height="20" rx="5" fill="${p.primary}" fill-opacity="0.85"/>`
  body += `<rect x="${W - pad - 56}" y="${titleH + pad + 13}" width="44" height="6" rx="3" fill="${p.card}" fill-opacity="0.9"/>`
  // 指标卡行（模块名做卡标签 + 骨架数值条）
  const top = titleH + pad + 30
  cards.forEach((m, i) => {
    const cw = (mw - 3 * 8) / 4
    const x = mx + i * (cw + 8)
    body += `<rect x="${x}" y="${top}" width="${cw}" height="${cardH}" rx="6" fill="${p.card}" stroke="${p.border}" stroke-width="1"/>`
    body += `<text x="${x + 8}" y="${top + 16}" font-size="9" fill="${p.mutedForeground}">${esc(cut(m.block, 7))}</text>`
    body += `<rect x="${x + 8}" y="${top + 26}" width="${cw - 16}" height="9" rx="4" fill="${p.primary}" fill-opacity="0.5"/>`
    body += `<rect x="${x + 8}" y="${top + 40}" width="${Math.round((cw - 16) * 0.55)}" height="5" rx="2.5" fill="${p.border}" fill-opacity="0.7"/>`
  })
  // 数据表（表头列名用剩余模块名，数据行用中性骨架条）
  const tableTop = top + (cards.length ? cardH + 10 : 0)
  const cols = tableRows.length ? tableRows.map((m) => m.block) : ["业务模块", "处理事项", "状态"]
  const colNames = cols.length === 1 ? [...cols, "状态", "操作"] : cols.length === 2 ? [...cols, "状态"] : cols
  const shown = colNames.slice(0, 4)
  const colW = mw / shown.length
  body += `<rect x="${mx}" y="${tableTop}" width="${mw}" height="${tableHeadH}" rx="5" fill="${p.muted}" fill-opacity="0.8"/>`
  shown.forEach((c, j) => {
    body += `<text x="${mx + j * colW + 8}" y="${tableTop + 17}" font-size="10" font-weight="600" fill="${p.foreground}">${esc(cut(c, Math.floor(colW / 7)))}</text>`
  })
  const dataRows = Math.max(tableRows.length, 4)
  for (let r = 0; r < dataRows; r++) {
    const y = tableTop + tableHeadH + 4 + r * rowH
    shown.forEach((_, j) => {
      const wRatio = 0.45 + (((r * 7 + j * 13) % 4) * 0.12)
      const bw = Math.max(18, Math.round((colW - 16) * Math.min(wRatio, 0.9)))
      body += `<rect x="${mx + j * colW + 8}" y="${y + 5}" width="${bw}" height="8" rx="4" fill="${j === 0 ? p.primary : p.border}" fill-opacity="${j === 0 ? 0.35 : 0.55}"/>`
    })
    body += `<line x1="${mx}" y1="${y + rowH - 4}" x2="${mx + mw}" y2="${y + rowH - 4}" stroke="${p.border}" stroke-width="0.5" stroke-opacity="0.5"/>`
  }
  return { body, height }
}

/** 生成配图 SVG 标记（内联渲染与导出 PNG 共用同一份绘制逻辑）；mermaid 型不走此处（异步渲染，见 MermaidFigureBody） */
export function buildFigureSvg(spec: FigureSpec, p: FigurePalette): string {
  if (spec.type === "mermaid") {
    // 同步路径兜底：mermaid 型没有静态 SVG（导出走 figureToPng 的异步分支；内联渲染见 MermaidFigureBody）
    return ""
  }
  if (spec.type === "image") {
    // 同步路径兜底：image 型是位图非 SVG（内联见 ImageFigureBody，导出走 figureToPng 的 image 分支）
    return ""
  }
  const drawn =
    spec.type === "architecture" ? architectureSvg(spec, p) : spec.type === "flow" ? flowSvg(spec, p) : demoSvg(spec, p)
  const typeLabel = spec.type === "architecture" ? "架构图" : spec.type === "flow" ? "流程图" : "界面示意"
  const height = drawn.height + 24
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" font-family="sans-serif" role="img" aria-label="${esc(spec.title)}">`,
    `<rect x="0" y="0" width="${W}" height="${height}" fill="${p.card}"/>`,
    `<text x="8" y="15" font-size="11" fill="${p.mutedForeground}">${esc(typeLabel)} · ${esc(cut(spec.title, 40))}</text>`,
    `<g transform="translate(0,20)">${drawn.body}</g>`,
    `</svg>`,
  ].join("")
}

/** T17：AI 位图内联渲染体（<img> 加载，失败显示占位提示） */
function ImageFigureBody({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="flex h-32 items-center justify-center bg-background text-xs text-muted-foreground">
        AI 配图加载失败（「{title}」），可在章节内重试生成
      </div>
    )
  }
  return (
    <div className="bg-background p-2">
      <img
        src={url}
        alt={title}
        loading="lazy"
        className="mx-auto max-w-full rounded-md"
        onError={() => setFailed(true)}
      />
    </div>
  )
}

/** T16：mermaid 型内联渲染体（异步 mermaid.render → SVG；渲染失败显示占位提示，不抛错） */
function MermaidFigureBody({ code, title }: { code: string; title: string }) {
  const [svg, setSvg] = useState("")
  useEffect(() => {
    let alive = true
    setSvg("")
    renderMermaidToSvg(code).then((markup) => {
      if (alive) setSvg(markup)
    })
    return () => {
      alive = false
    }
  }, [code])
  if (!svg) {
    return (
      <div className="flex h-32 items-center justify-center bg-background text-xs text-muted-foreground">
        关系图渲染中…（「{title}」）
      </div>
    )
  }
  return <div className="overflow-x-auto bg-background p-2" dangerouslySetInnerHTML={{ __html: svg }} />
}

/** mermaid 图型的展示标签：gantt 源码识别为甘特图，其余关系图（模块内私有，避免 fast-refresh 导出限制） */
function mermaidFigureLabel(spec: Extract<FigureSpec, { type: "mermaid" }>): string {
  return spec.code.trim().startsWith("gantt") ? "甘特图" : "关系图"
}

/** 章节内配图卡片：标题 + 内联 SVG / mermaid / AI 位图 */
export function BidFigure({ spec }: { spec: FigureSpec }) {
  const markup = useMemo(() => (spec.type === "mermaid" || spec.type === "image" ? "" : buildFigureSvg(spec, tokenPalette())), [spec])
  const typeLabel =
    spec.type === "architecture"
      ? "架构图"
      : spec.type === "flow"
        ? "流程图"
        : spec.type === "mermaid"
          ? mermaidFigureLabel(spec)
          : spec.type === "image"
            ? "AI 配图"
            : "界面示意"
  return (
    <figure className="overflow-hidden rounded-lg border border-border bg-card shadow-md">
      <figcaption className="flex min-h-10 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="truncate text-xs font-semibold text-foreground">{spec.title}</span>
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{typeLabel}</span>
      </figcaption>
      {spec.type === "mermaid" ? (
        <MermaidFigureBody code={spec.code} title={spec.title} />
      ) : spec.type === "image" ? (
        <ImageFigureBody url={spec.url} title={spec.title} />
      ) : (
        <div className="bg-background p-2" dangerouslySetInnerHTML={{ __html: markup }} />
      )}
    </figure>
  )
}

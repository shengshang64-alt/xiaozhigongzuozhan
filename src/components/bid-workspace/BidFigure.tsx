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
  const side = (spec.sidebar ?? []).slice(0, 8)
  const main = (spec.main ?? []).slice(0, 6)
  const pad = 8
  const topH = 26
  const blockH = 44
  const gap = 8
  const sideW = 150
  const contentH = Math.max(main.length * (blockH + gap), side.length * 24, 60) + pad
  const height = topH + contentH + pad
  let body = ""
  body += `<rect x="0" y="0" width="${W}" height="${height}" rx="10" fill="${p.card}" stroke="${p.border}" stroke-width="1"/>`
  body += `<rect x="1" y="1" width="${W - 2}" height="${topH}" rx="9" fill="${p.muted}"/>`
  body += `<rect x="1" y="${topH - 9}" width="${W - 2}" height="9" fill="${p.muted}"/>`
  body += `<circle cx="18" cy="${topH / 2 + 1}" r="4" fill="${p.primary}"/>`
  body += `<circle cx="32" cy="${topH / 2 + 1}" r="4" fill="${p.border}"/>`
  body += `<circle cx="46" cy="${topH / 2 + 1}" r="4" fill="${p.border}"/>`
  body += `<rect x="${pad}" y="${topH + pad}" width="${sideW}" height="${contentH - pad}" rx="6" fill="${p.muted}" fill-opacity="0.7"/>`
  side.forEach((s, i) => {
    body += `<text x="${pad + 12}" y="${topH + pad + 18 + i * 24}" font-size="11" fill="${i === 0 ? p.primary : p.mutedForeground}" font-weight="${i === 0 ? 600 : 400}">${esc(cut(s, 12))}</text>`
  })
  const mx = pad + sideW + 12
  const mw = W - mx - pad
  main.forEach((m, i) => {
    const y = topH + pad + i * (blockH + gap)
    body += `<rect x="${mx}" y="${y}" width="${mw}" height="${blockH}" rx="6" fill="${p.primary}" fill-opacity="0.1" stroke="${p.primary}" stroke-opacity="0.4" stroke-width="1"/>`
    body += `<text x="${mx + 12}" y="${y + (m.desc ? 18 : 26)}" font-size="11" font-weight="600" fill="${p.primary}">${esc(cut(m.block, 20))}</text>`
    if (m.desc) body += `<text x="${mx + 12}" y="${y + 33}" font-size="10" fill="${p.mutedForeground}">${esc(cut(m.desc, 40))}</text>`
  })
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

/** 章节内配图卡片：标题 + 内联 SVG / mermaid / AI 位图 */
export function BidFigure({ spec }: { spec: FigureSpec }) {
  const markup = useMemo(() => (spec.type === "mermaid" || spec.type === "image" ? "" : buildFigureSvg(spec, tokenPalette())), [spec])
  const typeLabel =
    spec.type === "architecture"
      ? "架构图"
      : spec.type === "flow"
        ? "流程图"
        : spec.type === "mermaid"
          ? "关系图"
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

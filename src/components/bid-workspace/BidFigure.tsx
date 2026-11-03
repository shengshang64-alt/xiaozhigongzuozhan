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

// ---------------------------------------------------------------------------
// 架构图分层配色（2026-10-30）：语义色 + 关键词归色，对齐行业范文版式
// （docs/ppt-refs a19_00/a26_07：左侧彩色层标签 + 层间箭头 + 右侧横切竖条）。
// 用 rgb 三元组以便生成深浅模式自适应的透明底。
// ---------------------------------------------------------------------------
const ARCH_COLORS: { hex: string; rgb: string }[] = [
  { hex: "#2563eb", rgb: "37,99,235" }, // 蓝   = 业务/应用
  { hex: "#d97706", rgb: "217,119,6" }, // 琥珀 = 渠道/入口/接入
  { hex: "#7c3aed", rgb: "124,58,237" }, // 紫  = 平台/能力/中间件
  { hex: "#059669", rgb: "5,150,105" }, // 绿   = 数据/存储
  { hex: "#dc2626", rgb: "220,38,38" }, // 红   = 安全/运维/监控
  { hex: "#0d9488", rgb: "13,148,136" }, // 青  = 默认/其它
]

/** 按层名归色：命中关键词用语义色，否则按位置轮换，保证相邻层不同色 */
function archColor(layerName: string, idx: number): { hex: string; rgb: string } {
  const n = layerName
  if (/安全|运维|监控|审计|风控/.test(n)) return ARCH_COLORS[4]
  if (/渠道|入口|接入|前端|门户|终端/.test(n)) return ARCH_COLORS[1]
  if (/数据|存储|数据库|缓存|仓库|中台数据/.test(n)) return ARCH_COLORS[3]
  if (/平台|能力|中间件|支撑|服务层|基础/.test(n)) return ARCH_COLORS[2]
  if (/业务|应用|服务|域/.test(n)) return ARCH_COLORS[0]
  return ARCH_COLORS[[5, 0, 2, 3, 1, 5][idx % 6]]
}

function architectureSvg(spec: Extract<FigureSpec, { type: "architecture" }>, p: FigurePalette): { body: string; height: number } {
  const layers = spec.layers.slice(0, 6)
  const cross = (spec.crossCutting ?? []).slice(0, 6)
  const layerH = 58
  const gap = 26 // 层间留箭头空间
  const pad = 10
  const labelW = 86 // 左侧彩色层标签宽
  const crossW = cross.length ? 96 : 0 // 右侧横切竖条宽
  const crossGap = cross.length ? 10 : 0
  const mainX = pad + labelW + 8
  const mainW = W - mainX - pad - crossW - crossGap
  const height = pad * 2 + layers.length * layerH + Math.max(0, layers.length - 1) * gap
  let body = ""

  // 右侧横切关注竖条（信息安全/运维管理/标准规范等，不打断主链路）
  if (cross.length) {
    const cx = W - pad - crossW
    body += `<rect x="${cx}" y="${pad}" width="${crossW}" height="${height - pad * 2}" rx="8" fill="rgba(100,116,139,0.10)" stroke="rgba(100,116,139,0.45)" stroke-width="1"/>`
    body += `<text x="${cx + crossW / 2}" y="${pad + 20}" font-size="11" font-weight="700" text-anchor="middle" fill="#64748b">横切关注</text>`
    cross.forEach((c, i) => {
      const cy = pad + 42 + i * 26
      body += `<circle cx="${cx + 14}" cy="${cy - 4}" r="2.5" fill="#64748b"/>`
      body += `<text x="${cx + 24}" y="${cy}" font-size="11" fill="${p.foreground}">${esc(cut(c, 6))}</text>`
    })
  }

  layers.forEach((layer, i) => {
    const y = pad + i * (layerH + gap)
    const c = archColor(layer.name, i)
    // 层标签：左侧彩色圆角色块（白字），对齐范文
    body += `<rect x="${pad}" y="${y}" width="${labelW}" height="${layerH}" rx="8" fill="${c.hex}"/>`
    body += `<text x="${pad + labelW / 2}" y="${y + layerH / 2 - 5}" font-size="13" font-weight="700" text-anchor="middle" fill="#ffffff">${esc(cut(layer.name, 4))}</text>`
    body += `<text x="${pad + labelW / 2}" y="${y + layerH / 2 + 12}" font-size="9" text-anchor="middle" fill="rgba(255,255,255,0.85)">${String(i + 1).padStart(2, "0")}</text>`
    // 模块区：透明主色底 + 主色描边 + 白卡片
    body += `<rect x="${mainX}" y="${y}" width="${mainW}" height="${layerH}" rx="8" fill="rgba(${c.rgb},0.06)" stroke="rgba(${c.rgb},0.35)" stroke-width="1"/>`
    const mods = layer.modules.slice(0, 6)
    const n = Math.max(1, mods.length)
    const bw = Math.min(128, (mainW - 24 - (n - 1) * 8) / n)
    const by = y + (layerH - 34) / 2
    mods.forEach((m, j) => {
      const bx = mainX + 12 + j * (bw + 8)
      body += `<rect x="${bx}" y="${by}" width="${bw}" height="34" rx="6" fill="${p.card}" stroke="${c.hex}" stroke-opacity="0.55" stroke-width="1"/>`
      body += `<rect x="${bx}" y="${by}" width="3" height="34" rx="1.5" fill="${c.hex}"/>`
      body += `<text x="${bx + bw / 2 + 1}" y="${by + 21}" font-size="11" text-anchor="middle" fill="${p.foreground}">${esc(cut(m, 10))}</text>`
    })
    // 层间向下箭头 + 协议/调用标注（arrowLabel）
    if (i < layers.length - 1) {
      const ax = mainX + mainW / 2
      const ay0 = y + layerH + 4
      const ay1 = y + layerH + gap - 6
      body += `<line x1="${ax}" y1="${ay0}" x2="${ax}" y2="${ay1}" stroke="${p.mutedForeground}" stroke-width="1.5"/>`
      body += `<path d="M ${ax - 4} ${ay1} L ${ax} ${ay1 + 5} L ${ax + 4} ${ay1} Z" fill="${p.mutedForeground}"/>`
      const al = (layer.arrowLabel ?? "").trim()
      if (al) {
        body += `<text x="${ax + 10}" y="${(ay0 + ay1) / 2 + 3}" font-size="9" fill="${p.mutedForeground}">${esc(cut(al, 14))}</text>`
      }
    }
  })
  return { body, height }
}

function flowSvg(spec: Extract<FigureSpec, { type: "flow" }>, p: FigurePalette): { body: string; height: number } {
  const steps = spec.steps.slice(0, 8)
  const stepH = 44
  const gap = 26
  const pad = 10
  const boxW = 236
  const bx = 56
  const branches = (spec.branches ?? []).slice(0, 3)
  const branchW = branches.length ? 150 : 0
  const branchGap = branches.length ? 14 : 0
  const height = pad * 2 + steps.length * stepH + Math.max(0, steps.length - 1) * gap
  let body = ""
  steps.forEach((s, i) => {
    const y = pad + i * (stepH + gap)
    // 编号圆点（对齐范文①-⑥流程卡）
    body += `<circle cx="${bx - 26}" cy="${y + stepH / 2}" r="12" fill="${p.primary}"/>`
    body += `<text x="${bx - 26}" y="${y + stepH / 2 + 4}" font-size="11" font-weight="700" text-anchor="middle" fill="#ffffff">${i + 1}</text>`
    // 步骤卡：白底 + 主色描边 + 左侧主色竖条
    body += `<rect x="${bx}" y="${y}" width="${boxW}" height="${stepH}" rx="8" fill="${p.card}" stroke="${p.primary}" stroke-opacity="0.5" stroke-width="1"/>`
    body += `<rect x="${bx}" y="${y}" width="3" height="${stepH}" rx="1.5" fill="${p.primary}"/>`
    body += `<text x="${bx + 16}" y="${y + stepH / 2 + (s.desc ? -2 : 4)}" font-size="12" font-weight="600" fill="${p.foreground}">${esc(cut(s.name, 14))}</text>`
    if (s.desc) {
      body += `<text x="${bx + 16}" y="${y + stepH / 2 + 14}" font-size="10" fill="${p.mutedForeground}">${esc(cut(s.desc, 22))}</text>`
    }
    // 连线箭头
    if (i < steps.length - 1) {
      const ax = bx + boxW / 2
      const ay = y + stepH
      body += `<line x1="${ax}" y1="${ay + 3}" x2="${ax}" y2="${ay + gap - 8}" stroke="${p.primary}" stroke-opacity="0.6" stroke-width="2"/>`
      body += `<polygon points="${ax - 5},${ay + gap - 8} ${ax + 5},${ay + gap - 8} ${ax},${ay + gap - 1}" fill="${p.primary}"/>`
    }
  })
  // 分支：右侧虚线竖条 + 逐条标注（对齐范文「变化隔离」侧注）
  if (branches.length) {
    const bxx = bx + boxW + branchGap
    body += `<rect x="${bxx}" y="${pad}" width="${branchW}" height="${height - pad * 2}" rx="8" fill="${p.primary}" fill-opacity="0.05" stroke="${p.primary}" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="4 3"/>`
    body += `<text x="${bxx + branchW / 2}" y="${pad + 20}" font-size="11" font-weight="700" text-anchor="middle" fill="${p.primary}">分支说明</text>`
    branches.forEach((b, i) => {
      const by = pad + 44 + i * 40
      body += `<circle cx="${bxx + 14}" cy="${by - 4}" r="2.5" fill="${p.primary}"/>`
      // 分支文本手动折行（每行约 9 字）
      const txt = String(b)
      const line1 = txt.slice(0, 9)
      const line2 = txt.length > 9 ? txt.slice(9, 18) : ""
      body += `<text x="${bxx + 24}" y="${by}" font-size="10" fill="${p.mutedForeground}">${esc(line1)}</text>`
      if (line2) body += `<text x="${bxx + 24}" y="${by + 13}" font-size="10" fill="${p.mutedForeground}">${esc(line2)}</text>`
    })
  }
  return { body, height }
}

// ---------------------------------------------------------------------------
// 表格图（2026-10-30）：四列对照表 / 指标进度表，售前汇报最高频版式
// 表头按语义色循环着色（对齐范文 a2_02 四列对照表）；
// progress 版式在数值单元格内渲染横向进度条（对齐范文 a4_04 指标进度表）。
// ---------------------------------------------------------------------------
const TABLE_HEAD_COLORS = ["#1e3a5f", "#4d7c0f", "#b45309", "#6b21a8", "#0f766e", "#9f1239"]

/**
 * 从单元格文本提取 0-1 进度（支持 95% / 95 / 0.95）
 *
 * 2026-10-30 加严：原来任何含数字的文本都会被判成进度，导致
 * 「获取互联互通 4A 成绩」这种描述被画成一根进度条（实测踩坑）。
 * 现要求：整格就是「一个数值」（可带 % 或"级"），不含其它文字。
 */
function cellRatio(text: string): number | null {
  const t = String(text ?? "").trim()
  // 纯百分比 / 纯数字 / "xx%"（允许前后有少量单位词）
  const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(t)
  if (pct) return Math.min(1, Math.max(0, parseFloat(pct[1]) / 100))
  const bare = /^(\d+(?:\.\d+)?)$/.exec(t)
  if (bare) {
    const n = parseFloat(bare[1])
    // 0-1 视作比例；1-100 视作百分比；>100 不画进度条（避免"1800万"被画满）
    if (n <= 1) return Math.max(0, n)
    if (n <= 100) return n / 100
    return null
  }
  // "5级" 这类评级数字也可画进度（1-9级 / 9）
  const lvl = /^(\d+)\s*级$/.exec(t)
  if (lvl) {
    const n = parseInt(lvl[1], 10)
    return n >= 1 && n <= 9 ? n / 9 : null
  }
  return null
}

/**
 * 按像素宽度截断中文文本（1 个汉字 ≈ fontSize，1 个 ASCII ≈ fontSize*0.55）
 * 原来用 `cut(text, colW/11)` 按字符数截，中文会溢出到相邻列。
 */
function fitText(text: string, availPx: number, fontSize: number): string {
  const widthOf = (ch: string) => (/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.55)
  let w = 0
  let out = ""
  for (const ch of String(text ?? "")) {
    const cw = widthOf(ch)
    if (w + cw > availPx - fontSize) {
      return out + "…"
    }
    out += ch
    w += cw
  }
  return out
}

function tableSvg(spec: Extract<FigureSpec, { type: "table" }>, p: FigurePalette): { body: string; height: number } {
  const cols = spec.columns.slice(0, 6)
  const rows = spec.rows.slice(0, 10)
  const variant = spec.variant ?? "compare"
  const pad = 10
  const headH = 30
  const rowH = variant === "progress" ? 42 : 34
  const height = pad * 2 + headH + rows.length * rowH
  const tableW = W - pad * 2

  // 2026-10-30 列宽按内容长度加权（原来均分，导致"核心交付物"这种长文本列被截断）
  const weights = cols.map((c, j) => {
    const headLen = String(c).length
    const maxCellLen = Math.max(...rows.map((r) => String(r[j] ?? "").length), 1)
    return Math.max(headLen, Math.min(maxCellLen, 22))
  })
  const totalW = weights.reduce((a, b) => a + b, 0) || 1
  const colWidths = weights.map((w) => Math.max(70, (w / totalW) * tableW))
  // 归一化回总宽（避免 Math.max 下限导致的溢出）
  const sumW = colWidths.reduce((a, b) => a + b, 0)
  const scaled = colWidths.map((w) => (w / sumW) * tableW)

  let body = ""
  let accX = pad
  const colX: number[] = []
  scaled.forEach((w) => {
    colX.push(accX)
    accX += w
  })
  const fontSize = 11
  const innerPad = 10

  // 表头
  cols.forEach((c, j) => {
    body += `<rect x="${colX[j]}" y="${pad}" width="${scaled[j]}" height="${headH}" fill="${TABLE_HEAD_COLORS[j % TABLE_HEAD_COLORS.length]}"/>`
    body += `<text x="${colX[j] + scaled[j] / 2}" y="${pad + headH / 2 + 4}" font-size="12" font-weight="700" text-anchor="middle" fill="#ffffff">${esc(fitText(c, scaled[j] - 8, 12))}</text>`
  })

  // 数据行
  rows.forEach((r, i) => {
    const ry = pad + headH + i * rowH
    if (i % 2 === 1) body += `<rect x="${pad}" y="${ry}" width="${tableW}" height="${rowH}" fill="rgba(148,163,184,0.10)"/>`
    body += `<line x1="${pad}" y1="${ry}" x2="${pad + tableW}" y2="${ry}" stroke="rgba(148,163,184,0.30)" stroke-width="1"/>`
    r.slice(0, cols.length).forEach((cell, j) => {
      const cx = colX[j]
      const text = String(cell ?? "")
      const avail = scaled[j] - innerPad * 2
      const ratio = variant === "progress" && j > 0 ? cellRatio(text) : null
      if (ratio != null) {
        body += `<text x="${cx + innerPad}" y="${ry + 17}" font-size="${fontSize}" font-weight="600" fill="${p.foreground}">${esc(fitText(text, avail, fontSize))}</text>`
        body += `<rect x="${cx + innerPad}" y="${ry + 25}" width="${avail}" height="7" rx="3.5" fill="rgba(148,163,184,0.25)"/>`
        body += `<rect x="${cx + innerPad}" y="${ry + 25}" width="${Math.max(4, avail * ratio)}" height="7" rx="3.5" fill="${p.primary}"/>`
      } else {
        body += `<text x="${cx + innerPad}" y="${ry + rowH / 2 + 4}" font-size="${fontSize}" font-weight="${j === 0 ? 600 : 400}" fill="${j === 0 ? p.foreground : p.mutedForeground}">${esc(fitText(text, avail, fontSize))}</text>`
      }
    })
  })
  // 外框 + 竖分隔线
  body += `<rect x="${pad}" y="${pad}" width="${tableW}" height="${headH + rows.length * rowH}" rx="6" fill="none" stroke="rgba(148,163,184,0.40)" stroke-width="1"/>`
  for (let j = 1; j < cols.length; j += 1) {
    body += `<line x1="${colX[j]}" y1="${pad + headH}" x2="${colX[j]}" y2="${pad + headH + rows.length * rowH}" stroke="rgba(148,163,184,0.22)" stroke-width="1"/>`
  }
  return { body, height }
}

/**
 * 图标矩阵（2026-10-30）：把"4-6 条并列要点"视觉化。
 *
 * 为什么需要：实测 AI 生成里最常见的失败页型是「1 个标题 + 4 条平行短句」——
 * 既没有数据（画不了图表）、没有层次（画不了架构图）、也没有时序（画不了流程图），
 * 以前只能退化成文字卡片。图标矩阵给每项一个图标底 + 色条 + 大标题，
 * 让这类页也有版面结构与呼吸感。
 */
function iconGridSvg(spec: Extract<FigureSpec, { type: "iconGrid" }>, p: FigurePalette): { body: string; height: number } {
  const items = spec.items.slice(0, 6)
  const pad = 12
  const cols = items.length <= 3 ? items.length || 1 : items.length === 4 ? 2 : 3
  const rows = Math.ceil(items.length / cols)
  const gapX = 16
  const gapY = 16
  const cellW = (W - pad * 2 - gapX * (cols - 1)) / cols
  // 卡片高度按内容行数自适应：有说明的行多，没说明的行少
  const hasAnyDesc = items.some((it) => it.desc && String(it.desc).trim())
  const maxLabelLen = Math.max(...items.map((it) => String(it.label ?? "").length), 8)
  // 每行可容纳字数按卡片实际可用宽度折算（中文字宽 ≈ 字号），左右内边距 18*2
  const availW = cellW - 36
  const charsPerLine = Math.max(6, Math.floor(availW / 14))
  const estLabelLines = Math.min(hasAnyDesc ? 2 : 4, Math.max(1, Math.ceil(maxLabelLen / charsPerLine)))
  const estDescLines = hasAnyDesc ? 2 : 0
  // 上边距(图标位 16+34=50) + 文字区 + 底部留白
  const cellH = 58 + estLabelLines * 19 + estDescLines * 16 + 12
  const height = pad * 2 + rows * cellH + (rows - 1) * gapY
  let body = ""
  items.forEach((it, i) => {
    const r = Math.floor(i / cols)
    const c = i % cols
    const x = pad + c * (cellW + gapX)
    const y = pad + r * (cellH + gapY)
    const color = ARCH_COLORS[i % ARCH_COLORS.length]
    // 卡片：白底 + 极浅色描边（2026-10-30 实测修正：原来 0.06 填充渲染成大色块，
    // 像色卡不像排版；专业版式靠"留白 + 细边 + 细色条"，不靠大面积填色）
    body += `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="10" fill="${p.card}" stroke="rgba(${color.rgb},0.30)" stroke-width="1"/>`
    // 左侧细色条，克制的语义强调
    body += `<rect x="${x}" y="${y + 14}" width="4" height="${cellH - 28}" rx="2" fill="${color.hex}"/>`
    // 图标位：淡色块 + 序号（不画通用图标，避免语义错配）
    body += `<rect x="${x + 16}" y="${y + 16}" width="34" height="34" rx="9" fill="rgba(${color.rgb},0.13)"/>`
    body += `<text x="${x + 33}" y="${y + 38}" font-size="15" font-weight="700" text-anchor="middle" fill="${color.hex}">${i + 1}</text>`
    // 主标 + 说明
    // 2026-10-30 实测修正：无 desc 的卡片若只在顶部放一行主标，下半张卡会空一大块。
    // 改为：有 desc → 主标在上、说明在下（双层次）；无 desc → 主标按可用行数居中放大。
    const label = String(it.label ?? "")
    const hasDesc = Boolean(it.desc && String(it.desc).trim())
    const labelSize = hasDesc ? 13 : 14
    const perLine = Math.max(6, Math.floor((cellW - 72) / (labelSize * 1.05)))
    const labLines = splitLines(label, perLine, hasDesc ? 2 : 3)
    if (hasDesc) {
      labLines.forEach((ln, k) => {
        body += `<text x="${x + 60}" y="${y + 34 + k * 17}" font-size="${labelSize}" font-weight="700" fill="${p.foreground}">${esc(ln)}</text>`
      })
      const descY = y + 40 + labLines.length * 17 + 6
      const dPerLine = Math.max(8, Math.floor((cellW - 36) / 10.5))
      const parts = splitLines(String(it.desc), dPerLine, 3)
      parts.forEach((ln, k) => {
        body += `<text x="${x + 18}" y="${descY + k * 15}" font-size="10.5" fill="${p.mutedForeground}">${esc(ln)}</text>`
      })
    } else {
      // 无说明：图标位固定左上，主标从图标下方开始（x 与图标左对齐，避免与图标重叠）
      const textX = x + 18
      const startY = y + 56
      labLines.forEach((ln, k) => {
        body += `<text x="${textX}" y="${startY + k * 19}" font-size="${labelSize}" font-weight="700" fill="${p.foreground}">${esc(ln)}</text>`
      })
    }
  })
  return { body, height }
}

/** 按每行字数硬折行（中文按字计），最多 maxLines 行，超出加省略号 */
function splitLines(text: string, perLine: number, maxLines: number): string[] {
  const src = String(text ?? "").trim()
  if (!src) return []
  const out: string[] = []
  for (let i = 0; i < src.length && out.length < maxLines; i += perLine) {
    const isLastAllowed = out.length === maxLines - 1
    const remaining = src.length - i
    // 只有当剩余内容确实超过一行时才截断加省略号
    const seg = isLastAllowed && remaining > perLine ? src.slice(i, i + perLine - 1) + "…" : src.slice(i, i + perLine)
    out.push(seg)
  }
  return out
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
    spec.type === "architecture"
      ? architectureSvg(spec, p)
      : spec.type === "flow"
        ? flowSvg(spec, p)
        : spec.type === "table"
          ? tableSvg(spec, p)
          : spec.type === "iconGrid"
            ? iconGridSvg(spec, p)
            : demoSvg(spec, p)
  const typeLabel =
    spec.type === "architecture"
      ? "架构图"
      : spec.type === "flow"
        ? "流程图"
        : spec.type === "table"
          ? "表格"
          : spec.type === "iconGrid"
            ? "要点矩阵"
            : "界面示意"
  const height = drawn.height + 24
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" font-family="sans-serif" role="img" aria-label="${esc(spec.title)}">`,
    `<rect x="0" y="0" width="${W}" height="${height}" fill="${p.card}"/>`,
    // 图题：typeLabel 与 title 相同（如 iconGrid 的"要点矩阵"）时不重复显示
    `<text x="8" y="15" font-size="11" fill="${p.mutedForeground}">${esc(typeLabel === spec.title ? typeLabel : `${typeLabel} · ${cut(spec.title, 40)}`)}</text>`,
    `<g transform="translate(0,20)">${drawn.body}</g>`,
    `</svg>`,
  ].join("")
}

/** 位图内联渲染体（<img> 加载，失败显示占位提示）——图片来自章节内上传/图模板库 */
function ImageFigureBody({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="flex h-32 items-center justify-center bg-background text-xs text-muted-foreground">
        配图加载失败（「{title}」），可在章节内重新上传替换
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

/** 章节内配图卡片：标题 + 内联 SVG / mermaid / 位图 */
export function BidFigure({ spec }: { spec: FigureSpec }) {
  const markup = useMemo(() => (spec.type === "mermaid" || spec.type === "image" ? "" : buildFigureSvg(spec, tokenPalette())), [spec])
  const typeLabel =
    spec.type === "architecture"
      ? "架构图"
      : spec.type === "flow"
        ? "流程图"
        : spec.type === "table"
          ? "表格"
          : spec.type === "iconGrid"
            ? "要点矩阵"
            : spec.type === "mermaid"
            ? mermaidFigureLabel(spec)
            : spec.type === "image"
              ? "配图"
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

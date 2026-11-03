// ---------------------------------------------------------------------------
// PPT 渲染后质量检查（2026-10-30 补齐 5）
//
// 需求原文（§七 质量门禁）：
//   「导出后将 PPTX 渲染为页面图片，检查实际效果；**只检查 JSON 字数不算完成验收**。」
//
// 为什么必须有这一层：
//   现有 deckLint 全是**结构层**检查（JSON 里数据对不对），看不见真实版面。
//   实测踩过的真实事故：
//     · 表格文字溢出到相邻列（JSON 数据完全合法，肉眼才看得出）
//     · 「获取互联互通 4A 成绩」被误画成进度条（数据合法，语义错）
//     · 卡片文字压在序号图标上（渲染层重叠）
//   这些**只有把页面渲染成图才发现**。
//
// 本模块的边界（重要）：
//   · 纯函数：输入「页面图 + 元素框」，输出问题清单；不做 OCR、不调模型
//   · 不依赖浏览器：可在 Node（sidecar）跑，也可在测试里跑
//   · 检测靠**几何**（越界/重叠/贴边）与**像素统计**（空白率/墨量），
//     不做文字识别——OCR 只用于「页面文字与 deck 数据是否一致」的抽样核对
// ---------------------------------------------------------------------------

/** 页面画布尺寸（像素，与渲染 DPI 对应） */
export type Canvas = { width: number; height: number }

/** 一个渲染出的元素框（坐标已换算到页面像素） */
export type RenderedBox = {
  /** 元素 id（用于定位回 deck 数据） */
  id: string
  /** 元素类型 */
  kind: "text" | "image" | "shape" | "chart" | "table" | "group"
  /** 左上角与尺寸（像素） */
  x: number
  y: number
  w: number
  h: number
  /** 文本内容（可截断） */
  text?: string
  /** 字号的磅值（用于判断是否小于最小字号） */
  fontSizePt?: number
}

export type RenderIssueSeverity = "error" | "warn"

export type RenderIssue = {
  /** 1 基页码 */
  page: number
  code: string
  severity: RenderIssueSeverity
  message: string
  /** 涉及元素 id（便于在界面上高亮） */
  boxIds?: string[]
}

export type RenderCheckOptions = {
  /** 安全边距（像素）。元素越出 [m, W-m] 即越界 */
  safeMarginPx?: number
  /** 正文最小字号（磅）。小于此值视为不可读 */
  minFontPt?: number
  /** 页面空白率上限（0-1）。超过视为"内容太少/大片留白" */
  maxBlankRatio?: number
  /** 页面上墨率下限（0-1）。低于视为"几乎空白" */
  minInkRatio?: number
}

const DEFAULTS: Required<RenderCheckOptions> = {
  safeMarginPx: 32, // 约 0.35 英寸 @96dpi
  minFontPt: 10, // 正文小于 10pt 在投影上基本看不清
  maxBlankRatio: 0.82, // 超过 82% 是空白 → 页面太空
  minInkRatio: 0.008, // 低于 0.8% 有墨像素 → 几乎是空页
}

// ===========================================================================
// 一、几何检查（基于元素框，不需要像素）
// ===========================================================================

/**
 * 检查一页的几何问题：越界 / 重叠 / 过小字号 / 超出画布。
 *
 * @param page 1 基页码
 */
export function checkPageGeometry(
  page: number,
  boxes: RenderedBox[],
  canvas: Canvas,
  opts?: RenderCheckOptions,
): RenderIssue[] {
  const o = { ...DEFAULTS, ...opts }
  const issues: RenderIssue[] = []
  const { width: W, height: H } = canvas
  if (!W || !H) return issues

  // 1) 越出画布（严重：内容会被裁掉）
  for (const b of boxes) {
    if (b.x < -1 || b.y < -1 || b.x + b.w > W + 1 || b.y + b.h > H + 1) {
      issues.push({
        page,
        code: "out_of_canvas",
        severity: "error",
        message: `「${shortText(b.text) || b.id}」超出页面边界（导出会被裁切）`,
        boxIds: [b.id],
      })
      continue
    }
    // 2) 侵入安全边距（警告：可能压到公司 Logo / 页脚）
    if (
      b.x < o.safeMarginPx - 2 ||
      b.y < o.safeMarginPx - 2 ||
      b.x + b.w > W - o.safeMarginPx + 2 ||
      b.y + b.h > H - o.safeMarginPx + 2
    ) {
      issues.push({
        page,
        code: "into_safe_margin",
        severity: "warn",
        message: `「${shortText(b.text) || b.id}」贴近页面边缘，可能遮挡模板 Logo 或页脚`,
        boxIds: [b.id],
      })
    }
  }

  // 3) 文字重叠（严重：两个文本框叠在一起 → 打印/投影看不清）
  const texts = boxes.filter((b) => b.kind === "text" && b.w > 4 && b.h > 4)
  for (let i = 0; i < texts.length; i += 1) {
    for (let j = i + 1; j < texts.length; j += 1) {
      const a = texts[i]
      const b = texts[j]
      const ov = overlapArea(a, b)
      if (ov <= 0) continue
      // 重叠面积占较小者的比例 > 35% 才算问题（轻微交叠常见且无害）
      const smaller = Math.min(a.w * a.h, b.w * b.h)
      if (smaller > 0 && ov / smaller > 0.35) {
        issues.push({
          page,
          code: "text_overlap",
          severity: "error",
          message: `「${shortText(a.text) || a.id}」与「${shortText(b.text) || b.id}」文字重叠`,
          boxIds: [a.id, b.id],
        })
      }
    }
  }

  // 4) 正文字号过小（警告：投影不可读）
  for (const b of texts) {
    if (b.fontSizePt && b.fontSizePt < o.minFontPt) {
      issues.push({
        page,
        code: "font_too_small",
        severity: "warn",
        message: `「${shortText(b.text) || b.id}」字号 ${b.fontSizePt}pt 小于 ${o.minFontPt}pt，投影时看不清`,
        boxIds: [b.id],
      })
    }
  }

  // 5) 元素尺寸为零（严重：渲染异常）
  for (const b of boxes) {
    if (b.w <= 0.5 || b.h <= 0.5) {
      issues.push({
        page,
        code: "zero_size_box",
        severity: "error",
        message: `元素「${shortText(b.text) || b.id}」尺寸为 0（渲染异常）`,
        boxIds: [b.id],
      })
    }
  }

  return issues
}

/** 两框重叠面积 */
function overlapArea(a: RenderedBox, b: RenderedBox): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  if (x2 <= x1 || y2 <= y1) return 0
  return (x2 - x1) * (y2 - y1)
}

function shortText(t?: string): string {
  const s = String(t ?? "").replace(/\s+/g, " ").trim()
  return s.length > 16 ? `${s.slice(0, 16)}…` : s
}

// ===========================================================================
// 二、像素检查（基于渲染出的位图）
// ===========================================================================

/** 极简位图描述：RGBA 扁平数组 + 尺寸 */
export type Bitmap = {
  width: number
  height: number
  /** RGBA，长度 = width*height*4 */
  data: Uint8Array | Uint8ClampedArray
}

/**
 * 统计页面的「有墨比例」与「空白率」。
 *
 * 做法：把像素按亮度二值化（阈值 245 认为接近白底），
 * 统计非白像素占比。这是判断"空页/大片留白"最直接的方法，
 * 不需要 OCR 也不需要元素框。
 */
export function measureInk(bitmap: Bitmap, whiteThreshold = 245): { inkRatio: number; blankRatio: number } {
  const { width, height, data } = bitmap
  const total = width * height
  if (!total) return { inkRatio: 0, blankRatio: 1 }
  let ink = 0
  for (let i = 0; i < total; i += 1) {
    const p = i * 4
    const r = data[p]
    const g = data[p + 1]
    const b = data[p + 2]
    // 亮度（BT.601）
    const y = 0.299 * r + 0.587 * g + 0.114 * b
    if (y < whiteThreshold) ink += 1
  }
  const inkRatio = ink / total
  return { inkRatio, blankRatio: 1 - inkRatio }
}

/** 按行/列切块，找出「整块空白」的区域（用于定位大片留白） */
export function findBlankRegions(
  bitmap: Bitmap,
  opts?: { gridRows?: number; gridCols?: number; blankRatioThreshold?: number; whiteThreshold?: number },
): { row: number; col: number; blankRatio: number }[] {
  const rows = Math.max(1, opts?.gridRows ?? 4)
  const cols = Math.max(1, opts?.gridCols ?? 4)
  const thr = opts?.blankRatioThreshold ?? 0.995
  const white = opts?.whiteThreshold ?? 245
  const { width, height, data } = bitmap
  const cellW = Math.floor(width / cols)
  const cellH = Math.floor(height / rows)
  const out: { row: number; col: number; blankRatio: number }[] = []
  if (!cellW || !cellH) return out

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      let ink = 0
      let total = 0
      for (let y = r * cellH; y < (r + 1) * cellH; y += 1) {
        for (let x = c * cellW; x < (c + 1) * cellW; x += 1) {
          const p = (y * width + x) * 4
          const lum = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
          if (lum < white) ink += 1
          total += 1
        }
      }
      const ratio = total ? ink / total : 0
      if (1 - ratio >= thr) out.push({ row: r, col: c, blankRatio: 1 - ratio })
    }
  }
  return out
}

/**
 * 检查一页的像素问题：空白页 / 大片留白。
 */
export function checkPagePixels(
  page: number,
  bitmap: Bitmap,
  opts?: RenderCheckOptions,
): RenderIssue[] {
  const o = { ...DEFAULTS, ...opts }
  const issues: RenderIssue[] = []
  const { inkRatio } = measureInk(bitmap)

  // 空页（严重：导出一份有空白页的 PPT 是废品）
  if (inkRatio < o.minInkRatio) {
    issues.push({
      page,
      code: "blank_page_render",
      severity: "error",
      message: `第 ${page} 页渲染后几乎空白（有墨率 ${(inkRatio * 100).toFixed(2)}%），导出前请补充内容`,
    })
    return issues
  }

  // 大片留白（警告：观感"资料汇编"）
  const blanks = findBlankRegions(bitmap, { gridRows: 4, gridCols: 4 })
  if (blanks.length >= 8) {
    // 4x4=16 格里 8 格以上全空 → 内容集中在少数区域
    issues.push({
      page,
      code: "large_blank_area",
      severity: "warn",
      message: `第 ${page} 页有 ${blanks.length}/16 个区域完全空白，版面偏空`,
    })
  }
  return issues
}

// ===========================================================================
// 三、整册检查编排
// ===========================================================================

export type RenderedPage = {
  page: number
  canvas: Canvas
  boxes?: RenderedBox[]
  bitmap?: Bitmap
}

export type RenderReport = {
  /** 总页数 */
  pageCount: number
  issues: RenderIssue[]
  /** 严重问题数 */
  errorCount: number
  /** 警告数 */
  warnCount: number
  /** 是否可放行（无 error） */
  pass: boolean
}

/**
 * 整册渲染检查：逐页跑几何 + 像素检查，汇总成报告。
 *
 * 有 error 级问题 → pass=false（调用方据此阻断导出）。
 */
export function checkRenderedDeck(pages: RenderedPage[], opts?: RenderCheckOptions): RenderReport {
  const issues: RenderIssue[] = []
  for (const p of pages) {
    if (p.boxes?.length) issues.push(...checkPageGeometry(p.page, p.boxes, p.canvas, opts))
    if (p.bitmap) issues.push(...checkPagePixels(p.page, p.bitmap, opts))
  }
  const errorCount = issues.filter((i) => i.severity === "error").length
  const warnCount = issues.filter((i) => i.severity === "warn").length
  // 按页码排序，便于逐页修
  issues.sort((a, b) => a.page - b.page)
  return { pageCount: pages.length, issues, errorCount, warnCount, pass: errorCount === 0 }
}

/** 报告压成一句给用户看的话 */
export function renderReportSummary(r: RenderReport): string {
  if (!r.issues.length) return `已渲染检查 ${r.pageCount} 页，未发现版面问题`
  const pages = Array.from(new Set(r.issues.filter((i) => i.severity === "error").map((i) => i.page))).sort((a, b) => a - b)
  const bits: string[] = []
  if (r.errorCount) bits.push(`${r.errorCount} 处严重问题${pages.length ? `（第 ${pages.join("、")} 页）` : ""}`)
  if (r.warnCount) bits.push(`${r.warnCount} 处需注意`)
  return `已渲染检查 ${r.pageCount} 页：${bits.join("，")}`
}

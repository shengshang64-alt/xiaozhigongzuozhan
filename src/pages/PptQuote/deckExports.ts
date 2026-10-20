import PptxGenJS from "pptxgenjs"
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx"
import { DOCX_DEFAULT_STYLES } from "@/lib/exportFont"
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate"
import {
  deckTypeLabel,
  type DeckRecord,
  type DeckTransition,
  type Slide,
} from "./pptQuoteTypes"
import { renderDeckChartPng } from "./deckChart"
import { shade, type DeckThemeTokens } from "./deckTheme"
import { buildFidelityDeck } from "./templateFidelity"
import { effectiveLayout, planFidelityExport } from "./deckFidelityPlan"
import type { FigureSpec } from "@/pages/SolutionStudio/solutionTypes"
import { buildFigureSvg, tokenPalette } from "@/components/bid-workspace/BidFigure"
import { triggerBlobDownload } from "@/lib/download"
import { buildSafeFileName } from "@/lib/fileName"

// ---------------------------------------------------------------------------
// PPT 导出（.pptx 商务版式：图文/图表/KPI/章节页 + 讲稿 Word + 页面切换动画）。
// 导出文件用中性商务配色，与站内 UI token 无关。
// ---------------------------------------------------------------------------

// R169：以下导出调色板默认值 = 内置中性商务版式；exportDeckPptx 收到用户模板主题令牌时
// 经 applyDeckTheme 逐轮导出覆盖（let 而非 const 是有意的导出期可变，函数结束前全部重赋）。
const DEFAULT_NAVY = "1F3864"
const DEFAULT_ACCENT = "2E74B5"
let NAVY = DEFAULT_NAVY
let ACCENT = DEFAULT_ACCENT
let ACCENT_SOFT = "D6E4F0"
let BODY = "333333"
let SUBTLE = "D6E4F0"
let MUTED = "9AA7B5"
let LIGHT_BG = "F5F7FA"

const PAGE_W = 13.333

const TRANSITION_XML: Record<Exclude<DeckTransition, "none">, string> = {
  fade: '<p:transition spd="med"><p:fade/></p:transition>',
  push: '<p:transition spd="med"><p:push dir="r"/></p:transition>',
  wipe: '<p:transition spd="med"><p:wipe dir="r"/></p:transition>',
  split: '<p:transition spd="med"><p:split orient="horz" dir="in"/></p:transition>',
}

function todayText(): string {
  const d = new Date()
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
}

function safeFileName(name: string, ext: string): string {
  return buildSafeFileName(name, ext, "汇报PPT")
}

function bulletFontSize(slides: Slide[]): number {
  const maxBullets = Math.max(...slides.map((s) => s.bullets?.length ?? 0), 1)
  const maxLen = Math.max(...slides.flatMap((s) => (s.bullets ?? []).map((b) => b.length)), 10)
  if (maxBullets <= 4 && maxLen <= 34) return 18
  if (maxBullets <= 6 && maxLen <= 48) return 16
  return 14
}

// R189：effectiveLayout 移至 deckFidelityPlan.ts——保真计划侧与现通道渲染侧共用单一口径

/**
 * 结构化图示 → PNG dataURL（浏览器内 canvas 转换）。
 * 直接用叶子组件 BidFigure 的 buildFigureSvg/tokenPalette，不走 bidFiles（避免把 pdfjs 打进 PPT 导出包）；
 * 任一步失败返回 null 由调用方降级为纯文字。
 */
async function figureSpecToDataUrl(spec: FigureSpec): Promise<string | null> {
  try {
    const svg = buildFigureSvg(spec, tokenPalette())
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml")
    const root = parsed.documentElement
    if (!root || root.nodeName === "parsererror") return null
    const width = Number(root.getAttribute("width")) || 640
    const height = Number(root.getAttribute("height")) || 320
    const markup = new XMLSerializer().serializeToString(root)
    const blobUrl = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }))
    try {
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error("配图渲染失败"))
        img.src = blobUrl
      })
      const canvas = document.createElement("canvas")
      canvas.width = width * 2
      canvas.height = height * 2
      const ctx = canvas.getContext("2d")
      if (!ctx) return null
      ctx.fillStyle = tokenPalette().card
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL("image/png")
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  } catch {
    return null
  }
}

export interface ExportDeckOptions {
  transition?: DeckTransition
  /** R169：用户公司模板提取的主题令牌（缺省=内置商务版式） */
  theme?: DeckThemeTokens
  /** R189（r169 切片二）：母版级保真通道的模板字节（deckTheme.decodeTemplateBytes）；缺省=现通道 */
  templateBytes?: Uint8Array
}

/**
 * R169 模板主题套用：accent1 作强调色、其 55% 压暗作深色标题底（NAVY），
 * 软色/浅底按提亮派生；正文/弱化色保持可读中性。全部回落默认值当 theme 缺省。
 */
function applyDeckTheme(pptx: PptxGenJS, theme?: DeckThemeTokens): void {
  if (!theme) {
    NAVY = DEFAULT_NAVY; ACCENT = DEFAULT_ACCENT; ACCENT_SOFT = "D6E4F0"; BODY = "333333"
    SUBTLE = "D6E4F0"; MUTED = "9AA7B5"; LIGHT_BG = "F5F7FA"
    CHART_PALETTE = ["2E74B5", "1F3864", "5B9BD5", "8FAADC", "375623", "C55A11"]
    return
  }
  const a1 = theme.accents[0] ?? DEFAULT_ACCENT
  const navy = shade(a1, 0.55)
  NAVY = navy
  ACCENT = a1
  ACCENT_SOFT = shade(a1, 1.8)
  SUBTLE = shade(a1, 1.8)
  LIGHT_BG = shade(a1, 2.4)
  BODY = shade("333333", 1)
  MUTED = shade("9AA7B5", 1)
  const a2 = theme.accents[1] ?? shade(a1, 0.7)
  CHART_PALETTE = [a1, navy, shade(a1, 1.35), shade(a2, 1.35), a2, "C55A11"]
  pptx.theme = {
    ...(theme.headFont ? { headFontFace: theme.headFont } : {}),
    ...(theme.bodyFont ? { bodyFontFace: theme.bodyFont } : {}),
  }
}

/** R189：本次导出实际走的通道——fidelity=模板母版/版式级保真；legacy=现 pptxgenjs 通道 */
export type DeckExportPath = "fidelity" | "legacy"

export async function exportDeckPptx(deck: DeckRecord, opts: ExportDeckOptions = {}): Promise<DeckExportPath> {
  const slides = deck.slides ?? []
  if (!slides.length) throw new Error("没有可导出的页面")
  // R189（r169 切片二）：pptxgenjs 构造前先分流——用户上传了模板且整册都是「标题+正文」页时
  // 克隆模板母版/版式生成；无模板字节/含图表KPI图文页/引擎拒绝，下方现通道行为逐字不变
  if (opts.templateBytes?.length) {
    // 附三图文并茂：先解析图文页配图字节（真实配图为持久化 dataURL；AI 图示渲染 PNG），
    // 全部解析成功才进保真通道；缺图回退现通道（契约不变）
    const imageMap = new Map<number, { dataUrl: string }>()
    for (let i = 0; i < slides.length; i++) {
      const s = slides[i]
      if (s.image) imageMap.set(i, { dataUrl: s.image })
      else if (s.figures?.length) {
        try {
          const png = await figureSpecToDataUrl(s.figures[0])
          if (png) imageMap.set(i, { dataUrl: png })
        } catch {
          // 图示渲染失败：该页缺配图字节 → 整册回退现通道（契约不变）
        }
      }
    }
    const specs = planFidelityExport(deck, todayText(), imageMap)
    if (specs) {
      const fid = buildFidelityDeck(opts.templateBytes, specs)
      if (fid.ok) {
        const fidTransition = opts.transition ?? "none"
        const fidBytes = fidTransition === "none" ? fid.bytes : injectTransitions(fid.bytes, fidTransition)
        downloadBlob(fidBytes, safeFileName(deck.deck_name, "pptx"))
        return "fidelity"
      }
    }
  }
  const pptx = new PptxGenJS()
  pptx.layout = "LAYOUT_WIDE"
  pptx.author = "医疗售前工作台"
  pptx.title = deck.deck_name
  // R169：套用公司模板主题（配色 + 默认字体）；未上传模板时逐项回落内置默认
  applyDeckTheme(pptx, opts.theme)
  pptx.subject = deckTypeLabel(deck.deck_type)

  const pageNumber = { x: 12.55, y: 7.02, w: 0.6, h: 0.35, color: MUTED, fontSize: 10 } as const

  // 封面页
  const cover = pptx.addSlide()
  cover.background = { color: NAVY }
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 5.9, w: PAGE_W, h: 0.06, fill: { color: ACCENT } })
  cover.addText(deck.deck_name || "汇报 PPT", {
    x: 0.9, y: 2.35, w: 11.53, h: 1.5, fontSize: 34, bold: true, color: "FFFFFF",
    align: "center", valign: "middle", fit: "shrink",
  })
  const metaBits = [deckTypeLabel(deck.deck_type)]
  if (deck.audience) metaBits.push(`汇报对象：${deck.audience}`)
  if (deck.duration_min) metaBits.push(`时长约 ${deck.duration_min} 分钟`)
  cover.addText(metaBits.join("  |  "), { x: 0.9, y: 4.05, w: 11.53, h: 0.5, fontSize: 14, color: SUBTLE, align: "center" })
  cover.addText(todayText(), { x: 0.9, y: 6.35, w: 11.53, h: 0.4, fontSize: 12, color: SUBTLE, align: "center" })

  // 目录页
  const toc = pptx.addSlide()
  toc.background = { color: "FFFFFF" }
  toc.addText("目录", { x: 0.7, y: 0.45, w: 6, h: 0.75, fontSize: 26, bold: true, color: NAVY })
  toc.addText(
    slides.map((s, i) => ({
      text: `${String(i + 1).padStart(2, "0")}   ${s.title || `第 ${i + 1} 页`}`,
      options: { breakLine: true, fontSize: slides.length > 14 ? 13 : 15, color: BODY, paraSpaceAfter: 6 },
    })),
    { x: 1.0, y: 1.45, w: 11.3, h: 5.6, valign: "top", fit: "shrink" },
  )
  toc.slideNumber = { ...pageNumber }

  // 内容页：无真实配图但有 AI 图示的页，预先把首个图示转成 PNG dataURL 代替 image
  const bodyFontSize = bulletFontSize(slides)
  const figureImg = new Map<string, string>()
  for (const s of slides) {
    if (!s.image && s.figures?.length) {
      const dataUrl = await figureSpecToDataUrl(s.figures[0])
      if (dataUrl) figureImg.set(s.id, dataUrl)
    }
  }
  slides.forEach((s) => {
    const sl = pptx.addSlide()
    sl.background = { color: "FFFFFF" }
    renderContentSlide(pptx, sl, s, bodyFontSize, s.image || figureImg.get(s.id), !s.image && figureImg.has(s.id))
    sl.addText(`${deck.deck_name}`, { x: 0.7, y: 7.02, w: 6, h: 0.35, fontSize: 9, color: MUTED })
    if (s.notes?.trim()) sl.addNotes(s.notes.trim())
    sl.slideNumber = { ...pageNumber }
  })

  // 结尾页
  const end = pptx.addSlide()
  end.background = { color: NAVY }
  end.addShape(pptx.ShapeType.rect, { x: 0, y: 5.9, w: PAGE_W, h: 0.06, fill: { color: ACCENT } })
  end.addText("谢谢聆听", { x: 0.9, y: 2.7, w: 11.53, h: 1.2, fontSize: 40, bold: true, color: "FFFFFF", align: "center" })
  end.addText("欢迎交流指正", { x: 0.9, y: 4.0, w: 11.53, h: 0.5, fontSize: 16, color: SUBTLE, align: "center" })

  const transition = opts.transition ?? "none"
  if (transition === "none") {
    await pptx.writeFile({ fileName: safeFileName(deck.deck_name, "pptx") })
    return "legacy"
  }
  // 后处理注入页面切换动画（PowerPoint 与 WPS 通用）
  const buf = (await pptx.write({ outputType: "arraybuffer" })) as unknown as ArrayBuffer
  const withTransition = injectTransitions(buf, transition)
  downloadBlob(withTransition, safeFileName(deck.deck_name, "pptx"))
  return "legacy"
}

// ---------------------------------------------------------------------------
// 单页版式渲染
// ---------------------------------------------------------------------------

type SlideCtx = ReturnType<PptxGenJS["addSlide"]>

/**
 * 标题排版：纯文字层级（NAVY 粗体 + 字号），不再画「标题下装饰短线」与「顶部色条」。
 * 依据 Anthropic pptx skill 设计规范：accent underline / decorative color bar 是典型 "AI 生成幻灯片" 痕迹，
 * 专业版式靠留白与字号层级建立秩序，而非贴色块。
 */
function addSlideTitle(sl: SlideCtx, title: string, opts?: { x?: number; w?: number }) {
  sl.addText(title || "", {
    x: opts?.x ?? 0.65, y: 0.4, w: opts?.w ?? 12.0, h: 0.85,
    fontSize: 24, bold: true, color: NAVY, fit: "shrink", valign: "middle",
  })
}

function renderContentSlide(pptx: PptxGenJS, sl: SlideCtx, s: Slide, bodyFontSize: number, resolvedImg?: string, isFigure = false) {
  const layout = effectiveLayout(s, Boolean(resolvedImg))

  if (layout === "section") {
    sl.addShape(pptx.ShapeType.rect, { x: 0, y: 2.55, w: PAGE_W, h: 2.4, fill: { color: NAVY } })
    sl.addText(s.title || "", { x: 0.9, y: 2.9, w: 11.53, h: 1.0, fontSize: 30, bold: true, color: "FFFFFF", valign: "bottom", fit: "shrink" })
    const sub = (s.bullets ?? []).join("　·　")
    if (sub) sl.addText(sub, { x: 0.9, y: 4.15, w: 11.53, h: 0.7, fontSize: 14, color: SUBTLE, valign: "top", fit: "shrink" })
    return
  }

  // 其余版式统一带标题
  const bullets = (s.bullets ?? []).length ? s.bullets : []
  if (layout === "kpi") {
    addSlideTitle(sl, s.title)
    renderKpi(pptx, sl, s)
    if (bullets.length) {
      sl.addText(bullets.map((b) => ({ text: b, options: { bullet: { code: "2022", indent: 14 }, breakLine: true, fontSize: 15, color: BODY, paraSpaceAfter: 8 } })),
        { x: 0.85, y: 4.55, w: 11.7, h: 2.3, valign: "top", fit: "shrink" })
    }
    return
  }

  if (layout === "chart") {
    const hasText = bullets.length > 0
    addSlideTitle(sl, s.title)
    const box = hasText ? { x: 6.55, y: 1.55, w: 6.2 } : { x: 1.6, y: 1.6, w: 10.1 }
    renderNativeChart(pptx, sl, s, box.x, box.y, box.w, hasText ? 5.2 : 5.0, () =>
      renderChartImage(pptx, sl, s, box.x, box.y, box.w),
    )
    if (hasText) {
      sl.addText(bullets.map((b) => ({ text: b, options: { bullet: { code: "2022", indent: 14 }, breakLine: true, fontSize: bodyFontSize, color: BODY, paraSpaceAfter: 10 } })),
        { x: 0.85, y: 1.55, w: 5.4, h: 5.2, valign: "top", fit: "shrink" })
    }
    return
  }

  if (layout === "banner") {
    addSlideTitle(sl, s.title)
    if (isFigure) addFigureImage(sl, resolvedImg!, { x: 0.7, y: 1.4, w: 11.93, h: 2.7 })
    else addCoverImage(sl, resolvedImg!, { x: 0.7, y: 1.4, w: 11.93, h: 2.7 })
    addImageCaption(sl, s, 0.7, 4.16, 11.93)
    if (bullets.length) {
      sl.addText(bullets.map((b) => ({ text: b, options: { bullet: { code: "2022", indent: 14 }, breakLine: true, fontSize: bodyFontSize, color: BODY, paraSpaceAfter: 10 } })),
        { x: 0.85, y: 4.55, w: 11.7, h: 2.4, valign: "top", fit: "shrink" })
    }
    return
  }

  if (layout === "image-right" || layout === "image-left") {
    const textX = layout === "image-right" ? 0.7 : 7.1
    const imgX = layout === "image-right" ? 7.1 : 0.7
    addSlideTitle(sl, s.title)
    if (isFigure) addFigureImage(sl, resolvedImg!, { x: imgX, y: 1.5, w: 5.55, h: 4.9 })
    else addCoverImage(sl, resolvedImg!, { x: imgX, y: 1.5, w: 5.55, h: 4.9 })
    addImageCaption(sl, s, imgX, 6.44, 5.55)
    const b = bullets.length ? bullets : [s.title || "—"]
    sl.addText(b.map((t) => ({ text: t, options: { bullet: { code: "2022", indent: 14 }, breakLine: true, fontSize: bodyFontSize, color: BODY, paraSpaceAfter: 10 } })),
      { x: textX + 0.15, y: 1.55, w: 5.4, h: 5.1, valign: "top", fit: "shrink" })
    return
  }

  // bullets（默认）
  addSlideTitle(sl, s.title)
  const list = bullets.length ? bullets : ["—"]
  sl.addText(list.map((t) => ({ text: t, options: { bullet: { code: "2022", indent: 14 }, breakLine: true, fontSize: bodyFontSize, color: BODY, paraSpaceAfter: 10 } })),
    { x: 0.85, y: 1.5, w: 11.7, h: 5.45, valign: "top", fit: "shrink" })
}

/** 图表原生配色（与商务主色一致，不受站内 token 约束） */
// R169：图表色板随模板主题重排（accent1 主序列 → 压暗作对比序列），未套模板时保持内置序
let CHART_PALETTE = ["2E74B5", "1F3864", "5B9BD5", "8FAADC", "375623", "C55A11"]

/**
 * 原生可编辑图表：用 pptxgenjs.addChart 生成真正的 OOXML chart 对象
 * （可在 PowerPoint/WPS 里右键「编辑数据」改数值），这是 Anthropic pptx skill
 * 相对「截图当图表」类工具的第一卖点，也是本次升级核心。
 * addChart 抛错时回退到 ECharts PNG 内嵌（onFallback），保证导出不中断。
 */
function renderNativeChart(
  pptx: PptxGenJS,
  sl: SlideCtx,
  s: Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  onFallback: () => void,
) {
  const c = s.chart
  if (!c || !(c.categories?.length)) {
    onFallback()
    return
  }
  try {
    const type =
      c.type === "pie" ? pptx.ChartType.pie : c.type === "line" ? pptx.ChartType.line : pptx.ChartType.bar
    const data = (c.series ?? []).map((sr) => ({
      name: sr.name || "系列",
      labels: c.categories,
      values: sr.data.map((v) => (Number.isFinite(v) ? v : 0)),
    }))
    if (!data.length) {
      onFallback()
      return
    }
    sl.addChart(type, data, {
      x, y, w, h,
      chartColors: CHART_PALETTE,
      barDir: "col",
      barGapWidthPct: 60,
      lineSize: 3,
      lineSmooth: true,
      showLegend: c.type === "pie" || data.length > 1,
      legendPos: "b",
      legendFontSize: 12,
      legendColor: BODY,
      catAxisLabelColor: BODY,
      catAxisLabelFontSize: 11,
      valAxisLabelColor: MUTED,
      valAxisLabelFontSize: 10,
      valAxisLineShow: false,
      dataLabelColor: BODY,
      dataLabelFontSize: 10,
      showValue: c.type === "pie" ? false : data.length <= 1,
      dataLabelFormatCode: "0.#",
      valAxisTitle: c.unit || "",
      showValAxisTitle: Boolean(c.unit),
      valAxisTitleFontSize: 10,
      valAxisTitleColor: MUTED,
      holeSize: 55,
    })
  } catch {
    try {
      onFallback()
    } catch {
      /* 连回退也失败：留空，不阻断导出 */
    }
  }
}

function addImageCaption(sl: SlideCtx, s: Slide, x: number, y: number, w: number) {
  if (!s.imageAlt?.trim()) return
  sl.addText(s.imageAlt.trim().slice(0, 60), { x, y, w, h: 0.3, fontSize: 9, italic: true, color: MUTED, align: "center" })
}

/**
 * pptxgenjs 4.x 若把 dataURL 传给 `path`，会误把 base64 尾部当扩展名，导致写出的
 * media 文件名与 [Content_Types] 出现 `image/<乱码>`（真实图片仍能靠字节嗅探显示，但不规范）。
 * 改用 `data` 选项（去掉 `data:` scheme 前缀，形如 `image/png;base64,...`），可正确落 `.png` 与 `image/png`。
 */
function imgDataOpt(dataUrl: string): { data: string } {
  return { data: dataUrl.replace(/^data:/i, "") }
}

/** 图片以 cover 方式填满方框（自动裁剪，不变形）；dataUrl 支持 dataURL，导出时不触网 */
function addCoverImage(sl: SlideCtx, dataUrl: string, box: { x: number; y: number; w: number; h: number }) {
  try {
    sl.addImage({ ...imgDataOpt(dataUrl), x: box.x, y: box.y, w: box.w, h: box.h, sizing: { type: "cover", w: box.w, h: box.h } })
  } catch {
    /* 图片异常则跳过，保留文字 */
  }
}

/** 图示页：按 contain 等比缩放居中放满方框（不裁剪，保护架构/流程图完整） */
function addFigureImage(sl: SlideCtx, dataUrl: string, box: { x: number; y: number; w: number; h: number }) {
  try {
    sl.addImage({ ...imgDataOpt(dataUrl), x: box.x, y: box.y, w: box.w, h: box.h, sizing: { type: "contain", w: box.w, h: box.h } })
  } catch {
    /* 图示异常则跳过，保留文字 */
  }
}

/** 图表页：把 SlideChart 渲染成 PNG，按 900:520 比例内嵌（不变形） */
function renderChartImage(pptx: PptxGenJS, sl: SlideCtx, s: Slide, x: number, y: number, w: number) {
  if (!s.chart) return
  try {
    const png = renderDeckChartPng(s.chart, 900, 520)
    const h = (w * 520) / 900
    sl.addImage({ ...imgDataOpt(png), x, y, w, h })
  } catch {
    /* 图表渲染失败：留一个占位框，不阻断导出 */
    sl.addShape(pptx.ShapeType.rect, { x, y, w, h: (w * 520) / 900, fill: { color: LIGHT_BG }, line: { color: MUTED, width: 1 } })
  }
}

/** KPI 大数字卡：2-4 张等宽卡片 */
function renderKpi(pptx: PptxGenJS, sl: SlideCtx, s: Slide) {
  const kpi = (s.kpi ?? []).slice(0, 4)
  if (!kpi.length) return
  const gap = 0.3
  const areaX = 0.7
  const areaW = 11.93
  const cardW = (areaW - gap * (kpi.length - 1)) / kpi.length
  const cardH = 2.3
  const topY = 1.75
  kpi.forEach((k, i) => {
    const x = areaX + i * (cardW + gap)
    sl.addShape(pptx.ShapeType.roundRect, { x, y: topY, w: cardW, h: cardH, fill: { color: LIGHT_BG }, line: { color: ACCENT_SOFT, width: 1 }, rectRadius: 0.08 })
    sl.addShape(pptx.ShapeType.rect, { x, y: topY, w: cardW, h: 0.08, fill: { color: ACCENT } })
    sl.addText(k.value || "", { x: x + 0.1, y: topY + 0.35, w: cardW - 0.2, h: 1.0, fontSize: 40, bold: true, color: NAVY, align: "center", valign: "middle", fit: "shrink" })
    sl.addText(k.label || "", { x: x + 0.15, y: topY + 1.45, w: cardW - 0.3, h: 0.7, fontSize: 14, color: BODY, align: "center", valign: "top", fit: "shrink" })
  })
}

// ---------------------------------------------------------------------------
// 页面切换动画注入 + 下载
// ---------------------------------------------------------------------------

function injectTransitions(buf: ArrayBuffer | Uint8Array, transition: DeckTransition): Uint8Array {
  const zip = unzipSync(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
  const xml = transition === "none" ? "" : TRANSITION_XML[transition]
  const slideRe = /^ppt\/slides\/slide\d+\.xml$/
  for (const key of Object.keys(zip)) {
    if (!slideRe.test(key) || !xml) continue
    const file = zip[key]
    if (!file) continue
    let text = strFromU8(file)
    if (text.indexOf("<p:transition") >= 0) continue
    const clr = text.indexOf("<p:clrMapOvr")
    const pos = clr >= 0 ? clr : text.indexOf("</p:cSld>") >= 0 ? text.indexOf("</p:cSld>") + "</p:cSld>".length : -1
    if (pos < 0) continue
    text = text.slice(0, pos) + xml + text.slice(pos)
    zip[key] = strToU8(text)
  }
  return zipSync(zip)
}

function downloadBlob(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes.slice()], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  })
  triggerBlobDownload(blob, fileName)
}

// ---------------------------------------------------------------------------
// 讲稿 Word 导出
// ---------------------------------------------------------------------------

export async function saveDocx(fileName: string, children: Paragraph[]): Promise<void> {
  const doc = new Document({ styles: DOCX_DEFAULT_STYLES, sections: [{ children }] })
  const blob = await Packer.toBlob(doc)
  triggerBlobDownload(blob, fileName)
}

export async function exportSpeechDocx(deck: DeckRecord): Promise<void> {
  const slides = deck.slides ?? []
  if (!slides.length) throw new Error("没有可导出的页面")
  const children: Paragraph[] = []
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: `${deck.deck_name} · 讲稿`, bold: true, size: 36 })],
    }),
  )
  const metaBits = [deckTypeLabel(deck.deck_type)]
  if (deck.audience) metaBits.push(`汇报对象：${deck.audience}`)
  if (deck.duration_min) metaBits.push(`时长约 ${deck.duration_min} 分钟`)
  metaBits.push(`共 ${slides.length} 页`)
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 320 },
      children: [new TextRun({ text: metaBits.join("　|　"), size: 20, color: "666666" })],
    }),
  )
  slides.forEach((s, i) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 280, after: 120 },
        children: [new TextRun({ text: `第 ${i + 1} 页 · ${s.title || "（未命名页）"}`, bold: true, size: 26 })],
      }),
    )
    ;(s.bullets ?? []).forEach((b) => {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 60 },
          children: [new TextRun({ text: b, size: 22 })],
        }),
      )
    })
    children.push(
      new Paragraph({
        spacing: { before: 100, after: 60 },
        children: [
          new TextRun({ text: "讲稿备注：", bold: true, size: 22, color: "1F3864" }),
          new TextRun({ text: s.notes?.trim() || "（本页暂无讲稿，可在编辑器中补充）", size: 22, color: "444444" }),
        ],
      }),
    )
  })
  await saveDocx(safeFileName(`${deck.deck_name}-讲稿`, "docx"), children)
}


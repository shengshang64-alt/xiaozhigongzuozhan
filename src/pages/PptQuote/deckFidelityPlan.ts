import { deckTypeLabel, type Slide, type SlideLayout } from "./pptQuoteTypes"
import type { FidelitySlideSpec } from "./templateFidelity"

// ---------------------------------------------------------------------------
// R189（r169 切片二·计划层）：PPT 导出「母版级保真」通道的判定与整册 spec 转换。
// 纯模块（不依赖 PPT 渲染库/DOM），node 下可直接单测；deckExports 只做通道执行，
// effectiveLayout 由渲染侧迁入本模块，计划与渲染共用单一口径。
// 契约（沿用 R181 评估）：整册每一页都是「标题+正文」页才进保真通道；
// 任一页含图表/KPI/真实配图/AI 图示则整册回退现通道（内置版式+R169 主题令牌）。
// ---------------------------------------------------------------------------

/** 决定一页实际使用的版式；hasImage = 有真实配图或已有图示 PNG（与现通道渲染口径一致） */
export function effectiveLayout(s: Slide, hasImage: boolean): SlideLayout {
  if (s.chart && (s.chart.categories?.length ?? 0) > 0) return "chart"
  if (s.kpi && s.kpi.length) return "kpi"
  const l = s.layout ?? "auto"
  if (l === "auto") {
    if (hasImage) return "image-right"
    return "bullets"
  }
  // 显式选了图文版式但没有图，则退回纯要点
  if ((l === "image-right" || l === "image-left" || l === "banner") && !hasImage) return "bullets"
  if (l === "chart" && !(s.chart && (s.chart.categories?.length ?? 0) > 0)) return "bullets"
  if (l === "kpi" && !(s.kpi && s.kpi.length)) return "bullets"
  return l
}

/** 该页能否由保真通道承载：图表/KPI 页仍走现通道；图文页有已解析配图字节即可（附三图文并茂×模板） */
export function isFidelityEligibleSlide(s: Slide, hasResolvedImage = false): boolean {
  if (s.figures?.length) return hasResolvedImage
  if (s.image) return hasResolvedImage
  const lay = effectiveLayout(s, false)
  return lay === "bullets" || lay === "section"
}

/**
 * 把 deck 转成保真 specs（封面/目录/逐页/致谢末页，文案与现通道逐字一致）。
 * images：页序号 → 已解析配图 dataURL（真实配图或 AI 图示渲染 PNG）。
 * 图文页（image/figures）在 map 命中时按「标题+要点+右半栏图」保真页生成；
 * 无页或任一图文页缺配图字节返回 null——调用方按契约走现通道，行为逐字不变。
 */
export function planFidelityExport(
  deck: { deck_name: string; deck_type: string; audience: string; duration_min: number; slides: Slide[] },
  today: string,
  images?: Map<number, { dataUrl: string }>,
): FidelitySlideSpec[] | null {
  const slides = deck.slides ?? []
  if (!slides.length) return null
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i]
    // 图表/KPI 页为结构化数据渲染，保真引擎 v1 不承载 → 整册回退现通道
    const lay = effectiveLayout(s, Boolean(s.image) || (s.figures?.length ?? 0) > 0)
    if (lay === "chart" || lay === "kpi") return null
    const needImg = Boolean(s.image) || (s.figures?.length ?? 0) > 0
    if (needImg && !(images?.has(i) ?? false)) return null
  }
  const metaBits = [deckTypeLabel(deck.deck_type)]
  if (deck.audience) metaBits.push(`汇报对象：${deck.audience}`)
  if (deck.duration_min) metaBits.push(`时长约 ${deck.duration_min} 分钟`)
  const specs: FidelitySlideSpec[] = [
    { title: deck.deck_name || "汇报 PPT", lines: [metaBits.join("  |  "), today] },
    {
      title: "目录",
      lines: slides.map((s, i) => `${String(i + 1).padStart(2, "0")}   ${s.title || `第 ${i + 1} 页`}`),
    },
  ]
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i]
    const notes = s.notes?.trim() || undefined
    const img = images?.get(i)
    if (effectiveLayout(s, Boolean(img) || Boolean(s.image)) === "section" && !img) {
      const sub = (s.bullets ?? []).join("\u3000·\u3000")
      specs.push({ title: s.title || "", lines: sub ? [sub] : [], notes })
      continue
    }
    if (img) {
      // 图文页（附三图文并茂×模板）：标题 + 要点（引擎自动加右内边距避让右侧配图）+ 右半栏配图
      specs.push({
        title: s.title || "",
        lines: (s.bullets ?? []).length ? s.bullets : [s.title || "—"],
        notes,
        image: { base64: img.dataUrl, ext: dataUrlExt(img.dataUrl) },
      })
      continue
    }
    specs.push({ title: s.title || "", lines: (s.bullets ?? []).length ? s.bullets : ["\u2014"], notes })
  }
  specs.push({ title: "谢谢聆听", lines: ["欢迎交流指正"] })
  return specs
}

/** 从 dataURL 提取媒体扩展名（png/jpeg/jpg…）；非 dataURL 返回 png 兜底 */
function dataUrlExt(dataUrl: string): string {
  const m = /^data:image\/(png|jpeg|jpg|gif)/i.exec(dataUrl ?? "")
  if (!m) return "png"
  return m[1].toLowerCase() === "jpg" ? "jpeg" : m[1].toLowerCase()
}

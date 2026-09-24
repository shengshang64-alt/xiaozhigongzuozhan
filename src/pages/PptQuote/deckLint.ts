import type { Slide } from "./pptQuoteTypes"

// ---------------------------------------------------------------------------
// deckLint — PPT 导出前的结构自检（借鉴顶级 pptx skill 的「自校验闭环」思想）
//
// 背景：对 11 个 GitHub 热门 PPT skill 的横评得出头号结论——真正能用的 skill
// 都带一个 render→检查→修正的自校验回路，失败最惨的都是「盲信自己输出」的。
// 浏览器端无法把 .pptx 跑 LibreOffice 渲染回看，故这里做「结构层 lint」：
// 在导出前用确定性规则扫一遍版式/内容，命中「AI 生成幻灯片」常见问题就提示，
// 让用户在下载前就知道哪几页要人工加强，而非导出后打开才发现。
//
// 全部为非阻断告警（不拦截导出），只在 toast 给一句可执行的改进清单。
// ---------------------------------------------------------------------------

export type DeckLintLevel = "warn" | "info"

export interface DeckLintIssue {
  level: DeckLintLevel
  /** 命中的页码（1 基，对应内容页序）；整份 deck 级问题为 0 */
  page: number
  code: string
  msg: string
}

/** 名词标签式标题的常见结尾词（这类标题往往不带结论，建议改写成陈述句） */
const NOUN_TITLE_SUFFIXES = ["背景", "概述", "简介", "介绍", "方案", "架构", "总结", "目录", "附录", "说明", "现状", "需求", "意义", "目标"]

function isImageBearing(s: Slide): boolean {
  return Boolean(s.image || (s.imageHint ?? "").trim() || s.figures?.length)
}

function isVisualDataBearing(s: Slide): boolean {
  return Boolean((s.chart && (s.chart.categories?.length ?? 0) > 0) || (s.kpi && s.kpi.length > 0))
}

/**
 * 扫描一份 deck 的内容页，产出去重后的告警清单（最多 6 条，避免刷屏）。
 * @param slides 内容页数组（不含导出时自动追加的封面/目录/致谢页）
 */
export function lintDeck(slides: Slide[]): DeckLintIssue[] {
  const issues: DeckLintIssue[] = []
  if (!slides.length) return issues

  let visualPages = 0
  let imagePages = 0

  slides.forEach((s, i) => {
    const page = i + 1
    const bullets = (s.bullets ?? []).map((b) => (b ?? "").trim()).filter(Boolean)
    const hasVisual = isVisualDataBearing(s)
    const hasImage = isImageBearing(s)
    if (hasVisual) visualPages += 1
    if (hasImage) imagePages += 1

    // 1) 空页：既无要点又无图表/KPI/配图
    if (!bullets.length && !hasVisual && !hasImage && (s.layout ?? "auto") !== "section") {
      issues.push({ level: "warn", page, code: "empty_page", msg: `第 ${page} 页几乎无内容（无要点/图表/配图），建议删除或补充` })
      return
    }

    // 2) 要点过多：>6 条会压到 14 号字仍显挤
    if (bullets.length > 6) {
      issues.push({ level: "warn", page, code: "too_many_bullets", msg: `第 ${page} 页要点 ${bullets.length} 条偏多，建议精简到 5-6 条或拆页` })
    }

    // 3) 单条要点过长：>44 字导出易换行溢出
    const longOne = bullets.find((b) => b.length > 44)
    if (longOne) {
      issues.push({ level: "info", page, code: "long_bullet", msg: `第 ${page} 页有超长要点（${longOne.length} 字），建议拆成两条短句` })
    }

    // 4) 图表数据不齐：某系列 data 长度与 categories 不一致（原生图表会画错）
    if (s.chart && (s.chart.categories?.length ?? 0) > 0) {
      const bad = (s.chart.series ?? []).find((sr) => (sr.data?.length ?? 0) !== s.chart!.categories.length)
      if (bad) {
        issues.push({ level: "warn", page, code: "chart_len_mismatch", msg: `第 ${page} 页图表数据点数与类目数不一致，导出可能画错，请核对` })
      }
    }

    // 5) 名词标签式标题：建议改成一句结论（Action Title）
    const title = (s.title ?? "").trim()
    if (
      title.length > 0 &&
      title.length <= 8 &&
      NOUN_TITLE_SUFFIXES.some((suf) => title.endsWith(suf)) &&
      (s.layout ?? "auto") !== "section"
    ) {
      issues.push({ level: "info", page, code: "noun_title", msg: `第 ${page} 页标题「${title}」偏名词标签，改成一句结论更有说服力` })
    }
  })

  // 6) 整份层面：图文并茂占比不足（呼应 Anthropic「别让 PPT 只有一堆文字框」）
  if (slides.length >= 4 && visualPages === 0) {
    issues.push({ level: "warn", page: 0, code: "no_visual", msg: "整份没有图表/KPI 页，纯文字观感偏弱，可让 AI 补数据可视化页" })
  }
  if (slides.length >= 6 && imagePages === 0) {
    issues.push({ level: "info", page: 0, code: "no_image", msg: "整份没有配图页，可用「一键配图」补 1-2 张真实场景图" })
  }

  // 去重同类整份问题 + 截断，避免提示刷屏
  const seen = new Set<string>()
  const out: DeckLintIssue[] = []
  for (const it of issues) {
    const key = it.page ? `${it.code}:${it.page}` : it.code
    if (seen.has(key)) continue
    seen.add(key)
    out.push(it)
    if (out.length >= 6) break
  }
  return out
}

/** 把告警清单压成一句给 toast 用的摘要 */
export function lintSummaryText(issues: DeckLintIssue[]): string {
  const warn = issues.filter((i) => i.level === "warn").length
  const info = issues.length - warn
  const bits: string[] = []
  if (warn) bits.push(`${warn} 处需注意`)
  if (info) bits.push(`${info} 处可优化`)
  return bits.join("，") || "未发现结构问题"
}

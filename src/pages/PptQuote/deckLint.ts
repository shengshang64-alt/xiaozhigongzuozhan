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

// R277：模板/占位残留检测——AI 批量生成的幻灯片常漏改模板桩或残留提示语，
// 这些字符串会被原样导出交付给客户。下列均为确定性规则、只报不拦（非阻断契约不变）。
const PLACEHOLDER_KEYWORDS = ["待补充", "待填写", "待完善", "此处填写", "此处输入", "请输入", "点击输入", "占位符", "TODO", "FIXME", "TBD"]
/** 连续 2 个及以上 X/x/Ｘ：典型打码/未替换占位，如 "XX医院""xxx公司" */
const XXX_RUN_RE = /[XＸ]{2,}/
/** 双花括号包裹的模板变量残留，如 {{项目名称}} */
const DOUBLE_BRACE_RE = /\{\{[^{}]{1,40}\}\}/

/** 从一段文本里挑出模板/占位残留片段（去重，找不到返回空数组） */
export function findPlaceholderLeftovers(text: string): string[] {
  if (!text) return []
  const hits: string[] = []
  const lower = text.toLowerCase()
  for (const kw of PLACEHOLDER_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) hits.push(kw)
  }
  const xxx = text.match(XXX_RUN_RE)
  if (xxx) hits.push(xxx[0])
  const brace = text.match(DOUBLE_BRACE_RE)
  if (brace) hits.push(brace[0])
  return Array.from(new Set(hits))
}

/** 标题归一化：去首尾空白、统一大小写、剔除内部所有空白，用于跨页重复标题判定 */
function normalizeTitle(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, "")
}

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
  // R277：模板/占位残留问题单独收集，最终优先展示（导出即漏脸级别，比结构告警更该先看到）
  const placeholderIssues: DeckLintIssue[] = []

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
    // 5a) 内容页缺标题：有正文/图表/配图却没有标题，导出后是「无头」页
    if (title.length === 0 && (s.layout ?? "auto") !== "section" && (bullets.length > 0 || hasVisual || hasImage)) {
      issues.push({ level: "info", page, code: "missing_title", msg: `第 ${page} 页有正文内容却缺少标题，建议补一句结论式标题` })
    }
    if (
      title.length > 0 &&
      title.length <= 8 &&
      NOUN_TITLE_SUFFIXES.some((suf) => title.endsWith(suf)) &&
      (s.layout ?? "auto") !== "section"
    ) {
      issues.push({ level: "info", page, code: "noun_title", msg: `第 ${page} 页标题「${title}」偏名词标签，改成一句结论更有说服力` })
    }

    // 6) R277 模板/占位残留：标题/正文/讲稿里漏改的模板桩（XX医院 / 待补充 / {{项目名}}）会被原样导出
    const leftoverHaystack = [title, ...bullets, (s.notes ?? "").trim()].filter(Boolean)
    const leftoverHits = Array.from(new Set(leftoverHaystack.flatMap(findPlaceholderLeftovers)))
    if (leftoverHits.length) {
      placeholderIssues.push({
        level: "warn",
        page,
        code: "placeholder_leftover",
        msg: `第 ${page} 页残留模板/占位文本（${leftoverHits.slice(0, 3).join("、")}），导出前请替换为真实内容`,
      })
    }
  })

  // 5b) 跨页重复标题：AI 批量生成常见缺陷——多页共用同一标题（忽略分节页与空标题）
  const titlePages = new Map<string, number[]>()
  slides.forEach((s2, i) => {
    if ((s2.layout ?? "auto") === "section") return
    const nt = normalizeTitle(s2.title ?? "")
    if (!nt) return
    const arr = titlePages.get(nt)
    if (arr) arr.push(i + 1)
    else titlePages.set(nt, [i + 1])
  })
  for (const pages of titlePages.values()) {
    if (pages.length >= 2) {
      const dispTitle = (slides[pages[0] - 1]?.title ?? "").trim()
      issues.push({
        level: "warn",
        page: pages[pages.length - 1],
        code: "duplicate_title",
        msg: `标题「${dispTitle}」在第 ${pages.join("、")} 页重复，建议各页给出不同结论`,
      })
    }
  }

  // 6) 整份层面：图文并茂占比不足（呼应 Anthropic「别让 PPT 只有一堆文字框」）
  if (slides.length >= 4 && visualPages === 0) {
    issues.push({ level: "warn", page: 0, code: "no_visual", msg: "整份没有图表/KPI 页，纯文字观感偏弱，可让 AI 补数据可视化页" })
  }
  if (slides.length >= 6 && imagePages === 0) {
    issues.push({ level: "info", page: 0, code: "no_image", msg: "整份没有配图页，可从素材库选图（优先）或用「一键配图」补 1-2 张真实场景图" })
  }

  // 去重同类整份问题 + 截断，避免提示刷屏
  const seen = new Set<string>()
  const out: DeckLintIssue[] = []
  for (const it of placeholderIssues.concat(issues)) {
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
// ---------------------------------------------------------------------------
// R166：编辑期常驻自检的页级聚合（页面列表圆点与自检面板共用，避免两处各算各的）。
// 仍是对 lintDeck 产物的纯整理，非阻断契约不变；同页 warn 优先于 info。
// ---------------------------------------------------------------------------

/** 把自检清单按页聚合：page(0=整份级) -> 该页最高级别。 */
export function groupIssuesByPage(issues: DeckLintIssue[]): Map<number, DeckLintLevel> {
  const byPage = new Map<number, DeckLintLevel>()
  for (const it of issues) {
    const prev = byPage.get(it.page)
    if (!prev || (prev === "info" && it.level === "warn")) byPage.set(it.page, it.level)
  }
  return byPage
}

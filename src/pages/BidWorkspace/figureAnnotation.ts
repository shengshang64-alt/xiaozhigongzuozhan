// ---------------------------------------------------------------------------
// REQ-027（2026-10-17）：截图标注合规检查（F-04 / F-07）
//
// 【依据】用户公司《2026.09.17 投标文件编写规范-完整版》P22：
//   「每张截图前写明【招标要求】和【投标响应】；一个功能点一张截图，不得一张大图涵盖多个功能点」
//   同时 P20/P31/P37 要求评分点对点响应（F-07）。
//
// 【为什么要有这个检查】
// 评标口径是「未提供的证据一律不得分」。截图本身在系统里能查（figure 记录），
// 图注也能查（figure.caption）。但**图前那两行「招标要求 / 投标响应」标记**是纯正文内容，
// 现有任何一个检查器都不看它——bidFigurePrivacy 只管打码与隐私，管不到标注。
// 于是「截图有、标注没有」这种扣分项在交卷前完全隐形。
//
// 【定位】纯本地、零 AI、只报不拦。检查结果进交卷体检/交付清单，不阻断导出。
//
// 【判据设计原则：宁可漏报交人工，也不制造噪声】
//   ① 只对**图位锚点行**及其前文判定，不扫全篇散文；
//   ② 标记允许多种真实写法（【招标要求】/招标要求：/（一）招标要求 等），不要求唯一格式；
//   ③ 「一张图涵盖多个功能点」**无法可靠从文本判定**（需要理解语义），故本模块不做，
//      只在报告里列人工核对项——不假装能判。
//
// 【重要：严重度按真实语料校准，不按"规范怎么写的"】
// 2026-10-17 实测 45 份真实标书 / 804 张截图：
//   图前带【招标要求】标记的 **0 张**，带【投标响应】标记的 **1 张**（0.1%）。
// 结论：F-04 是公司规范的要求，**但现实交付里几乎没人这么写**。
// 若把它做成"缺陷"，用户存量标书会 804 张图全部报错 → 报告立刻失去可信度。
// 故本模块把「缺招标要求/投标响应标注」定为 **advisory（建议级）**，
// 只有「图注缺失」定为 warn（因为图注是导出与排版直接依赖的，且真实标书普遍都有）。
// 这样报告能说实话：这张图建议补标注，但不是错。
// ---------------------------------------------------------------------------

/** 问题严重度：warn=该改；advisory=建议补（规范要求，但真实交付普遍未写，不判错） */
export type FigureAnnotationSeverity = "warn" | "advisory"

/** 图位锚点行（导出器按此插入图片，见 bidFiles.ts：「【图：标题】」） */
const FIGURE_ANCHOR_RE = /^【图[:：](.+?)】$/

/** 「招标要求」类标记：全角方括号、方头括号、冒号、编号前缀都算 */
const TENDER_REQ_MARKERS: RegExp[] = [
  /【\s*招标要求\s*】/,
  /[[［]\s*招标要求\s*[\]］]/,
  /^[\s（(]*(?:招标要求|招标参数|招标条款)\s*[:：]/m,
  /^[\s]*(?:\d+[.、]|[（(][一二三四五六七八九十][)）])\s*招标要求/m,
]

/** 「投标响应」类标记 */
const BID_RESP_MARKERS: RegExp[] = [
  /【\s*投标响应\s*】/,
  /【\s*我方响应\s*】/,
  /【\s*响应内容\s*】/,
  /[[［]\s*(?:投标响应|我方响应|响应内容)\s*[\]］]/,
  /^[\s（(]*(?:投标响应|我方响应|响应内容|响应说明)\s*[:：]/m,
  /^[\s]*(?:\d+[.、]|[（(][一二三四五六七八九十][)）])\s*(?:投标响应|我方响应|响应内容)/m,
]

export type FigureAnnotationIssueKind =
  /** 图前缺【招标要求】标记 */
  | "missing_tender_req"
  /** 图前缺【投标响应】标记 */
  | "missing_bid_resp"
  /** 图注缺失（caption 为空） */
  | "missing_caption"
  /** 图注过长（>60 字，导出会被截断） */
  | "caption_too_long"

export type FigureAnnotationIssue = {
  kind: FigureAnnotationIssueKind
  /** 严重度：缺标注=advisory（真实交付普遍未写，不判错）；缺/超长图注=warn */
  severity: FigureAnnotationSeverity
  /** 图标题（用于界面定位） */
  figureTitle: string
  /** 正文行号（1 起；无图位锚点时为 0） */
  line: number
  /** 人话说明 */
  message: string
  /** 命中位置的正文片段（便于用户找到） */
  excerpt: string
}

export type FigureAnnotationReport = {
  /** 本章图数（按图位锚点行计） */
  figureCount: number
  /** 带齐两行标注的图数 */
  annotatedCount: number
  issues: FigureAnnotationIssue[]
  /** 需处理的图注问题数（warn） */
  warnCount: number
  /** 建议补的标注数（advisory） */
  advisoryCount: number
  /** 人话汇总；无问题时为空串 */
  summary: string
  /** 无法机器判定、必须人工核对的项 */
  manualChecks: string[]
}

/** 前文窗口：图位锚点行之前最多看多少行（真实稿里标注常在锚点前 1-6 行） */
const LOOKBACK_LINES = 8

const hasMarker = (text: string, markers: RegExp[]) => markers.some((re) => re.test(text))

/**
 * 检查一章正文里的截图标注合规性。
 *
 * @param content 章节正文（含「【图：标题】」图位锚点行）
 * @param figures 该章的图记录（用于查 caption）
 */
export function checkFigureAnnotations(
  content: string,
  figures?: { title?: string; caption?: string }[],
): FigureAnnotationReport {
  const src = content ?? ""
  const lines = src.split("\n")
  const figList = figures ?? []
  const captionOf = (title: string) => {
    const hit = figList.find((f) => (f.title ?? "").trim() === title)
    return (hit?.caption ?? "").trim()
  }

  const issues: FigureAnnotationIssue[] = []
  let figureCount = 0
  let annotatedCount = 0

  for (let i = 0; i < lines.length; i++) {
    const m = FIGURE_ANCHOR_RE.exec(lines[i].trim())
    if (!m) continue
    figureCount++
    const title = m[1].trim()

    // 前文窗口（不含锚点行本身）
    const from = Math.max(0, i - LOOKBACK_LINES)
    const before = lines.slice(from, i).join("\n")
    const hasReq = hasMarker(before, TENDER_REQ_MARKERS)
    const hasResp = hasMarker(before, BID_RESP_MARKERS)

    if (hasReq && hasResp) {
      annotatedCount++
    }
    if (!hasReq) {
      issues.push({
        kind: "missing_tender_req",
        severity: "advisory",
        figureTitle: title,
        line: i + 1,
        message: `图「${title}」前未写招标要求：补一行能帮评委对上「这条截图对应哪条要求」（公司规范要求；实测真实标书 804 张图里仅 1 张写了，故列为建议项，不判错）`,
        excerpt: before.split("\n").slice(-2).join(" / ").slice(0, 80),
      })
    }
    if (!hasResp) {
      issues.push({
        kind: "missing_bid_resp",
        severity: "advisory",
        figureTitle: title,
        line: i + 1,
        message: `图「${title}」前未写投标响应：补一行响应结论可避免「只放图不表态」的观感（公司规范要求，列为建议项）`,
        excerpt: before.split("\n").slice(-2).join(" / ").slice(0, 80),
      })
    }

    // 图注：caption 来自图记录，不在正文里。这一项判 warn——
    // 图注是导出与排版的直接依赖（bidFiles 按 caption 插图注行），且真实标书普遍都有。
    const cap = captionOf(title)
    if (!cap) {
      issues.push({
        kind: "missing_caption",
        severity: "warn",
        figureTitle: title,
        line: i + 1,
        message: `图「${title}」没有图注：本项目要求每张图写明「这张图要表达什么」`,
        excerpt: "",
      })
    } else if (cap.length > 60) {
      issues.push({
        kind: "caption_too_long",
        severity: "warn",
        figureTitle: title,
        line: i + 1,
        message: `图「${title}」图注 ${cap.length} 字，超过 60 字会被导出截断`,
        excerpt: cap.slice(0, 40),
      })
    }
  }

  const manualChecks: string[] = []
  if (figureCount > 0) {
    manualChecks.push("一个功能点一张截图：是否有一张大图涵盖多个功能点（需人工看）")
    manualChecks.push("截图风格统一：同一浏览器/分辨率/截图方式，图片大小一致（需人工看）")
    manualChecks.push("截图是否体现其他医院名称或患者关键信息（打码口径见 bidFigurePrivacy）")
  }

  const warnCount = issues.filter((i) => i.severity === "warn").length
  const advisoryCount = issues.filter((i) => i.severity === "advisory").length
  // 汇总只报 warn 为「待补」，advisory 单列为「建议」——不把规范要求说成错，
  // 也不把真缺陷混进建议里（真实标书 804 张图实测支撑该分级）。
  const summary =
    figureCount === 0
      ? ""
      : warnCount === 0 && advisoryCount === 0
        ? `截图标注：${figureCount} 张图全部合规`
        : warnCount === 0
          ? `截图标注：${figureCount} 张图没有图注问题；${advisoryCount} 处缺招标要求/投标响应标注（建议补，非缺陷）`
          : `截图标注：${figureCount} 张图中 ${warnCount} 处图注需处理${advisoryCount ? `；另有 ${advisoryCount} 处缺标注（建议补）` : ""}`

  return { figureCount, annotatedCount, issues, summary, manualChecks, warnCount, advisoryCount }
}

/** 本章是否属于「技术参数 / 功能响应」这类必须配截图的章（用于判断"一张图都没有"是否算问题）
 *
 *  判据刻意收窄：只认「功能 / 界面 / 参数响应 / 系统实现」这类**讲系统怎么用**的章。
 *  「方案」二字不能单独作判据——「售后服务方案」「培训方案」「实施方案」都不需要界面截图，
 *  实测把它算进去会把这三类章全部误报。 */
export function isScreenshotExpectedChapter(title: string): boolean {
  const t = (title ?? "").trim()
  if (!t) return false
  return /技术参数|参数响应|功能|界面|截图|系统实现|技术响应/.test(t)
}

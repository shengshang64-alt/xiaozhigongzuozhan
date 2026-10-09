// ---------------------------------------------------------------------------
// Q28 切片G：编排配图补齐（figure backfill）——纯函数三件套（找缺图 / 出提示词 / 解析校验）+ 图位落位。
// 背景 bug（项目13 实测 2026-10-07）：智能编排按叶选定 35 张配图，而 9 章正文全部 done 后落库配图只有
// 14 张，缺口 21 张。机理是配图只在「小节首块」按 JSON 契约（{"content","figures"}）顺带产出，而这条契约在
// 长文链路里很容易被吃掉：模型对 2000 字块直接返回纯文本（figures 丢失）、mermaid 源码渲染校验失败弃图、
// 断点续跑跳过已产出小节（图随首轮丢失）——三种路径都静默丢图，而且此后再没有任何补图入口（「AI 配图生成」
// 只管编排里 type=ai 的位图，本项目只有 3 张）。暗标技术标按招标要求需 35 张配图，缺 21 张无法交付。
// 这里把「补齐」做成独立可测的纯函数层：编排计划（按叶展开，不用节级合并的那份顶指令映射，详见
// scanOrchestratedFigures 注释）+ 已成稿正文 → 缺图清单 → 单图小请求 → 严格解析校验；执行编排在
// useBidWorkspace.runFigureBackfill（单图单请求、小预算、关思考、解析不出即弃图不污染正文，
// 按章聚合后 append figures，并把每张图按其小节写回图位锚点行）。
// ---------------------------------------------------------------------------

import {
  clipText,
  isBizPart,
  ORCHESTRATION_FIGURE_TYPE_LABEL,
  type BidOrchestration,
  type OrchestrationFigureType,
} from "../bidTypes"
import type { Chapter, FigureSpec, OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

/** 单张补齐图携带的小节正文摘录上限：够模型挑元素，又不把整章正文塞进请求（成本与 TPM 双控） */
export const FIGURE_BACKFILL_EXCERPT_CHARS = 1200

/** 标题命中判定的最短长度：太短的图名（如「架构图」）做包含匹配会误命中，只允许精确等值 */
const TITLE_FUZZY_MIN_CHARS = 4

/** AI 位图型不在补齐范围：它走 aigc 图像链路（「AI 配图生成」入口），不是本地结构化渲染 */
const BACKFILLABLE_TYPES: OrchestrationFigureType[] = ["architecture", "flow", "demo", "mermaid", "gantt"]

export type FigureBackfillPlan = { type: OrchestrationFigureType; title: string; caption?: string }

export type FigureBackfillTarget = {
  nodeId: string
  chapterTitle: string
  sectionTitle: string
  plan: FigureBackfillPlan
  excerpt: string
}

/** 已落库图在正文中的落位计划：图名用库里实际标题（模型可能改写过），才能与导出器的精确匹配对得上 */
export type FigurePlacement = {
  nodeId: string
  chapterTitle: string
  sectionTitle: string
  figureTitle: string
}

const fmt = (s: unknown): string => (typeof s === "string" ? s.trim() : "")

/**
 * 已有配图里挑出满足这张编排图的那一张：图名精确/短包含命中，或图注命中皆可。
 * 生成链路里模型常把 title 改写成同义说法（并由 attachFigureCaptions 把编排图注挂到图上），
 * 只按 title 全等判会重复补图，故补一条 caption 命中口径。
 */
export function findSatisfiedFigure(figures: FigureSpec[] | undefined | null, plan: FigureBackfillPlan): FigureSpec | null {
  const title = fmt(plan.title)
  const caption = fmt(plan.caption)
  if (!title && !caption) return null
  return (
    (figures ?? []).find((f) => {
      const ft = fmt(f?.title)
      const fc = fmt(f?.caption)
      if (title) {
        if (ft === title) return true
        if (ft.length >= TITLE_FUZZY_MIN_CHARS && title.length >= TITLE_FUZZY_MIN_CHARS && (ft.includes(title) || title.includes(ft))) return true
      }
      if (caption && fc && (fc === caption || fc.includes(caption))) return true
      return false
    }) ?? null
  )
}

/** 这张编排图是否已经有落库配图 */
export function isPlanSatisfied(figures: FigureSpec[] | undefined | null, plan: FigureBackfillPlan): boolean {
  return findSatisfiedFigure(figures, plan) !== null
}

/** 摘录锚点候选（优先叶子小标题、回退节标题）：图元素必须从紧邻这张图的正文里取，不取整章 */
function excerptFor(content: string | undefined, anchorTitles: string[]): string {
  const text = content ?? ""
  if (!text) return ""
  let from = 0
  for (const t of anchorTitles) {
    const needle = fmt(t)
    if (!needle) continue
    const idx = text.indexOf(needle)
    if (idx !== -1) {
      from = idx
      break
    }
  }
  return clipText(text.slice(from, from + FIGURE_BACKFILL_EXCERPT_CHARS), FIGURE_BACKFILL_EXCERPT_CHARS)
}

/** 一条「编排选中的图」与其落位坐标（节标题是落锚单位，叶子标题只作摘录锚点） */
type OrchFigureRow = {
  nodeId: string
  chapterTitle: string
  sectionTitle: string
  plan: FigureBackfillPlan
  excerpt: string
  figures: FigureSpec[]
}

/** 节（二级节点）子树内所有「needed 且被全文择优选中」的编排配图，按文档序、图名去重 */
function figurePlansUnderSection(orch: BidOrchestration, sec: OutlineNode): { plan: FigureBackfillPlan; leafTitle: string }[] {
  const out: { plan: FigureBackfillPlan; leafTitle: string }[] = []
  const seen = new Set<string>()
  const walk = (node: OutlineNode): void => {
    const kids = node.children ?? []
    if (!kids.length) {
      const f = orch.leaves[node.id]?.figure
      const title = fmt(f?.title)
      if (f?.needed && f.selected && title && !seen.has(title)) {
        seen.add(title)
        const caption = fmt(f.caption)
        out.push({ plan: { type: f.type, title, ...(caption ? { caption } : {}) }, leafTitle: fmt(node.title) })
      }
      return
    }
    for (const k of kids) walk(k)
  }
  walk(sec)
  return out
}

/**
 * 按「章—节—叶」文档序展开编排里所有选中的配图（叶级粒度）。
 * 为什么不用现成的 sectionOrchestration：那个映射每章/节只取 priority 最高的 1 张（进 prompt 用的顶指令），
 * 而项目13 实测编排是按叶选定的 35 张（同一节下多个三级节点各自选中一张）——走节级合并最多只能回到 26 张，
 * 永远凑不够招标要求的 35 张。补齐阶段必须按叶展开，落锚单位仍用节（正文里能稳定定位的最小单位）。
 */
function scanOrchestratedFigures(
  orch: BidOrchestration | null | undefined,
  outline: OutlineNode[] | null | undefined,
  chapters: Chapter[] | null | undefined,
): OrchFigureRow[] {
  const rows: OrchFigureRow[] = []
  if (!orch?.leaves || !Array.isArray(chapters) || !Array.isArray(outline)) return rows
  for (const ch of chapters) {
    const nodeId = ch?.node_id
    if (!nodeId || isBizPart(ch)) continue
    const chapterNode = outline.find((n) => n.id === nodeId)
    if (!chapterNode?.children?.length) continue
    const figures = ch.figures ?? []
    for (const rawTitle of ch.sections ?? []) {
      const sectionTitle = fmt(rawTitle)
      if (!sectionTitle) continue
      const secNode = chapterNode.children.find((c) => fmt(c.title) === sectionTitle)
      if (!secNode) continue // 节标题在大纲里找不到：无法落锚，与旧口径的 covered=false 一致
      for (const { plan, leafTitle } of figurePlansUnderSection(orch, secNode)) {
        rows.push({
          nodeId,
          chapterTitle: fmt(ch.title),
          sectionTitle,
          plan,
          excerpt: excerptFor(ch.content, [leafTitle, sectionTitle]),
          figures,
        })
      }
    }
  }
  return rows
}

/**
 * 找出「编排已选中、正文里却没有落库」的配图：只统计技术章、只统计本地可渲染图型（AI 位图走生图链路），
 * 同章同图名已在扫描里去重；按章—节—叶文档序返回，末尾的 limit 用于分批试跑。
 */
export function collectFigureBackfillTargets(
  orch: BidOrchestration | null | undefined,
  outline: OutlineNode[] | null | undefined,
  chapters: Chapter[] | null | undefined,
  opts?: { limit?: number },
): FigureBackfillTarget[] {
  const out: FigureBackfillTarget[] = []
  for (const r of scanOrchestratedFigures(orch, outline, chapters)) {
    if (!BACKFILLABLE_TYPES.includes(r.plan.type)) continue
    if (isPlanSatisfied(r.figures, r.plan)) continue
    out.push({ nodeId: r.nodeId, chapterTitle: r.chapterTitle, sectionTitle: r.sectionTitle, plan: r.plan, excerpt: r.excerpt })
    if (opts?.limit && out.length >= opts.limit) return out
  }
  return out
}

/**
 * 找出「编排选中且已经有落库配图」的图位：按章—节—叶文档序返回库内实际图名，供图位锚点落位。
 * 与 collectFigureBackfillTargets 共享同一套叶→节映射与命中口径（两处判据必须一致，否则要么
 * 重复补图、要么补了图却不落位），区别只在 type 过滤：AI 位图同样需要落位，故不限图型。
 */
export function collectFigurePlacements(
  orch: BidOrchestration | null | undefined,
  outline: OutlineNode[] | null | undefined,
  chapters: Chapter[] | null | undefined,
): FigurePlacement[] {
  const out: FigurePlacement[] = []
  for (const r of scanOrchestratedFigures(orch, outline, chapters)) {
    const figureTitle = fmt(findSatisfiedFigure(r.figures, r.plan)?.title)
    if (!figureTitle) continue
    if (out.some((p) => p.nodeId === r.nodeId && p.figureTitle === figureTitle)) continue
    out.push({ nodeId: r.nodeId, chapterTitle: r.chapterTitle, sectionTitle: r.sectionTitle, figureTitle })
  }
  return out
}

/** 各图型的输出契约（与正文生成链路 prompts/bidSection 的同款口径，元素规模收敛到单图小请求） */
function figureFormatRule(type: OrchestrationFigureType): string {
  if (type === "mermaid") {
    return '只输出 {"type":"mermaid","title":"图名","code":"flowchart TD\\n A[\\"节点\\"] --> B[\\"节点\\"]"}；code 只允许 flowchart/graph 声明开头、节点总数 ≤12、每个节点标签 ≤16 字、中文与含特殊字符的标签必须用双引号包裹；'
  }
  if (type === "gantt") {
    return '只输出 {"type":"mermaid","title":"图名","code":"<gantt 源码>"}；code 首行必须是 gantt、第二行 dateFormat YYYY-MM-DD，用 section 把实施阶段分为 2-5 期、每期 1-5 条任务、任务名 ≤16 字；没有日期依据时以 2026-01-01 为示意起点，并在图注末尾加「（进度为示意编排）」；'
  }
  if (type === "architecture") {
    return '只输出 {"type":"architecture","title":"图名","layers":[{"name":"层名","modules":["模块名"]}]}，2-6 层、每层 2-6 个模块；'
  }
  if (type === "flow") {
    return '只输出 {"type":"flow","title":"图名","steps":[{"name":"步骤","desc":"可选说明"}],"branches":["可选分支说明"]}，3-8 个步骤、按执行顺序排列；'
  }
  return '只输出 {"type":"demo","title":"图名","sidebar":["菜单项"],"main":[{"block":"区块名","desc":"可选说明"}]}，侧栏 3-8 项、主区 3-8 个区块；'
}

/** 单图补齐 prompt：system 给图型契约与取材红线，user 给项目/章/节/图注 + 本节正文摘录 */
export function buildFigureBackfillMessages(input: {
  projectName: string
  chapterTitle: string
  sectionTitle: string
  plan: FigureBackfillPlan
  excerpt: string
}): LlmMessage[] {
  const plan = input.plan
  const system = [
    "你是投标文件的章节配图设计师。用户给你一个小节的正文摘录和一张已编排好的配图计划，你只输出这一张配图的结构化 JSON。",
    `配图类型：${ORCHESTRATION_FIGURE_TYPE_LABEL[plan.type]}。${figureFormatRule(plan.type)}`,
    `title 固定用「${plan.title}」；${plan.caption ? `caption 固定用「${plan.caption}」；` : ""}`,
    "图元素必须全部取自给定的正文摘录：模块名/步骤名/菜单项用词与正文一致，禁止泛化占位词（如「模块A」「某某系统」），禁止编造正文没有的数字、指标与承诺。",
    "只输出 JSON 本身：禁止解释文字、禁止 markdown 代码围栏、禁止输出正文。",
  ].join("\n")
  const user = [
    `项目：${input.projectName}`,
    `所属章：${input.chapterTitle}`,
    `所属小节：${input.sectionTitle}`,
    plan.caption ? `图注：${plan.caption}` : "",
    "本节正文摘录（图元素唯一取材范围）：",
    input.excerpt?.trim() || "（摘录为空：只按小节标题组织元素，禁止编造具体数值）",
  ]
    .filter(Boolean)
    .join("\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** 宽松取 JSON 对象：剥掉代码围栏与前后解释，取首个 { 到末个 }（模型不守「只输出 JSON」是常态） */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const t = (text ?? "")
    .trim()
    .replace(/^```[a-zA-Z]*\s*\n?/, "")
    .replace(/```\s*$/, "")
    .trim()
  const start = t.indexOf("{")
  const end = t.lastIndexOf("}")
  if (start === -1 || end <= start) return null
  try {
    const v: unknown = JSON.parse(t.slice(start, end + 1))
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function strList(raw: unknown, max: number): string[] {
  return (Array.isArray(raw) ? raw : [])
    .map((x) => fmt(x))
    .filter(Boolean)
    .slice(0, max)
}

/**
 * 解析并校验单图输出：类型不符、元素不足、代码声明不合法一律弃图（返回 null）。
 * title/caption 以编排计划为准——补齐的目的就是把这张「编排选中的图」按名落库，模型改写会破坏去重判定。
 */
export function parseFigureBackfill(raw: string, plan: FigureBackfillPlan): FigureSpec | null {
  const obj = extractJsonObject(raw)
  if (!obj) return null
  const title = fmt(plan.title)
  if (!title) return null
  const caption = fmt(plan.caption)
  const cap = caption ? { caption } : {}
  if (plan.type === "mermaid" || plan.type === "gantt") {
    const code = fmt(obj.code)
    if (!code) return null
    const head = code.split("\n")[0].trim().toLowerCase()
    if (plan.type === "gantt" ? !head.startsWith("gantt") : !/^(flowchart|graph)\b/.test(head)) return null
    return { type: "mermaid", title, code, ...cap }
  }
  if (plan.type === "architecture") {
    const layers = (Array.isArray(obj.layers) ? obj.layers : [])
      .map((x) => {
        const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
        return { name: fmt(o.name), modules: strList(o.modules, 6) }
      })
      .filter((l) => l.name && l.modules.length >= 2)
      .slice(0, 6)
    if (layers.length < 2) return null
    return { type: "architecture", title, layers, ...cap }
  }
  if (plan.type === "flow") {
    const steps = (Array.isArray(obj.steps) ? obj.steps : [])
      .map((x) => {
        const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
        const desc = fmt(o.desc)
        return { name: fmt(o.name), ...(desc ? { desc } : {}) }
      })
      .filter((s) => s.name)
      .slice(0, 8)
    if (steps.length < 3) return null
    const branches = strList(obj.branches, 4)
    return { type: "flow", title, steps, ...(branches.length ? { branches } : {}), ...cap }
  }
  // demo：界面示意——主区块是图的主体，只有侧栏没有主区时视为不合格
  const main = (Array.isArray(obj.main) ? obj.main : [])
    .map((x) => {
      const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
      const desc = fmt(o.desc)
      return { block: fmt(o.block ?? o.name), ...(desc ? { desc } : {}) }
    })
    .filter((m) => m.block)
    .slice(0, 8)
  const sidebar = strList(obj.sidebar, 8)
  if (main.length < 2) return null
  return { type: "demo", title, ...(sidebar.length ? { sidebar } : {}), main, ...cap }
}

// ---------------------------------------------------------------------------
// 图位锚点：把「哪张图属于哪个小节」写回正文，让导出时图落在本节末尾
// 背景（2026-10-07 实测）：导出器 bidFiles 早就支持正文行「【图：标题】」作为插入位（按标题精确匹配、
// 每图一次），但生成链路从未写过这种行——于是所有配图都回落到「本章首个正文段之后」集中堆放：一章 3-5 张图
// 全挤在章开头，对 150 页暗标技术标是不可交付的版式。补齐阶段顺手落位（幂等、只插入标记行、不动一字正文）。
// ---------------------------------------------------------------------------

/** 图位锚点行（与 bidFiles 的 /^【图[:：](.+?)】$/ 口径一致） */
export function figureAnchorLine(figureTitle: string): string {
  return `【图：${fmt(figureTitle)}】`
}

/**
 * 行是否小节标题行：去掉「3.1 」式编号前缀后以节名开头，且行长不超节名 +20 字
 * （正文句子偶尔以节名开头，靠长度上限排除）；命中时返回对应的小节名。
 */
function headingSectionOf(line: string, sections: string[]): string | null {
  const t = line.trim()
  if (!t) return null
  const stripped = t.replace(/^\d+(?:[.．]\d+)*[.、．]?\s*/, "")
  for (const raw of sections) {
    const s = fmt(raw)
    if (!s) continue
    if (stripped.startsWith(s) && stripped.length <= s.length + 20) return s
  }
  return null
}

/** 本节块的结束位置（下一个小节标题行之前；本节是最后一节时为文末） */
function sectionBlockEnd(lines: string[], sections: string[], sectionTitle: string): number {
  const needle = fmt(sectionTitle)
  const start = lines.findIndex((l) => headingSectionOf(l, sections) === needle)
  if (start === -1) return -1
  for (let i = start + 1; i < lines.length; i++) {
    const hit = headingSectionOf(lines[i], sections)
    if (hit && hit !== needle) return i
  }
  return lines.length
}

/**
 * 在正文里为每张图补上所在小节的图位锚点行（幂等：同名锚点已存在则不重复插）。
 * 只插入独立成行的标记，不修改/删除任何既有行；标题空或找不到本节的插不到文末。
 */
export function applyFigureAnchors(content: string, sections: string[], placements: FigurePlacement[]): string {
  const text = content ?? ""
  if (!text.trim() || !placements.length) return text
  const lines = text.split("\n")
  const secList = (sections ?? []).map((s) => fmt(s)).filter(Boolean)
  // 同图名只锚一次（导出器每图一次），倒序插入避免索引漂移
  const seen = new Set<string>()
  const jobs = placements
    .map((p) => {
      const title = fmt(p.figureTitle)
      const at = sectionBlockEnd(lines, secList, p.sectionTitle)
      return { ...p, figureTitle: title, at }
    })
    .filter((p) => p.figureTitle && p.at >= 0)
    .sort((a, b) => b.at - a.at)
  for (const job of jobs) {
    if (seen.has(job.figureTitle)) continue
    seen.add(job.figureTitle)
    const marker = figureAnchorLine(job.figureTitle)
    if (lines.some((l) => l.trim() === marker)) continue
    const add = [marker, ""]
    if (job.at > 0 && lines[job.at - 1].trim()) add.unshift("")
    lines.splice(job.at, 0, ...add)
  }
  return lines.join("\n")
}

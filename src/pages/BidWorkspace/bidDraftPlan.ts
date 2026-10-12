// ---------------------------------------------------------------------------
// R245 切片（bidkit-plan-slice3 底稿增量合并 · 落库口径纯逻辑）
// 用户 P0 需求 R-001 的第二片：R235 把「大纲↔底稿」的匹配与动作决策钉成了纯内核（bidDraftMerge.ts），
// 本片把决策落到真实数据形态——
//  1) 原文保留的章（商务 / 架构类命中底稿）：底稿正文直接写入该章、标记为「底稿保留」，逐章生成天然跳过
//     （批量生成只跑 gen_status!=="done" 的章，零改批量逻辑）；已有正文的章一律不覆盖，改转参考材料。
//  2) 以底稿为参考重写的章（技术 / 偏离命中）：底稿原文写进既有的 ref_materials_text 通道——第十七轮 17D
//     的按标题本地检索注入会在逐章生成时命中该段，所以「带入底稿作参考」零提示词改动、零新字段。
//  3) 底稿多出、大纲未认领的章：幂等追加为商务章（part=biz 不参与 AI 生成，随全套导出原样保留）。
// 全部效果落在既有 json 列（bid_chapters / ref_materials_text）内：零 collection、零 pb_hooks、零迁移。
// 纯函数、零 DOM、零副作用，可脱离浏览器单测；mammoth / pdf 的读取在 bidDraftImport.ts。
// Author: loop-R245
// ---------------------------------------------------------------------------
import type { Chapter, OutlineNode } from "../SolutionStudio/solutionTypes"
import type { DraftChapter, DraftMergePlan, OutlineKind, OutlineTarget } from "./bidDraftMerge"
import { buildMergePlan } from "./bidDraftMerge"

/** 参考段标记：重复应用合并计划时整段替换，杜绝同一底稿叠加多份 */
export const DRAFT_REF_OPEN = "【底稿参考】"
export const DRAFT_REF_CLOSE = "【/底稿参考】"
export const DRAFT_REF_HEAD = "【底稿参考·"

// 单条参考段落上限：ref_materials 注入侧按段检索（≤3 段 / ≤1200 字），此处只保证「标题命中 + 开头要点」
const REF_LINE_CAP = 900
const REF_MAX_ENTRIES = 24
// 纯文本底稿切章上限与标题行长度上限（防止把整段正文当标题）
const DRAFT_MAX_CHAPTERS = 200
const HEADING_MAX_LEN = 40

/** 大纲章 → 匹配用的内容类型（决定命中后的动作）：偏离表 / 商务骨架 / 架构类 / 技术 */
export function kindForChapter(item: { part?: string; title?: string }): OutlineKind {
  const title = (item.title ?? "").trim()
  if (/偏离|偏差/.test(title)) return "deviation"
  if (item.part === "biz") return "business"
  if (/架构|总体设计|总体方案|技术路线/.test(title)) return "architecture"
  return "technical"
}

/** 章节清单 → 匹配目标（按章顺序，先到先得） */
export function buildOutlineTargets(
  chapters: { node_id: string; title: string; part?: string }[],
): OutlineTarget[] {
  return (chapters ?? []).map((c) => ({ id: c.node_id, title: c.title, kind: kindForChapter(c) }))
}

/** 项目章节清单 + 已解析底稿 → 合并计划（薄封装，UI 侧一个调用即可） */
export function planForChapters(
  chapters: { node_id: string; title: string; part?: string }[],
  drafts: DraftChapter[],
): DraftMergePlan {
  return buildMergePlan(buildOutlineTargets(chapters), drafts)
}

/** 剥离既有底稿参考段（无标记原样返回；用于「重复应用只留最新一份」） */
export function stripDraftRefBlock(text: string): string {
  const raw = (text ?? "").replace(/\r\n/g, "\n")
  if (!raw.trim()) return ""
  if (!raw.includes(DRAFT_REF_OPEN)) return raw.trim()
  return raw
    .replace(/(?:^|\n)[ \t]*【底稿参考】[\s\S]*?【\/底稿参考】/g, "")
    .replace(/^\n+/, "")
    .trim()
}

/** 标题去噪后取二元组，用于参考段要点选取时的标题命中打分 */
function refTitleBigrams(title: string): string[] {
  const t = (title ?? "").replace(/[\s\u3000【】()（）0-9０-９一二三四五六七八九十第章节篇部、.．]/g, "")
  const out: string[] = []
  for (let i = 0; i < t.length - 1; i++) out.push(t[i] + t[i + 1])
  return out
}

/** 按句末标点切句并保留标点；无标点则整段为一句 */
function splitRefSentences(flat: string): string[] {
  const res: string[] = []
  let cur = ""
  for (const c of flat) {
    cur += c
    if (c === "。" || c === "；" || c === "！" || c === "？" || c === ";" || c === "!" || c === "?") {
      res.push(cur)
      cur = ""
    }
  }
  if (cur) res.push(cur)
  return res
}

/**
 * 参考段要点选取（R246）：正文超上限时不再机械截断开头，而是「首句 + 标题命中句 + 量化承诺句」
 * 按原文顺序拼到上限——既保开头语境，又留住质保/工期/响应时长/数量等可核对承诺，被略去的段落以省略号示意。
 */
function selectRefExcerpt(title: string, body: string, cap: number): string {
  const flat = (body ?? "").replace(/\s+/g, " ").trim()
  if (flat.length <= cap) return flat
  const sentences = splitRefSentences(flat)
  if (sentences.length <= 1) return `${flat.slice(0, cap)}…`
  const tb = refTitleBigrams(title)
  const isQuant = (s: string) =>
    /\d/.test(s) &&
    /(万|亿|%|％|年|月|日|台|套|人|次|承诺|工期|质保|免费|培训|交付|上线|响应|分钟|小时|驻场|SLA)/.test(s)
  const score = (s: string) => {
    let sc = 0
    for (const b of tb) if (s.includes(b)) sc += 1
    if (isQuant(s)) sc += 2
    return sc
  }
  const out: string[] = []
  let used = 0
  let truncated = false
  sentences.forEach((s, i) => {
    if (i === 0) {
      if (used + s.length > cap) {
        out.push(s.slice(0, cap - used))
        truncated = true
      } else {
        out.push(s)
        used += s.length
      }
      return
    }
    if (score(s) <= 0 || used + s.length > cap) {
      truncated = true
      return
    }
    out.push(s)
    used += s.length
  })
  const text = out.join("").trim()
  return truncated ? `${text}…` : text
}

/**
 * 渲染底稿参考段：每条压成单行「【底稿参考·章标题】正文开头要点」，逐行间空行分隔——
 * ref_materials_text 的检索按空行切段且丢弃 <40 字段落，故标题前缀保证与本章标题的 bigram 重叠命中。
 * 空入参返回空串（调用方不写入）。
 */
export function renderDraftRefBlock(entries: { title: string; content: string }[]): string {
  const lines: string[] = []
  for (const e of entries ?? []) {
    if (lines.length >= REF_MAX_ENTRIES) break
    const title = (e.title ?? "").replace(/\s+/g, "").trim()
    const body = (e.content ?? "").replace(/\s+/g, " ").trim()
    if (!body) continue
    const cut = selectRefExcerpt(e.title, e.content, REF_LINE_CAP)
    const head = title ? `${DRAFT_REF_HEAD}${title}】` : `${DRAFT_REF_HEAD}未命名章】`
    lines.push(head + cut)
  }
  if (!lines.length) return ""
  return [DRAFT_REF_OPEN, ...lines, DRAFT_REF_CLOSE].join("\n\n")
}

/** 标题行判定：编号形态 + 长度上限 + 句末不含标点；返回层级（1 顶层 / 2 二级 / 3 三级），非标题返回 null */
function matchHeadingLine(line: string): { title: string; level: number } | null {
  const s = line.trim()
  if (s.length < 2 || s.length > HEADING_MAX_LEN) return null
  if (/[。；，,；:：]$/.test(s)) return null
  if (/^第[0-9一二三四五六七八九十百千]+[章节篇部]/.test(s)) return { title: s, level: 1 }
  const arab = /^([0-9]+(?:\.[0-9]+){0,2})[ 、.．]/.exec(s)
  if (arab) return { title: s, level: Math.min(3, arab[1].split(".").length) }
  if (/^[一二三四五六七八九十]+[、.．]/.test(s)) return { title: s, level: 1 }
  if (/^[（(][0-9一二三四五六七八九十]+[）)]/.test(s)) return { title: s, level: 2 }
  return null
}

/**
 * 纯文本底稿（txt / md / pdf 抽取流）切章：按编号标题行切段，标题与 R235 的 h1/h2 口径同位。
 * 无任何标题时整篇作为单章返回（调用方仍能看到「未命中 → 自动生成」的计划）；空输入返回空数组。
 */
export function parseDraftPlainText(text: string): DraftChapter[] {
  const src = (text ?? "").replace(/\r\n/g, "\n")
  if (!src.trim()) return []
  const lines = src.split("\n")
  const heads: { idx: number; title: string; level: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const h = matchHeadingLine(lines[i])
    if (!h) continue
    heads.push({ idx: i, ...h })
    if (heads.length >= DRAFT_MAX_CHAPTERS) break
  }
  if (!heads.length) {
    const body = src.trim()
    return body ? [{ title: "", content: body }] : []
  }
  const chapters: DraftChapter[] = []
  for (let i = 0; i < heads.length; i++) {
    const from = heads[i].idx + 1
    const to = i + 1 < heads.length ? heads[i + 1].idx : lines.length
    chapters.push({
      title: heads[i].title,
      level: heads[i].level,
      content: lines.slice(from, to).join("\n").trim(),
    })
  }
  return chapters
}

export type DraftApplySummary = {
  /** 底稿原文写入正文并标记保留的章数 */
  kept: number
  /** 转为参考材料、正文仍交 AI 重写的章数 */
  referenced: number
  /** 已有正文、受保护未被底稿覆盖（改转参考材料）的章数 */
  protectedFilled: number
  /** 追加的「底稿多出章」数 */
  appended: number
  /** 折叠进所属章（不独立成章）的子节数，如 Word「标题 2」小节 */
  folded: number
  /** 本次重新应用时被清退的上一轮孤儿「底稿多出章」数（换用更短底稿后不再存在的追加章） */
  pruned: number
}

export type DraftApplyInput = {
  chapters: Chapter[]
  outline: OutlineNode[]
  plan: DraftMergePlan
  drafts: DraftChapter[]
  /** 是否追加底稿中大纲未认领的章（缺省 true） */
  appendExtras?: boolean
}

export type DraftApplyOutput = {
  chapters: Chapter[]
  outline: OutlineNode[]
  /** 写入 ref_materials_text 的参考段（空串表示无需写入） */
  refAppendix: string
  summary: DraftApplySummary
}

/**
 * 上层章回指：给定底稿章下标，向前找最近的一层更浅标题（Word「标题 1」/ 一级编号行）。
 * 顶层章（level 缺省或 1）返回 -1；同级或更深的前面没有更浅标题时同样返回 -1。
 */
export function parentIndexOfDraft(drafts: DraftChapter[], idx: number): number {
  const lv = drafts[idx]?.level ?? 1
  if (lv <= 1) return -1
  for (let j = idx - 1; j >= 0; j--) {
    if ((drafts[j]?.level ?? 1) < lv) return j
  }
  return -1
}

/**
 * 预演「底稿多出」的真实落地清单：把子节（level>=2）与真正需要独立成章的顶层章分开。
 * 商务同事的标书普遍是「章 + 节」两级标题，小节若不折叠会冒充一章：既虚增「底稿多出」，
 * 又把父章正文拆走。判据是父章是否已有去处——被大纲认领（落正文或转参考段）或本身将被追加。
 */
export function previewExtras(drafts: DraftChapter[], plan: DraftMergePlan): { append: number[]; folded: number[] } {
  const claimed = new Set<number>()
  for (const it of plan.items ?? []) {
    if (it.matchedDraftIndex == null) continue
    if (it.action === "generate-missing" || it.action === "append-deviation") continue
    claimed.add(it.matchedDraftIndex)
  }
  const append: number[] = []
  const folded: number[] = []
  const settled = new Set<number>()
  for (const idx of plan.extras ?? []) {
    const d = drafts[idx]
    if (!d || !(d.content ?? "").trim()) continue
    const parent = parentIndexOfDraft(drafts, idx)
    if (parent >= 0 && (claimed.has(parent) || settled.has(parent))) folded.push(idx)
    else append.push(idx)
    settled.add(idx)
  }
  return { append, folded }
}

/**
 * 应用合并计划：产出下一份章节清单 / 大纲 / 参考段。纯函数，不改动入参。
 * 保守底线：任何既有正文都不被删除（keep-draft 遇已有正文改走参考通道）。
 */
export function applyMergePlan(input: DraftApplyInput): DraftApplyOutput {
  const next = (input.chapters ?? []).slice()
  const refEntries: { title: string; content: string }[] = []
  const summary: DraftApplySummary = { kept: 0, referenced: 0, protectedFilled: 0, appended: 0, folded: 0, pruned: 0 }
  /** 底稿章落点（章节位置或参考段下标），供其子节折叠时把正文接回所属章 */
  const targets = new Map<number, { pos?: number; refIdx?: number }>()
  for (const it of input.plan.items ?? []) {
    const idx = it.matchedDraftIndex
    if (idx == null) continue
    const draft = input.drafts[idx]
    if (!draft) continue
    const pos = next.findIndex((c) => c.node_id === it.outlineId)
    if (pos < 0) continue
    const ch = next[pos]
    if (it.action === "keep-draft") {
      if ((ch.content ?? "").trim()) {
        // 已有正文（可能已 AI 生成或人工补写）：底稿不得覆盖，转为该章参考材料
        refEntries.push({ title: ch.title, content: draft.content })
        targets.set(idx, { refIdx: refEntries.length - 1 })
        summary.protectedFilled += 1
        continue
      }
      next[pos] = {
        ...ch,
        content: draft.content,
        gen_status: "done",
        draftLocked: true,
        draftFrom: (draft.title || ch.title).trim(),
      }
      targets.set(idx, { pos })
      summary.kept += 1
    } else if (it.action === "draft-as-reference") {
      refEntries.push({ title: ch.title, content: draft.content })
      targets.set(idx, { refIdx: refEntries.length - 1 })
      summary.referenced += 1
    }
  }
  const outlineNext = (input.outline ?? []).slice()
  /** 本轮真实落地的「底稿多出章」id 集合，供清退上一轮孤儿章时比对 */
  const keptExtraIds = new Set<string>()
  /** 独立落成一张「底稿多出章」，返回其 node_id；正文为空则跳过 */
  const appendExtraChapter = (idx: number): string | null => {
    const draft = input.drafts[idx]
    if (!draft || !(draft.content ?? "").trim()) return null
    const title = (draft.title ?? "").trim() || `底稿章节 ${idx + 1}`
    const id = `draft-extra-${idx + 1}`
    const chapter: Chapter = {
      node_id: id,
      title,
      sections: [],
      content: draft.content,
      gen_status: "done",
      part: "biz",
      draftLocked: true,
      draftFrom: title,
    }
    const pos = next.findIndex((c) => c.node_id === id)
    if (pos >= 0) next[pos] = { ...next[pos], ...chapter } // 幂等：重复应用只刷新内容
    else next.push(chapter)
    if (!outlineNext.some((n) => n.id === id)) outlineNext.push({ id, title, children: [], part: "biz" })
    summary.appended += 1
    keptExtraIds.add(id)
    return id
  }
  const extraIdByDraft = new Map<number, string>()
  const { append, folded } = previewExtras(input.drafts, input.plan)
  if (input.appendExtras !== false) {
    for (const idx of append) {
      const id = appendExtraChapter(idx)
      if (id) extraIdByDraft.set(idx, id)
    }
  }
  /** 子节按「小标题 + 正文」原样接到所属章尾部：一个字都不丢，但不再冒充独立章 */
  for (const idx of folded) {
    const draft = input.drafts[idx]
    const head = (draft.title ?? "").trim()
    const body = (draft.content ?? "").trim()
    const parent = parentIndexOfDraft(input.drafts, idx)
    const parentId = parent >= 0 ? extraIdByDraft.get(parent) : undefined
    const target = parent >= 0 ? targets.get(parent) : undefined
    const parentPos = parentId ? next.findIndex((c) => c.node_id === parentId) : -1
    if (parentPos >= 0) {
      next[parentPos] = { ...next[parentPos], content: `${next[parentPos].content ?? ""}\n\n${head ? `${head}\n` : ""}${body}` }
      summary.folded += 1
    } else if (target?.refIdx != null) {
      const e = refEntries[target.refIdx]
      refEntries[target.refIdx] = { ...e, content: `${e.content}\n\n${head ? `${head}\n` : ""}${body}` }
      summary.folded += 1
    } else if (target?.pos != null) {
      next[target.pos] = { ...next[target.pos], content: `${next[target.pos].content ?? ""}\n\n${head ? `${head}\n` : ""}${body}` }
      summary.folded += 1
    } else if (input.appendExtras !== false) {
      // 兜底：所属章没落地（大纲节点缺失等），子节仍独立成章，正文不丢
      appendExtraChapter(idx)
    }
  }
  // R246 清退上一轮遗留的孤儿「底稿多出章」：换用更短底稿重新应用时，上一轮追加、本轮已不存在的追加章
  // 不会被同名幂等覆盖而一直残留。只动仍标记底稿保留的 draft-extra 追加章（用户手动解标记 / 改归属的不碰）；
  // appendExtras=false 视为「只重匹配、不新增追加」，保留既有追加章不清退。
  if (input.appendExtras !== false) {
    const orphanIds = new Set(
      next
        .filter((c) => c.node_id.startsWith("draft-extra-") && c.draftLocked === true && !keptExtraIds.has(c.node_id))
        .map((c) => c.node_id),
    )
    if (orphanIds.size) {
      for (let i = next.length - 1; i >= 0; i--) if (orphanIds.has(next[i].node_id)) next.splice(i, 1)
      for (let i = outlineNext.length - 1; i >= 0; i--) if (orphanIds.has(outlineNext[i].id)) outlineNext.splice(i, 1)
      summary.pruned = orphanIds.size
    }
  }
  return {
    chapters: next,
    outline: outlineNext,
    refAppendix: renderDraftRefBlock(refEntries),
    summary,
  }
}

/** 被底稿保留的章（面板展示 + 一键交 AI 重写入口） */
export function draftKeptChapters(chapters: Chapter[]): Chapter[] {
  return (chapters ?? []).filter((c) => c.draftLocked === true)
}

/**
 * 解除某章的底稿保留：正文原样保留，标记清除、gen_status 复位 pending——
 * 下次逐章生成会按大纲覆盖该章正文（不做破坏性清空，误点可回退）。
 * R245 实机自测发现交互断链：「底稿多出章」按 part=biz 追加，而商务骨架章不生成正文，
 * 只解除标记的话这章永远不会被 AI 重写，按钮与提示都在说谎。故显式点「交 AI 重写」时
 * 把这章连同大纲节点一起切成技术章（当前内容范围为「仅商务」时商务章本就是生成目标，
 * 保持原 part 不动）；part 切换必须与大纲同步落地才有意义，故仅在调用方给出 outline 时才切，
 * 未给 outline 的调用保持旧语义（只解标记）。切换结果回传 UI 如实提示，用户可再手动切回商务骨架章。
 */
export function releaseDraftChapter(
  chapters: Chapter[],
  nodeId: string,
  opts?: { outline?: OutlineNode[]; scope?: "biz" | "tech" | "both" },
): { chapters: Chapter[]; outline: OutlineNode[]; partFlipped: boolean } {
  const target = (chapters ?? []).find((c) => c.node_id === nodeId)
  const flip = opts?.outline != null && opts?.scope !== "biz" && target?.part === "biz"
  const next = (chapters ?? []).map((c) =>
    c.node_id === nodeId
      ? {
          ...c,
          draftLocked: false,
          draftFrom: undefined,
          gen_status: "pending" as const,
          ...(flip ? { part: "tech" as const } : null),
        }
      : c,
  )
  const outline = flip && opts?.outline ? opts.outline.map((n) => (n.id === nodeId ? { ...n, part: "tech" as const } : n)) : (opts?.outline ?? [])
  return { chapters: next, outline, partFlipped: flip }
}

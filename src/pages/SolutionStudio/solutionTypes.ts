import type { LlmMessage } from "@/lib/llm"
import { extractJsonCandidate, parseJsonTolerant } from "@/lib/jsonTolerant"

// ---------------------------------------------------------------------------
// 方案编制页：领域类型、常量与 LLM prompt 构造（Logic 层专用，无 JSX）
// ---------------------------------------------------------------------------

export type SolutionTypeKey = "planning" | "feasibility" | "preliminary" | "custom" | "standard"

/**
 * 标书第十三轮：顶层章归属标记（biz=商务部分骨架章，只列小节不生成正文；tech=技术部分详细章）。
 * 仅顶层节点有意义；方案编制页不写 part（视为无归属），标书页无 part 一律按 tech 处理（存量兼容）。
 */
export type OutlinePart = "biz" | "tech"

export type OutlineNode = { id: string; title: string; children: OutlineNode[]; part?: OutlinePart; /** R31：叶节点承接评分编号，如 "[响应:R1,R3]" */ description?: string; /** R-020：与 part 解耦的必写标记（评分办法/技术关键词/★▲/要求性表述命中即必写） */ mustWrite?: boolean; /** R-023：章节来源（tender=招标目录原文命中 / scoring=技术评分项派生） */ origin?: "tender" | "scoring" }

export type ChapterGenStatus = "pending" | "generating" | "done" | "failed"

/** 章节配图结构化数据（标书工作页生成；方案编制页不使用，可选字段不破坏既有接口） */
export type FigureSpec =
  | { type: "architecture"; title: string; layers: { name: string; modules: string[] }[]; caption?: string }
  | { type: "flow"; title: string; steps: { name: string; desc?: string }[]; branches?: string[]; caption?: string }
  | { type: "demo"; title: string; sidebar?: string[]; main?: { block: string; desc?: string }[]; caption?: string }
  /** T16：mermaid 源码图（流程/层级/职责类关系图；code 经 sanitizeMermaidCode 净化与渲染校验，修复失败弃图） */
  | { type: "mermaid"; title: string; code: string; caption?: string }
  /** T17：AI 位图（补图阶段经 RunningHub aigc 生成，url 已 persistMediaUrl 落 PocketBase；prompt 留存供重生成） */
  | { type: "image"; title: string; url: string; prompt?: string; caption?: string }

export type Chapter = {
  node_id: string
  title: string
  sections: string[]
  content: string
  gen_status: ChapterGenStatus
  figures?: FigureSpec[]
  /** 轮次 E-4：章节自检评分结果（随 chapters json 持久化） */
  selfCheck?: ChapterSelfCheck
  /** 第十轮修复 3：成稿字数低于预算 60% 的「偏短」标记（标书工作台写入，随 chapters json 持久化；扩写达标后清除） */
  underlength?: boolean
  /** 标书第十三轮：章归属（biz=商务骨架章不生成正文；缺省/tech=技术章，存量项目无此字段按 tech 工作） */
  part?: OutlinePart
  /** 标书第十五轮改造 2：小节级生成统计（与 sections 顺序一致；chars=0 表示该小节未产出；仅小节串行生成写入，存量章节无此字段） */
  section_stats?: { title: string; chars: number }[]
  /** R245 底稿增量合并：正文取自商务同事底稿原文并标记保留（逐章生成跳过；交回 AI 重写时清除）。随 chapters json 持久化，零 collection 变更 */
  draftLocked?: boolean
  /** R245：底稿原文的章标题，用于溯源展示（仅 draftLocked 章有） */
  draftFrom?: string
}

// ---------------------------------------------------------------------------
// 章节自检评分（轮次 E-4）
// ---------------------------------------------------------------------------

export type ChapterReviewVerdict = "direct" | "review" | "blocked"

export type ChapterReviewIssue = {
  dim: string
  problem: string
  suggestion: string
}

export type ChapterReviewScores = {
  coverage: number
  logic: number
  evidence: number
  feasibility: number
  writing: number
}

export type ChapterSelfCheck = {
  scores: ChapterReviewScores
  total: number
  verdict: ChapterReviewVerdict
  issues: ChapterReviewIssue[]
  checked_at: string
}

export const REVIEW_DIMS: { key: keyof ChapterReviewScores; label: string }[] = [
  { key: "coverage", label: "需求覆盖" },
  { key: "logic", label: "逻辑结构" },
  { key: "evidence", label: "数据与案例支撑" },
  { key: "feasibility", label: "落地可行性" },
  { key: "writing", label: "文字规范" },
]

export const VERDICT_LABEL: Record<ChapterReviewVerdict, string> = {
  direct: "可直接采用",
  review: "建议微调",
  blocked: "建议重写",
}

/** total≥85 direct / 70-84 review / <70 blocked（以规则重算为准，不信 LLM 自报） */
export function verdictFromTotal(total: number): ChapterReviewVerdict {
  if (total >= 85) return "direct"
  if (total >= 70) return "review"
  return "blocked"
}

function clampScore(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(20, Math.round(n)))
}

/** 容错解析自检 JSON：剥围栏、截取首个 { 到末个 }；解析失败返回 null（调用方重试一次） */
export function parseChapterReview(text: string): Omit<ChapterSelfCheck, "checked_at"> | null {
  let t = (text ?? "").trim()
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()
  const start = t.indexOf("{")
  const end = t.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const rec = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>
    const rawScores = (rec.scores ?? {}) as Record<string, unknown>
    const scores: ChapterReviewScores = {
      coverage: clampScore(rawScores.coverage),
      logic: clampScore(rawScores.logic),
      evidence: clampScore(rawScores.evidence),
      feasibility: clampScore(rawScores.feasibility),
      writing: clampScore(rawScores.writing),
    }
    const total = scores.coverage + scores.logic + scores.evidence + scores.feasibility + scores.writing
    const rawIssues = Array.isArray(rec.issues) ? rec.issues : []
    const issues: ChapterReviewIssue[] = []
    for (const item of rawIssues) {
      if (!item || typeof item !== "object") continue
      const r = item as Record<string, unknown>
      const problem = String(r.problem ?? "").trim()
      if (!problem) continue
      issues.push({
        dim: String(r.dim ?? "").trim() || "综合",
        problem,
        suggestion: String(r.suggestion ?? "").trim(),
      })
    }
    return { scores, total, verdict: verdictFromTotal(total), issues }
  } catch {
    return null
  }
}

export type DocStatus = "outline" | "generating" | "partial" | "done"

export type HospitalInfo = {
  hospital_level: string
  bed_scale: string
  outpatient_scale: string
  demand_departments: string
  systems: string[]
  budget_range: string
  special_requirements: string
  ref_checklist_id?: string
  ref_checklist_snapshot?: ChecklistSnapshot
}

/** 关联建设清单快照（随方案保存，注入大纲与逐章 prompt 作为建设范围） */
export type ChecklistSnapshot = {
  checklist_id: string
  checklist_name: string
  rating_targets: string[]
  company_systems: string[]
  external_systems: string[]
  /** R150：未经产品匹配的客户需求条目（module_name+module_func），保证未匹配清单的建设范围也能进大纲/正文 prompt */
  customer_requirements?: string[]
}

const RATING_SHORT: Record<string, string> = {
  emr: "电子病历",
  hpc: "互联互通",
  ss: "智慧服务",
  sm: "智慧管理",
}

/** "emr:5" → 「电子病历 5 级」，供 prompt 与展示复用 */
export function formatTargetCodes(codes: string[]): string {
  return (codes ?? [])
    .map((code) => {
      const [groupKey, level] = code.split(":")
      const short = RATING_SHORT[groupKey] ?? groupKey
      return level ? `${short} ${level} 级` : short
    })
    .join("、")
}

// ---------------------------------------------------------------------------
// R155（闭环 r150-outline-consulting-gap 残余）：客户建设需求条目的章级路由。
// 大纲 8-12 章约束下几十条系统清单逐字进标题存在天花板（R150 实测约 35%），
// 正文级改为按章/节标题与条目名的双向包含匹配，把条目分派到对应章的 prompt。
// ---------------------------------------------------------------------------

/** 匹配用泛词表：章/节标题去泛词后只留具辨识度的名称段；刻意不含服务/咨询/培训/测评——服务类条目路由依赖这些字样 */
const REQ_MATCH_GENERIC_WORDS = [
  "分系统",
  "子系统",
  "总体",
  "设计",
  "建设",
  "方案",
  "规划",
  "概述",
  "介绍",
  "系统",
  "平台",
  "中心",
]

/** 章/节标题 → 名称段：按非文字数字字符切分、连词（与/及）再拆，逐词去除泛词，保留长度≥2 的段 */
export function requirementTitleSegments(title: string): string[] {
  const segs = new Set<string>()
  for (const token of (title ?? "").split(/[^0-9A-Za-z\u4e00-\u9fff]+/)) {
    for (const part of token.split(/[与及]/)) {
      const stripped = REQ_MATCH_GENERIC_WORDS.reduce((s, w) => s.split(w).join(""), part)
      if (stripped.length >= 2) segs.add(stripped)
    }
  }
  return Array.from(segs)
}

/** 条目命中判定：双向包含；纯字母数字段按词边界匹配，避免短缩写误中更长单词的内部子串 */
function requirementSegHit(reqLine: string, seg: string): boolean {
  if (/^[0-9A-Za-z]+$/.test(seg)) {
    return new RegExp(`(^|[^0-9A-Za-z])${seg}([^0-9A-Za-z]|$)`, "i").test(reqLine)
  }
  return reqLine.includes(seg) || seg.includes(reqLine)
}

/**
 * R155：判定某章应逐条回应的客户建设需求条目（章标题与各节名共同参与匹配）。
 * 命中≥4 条且占比≥80% 视为章名无区分度（泛词误伤），此时不注入，由清单块整体覆盖要求兜底。
 */
export function chapterRequirementLines(
  chapterTitle: string,
  sections: string[] | undefined,
  reqLines: string[] | undefined,
): string[] {
  if (!reqLines?.length) return []
  const segs = [
    ...requirementTitleSegments(chapterTitle),
    ...(sections ?? []).flatMap((s) => requirementTitleSegments(s)),
  ]
  if (!segs.length) return []
  const matched = reqLines.filter((r) => segs.some((seg) => requirementSegHit(r, seg)))
  if (matched.length >= 4 && matched.length >= reqLines.length * 0.8) return []
  return matched
}

export function checklistScopeBlock(snap: ChecklistSnapshot | undefined): string {
  if (!snap) return ""
  const externalNote = snap.external_systems.length
    ? `外购系统（公司暂无、按评级要求补齐）：${snap.external_systems.join("、")}，方案中须说明外购系统的选型、集成接口与实施边界；`
    : "本清单无外购系统；"
  const requirementLines = snap.customer_requirements ?? []
  const requirementNote = requirementLines.length
    ? `客户建设需求条目（共 ${requirementLines.length} 条，逐条覆盖、不得遗漏、不得合并）：\n${requirementLines.map((r, i) => `${i + 1}) ${r}`).join("\n")}`
    : "本清单无未匹配需求条目；"
  return [
    `【建设范围清单（含评级目标与外购说明）】清单名称：${snap.checklist_name}；`,
    `评级目标：${formatTargetCodes(snap.rating_targets) || "未指定"}；`,
    `我公司承建系统：${snap.company_systems.join("、") || "无"}；`,
    externalNote,
    requirementNote,
    "硬性要求：分系统设计章节必须逐一覆盖上述清单中的全部系统与客户建设需求条目，不得遗漏；",
    "服务类条目（条目名含咨询、服务、培训、测评陪跑等字样）属于采购的服务内容本身，须有专门章节或小节承载其服务内容、实施方法与交付物，不得只作为评级目标或预期成效表述；",
  ].join("\n")
}

export type SolutionRecord = {
  id: string
  rh_user_id: string
  solution_name: string
  solution_type: SolutionTypeKey
  hospital: string
  hospital_info: HospitalInfo
  outline: OutlineNode[]
  chapters: Chapter[]
  doc_status: DocStatus
  created: string
  updated: string
}

export const SOLUTION_TYPES: {
  key: SolutionTypeKey
  label: string
  desc: string
  guidance: string
}[] = [
  {
    key: "planning",
    label: "规划方案",
    desc: "区域或全院信息化中长期规划，定目标、定架构、定路径",
    guidance:
      "区域/全院信息化规划。骨架须覆盖：项目背景与政策依据（医改政策、智慧医院分级评估）、现状与需求分析、总体规划思路与近中远期目标、总体架构（应用/数据/技术/安全四层架构）、重点应用系统规划、基础设施与云资源规划、数据治理与标准体系、网络与信息安全体系（等级保护2.0）、分期实施路径与保障措施、投资估算与资金筹措、效益分析与风险评估。",
  },
  {
    key: "feasibility",
    label: "可研方案",
    desc: "立项可行性研究，对接发改与卫健评审口径",
    guidance:
      "立项可行性研究（供发改/卫健部门评审）。骨架须覆盖：项目概述与建设必要性、政策依据、现状与差距分析、需求分析（业务/功能/性能/安全）、建设方案论证（总体架构与各系统方案比选）、信息安全等级保护与商用密码应用方案、项目组织与实施进度计划、投资估算与资金筹措（含运维费）、社会效益与经济效益分析、风险分析与对策、可行性研究结论与建议。",
  },
  {
    key: "preliminary",
    label: "初设方案",
    desc: "初步设计与概算，分系统设计加概算科目",
    guidance:
      "初步设计与概算。骨架须覆盖：总体设计（设计原则/总体架构/技术路线）、各分系统初步设计（功能设计/接口设计/数据设计，逐一覆盖建设清单中的系统）、基础设施与部署架构设计、安全设计（等保/密码应用/数据安全）、项目实施组织与进度计划、初步设计概算（按概算科目分解）、效益分析。",
  },
  {
    key: "custom",
    label: "定制方案",
    desc: "按客户个性化需求逐条回应的定制方案",
    guidance:
      "按客户个性化需求定制。骨架须覆盖：项目背景与需求理解（逐条回应客户特殊要求）、总体建设方案、定制功能设计、与院内现有系统的集成方案、数据迁移方案、安全设计、实施计划与服务保障、投资估算、效益分析。特殊要求栏里的每一条都必须落到具体章节。",
  },
  {
    key: "standard",
    label: "标准方案",
    desc: "成熟产品套路方案，突出产品力与典型案例",
    guidance:
      "成熟产品套路方案。骨架须覆盖：产品总体介绍与价值主张、总体技术架构、核心功能模块介绍（按建设清单逐一展开）、产品亮点与差异化优势、实施方案与服务体系、典型落地案例、投资估算与服务报价、效益分析。",
  },
]

export const SYSTEM_OPTIONS = [
  "HIS",
  "EMR",
  "LIS",
  "PACS",
  "集成平台",
  "数据中心",
  "互联网医院",
  "移动护理",
  "手麻重症",
  "药事管理",
  "HRP 运营",
  "等保安全",
]

export const HOSPITAL_LEVELS = ["三级甲等", "三级乙等", "二级甲等", "其他"]

export const BUDGET_RANGES = ["100 万以内", "100-300 万", "300-500 万", "500-1000 万", "1000 万以上", "暂未确定"]

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  outline: "大纲中",
  generating: "生成中",
  partial: "部分成稿",
  done: "已完成",
}

export function typeLabel(key: string): string {
  return SOLUTION_TYPES.find((t) => t.key === key)?.label ?? "方案"
}

export function typeGuidance(key: string): string {
  return SOLUTION_TYPES.find((t) => t.key === key)?.guidance ?? ""
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

export function makeUid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** 把 LLM 返回的大纲 JSON 规整为最深三级的 OutlineNode 树（容错：丢空标题、补 children；第十三轮：顶层保留 part，非法值按 tech） */
export function normalizeOutline(raw: unknown, depth = 1): OutlineNode[] {
  if (!Array.isArray(raw) || depth > 3) return []
  const out: OutlineNode[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const rec = item as Record<string, unknown>
    const title = String(rec.title ?? "").trim()
    if (!title) continue
    // 仅顶层节点带 part 归属标记（深层节点不携带）；非 "biz"/"tech" 的非法值一律按 tech（不写字段）
    const part = depth === 1 && rec.part === "biz" ? ("biz" as OutlinePart) : undefined
    // R31：任意层级都透传 description 承接标注（分步大纲 call2 的节节点解析深度从 1 起，不能按深度丢弃）
    const description = String(rec.description ?? "").trim() || undefined
    out.push({
      id: makeUid(),
      title,
      children: depth < 3 ? normalizeOutline(rec.children, depth + 1) : [],
      ...(part ? { part } : {}),
      ...(description ? { description } : {}),
    })
  }
  return out
}

/** 从 LLM 文本中容错解析大纲 JSON：剥代码围栏、截取首个 { 或 [ 到末个 } 或 ] */
export function parseOutlineJson(text: string): unknown {
  // ai-stability-01：截候选走 extractJsonCandidate 单一真源，失败抛可读错误而非裸 SyntaxError（此函数 bid/solution 共用）
  const candidate = extractJsonCandidate(text)
  if (!candidate) throw new Error("大纲格式解析失败")
  const parsed = parseJsonTolerant(candidate) as Record<string, unknown> | unknown[]
  if (Array.isArray(parsed)) return parsed
  const rec = parsed as Record<string, unknown>
  if (Array.isArray(rec.outline)) return rec.outline
  if (Array.isArray(rec.chapters)) return rec.chapters
  throw new Error("大纲格式解析失败")
}

/** 大纲渲染为带编号的纯文本（供 prompt 上下文与导出对照） */
export function outlineToText(nodes: OutlineNode[], prefix = ""): string {
  const lines: string[] = []
  nodes.forEach((n, i) => {
    const no = prefix ? `${prefix}.${i + 1}` : `${i + 1}`
    lines.push(`${no} ${n.title}`)
    if (n.children?.length) lines.push(outlineToText(n.children, no))
  })
  return lines.join("\n")
}

export function deepCopyOutline(nodes: OutlineNode[]): OutlineNode[] {
  return nodes.map((n) => ({
    id: makeUid(),
    title: n.title,
    children: deepCopyOutline(n.children ?? []),
    ...(n.part ? { part: n.part } : {}),
  }))
}

export function renameNodeInTree(nodes: OutlineNode[], id: string, title: string): OutlineNode[] {
  return nodes.map((n) =>
    n.id === id ? { ...n, title } : { ...n, children: renameNodeInTree(n.children ?? [], id, title) },
  )
}

export function removeNodeFromTree(nodes: OutlineNode[], id: string): OutlineNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => ({ ...n, children: removeNodeFromTree(n.children ?? [], id) }))
}

export function addChildToTree(nodes: OutlineNode[], parentId: string, child: OutlineNode): OutlineNode[] {
  return nodes.map((n) =>
    n.id === parentId
      ? { ...n, children: [...(n.children ?? []), child] }
      : { ...n, children: addChildToTree(n.children ?? [], parentId, child) },
  )
}

/** dir = -1 上移 / 1 下移，在同级内交换位置；返回 null 表示已在边界 */
export function moveNodeInTree(nodes: OutlineNode[], id: string, dir: -1 | 1): OutlineNode[] | null {
  const idx = nodes.findIndex((n) => n.id === id)
  if (idx >= 0) {
    const target = idx + dir
    if (target < 0 || target >= nodes.length) return null
    const next = [...nodes]
    const tmp = next[idx]
    next[idx] = next[target]
    next[target] = tmp
    return next
  }
  let moved = false
  const next = nodes.map((n) => {
    const r = moveNodeInTree(n.children ?? [], id, dir)
    if (r) {
      moved = true
      return { ...n, children: r }
    }
    return n
  })
  return moved ? next : null
}

// ---------------------------------------------------------------------------
// Prompt 构造
// ---------------------------------------------------------------------------

/** 方案侧 prompt 版本指纹（B类流程）：R155 之前的口径记 sol-v1，改动 prompt 文本须 +1 并同步快照测试 */
export const SOL_PROMPT_VERSION = "sol-v2/R155-2026-10-05"

function infoBlock(hospital: string, info: HospitalInfo): string {
  return [
    `客户医院：${hospital}`,
    `医院等级：${info.hospital_level || "未填"}`,
    `床位规模：${info.bed_scale || "未填"}`,
    `日门诊量：${info.outpatient_scale || "未填"}`,
    `需求科室：${info.demand_departments || "未填"}`,
    `建设系统清单：${(info.systems ?? []).join("、") || "未填"}`,
    `预算范围：${info.budget_range || "未填"}`,
    `特殊要求：${info.special_requirements || "无"}`,
  ].join("\n")
}

export function buildOutlineMessages(
  typeKey: SolutionTypeKey,
  solutionName: string,
  hospital: string,
  info: HospitalInfo,
): LlmMessage[] {
  const scopeBlock = checklistScopeBlock(info.ref_checklist_snapshot)
  const system = [
    "你是一位深耕医疗信息化行业十余年的资深售前解决方案专家，长期为各级医院编写信息化建设方案，熟悉 HIS、EMR、LIS、PACS、集成平台、数据中心、互联网医院等系统的建设内容，熟悉电子病历分级评价、互联互通测评、等级保护 2.0、商用密码应用等行业评审要求。",
    `当前任务：为一份「${typeLabel(typeKey)}」（方案名：${solutionName}）生成多级目录大纲（章—节—小节，最多三级）。`,
    `该类型方案的章节要求：${typeGuidance(typeKey)}`,
    "硬性要求：",
    "1. 章节骨架必须符合医疗信息化行业惯例与评审口径，结合医院等级、规模、需求科室与建设系统清单定制，勾选的每个系统都要落到具体的分系统章节；条目多时可按业务集群合并章节承载，但每个系统与需求条目的名称至少逐字出现在一个节或小节标题中；",
    "2. 章数量 8-12 个，每章下设 2-6 节，节下可设 0-5 个小节（第三章级可留空）；",
    "3. 标题只写名称、不带任何编号（编号由系统自动生成），不带标点符号结尾；",
    "4. 输出严格 JSON，禁止任何解释文字、禁止 markdown 代码围栏，格式：",
    '{"outline":[{"title":"章标题","children":[{"title":"节标题","children":[{"title":"小节标题","children":[]}]}]}]}',
  ].join("\n")
  const user = `【医院项目信息】\n${infoBlock(hospital, info)}${scopeBlock ? `\n\n${scopeBlock}` : ""}\n\n请生成这份${typeLabel(typeKey)}的完整多级大纲 JSON。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/**
 * 方案正文写作风格硬条款（对标标书侧 BID_STYLE_RULES 移植）：
 * 章节生成 / 改写 prompt 统一注入，逐条编号进 system，消除 AI 腔与编造。
 */
export const SOL_STYLE_RULES: string[] = [
  "确定性用语：禁止「我们建议 / 您可以考虑 / 推荐采用」等试探口吻，一律用「本项目采用 / 建设内容为 / 具体措施如下」等确定性表述；",
  "反 AI 腔：语言正式、落地可执行，禁止连环连接词堆砌（首先其次再次最后、总而言之），禁止「赋能 / 抓手 / 闭环」等宣传套话；",
  "元话语禁令：禁止「待补充 / TODO / 需人工确认 / 此处省略 / AI 生成」等元话语进入正文（约定占位值【待填写】除外）；",
  "排版惯例：禁止装饰符号（【】★◆■●✓✅→等）与 Markdown 标题、斜体、加粗符号，小节标题用「N.M 名称」纯文本行；",
  "防编造占位：事实基线里没有的具体值（金额 / 日期 / 数量 / 编号等）一律写【待填写】，禁止改写成「待定 / TBD」，禁止编造；",
  "同级互补：只展开本章/本小节标题对应的独特主题，其它章已覆盖的内容不重复展开，保持全文内容互补；",
  "朴实无华：这是建设方案不是宣传册，直接陈述建设内容、参数与措施，不写开场白与拔高式愿景总结。",
  "禁绝对化承诺：不得使用「确保通过 / 保证达到 / 满分 / 100% / 万无一失 / 零风险」等绝对化、保证性表述，尤其禁止承诺「确保通过电子病历五级 / 互联互通某级等评级评定」——评级结果由评审机构判定、非建设方可保证；可达成目标用「按……标准规划建设 / 满足……评审要求」等可核实口径表述；",
]

// ---------------------------------------------------------------------------
// 05 §6 方案侧三模式：方案没有招标文件锚点，模式轴换为「以医院需求为界 vs 主动扩展」。
// 联合类型与标书侧 ComplianceMode 结构一致，但方案语义/措辞独立、默认 moderate
// （方案是给客户看的售前材料，无「加码=验收义务」法律风险，过严显单薄）。
// strict → 仍与既有默认写法基本一致；moderate/full 各注入一条边界规则。
// ---------------------------------------------------------------------------

export type SolutionComplianceMode = "strict" | "moderate" | "full"
export const SOL_COMPLIANCE_MODE_DEFAULT: SolutionComplianceMode = "moderate"
export const SOL_COMPLIANCE_MODES: SolutionComplianceMode[] = ["strict", "moderate", "full"]
export const SOL_COMPLIANCE_MODE_LABEL: Record<SolutionComplianceMode, string> = {
  strict: "严守需求",
  moderate: "适度深化",
  full: "充分扩展",
}
export const SOL_COMPLIANCE_MODE_HINT: Record<SolutionComplianceMode, string> = {
  strict: "严格按已确认的建设清单与医院需求编写，不新增系统、不新增功能模块",
  moderate: "在需求项内深化实施、集成、安全、培训细节，不新增系统清单（默认）",
  full: "可增设架构论证、技术路线、数据治理、运维体系、案例业绩等支撑性章节",
}

function isSolMode(v: unknown): v is SolutionComplianceMode {
  return v === "strict" || v === "moderate" || v === "full"
}

/** localStorage 读取容错：非法/缺省一律回落默认（moderate） */
export function normalizeSolMode(v: unknown): SolutionComplianceMode {
  return isSolMode(v) ? v : SOL_COMPLIANCE_MODE_DEFAULT
}

/** 章正文生成的模式边界规则（缺省=moderate） */
export function solComplianceModeRule(mode: SolutionComplianceMode | undefined): string {
  const m = mode ?? SOL_COMPLIANCE_MODE_DEFAULT
  if (m === "strict")
    return "生成模式=严守需求：严格按【医院项目事实基线】与已确认的建设清单编写，不得新增清单外的系统、功能模块或子系统；建设清单未覆盖但确有必要提及的内容，以「建议补充」口径标注，不写成确定性建设内容；"
  if (m === "full")
    return "生成模式=充分扩展：在不改变已确认建设清单（不新增对外承诺的系统/功能模块清单）的前提下，允许增设支撑性章节与小节（如总体架构论证、技术路线、数据治理、运维服务与 SLA、同类案例业绩）以体现方案完整性；新增内容必须与本项目直接相关、能落到医院需求，技术参数与量化指标仍以事实基线为界、不得加码为可验收承诺，禁止为凑篇幅增设空泛章节；"
  return "生成模式=适度深化：紧扣医院需求与建设清单，在既有需求项范围内深化实施细节、集成方案、安全措施与培训安排；不新增清单外的系统或功能模块，量化指标与事实基线自洽；"
}

/** 章内「扩写」的模式边界规则（仅 expand 注入；rewrite/condense 与模式无关） */
function solRefineModeRule(mode: SolutionComplianceMode | undefined): string {
  const m = mode ?? SOL_COMPLIANCE_MODE_DEFAULT
  if (m === "strict")
    return "改写边界：严守建设清单与医院需求，扩写只深化既有需求项，不新增清单外的系统或功能模块；"
  if (m === "full")
    return "改写边界：扩写可在本章内补充架构论证、技术路线、数据治理、运维与案例等支撑性内容，但不得新增对外承诺的系统/功能模块清单，量化指标仍以事实基线为界；"
  return "改写边界：扩写聚焦本章需求项内的实施、集成、安全、培训细节深化，不新增系统清单；"
}

export function buildChapterMessages(
  sol: Pick<SolutionRecord, "solution_name" | "solution_type" | "hospital" | "hospital_info" | "outline">,
  chapters: Chapter[],
  chapterIndex: number,
  /** 轮次新增：知识库 Top-K 检索命中的参考素材（注明来源文档；空/缺省=不注入） */
  kbMaterial?: string,
  /** 05 §6：方案侧三模式（缺省=moderate） */
  complianceMode?: SolutionComplianceMode,
  /** 对标标书侧第五轮：整份目标页数折算的本章字数预算（缺省/0=维持既有 1200-2000 字口径） */
  wordBudget?: number,
  /** 配图开关：开启后输出 {content, figures} JSON 契约（架构图/流程图/界面示意，导出 Word 时插图） */
  figuresEnabled?: boolean,
): LlmMessage[] {
  const ch = chapters[chapterIndex]
  const chapterNo = chapterIndex + 1
  const info = sol.hospital_info
  const sectionLines = (ch.sections ?? []).map((s, j) => `${chapterNo}.${j + 1} ${s}`).join("\n")

  // —— system：人设 + 写作铁律 + 风格硬条款（同份方案跨章恒定，可命中服务端前缀缓存）——
  const rules: string[] = [
    `你是一位深耕医疗信息化行业十余年的资深售前解决方案专家，正在为医院编写正式方案文档《${sol.solution_name}》（${typeLabel(sol.solution_type)}）。`,
    "写作铁律：",
    "1. 内容必须真实可落地，使用行业规范术语（HIS、EMR、LIS、PACS、集成平台、数据中心、互联网医院、电子病历分级评价、互联互通测评、等级保护 2.0、商用密码应用等），不写空话套话；",
    "2. 量化指标（并发用户数、页面响应时间、存储容量、系统可用性、业务量估算等）必须与下面【医院项目事实基线】自洽，可按行业常规估算但不得与基线冲突；",
    "3. 正文涉及医院名称、等级、床位、门诊量、预算、建设系统清单等事实信息时，必须与【医院项目事实基线】完全一致，基线没有的具体值写【待填写】，禁止编造不同数值；",
    "4. 禁止 markdown 符号（#、*、-、反引号）、禁止输出本章以外的内容、禁止开场白与总结语；",
    wordBudget && wordBudget > 0
      ? `5. 本章字数预算约 ${wordBudget} 字（整份目标页数按章节权重折算），写足写具体：每个小节给出建设内容、功能清单、配置建议、实施步骤等可落地细节，禁止为凑篇幅重复套话；`
      : "5. 本章篇幅 1200-2000 字，与全文大纲保持一致，不复述其它章节内容。",
  ]
  let ruleNo = 6
  if (kbMaterial) {
    rules.push(
      `${ruleNo}. 下面【知识库参考素材】是团队沉淀的历史方案/案例/标准问答素材（已注明来源）：本章必须优先从素材中提取系统功能清单、配置数量、实施步骤、同类案例与量化数据展开写作，素材里的具体功能名/指标/案例要用到对应小节，不得视而不见只写通用方法论；但必须结合本医院等级、规模与实际需求改写，与事实基线不符的信息一律不采用，禁止整段照抄。`,
    )
    ruleNo += 1
  }
  rules.push(`${ruleNo}. 写作风格硬条款（每条必须遵守）：`)
  for (const t of SOL_STYLE_RULES) {
    ruleNo += 1
    rules.push(`${ruleNo}. ${t}`)
  }
  ruleNo += 1
  rules.push(`${ruleNo}. ${solComplianceModeRule(complianceMode)}`)
  ruleNo += 1
  // 配图开关：复用标书侧三种结构化图型与 JSON 契约（解析端 parseChapterOutput 同套兼容）
  if (figuresEnabled) {
    rules.push(
      `${ruleNo}. 可为本章附 0-2 个结构化配图数据（figures 数组，没有合适图型就输出空数组，不要硬凑）：architecture（架构图）{"type":"architecture","title":"图名","layers":[{"name":"层名","modules":["模块名"]}]}；flow（流程图）{"type":"flow","title":"图名","steps":[{"name":"步骤","desc":"可选说明"}],"branches":["可选分支说明"]}；demo（系统界面示意）{"type":"demo","title":"图名","sidebar":["菜单项"],"main":[{"block":"区块名","desc":"可选说明"}]}；`,
      `${ruleNo + 1}. 配图内容必须直接取自本章将要撰写的实际内容：architecture 各层 modules 必须是本章正文提到的子系统/功能模块，flow 的 steps 必须是本章撰写的业务环节/操作步骤，严禁「模块A」「步骤1」等泛化占位词与纯序号命名；`,
      `${ruleNo + 2}. 输出严格 JSON，禁止解释文字、禁止代码围栏，格式：{"content":"本章纯文本正文（禁止 markdown 符号）","figures":[]}`,
    )
  } else {
    rules.push(`${ruleNo}. 直接输出纯文本正文，不输出 JSON 与配图数据；`)
  }
  const system = rules.join("\n")

  // —— stableUser：同份方案跨章 identical 的大块上下文，前置以命中前缀缓存 ——
  const scopeBlock = checklistScopeBlock(sol.hospital_info?.ref_checklist_snapshot)
  const stableUser = [
    `【医院项目事实基线（全篇唯一权威口径，勿编造、勿冲突）】\n${infoBlock(sol.hospital, info)}`,
    scopeBlock ? scopeBlock : "",
    `【全文大纲（仅供保持上下文一致，不要复述）】\n${outlineToText(sol.outline ?? [])}`,
  ]
    .filter((s) => s !== "")
    .join("\n\n")

  // —— taskUser：仅本章差异内容，置后，不影响前缀缓存命中 ——
  // R155（r150 残余）：正文级逐条覆盖——按章/节标题把客户建设需求条目路由到本章 prompt
  const chapterReqs = chapterRequirementLines(
    ch.title,
    ch.sections,
    sol.hospital_info?.ref_checklist_snapshot?.customer_requirements,
  )
  const taskUser = [
    `【当前要编写的章节】第${chapterNo}章 ${ch.title}`,
    sectionLines
      ? `本章小节（每个小节标题单独一行，格式「${chapterNo}.1 小节名」，小节下写 2-5 段、每段 3-6 句）：\n${sectionLines}`
      : `本章无预设小节，请按内容逻辑自行组织 2-4 个小节，小节标题行格式「${chapterNo}.1 名称」，小节下写 2-5 段、每段 3-6 句。`,
    chapterReqs.length
      ? `【本章须逐条回应的客户建设需求条目（共 ${chapterReqs.length} 条）】\n${chapterReqs
          .map((r, i) => `${i + 1}) ${r}`)
          .join("\n")}\n以上每条必须落在本章独立小节或独立段落，写明针对该条的建设内容与功能范围；其中服务类条目（条目名含咨询、服务、培训、测评陪跑字样）要写清服务内容、实施方法与交付物；确属本章无法承载的条目，在章末用一行注明归入哪一章，不得默默丢弃。`
      : "",
    kbMaterial ? `【知识库参考素材（团队沉淀，注明来源文档，须贴合本院实际）】\n${kbMaterial}` : "",
    "请编写本章完整正文。",
  ]
    .filter((s) => s !== "")
    .join("\n\n")

  return [
    { role: "system", content: system },
    { role: "user", content: stableUser },
    { role: "user", content: taskUser },
  ]
}

/**
 * 章节未达字数预算时的自动续写 prompt：给已写内容与尾部摘录，只补写剩余部分，
 * 禁止重复既有段落（合并端再过 stripOverlap 去重叠）；输出纯文本，不带 JSON 契约。
 */
export function buildSolContinueMessages(
  sol: Pick<SolutionRecord, "solution_name" | "solution_type" | "hospital" | "hospital_info">,
  chapterTitle: string,
  written: string,
  remainWords: number,
  complianceMode?: SolutionComplianceMode,
): LlmMessage[] {
  const tail = written.slice(-800)
  const rules = [
    `你是一位深耕医疗信息化行业十余年的资深售前解决方案专家，正在为医院编写正式方案文档《${sol.solution_name}》（${typeLabel(sol.solution_type)}）。`,
    `本章「${chapterTitle}》已写 ${written.length} 字，距预算还差约 ${Math.max(200, remainWords)} 字，你的任务是从已写内容的结尾处继续补写，写满剩余预算。`,
    "续写铁律：",
    "1. 从已有内容的断点处自然接续：不重复已有段落、不重写已有小节、不输出章标题与开场语，直接补写尚未展开或展开不足的小节内容；",
    "2. 优先补齐：已有正文里一笔带过的小节、素材里有细节可挖的功能/案例/数据、实施与运维等可落地措施；禁止为凑字数重复套话；",
    "3. 小节标题行格式「N.M 名称」与已有正文一致；已写过的小节不再重复输出标题，未写的小节补标题行；",
    "4. 直接输出纯文本续写内容：禁止 markdown 符号、禁止 JSON、禁止收尾总结语；",
    `5. 写作风格硬条款与事实基线口径与正文生成一致：`,
    ...SOL_STYLE_RULES.map((t) => `  - ${t}`),
    `6. ${solComplianceModeRule(complianceMode)}`,
  ].join("\n")
  const user = [
    `【医院项目事实基线】\n${infoBlock(sol.hospital, sol.hospital_info)}`,
    `【本章已写内容尾部摘录（最后 800 字，续写从这里接）】\n${tail}`,
    `请从尾部摘录结尾处继续补写本章「${chapterTitle}」剩余内容，约补 ${Math.max(200, remainWords)} 字。只输出续写部分正文。`,
  ].join("\n\n")
  return [
    { role: "system", content: rules },
    { role: "user", content: user },
  ]
}

export type RefineKind = "rewrite" | "expand" | "condense"

export const REFINE_LABEL: Record<RefineKind, string> = {
  rewrite: "改写",
  expand: "扩写",
  condense: "精简",
}

export function buildRefineMessages(
  kind: RefineKind,
  sol: Pick<SolutionRecord, "solution_name" | "solution_type" | "hospital" | "hospital_info">,
  chapterTitle: string,
  content: string,
  /** 轮次 E-4：自检「按建议优化」时把 issues 摘要拼入改写指令 */
  extraInstruction?: string,
  /** 05 §6：方案侧三模式，仅对「扩写」注入边界规则（缺省=moderate） */
  complianceMode?: SolutionComplianceMode,
): LlmMessage[] {
  const action =
    kind === "rewrite"
      ? "改写：保持原有信息量与结构，换用更专业、更书面的表达，消除口语与重复"
      : kind === "expand"
        ? "扩写：补充医疗信息化行业细节、量化指标、实施要点与风险考虑，篇幅增加约 50%"
        : "精简：压缩到约 60% 篇幅，只保留关键信息，不丢失小节结构"
  const system = [
    `你是医疗信息化行业资深方案文档编辑，正在处理方案《${sol.solution_name}》（${typeLabel(sol.solution_type)}，客户：${sol.hospital}）中「${chapterTitle}」一章。`,
    `请对该章正文执行「${action}」。`,
    kind === "expand" ? solRefineModeRule(complianceMode) : "",
    extraInstruction ? `本次改写须重点修复以下自检发现的问题：\n${extraInstruction}` : "",
    "输出铁律：直接输出处理后的完整正文纯文本，小节标题行保持「N.M 小节名」格式，禁止 markdown 符号、禁止任何解释说明或开场白。",
  ]
    .filter(Boolean)
    .join("\n")
  return [
    { role: "system", content: system },
    { role: "user", content: `【原文】\n${content}` },
  ]
}

// ---------------------------------------------------------------------------
// 章节自检评分 Prompt（轮次 E-4）
// ---------------------------------------------------------------------------

const REVIEW_CONTENT_LIMIT = 12000

export function buildChapterReviewMessages(
  chapterTitle: string,
  chapterText: string,
  outlineContext: string,
): LlmMessage[] {
  const system = [
    "你是医疗信息化行业资深售前方案评审专家，负责对方案章节正文做五维质量自检评分。",
    "五个维度各 0-20 分：coverage 需求覆盖（是否回应大纲与客户医院信息中的要求）、logic 逻辑结构（小节组织与论证顺序）、evidence 数据与案例支撑（量化指标、行业依据、案例）、feasibility 落地可行性（技术路线与实施安排是否可执行）、writing 文字规范（术语准确、书面化、无口语与重复）。",
    "verdict 规则：total≥85 为 direct（可直接采用）、70-84 为 review（建议微调）、<70 为 blocked（建议重写）。",
    "issues 只列真实存在的问题，每条含 dim（维度中文名）、problem（问题描述）、suggestion（修改建议），没有明显问题则给空数组。",
    "输出严格 JSON，禁止任何解释文字、禁止 markdown 代码围栏，格式：",
    '{"scores":{"coverage":0,"logic":0,"evidence":0,"feasibility":0,"writing":0},"total":0,"verdict":"direct|review|blocked","issues":[{"dim":"维度","problem":"问题","suggestion":"建议"}]}',
  ].join("\n")
  const body = (chapterText ?? "").slice(0, REVIEW_CONTENT_LIMIT)
  const truncatedNote = (chapterText ?? "").length > REVIEW_CONTENT_LIMIT ? "\n（正文超长已截断，按现有内容评审）" : ""
  const user = [
    `【评审上下文】\n${outlineContext}`,
    `【待评审章节】${chapterTitle}`,
    `【章节正文】\n${body}${truncatedNote}`,
    "请输出该章的自检评分 JSON。",
  ].join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

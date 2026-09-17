import type { LlmMessage } from "@/lib/llm"

// ---------------------------------------------------------------------------
// 方案编制页：领域类型、常量与 LLM prompt 构造（Logic 层专用，无 JSX）
// ---------------------------------------------------------------------------

export type SolutionTypeKey = "planning" | "feasibility" | "preliminary" | "custom" | "standard"

/**
 * 标书第十三轮：顶层章归属标记（biz=商务部分骨架章，只列小节不生成正文；tech=技术部分详细章）。
 * 仅顶层节点有意义；方案编制页不写 part（视为无归属），标书页无 part 一律按 tech 处理（存量兼容）。
 */
export type OutlinePart = "biz" | "tech"

export type OutlineNode = { id: string; title: string; children: OutlineNode[]; part?: OutlinePart }

export type ChapterGenStatus = "pending" | "generating" | "done" | "failed"

/** 章节配图结构化数据（标书工作页生成；方案编制页不使用，可选字段不破坏既有接口） */
export type FigureSpec =
  | { type: "architecture"; title: string; layers: { name: string; modules: string[] }[]; caption?: string }
  | { type: "flow"; title: string; steps: { name: string; desc?: string }[]; branches?: string[]; caption?: string }
  | { type: "demo"; title: string; sidebar?: string[]; main?: { block: string; desc?: string }[]; caption?: string }

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

export function checklistScopeBlock(snap: ChecklistSnapshot | undefined): string {
  if (!snap) return ""
  const externalNote = snap.external_systems.length
    ? `外购系统（公司暂无、按评级要求补齐）：${snap.external_systems.join("、")}，方案中须说明外购系统的选型、集成接口与实施边界；`
    : "本清单无外购系统；"
  return [
    `【建设范围清单（含评级目标与外购说明）】清单名称：${snap.checklist_name}；`,
    `评级目标：${formatTargetCodes(snap.rating_targets) || "未指定"}；`,
    `我公司承建系统：${snap.company_systems.join("、") || "无"}；`,
    externalNote,
    "硬性要求：分系统设计章节必须逐一覆盖上述清单中的全部系统，不得遗漏；",
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
    out.push({
      id: makeUid(),
      title,
      children: depth < 3 ? normalizeOutline(rec.children, depth + 1) : [],
      ...(part ? { part } : {}),
    })
  }
  return out
}

/** 从 LLM 文本中容错解析大纲 JSON：剥代码围栏、截取首个 { 或 [ 到末个 } 或 ] */
export function parseOutlineJson(text: string): unknown {
  let t = text.trim()
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()
  const objStart = t.indexOf("{")
  const arrStart = t.indexOf("[")
  let candidate = ""
  if (arrStart >= 0 && (objStart < 0 || arrStart < objStart)) {
    candidate = t.slice(arrStart, t.lastIndexOf("]") + 1)
  } else if (objStart >= 0) {
    candidate = t.slice(objStart, t.lastIndexOf("}") + 1)
  }
  if (!candidate) throw new Error("大纲格式解析失败")
  const parsed = JSON.parse(candidate) as Record<string, unknown> | unknown[]
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
    "1. 章节骨架必须符合医疗信息化行业惯例与评审口径，结合医院等级、规模、需求科室与建设系统清单定制，勾选的每个系统都要落到具体的分系统章节；",
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

export function buildChapterMessages(
  sol: Pick<SolutionRecord, "solution_name" | "solution_type" | "hospital" | "hospital_info" | "outline">,
  chapters: Chapter[],
  chapterIndex: number,
): LlmMessage[] {
  const ch = chapters[chapterIndex]
  const chapterNo = chapterIndex + 1
  const sectionLines = (ch.sections ?? []).map((s, j) => `${chapterNo}.${j + 1} ${s}`).join("\n")
  const system = [
    `你是一位深耕医疗信息化行业十余年的资深售前解决方案专家，正在为医院编写正式方案文档《${sol.solution_name}》（${typeLabel(sol.solution_type)}）。`,
    "写作铁律：",
    "1. 内容必须真实可落地，使用行业规范术语（HIS、EMR、LIS、PACS、集成平台、数据中心、互联网医院、电子病历分级评价、互联互通测评、等级保护 2.0、商用密码应用等），不写空话套话；",
    "2. 结合医院等级、床位与门诊量规模给出匹配的量化指标（并发用户数、页面响应时间、存储容量、系统可用性、业务量估算等）；",
    `3. 严格按给定小节组织正文：每个小节标题单独一行，格式「${chapterNo}.1 小节名」，小节下写 2-5 段、每段 3-6 句；`,
    "4. 直接输出纯文本正文：禁止 markdown 符号（#、*、-、反引号）、禁止输出本章以外的内容、禁止开场白与总结语；",
    "5. 本章篇幅 1200-2000 字，与全文大纲保持一致，不复述其他章节。",
  ].join("\n")
  const scopeBlock = checklistScopeBlock(sol.hospital_info?.ref_checklist_snapshot)
  const user = [
    `【医院项目信息】\n${infoBlock(sol.hospital, sol.hospital_info)}`,
    scopeBlock ? scopeBlock : "",
    `【全文大纲（仅供保持上下文一致，不要复述）】\n${outlineToText(sol.outline ?? [])}`,
    `【当前要编写的章节】第${chapterNo}章 ${ch.title}`,
    sectionLines ? `本章小节：\n${sectionLines}` : "本章无预设小节，请按内容逻辑自行组织 2-4 个小节。",
    "请编写本章完整正文。",
  ].join("\n\n")
  return [
    { role: "system", content: system },
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

// ---------------------------------------------------------------------------
// R47（B19）按环节自动选模型 —— 纯函数，零副作用、零后端
//
// 背景（用户 2026-10-14 提问 1）：标书工作台里「解析抽取 / 大纲规划 / 正文撰写 /
// 图表审阅 / 通用问答」对模型的要求完全不同——解析要快且 JSON 稳、正文要中文长文与
// 长上下文、判定要逐条比对、文书要中文表达、审阅要能读图。此前全流程只有一个顶部手选模型，
// 且解析报告/合规矩阵等子面板把 modelRef 硬编码成 null（= 平台内置），
// 本地部署下平台内置必然 412，于是「选了个人模型却静默落到不可用通道」。
//
// 本模块只做一件事：给定环节 + 候选模型清单，返回最合适的那个（含打分依据）。
// 选择口径（全部可解释、可单测）：
//   0. 硬门槛①：非文本模态（向量 / 作图 / 视频 / 语音）不进候选（R88 modelModality 单一真源）
//   1. 硬门槛②：长期实测不可用档案（404 下线 / 上游停用 / Key 失效）直接排除（R296 口径）
//   2. 标签匹配：环节偏好标签按顺序加权（越靠前越重），词表沿用 modelProfiles.ts
//   3. 人工标注加成：用户自己标注过的模型加固定分（R-038 三层优先级 user > known > inferred）
//   4. 会话内冷却降权但不排除（R233 口径：冷却只是这一路刚失败，仍会如实先试）
//   5. 稳定兜底：同分个人配置优先于平台内置，再同分按候选原顺序（结果确定可复现）
//
// 维护约定：新增环节 / 调权重必须同步更新 modelRouting.test.ts；标签词表复用 modelProfiles.ts，
// 不在本文件另造一套词。
// ---------------------------------------------------------------------------

import { modelRefLabel, type ModelRef } from "@/lib/modelGateway"
import { isTextGenerationModel } from "@/lib/modelModality"
import { resolveModelProfile, type ProfileSource } from "@/lib/modelProfiles"

/** 标书侧模型角色（按环节划分，不再按页面划分） */
export type ModelRole = "longform" | "outline" | "extract" | "judge" | "vision" | "chat"

/** 稳定顺序（UI 遍历 / 落库排序都用它，禁止依赖 Object.keys 顺序） */
export const MODEL_ROLE_ORDER: ModelRole[] = ["longform", "outline", "extract", "judge", "vision", "chat"]

export const MODEL_ROLE_LABEL: Record<ModelRole, string> = {
  longform: "正文撰写",
  outline: "大纲规划",
  extract: "解析抽取",
  judge: "判定审查",
  vision: "图表审阅",
  chat: "中文文书",
}

export const MODEL_ROLE_HINT: Record<ModelRole, string> = {
  longform: "长文写作：优先中文长文 / 长文档，偏慢的推理模型不适合批量成章",
  outline: "结构化规划：优先长上下文与推理，一次看全招标要求",
  extract: "解析抽取：优先快速轻量，输出 JSON 稳定、不把配额烧在思考上",
  judge: "判定审查（废标比对 / 覆盖审计 / 交卷体检 / 查重 / 评标）：全文逐条比对，优先推理与长上下文，宁慢不错",
  vision: "图表审阅：读扫描件 / 截图 / 表格，只有视觉模型可胜任",
  chat: "中文文书：质疑函 / 投诉书 / 答辩与讲标稿，优先中文写作与表达",
}

/** 各环节偏好标签，按重要度降序（列表内含 modelProfiles.ts 既有词表词，不另造） */
export const MODEL_ROLE_TAGS: Record<ModelRole, string[]> = {
  longform: ["长文", "长文档", "中文", "写作", "长上下文", "超长上下文", "通用", "旗舰"],
  outline: ["推理", "长上下文", "长文档", "中文", "通用"],
  extract: ["快速", "轻量", "通用", "长上下文", "经济"],
  judge: ["推理", "长上下文", "长文档", "中文", "旗舰", "通用"],
  vision: ["视觉", "多模态"],
  chat: ["中文", "写作", "对话", "通用", "快速"],
}

/** 标签权重基数：命中第 i 个偏好标签得 max(BASE - i, 1) 分 */
const ROLE_TAG_BASE = 8
/**
 * 用户人工标注加成（R-038 三层优先级中 user 最高，故权重给足）。
 * 前提：用户的标注必须与本环节偏好标签有交集才加分——否则「给视觉模型标了看图」
 * 会连正文撰写环节也压过专业长文模型，那是错的。
 */
const USER_TAGGED_BONUS = 12
/** 会话内冷却降权（不排除：用户仍可选用，路由只是不再优先它） */
const COOLING_PENALTY = 6

/** 候选模型（与 UI 解耦：不依赖 ModelRef，便于用字符串 fixture 直接单测） */
export interface RoleCandidate<T> {
  item: T
  /** 模型 id（模态判定与画像查询的唯一输入） */
  modelId: string
  /** 画像标签（来自 modelProfiles / 用户标注） */
  tags: string[]
  /** 画像来源（user 表示人工标注） */
  profileSource?: ProfileSource
  /** 会话内冷却中（modelFailover） */
  cooling?: boolean
  /** 长期实测不可用（modelHealth） */
  unavailable?: boolean
  /** 是否个人配置（同分兜底时优先） */
  personal?: boolean
}

export interface RolePick<T> {
  item: T
  score: number
  matchedTags: string[]
}

interface ScoredPick<T> extends RolePick<T> {
  personal: boolean
  idx: number
}

/** 命中该环节的偏好标签（保持 MODEL_ROLE_TAGS 顺序，便于 UI 展示「凭什么选的」） */
function matchedRoleTags(role: ModelRole, tags: string[]): string[] {
  const want = MODEL_ROLE_TAGS[role]
  return want.filter((t) => tags.includes(t))
}

/**
 * 单候选打分。非有限分（-Infinity）表示「硬性排除」，调用方不得回退使用。
 * 排除的只有两类：非文本模态、长期实测不可用——其余一律给出可比较的分数。
 */
export function scoreRoleCandidate<T>(role: ModelRole, c: RoleCandidate<T>): number {
  if (c.unavailable) return Number.NEGATIVE_INFINITY
  if (!isTextGenerationModel(c.modelId)) return Number.NEGATIVE_INFINITY
  const want = MODEL_ROLE_TAGS[role]
  const matched = matchedRoleTags(role, c.tags ?? [])
  // 视觉环节宁可不选（返回 null 让调用方回落），也不拿纯文本模型去读图
  if (role === "vision" && matched.length === 0) return Number.NEGATIVE_INFINITY
  let score = 0
  for (const t of matched) score += Math.max(ROLE_TAG_BASE - want.indexOf(t), 1)
  if (c.profileSource === "user" && matched.length > 0) score += USER_TAGGED_BONUS
  if (c.cooling) score -= COOLING_PENALTY
  return score
}

/** 全量排名（已剔除硬性排除项）；同分：个人配置 > 平台内置 > 候选原顺序 */
export function rankModelsForRole<T>(role: ModelRole, candidates: RoleCandidate<T>[]): RolePick<T>[] {
  const scored: ScoredPick<T>[] = []
  ;(candidates ?? []).forEach((c, idx) => {
    const score = scoreRoleCandidate(role, c)
    if (!Number.isFinite(score)) return
    scored.push({ item: c.item, score, matchedTags: matchedRoleTags(role, c.tags ?? []), personal: !!c.personal, idx })
  })
  scored.sort((a, b) => b.score - a.score || Number(b.personal) - Number(a.personal) || a.idx - b.idx)
  return scored.map((s) => ({ item: s.item, score: s.score, matchedTags: s.matchedTags }))
}

/** 最优候选；无任何可用候选时返回 null（调用方决定回落口径） */
export function pickModelForRole<T>(role: ModelRole, candidates: RoleCandidate<T>[]): RolePick<T> | null {
  const ranked = rankModelsForRole(role, candidates)
  return ranked.length ? ranked[0] : null
}

// ---------------------------------------------------------------------------
// ModelRef 适配层：把网关模型清单 + 本地画像 / 健康档案编成候选
// ---------------------------------------------------------------------------

/** 路由依赖（全部可选；不传 = 只用内置知识表 + 名称推断，纯离线可测） */
export interface ModelRefRoutingDeps {
  /** 用户手动标注（modelMetaLocal.readModelMeta） */
  userMetaOf?: (ref: ModelRef) => { specialty?: string; tags?: string[] } | null | undefined
  /** 会话内冷却中（modelFailover.isChannelCooling / configCoolingKey） */
  coolingOf?: (ref: ModelRef) => boolean
  /** 长期实测不可用档案（modelHealth.getModelHealth） */
  unavailableOf?: (ref: ModelRef) => boolean
}

export function buildRoleCandidates(refs: ModelRef[], deps?: ModelRefRoutingDeps): RoleCandidate<ModelRef>[] {
  return (refs ?? []).map((ref) => {
    let meta: { specialty?: string; tags?: string[] } | null | undefined
    try {
      meta = deps?.userMetaOf?.(ref)
    } catch {
      /* 本地标注读取失败（隐私模式 / 脏数据）不得影响选模型，降级为无标注 */
      meta = null
    }
    const { profile, source } = resolveModelProfile(ref.modelId, meta?.specialty, meta?.tags)
    return {
      item: ref,
      modelId: ref.modelId,
      tags: profile?.tags ?? [],
      profileSource: source,
      cooling: safeFlag(() => deps?.coolingOf?.(ref)),
      unavailable: safeFlag(() => deps?.unavailableOf?.(ref)),
      personal: ref.source === "personal",
    }
  })
}

/** 依赖回调可能读本地存储而抛错，此处置为「无该状态」而不是让选模型整体崩掉 */
function safeFlag(fn: () => boolean | undefined): boolean {
  try {
    return !!fn()
  } catch {
    return false
  }
}

/** 指定环节的最优 ModelRef；无可用候选返回 null */
export function pickModelRefForRole(role: ModelRole, refs: ModelRef[], deps?: ModelRefRoutingDeps): ModelRef | null {
  return pickModelForRole(role, buildRoleCandidates(refs, deps))?.item ?? null
}

/** 一次性算好五个环节的选型含依据（供 hook useMemo 缓存，避免每次渲染重算） */
export function buildRolePickMap(
  refs: ModelRef[],
  deps?: ModelRefRoutingDeps,
): Record<ModelRole, RolePick<ModelRef> | null> {
  const candidates = buildRoleCandidates(refs, deps)
  const out = {} as Record<ModelRole, RolePick<ModelRef> | null>
  for (const role of MODEL_ROLE_ORDER) out[role] = pickModelForRole(role, candidates)
  return out
}

/** 只要选型结果的便捷视图（= buildRolePickMap 去掉依据） */
export function buildRoleModelMap(refs: ModelRef[], deps?: ModelRefRoutingDeps): Record<ModelRole, ModelRef | null> {
  const picks = buildRolePickMap(refs, deps)
  const out = {} as Record<ModelRole, ModelRef | null>
  for (const role of MODEL_ROLE_ORDER) out[role] = picks[role]?.item ?? null
  return out
}

/**
 * 「本环节实际用哪个模型」的统一口径：
 *   - 用户手选了具体模型（auto=false）→ 全部环节都用他选的那个，自动路由不得覆盖
 *   - 自动模式（auto=true）→ 用本环节选型；该环节无可用候选时回落到手选 / 默认
 */
export function resolveRoleModelRef(
  role: ModelRole,
  auto: boolean,
  manualRef: ModelRef | null,
  roleMap: Record<ModelRole, ModelRef | null>,
): ModelRef | null {
  if (!auto) return manualRef
  return roleMap[role] ?? manualRef
}

// ---------------------------------------------------------------------------
// 自动档在模型选择器里的哨兵值
// ---------------------------------------------------------------------------

export const AUTO_MODEL_KEY = "__auto__"
export const AUTO_MODEL_LABEL = "自动 · 按环节智能选择"

export function isAutoModelKey(key: string | null | undefined): boolean {
  return key === AUTO_MODEL_KEY
}

/** 工具栏就地提示：自动档当前给本环节挑了谁、凭什么（让用户能一眼判断是否要手改） */
export function rolePickHint(role: ModelRole, ref: ModelRef | null, matchedTags: string[] = []): string {
  const label = MODEL_ROLE_LABEL[role]
  if (!ref) return `自动（${label}）：没有匹配的可用模型，请手动选一个`
  const tags = matchedTags.length ? ` · 命中 ${matchedTags.slice(0, 2).join("/")}` : ""
  return `自动（${label}）→ ${modelRefLabel(ref)}${tags}`
}

/** 取某环节的匹配标签（仅用于提示文案，不参与选型） */
export function matchedTagsForRole(role: ModelRole, refs: ModelRef[], deps?: ModelRefRoutingDeps): string[] {
  return pickModelForRole(role, buildRoleCandidates(refs, deps))?.matchedTags ?? []
}

/**
 * 流水线步骤 → 该步骤主要用到的模型角色（只用于工具栏提示；实际调用按每次调用的 role）。
 * 步骤口径见 bidTypes.PIPELINE_STEPS：1 招标文件 / 2 解析报告 / 3 正文编制 / 4 查重 /
 * 5 废标检查 / 6 模拟评标 / 7 归档。
 */
export function roleForStep(step: number): ModelRole {
  switch (step) {
    case 3:
      return "longform"
    // 第 4/5/6 步（查重复判 / 废标比对 / 模拟评标）都是「拿全文逐条判定」，
    // 失败模式是漏判而不是超时，所以用推理 + 长上下文档，而不是解析的快速档。
    case 4:
    case 5:
    case 6:
      return "judge"
    default:
      return "extract"
  }
}

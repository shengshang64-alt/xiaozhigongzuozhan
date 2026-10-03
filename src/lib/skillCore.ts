// ---------------------------------------------------------------------------
// skillCore — 全站技能带入核心逻辑
// SCOPE_CATALOG（功能点目录）/ loadSkillsForScope（按功能点拉用户技能）
// skillPromptBlock（拼「## 用户指定工作技能」提示词块）/ parseSkillPlaceholders（空位解析）
// + 模块级 scope 注册表：页面 hook 注册技能块 getter，各 AI 生成函数按 scope 取块
//   追加到 system prompt 末尾，避免在超大 hook 里逐层传 props / 改依赖数组。
// ---------------------------------------------------------------------------
import {
  assistantApiFetch,
  extractTemplateSlots,
  fillTemplate,
  PRESET_SKILLS,
  type AssistantListResponse,
  type SkillRow,
} from "@/lib/assistantCore"

/** 全站功能点 scope 枚举 */
export type SkillScope =
  | "assistant"
  | "solution-outline"
  | "solution-chapter"
  | "solution-rewrite"
  | "checklist-match"
  | "bid-parse"
  | "bid-outline"
  | "bid-chapter"
  | "bid-deviation"
  | "bid-defense"
  | "ppt-deck"
  | "quote-draft"
  | "customer-profile"
  | "customer-follow"
  | "kb-qa"

export interface ScopeDef {
  scope: SkillScope
  label: string
}

/** 15 个功能点目录（含中文标签），技能表单「适用功能点」多选与选择器展示都以此为准 */
export const SCOPE_CATALOG: ScopeDef[] = [
  { scope: "assistant", label: "小智对话" },
  { scope: "solution-outline", label: "方案大纲" },
  { scope: "solution-chapter", label: "方案正文" },
  { scope: "solution-rewrite", label: "方案改写" },
  { scope: "checklist-match", label: "清单 AI 匹配" },
  { scope: "bid-parse", label: "标书解析" },
  { scope: "bid-outline", label: "标书大纲" },
  { scope: "bid-chapter", label: "标书正文" },
  { scope: "bid-deviation", label: "偏离表" },
  { scope: "bid-defense", label: "讲标答辩" },
  { scope: "ppt-deck", label: "PPT 生成" },
  { scope: "quote-draft", label: "报价草稿" },
  { scope: "customer-profile", label: "客户画像" },
  { scope: "customer-follow", label: "客户跟进" },
  { scope: "kb-qa", label: "知识库问答" },
]

const ALL_SCOPE_VALUES: string[] = SCOPE_CATALOG.map((s) => s.scope)

export function scopeLabel(scope: string): string {
  return SCOPE_CATALOG.find((s) => s.scope === scope)?.label ?? scope
}

/**
 * 归一化技能行的 applicable_scopes：
 * - 非数组 / 空数组 / 无有效值 → 存量兼容，视为只在「小智对话」生效
 * - "all" 视为全功能点生效（保留原值，由过滤逻辑识别）
 */
export function normalizeScopes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ["assistant"]
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== "string") continue
    const t = v.trim()
    if (!t) continue
    if (t === "all" || ALL_SCOPE_VALUES.includes(t)) {
      if (!out.includes(t)) out.push(t)
    }
  }
  return out.length ? out : ["assistant"]
}

/** 按功能点拉取当前用户可用的技能行（用户隔离 + scope 过滤，"all" 全通过） */
export async function loadSkillsForScope(scope: SkillScope, userId: string): Promise<SkillRow[]> {
  if (!userId) return []
  const resp = await assistantApiFetch<AssistantListResponse<SkillRow>>(
    `/api/assistant_skills?rh_user_id=${encodeURIComponent(userId)}&page=1&perPage=200`,
  )
  const items = resp?.items ?? []
  return items.filter((row) => {
    const scopes = normalizeScopes(row.applicable_scopes)
    return scopes.includes("all") || scopes.includes(scope)
  })
}

/**
 * 预置技能（系统内置、开箱即用）归一为 SkillRow，按 scope 过滤。
 * id 加 `preset:` 前缀：与用户自定义技能（PocketBase 行）隔离、且跨加载稳定，
 * 避免 useScopeSkills 的「裁剪失效勾选」误删预置项的勾选态。
 */
export function presetSkillsForScope(scope: SkillScope): SkillRow[] {
  return PRESET_SKILLS.filter((p) => p.scopes.includes("all") || p.scopes.includes(scope)).map((p) => ({
    id: `preset:${p.id}`,
    rh_user_id: "preset",
    skill_name: p.name,
    prompt_template: p.template,
    created: "",
    applicable_scopes: p.scopes,
    description: p.desc,
  }))
}

/**
 * 拼「## 用户指定工作技能」提示词块：
 * - 按用户勾选顺序编号
 * - 模板 {{空位}} 用 filledVars[skillId][slot] 填充（未填回退为空位名，与 fillTemplate 一致）
 */
export function skillPromptBlock(
  skills: SkillRow[],
  filledVars: Record<string, Record<string, string>>,
): string {
  if (!skills.length) return ""
  const lines: string[] = [
    "",
    "## 用户指定工作技能",
    "在完成本次任务的基础上，按顺序应用以下用户指定的工作技能：",
  ]
  skills.forEach((sk, i) => {
    const vars = filledVars[sk.id] ?? {}
    lines.push(`${i + 1}. 「${sk.skill_name}」：${fillTemplate(sk.prompt_template, vars)}`)
  })
  return lines.join("\n")
}

/** 解析技能模板里的 {{空位}}（与小智对话既有空位解析同一实现，保证一致） */
export function parseSkillPlaceholders(template: string): string[] {
  return extractTemplateSlots(template)
}

/**
 * R128：裁剪已失效的技能勾选（技能被删除 / 适用功能点被改走）。
 *
 * 预置技能（id 带 `preset:` 前缀）是同步常量，任何时候都能校验；自定义技能行要等接口返回，
 * 所以 customLoaded===false 时必须保留非预置 id——否则首屏可选池只有预置项，会把
 * localStorage 里持久化的自定义勾选当场裁掉，紧接着的持久化 effect 再把空选回写，
 * 用户「刷新一次页面，之前带过的技能就没了」，且 AI 生成实际少带技能却无任何提示。
 * 返回按原顺序过滤后的新数组；未发生变化时长度与入参一致，调用方据此决定要不要换 state 引用。
 */
export function pruneSkillSelection(
  ids: readonly string[],
  availableIds: readonly string[],
  customLoaded: boolean,
): string[] {
  const avail = new Set(availableIds)
  return ids.filter((id) => avail.has(id) || (!customLoaded && !id.startsWith("preset:")))
}

/**
 * R129：统计「已勾选但当前不在可选池里」的技能 id（按原顺序返回）。
 *
 * 自定义技能拉取失败（或未到达）时，勾选仍保存在 localStorage，但生成链路只注入池内命中的技能，
 * 缺的那几个会被静默丢弃——用户以为「技能带上了」实际少带。picker 用同一口径把缺口显式化，
 * 并配合「重试」入口恢复。预置项任何时候都在池里，不会被误计。
 */
export function missingSelectedIds(
  ids: readonly string[],
  availableIds: readonly string[],
): string[] {
  const avail = new Set(availableIds)
  return ids.filter((id) => !avail.has(id))
}


// ---------------------------------------------------------------------------
// system prompt 注入
// ---------------------------------------------------------------------------

export interface ChatLikeMessage {
  role: string
  content: string | unknown[]
}

/** 把技能块追加到 messages 里第一条 system 消息末尾；没有 system 则头部补一条 */
export function injectSkillBlock<T extends ChatLikeMessage>(messages: T[], block: string): T[] {
  if (!block) return messages
  const idx = messages.findIndex((m) => m.role === "system")
  if (idx === -1) {
    return [{ role: "system", content: block.trimStart() } as unknown as T, ...messages]
  }
  const next = messages.slice()
  const cur = next[idx]
  const curText = typeof cur.content === "string" ? cur.content : ""
  next[idx] = { ...cur, content: `${curText}\n${block}` } as unknown as T
  return next
}

// ---------------------------------------------------------------------------
// 模块级 scope 注册表（参照 studioLlm 的模块变量模式）
// 页面 hook 用 useScopeSkills 注册 {getBlock, getCount}；
// llmGenerate / 计费文案按 scope 取块与数量，无需改函数签名以外的任何依赖。
// ---------------------------------------------------------------------------

export interface ScopeSkillSource {
  getBlock: () => string
  getCount: () => number
}

const scopeRegistry = new Map<SkillScope, ScopeSkillSource>()

export function registerScopeSkills(scope: SkillScope, source: ScopeSkillSource): void {
  scopeRegistry.set(scope, source)
}

export function unregisterScopeSkills(scope: SkillScope, source: ScopeSkillSource): void {
  if (scopeRegistry.get(scope) === source) scopeRegistry.delete(scope)
}

export function skillBlockFor(scope?: SkillScope | null): string {
  if (!scope) return ""
  return scopeRegistry.get(scope)?.getBlock() ?? ""
}

export function skillCountFor(scope?: SkillScope | null): number {
  if (!scope) return 0
  return scopeRegistry.get(scope)?.getCount() ?? 0
}

/** 计费确认文案后缀：选了技能时追加「，带入 n 个技能」 */
export function skillCostSuffix(scope?: SkillScope | null): string {
  const n = skillCountFor(scope)
  return n > 0 ? `，带入 ${n} 个技能` : ""
}

// ---------------------------------------------------------------------------
// 技能选择持久化（localStorage，按 scope 分 key）
// ---------------------------------------------------------------------------

export const SKILL_SEL_PREFIX = "xz_skill_sel_"

export interface SkillSelection {
  ids: string[]
  vars: Record<string, Record<string, string>>
}

export function loadSkillSelection(scope: SkillScope): SkillSelection {
  try {
    const raw = window.localStorage.getItem(`${SKILL_SEL_PREFIX}${scope}`)
    if (!raw) return { ids: [], vars: {} }
    const parsed = JSON.parse(raw) as Partial<SkillSelection>
    const ids = Array.isArray(parsed.ids) ? parsed.ids.filter((v) => typeof v === "string") : []
    const vars: Record<string, Record<string, string>> = {}
    if (parsed.vars && typeof parsed.vars === "object") {
      for (const [k, v] of Object.entries(parsed.vars)) {
        if (v && typeof v === "object") {
          vars[k] = Object.fromEntries(
            Object.entries(v as Record<string, unknown>).filter(([, vv]) => typeof vv === "string"),
          ) as Record<string, string>
        }
      }
    }
    return { ids, vars }
  } catch {
    return { ids: [], vars: {} }
  }
}

export function saveSkillSelection(scope: SkillScope, sel: SkillSelection): void {
  try {
    window.localStorage.setItem(`${SKILL_SEL_PREFIX}${scope}`, JSON.stringify(sel))
  } catch {
    // 隐私模式等场景静默降级，不影响功能
  }
}

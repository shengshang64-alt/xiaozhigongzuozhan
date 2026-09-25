// 小智助手共享领域模块：数据协议、取数指令、记忆抽取、system prompt 组装。
// 全屏对话页（useAssistant）与悬浮迷你聊天窗共用。

import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import { formatKbHitsForAssistant, listKbDocs, searchKbDocs, visibleKbDocs } from "@/lib/kbCore"
import { KB_QA_DIRECT_PREFIX, listKbQaPairs, matchQaPair, visibleQaPairs } from "@/lib/kbQa"

// ---------------------------------------------------------------------------
// 基础请求（走 __pb 代理自定义路由）
// ---------------------------------------------------------------------------

export async function assistantApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getPocketBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...vibexAuthHeaders(),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { httpStatus?: number }
    err.httpStatus = res.status
    throw err
  }
  return (await res.json()) as T
}

export type AssistantListResponse<T> = { items: T[]; page: number; perPage: number; totalItems: number }

const LLM_ERROR_ZH: Record<string, string> = {
  timeout: "小智处理超时（可能服务器繁忙），请稍后重试",
  not_found: "请求未能到达小智，请检查网络后重试",
  rh_login_required: "请先登录 RunningHub 后再使用小智",
  insufficient_balance: "RunningHub 账户余额不足，请充值后重试",
}

export function mapAssistantLlmError(error?: string): string {
  if (!error) return "小智这轮回答失败了，请稍后重试"
  const mapped = LLM_ERROR_ZH[error]
  if (mapped) return mapped
  // B2：已是可读中文的兜底串直接透传；未收录错误码 / 裸英文串（如 "failed"、"HTTP 500"）
  // 替换为中文通用文案，避免把原始码透给用户
  if (/[一-龥]/.test(error)) return error
  return "小智这轮回答失败了，请稍后重试"
}

// ---------------------------------------------------------------------------
// PB 行类型（字段名与 collection 100% 一致，snake_case）
// ---------------------------------------------------------------------------

export interface SessionRow {
  id: string
  rh_user_id: string
  session_title: string
  pinned: boolean
  context_path: string
  created: string
  updated: string
}

export interface MessageRow {
  id: string
  rh_user_id: string
  session_id: string
  role: string
  content: string
  created: string
}

export interface MemoryRow {
  id: string
  rh_user_id: string
  memory_group: string
  content: string
  source: string
  created: string
}

export interface SkillRow {
  id: string
  rh_user_id: string
  skill_name: string
  prompt_template: string
  created: string
  /** 适用功能点 scope 列表（json 字段）；缺省/空 = 存量技能，仅「小智对话」生效 */
  applicable_scopes?: string[]
  /** 技能说明（可选） */
  description?: string
}

/** 界面上展示的一条聊天消息 */
export interface ChatMsg {
  id: string
  role: "user" | "assistant"
  content: string
  /** A2-9：发送失败的占位消息，流里展示重试按钮，不参与上下文 */
  failed?: boolean
  /** R62/⑤：本条由哪个预设技能发出（仅会话内存，不持久化——采用是即时动作） */
  skillName?: string
}

// ---------------------------------------------------------------------------
// 记忆分组
// ---------------------------------------------------------------------------

export type MemoryGroup = "preference" | "habit" | "fact"

export const MEMORY_GROUPS: { key: MemoryGroup; label: string; desc: string }[] = [
  { key: "preference", label: "工作偏好", desc: "喜欢的输出风格、格式与口径" },
  { key: "habit", label: "工作习惯", desc: "日常工作节奏与流程习惯" },
  { key: "fact", label: "事实备忘", desc: "需要长期记住的客观事实" },
]

export function memoryGroupLabel(group: string): string {
  return MEMORY_GROUPS.find((g) => g.key === group)?.label ?? "其他"
}

/** 记忆去重键：分组 + 内容（忽略首尾空白与内部多余空格） */
export function memoryRowsDedupeKey(group: string, content: string): string {
  return `${group}::${(content ?? "").trim().replace(/\s+/g, " ").toLowerCase()}`
}

// ---------------------------------------------------------------------------
// 页面联动
// ---------------------------------------------------------------------------

export const PAGE_NAMES: Record<string, string> = {
  "/": "工作台首页",
  "/solution-studio": "方案编制页",
  "/bid-workspace": "标书工作页",
  "/ppt-quote": "PPT 与报价页",
  "/model-config": "模型配置页",
  "/intel-center": "情报中心页",
  "/customer-management": "客户管理页",
  "/knowledge": "知识库页",
  "/assistant": "小智助手页",
}

export function pageLabel(path: string | null | undefined): string | null {
  if (!path) return null
  return PAGE_NAMES[path] ?? null
}

/** 悬浮球在各页面记录最近的业务页路径，供全屏对话页做联动上下文 */
export const LAST_BIZ_PATH_KEY = "xz_last_biz_path"

// ---------------------------------------------------------------------------
// 站内取数协议
// ---------------------------------------------------------------------------

interface DataSourceDef {
  label: string
  badge: string
  fields: string[]
  /** 走聚合接口而不是标准 list 路由 */
  intel?: boolean
  /** B3：金额类字段单位注解（field → 单位说明），digest 拼装时注入避免 LLM 错读量级 */
  fieldNotes?: Record<string, string>
  /** B3：追加在 digest 末尾的单位口径说明行 */
  digestNote?: string
  extra?: (row: Record<string, unknown>) => Record<string, unknown>
}

export const DATA_SOURCES: Record<string, DataSourceDef> = {
  todos: { label: "待办事项", badge: "正在查看你的待办事项…", fields: ["content", "done", "created"] },
  projects: {
    label: "项目",
    badge: "正在查看你的项目数据…",
    fields: ["project_name", "project_type", "hospital", "progress", "deadline", "notes"],
  },
  customers: {
    label: "客户档案",
    badge: "正在查看你的客户数据…",
    fields: ["hospital_name", "hospital_type", "level", "region", "key_departments", "last_follow_at", "notes"],
  },
  opportunities: {
    label: "商机",
    badge: "正在查看你的商机数据…",
    fields: ["opp_name", "customer_name", "stage", "expected_amount", "expected_close_date", "next_action", "lost_reason", "created"],
    // B3：expected_amount 单位是元，与投标域 bid_amount（万元）并存，必须显式注解防 LLM 错读量级
    fieldNotes: { expected_amount: "预计金额（元）" },
    digestNote: "单位说明：expected_amount 为预计金额，单位是「元」；如数据中出现 bid_amount，那是中标金额，单位是「万元」，两者量级不同请勿混用。",
  },
  follow_records: {
    label: "跟进记录",
    badge: "正在查看你的跟进记录…",
    fields: ["record_type", "content", "stage_change", "created"],
  },
  solutions: {
    label: "方案",
    badge: "正在查看你的方案数据…",
    fields: ["solution_name", "solution_type", "hospital", "doc_status", "created"],
  },
  bid_projects: {
    label: "投标项目",
    badge: "正在查看你的投标项目…",
    fields: ["project_name", "hospital", "tender_no", "bid_open_date", "stage", "created"],
  },
  quotes: {
    label: "报价单",
    badge: "正在查看你的报价数据…",
    fields: ["quote_name", "ref_type", "ref_name", "version", "tax_note", "created"],
  },
  ppt_decks: {
    label: "PPT",
    badge: "正在查看你的 PPT 数据…",
    fields: ["deck_name", "deck_type", "audience", "duration_min", "created"],
  },
  intel_items: {
    label: "行业情报",
    badge: "正在查看最近的行业情报…",
    fields: ["title", "source_name", "item_type", "region", "published_at", "summary"],
    intel: true,
  },
  checklists: {
    label: "建设清单",
    badge: "正在查看你的建设清单…",
    fields: ["checklist_name", "hospital", "total_amount", "source_mode", "created"],
    extra: (row) => ({ items_count: Array.isArray(row.items) ? row.items.length : 0 }),
  },
  competitors: {
    label: "竞品档案",
    badge: "正在查看竞品档案数据…",
    fields: ["name", "positioning", "products", "strengths", "weaknesses", "threat_notes", "summary", "keywords"],
  },
  kb_docs: {
    label: "知识库文档",
    badge: "正在检索知识库文档…",
    fields: ["title", "folder_path", "visibility", "summary"],
  },
}

export const DATA_SOURCE_KEYS = Object.keys(DATA_SOURCES)

/** 按取数指令实时拉取当前用户的站内数据并压缩成摘要文本（失败静默降级）。
 * question：用户本轮问题，kb_docs 源用它做本地检索打分。 */
export async function fetchSiteData(key: string, userId: string, question?: string): Promise<string> {
  const def = DATA_SOURCES[key]
  if (!def) return "（未知数据源，无法提供数据）"
  if (key === "kb_docs") {
    try {
      // 轮次 D-3：先匹配弹药库——high 置信直答（前缀哨兵让调用方跳过后续 LLM），medium 注入标准答案
      let standardAnswer: string | null = null
      try {
        const pairs = await listKbQaPairs()
        const approved = visibleQaPairs(pairs, userId).filter((p) => p.status === "approved")
        const match = matchQaPair(question ?? "", approved)
        if (match && match.level === "high") {
          return `${KB_QA_DIRECT_PREFIX}这个问题命中了团队弹药库的标准答案（本次不产生 AI 费用），请把它原样转达给用户：\n\n${match.pair.answer}`
        }
        if (match && match.level === "medium") {
          standardAnswer = `问题：${match.pair.question}\n答案：${match.pair.answer}`
        }
      } catch {
        /* 弹药库读取失败静默降级，照常走文档检索 */
      }
      const rows = await listKbDocs()
      const visible = visibleKbDocs(rows, userId)
      if (visible.length === 0 && !standardAnswer) {
        return "用户的知识库目前是空的（还没有上传任何文档）。请如实告知，并建议用户上传相关文档，不要编造知识库内容。"
      }
      const hits = searchKbDocs(visible, question ?? "", 5)
      return formatKbHitsForAssistant(hits, question ?? "", standardAnswer)
    } catch {
      return `「${def.label}」数据暂时读取失败，请基于已知信息回答，并告知用户该数据本轮无法获取。`
    }
  }
  try {
    const path = def.intel
      ? `/api/intel/items?page=1&per_page=20`
      : `/api/${key}?rh_user_id=${encodeURIComponent(userId)}&page=1&perPage=100`
    const data = await assistantApiFetch<AssistantListResponse<Record<string, unknown>>>(path)
    const rows = (data.items ?? []).slice(0, 60).map((r) => {
      const out: Record<string, unknown> = {}
      for (const f of def.fields) {
        const v = r[f]
        if (v === undefined || v === null || v === "") continue
        // B3：带单位注解的字段在 digest 里用「字段（注解）」做键，LLM 直接读到量级
        const key = def.fieldNotes?.[f] ? `${f}（${def.fieldNotes[f]}）` : f
        out[key] = typeof v === "string" && v.length > 120 ? `${v.slice(0, 120)}…` : v
      }
      if (def.extra) Object.assign(out, def.extra(r))
      return out
    })
    if (rows.length === 0) return `用户的「${def.label}」当前没有数据（空列表）。`
    const json = JSON.stringify(rows)
    const note = def.digestNote ? `\n${def.digestNote}` : ""
    return json.length > 6000 ? `${json.slice(0, 6000)}…（数据过多已截断）${note}` : `${json}${note}`
  } catch {
    return `「${def.label}」数据暂时读取失败，请基于已知信息回答，并告知用户该数据本轮无法获取。`
  }
}

// ---------------------------------------------------------------------------
// 回复解析：取数指令 + 记忆抽取块（解析失败一律静默降级，绝不泄漏标记）
// ---------------------------------------------------------------------------

export interface ParsedReply {
  /** 去掉全部协议标记后可直接展示的正文 */
  display: string
  /** 合法的取数指令 key（已过滤未知数据源） */
  fetchKeys: string[]
  /** 记忆抽取结果 */
  memories: { group: MemoryGroup; content: string }[]
}

const FETCH_RE = /\[\[\s*FETCH\s*[:：]\s*([a-zA-Z_]+)\s*\]\]/g
const MEMORY_BLOCK_RE = /\[\[\s*MEMORY\s*\]\]([\s\S]*?)\[\[\s*\/\s*MEMORY\s*\]\]/
const MEMORY_LINE_RE = /^(preference|habit|fact)\s*[|｜]\s*(.+)$/
const STRAY_MARKER_RE = /\[\[\s*\/?\s*(?:FETCH|MEMORY)\s*(?:[:：][^\]]*)?\]\]/g
// R009（D-2）：一次性 fact 过滤护栏（协议 1.4「一次性状态禁止沉淀为 fact」的执行层）
import { filterMemories, MEMORY_FACT_RULES } from "./memoryGuard.ts"

export function parseAssistantReply(raw: string): ParsedReply {
  let text = typeof raw === "string" ? raw : ""
  const memories: { group: MemoryGroup; content: string }[] = []

  const block = text.match(MEMORY_BLOCK_RE)
  if (block) {
    for (const line of block[1].split("\n")) {
      const m = line.trim().match(MEMORY_LINE_RE)
      if (!m) continue
      const content = m[2].trim()
      if (content && content.length <= 120) {
        memories.push({ group: m[1] as MemoryGroup, content })
      }
    }
  }
  // R009（D-2）：过滤一次性 fact（协议既有禁令的执行层，不影响 preference/habit）
  const kept = filterMemories(memories)
  const keptSet = new Set(kept)
  const memoriesFiltered = memories.filter((m) => keptSet.has(m))
  memories.length = 0
  memories.push(...memoriesFiltered)
  // 去掉闭合块；未闭合的 [[MEMORY]] 起全部裁掉（防泄漏）
  text = text.replace(MEMORY_BLOCK_RE, "")
  text = text.replace(/\[\[\s*MEMORY\s*\]\][\s\S]*$/g, "")

  const fetchKeys: string[] = []
  for (const m of text.matchAll(FETCH_RE)) {
    const key = m[1].toLowerCase()
    if (DATA_SOURCES[key] && !fetchKeys.includes(key)) fetchKeys.push(key)
  }
  text = text.replace(FETCH_RE, "")
  // 兜底清掉任何残留协议标记
  text = text.replace(STRAY_MARKER_RE, "")

  return { display: text.trim(), fetchKeys, memories }
}

// ---------------------------------------------------------------------------
// system prompt 组装
// ---------------------------------------------------------------------------

export function buildSystemPrompt(memories: MemoryRow[], contextLabel: string | null): string {
  const memoryLines = memories.length
    ? memories.map((m) => `- [${memoryGroupLabel(m.memory_group)}] ${m.content}`).join("\n")
    : "（暂无，后续对话中注意观察并按记忆抽取协议沉淀）"

  const contextLine = contextLabel
    ? `用户当前正在使用「${contextLabel}」，回答时可结合该页面的工作语境。`
    : "用户当前未联动具体页面。"

  const sourceLines = DATA_SOURCE_KEYS.map((k) => `- ${k}（${DATA_SOURCES[k].label}）`).join("\n")

  return `你是「小智」，医疗软件售前工程师的专属站内助手。用简体中文回答，专业、简洁、可落地，适度使用 Markdown（标题/列表/表格/代码块）排版。

# 你对用户的长期记忆（回答时自然运用，不要逐条复述）
${memoryLines}

# 当前页面上下文
${contextLine}

# 站内取数协议（严格遵守）
你可以查阅用户在本系统内的真实业务数据。可用数据源标识：
${sourceLines}
当回答必须依赖这些真实数据时，本次回复**只输出一行**取数指令，格式严格为：
[[FETCH:opportunities]]
（把 opportunities 换成所需数据源标识；一次回复最多一条；系统会把数据回填给你，你再继续作答；用户一轮提问最多取数 2 次，之后必须基于已有数据回答。）
其中 kb_docs（知识库）会按用户当前问题自动检索团队知识库与个人笔记，回填最相关文档的标题、摘要与命中片段；用户问「知识库里关于 X 有什么资料」这类问题时优先取这个源，回填为空就如实说没找到，不要编造。
领域硬事实题强制接地（最高优先级 · P0：在本助手内优先于一般风格指令）：当用户问的是医疗信息化的「领域硬事实」——评审/测评标准与分值门槛（如电子病历分级评价各级要求、互联互通测评标准、等级保护 2.0 要求）、政策法规指标、建设规模/预算标准等——必须先输出 [[FETCH:kb_docs]] 取知识库接地后再作答；知识库无足够依据时，如实说明「团队知识库暂无此标准的确切资料，建议以国家卫健委/官方最新发布文件为准」，严禁凭模型记忆编造具体分值、等级门槛、指标数值或政策条款编号。
不需要站内数据时正常回答，绝不要输出取数指令，也不要凭空编造用户的业务数据。

# 记忆抽取协议（严格遵守）
每轮**最终回答**的末尾，另起一行输出记忆抽取块，格式严格为：
[[MEMORY]]
preference|值得长期记住的用户偏好
habit|值得长期记住的工作习惯
fact|值得长期记住的事实备忘
[[/MEMORY]]
分组标识只能是 preference / habit / fact，每条一行、用竖线分隔；没有值得记住的内容时输出空块（只有首尾两行标记）。只沉淀长期有效的信息，不要把一次性任务细节写进去。取数指令回复中不要带记忆块。
${MEMORY_FACT_RULES}`
}

// ---------------------------------------------------------------------------
// 技能（预置 + 自定义模板）
// ---------------------------------------------------------------------------

export interface PresetSkill {
  id: string
  name: string
  desc: string
  template: string
  /** 预置技能默认适用功能点 */
  scopes: string[]
}

export const PRESET_SKILLS: PresetSkill[] = [
  {
    id: "follow-email",
    name: "写客户跟进邮件",
    desc: "按背景快速生成专业友好的跟进邮件",
    template: "请帮我写一封给「{{客户名称}}」的跟进邮件，背景是：{{跟进背景}}。语气专业友好，控制在 200 字以内。",
    scopes: ["customer-follow", "assistant"],
  },
  {
    id: "weekly-report",
    name: "生成周报总结",
    desc: "按「完成/进行中/计划/风险」四段输出周报",
    template: "请根据我本周的工作情况生成一份售前周报总结，本周重点工作：{{本周重点工作}}。输出「本周完成 / 进行中 / 下周计划 / 风险与求助」四段。",
    scopes: ["assistant"],
  },
  {
    id: "solution-outline",
    name: "方案大纲构思",
    desc: "为医院项目快速构思方案章节结构",
    template: "请为「{{医院名称}}」的{{方案类型}}项目构思一份方案大纲，给出章节结构和每章要点，需要时可以先查阅我的客户与方案数据。",
    scopes: ["solution-outline", "assistant"],
  },
  {
    id: "tender-points",
    name: "招标文件要点梳理",
    desc: "梳理评分办法、资质要求与废标项",
    template: "请帮我梳理这份招标要求的要点：{{粘贴招标关键内容}}。输出「评分办法 / 资质要求 / 废标项 / 技术参数要点」四部分。",
    scopes: ["bid-parse", "assistant"],
  },
  {
    id: "competitor-analysis",
    name: "竞品深度分析",
    desc: "对指定竞品进行SWOT与应对策略分析",
    template: "请对「{{竞品名称}}」进行深度竞品分析，重点关注：{{分析维度，如产品对比/AI能力/信创布局}}。请先查阅竞品档案和关联情报，再给出：①与我方的直接竞争重叠点 ②其近半年战略变化 ③投标现场应对建议。",
    scopes: ["competitors", "assistant"],
  },
  {
    id: "visit-checklist",
    name: "客户拜访准备清单",
    desc: "拜访前的资料、议程与提问清单",
    template: "我准备拜访「{{客户名称}}」，请生成一份拜访准备清单，包括资料准备、议程建议、关键提问和注意事项，可以先查阅我的客户档案数据。",
    scopes: ["customer-profile", "assistant"],
  },
  {
    id: "ppt-report-expert",
    name: "医院售前汇报 PPT 专家",
    desc: "金字塔叙事 + 管理层视角的汇报结构方法论",
    template:
      "你是面向医院管理层（院长/信息科/分管院领导）的资深售前汇报顾问，制作汇报 PPT 时严格遵循以下方法论：\n" +
      "1）先因后果的叙事骨架：整份按「形势与痛点 → 政策/评级压力 → 总体蓝图 → 分期路径 → 投资与价值 → 保障与下一步」推进（金字塔原理，结论先行），开场 1-2 页就把核心主张说清楚。\n" +
      "2）一页一个观点：每页只承载一个可被反驳的判断，标题写成结论句；要点之间是并列或递进，不混层。\n" +
      "3）按对象调焦：院领导关注战略、合规风险、投入产出与标杆案例；信息科关注架构、集成、数据治理、运维与实施风险；同一主题对不同对象换不同侧重。\n" +
      "4）数据讲故事：能用量化指标不用形容词，关键成效给前后对比（如门诊等候时长、病历评级达标率），图表配一句结论性解读。\n" +
      "5）降低AI味与可落地：举具体系统/模块/场景，避免空泛排比；路径页给出阶段目标、里程碑与责任主体。",
    scopes: ["ppt-deck", "bid-defense", "assistant"],
  },
]

const SLOT_RE = /\{\{(.+?)\}\}/g

export function extractTemplateSlots(template: string): string[] {
  const slots: string[] = []
  for (const m of template.matchAll(SLOT_RE)) {
    if (!slots.includes(m[1].trim())) slots.push(m[1].trim())
  }
  return slots
}

export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(SLOT_RE, (_all, slot: string) => {
    const v = (values[slot.trim()] ?? "").trim()
    return v || slot.trim()
  })
}

// ---------------------------------------------------------------------------
// B1：失败消息 localStorage 持久化（零 collection 变更）
// 成功消息走后端 assistant_messages 表；失败消息（错误文案 + 重试上下文）按
// 会话桶单独存 localStorage，刷新后恢复合并显示，清空会话 / 删除会话同步清。
// ---------------------------------------------------------------------------

export interface FailedMsgEntry {
  /** 失败占位消息 id（与 ChatMsg.id 一致） */
  id: string
  /** 触发失败的用户提问原文（重试上下文，恢复时一并还原用户气泡） */
  userText: string
  /** 失败错误文案 */
  content: string
  /** 失败时刻（ms），恢复时与后端消息按时间合并排序 */
  at: number
}

/** 尚未建会话（首问即失败）时的存储桶 */
export function failedPendingBucket(floatMode: boolean): string {
  return floatMode ? "__pending_float__" : "__pending__"
}

/** B1：失败消息保留 24 小时，读取时顺手剪枝（与 Home todos_done prune 同模式） */
export const FAILED_MSG_TTL_MS = 24 * 60 * 60_000

function failedMsgStoreKey(uid: string): string {
  return `xz_failed_msgs_${uid}`
}

function pruneFailedEntries(list: FailedMsgEntry[], now: number): FailedMsgEntry[] {
  return list.filter(
    (e) =>
      e &&
      typeof e.id === "string" &&
      typeof e.content === "string" &&
      typeof e.at === "number" &&
      now - e.at < FAILED_MSG_TTL_MS,
  )
}

export function readFailedMsgStore(uid: string): Record<string, FailedMsgEntry[]> {
  try {
    const raw = window.localStorage.getItem(failedMsgStoreKey(uid))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, FailedMsgEntry[]>
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const now = Date.now()
    const out: Record<string, FailedMsgEntry[]> = {}
    for (const [bucket, list] of Object.entries(parsed)) {
      if (!Array.isArray(list)) continue
      // B1：过期条目（>24h）读取时顺手剪枝，不再复活
      const valid = pruneFailedEntries(list, now)
      if (valid.length) out[bucket] = valid
    }
    return out
  } catch {
    return {}
  }
}

export function writeFailedMsgStore(uid: string, store: Record<string, FailedMsgEntry[]>): void {
  try {
    // B1：写入前同步剪枝过期条目并丢弃空桶，避免过期数据滞留
    const now = Date.now()
    const fresh: Record<string, FailedMsgEntry[]> = {}
    for (const [bucket, list] of Object.entries(store)) {
      if (!Array.isArray(list)) continue
      const valid = pruneFailedEntries(list, now)
      if (valid.length) fresh[bucket] = valid
    }
    if (Object.keys(fresh).length === 0) window.localStorage.removeItem(failedMsgStoreKey(uid))
    else window.localStorage.setItem(failedMsgStoreKey(uid), JSON.stringify(fresh))
  } catch {
    /* 存储不可用时静默降级（仅本次会话内可见失败消息） */
  }
}

/** 追加一条失败消息到指定桶（桶内保留最近 20 条防无限增长） */
export function appendFailedMsg(uid: string, bucket: string, entry: FailedMsgEntry): void {
  const store = readFailedMsgStore(uid)
  store[bucket] = [...(store[bucket] ?? []), entry].slice(-20)
  writeFailedMsgStore(uid, store)
}

export function readFailedMsgs(uid: string, bucket: string): FailedMsgEntry[] {
  return readFailedMsgStore(uid)[bucket] ?? []
}

export function clearFailedMsgs(uid: string, bucket: string): void {
  const store = readFailedMsgStore(uid)
  if (!(bucket in store)) return
  delete store[bucket]
  writeFailedMsgStore(uid, store)
}

/** 首问失败后建出会话时，把 pending 桶整体迁移到会话桶 */
export function migrateFailedMsgs(uid: string, fromBucket: string, toBucket: string): void {
  const store = readFailedMsgStore(uid)
  const entries = store[fromBucket]
  if (!entries || entries.length === 0 || fromBucket === toBucket) return
  store[toBucket] = [...(store[toBucket] ?? []), ...entries].slice(-20)
  delete store[fromBucket]
  writeFailedMsgStore(uid, store)
}

/** B1：单条消除（失败气泡「×」/ 重试只删被操作那条）——按 id 遍历全部桶移除 */
export function removeFailedMsg(uid: string, id: string): void {
  const store = readFailedMsgStore(uid)
  let changed = false
  for (const bucket of Object.keys(store)) {
    const next = (store[bucket] ?? []).filter((e) => e.id !== id)
    if (next.length !== (store[bucket] ?? []).length) {
      changed = true
      if (next.length) store[bucket] = next
      else delete store[bucket]
    }
  }
  if (changed) writeFailedMsgStore(uid, store)
}

/** B1+B3：成功轮次后清理——遍历全部桶（会话桶 / 整页 pending / 浮窗 pending）移除 userText
 * 相同的旧失败条目。浮窗失败被整页合并后重试成功时，float 桶里的源条目一并清掉，
 * 杜绝下次整页挂载 mergeFloatPendingIntoPending 时二次复活（bucket 参数保留兼容调用方签名） */
export function removeFailedMsgsByUserText(uid: string, _bucket: string, userText: string): void {
  const text = (userText ?? "").trim()
  if (!text) return
  const store = readFailedMsgStore(uid)
  let changed = false
  for (const bucket of Object.keys(store)) {
    const list = store[bucket]
    if (!Array.isArray(list) || list.length === 0) continue
    const next = list.filter((e) => (e.userText ?? "").trim() !== text)
    if (next.length !== list.length) {
      changed = true
      if (next.length) store[bucket] = next
      else delete store[bucket]
    }
  }
  if (changed) writeFailedMsgStore(uid, store)
}

/** B1：整页 assistant 挂载时把悬浮窗 pending 桶并入整页 pending 桶（单向、按 id 去重，float 侧存储不动） */
export function mergeFloatPendingIntoPending(uid: string): void {
  const store = readFailedMsgStore(uid)
  const floatEntries = store["__pending_float__"]
  if (!floatEntries || floatEntries.length === 0) return
  const existing = new Set((store["__pending__"] ?? []).map((e) => e.id))
  const additions = floatEntries.filter((e) => !existing.has(e.id))
  if (additions.length === 0) return
  store["__pending__"] = [...(store["__pending__"] ?? []), ...additions].slice(-20)
  writeFailedMsgStore(uid, store)
}

/** 恢复为消息流条目：用户提问气泡 + 带失败标识的助手占位（可重试） */
export function failedMsgsToChatMsgs(entries: FailedMsgEntry[]): ChatMsg[] {
  const msgs: ChatMsg[] = []
  for (const e of entries) {
    if (e.userText) msgs.push({ id: `${e.id}_user`, role: "user", content: e.userText })
    msgs.push({ id: e.id, role: "assistant", content: e.content, failed: true })
  }
  return msgs
}

// ---------------------------------------------------------------------------
// 会话排序（置顶优先，其次按时间倒序）
// ---------------------------------------------------------------------------

export function sortSessions(rows: SessionRow[]): SessionRow[] {
  return [...rows].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
    return a.created < b.created ? 1 : a.created > b.created ? -1 : 0
  })
}

export function sessionTitle(text: string, floatMode: boolean): string {
  if (floatMode) return "快捷会话"
  const t = text.trim().replace(/\s+/g, " ")
  return t.length > 20 ? `${t.slice(0, 20)}…` : t || "新对话"
}

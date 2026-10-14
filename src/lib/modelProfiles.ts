// ---------------------------------------------------------------------------
// R-038 模型擅长知识表（纯前端，零后端）
//
// 用途：模型配置页展示每个模型「擅长什么」，帮助用户选型。
// 三层数据源（优先级从高到低）：
//   ① 用户手动标注（存在 modelMetaLocal 里，跨设备不共享）
//   2️⃣ 内置知识表（本文件 KNOWN_MODEL_PROFILES，覆盖常见模型）
//   3️⃣ 名称推断兜底（inferFromName，vision/flash/pro 等通用词根）
//
// 维护约定：新增/更新模型描述时优先扩表；描述保持一句人话（≤30 字），
// 突出「适合什么场景」而不是「参数多大」。禁止写死项目名/医院名。
// ---------------------------------------------------------------------------

/** 单条内置模型画像 */
export interface ModelProfile {
  /** 一句话擅长描述（人话，≤30 字） */
  specialty: string
  /** 场景标签（用于 UI 徽标；1-3 个，通用词） */
  tags: string[]
  /** R-040：内置额度参考（如 "Go: 1,350 请求/5h · 月 $60"），编辑弹窗可一键填入 */
  quotaHint?: string
}

/**
 * 已知模型画像表（key 支持精确匹配 + 前缀匹配）
 * 覆盖 opencode / 常见 OpenAI 兼容接口的高频模型
 */
export const KNOWN_MODEL_PROFILES: Record<string, ModelProfile> = {
  // ---- DeepSeek 系 ----
  "deepseek-v4-flash": { specialty: "长上下文稳定，代码与结构化输出强", tags: ["长上下文", "代码"] },
  "deepseek-v4-flash-vision-exp": { specialty: "多模态视觉理解（实验版），可读图/表/截图", tags: ["视觉", "实验"] },
  "deepseek-flash": { specialty: "轻量快速，日常问答与草稿", tags: ["快速", "轻量"] },
  "deepseek-v4.1-flash": { specialty: "v4 迭代版，兼顾速度与质量", tags: ["长上下文", "通用"] },
  "deepseek-v4-pro": { specialty: "复杂推理与数学，长文方案首选", tags: ["推理", "长文"] },
  "deepseek-chat": { specialty: "通用对话，中文表达自然", tags: ["对话", "通用"] },
  "deepseek-reasoner": { specialty: "推理链模式，数学/逻辑题", tags: ["推理"] },

  // ---- GLM 智联系 ----
  "glm-5.1": { specialty: "通用中文对话与写作", tags: ["中文", "通用"] },
  "glm-5.2": { specialty: "长文档理解，标书/方案友好", tags: ["长文档", "中文"] },
  "glm-5.3": { specialty: "多模态与工具调用增强", tags: ["多模态", "工具"] },
  "glm-4-plus": { specialty: "上一代旗舰，稳定通用", tags: ["通用"] },
  "glm-4v": { specialty: "视觉理解，可读图", tags: ["视觉"] },

  // ---- Grok xAI 系 ----
  "grok-4.6": { specialty: "长上下文 + 联网检索，事实类强", tags: ["长上下文", "检索"] },
  "grok-4.7": { specialty: "推理与代码双强，风格直白", tags: ["推理", "代码"] },
  "grok-2": { specialty: "通用对话，幽默风格", tags: ["对话"] },
  "grok-vision": { specialty: "视觉理解 + 图表解析", tags: ["视觉"] },

  // ---- OpenAI GPT 系 ----
  "gpt-5.5": { specialty: "长文本生成稳定，适合方案、标书与 PPT 内容", tags: ["长文", "通用"] },
  "gpt-5": { specialty: "通用旗舰，写作与推理均衡", tags: ["通用", "推理"] },
  "gpt-5-mini": { specialty: "轻量快速，成本敏感场景", tags: ["快速", "经济"] },
  "gpt-4o": { specialty: "多模态全能，图文混合", tags: ["多模态"] },
  "o1": { specialty: "深度推理，数学/代码/复杂逻辑", tags: ["推理"] },
  "o3": { specialty: "推理旗舰，长链条思考", tags: ["推理"] },

  // ---- Claude 系 ----
  "claude-sonnet-4-5": { specialty: "长文档 + 代码，写作自然", tags: ["长文档", "代码"] },
  "claude-opus-4-1": { specialty: "复杂任务旗舰，推理与写作俱佳", tags: ["推理", "写作"] },
  "claude-haiku-4-5": { specialty: "极速响应，短任务", tags: ["快速"] },

  // ---- 通义 / Kimi / MiniMax 等国产 ----
  "qwen3-max": { specialty: "中文长文档，标书场景成熟", tags: ["中文", "长文档"] },
  "qwen3-coder": { specialty: "代码专用，工程实践强", tags: ["代码"] },
  "kimi-k2": { specialty: "200 万长上下文，超大文档", tags: ["超长上下文"] },
  "moonshot-v1-128k": { specialty: "128k 长文档理解", tags: ["长文档"] },
  "minimax-abab6.5s": { specialty: "中文对话，情感表达自然", tags: ["中文", "对话"] },
}

/**
 * 名称推断兜底：从模型 id 里的通用词根猜擅长方向。
 * 精度低但覆盖广，只在 KNOWN_MODEL_PROFILES 未命中时使用。
 */
export function inferFromName(modelId: string): ModelProfile | null {
  const id = (modelId ?? "").toLowerCase()
  if (!id) return null
  // 视觉类
  if (/vision|vl\b|image|multimodal|_v-|\bv\b/.test(id)) {
    return { specialty: "多模态视觉理解（名称推断）", tags: ["视觉"] }
  }
  // 推理类
  if (/reason|think|o1|o3|cot/.test(id)) {
    return { specialty: "深度推理链（名称推断）", tags: ["推理"] }
  }
  // 快速/轻量
  if (/flash|lite|mini|nano|small|turbo|fast/.test(id)) {
    return { specialty: "轻量快速，成本敏感场景（名称推断）", tags: ["快速"] }
  }
  // 旗舰/大杯
  if (/pro|max|plus|ultra|premium|large|big/.test(id)) {
    return { specialty: "旗舰大杯，复杂任务（名称推断）", tags: ["旗舰"] }
  }
  // 代码
  if (/coder|code|codellama|starcoder/.test(id)) {
    return { specialty: "代码专用（名称推断）", tags: ["代码"] }
  }
  // 长上下文
  if (/128k|200k|1m|long|context/.test(id)) {
    return { specialty: "长上下文场景（名称推断）", tags: ["长上下文"] }
  }
  return null
}

/** 画像来源标签（UI tooltip 用） */
export type ProfileSource = "user" | "known" | "inferred" | "none"

/**
 * 三层合并：用户标注 > 内置表 > 名称推断。
 * @param modelId 模型 id
 * @param userSpecialty 用户手动填的擅长（可空）
 * @param userTags 用户手动填的标签（可空）
 */
export function resolveModelProfile(
  modelId: string,
  userSpecialty?: string,
  userTags?: string[],
): { profile: ModelProfile | null; source: ProfileSource } {
  if (userSpecialty && userSpecialty.trim()) {
    return {
      profile: { specialty: userSpecialty.trim(), tags: userTags ?? [] },
      source: "user",
    }
  }
  // 精确匹配
  const exact = KNOWN_MODEL_PROFILES[modelId]
  if (exact) return { profile: exact, source: "known" }
  // 前缀匹配（如 deepseek-v4-flash-2026-01 命中 deepseek-v4-flash）
  const lower = (modelId ?? "").toLowerCase()
  for (const key of Object.keys(KNOWN_MODEL_PROFILES)) {
    if (lower.startsWith(key.toLowerCase())) {
      return { profile: KNOWN_MODEL_PROFILES[key], source: "known" }
    }
  }
  // 名称推断
  const inferred = inferFromName(modelId)
  if (inferred) return { profile: inferred, source: "inferred" }
  return { profile: null, source: "none" }
}
// ------------------------------ R-041 opencode 额度量化参考 ------------------------------
// 数据源：opencode.ai 定价页（2026-10-14 快照）。
// 结构化：tier + requests5h + monthlyUsd；-1 表示 ∞（限时免费）。
// 用途：编辑弹窗里"一键填入额度"；模型行展示量化徽标；筛选时视为"有额度"。

export interface QuotaReference {
  displayName: string
  go5h: number
  goMonthly: number
  goPlus5h?: number
  goPlusMonthly?: number
  unlimited?: boolean
}

export const OPENCODE_QUOTA_REFERENCE: Record<string, QuotaReference> = {
  "kimi-k3": { displayName: "Kimi K3", go5h: 110, goMonthly: 15, goPlus5h: 440, goPlusMonthly: 60 },
  "kimi-k2.7-code": { displayName: "Kimi K2.7 Code", go5h: 1350, goMonthly: 60, goPlus5h: 4050, goPlusMonthly: 180 },
  "space-bunny": { displayName: "Space Bunny", go5h: 3130, goMonthly: 30, goPlus5h: 12500, goPlusMonthly: 120 },
  "minimax-m3": { displayName: "MiniMax M3", go5h: 3200, goMonthly: 60, goPlus5h: 9600, goPlusMonthly: 180 },
  "claude-haiku-5.5": { displayName: "Claude Haiku 5.5", go5h: 3850, goMonthly: 15, goPlus5h: 15380, goPlusMonthly: 60 },
  "gpt-6-luna": { displayName: "GPT 6 Luna", go5h: 4230, goMonthly: 15, goPlus5h: 16920, goPlusMonthly: 60 },
  "qwen3.7-plus": { displayName: "Qwen3.7 Plus", go5h: 4300, goMonthly: 60, goPlus5h: 12900, goPlusMonthly: 180 },
  "glm-5.3-flash": { displayName: "GLM-5.3-Flash", go5h: 6320, goMonthly: 60, goPlus5h: 18960, goPlusMonthly: 180 },
  "mimo-v2.6-flash": { displayName: "MiMo-V2.6-Flash", go5h: 30100, goMonthly: 60, goPlus5h: 60200, goPlusMonthly: 120 },
  "deepseek-v4.1-flash": { displayName: "DeepSeek V4.1 Flash", go5h: 34670, goMonthly: 80, goPlus5h: 69330, goPlusMonthly: 160 },
  "muse-spark-1.3-contributor": { displayName: "Muse Spark 1.3 Contributor", go5h: 45300, goMonthly: 60, goPlus5h: 90600, goPlusMonthly: 120 },
  "longcat-2.5-preview-free": { displayName: "LongCat 2.5 Preview Free", go5h: -1, goMonthly: -1, unlimited: true },
  "step-5-preview-free": { displayName: "Step 5 Preview Free", go5h: -1, goMonthly: -1, unlimited: true },
  "cat-jam-free": { displayName: "Cat Jam Free", go5h: -1, goMonthly: -1, unlimited: true },
}

function normModelKey(s: string): string {
  return (s ?? "").toLowerCase().replace(/[\s_.]+/g, "-").replace(/[^a-z0-9-]/g, "")
}

/** R-041 结构化额度建议（编辑弹窗一键填入用） */
export interface QuotaSuggestion {
  tier: "go" | "go_plus" | "unlimited"
  requests5h: number
  monthlyUsd: number
  /** 展示串（如 "Go: 34,670/5h · $80/月"） */
  display: string
  /** 完整展示串（含 Go Plus 档，tooltip 用） */
  displayFull: string
}

/** 根据模型 id 查内置额度参考；未命中返回 null */
export function resolveQuotaHint(modelId: string): QuotaSuggestion | null {
  if (!modelId) return null
  const lower = modelId.toLowerCase()
  const norm = normModelKey(modelId)
  let entry = OPENCODE_QUOTA_REFERENCE[lower] ?? OPENCODE_QUOTA_REFERENCE[norm]
  if (!entry) {
    for (const [k, v] of Object.entries(OPENCODE_QUOTA_REFERENCE)) {
      if (normModelKey(v.displayName) === norm) { entry = v; break }
      if (norm && norm.startsWith(normModelKey(k))) { entry = v; break }
    }
  }
  if (!entry) return null
  if (entry.unlimited) {
    return { tier: "unlimited", requests5h: -1, monthlyUsd: -1, display: "∞ 限时免费", displayFull: "∞ 限时免费" }
  }
  const primary = `Go: ${entry.go5h.toLocaleString()}/5h · $${entry.goMonthly}/月`
  const full = entry.goPlus5h
    ? `${primary} · Go Plus: ${entry.goPlus5h.toLocaleString()}/5h · $${entry.goPlusMonthly}/月`
    : primary
  return { tier: "go", requests5h: entry.go5h, monthlyUsd: entry.goMonthly, display: primary, displayFull: full }
}

/** 数字 → 展示串（-1 视为 ∞；undefined → "—"） */
export function formatQuotaNumber(n: number | undefined, suffix = ""): string {
  if (n == null) return "—"
  if (n < 0) return "∞"
  return n.toLocaleString() + suffix
}

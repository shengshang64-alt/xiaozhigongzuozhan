import type { LlmMessage } from "@/lib/llm"
import { chatViaGateway, costTextForModel, type ModelRef } from "@/lib/modelGateway"
import { injectSkillBlock, skillBlockFor, type SkillScope } from "@/lib/skillCore"

// ---------------------------------------------------------------------------
// 方案编制 / 建设清单共用的 LLM 调用封装（统一模型网关，错误中文化）
// ---------------------------------------------------------------------------

const LLM_ERROR_ZH: Record<string, string> = {
  timeout: "AI 生成超时（可能服务器繁忙），请稍后重试",
  not_found: "请求未能到达 AI，请检查网络后重试",
  rh_login_required: "AI 生成服务暂不可用，请检查模型配置",
  insufficient_balance: "RunningHub 账户余额不足，请充值后重试",
}

// 当前页面选用的模型（由页面 hook 内的模型选择器同步；null = 平台内置默认）
let studioModelRef: ModelRef | null = null

export function setStudioModelRef(ref: ModelRef | null) {
  studioModelRef = ref
}

export function currentStudioCostText(): string {
  return costTextForModel(studioModelRef)
}

export async function llmGenerate(messages: LlmMessage[], maxTokens: number, scope?: SkillScope): Promise<string> {
  const r = await chatViaGateway({
    modelRef: studioModelRef,
    messages: injectSkillBlock(messages, skillBlockFor(scope)),
    page: "solution-studio",
    max_tokens: maxTokens,
  })
  if (r.needsLogin) throw new Error(LLM_ERROR_ZH.rh_login_required)
  if (!r.ok || r.status !== "success" || !r.text) {
    // B5 附带：未收录错误码 / 裸英文串替换为中文通用文案，可读中文串透传（与小智侧同口径）
    const raw = r.error ?? ""
    throw new Error(LLM_ERROR_ZH[raw] ?? (/[一-龥]/.test(raw) ? raw : "生成失败，请稍后重试"))
  }
  return r.text
}

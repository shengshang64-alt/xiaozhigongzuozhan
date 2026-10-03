import type { LlmMessage } from "@/lib/llm"
import { chatViaGateway, costTextForModel, type ModelRef } from "@/lib/modelGateway"
import { injectSkillBlock, skillBlockFor, type SkillScope } from "@/lib/skillCore"
import { localizeLlmError } from "@/lib/llmError"

// ---------------------------------------------------------------------------
// 方案编制 / 建设清单共用的 LLM 调用封装（统一模型网关，错误中文化）
// ---------------------------------------------------------------------------

// 文案基表在 @/lib/llmError（全站唯一），此处只覆写方案编制专属措辞
const STUDIO_ERROR_ZH: Record<string, string> = {
  timeout: "AI 生成超时（可能服务器繁忙），请稍后重试",
  rh_login_required: "AI 生成服务暂不可用，请检查模型配置",
}

// 当前页面选用的模型（由页面 hook 内的模型选择器同步；null = 平台内置默认）
let studioModelRef: ModelRef | null = null

export function setStudioModelRef(ref: ModelRef | null) {
  studioModelRef = ref
}

export function currentStudioCostText(): string {
  return costTextForModel(studioModelRef)
}

export async function llmGenerate(
  messages: LlmMessage[],
  maxTokens: number,
  scope?: SkillScope,
  temperature?: number,
): Promise<string> {
  const r = await chatViaGateway({
    modelRef: studioModelRef,
    messages: injectSkillBlock(messages, skillBlockFor(scope)),
    page: "solution-studio",
    max_tokens: maxTokens,
    // docs/07 §5.2（第 19 轮）：与标书侧同口径——仅确定性任务显式传 temperature，未传保持模型默认
    temperature,
  })
  if (r.needsLogin) throw new Error(STUDIO_ERROR_ZH.rh_login_required)
  if (!r.ok || r.status !== "success" || !r.text) {
    // B5 附带口径已收敛到 @/lib/llmError：未收录错误码 / 裸英文串一律中文兜底，
    // 可读中文串透传（与小智侧同源，不再各抄一份）
    throw new Error(
      localizeLlmError(r.error, { generic: "生成失败，请稍后重试", copy: STUDIO_ERROR_ZH }),
    )
  }
  return r.text
}

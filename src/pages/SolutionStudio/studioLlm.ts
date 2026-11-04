import type { LlmMessage } from "@/lib/llm"
import { chatViaGateway, costTextForModel, type ModelRef } from "@/lib/modelGateway"
import { injectSkillBlock, skillBlockFor, type SkillScope } from "@/lib/skillCore"
import { localizeLlmError } from "@/lib/llmError"
import { planTimeoutDegrade } from "@/lib/llmDegrade"

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
  const payload = injectSkillBlock(messages, skillBlockFor(scope))
  const r = await chatViaGateway({
    modelRef: studioModelRef,
    messages: payload,
    page: "solution-studio",
    max_tokens: maxTokens,
    // docs/07 §5.2（第 19 轮）：与标书侧同口径——仅确定性任务显式传 temperature，未传保持模型默认
    temperature,
  })
  if (r.needsLogin) throw new Error(STUDIO_ERROR_ZH.rh_login_required)
  if (r.ok && r.status === "success" && r.text?.trim()) return r.text

  // 2026-11-04（审计 P1）：方案侧此前**没有**超时降级——同样 8192 token 的长文预算撞上
  // 网关 300s 红线时，标书侧能靠「关思考 + 逐次折半预算」跑完，方案侧直接整章 failed，
  // 用户会当成「方案工作室坏了」。这里补上与标书侧同源的阶梯（数字口径都在 modelGateway /
  // llmDegrade 定义一次，不在本文件另写一套）。
  const plan = planTimeoutDegrade(false, r.error, maxTokens)
  if (plan.retry) {
    let last = r
    for (const budget of plan.budgets) {
      const degraded = await chatViaGateway({
        modelRef: studioModelRef,
        messages: payload,
        page: "solution-studio",
        max_tokens: budget,
        temperature,
        disableThinking: true, // 关思考：推理型模型把预算耗在思考上是超时主因之一
      })
      if (degraded.needsLogin) throw new Error(STUDIO_ERROR_ZH.rh_login_required)
      if (degraded.ok && degraded.status === "success" && degraded.text?.trim()) return degraded.text
      last = degraded
      // 非超时的明确失败（内容审核 / 余额 / 鉴权）立即停：继续降档只是重复扣费
      if (!degraded.ok && !planTimeoutDegrade(false, degraded.error, budget).retry) break
    }
    // 全部档位都失败：透出最后一档的真实原因，而不是笼统的「生成失败」
    throw new Error(localizeLlmError(last.error, { generic: "生成失败，请稍后重试", copy: STUDIO_ERROR_ZH }))
  }

  throw new Error(
    localizeLlmError(r.error, { generic: "生成失败，请稍后重试", copy: STUDIO_ERROR_ZH }),
  )
}

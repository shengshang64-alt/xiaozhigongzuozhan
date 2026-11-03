import { clipText } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"

// ---------------------------------------------------------------------------
// 循环 2 批 1-2：LLM JSON 修复重试（本地宽松解析失败后的一次「只修语法不改内容」修复调用）
// R65 提示词搬迁第一批，自 bidTypes.ts 原样搬迁：只搬不改字
// ---------------------------------------------------------------------------

export const PROMPT_VERSION = 1

/**
 * JSON 语法修复 prompt——只修语法不改内容、截断按已有结构补全闭合、只输出 JSON；
 * 费用由各入口原有的费用确认覆盖，不单独弹确认。
 */
export function buildJsonRepairMessages(badText: string): LlmMessage[] {
  const system = [
    "你是 JSON 语法修复器。用户给你一段 JSON 解析失败的模型输出文本，你只允许修复语法问题，严禁改动任何内容。",
    "修复铁律：",
    "1. 只修语法不改内容：不得增删改任何字段名、字段值、数字与文字表述；",
    "2. 文本被截断时按已有结构补全闭合括号与引号，严禁编造新条目或新内容；",
    "3. 剥除 markdown 代码围栏与解释文字，只保留 JSON 本体；",
    "4. 只输出修复后的合法 JSON，禁止任何解释、禁止代码围栏。",
  ].join("\n")
  const user = `【解析失败的原始输出】\n${clipText(badText ?? "", 12000)}\n\n请输出修复后的合法 JSON。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

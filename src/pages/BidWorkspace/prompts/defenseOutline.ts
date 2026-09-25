// ---------------------------------------------------------------------------
// R66 提示词搬迁第二批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { clipText } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

export function buildDefenseOutlineMessages(
  outlineText: string,
  scoringText: string,
  globalFacts: string,
): LlmMessage[] {
  const system = [
    "你是医疗信息化行业资深售前顾问，请基于标书大纲与评分办法，为投标人编排讲标 PPT 大纲。",
    "大纲铁律：",
    "1. 输出 10-15 页，页序按「项目理解 → 总体方案 → 各分系统亮点（按评分办法分值权重排序，高分项靠前）→ 实施与质保 → 服务承诺」组织；",
    "2. 每页 bullets 3-6 条，内容取自标书对应章节，突出量化承诺与差异化亮点，禁止空泛形容词；",
    "3. page_title 简短（15 字内），能直接当 PPT 页标题。",
    globalFacts,
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"pages":[{"page_title":"","bullets":["",""]}]}',
  ]
    .filter((s) => s.trim())
    .join("\n")
  const user = `【标书大纲树】\n${clipText(outlineText, 8000)}\n\n【评分办法（含分值权重）】\n${clipText(scoringText, 4000) || "（未提供）"}\n\n请输出讲标大纲 JSON。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

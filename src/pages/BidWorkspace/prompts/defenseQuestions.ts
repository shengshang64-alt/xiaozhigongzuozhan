// ---------------------------------------------------------------------------
// R66 提示词搬迁第二批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { clipText } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

export function buildDefenseQuestionsMessages(
  scoringText: string,
  voidText: string,
  chapterDigest: string,
  globalFacts: string,
): LlmMessage[] {
  const system = [
    "你是医疗信息化项目资深评标专家兼投标顾问，需要在开标后的讲标答辩环节前，帮投标人预判评标专家最可能提出的问题。",
    "出题铁律：",
    "1. 出 8-15 个问题，优先覆盖：评分办法中分值高的项、废标条款相关项、标书章节中可能被追问的细节（参数响应、实施方案、售后承诺、业绩资质）；",
    "2. intent 一句话写明该问题考察什么；answer_points 给 3-5 条答辩要点，必须基于标书实际内容，禁止编造标书中没有的承诺；",
    "3. ref_chapters 列出回答该问题可引用的标书章节标题，只能从给定章节标题中选；",
    "4. 问题表述模拟真实评标专家口吻，具体、可追问，禁止空泛。",
    globalFacts,
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"questions":[{"question":"","intent":"","answer_points":["",""],"ref_chapters":[""]}]}',
  ]
    .filter((s) => s.trim())
    .join("\n")
  const user = `【评分办法】\n${clipText(scoringText, 4000) || "（未提供）"}\n\n【废标条款】\n${clipText(voidText, 3000) || "（未提供）"}\n\n【标书章节标题与摘要】\n${clipText(chapterDigest, 9000)}\n\n请出 8-15 个专家问题并输出 JSON。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

import type { DefenseQuestion } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"

// ---------------------------------------------------------------------------
// 答辩应答 prompt（R65 提示词搬迁第一批，自 bidTypes.ts 原样搬迁：只搬不改字）
// ---------------------------------------------------------------------------

export const PROMPT_VERSION = 1

export function buildDefenseAnswerMessages(
  question: DefenseQuestion,
  refChapterText: string,
  globalFacts: string,
): LlmMessage[] {
  const system = [
    "你是医疗信息化项目投标主讲人，正在准备讲标答辩环节的现场应答。",
    "请针对给定专家问题写一段答辩口径的完整答案：200-400 字，口语化但专业，先给结论再分要点展开；内容必须来自标书相关章节的实际表述，禁止编造标书中没有的参数或承诺。",
    globalFacts,
    "直接输出答案正文纯文本，禁止 markdown 符号、禁止解释说明。",
  ]
    .filter((s) => s.trim())
    .join("\n")
  const user = [
    `【专家问题】${question.question}`,
    question.intent ? `【考察点】${question.intent}` : "",
    question.answer_points.length ? `【答辩要点】\n${question.answer_points.map((pt) => `- ${pt}`).join("\n")}` : "",
    `【标书相关章节内容】\n${refChapterText || "（未找到相关正文，请基于答辩要点谨慎作答）"}`,
    "请写出完整答辩答案。",
  ]
    .filter(Boolean)
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

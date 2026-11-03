// ---------------------------------------------------------------------------
// R66 提示词搬迁第二批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { clipText } from "../bidTypes"
import type { DefenseOutlinePage } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

export function buildSpeechNotesMessages(pages: DefenseOutlinePage[], globalFacts: string): LlmMessage[] {
  const system = [
    "你是医疗信息化项目投标主讲人，请为讲标 PPT 大纲撰写讲标稿要点。",
    "撰写铁律：",
    "1. opening 为 150 字内开场白（问候 + 项目理解 + 信心表达），closing 为 100 字内收尾（承诺 + 致谢）；",
    "2. sections 与大纲页一一对应，每页给 2-3 句口语化讲述要点（points），说清这页要讲什么、强调哪个数字，不要照抄 bullets；",
    "3. 全文口语化、像现场讲出来的稿子，禁止书面套话。",
    globalFacts,
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"opening":"","sections":[{"title":"页标题","points":["",""]}],"closing":""}',
  ]
    .filter((s) => s.trim())
    .join("\n")
  const outlineText = pages
    .map((pg, i) => `第${i + 1}页 ${pg.page_title}\n${pg.bullets.map((b) => `- ${b}`).join("\n")}`)
    .join("\n\n")
  const user = `【讲标大纲】\n${clipText(outlineText, 9000)}\n\n请输出讲标稿要点 JSON。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

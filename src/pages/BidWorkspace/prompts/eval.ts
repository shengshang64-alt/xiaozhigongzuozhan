// ---------------------------------------------------------------------------
// R67 提示词搬迁第三批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { clipText, MAX_BID_CHARS, MAX_TENDER_CHARS, extractScoringFromText, clauseMatchesTitle } from "../bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

/** 第六轮升级（改造 6）：逐章「标题+前 400 字摘要」入参；评分办法命中的关键章节注入前 1500 字；瑕疵制扣分 */
export function buildEvalMessages(
  scoringText: string,
  chapters: Chapter[],
  opts?: { globalFacts?: string; outlineText?: string },
): LlmMessage[] {
  const scoringNames = extractScoringFromText(scoringText).map((s) => s.item).filter(Boolean)
  const filled = chapters.map((c, i) => ({ no: i + 1, c })).filter(({ c }) => (c.content ?? "").trim())
  const blocks = filled.map(({ no, c }) => {
    const isKey =
      filled.length === 1 ||
      scoringNames.some((n) => clauseMatchesTitle(n, c.title) || (c.sections ?? []).some((s) => clauseMatchesTitle(n, s)))
    const limit = filled.length === 1 ? MAX_BID_CHARS : isKey ? 1500 : 400
    const body = c.content.replace(/\s+/g, " ").trim().slice(0, limit)
    return `第${no}章 ${c.title}${isKey && filled.length > 1 ? "（评分办法命中的关键章节，附更多内容）" : ""}\n${body}`
  })
  const digest = clipText(blocks.join("\n\n"), MAX_TENDER_CHARS)
  const system = [
    "你是医疗信息化项目评标委员会资深专家，现在要对一份技术标做模拟评标。",
    "评标方法（瑕疵制扣分）：",
    "1. 每个评分项默认满分，再按评分标准逐项检视：每发现一处瑕疵，按评分标准中的扣分阶梯扣分（未响应扣满该档、响应不完整或缺量化承诺按对应档扣、表述笼统酌情轻扣），每项得分不得低于 0 分、不得超过该项分值；",
    "2. 每项 reason 必须引用投标文件中的具体表现（哪一章写了什么、缺了什么承诺或数据），禁止编造评委偏好、禁止使用评分标准之外的扣分理由；",
    "3. suggestion 给出可操作的改进建议（补什么内容、加什么承诺、放什么证明）；",
    "4. summary 给出总体评价：预估得分区间、最大失分风险、3 条最重要的改进方向，并必须附「模拟评标结果仅供参考，实际得分以评标委员会评审为准」的不确定性声明；禁止下「确定中标 / 必然中标」类结论。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"items":[{"scoring_item":"评分项名","max_score":0,"ai_score":0,"reason":"","suggestion":""}],"summary":""}',
  ].join("\n")
  const user = [
    `【评分办法（逐项分值）】\n${scoringText}`,
    opts?.outlineText ? `【投标文件大纲树（仅供定位章节）】\n${clipText(opts.outlineText, 4000)}` : "",
    opts?.globalFacts ?? "",
    `【待评标投标文件内容（逐章摘要，关键章节附更多内容）】\n${digest}`,
    "请逐项打分并输出 JSON。",
  ]
    .filter((s) => s !== "")
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

// ---------------------------------------------------------------------------
// R70 提示词搬迁第六批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { MAX_BID_CHARS, clipText } from "../bidTypes"
import { outlineToText } from "@/pages/SolutionStudio/solutionTypes"
import type { RequirementClause } from "../bidTypes"
import type { Chapter, OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

export function buildDeviationMapMessages(
  clauses: RequirementClause[],
  outlineNodes: OutlineNode[],
  chapters: Chapter[],
  globalFacts?: string,
): LlmMessage[] {
  const clauseLines = clauses.map((c, i) => `${i + 1}. [${c.id}]（${c.source}）${c.text}`).join("\n")
  const chapterLines = chapters
    .map((c, i) => `第${i + 1}章 ${c.title}：${c.content.slice(0, 300).replace(/\n/g, " ")}`)
    .join("\n")
  const system = [
    "你是资深投标顾问，需要为评标专家制作「招标技术条款 ↔ 投标文件响应」技术偏离表，逐条判定投标文件对每条招标技术条款的响应程度。",
    "判定铁律：",
    "1. 对每条条款，结合投标大纲树与各章正文摘要，找出响应最贴切的大纲节点（章/节标题原文），并判定响应程度：完全响应（有实质性响应与量化承诺）/ 部分响应（有响应但不完整、缺量化或打了折扣）/ 偏离（未找到响应或与招标要求不一致）；",
    "2. response_summary 用不超过 80 字概括投标文件的响应内容（引用承诺与指标）；偏离时写明缺口；",
    "3. bid_ref 填响应位置的章-节编号（如「3.2」，按大纲树编号），找不到时留空；",
    "4. 判定要保守：拿不准就标部分响应或偏离，宁可多提醒；clause_id 必须与条款清单一致，每条条款都要有一行，禁止遗漏。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"rows":[{"clause_id":"c1","response_node":"响应的大纲节点标题","response_level":"完全响应","response_summary":"","bid_ref":"3.2"}]}',
  ].join("\n")
  const user = [
    `【招标技术条款清单（共 ${clauses.length} 条）】\n${clipText(clauseLines, MAX_BID_CHARS)}`,
    globalFacts ?? "",
    `【投标文件大纲树（带章-节编号）】\n${outlineToText(outlineNodes ?? [])}`,
    `【投标文件各章正文摘要（标题+前 300 字）】\n${clipText(chapterLines, MAX_BID_CHARS)}`,
    "请逐条判定并输出偏离表 JSON（rows 数组，每条条款一行）。",
  ]
    .filter((s) => s !== "")
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}




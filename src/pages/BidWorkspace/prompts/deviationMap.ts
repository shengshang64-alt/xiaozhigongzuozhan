// ---------------------------------------------------------------------------
// R70 提示词搬迁第六批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// R50（P0-3 长文可见性）：素材从「各章前 300 字摘要 + clipText 截断」改为按条款定向检索的证据包，
//   并逐字内联输入可见性契约——旧口径把「没注入」当成「没响应」，偏离表会据此误判「偏离」。
// R52（2026-10-15 用户裁定）：① 响应内容改「原文响应」——必须是投标文件正文的逐字摘录，
//   不得概括/改写（旧口径让模型写 80 字摘要，专家拿摘要回正文找不到原句）；② 明确一一对应契约
//   （每条条款一行、顺序一致、不得合并或拆分），并新增 evidence_ref 供专家回正文逐字核对。
// ---------------------------------------------------------------------------

import { BID_VISIBILITY_CONTRACT_DEVIATION, bidEvidenceBlock, type BidEvidencePack } from "../bidVisibility"
import { outlineToText } from "@/pages/SolutionStudio/solutionTypes"
import type { RequirementClause } from "../bidTypes"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 3 // R52：原文响应 + 一一对应契约 + evidence_ref（上一版 2 = 证据包 + 可见性契约）

export function buildDeviationMapMessages(
  clauses: RequirementClause[],
  outlineNodes: OutlineNode[],
  evidence: BidEvidencePack,
  globalFacts?: string,
): LlmMessage[] {
  const clauseLines = clauses
    .map((c, i) => `${i + 1}. [${c.id}]（${c.source}）${c.no ? `${c.no} ` : ""}${c.text}`)
    .join("\n")
  const system = [
    "你是资深投标顾问，需要为评标专家制作「招标技术条款 ↔ 投标文件响应」技术偏离表，逐条判定投标文件对每条招标技术条款的响应程度。",
    "判定铁律：",
    "1. 一一对应：每条条款有且仅有一行，clause_id 必须与条款清单一致、顺序与清单一致；禁止遗漏、禁止重复，禁止把多条条款合并成一行，也禁止把一条条款拆成多行；",
    "2. 原文响应（最重要）：response_text 必须是投标文件正文的**原文摘录**——从注入的正文片段里逐字复制连续的一段（可跨句，可用「……」省略中间），一个字都不得改写、概括、翻译、拼接或增删；不得添加原文里没有的承诺、指标或数字；不得把招标要求抄成响应内容。找不到可摘录的原文时，response_text 留空字符串，并把 response_level 判为部分响应；",
    "3. 判定响应程度：完全响应（正文有实质性响应与量化承诺）/ 部分响应（有响应但不完整、缺量化或打了折扣）/ 偏离（正文有明确相反或不满足的表述）；拿不准就判部分响应，宁可多提醒；",
    "4. 定位：response_node 填响应最贴切的大纲节点标题原文（章/节标题）；bid_ref 填该节点在大纲树里的章-节编号（如「3.2」）；evidence_ref 填原文摘录所在正文片段的来源标识（片段标头，如「第3章 售后服务/块2」）；确实找不到时留空字符串。",
    BID_VISIBILITY_CONTRACT_DEVIATION,
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"rows":[{"clause_id":"c1","response_node":"响应的大纲节点标题","response_level":"完全响应","response_text":"从投标文件正文逐字摘录的原文","bid_ref":"3.2","evidence_ref":"第3章 售后服务/块2"}]}',
  ].join("\n")
  const user = [
    `【招标技术条款清单（共 ${clauses.length} 条）】\n${clauseLines}`,
    globalFacts ?? "",
    `【投标文件大纲树（带章-节编号）】\n${outlineToText(outlineNodes ?? [])}`,
    bidEvidenceBlock(evidence, "投标文件正文（按条款定向检索注入的片段）"),
    `请逐条判定并输出偏离表 JSON（rows 数组，${clauses.length} 条条款对应 ${clauses.length} 行，响应内容一律摘录正文原文）。`,
  ]
    .filter((s) => s !== "")
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

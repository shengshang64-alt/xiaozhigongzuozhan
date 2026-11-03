// ---------------------------------------------------------------------------
// R70 提示词搬迁第六批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { BID_STYLE_RULES, FULLTEXT_GUARD_RULES, PARA_SHAPE_RULE, PARAM_RESPONSE_BOUNDARY_RULES, PRE_OUTPUT_SELFCHECK_RULES, PROSE_LINT_RULES, scoringDetailLines, truthPreamble, writtenSectionTitles } from "../bidTypes"
import type { ParseReport, RequirementClause, ScoringItem } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"

// REQ-052 v1→v2：BID_STYLE_RULES 新增「正文编号层次」条（续写路径同步，避免续写把层次写回扁平）
// 2026-10-21 v2→v3：PROSE_LINT_RULES 新增「禁元话语与应答套话」条（续写同步生效）
export const PROMPT_VERSION = 3

export function buildBidContinueMessages(
  projectName: string,
  hospital: string,
  report: ParseReport | null,
  chapterTitle: string,
  chapterNo: number,
  existingContent: string,
  remainBudget: number,
  globalFacts?: string,
  opts?: { clauses?: RequirementClause[]; outlineText?: string; scoring?: ScoringItem[]; tenderFragments?: string },
): LlmMessage[] {
  void report
  // 第八轮改造 3：续写视野增强——已写小节标题清单 + 末尾 1200 字（原为仅末尾 800 字）
  const tail = existingContent.slice(-1200)
  const titles = writtenSectionTitles(existingContent)
  const clauseList = opts?.clauses ?? []
  const scoringDetail = scoringDetailLines(opts?.scoring ?? [])
  const body: string[] = []
  const push = (t: string) => {
    body.push(`${body.length + 1}. ${t}`)
  }
  push("从【已有正文结尾】的最后一段自然衔接：禁止重复、复述或总结已写过的段落，禁止输出结尾原文；")
  push("不得重复已写小节（见【已写小节标题清单】）的主题，围绕尚未展开的实施细节、量化承诺与保障措施继续；")
  push(
    `续写约 ${remainBudget} 字使整章达到篇幅预算；可写内容不足时围绕招标技术需求与评分办法展开实施细节、量化承诺、保障措施、培训与运维安排，禁止自造招标未给的参数数字；`,
  )
  push(
    `本章在全文大纲中的位置：第${chapterNo}章「${chapterTitle}」${opts?.outlineText ? `；完整大纲如下（仅供定位与避免与其他章重复，不要复述）：\n${opts.outlineText}` : "；"}；`,
  )
  push("沿用已有正文的口径与术语；如需新增小节，小节标题行沿用原有编号格式「N.M 小节名」顺延；")
  if (opts?.tenderFragments) {
    push("续写必须优先依据下面【招标原文相关段落】展开，参数、指标以原文为准，与原文冲突的表述一律以原文为准；")
  }
  if (clauseList.length) {
    push(
      `本章须响应的招标要求条款如下，续写部分必须继续逐条落实（已写过的条款不要重复响应）：\n${clauseList.map((c) => `${c.id}. ${c.text}`).join("\n")}`,
    )
  }
  if (scoringDetail) {
    push(`本章须逐条响应的评分细则如下，续写部分写到对应内容时明确点出响应与承诺：\n${scoringDetail}`)
  }
  if (globalFacts) {
    push("续写中出现项目名称、编号、工期、金额等事实信息时必须与【全局事实】一致，禁止编造不同数值；")
  }
  body.push("写作风格硬条款（每条必须遵守）：")
  for (const t of BID_STYLE_RULES) {
    body.push(`${body.length + 1}. ${t}`)
  }
  body.push("全文一致性与合规底线（每条必须遵守）：")
  for (const t of FULLTEXT_GUARD_RULES) {
    body.push(`${body.length + 1}. ${t}`)
  }
  // docs/05 §2 落地（第 14 轮）：续写同样受技术参数响应边界约束，防止续写段落自行加码
  body.push("技术参数响应边界与实质性变更禁令（每条必须遵守）：")
  for (const t of PARAM_RESPONSE_BOUNDARY_RULES) {
    body.push(`${body.length + 1}. ${t}`)
  }
  // docs/07 §5.3/§5.4 落地（第 18 轮）：续写同样受输出前自检与历史缺陷反例约束
  body.push("输出前自检与历史缺陷反例（每条必须遵守）：")
  for (const t of PRE_OUTPUT_SELFCHECK_RULES) {
    body.push(`${body.length + 1}. ${t}`)
  }
  // REQ-022（2026-10-17）：续写是「自动补足 / 继续生成」走的路径，任务本身就是往不够字数的地方灌字
  // （见上一条 push「续写约 N 字使整章达到篇幅预算」）——一条专门灌字的路径若没有段落形态约束，
  // 模型凑预算最省力的做法就是写长段落。实测 608 段超 300 字里相当一部分出自补足而非首次生成。
  // 同时补注 PROSE_LINT_RULES：本文件此前从未注入过它，连老的「每段 200 字以内」也没有。
  body.push("正文段落形态（每条必须遵守）：")
  body.push(`${body.length + 1}. ${PARA_SHAPE_RULE}`)
  body.push("版式与文风硬条款（每条必须遵守，违反即重写）：")
  for (const t of PROSE_LINT_RULES) {
    body.push(`${body.length + 1}. ${t}`)
  }
  body.push(`${body.length + 1}. 只输出续写部分纯文本：禁止 markdown 符号、禁止开场白、禁止复述结尾、禁止收尾总结语。`)
  const system = [
    `你是一位深耕医疗信息化行业十余年的资深投标顾问，正在为投标项目「${projectName}」（采购人：${hospital || "未填写"}）技术标第${chapterNo}章「${chapterTitle}」续写正文。`,
    truthPreamble(),
    "该章正文已写到一半，你的任务是从断点无缝续写：",
    ...body,
  ].join("\n")
  const user = [
    globalFacts ?? "",
    opts?.tenderFragments
      ? `【招标原文相关段落（续写的首要依据，参数、指标、要求以原文为准）】\n${opts.tenderFragments}`
      : "",
    titles.length ? `【已写小节标题清单（不得重复这些主题）】\n${titles.join("\n")}` : "",
    `【已有正文结尾】\n${tail}`,
    "请从断点直接输出续写内容。",
  ]
    .filter((s) => s !== "")
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** 去掉续写开头与现有正文结尾重叠的复述部分，避免追加后段落重复 */
export function stripOverlap(existing: string, continuation: string): string {
  const cont = continuation.trim()
  const base = existing.trimEnd()
  for (const len of [120, 80, 40, 20]) {
    if (base.length >= len && cont.startsWith(base.slice(-len))) return cont.slice(len).trim()
  }
  return cont
}

/** 技术偏离表 AI 映射：条款清单（序号+原文+所属系统）+ 投标大纲树 + 各章正文摘要（前 300 字）+ 全局事实表 → 每行响应判定 */

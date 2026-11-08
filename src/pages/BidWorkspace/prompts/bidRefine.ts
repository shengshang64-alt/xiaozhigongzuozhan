// ---------------------------------------------------------------------------
// R67 提示词搬迁第三批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { scoringDetailLines, truthPreamble, BID_STYLE_RULES, FULLTEXT_GUARD_RULES, PARA_SHAPE_RULE, PARAM_RESPONSE_BOUNDARY_RULES, PRE_OUTPUT_SELFCHECK_RULES, PROSE_LINT_RULES } from "../bidTypes"
import type { BidRefineKind, ScoringItem } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"

// REQ-052 v1→v2：BID_STYLE_RULES 新增「正文编号层次」条（改写/扩写路径同步，避免重写时丢层次）
// 2026-10-21 v2→v3：PROSE_LINT_RULES 新增「禁元话语与应答套话」条（改写/扩写同步生效）
// UX-R3 S11 v3→v4：新增 deai（去 AI 味）精修——PROSE_LINT_RULES 第 9 组句式黑名单的事后精修通道
export const PROMPT_VERSION = 4

/** UX-R3 S11：「🧹 去 AI 味」专用句式黑名单（与 PROSE_LINT_RULES 第 9 组同源，逐条可核对） */
const DEAI_SHAPE_RULES: string[] = [
  "禁升华句式：不得出现「不是……而是……」「不仅是……更是……」「与其说……不如说……」。直接陈述事实（「本项目为……」），不给项目定性拔高。",
  "禁排比凑结构：不得用「一是……二是……三是……」或「首先/其次/再次/最后」串并列要点；分点一律用「（1）（2）（3）」，一条一个独立措施。",
  "禁元话语收口：段末不得用「这一定位决定了……」「上述技术参数均为……」「我公司已全部逐项应答响应」收口——只写可核验的落地承诺（量化指标/责任分工/时限）。",
  "禁态度词：删除「充分知悉/充分理解/高度重视/深刻认识」等表述——评审看措施不看态度。",
  "禁政策堆砌：删除与具体技术实现无关的宏观政策表述（「为贯彻落实……战略」「作为……策源地」「助力……高质量发展」）；确需引用标准时只写标准编号与名称（如「电子病历分级评价五级」「GB/T 22239-2019」）。",
]

/** 改造 2：投标文件口径的改写/扩写/精简 prompt（含全局事实 + 本章评分细则 + 写作风格硬条款） */
export function buildBidRefineMessages(
  kind: BidRefineKind,
  projectName: string,
  hospital: string,
  chapterTitle: string,
  chapterNo: number,
  content: string,
  opts?: { globalFacts?: string; scoring?: ScoringItem[]; tenderFragments?: string },
): LlmMessage[] {
  const action =
    kind === "rewrite"
      ? "改写：保持原有信息量与结构，换用更专业、更符合投标文件口径的表达，消除口语与重复，突出实质性响应与量化承诺"
      : kind === "expand"
        ? "扩写：补充医疗信息化行业细节、量化指标、实施要点与风险考虑，篇幅增加约 50%"
        : kind === "deai"
          ? "去 AI 味：逐句消除 AI 腔（见下方「去 AI 味句式黑名单」），改为工程师口吻的直接陈述——技术参数、指标数值、系统名称、事实口径一律不改，只改表述方式"
          : "精简：压缩到约 60% 篇幅，只保留关键响应内容，不丢失小节结构"
  const scoringDetail = scoringDetailLines(opts?.scoring ?? [])
  const system = [
    `你是医疗信息化行业资深标书编辑，当前处理对象是投标文件《${projectName}》（采购人：${hospital || "未填写"}）第${chapterNo}章「${chapterTitle}」的正文。`,
    truthPreamble(),
    `请对该章正文执行「${action}」。`,
    scoringDetail
      ? `本章须逐条响应的评分细则（改写/扩写时保持并强化对这些细则的响应；精简时禁止删除已响应评分细则的内容）：\n${scoringDetail}`
      : "",
    opts?.globalFacts ? `事实信息必须与下面【全局事实】一致，禁止编造不同数值。\n${opts.globalFacts}` : "",
    opts?.tenderFragments
      ? "处理必须优先依据下面【招标原文相关段落】：扩写补充的参数、指标、要求以原文为准，与原文冲突的表述一律按原文修正。\n【招标原文相关段落】\n" + opts.tenderFragments
      : "",
    "写作风格硬条款（每条必须遵守）：",
    ...BID_STYLE_RULES.map((t, i) => `${i + 1}. ${t}`),
    "全文一致性与合规底线（每条必须遵守）：",
    ...FULLTEXT_GUARD_RULES.map((t, i) => `${i + 1}. ${t}`),
    // docs/05 §2 落地（第 14 轮）：改写/扩写同样不得触碰实质性变更（防止「扩写」把参数改高）
    "技术参数响应边界与实质性变更禁令（每条必须遵守）：",
    ...PARAM_RESPONSE_BOUNDARY_RULES.map((t, i) => `${i + 1}. ${t}`),
    // docs/07 §5.3/§5.4 落地（第 18 轮）：改写/扩写也补输出前自检与历史缺陷反例（只加约束、不改语义）
    "输出前自检与历史缺陷反例（每条必须遵守）：",
    ...PRE_OUTPUT_SELFCHECK_RULES.map((t, i) => `${i + 1}. ${t}`),
    // R-302（2026-10-16 售前/演示反馈）：版式硬条款（AI 套话黑名单 / 禁内联指引 / 标题层级 / 关键章必出表 / 必出甘特图）
    "版式与文风硬条款（每条必须遵守，违反即重写）：",
    ...PROSE_LINT_RULES.map((t, i) => `${i + 1}. ${t}`),
    // REQ-022（2026-10-17）：整章重写/扩写会重新把段落撑大——PROSE_LINT_RULES 只给了句长上限，
    // 句数区间与段落数下限必须单独注入，否则「重写一遍」就等于把段落形态病改回来。
    "正文段落形态（每条必须遵守）：",
    `1. ${PARA_SHAPE_RULE}`,
    // UX-R3 S11：「去 AI 味」只在本通道注入句式黑名单（其余通道不注入，避免改变原有改写行为）
    ...(kind === "deai"
      ? [
          "去 AI 味句式黑名单（逐句核对，命中即改写；技术参数与事实不得改动）：",
          ...DEAI_SHAPE_RULES.map((t, i) => `${i + 1}. ${t}`),
          "去 AI 味硬约束：① 技术参数、指标数值、系统名称、医院名称、标准编号一字不动；② 小节标题行原样保留；③ 不新增任何事实；④ 篇幅与原章相当（±10%），不减内容只换说法。",
        ]
      : []),
    "输出铁律：直接输出处理后的完整正文纯文本，小节标题行保持「N.M 小节名」格式，禁止 markdown 符号、禁止任何解释说明或开场白。",
  ]
    .filter((s) => s !== "")
    .join("\n")
  return [
    { role: "system", content: system },
    { role: "user", content: `【原文】\n${content}` },
  ]
}


/** 快捷评标工具：从「评分项:分值」行文本解析评分办法 */

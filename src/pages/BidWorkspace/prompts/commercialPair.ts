// ---------------------------------------------------------------------------
// R70 提示词搬迁第六批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { COMMERCIAL_SECTION_KEYS, clipText, parseSectionTitle, sectionText, splitParagraphs } from "../bidTypes"
import type { ParseReport } from "../bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

export function buildCommercialSectionText(report: ParseReport | null): string {
  if (!report) return ""
  const blocks: string[] = []
  for (const key of COMMERCIAL_SECTION_KEYS) {
    const text = sectionText(report, key)
    if (!text.trim()) continue
    blocks.push(`【${parseSectionTitle(key)}】\n${text.trim()}`)
  }
  return blocks.join("\n\n")
}

/** 商务关键词：正文段落命中任一即视为含关键商务值（本地捞取，零 AI） */
const COMMERCIAL_KEYWORDS = [
  "金额", "报价", "预算", "万元", "人民币", "付款", "价格", "保证金",
  "工期", "日历天", "交付期", "质保", "保修", "运维期", "维保",
  "人员", "驻场", "团队", "项目经理", "负责人", "年限",
]

/** 商务路入参：各章正文中含金额/工期/质保/人员关键词的段落（本地关键词捞取，≤3000 字） */
export function collectCommercialParagraphs(chapters: Chapter[], maxChars = 3000): string {
  const blocks: string[] = []
  let total = 0
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i]
    const content = (c.content ?? "").trim()
    if (!content) continue
    for (const para of splitParagraphs(content, 20, 600)) {
      if (total >= maxChars) break
      if (!COMMERCIAL_KEYWORDS.some((k) => para.includes(k))) continue
      const block = `[第${i + 1}章 ${c.title}] ${para.replace(/\s+/g, " ").trim()}`
      if (total + block.length > maxChars) break
      blocks.push(block)
      total += block.length + 1
    }
  }
  return blocks.join("\n")
}

/**
 * 商务要素路 prompt：globalFacts 与正文关键值逐项核对（项目名称/编号/金额/工期/质保期/驻场人数等）。
 * 找不到投标值时 bid_value 填「未找到」且 consistent=false。
 */
export function buildEvalCommercialMessages(
  globalFacts: string,
  commercialSections: string,
  bidParagraphs: string,
): LlmMessage[] {
  const system = [
    "你是医疗信息化项目评标委员会的商务符合性审查专家，负责核对投标文件中的关键商务值与招标要求是否一致（不评技术方案、不打分）。",
    "核对方法：从【全局事实】与【招标商务要求】中逐项提取关键商务值（项目名称、招标编号、采购人、预算/报价金额、工期、质保期、保证金、驻场人数、时间节点等），再到【投标文件商务相关段落】中查找投标侧的对应值，逐项输出核对结果：",
    "key 写核对项名（不超过 20 字）；tender_value 写招标侧要求值（原文摘录，不超过 60 字）；bid_value 写投标文件中的实际值（原文摘录，不超过 60 字）；consistent 写两者是否一致（true/false）；note 一句话说明核对依据或不一致点（不超过 60 字）。",
    "硬规则：",
    "1. 投标文件段落中找不到某核对项的值时，bid_value 填「未找到」且 consistent=false，note 注明「正文未见对应商务值，需人工补充核对」；",
    "2. 数值比对允许表述差异（如「12 个月」与「一年」），但金额、天数、人数等实质数值不同必须判 false；",
    "3. 只核对有招标侧依据的项，禁止编造招标要求；没有可核对的项就输出空数组。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"commercial_checks":[{"key":"","tender_value":"","bid_value":"","consistent":true,"note":""}]}',
  ].join("\n")
  const user = [
    globalFacts || "【全局事实】（解析报告中未提取到全局事实，请以下面商务要求为准）",
    commercialSections ? `【招标商务要求（解析报告摘录）】\n${clipText(commercialSections, 6000)}` : "",
    `【投标文件商务相关段落（关键词捞取）】\n${bidParagraphs.trim() ? clipText(bidParagraphs, 3200) : "（正文中没有捞到含金额/工期/质保/人员关键词的段落）"}`,
    "请逐项核对并输出 JSON。",
  ]
    .filter((s) => s.trim())
    .join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}


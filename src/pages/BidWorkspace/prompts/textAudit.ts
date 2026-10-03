// ---------------------------------------------------------------------------
// T18 文本审计提示词（易标 buildTypoCheckMessages / buildLogicCheckMessages 移植，
// 适配 web 端「本项目成稿章节」的检查对象：按章提供编号，模型回填 chapterNo）。
// 检查要求/输出要求与易标原文一致；只做格式适配（bidDocumentId → chapterNo）。
// ---------------------------------------------------------------------------

import { clipText } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

export type AuditChapterRef = { no: number; title: string; content: string }

function formatChaptersForPrompt(chapters: AuditChapterRef[]): string {
  return chapters
    .map((c) => `【投标文件第 ${c.no} 章 ${c.title}】\n${clipText(c.content, 60000)}`)
    .join("\n\n")
}

/** 错别字检查：只报高确信错字，wrongText 必须原文可命中（程序会做位置校验，幻觉条目自动丢弃） */
export function buildTypoCheckMessages(chapters: AuditChapterRef[]): LlmMessage[] {
  const system = [
    "你是投标文件文字校对专家。请检查投标文件正文中的错别字、明显别字、同音错字、形近错字和明显录入错误。",
    "检查要求：",
    "1. 只输出你高度确信的错别字，不输出风格建议、标点偏好、表达优化或术语争议；",
    "2. 每条必须来自某一份章节原文，chapterNo 必须是输入中提供的真实章号，wrongText 必须是原文中出现的原始错字或短词（程序会校验 wrongText 是否真实存在，编造的条目会被丢弃）；",
    "3. correctText 是建议改成的正确字词；originalExcerpt 尽量摘录包含 wrongText 的原文短片段，不要改写原文；",
    "4. 如果没有明确错别字，返回 {\"findings\":[]}。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"findings":[{"chapterNo":1,"wrongText":"原文中的错别字或短词","correctText":"建议正确字词","originalExcerpt":"包含错别字的原文短片段","reason":"为什么判断为错别字"}]}',
  ].join("\n")
  const user = `【投标文件正文（按章编号，错别字检查对象）】\n\n${formatChaptersForPrompt(chapters)}\n\n请逐章检查并输出错别字清单 JSON。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

/** 逻辑谬误检查：句内逻辑漏洞 + 全文前后不一致（人员/设备/工期/金额/数量/参数等口径） */
export function buildLogicCheckMessages(chapters: AuditChapterRef[]): LlmMessage[] {
  const system = [
    "你是投标文件逻辑审查专家。请检查投标文件正文中的逻辑谬误和前后不一致问题。",
    "检查范围：",
    "1. 句子本身存在逻辑漏洞、因果不成立、条件互相矛盾或结论无法由前文推出；",
    "2. 全文前后不一致，包括但不限于处理相同工作的人员名单、设备型号、工期、金额、数量、服务期限、项目名称、技术参数等应高度一致的内容前后不一致。",
    "输出要求：",
    "1. 只保留有明确文本依据的问题，避免泛泛而谈；",
    "2. originalText 摘录关键原文，locationHint 写明大概位置、章节、表格或上下文线索，chapterNo 必须是输入中提供的真实章号；",
    "3. title 必须简短明确（不超过 28 个中文字符），便于作为折叠列表标题；",
    "4. 如果没有明确逻辑谬误，返回 {\"findings\":[]}。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"findings":[{"chapterNo":1,"title":"简短标题","originalText":"关键原文摘录","locationHint":"大概位置/章节/表格线索","fallacyReason":"谬误原因或前后不一致原因","suggestion":"修改建议"}]}',
  ].join("\n")
  const user = `【投标文件正文（按章编号，逻辑谬误检查对象）】\n\n${formatChaptersForPrompt(chapters)}\n\n请检查并输出逻辑谬误清单 JSON。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

import { redactPii } from "@/lib/piiRedact"
import type { QaCitation } from "@/pages/Knowledge/useKnowledge"

// ---------------------------------------------------------------------------
// R59/①：知识库问答回答的「可带走文本」——剥掉 [资料N] 内联标记（渲染层 chip 专用），
// 引用折为文末来源列表。复制出去即是能直接发给客户的干净文本。
// P1（2026-10-24）：正文过 PII 掩码（幂等），与渲染层口径一致——修复前的旧回答可能
// 回显过原始证件号/手机号，复制出口不能比屏幕显示更裸。
// ---------------------------------------------------------------------------

export function qaAnswerToText(content: string, citations?: QaCitation[]): string {
  const body = redactPii(
    (content ?? "")
      .replace(/\[资料\d+\]/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .trim(),
  )
  const cites = citations ?? []
  if (!cites.length) return body
  const lines = cites.map((c, i) => `[${i + 1}] 《${c.title}》`)
  return `${body}\n\n来源：\n${lines.join("\n")}`
}

import type { QaCitation } from "@/pages/Knowledge/useKnowledge"

// ---------------------------------------------------------------------------
// R59/①：知识库问答回答的「可带走文本」——剥掉 [资料N] 内联标记（渲染层 chip 专用），
// 引用折为文末来源列表。复制出去即是能直接发给客户的干净文本。
// ---------------------------------------------------------------------------

export function qaAnswerToText(content: string, citations?: QaCitation[]): string {
  const body = (content ?? "")
    .replace(/\[资料\d+\]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .trim()
  const cites = citations ?? []
  if (!cites.length) return body
  const lines = cites.map((c, i) => `[${i + 1}] 《${c.title}》`)
  return `${body}\n\n来源：\n${lines.join("\n")}`
}

// ---------------------------------------------------------------------------
// R72 提示词搬迁第七批（收官），自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { clipText, factTopicOf } from "../bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

/**
 * 改造 1.3 本地检索：对每条事实取主题词在各章 content 内 indexOf 命中段落切片
 * （每段 ≤400 字、每事实 ≤3 段），拼成核对材料；零 AI 调用。
 */
export function collectFactEvidence(factLines: string[], chapters: Chapter[], maxPerFact = 3): string {
  const blocks: string[] = []
  for (const line of factLines) {
    const topic = factTopicOf(line)
    if (!topic) continue
    const hits: string[] = []
    for (const ch of chapters) {
      const content = ch.content ?? ""
      if (!content.trim()) continue
      let idx = content.indexOf(topic)
      let guard = 0
      while (idx >= 0 && hits.length < maxPerFact && guard < 6) {
        const from = Math.max(0, idx - 120)
        hits.push(`《${ch.title}》…${content.slice(from, idx + 280).replace(/\s+/g, " ")}…`)
        idx = content.indexOf(topic, idx + topic.length + 200)
        guard += 1
      }
      if (hits.length >= maxPerFact) break
    }
    blocks.push(`【事实】${line.trim()}\n${hits.length ? hits.map((h) => `- ${h}`).join("\n") : "- （正文中未检索到该主题词）"}`)
  }
  return clipText(blocks.join("\n\n"), 12000)
}

/** 改造 1.3：「事实一致性核对」prompt——输入事实表 + 命中段落，输出矛盾清单 JSON */
export function buildFactCheckMessages(factsBlock: string, evidenceText: string): LlmMessage[] {
  const system = [
    "你是投标文件一致性审查专家，负责核对标书正文与「全局事实设定」是否口径一致。",
    "核对铁律：",
    "1. 只依据给定段落判断，段落里出现的数值/名称/承诺与事实口径不一致（如工期天数不同、响应时限更长、人员数量更少、型号数量对不上）才算矛盾；",
    "2. 段落未提及该事实、或表述与事实一致/更优的，不算矛盾，禁止为凑数编造；",
    "3. quote 原样摘录矛盾句（≤80 字），chapter 用给定段落标注的章名，suggestion 给出应改成的统一口径（≤60 字）；",
    "4. 无任何矛盾时输出空数组 []。",
    "输出严格 JSON 数组，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '[{"fact":"事实行","chapter":"章名","quote":"矛盾原句","suggestion":"修改建议"}]',
  ].join("\n")
  const user = `${factsBlock}\n\n【各章命中事实关键词的段落】\n${evidenceText || "（正文中未检索到任何事实关键词）"}\n\n请逐条核对并输出矛盾清单 JSON 数组。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

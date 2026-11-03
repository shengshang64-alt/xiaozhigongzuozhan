// ---------------------------------------------------------------------------
// R72 提示词搬迁第七批（收官），自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { bigramOverlap, clipText, splitParagraphs } from "../bidTypes"
import type { ScoringItem } from "../bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

/**
 * 审计入参压缩：逐章「标题 + 前 400 字」；超限时先用评分项 / 废标条款关键词
 * bigram 定位相关章节段落，相关章优先注入更多内容。
 */
export function buildSubmissionDigest(
  chapters: Chapter[],
  scoring: ScoringItem[],
  voidClauses: string[],
  maxChars = 13000,
): string {
  const filled = chapters.map((c, i) => ({ no: i + 1, c })).filter(({ c }) => (c.content ?? "").trim())
  if (!filled.length) return ""
  const head = (c: Chapter, n: number) => c.content.replace(/\s+/g, " ").trim().slice(0, n)
  const base = filled.map(({ no, c }) => `第${no}章 ${c.title}\n${head(c, 400)}`).join("\n\n")
  if (base.length <= maxChars) return base
  const keywords = [...scoring.map((s) => s.item), ...voidClauses]
    .map((k) => k.trim())
    .filter((k) => k.length >= 4)
    .slice(0, 60)
  const ranked = filled
    .map(({ no, c }) => {
      const paras = splitParagraphs(c.content, 30).slice(0, 40)
      const relevant = paras.filter((p) => keywords.some((k) => bigramOverlap(k, p) >= 0.5)).slice(0, 3)
      const titleHit = keywords.some((k) => bigramOverlap(k, c.title) >= 0.5)
      return { no, c, relevant, score: relevant.length + (titleHit ? 1 : 0) }
    })
    .sort((a, b) => b.score - a.score || a.no - b.no)
  const blocks: string[] = []
  let total = 0
  for (const r of ranked) {
    const body = r.score > 0 ? r.relevant.join("\n") || head(r.c, 300) : head(r.c, 200)
    const block = `第${r.no}章 ${r.c.title}${r.score > 0 ? "（关键词命中，附相关段落）" : ""}\n${body}`
    if (total + block.length > maxChars) break
    blocks.push(block)
    total += block.length + 2
  }
  return blocks.join("\n\n")
}

/** 交卷体检 prompt：评标委员会视角逐条判「实质响应」；输出仅 index/covered/evidence，禁长 reason 防截断 */
export function buildSubmissionCheckMessages(
  scoring: ScoringItem[],
  voidClauses: string[],
  digest: string,
  starBlock?: string,
): LlmMessage[] {
  const checklist = [
    ...scoring.map((s, i) => `${i + 1}. [评分项] ${s.item}${s.criteria.trim() ? `（评审标准：${s.criteria.trim()}）` : ""}`),
    ...voidClauses.map((c, i) => `${scoring.length + i + 1}. [废标条款] ${c}`),
  ].join("\n")
  const total = scoring.length + voidClauses.length
  const system = [
    "你是医疗信息化项目评标委员会资深专家，投标人在交卷前请你对其投标文件做「实质响应」覆盖审计，逐条判断每个评分项与废标条款是否已被实质响应。",
    "审计铁律：",
    "1. 实质响应 = 投标文件给出了对应的措施、承诺、数据或证明材料，仅仅出现关键词或标题呼应不算实质响应；",
    "2. 废标条款从严判定：看不出明确正面规避或满足的响应，一律 covered=false；",
    "3. 评分项按评审标准判定：有可得分的实质内容才算 covered=true；",
    `4. 全部 ${total} 条审计项每条都要输出一行，index 与清单编号一致；evidence 摘录支撑判定的投标文件关键原文（不超过 30 字），未覆盖时可留空；`,
    "5. covered=false 时必须在 suggestion 给出不超过 40 字的补写建议（补什么内容、放哪一章）；covered=true 时 suggestion 留空；",
    "6. 禁止编写长 reason、禁止解释文字、禁止 markdown 代码围栏，只输出严格 JSON 数组，格式：",
    '[{"index":1,"covered":true,"evidence":"","suggestion":""}]',
  ].join("\n")
  const user = `【审计清单（共 ${total} 条）】\n${clipText(checklist, 6000)}\n\n${starBlock && starBlock.trim() ? `${starBlock.trim()}\n\n` : ""}【投标文件章节内容（压缩摘要）】\n${digest}\n\n请逐条审计并输出 JSON 数组。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

// ---------------------------------------------------------------------------
// R72 提示词搬迁第七批（收官），自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { clipText } from "../bidTypes"
import type { FactConflict } from "../bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

/**
 * 「一键修复」prompt——输入矛盾清单 + 各矛盾所在章的正文截段（每章前 6000 字），
 * 输出 [{chapter, old_text, new_text}] 替换补丁；铁律要求 old_text 原样复制、唯一命中、
 * new_text 最小改动（本地校验见 useBidWorkspace.runFactPatch，不唯一/缺失一律跳过）。
 */
export function buildFactPatchMessages(conflicts: FactConflict[], chapters: Chapter[]): LlmMessage[] {
  const usedTitles: string[] = []
  const blocks: string[] = []
  for (const c of conflicts) {
    const t = (c.chapter ?? "").trim()
    if (!t || usedTitles.includes(t)) continue
    usedTitles.push(t)
    const ch =
      (chapters ?? []).find((x) => (x.title ?? "").trim() === t) ??
      (chapters ?? []).find((x) => {
        const xt = (x.title ?? "").trim()
        return xt !== "" && (xt.includes(t) || t.includes(xt))
      })
    blocks.push(`【章名：${t}】\n${clipText(ch?.content ?? "（未找到该章正文）", 6000)}`)
  }
  const conflictLines = (conflicts ?? [])
    .map(
      (c, i) =>
        `${i + 1}. 事实口径：${c.fact}\n   所在章：${c.chapter || "（未标注）"}\n   矛盾原句：「${c.quote}」\n   修改建议：${c.suggestion || "（无）"}`,
    )
    .join("\n")
  const system = [
    "你是投标文件正文修复专家。给你「事实口径矛盾清单」与矛盾所在章的正文截段，请生成精确的替换补丁，把正文中与事实口径矛盾的句子改成与口径一致。",
    "修复铁律：",
    "1. old_text 必须从下面正文截段中逐字原样复制（含标点与空格），并且必须在该章全文中只出现一次；严禁改写、缩写、拼接跨句或自造正文里没有的片段；",
    "2. new_text 是在 old_text 基础上做最小改动后的文本：只修改与事实口径矛盾的数值/名称/期限等成分，其余文字保持原样，长度与 old_text 相近；",
    "3. 只修复矛盾清单涉及的句子，清单以外的内容一律不动；正文截段里找不到矛盾原句、或拿不准怎么改的条目，直接不输出该条，禁止硬凑；",
    "4. chapter 填矛盾清单标注的章名原文；",
    "5. 输出严格 JSON 数组，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '[{"chapter":"章名","old_text":"原样复制自正文的片段","new_text":"修改后的片段"}]',
  ].join("\n")
  const user = `【事实口径矛盾清单】\n${conflictLines || "（无矛盾）"}\n\n【矛盾所在章正文截段】\n${blocks.join("\n\n") || "（无正文截段）"}\n\n请输出替换补丁 JSON 数组。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

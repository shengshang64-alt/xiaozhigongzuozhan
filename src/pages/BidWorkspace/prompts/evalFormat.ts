// ---------------------------------------------------------------------------
// R72 提示词搬迁第七批（收官），自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { MAX_TENDER_CHARS, clipText } from "../bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

/**
 * 格式规范路 prompt：检查章节结构完整性 / 编号连续性 / 排版惯例 / 页数份数装订类硬约束响应。
 * 入参 = 大纲树 + 各章标题与小节标题清单 + 每章正文前 200 字采样 + 隐式硬约束清单（本地零 AI 抽取）。
 */
export function buildEvalFormatMessages(
  chapters: Chapter[],
  opts: { outlineText: string; implicitConstraints: string[] },
): LlmMessage[] {
  const chapterLines = chapters
    .map((c, i) => {
      const sections = (c.sections ?? []).filter((s) => s.trim())
      const sample = (c.content ?? "").replace(/\s+/g, " ").trim().slice(0, 200)
      return `第${i + 1}章 ${c.title}\n小节：${sections.length ? sections.join("；") : "（无小节标题）"}\n正文采样：${sample || "（本章正文为空）"}`
    })
    .join("\n\n")
  const constraints = opts.implicitConstraints.length
    ? opts.implicitConstraints.map((c, i) => `${i + 1}. ${c}`).join("\n")
    : "（未从招标文件中抽取到页数/份数/装订类硬约束）"
  const system = [
    "你是医疗信息化项目评标委员会的格式规范审查专家，对投标文件做格式符合性检查（不评内容质量、不打分）。",
    "检查范围（只查这四类）：",
    "1. 章节结构完整性：大纲树里有的章在正文中缺失或正文为空、章节层级明显残缺；",
    "2. 编号连续性：章/小节编号跳号、重号、错序；",
    "3. 排版惯例：正文残留装饰符号（【】★◆■●✓→等）、Markdown 符号残留（# * - > 等标题/列表/加粗符号）、明显乱码；",
    "4. 硬约束响应：招标文件中页数/份数/装订/密封/签字盖章类硬约束，投标文件是否有对应响应或承诺。",
    "severity 判级：结构性缺章或硬约束完全未响应=critical；编号混乱、响应不完整=major；个别排版残留=minor。",
    "防误报硬规则：判定仅基于文本解析，图片、扫描件、签章效果一律看不到；章节标题、目录项、附件清单等结构性线索存在即不判缺失；拿不准的不输出，宁缺毋滥；没有发现问题就输出空数组，禁止为凑数编造问题。",
    "location 写问题所在位置（如「第3章 实施方案」或「全文」，不超过 30 字）；suggestion 写不超过 60 字的修复建议。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"format_issues":[{"issue":"","severity":"major","location":"","suggestion":""}]}',
  ].join("\n")
  const user = [
    `【投标文件大纲树】\n${clipText(opts.outlineText, 4000)}`,
    `【各章标题、小节清单与正文采样】\n${clipText(chapterLines, MAX_TENDER_CHARS)}`,
    `【招标文件隐式硬约束清单（本地抽取）】\n${clipText(constraints, 3000)}`,
    "请逐项检查并输出 JSON。",
  ].join("\n\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

// ---------------------------------------------------------------------------
// R66 提示词搬迁第二批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

/**
 * 循环 5 A1：小节级局部扩缩写——只对给定小节切片片段做定向扩写/缩写（不重生成整节）。
 * expand 目标 ≈ 现长 ×1.5、shrink ≈ ×0.6，具体目标字数以 targetChars 传入为准；
 * 调用方复用第十五轮条级重写的确定性切片与原位替换机制（sliceSectionPieces / rebuildSectionContent）。
 */
export function buildSectionResizeMessages(
  leafTitle: string,
  sliceText: string,
  mode: "expand" | "shrink",
  targetChars: number,
): LlmMessage[] {
  const target = Math.max(100, Math.round(targetChars))
  const verb = mode === "expand" ? "扩写" : "缩写"
  const system = [
    `你是医疗信息化行业资深标书编辑，正在对投标文件的「${leafTitle}」小节做局部「${verb}」。`,
    "硬规则（每条必须遵守）：",
    "1. 只处理给定片段本身，禁止改写其他小节、禁止输出片段之外的内容；",
    "2. 保持事实口径与片段一致：金额、工期、人数、指标值等硬数据不得改动，禁止编造新数值；",
    mode === "expand"
      ? "3. 扩写须基于片段已有内容展开：补充实施细节、操作步骤、保障措施与风险考虑，禁止空话套话、禁止重复已有句子凑字数；"
      : "3. 缩写须保留全部硬指标与承诺要点，不丢评分点：合并重复表述、删去空话，关键响应内容一条不能少；",
    "4. 写作风格与片段上下文保持一致：正式投标口径、纯文本，禁止 markdown 符号与装饰符号；",
    `5. 处理后正文长度控制在约 ${target} 字（±10%）。`,
    "输出铁律：只输出处理后的正文，不输出任何解释、标题、编号或开场白。",
  ].join("\n")
  const user = `【目标长度】约 ${target} 字\n【待${verb}片段】\n${sliceText}`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

import type { DupPair } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"

// ---------------------------------------------------------------------------
// 查重复判 prompt（R65 提示词搬迁第一批，自 bidTypes.ts 原样搬迁：只搬不改字）
// ---------------------------------------------------------------------------

export const PROMPT_VERSION = 1

export function buildDupJudgeMessages(pairs: DupPair[]): LlmMessage[] {
  const blocks = pairs
    .map(
      (pr, i) =>
        `【段落对 ${i + 1}】本地相似度 ${Math.round(pr.similarity * 100)}%\n本标书段落（${pr.target_chapter}）：\n${pr.target_text.slice(0, 500)}\n历史标书段落（来源项目「${pr.source_project}」${pr.source_chapter}）：\n${pr.source_text.slice(0, 500)}`,
    )
    .join("\n\n")
  const system = [
    "你是标书查重评审专家。评标中不同投标人的标书出现大段雷同可能被认定为串通投标（废标风险），同一团队复用自家历史标书也需要改写降低雷同度。",
    // 公司招投标培训（第一期）④电子标：评标串标认定重点特征
    "公司培训要点：电子评标认定串标的重点比对维度——标书风格与表述雷同、错误与 typo 异常一致、报价呈规律性、文档属性（作者/公司/机器码）相同；复判时重点看这些维度的雷同风险，ai_note 对 high/medium 给出差异化改写的具体方向（改写哪些表述、换哪种句式结构）；",
    "对每个段落对给出复判：ai_verdict 取 high（实质性雷同，必须改写）/ medium（表达相近，建议改写）/ low（仅术语或通用表述重合，可保留）；ai_note 用一句话说明判断依据与改写建议。",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"results":[{"index":1,"ai_verdict":"high","ai_note":""}]}',
  ].join("\n")
  const user = `${blocks}\n\n请逐段复判并输出 JSON（index 与段落对编号一致）。`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

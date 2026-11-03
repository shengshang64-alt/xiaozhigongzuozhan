// AI 差异化竞争话术 Hook：基于勾选竞品的档案与「我方」定位，生成可直接粘贴到方案/标书的对抗话术。
// 输出严格 JSON；每条话术带类型标签（优势/反击/化解），前端逐条可复制。
import { useCallback, useState } from "react"
import { chatViaGateway, costTextForModel, type ModelRef } from "@/lib/modelGateway"
import type { LlmMessage } from "@/lib/llm"
import { CAPABILITY_DIMS, finalScores } from "./competitorScores"
import type { CompetitorRow } from "./competitorsCore"

export type TalkKind = "优势" | "反击" | "化解"

export interface TalkItem {
  /** 对抗对象与战场，如「对抗卫宁 · 集成平台」 */
  title: string
  kind: TalkKind
  /** 话术正文（可直接复制） */
  content: string
}

const TALK_SYSTEM_PROMPT = `你是一位资深医疗信息化售前竞争策略专家，为智业软件（厦门）售前团队撰写差异化竞争话术。

# 任务
根据「我方档案」与若干个「竞品档案」，输出 3-5 条差异化竞争话术，用于方案/标书/客户沟通中直接引用。

# 要求
1. 只基于提供的档案信息，不得编造具体数据（金额、市占率等未在档案中出现的不写）
2. 每条话术聚焦一个「竞品 × 能力维度」的对抗点，title 格式为「对抗{竞品名} · {维度}」
3. kind 三选一：优势（我方强项主动定调）、反击（拆解对方卖点）、化解（应对价格战/资质质疑等攻势）
4. content 为 60-150 字的完整话术，第一人称面向客户或评标专家的口吻，结尾可用一句证据提示
5. 严格输出 JSON 数组，不要输出其他文字
6. 合规红线：只做客观差异化对比，严禁贬损、诋毁、捏造或断言竞品未核实的负面信息（如「对方系统必然崩溃 / 对方无资质」）；对竞品的判断一律以「据公开信息 / 我方在……方面的优势」等客观口径表达，不攻击商誉；本话术仅供内部参考，不得直接写入对外投标文件

# 输出格式
[
  { "title": "对抗卫宁 · 集成平台", "kind": "优势", "content": "……" }
]`

function parseTalks(text: string): TalkItem[] | null {
  let s = text.trim()
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (m) s = m[1].trim()
  // 容错：截取第一个 [ 到最后一个 ]
  const lb = s.indexOf("[")
  const rb = s.lastIndexOf("]")
  if (lb >= 0 && rb > lb) s = s.slice(lb, rb + 1)
  try {
    const arr = JSON.parse(s)
    if (!Array.isArray(arr)) return null
    const items = arr
      .filter(
        (t: TalkItem) =>
          t && typeof t.title === "string" && typeof t.content === "string" && t.content.trim().length > 0,
      )
      .map((t: TalkItem): TalkItem => ({
        title: String(t.title).slice(0, 60),
        kind: (["优势", "反击", "化解"].includes(t.kind) ? t.kind : "优势") as TalkKind,
        content: String(t.content).trim(),
      }))
    return items.length > 0 ? items : null
  } catch {
    return null
  }
}

export function useCompetitorTalks(modelRef: ModelRef | null) {
  const [talks, setTalks] = useState<TalkItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const runTalks = useCallback(
    async (self: CompetitorRow | null, competitors: CompetitorRow[]) => {
      if (!modelRef) {
        setError("请先配置可用的 AI 模型")
        return
      }
      if (competitors.length === 0) {
        setError("请先勾选至少一个竞品")
        return
      }
      setLoading(true)
      setError("")

      const dimLine = CAPABILITY_DIMS.join("、")
      const profile = (r: CompetitorRow) => {
        const scores = finalScores(r, [r, ...competitors]).join("/")
        return [
          `【${r.name}】软著 ${r.software_copyrights} 项 · 能力分(${dimLine})=${scores}`,
          `定位：${r.positioning || "空"}`,
          `产品：${r.products || "空"}`,
          `优势：${r.strengths || "空"}`,
          `劣势：${r.weaknesses || "空"}`,
          `AI 演进：${r.ai_evolution || "空"}`,
          `信创：${r.xinchuang || "空"}`,
          `威胁与应对：${r.threat_notes || "空"}`,
        ].join("\n")
      }
      const selfCtx = self ? `# 我方档案\n${profile(self)}` : "# 我方档案\n（未录入我方「智业软件」档案，请仅基于竞品劣势推演我方机会点）"
      const compCtx = `# 竞品档案\n${competitors.map(profile).join("\n\n")}`

      const messages: LlmMessage[] = [
        { role: "system", content: TALK_SYSTEM_PROMPT },
        { role: "user", content: `${selfCtx}\n\n${compCtx}\n\n请生成 3-5 条差异化竞争话术，只输出 JSON 数组。` },
      ]

      try {
        const res = await chatViaGateway({
          modelRef,
          messages,
          page: "competitors",
          max_tokens: 3072,
          temperature: 0.4,
        })
        if (res.needsLogin) {
          setError("AI 服务需要登录，请先登录后重试")
        } else if (!res.ok || res.status !== "success") {
          setError(res.error || "话术生成失败，请稍后重试")
        } else {
          const parsed = parseTalks(res.text || "")
          if (parsed) setTalks(parsed)
          else setError("AI 返回格式无法解析，请重试")
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "话术生成异常")
      } finally {
        setLoading(false)
      }
    },
    [modelRef],
  )

  const reset = useCallback(() => {
    setTalks([])
    setError("")
  }, [])

  return {
    talks,
    loading,
    error,
    runTalks,
    reset,
    costHint: modelRef ? costTextForModel(modelRef) : "",
  }
}

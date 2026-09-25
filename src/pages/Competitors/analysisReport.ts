import type { AnalysisResult } from "./useCompetitorAnalysis"

// ---------------------------------------------------------------------------
// R59/②：竞品 AI 深度分析结果的「可带走文本」——威胁变化/可更新字段/行动建议/
// 材料清单拼成可直接贴进邮件或方案的纯文本报告。
// ---------------------------------------------------------------------------

const THREAT_LABEL = { up: "↑ 上升", down: "↓ 下降", stable: "→ 持平" } as const

export function analysisReportToText(competitorName: string, r: AnalysisResult): string {
  const lines: string[] = []
  lines.push(`「${competitorName}」竞品档案 AI 深度分析`)
  lines.push(`威胁等级变化：${THREAT_LABEL[r.threat_level_change] ?? "→ 持平"}`)
  if (r.updates.length) {
    lines.push("", `可更新字段（${r.updates.length} 项）：`)
    for (const u of r.updates) lines.push(`- ${u.field}（置信度 ${u.confidence}）：${u.reason}`)
  }
  if (r.action_items.length) {
    lines.push("", "行动建议：")
    for (const a of r.action_items) lines.push(`- ${a}`)
  }
  if (r.materials?.length) {
    lines.push("", "分析材料清单：")
    for (const m of r.materials) lines.push(`- ${m.label}：${m.count} 条`)
  }
  return lines.join("\n")
}

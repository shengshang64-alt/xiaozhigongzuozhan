// ---------------------------------------------------------------------------
// R-026③（R257）废标条数下限报警
//
// 背景：易标《可复用能力分析》R-026 结构化解析含三项自检，①JSON Schema ②评分合计=声明总分
// （Slice1/R253 selfCheckScoringTotal）③废标条款条数下限。真实三甲医院招标文件几乎必含多条
// 否决/废标条款（未密封、未盖章、超预算、资质不符、串通投标……），若「无效标与废标项」解析项
// 仅抽到 1~2 条，极可能是漏解析（假阴），下游废标检查会漏判——须显式提示对照原件核实。
//
// 口径：与 selfCheckScoringTotal 对称，纯函数零模型可脱离浏览器单测。0 条（原文未提及 / AI 降级占位）
// 属正常缺席，不报（防误伤确实废标条款极少的小项目），只在「抽到了但少于下限」时报警。
// ---------------------------------------------------------------------------

/** 常见招标文件废标条款下限：低于此值视为可能漏解析（保守取 3，宁可漏报不误伤极简标） */
// R-031（安中医 2026BFAFZ50845 实测）：下限 3→5，真实三甲项目废标条款普遍≥12 类
export const MIN_VOID_CLAUSES = 5

/** 与 runVoidCheck 同口径把废标项正文切成条款行（去行首「1.」「2、」编号、去空行） */
export function splitVoidClauses(content: string): string[] {
  return (content ?? "")
    .split(/\n+/)
    .map((l) => l.replace(/^\d+[.、]\s*/, "").trim())
    .filter((l) => l.length > 0)
}

/** 整段为缺席/降级占位（原文未提及 / AI 系统降级）——不报条数下限，避免与既有失败提示重复或误伤 */
const isAbsentPlaceholder = (s: string): boolean => {
  const t = (s ?? "").trim()
  if (!t) return true
  if (t.startsWith("〔系统降级")) return true
  return t.length <= 30 && /未提及|没有提及|未明确|原文无|暂无/.test(t)
}

/**
 * 废标条款条数下限自检：解析到条款数在 1~(floor-1) 区间→返回人话报警，其余返回 null。
 * floor 默认 MIN_VOID_CLAUSES；0 条 / 缺席占位 / 达下限 均不报。
 */
export function voidClauseFloorWarning(content: string, floor: number = MIN_VOID_CLAUSES): string | null {
  if (isAbsentPlaceholder(content)) return null
  const n = splitVoidClauses(content).length
  if (n === 0 || n >= floor) return null
  return (
    `无效标与废标项仅解析到 ${n} 条，低于常见下限（${floor} 条）：` +
    "招标文件的否决/废标条款通常更多（未密封、未盖章、超预算、资质不符、串通投标等），" +
    "请对照招标原件核实是否漏解析，必要时重新解析该项"
  )
}

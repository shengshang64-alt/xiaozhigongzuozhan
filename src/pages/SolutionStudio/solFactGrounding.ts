// ---------------------------------------------------------------------------
// R-033（第四节地图·模块3）：方案生成事实 grounding 检查（纯函数、零 AI 调用）
//
// 背景：方案工作室生成正文时通过 KB 检索注入素材（buildKbRefBlock），
// 但模型产出的数字/指标/承诺值可能来自幻觉而非素材——交付给医院的方案中
// 出现编造的数字（"99.9%可用性"而KB只写了"99.5%"）是严重质量事故。
// 本模块在生成后做确定性数字溯源检查：提取正文中的数值断言，
// 逐一核对是否存在于已知素材文本中（KB文本/需求文档/医院信息/事实表）。
//
// 铁律：纯函数零 AI，可脱离浏览器单测。参照 voidClauseFloor.ts / composeGates.ts 同族。
// ---------------------------------------------------------------------------

import type { Chapter } from "./solutionTypes"

/** 单条未溯源数值 */
export interface UngroundedNumber {
  /** 章节 node_id */
  nodeId: string
  /** 章节标题 */
  chapterTitle: string
  /** 正文中含该数值的上下文片段（前后各 15 字） */
  context: string
  /** 提取到的数值字符串（如 "99.9%"） */
  value: string
  /** 数值类型标签 */
  kind: "percentage" | "count" | "duration" | "amount"
}

/** 数值提取正则群（通用，不针对特定项目） */
const NUMBER_PATTERNS: { re: RegExp; kind: UngroundedNumber["kind"] }[] = [
  { re: /\d+\.?\d*\s*%/g, kind: "percentage" },
  { re: /(?:支持|覆盖|接入|包含|拥有|部署)\s*(\d{2,})\s*(?:个|套|家|台|路|项)/g, kind: "count" },
  { re: /\d+\s*(?:小时|分钟|秒|天|月|年)(?:内|之?内)?/g, kind: "duration" },
  { re: /(?:预算|金额|报价|总投资|费用)[：:\s]*\d+\.?\d*\s*(?:万|亿)?[元]?/g, kind: "amount" },
]

/** 归一化：去掉千分位逗号、多余空白、统一小写 */
function norm(s: string): string {
  return s.replace(/,/g, "").replace(/\s+/g, "").toLowerCase()
}

/**
 * R-033：对方案正文中的数值断言做 grounding 核验。
 * @param chapters 已生成正文的章节列表
 * @param sourceTexts 已知可信来源文本合集（KB 素材文本 + 需求文档 + 医院信息 + 事实表行）
 * @returns 无法在任何来源中找到出处的数值列表
 */
export function detectUngroundedNumbers(
  chapters: Chapter[],
  sourceTexts: string[],
): UngroundedNumber[] {
  // 将所有来源文本拼接后归一化，作为查找字典
  const corpus = norm(sourceTexts.filter(Boolean).join(" "))
  if (!corpus) return [] // 无源文本可比对时不报（防误伤无KB项目）

  const out: UngroundedNumber[] = []
  for (const ch of chapters ?? []) {
    const body = (ch.content ?? "").trim()
    if (!body) continue
    for (const { re, kind } of NUMBER_PATTERNS) {
      let m: RegExpExecArray | null
      const r = new RegExp(re.source, re.flags)
      while ((m = r.exec(body)) !== null) {
        const value = m[0].trim()
        // 过短的数字（如纯"1个"）无信息量，跳过避免误报
        if (value.length < 3) continue
        // 在 source corpus 中查找该数值（允许±1的浮动误差对百分比）
        const normVal = norm(value)
        const found = corpus.includes(normVal)
        if (found) continue
        // 对于百分比："99.5%" 在源文本中以 "99.5" 形式出现（不带%号）也应匹配
        if (kind === "percentage") {
          const numOnly = value.replace(/[\s%]/g, "")
          if (corpus.includes(norm(numOnly))) continue
        }
        // 提取上下文
        const start = Math.max(0, m.index - 15)
        const end = Math.min(body.length, m.index + value.length + 15)
        const context = body.slice(start, end).replace(/\n/g, " ").trim()
        out.push({
          nodeId: ch.node_id,
          chapterTitle: ch.title,
          context,
          value,
          kind,
        })
      }
    }
  }
  // 限制输出量（防 200+ 条噪声）
  return out.slice(0, 50)
}

/**
 * R-033：汇总 grounding 检查结果为报告级摘要（用于 UI banner）。
 */
export function groundingSummary(
  chapters: Chapter[],
  sourceTexts: string[],
): { total: number; ungrounded: UngroundedNumber[]; ratio: number } {
  const ungrounded = detectUngroundedNumbers(chapters, sourceTexts)
  // 总数值提取数（grounded + ungrounded）
  let total = 0
  for (const ch of chapters ?? []) {
    const body = (ch.content ?? "").trim()
    if (!body) continue
    for (const { re } of NUMBER_PATTERNS) {
      const r = new RegExp(re.source, re.flags)
      const matches = body.match(r)
      if (matches) total += matches.length
    }
  }
  return {
    total,
    ungrounded,
    ratio: total > 0 ? 1 - ungrounded.length / total : 1,
  }
}

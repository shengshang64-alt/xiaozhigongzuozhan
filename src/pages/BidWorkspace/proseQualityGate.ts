// ---------------------------------------------------------------------------
// 2026-10-23（P0-3 正文质量门禁）：用「真实交付标书」当标尺量段落长度
//
// 依据（bidProseLinter.ts 头部那张基准表，2026-10-17 实机校准）：
//   真实中标《售后服务方案》286 段：段落中位 81.5 字、85 分位 193、超 300 字占 0.7%
//   同仓 AI 生成稿 1638 段：段落中位 272 字、超 300 字占 37%
// 结论是「句子长度只差 1.27 倍，段落长度差 3.3 倍」——所以门禁只看段落，不碰句子。
//
// 本模块只**度量**，不改写：拆段由 proseParagraphSplitter.splitLongParagraphs 做
// （纯本地、字符零改动、毫秒级）。两者口径必须同源（都走 bidProseLinter.splitParagraphs），
// 否则「量出来的问题」和「拆完的结果」对不上。
// ---------------------------------------------------------------------------

import { splitParagraphs } from "./bidProseLinter"
import { splitLongParagraphs } from "./proseParagraphSplitter"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

/** 真实交付标书基准（bidProseLinter 头部表） */
export const PROSE_BENCH = {
  median: 81.5,
  p85: 193,
  over300Pct: 0.007,
} as const

/** 判定档位：ok ≤120 且 ≤10%；poor 超过 200 字中位或 30% 超长；其余 warn */
export const PROSE_LIMITS = { okMedian: 120, okOver300: 0.1, warnMedian: 200, warnOver300: 0.3 } as const

export type ProseLevel = "ok" | "warn" | "poor"

export type ProseQuality = {
  chapters: number
  paragraphs: number
  median: number
  p85: number
  /** 超 300 字段落数 */
  over300: number
  /** 超 300 字占全部段落（0~1） */
  over300Pct: number
  /** 可被本地拆段处理的超长段落数（>300 且含可断句的句末标点） */
  splittable: number
  level: ProseLevel
  /** 一句话结论（面板/清单直接展示） */
  detail: string
}

const quantile = (sorted: number[], q: number): number => {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))
  return sorted[idx]
}

export function evaluateProseQuality(chapters: Chapter[] | null | undefined): ProseQuality {
  const list = (chapters ?? []).filter((c) => (c.part ?? "tech") !== "biz")
  const lengths: number[] = []
  let splittable = 0
  let chaptersWithText = 0
  for (const ch of list) {
    const content = ch.content ?? ""
    if (!content.trim()) continue
    chaptersWithText += 1
    for (const p of splitParagraphs(content)) lengths.push(p.text.replace(/\s/g, "").length)
    splittable += splitLongParagraphs(content).splitParagraphs
  }
  if (!lengths.length) {
    return {
      chapters: chaptersWithText,
      paragraphs: 0,
      median: 0,
      p85: 0,
      over300: 0,
      over300Pct: 0,
      splittable: 0,
      level: "ok",
      detail: "还没有正文，无法评估",
    }
  }
  const sorted = [...lengths].sort((a, b) => a - b)
  const median = quantile(sorted, 0.5)
  const over300 = lengths.filter((n) => n > 300).length
  const over300Pct = over300 / lengths.length
  const p85 = quantile(sorted, 0.85)
  const level: ProseLevel =
    median <= PROSE_LIMITS.okMedian && over300Pct <= PROSE_LIMITS.okOver300
      ? "ok"
      : median > PROSE_LIMITS.warnMedian || over300Pct > PROSE_LIMITS.warnOver300
        ? "poor"
        : "warn"
  const detail =
    `段落中位 ${Math.round(median)} 字（真实交付 ${PROSE_BENCH.median}）、超 300 字占 ${(over300Pct * 100).toFixed(1)}%（真实交付 0.7%）、共 ${lengths.length} 段` +
    (splittable ? `；其中 ${splittable} 段可本地一键拆分（字符零改动）` : "")
  return { chapters: chaptersWithText, paragraphs: lengths.length, median, p85, over300, over300Pct, splittable, level, detail }
}

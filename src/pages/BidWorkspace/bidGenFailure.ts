// ---------------------------------------------------------------------------
// R301：标书章节生成失败「归因」薄封装——复用 SolutionStudio R282 的 genFailureSummary 纯函数。
// 标书页与方案页共用同一 Chapter 类型（genError 随 bid_chapters JSON 持久化，零 collection 变更），
// 故归类 / 聚合逻辑无需重写；本模块只做「技术章口径过滤」，与 ComposeStep 生成总览 failedCount 同尺。
// 纯本地、零 AI、零写库：只回答「哪些章因同一原因失败」，与体检同口径——只报不拦。
// ---------------------------------------------------------------------------
import { summarizeGenFailures, type GenFailureSummary } from "@/pages/SolutionStudio/genFailureSummary"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

/** 技术章判定：与生成总览 failedCount 同口径（biz 商务骨架章不生成正文，不参与归因；缺省/tech 计入） */
export function isBidTechChapter(ch: Chapter): boolean {
  return !ch.part?.startsWith("biz")
}

/** 整本技术章失败归因摘要（按「归类 + 逐字原因」聚合，最可能根因恒排第一；biz 章先按口径过滤） */
export function summarizeBidGenFailures(chapters: Chapter[] | undefined | null): GenFailureSummary {
  return summarizeGenFailures((chapters ?? []).filter(isBidTechChapter))
}

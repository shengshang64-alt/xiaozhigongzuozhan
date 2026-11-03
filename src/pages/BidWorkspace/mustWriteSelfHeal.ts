// ---------------------------------------------------------------------------
// R-039②（R259）mustWrite 读时自愈（纯本地、零 AI、零 DOM）
//
// 《全局优化汇总》R-039 指「mustWrite 根本没落库、17 项目全为 0」——经查实为存量项目（其大纲生成于本功能之前，
// bid_outline JSON 里没有 mustWrite 字段）；新生成侧 applyMustWrite 已把该标记写入 bid_outline（PocketBase JSON 列，
// 非独立字段，无需 schema 迁移）。文档要求②「读到大纲时若发现有技术类评分项未落点且对应章无 mustWrite，主动重算补标记」
// 与④「大纲区显示必写标识」。本模块在渲染/读取存量大纲时本地重算 mustWrite（口径与 runGenerateOutline mwCtx 完全一致），
// 使「必写」标识对存量项目即时可见、无需批量重跑（对齐 ⚠️「直接批量重跑等于白跑 17 次」）。
//
// 自愈只在「判定应必写、但顶层章缺标记」时补标，其余（含合法 false、无报告、空大纲）原样返回入参引用——
// 保持引用稳定，避免多余重渲染；纯函数不写库、不改标题结构，安全幂等。
// ---------------------------------------------------------------------------

import type { ParseReport } from "./bidTypes"
import { numberScoringItems } from "./bidTypes"
import { applyMustWrite, judgeMustWrite, type MustWriteCtx } from "./bidMustWrite"
import { readRequiredTechKeywords } from "./mustWriteConfig"
import type { OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

/** 与 runGenerateOutline mwCtx 完全同口径：① 技术评分项名 + R-017 必备技术关键词（可配置下限） */
function ctxFor(report: ParseReport): MustWriteCtx {
  return {
    techScoringNames: numberScoringItems(report).filter((i) => i.category === "tech").map((i) => i.item),
    requiredKeywords: readRequiredTechKeywords(),
  }
}

/** 是否存在「按评分办法/关键词/★▲ 判定应必写、但顶层章缺 mustWrite 标记」的存量大纲（需自愈）；无报告 / 空大纲→false */
export function mustWriteBackfillNeeded(nodes: OutlineNode[], report: ParseReport | null): boolean {
  if (!report || nodes.length === 0) return false
  const ctx = ctxFor(report)
  return nodes.some((n) => n.mustWrite !== true && judgeMustWrite(n, ctx).mustWrite)
}

/**
 * 读时自愈：给判定必写但缺标记的顶层章补 mustWrite（子级与标题结构不动，仅顶层打标记）。
 * 无需自愈（缺报告 / 全标记已一致）时原样返回入参引用，避免多余重渲染与落库。
 */
export function healMustWriteOnRead(nodes: OutlineNode[], report: ParseReport | null): OutlineNode[] {
  if (!mustWriteBackfillNeeded(nodes, report)) return nodes
  return applyMustWrite(nodes, ctxFor(report as ParseReport)).nodes
}

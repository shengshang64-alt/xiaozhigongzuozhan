// ---------------------------------------------------------------------------
// 知识原子消费装配（2026-10-31 知识库 P0-7）
//
// 依据《知识库改造需求文档 v1.0》§9.2：
//   「assembleKbContext 改造为只接受原子，新增返回字段 citations。」
//   「citations 必须透传到方案/PPT/标书的最终产物里，供用户点开核对。」
//
// 为什么要做这一层（而不是直接改现有 assembleKbContext）：
//   现有 kbAssemble.assembleKbContext 消费的是 kb_docs（原始文档 + 前端 BM25），
//   而原子层有**服务端硬门禁**（只返回 approved + 未过期 + 密级合规）。
//   两者语义不同，硬塞进一个函数会让调用方分不清"这条内容有没有过审"。
//
// 所以本模块独立提供**原子版装配**，与文档版并存：
//   · 新代码应优先用原子版（可追溯、已过审、有有效期）
//   · 存量代码继续用文档版（兼容）
//   · 迁移路径清晰：把调用点逐个换成 atomic 版本即可
//
// 关键差异（相对文档版）：
//   ① 数据源是 /api/kb/search（服务端已做门禁过滤），前端不再自己判断合规性
//   ② 每条命中带 citations（docId + anchor），可点回原文段落
//   ③ 无「赛道缺料」概念——原子池按 usableFor 分，语义更直接
// ---------------------------------------------------------------------------

import { gateExplanation, reportAtomUsage, searchAtoms, toCitations, type AtomHit, type Citation } from "@/pages/Knowledge/kbAtomSearch"
import type { AtomType } from "@/pages/Knowledge/kbAtoms"

/** 消费用途（决定取哪类原子） */
export type AtomUsableFor = "proposal" | "ppt" | "bid" | "quote" | "faq"

export interface AssembleAtomsOptions {
  /** 检索语句 */
  query: string
  /** 用途（必填——这是原子层的核心过滤维度，P3 原则） */
  usableFor: AtomUsableFor
  /** 赛道软过滤 */
  track?: string
  /** 用途桶 */
  buckets?: string[]
  /** 原子类型限定（如只要 metric） */
  atomTypes?: AtomType[]
  /** 返回条数 */
  topN?: number
  /** 密级上限 */
  confidentialityMax?: "public" | "internal" | "client_only" | "secret"
}

/** 装配结果（含 citations 透传） */
export interface AssembleAtomsResult {
  /** 命中的原子（已过服务端门禁） */
  hits: AtomHit[]
  /** 引用清单——必须透传到最终产物，供用户点开核对 */
  citations: Citation[]
  /** 门禁说明（"为什么某些内容搜不到"） */
  gateNote: string
  /** 是否为空（调用方据此提示用户补素材） */
  empty: boolean
}

/**
 * 装配知识原子上下文。
 *
 * 这是替代 kbAssemble.assembleKbContext 的**原子版入口**。
 * 所有过滤（approved / 有效期 / 密级）都在服务端完成，前端不做二次判断。
 *
 * @param userId 当前用户（服务端据此决定密级可见范围）
 */
export async function assembleAtomContext(
  userId: string | null,
  opts: AssembleAtomsOptions,
): Promise<AssembleAtomsResult> {
  if (!userId) {
    return { hits: [], citations: [], gateNote: "未登录，无法检索知识原子", empty: true }
  }
  if (!opts.query.trim()) {
    return { hits: [], citations: [], gateNote: "检索语句为空", empty: true }
  }
  try {
    const res = await searchAtoms(userId, {
      query: opts.query,
      usableFor: opts.usableFor,
      ...(opts.track ? { track: opts.track } : {}),
      ...(opts.buckets?.length ? { buckets: opts.buckets } : {}),
      ...(opts.atomTypes?.length ? { atomTypes: opts.atomTypes } : {}),
      ...(opts.confidentialityMax ? { confidentialityMax: opts.confidentialityMax } : {}),
      topN: opts.topN ?? 5,
    })
    return {
      hits: res.hits,
      citations: toCitations(res.hits),
      gateNote: gateExplanation(res.gate),
      empty: res.hits.length === 0,
    }
  } catch (e) {
    // 检索失败不阻断生成链路（与文档版一致：知识库不可用时降级）
    return {
      hits: [],
      citations: [],
      gateNote: `原子检索失败：${e instanceof Error ? e.message : String(e)}`,
      empty: true,
    }
  }
}

/** 把原子命中渲染成注入 LLM 的文本块（含引用标记） */
export function atomsToPromptBlock(hits: AtomHit[]): string {
  if (!hits.length) return ""
  return hits
    .map((h) => {
      const attrs = h.sourceQuote ? `（原文：${h.sourceQuote.slice(0, 80)}）` : ""
      return `- ${h.title}\n  ${h.body}${attrs}`
    })
    .join("\n\n")
}

/** 把 citations 渲染成"来源清单"附在产物末尾（供核对） */
export function citationsToFootnote(citations: Citation[]): string {
  if (!citations.length) return ""
  const lines = citations.map((c, i) => `[${i + 1}] 《${c.docName || c.docId}》${c.anchor ? ` · ${c.anchor}` : ""}`)
  return `\n\n---\n资料来源：\n${lines.join("\n")}`
}

/** 生成完成后上报使用情况（反哺 usage_count，让常用知识排序更靠前） */
export async function reportAtomUsageAfterGen(userId: string | null, hits: AtomHit[]): Promise<void> {
  if (!userId || !hits.length) return
  await reportAtomUsage(
    userId,
    hits.map((h) => h.atomId),
  )
}

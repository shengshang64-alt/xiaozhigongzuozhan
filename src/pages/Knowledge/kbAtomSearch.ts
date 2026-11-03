// ---------------------------------------------------------------------------
// 知识原子检索客户端（2026-10-30 知识库 P0-6 前端侧）
//
// 对应《知识库改造需求文档 v1.0》§9.1 / §12.2。
//
// 关键：**这个客户端不做任何过滤**。
//   状态、有效期、密级的强制过滤全部在服务端完成（硬门禁原则 P5）。
//   前端如果也过滤一遍，反而会让人误以为"前端过滤就够"——那等于门禁形同虚设。
//
// 所以本文件只做三件事：发请求、收结果、把 citations 整理成可展示结构。
// ---------------------------------------------------------------------------

import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"

/** 原子检索命中（与 pb_hooks/kb_search_atoms.pb.js 返回结构一一对应） */
export type AtomHit = {
  atomId: string
  atomType: string
  title: string
  body: string
  subjectKey: string
  confidence: number
  kbTrack: string
  kbBucket: string
  kbSection: string
  usableFor: string[]
  confidentiality: string
  score: number
  /** 追溯四件套（§9.1 第 5 条要求必须带） */
  sourceDocId: string
  docName: string
  sourceAnchor: string
  sourceQuote: string
  validUntil: string
}

export type AtomSearchGate = {
  contentStatus: string
  validUntilAfter: string
  confidentialityMax: string
  usableFor: string | null
  candidates: number
  afterValidUntil: number
  afterConfidentiality: number
}

export type AtomSearchResult = {
  hits: AtomHit[]
  total: number
  gate: AtomSearchGate
}

export type AtomSearchOptions = {
  query: string
  track?: string
  buckets?: string[]
  sections?: string[]
  atomTypes?: string[]
  usableFor?: "proposal" | "ppt" | "bid" | "quote" | "faq"
  confidentialityMax?: "public" | "internal" | "client_only" | "secret"
  topN?: number
}

/**
 * 检索已审核的知识原子。
 *
 * 服务端强制只返回 `approved` 且未过期的原子；`raw`/`pending` 永远不会出现在结果里。
 */
export async function searchAtoms(userId: string, opts: AtomSearchOptions): Promise<AtomSearchResult> {
  const body = {
    query: opts.query,
    ...(opts.track ? { track: opts.track } : {}),
    ...(opts.buckets?.length ? { buckets: opts.buckets } : {}),
    ...(opts.sections?.length ? { sections: opts.sections } : {}),
    ...(opts.atomTypes?.length ? { atomTypes: opts.atomTypes } : {}),
    ...(opts.usableFor ? { usableFor: opts.usableFor } : {}),
    ...(opts.confidentialityMax ? { confidentialityMax: opts.confidentialityMax } : {}),
    topN: opts.topN ?? 10,
  }
  const res = await fetch(`${getPocketBaseUrl()}/api/kb/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Rh-User-Id": userId, ...vibexAuthHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => "")
    throw new Error(`检索失败（HTTP ${res.status}）${msg ? `：${msg.slice(0, 200)}` : ""}`)
  }
  const data = (await res.json()) as { ok: boolean; hits?: AtomHit[]; total?: number; gate?: AtomSearchGate }
  return {
    hits: data.hits ?? [],
    total: data.total ?? 0,
    gate: data.gate ?? {
      contentStatus: "approved",
      validUntilAfter: "",
      confidentialityMax: opts.confidentialityMax ?? "internal",
      usableFor: opts.usableFor ?? null,
      candidates: 0,
      afterValidUntil: 0,
      afterConfidentiality: 0,
    },
  }
}

/** 引用条目（§9.2 要求 citations 透传到最终产物） */
export type Citation = {
  atomId: string
  docId: string
  docName: string
  anchor: string
  /** 摘录原文，便于用户不点开也能判断是否相关 */
  quote: string
  title: string
}

/** 把命中结果转成 citations（下游产物携带） */
export function toCitations(hits: AtomHit[]): Citation[] {
  // 2026-10-31 去重：实测同一 anchor 的多个原子会产生重复引用
  // （例：生成产物末尾出现 [1] 与 [6] 指向同一段原文 p151-c30852-31092）。
  // 按「docId + anchor」去重；没有 anchor 的按「docId + title」。
  const seen = new Set<string>()
  const out: Citation[] = []
  for (const h of hits) {
    const key = h.sourceAnchor
      ? `${h.sourceDocId ?? ""}#${h.sourceAnchor}`
      : `${h.sourceDocId ?? ""}#${h.title ?? ""}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      atomId: h.atomId,
      docId: h.sourceDocId,
      docName: h.docName,
      anchor: h.sourceAnchor,
      quote: h.sourceQuote,
      title: h.title,
    })
  }
  return out
}

/** 反馈使用（反哺 usage_count，让常用知识排序更靠前） */
export async function reportAtomUsage(userId: string, atomIds: string[]): Promise<void> {
  if (!atomIds.length) return
  try {
    await fetch(`${getPocketBaseUrl()}/api/kb/search/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Rh-User-Id": userId, ...vibexAuthHeaders() },
      body: JSON.stringify({ atomIds }),
    })
  } catch {
    /* 反馈失败不影响主流程（纯排序优化） */
  }
}

/** 门禁说明（给用户看"为什么某些内容搜不到"） */
export function gateExplanation(gate: AtomSearchGate): string {
  const filteredByValid = gate.candidates - gate.afterValidUntil
  const filteredByConf = gate.afterValidUntil - gate.afterConfidentiality
  const bits = [`候选 ${gate.candidates} 条`]
  if (filteredByValid > 0) bits.push(`过期滤除 ${filteredByValid}`)
  if (filteredByConf > 0) bits.push(`密级滤除 ${filteredByConf}`)
  return bits.join(" · ")
}

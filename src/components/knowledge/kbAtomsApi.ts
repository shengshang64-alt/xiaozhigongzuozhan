// 知识原子 · 服务端数据客户端（UX-v2 知识原子屏 / 原子审核屏用）。
//
// ## 为什么不直接查 PocketBase collection
//
// kb_atoms 的集合级规则是 listRule/viewRule = null（仅超管），
// 前端拿不到 `pb.collection("kb_atoms").getList()`；全站访问 kb_atoms 的正规通道
// 只有自定义路由。所以这里走 /api/kb/atoms/* 与 /api/kb/search。
//
// ## 与既有客户端的关系
//
// - `kbAtomSearch.ts`（既有）封装 POST /api/kb/search —— **按关键词检索**已通过审核的原子。
// - 本文件封装 **统计与列表** 两类新通道（/api/kb/atoms/stats、/api/kb/atoms/list）。
// 两者互补：检索回答「这条事实怎么写的」，统计/列表回答「库里有几条、哪几条被反复用」。
//
// ## 失败语义（不要把失败说成空）
//
// 后端路由未部署（404）与「库里真的是 0 条」是两回事：
// 404 → { ok: false, message }，界面用 ErrorState 显示「不是没有数据」；
// 0 条 → { ok: true, total: 0 }，界面用 EmptyState。

import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"

export type KbAtomStatRow = {
  id: string
  title: string
  atomType: string
  usageCount: number
  sourceDocId?: string
  docName?: string
}

export type KbAtomStats = {
  /** 原子总数 */
  total: number
  /** 按状态分：approved / pending / rejected / conflict / superseded … */
  byStatus: Record<string, number>
  /** 按类型分（8 类，取自 kbAtoms.ATOM_TYPES） */
  byType: Record<string, number>
  /** 处于冲突组里的原子数 */
  conflictCount: number
  /** 真正有引用记录（usage_count > 0）的原子数 */
  withUsage: number
  /** 被引用最多的原子（按 usage_count 降序） */
  topUsed: KbAtomStatRow[]
  /** 按来源文档聚合的引用次数（文档卡「被引用 N 次」的来源） */
  docCitations: { docId: string; docName: string; citations: number }[]
}

export type KbAtomListRow = {
  id: string
  atomType: string
  title: string
  body: string
  subjectKey: string
  confidence: number
  usableFor: string[]
  status: string
  usageCount: number
  conflictGroup: string
  sourceDocId: string
  docName: string
  sourceAnchor: string
  sourceQuote: string
  validUntil: string
  createdAt: string
}

export type KbAtomListResult = {
  ok: true
  total: number
  items: KbAtomListRow[]
  /** 服务端提示（如被密级门禁筛掉时） */
  message?: string
}

export type KbAtomListParams = {
  status?: "approved" | "pending" | "all"
  atomType?: string
  limit?: number
  offset?: number
  /** 关键词（标题/正文模糊） */
  q?: string
}

async function atomFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${getPocketBaseUrl()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...vibexAuthHeaders(),
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`HTTP ${res.status}${text ? ` · ${text.slice(0, 160)}` : ""}`)
    }
    return (await res.json()) as T
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e), { cause: e })
  }
}

/** 原子统计（总数 / 状态分布 / 类型分布 / 冲突数 / 高频引用 / 按文档聚合的引用次数） */
export async function fetchKbAtomStats(): Promise<KbAtomStats> {
  const j = await atomFetch<{ ok?: boolean; message?: string } & Partial<KbAtomStats>>("/api/kb/atoms/stats")
  if (!j || j.ok === false) throw new Error(j?.message ?? "原子统计接口返回异常")
  return {
    total: Number(j.total ?? 0),
    byStatus: j.byStatus ?? {},
    byType: j.byType ?? {},
    conflictCount: Number(j.conflictCount ?? 0),
    withUsage: Number(j.withUsage ?? 0),
    topUsed: Array.isArray(j.topUsed) ? j.topUsed : [],
    docCitations: Array.isArray(j.docCitations) ? j.docCitations : [],
  }
}

/** 原子列表（分页 + 类型/状态/关键词过滤） */
export async function fetchKbAtomList(params: KbAtomListParams = {}): Promise<KbAtomListResult> {
  const qs = new URLSearchParams()
  qs.set("status", params.status ?? "approved")
  if (params.atomType) qs.set("atomType", params.atomType)
  if (params.q) qs.set("q", params.q)
  qs.set("limit", String(params.limit ?? 20))
  qs.set("offset", String(params.offset ?? 0))
  const j = await atomFetch<{
    ok?: boolean
    message?: string
    total?: number
    items?: KbAtomListRow[]
  }>(`/api/kb/atoms/list?${qs.toString()}`)
  if (!j || j.ok === false) throw new Error(j?.message ?? "原子列表接口返回异常")
  return {
    ok: true,
    total: Number(j.total ?? 0),
    items: Array.isArray(j.items) ? j.items : [],
    message: j.message,
  }
}

/** 文档 → 引用次数映射（由统计接口的 docCitations 折叠而来） */
export function docCitationMap(stats: KbAtomStats): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of stats.docCitations) {
    if (d.docId) out[d.docId] = Number(d.citations ?? 0)
  }
  return out
}

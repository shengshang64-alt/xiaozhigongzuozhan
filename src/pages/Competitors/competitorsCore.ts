// 竞品分析数据层：行类型 + CRUD。字段名与 competitors collection 一致（snake_case）。
// 取数沿用 kbCore 约定：getPocketBaseUrl + vibexAuthHeaders，自定义路由 /api/competitors。
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"

export interface CompetitorRow {
  id: string
  rh_user_id: string
  /** 公司简称（卡片主标题） */
  name: string
  /** 企业主体全称（软著登记主体） */
  legal_name: string
  /** 官网 */
  website: string
  /** 微信公众号 */
  wechat: string
  /** 软著总数 */
  software_copyrights: number
  earliest_cr_date: string
  latest_cr_date: string
  /** 厂商定位 */
  positioning: string
  /** 产品矩阵 / 核心产品 */
  products: string
  /** 五年中标金额（订单分析 PPT） */
  bid_amount_5y: string
  /** 区域版图 / 强势省份 */
  regions: string
  /** 中标金额区间结构 */
  amount_structure: string
  /** 客户画像（医院等级/类型偏好） */
  customer_profile: string
  /** 资质认证（CS/DCMM/ITSS/CCRC/ISO 等） */
  certifications: string
  /** AI 产品演进 */
  ai_evolution: string
  /** 信创适配 */
  xinchuang: string
  strengths: string
  weaknesses: string
  /** 对我方威胁与应对 */
  threat_notes: string
  summary: string
  keywords: string[]
  /** 数据来源标注（软著汇总Excel / 订单分析PPT / 官网 / 公众号 / 待核实） */
  source: string
  visibility: string
  created: string
  updated: string
}

async function compFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getPocketBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...vibexAuthHeaders(),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { httpStatus?: number }
    err.httpStatus = res.status
    throw err
  }
  return (await res.json()) as T
}

function normalize(r: Partial<CompetitorRow>): CompetitorRow {
  return {
    id: r.id ?? "",
    rh_user_id: r.rh_user_id ?? "",
    name: r.name ?? "",
    legal_name: r.legal_name ?? "",
    website: r.website ?? "",
    wechat: r.wechat ?? "",
    software_copyrights: typeof r.software_copyrights === "number" ? r.software_copyrights : Number(r.software_copyrights) || 0,
    earliest_cr_date: r.earliest_cr_date ?? "",
    latest_cr_date: r.latest_cr_date ?? "",
    positioning: r.positioning ?? "",
    products: r.products ?? "",
    bid_amount_5y: r.bid_amount_5y ?? "",
    regions: r.regions ?? "",
    amount_structure: r.amount_structure ?? "",
    customer_profile: r.customer_profile ?? "",
    certifications: r.certifications ?? "",
    ai_evolution: r.ai_evolution ?? "",
    xinchuang: r.xinchuang ?? "",
    strengths: r.strengths ?? "",
    weaknesses: r.weaknesses ?? "",
    threat_notes: r.threat_notes ?? "",
    summary: r.summary ?? "",
    keywords: Array.isArray(r.keywords) ? r.keywords : [],
    source: r.source ?? "",
    visibility: r.visibility || "team",
    created: r.created ?? "",
    updated: r.updated ?? "",
  }
}

export type CompetitorPatch = Partial<Omit<CompetitorRow, "id" | "rh_user_id" | "created" | "updated">>

export async function listCompetitors(opts?: { q?: string; perPage?: number }): Promise<CompetitorRow[]> {
  const perPage = opts?.perPage ?? 200
  const all: CompetitorRow[] = []
  // 竞品数量级小（十到百级），单页足够；保留翻页兜底防将来增长截断。
  for (let page = 1; page <= 10; page += 1) {
    const params = new URLSearchParams({ page: String(page), perPage: String(perPage) })
    if (opts?.q) params.set("q", opts.q)
    const data = await compFetch<{ items: Partial<CompetitorRow>[]; perPage?: number }>(
      `/api/competitors?${params.toString()}`,
    )
    const rows = (data.items ?? []).map(normalize)
    all.push(...rows)
    const effectivePerPage = typeof data.perPage === "number" && data.perPage > 0 ? data.perPage : Math.min(perPage, 200)
    if (rows.length < effectivePerPage) break
  }
  return all
}

export async function createCompetitor(body: CompetitorPatch): Promise<CompetitorRow> {
  const r = await compFetch<Partial<CompetitorRow>>(`/api/competitors`, {
    method: "POST",
    body: JSON.stringify(body),
  })
  return normalize(r)
}

export async function updateCompetitor(id: string, body: CompetitorPatch): Promise<CompetitorRow> {
  const r = await compFetch<Partial<CompetitorRow>>(`/api/competitors/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
  return normalize(r)
}

export async function deleteCompetitor(id: string): Promise<void> {
  await compFetch<{ ok: boolean }>(`/api/competitors/${encodeURIComponent(id)}`, { method: "DELETE" })
}

/** 参与「档案完整度」统计的研判性字段（软著基线不含这些，需人工补全） */
export const ENRICH_FIELDS: (keyof CompetitorRow)[] = [
  "positioning",
  "products",
  "bid_amount_5y",
  "regions",
  "amount_structure",
  "customer_profile",
  "certifications",
  "ai_evolution",
  "xinchuang",
  "strengths",
  "weaknesses",
  "threat_notes",
  "summary",
]

/** 档案完整度：已填写的研判字段数 / 总数，用于提示补全进度 */
export function enrichProgress(row: CompetitorRow): { filled: number; total: number; ratio: number } {
  const filled = ENRICH_FIELDS.filter((k) => String(row[k] ?? "").trim().length > 0).length
  const total = ENRICH_FIELDS.length
  return { filled, total, ratio: total ? filled / total : 0 }
}

// 资质证书台账 · 纯函数层（2026-09-28 路线图最高价值项：证书过期直接废标）
// 到期三档预警：expired（已过期）/ critical（≤30天）/ warning（≤90天）/ ok / unknown
// 全部纯函数，天数计算统一以「当地时区零点」为基准，供 UI 与后端 summary 双端对齐口径

export type QualCategory =
  | "硬资质"
  | "体系认证"
  | "软件著作权"
  | "人员证书"
  | "其他"

export const QUAL_CATEGORIES: QualCategory[] = ["硬资质", "体系认证", "软件著作权", "人员证书", "其他"]

export type QualCertRow = {
  id: string
  cert_name: string
  category: string
  cert_no: string
  issuer: string
  valid_from: string
  valid_to: string
  scope: string
  external_ok: boolean
  file_ref: string
  notes: string
  created: string
  updated: string
}

export type QualBucket = "expired" | "critical" | "warning" | "ok" | "unknown"

export const CRITICAL_DAYS = 30
export const WARNING_DAYS = 90

/** 解析 YYYY-MM-DD 为当地零点毫秒；非法返回 NaN */
export function parseDay(v: string | null | undefined): number {
  const s = String(v ?? "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN
  const t = new Date(`${s}T00:00:00`).getTime()
  return Number.isNaN(t) ? NaN : t
}

/** 到期分档：today 零点毫秒由调用方注入（便于单测固定时钟） */
export function qualBucket(validTo: string | null | undefined, todayMs: number): QualBucket {
  const to = parseDay(validTo)
  if (Number.isNaN(to)) return "unknown"
  const days = Math.round((to - todayMs) / 86400000)
  if (days < 0) return "expired"
  if (days <= CRITICAL_DAYS) return "critical"
  if (days <= WARNING_DAYS) return "warning"
  return "ok"
}

export type QualSummary = {
  total: number
  buckets: Record<QualBucket, number>
  /** 预警明细（expired/critical/warning），按过期→剩余天数升序 */
  alerts: Array<{ id: string; cert_name: string; category: string; valid_to: string; bucket: QualBucket; days_left: number | null }>
}

export function summarizeQuals(
  rows: Array<Pick<QualCertRow, "id" | "cert_name" | "category" | "valid_to">>,
  todayMs: number,
): QualSummary {
  const buckets: Record<QualBucket, number> = { expired: 0, critical: 0, warning: 0, ok: 0, unknown: 0 }
  const alerts: QualSummary["alerts"] = []
  for (const r of rows) {
    const b = qualBucket(r.valid_to, todayMs)
    buckets[b] += 1
    if (b === "expired" || b === "critical" || b === "warning") {
      const to = parseDay(r.valid_to)
      alerts.push({
        id: r.id,
        cert_name: r.cert_name,
        category: r.category ?? "",
        valid_to: r.valid_to ?? "",
        bucket: b,
        days_left: b === "expired" ? null : Math.round((to - todayMs) / 86400000),
      })
    }
  }
  // 排序：已过期最前，其余剩余天数升序
  alerts.sort((a, b) => {
    const wa = a.bucket === "expired" ? -1 : 1
    const wb = b.bucket === "expired" ? -1 : 1
    if (wa !== wb) return wa - wb
    return (a.days_left ?? 99999) - (b.days_left ?? 99999)
  })
  return { total: rows.length, buckets, alerts }
}

/** 人类可读的到期描述：「已过期 12 天」「剩 25 天」「剩 2 个月」 */
export function qualDueLabel(validTo: string | null | undefined, todayMs: number): string {
  const to = parseDay(validTo)
  if (Number.isNaN(to)) return "未登记有效期"
  const days = Math.round((to - todayMs) / 86400000)
  if (days < 0) return `已过期 ${Math.abs(days)} 天`
  if (days === 0) return "今天到期"
  if (days <= CRITICAL_DAYS) return `剩 ${days} 天`
  if (days <= WARNING_DAYS) return `剩 ${days} 天`
  return `剩 ${Math.round(days / 30)} 个月`
}

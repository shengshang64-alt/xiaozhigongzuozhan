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

// ---------------------------------------------------------------------------
// R250(r2-r012)：台账表格化的搜索口径。关键词按空白分词，任一词命中任一
// 展示字段即保留（词间 AND、字段间 OR）；大小写不敏感，全角空格一并作分隔。
// 空关键词返回全部（新数组，不改入参）。
// ---------------------------------------------------------------------------
export function filterQualRows<T extends Pick<QualCertRow, "cert_name" | "category" | "cert_no" | "issuer" | "scope" | "notes">>(
  rows: readonly T[],
  keyword: string,
): T[] {
  const words = String(keyword ?? "").toLowerCase().split(/[\s\u3000]+/).filter(Boolean)
  if (words.length === 0) return rows.slice()
  return rows.filter((r) => {
    const hay = [r.cert_name, r.category, r.cert_no, r.issuer, r.scope, r.notes]
      .map((v) => String(v ?? "").toLowerCase())
      .join("\u0001")
    return words.every((w) => hay.includes(w))
  })
}

/**
 * P3-6（2026-10-25）：有效期是否为自动解析（未人工核验）。批量导入的证书其有效期
 * 常来自文件名/目录名解析（notes 里带「文件名解析」「来源：知识库」等标记）——
 * 文件名里的日期可能是编制时间而非证书有效期，投标引用前必须人工核对原件。
 */
export function isAutoDerivedValidity(notes: string | null | undefined): boolean {
  const n = notes ?? ""
  if (!n) return false
  return /文件名解析|来源：知识库|有效期来自源文|有效期来自.*文件名/.test(n)
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

// ---------------------------------------------------------------------------
// 资质风险统一口径（O-006 修复 2026-10-08）：驾驶舱「今日必看 / 欢迎语」此前用
// summary.alerts.length（含 90 天内 warning），而台账按 expired/critical/warning
// 三档分别展示、导出硬拦截只认「已过期 + 30 天内」——三处口径漂移导致同一「临期」
// 概念出现 4 vs 1 的对不上。本函数以台账 buckets 为唯一真源，逐档明细与台账分档
// 标签逐字一致；urgent 与导出硬拦截同口径。纯函数便于单测锁死。
// ---------------------------------------------------------------------------

export type QualRiskBuckets = { expired: number; critical: number; warning: number }

/** 与 QualCertsPage.BUCKET_LABEL 同口径的分档标签，驾驶舱复用可杜绝文案漂移 */
export const QUAL_RISK_BAND_LABEL: Record<keyof QualRiskBuckets, string> = {
  expired: "已过期",
  critical: "30 天内到期",
  warning: "90 天内到期",
}

export type QualRiskView = { urgent: number; watch: number; total: number; line: string }

/**
 * urgent = 已过期 + 30 天内到期（需马上处理，与导出硬拦截一致）；
 * watch  = 90 天内到期（观察项，不进「已出问题」置顶条）；
 * total  = urgent + watch；
 * line   = 逐档明细串，仅列非零档，标签与台账三档预警条逐字一致。
 */
export function qualRiskView(buckets: Partial<QualRiskBuckets> | null | undefined): QualRiskView {
  const num = (v: unknown) => (Number(v) || 0)
  const expired = num(buckets?.expired)
  const critical = num(buckets?.critical)
  const warning = num(buckets?.warning)
  const parts: string[] = []
  if (expired > 0) parts.push(`${QUAL_RISK_BAND_LABEL.expired} ${expired}`)
  if (critical > 0) parts.push(`${QUAL_RISK_BAND_LABEL.critical} ${critical}`)
  if (warning > 0) parts.push(`${QUAL_RISK_BAND_LABEL.warning} ${warning}`)
  const urgent = expired + critical
  return { urgent, watch: warning, total: urgent + warning, line: parts.join(" · ") }
}

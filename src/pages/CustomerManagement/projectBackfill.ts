// 从投标 / 方案 / 报价回填客户档案与商机（纯函数：只做匹配与预览，不写库）。
// 模糊匹配只进「待确认」，确认应用时不得自动写入，避免简称误撞。

export type ProjectSourceKind = "bid" | "solution" | "quote"

export const PROJECT_SOURCE_LABEL: Record<ProjectSourceKind, string> = {
  bid: "投标",
  solution: "方案",
  quote: "报价",
}

/** 回填新建档案备注；不含 AI 生成的其它字段 */
export function backfillCustomerNotes(sources: ProjectSourceKind[]): string {
  const labels = Array.from(new Set(sources.map((s) => PROJECT_SOURCE_LABEL[s])))
  return `来源：${labels.join("/")}回填`
}

export const BACKFILL_STAGE: Record<ProjectSourceKind, "bidding" | "solution" | "needs"> = {
  bid: "bidding",
  solution: "solution",
  quote: "needs",
}

export interface BackfillProjectInput {
  id: string
  source: ProjectSourceKind
  name: string
  hospital: string
  opportunity_id?: string
  deleted_at?: string
}

export interface BackfillCustomerInput {
  id: string
  hospital_name: string
}

export interface BackfillOpportunityInput {
  id: string
  customer_id: string
  opp_name: string
  ref_type?: string
  ref_id?: string
}

export type HospitalMatchKind = "exact" | "normalized" | "fuzzy" | "none"

/** 去首尾空白并去掉中间空格，用于精确对齐的宽松形式（可自动应用） */
export function normalizeHospitalName(name: string | null | undefined): string {
  return String(name ?? "").trim().replace(/\s+/g, "")
}

const HOSPITAL_TAIL_SUFFIXES = [
  "人民医院",
  "中医医院",
  "中心医院",
  "中医院",
  "妇幼保健院",
  "专科医院",
  "医院",
] as const

/** 去掉常见医院尾缀后的核心词。过短的核心词不得用于模糊匹配。 */
export const MIN_HOSPITAL_CORE_LEN = 4

export function hospitalCore(name: string | null | undefined): string {
  let s = normalizeHospitalName(name)
  for (const suf of HOSPITAL_TAIL_SUFFIXES) {
    if (s.endsWith(suf) && s.length > suf.length) {
      s = s.slice(0, -suf.length)
      break
    }
  }
  return s
}

export function matchHospitalName(
  projectHospital: string | null | undefined,
  customerName: string | null | undefined,
): HospitalMatchKind {
  const a = String(projectHospital ?? "").trim()
  const b = String(customerName ?? "").trim()
  if (!a || !b) return "none"
  if (a === b) return "exact"
  if (normalizeHospitalName(a) === normalizeHospitalName(b)) return "normalized"
  const ca = hospitalCore(a)
  const cb = hospitalCore(b)
  if (ca.length >= MIN_HOSPITAL_CORE_LEN && ca === cb) return "fuzzy"
  return "none"
}

export interface CustomerMatchResult {
  kind: HospitalMatchKind
  customers: BackfillCustomerInput[]
}

export function matchCustomers(
  hospital: string,
  customers: BackfillCustomerInput[],
): CustomerMatchResult {
  const exact: BackfillCustomerInput[] = []
  const normalized: BackfillCustomerInput[] = []
  const fuzzy: BackfillCustomerInput[] = []
  for (const c of customers) {
    const kind = matchHospitalName(hospital, c.hospital_name)
    if (kind === "exact") exact.push(c)
    else if (kind === "normalized") normalized.push(c)
    else if (kind === "fuzzy") fuzzy.push(c)
  }
  if (exact.length === 1) return { kind: "exact", customers: exact }
  if (exact.length > 1) return { kind: "fuzzy", customers: exact }
  if (normalized.length === 1) return { kind: "normalized", customers: normalized }
  if (normalized.length > 1) return { kind: "fuzzy", customers: normalized }
  if (fuzzy.length >= 1) return { kind: "fuzzy", customers: fuzzy }
  return { kind: "none", customers: [] }
}

export type BackfillGroup = "create" | "link" | "aligned" | "pending"

export interface BackfillPreviewItem {
  group: BackfillGroup
  project: BackfillProjectInput
  customer?: BackfillCustomerInput
  candidates?: BackfillCustomerInput[]
  reuseOpportunity?: BackfillOpportunityInput
  reason?: "fuzzy" | "ambiguous" | "empty"
  /** 方案没有 opportunity_id 字段，只能在商机上写反向引用 */
  canWriteOpportunityId: boolean
}

export interface BackfillPreview {
  create: BackfillPreviewItem[]
  link: BackfillPreviewItem[]
  aligned: BackfillPreviewItem[]
  pending: BackfillPreviewItem[]
  skippedEmpty: number
  skippedDeleted: number
}

function canWriteOpportunityId(source: ProjectSourceKind): boolean {
  return source === "bid" || source === "quote"
}

function findReusableOpportunity(
  project: BackfillProjectInput,
  customerId: string,
  opportunities: BackfillOpportunityInput[],
): BackfillOpportunityInput | undefined {
  const refHit = opportunities.find(
    (o) => o.customer_id === customerId && o.ref_type === project.source && o.ref_id === project.id,
  )
  if (refHit) return refHit
  const name = project.name.trim()
  if (!name) return undefined
  return opportunities.find((o) => o.customer_id === customerId && o.opp_name.trim() === name)
}

function isAlreadyLinked(
  project: BackfillProjectInput,
  customerId: string,
  opportunities: BackfillOpportunityInput[],
): { linked: boolean; opportunity?: BackfillOpportunityInput } {
  const oid = (project.opportunity_id ?? "").trim()
  if (oid) {
    const opp = opportunities.find((o) => o.id === oid)
    if (opp && opp.customer_id === customerId) return { linked: true, opportunity: opp }
    // 项目已挂商机但商机不在本客户下：仍视为已处理，避免误改已有挂接
    if (oid) return { linked: true, opportunity: opp }
  }
  if (!canWriteOpportunityId(project.source)) {
    const reused = findReusableOpportunity(project, customerId, opportunities)
    if (reused) return { linked: true, opportunity: reused }
  }
  return { linked: false }
}

export function previewProjectBackfill(
  projects: BackfillProjectInput[],
  customers: BackfillCustomerInput[],
  opportunities: BackfillOpportunityInput[] = [],
): BackfillPreview {
  const create: BackfillPreviewItem[] = []
  const link: BackfillPreviewItem[] = []
  const aligned: BackfillPreviewItem[] = []
  const pending: BackfillPreviewItem[] = []
  let skippedEmpty = 0
  let skippedDeleted = 0

  for (const project of projects) {
    if ((project.deleted_at ?? "").trim()) {
      skippedDeleted += 1
      continue
    }
    const hospital = String(project.hospital ?? "").trim()
    if (!hospital) {
      skippedEmpty += 1
      continue
    }
    const matched = matchCustomers(hospital, customers)
    const writable = canWriteOpportunityId(project.source)
    if (matched.kind === "none") {
      create.push({ group: "create", project, canWriteOpportunityId: writable })
      continue
    }
    if (matched.kind === "fuzzy" || matched.customers.length !== 1) {
      pending.push({
        group: "pending",
        project,
        candidates: matched.customers,
        reason: matched.customers.length > 1 ? "ambiguous" : "fuzzy",
        canWriteOpportunityId: writable,
      })
      continue
    }
    const customer = matched.customers[0]
    const already = isAlreadyLinked(project, customer.id, opportunities)
    if (already.linked) {
      aligned.push({
        group: "aligned",
        project,
        customer,
        reuseOpportunity: already.opportunity,
        canWriteOpportunityId: writable,
      })
      continue
    }
    link.push({
      group: "link",
      project,
      customer,
      reuseOpportunity: findReusableOpportunity(project, customer.id, opportunities),
      canWriteOpportunityId: writable,
    })
  }

  return { create, link, aligned, pending, skippedEmpty, skippedDeleted }
}

export function backfillCounts(preview: BackfillPreview): {
  create: number
  link: number
  aligned: number
  pending: number
  skippedEmpty: number
  skippedDeleted: number
} {
  return {
    create: preview.create.length,
    link: preview.link.length,
    aligned: preview.aligned.length,
    pending: preview.pending.length,
    skippedEmpty: preview.skippedEmpty,
    skippedDeleted: preview.skippedDeleted,
  }
}

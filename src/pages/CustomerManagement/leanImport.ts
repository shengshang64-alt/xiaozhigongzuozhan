// 经营数据瘦模板导入：只解析与预览，确认后才由 hook 写库。
// 不覆盖已核实的公开字段（等级/官网/床位等）；按标准医院名去重。

import { STAGE_LABEL, type ContactInfo, type OppStage } from "./customerTypes"
import { matchHospitalName, normalizeHospitalName } from "./projectBackfill"

export const LEAN_IMPORT_COLUMNS = [
  "标准医院名",
  "联系人",
  "职务",
  "电话",
  "商机",
  "阶段",
  "上次跟进",
  "下次跟进",
  "一句话记录",
] as const

export type LeanImportColumn = (typeof LEAN_IMPORT_COLUMNS)[number]

export const LEAN_IMPORT_TEMPLATE_FILENAME = "客户经营数据导入模板.csv"

export function leanImportTemplateCsv(): string {
  const header = LEAN_IMPORT_COLUMNS.join(",")
  const example = ["测试医院-t135", "张三", "信息科主任", "13800000000", "信息化升级", "需求确认", "2026-10-01", "2026-11-20", "已完成需求调研"].join(",")
  return `\uFEFF${header}\n${example}\n`
}

export interface LeanImportRow {
  hospitalName: string
  contactName: string
  title: string
  phone: string
  oppName: string
  stageRaw: string
  lastFollow: string
  nextFollow: string
  note: string
  lineNo: number
}

export interface LeanImportCustomerInput {
  id: string
  hospital_name: string
  contacts?: ContactInfo[]
  last_follow_at?: string
}

export interface LeanImportOpportunityInput {
  id: string
  customer_id: string
  opp_name: string
}

export type LeanImportGroup = "create" | "update" | "skip" | "pending"

export interface LeanImportPreviewItem {
  group: LeanImportGroup
  hospitalName: string
  rows: LeanImportRow[]
  customer?: LeanImportCustomerInput
  candidates?: LeanImportCustomerInput[]
  reason?: string
  /** 将追加的联系人（已存在同名同电话的不列入） */
  contactsToAdd: ContactInfo[]
  /** 将新建的商机名（已有同名商机不列入） */
  oppsToAdd: Array<{ oppName: string; stage: OppStage | "" }>
  followsToAdd: Array<{ content: string; lastFollow: string; nextFollow: string; oppName: string }>
  lastFollowAt?: string
}

export interface LeanImportPreview {
  create: LeanImportPreviewItem[]
  update: LeanImportPreviewItem[]
  skip: LeanImportPreviewItem[]
  pending: LeanImportPreviewItem[]
  errors: string[]
}

const STAGE_ALIAS: Record<string, OppStage> = {
  ...Object.fromEntries((Object.entries(STAGE_LABEL) as [OppStage, string][]).map(([k, v]) => [v, k])),
  线索: "lead",
  接触: "contact",
  需求确认: "needs",
  方案阶段: "solution",
  方案: "solution",
  投标: "bidding",
  中标: "won",
  失单: "lost",
  lead: "lead",
  contact: "contact",
  needs: "needs",
  solution: "solution",
  bidding: "bidding",
  won: "won",
  lost: "lost",
}

export function parseOppStage(raw: string | null | undefined): OppStage | "" {
  const s = String(raw ?? "").trim()
  if (!s) return ""
  return STAGE_ALIAS[s] ?? STAGE_ALIAS[s.toLowerCase()] ?? ""
}

/** 只接受 YYYY-MM-DD，其它格式留空，避免把乱码写进日期字段 */
export function parseFollowDate(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim().replace(/\//g, "-")
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return ""
  const y = m[1]
  const mo = m[2].padStart(2, "0")
  const d = m[3].padStart(2, "0")
  const dt = new Date(`${y}-${mo}-${d}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return ""
  return `${y}-${mo}-${d}`
}

export function parseCsv(text: string): string[][] {
  const src = String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ",") {
      row.push(cell)
      cell = ""
      continue
    }
    if (ch === "\n") {
      row.push(cell)
      cell = ""
      if (row.some((c) => c.trim())) rows.push(row)
      row = []
      continue
    }
    cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim())) rows.push(row)
  return rows
}

function headerIndex(header: string[]): Record<LeanImportColumn, number> | null {
  const norm = header.map((h) => h.trim())
  const idx = {} as Record<LeanImportColumn, number>
  for (const col of LEAN_IMPORT_COLUMNS) {
    const i = norm.indexOf(col)
    if (i < 0) return null
    idx[col] = i
  }
  return idx
}

export function parseLeanImportCsv(text: string): { rows: LeanImportRow[]; errors: string[] } {
  const table = parseCsv(text)
  if (!table.length) return { rows: [], errors: ["文件是空的，请使用模板填写后再上传"] }
  return parseLeanImportTable(table)
}

export function parseLeanImportTable(table: string[][]): { rows: LeanImportRow[]; errors: string[] } {
  const errors: string[] = []
  if (!table.length) return { rows: [], errors: ["文件是空的，请使用模板填写后再上传"] }
  const idx = headerIndex(table[0] ?? [])
  if (!idx) {
    return {
      rows: [],
      errors: [`表头必须包含：${LEAN_IMPORT_COLUMNS.join("、")}`],
    }
  }
  const rows: LeanImportRow[] = []
  for (let i = 1; i < table.length; i++) {
    const raw = table[i] ?? []
    const get = (col: LeanImportColumn) => String(raw[idx[col]] ?? "").trim()
    const hospitalName = get("标准医院名")
    if (!hospitalName) {
      if (raw.some((c) => String(c).trim())) errors.push(`第 ${i + 1} 行缺少标准医院名，已跳过`)
      continue
    }
    rows.push({
      hospitalName,
      contactName: get("联系人"),
      title: get("职务"),
      phone: get("电话"),
      oppName: get("商机"),
      stageRaw: get("阶段"),
      lastFollow: parseFollowDate(get("上次跟进")),
      nextFollow: parseFollowDate(get("下次跟进")),
      note: get("一句话记录"),
      lineNo: i + 1,
    })
  }
  return { rows, errors }
}

function contactKey(c: { name?: string; phone?: string }): string {
  return `${String(c.name ?? "").trim()}|${String(c.phone ?? "").trim()}`
}

function laterDate(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

export function previewLeanImport(
  rows: LeanImportRow[],
  customers: LeanImportCustomerInput[],
  opportunities: LeanImportOpportunityInput[] = [],
): LeanImportPreview {
  const errors: string[] = []
  const byName = new Map<string, LeanImportRow[]>()
  const order: string[] = []
  for (const row of rows) {
    const key = normalizeHospitalName(row.hospitalName)
    if (!key) continue
    if (!byName.has(key)) {
      byName.set(key, [])
      order.push(key)
    }
    byName.get(key)!.push(row)
  }

  const create: LeanImportPreviewItem[] = []
  const update: LeanImportPreviewItem[] = []
  const skip: LeanImportPreviewItem[] = []
  const pending: LeanImportPreviewItem[] = []

  for (const key of order) {
    const groupRows = byName.get(key) ?? []
    const hospitalName = groupRows[0]?.hospitalName ?? ""
    const exactHits = customers.filter((c) => {
      const kind = matchHospitalName(hospitalName, c.hospital_name)
      return kind === "exact" || kind === "normalized"
    })
    const fuzzyHits = customers.filter((c) => matchHospitalName(hospitalName, c.hospital_name) === "fuzzy")

    if (exactHits.length > 1) {
      pending.push(baseItem("pending", hospitalName, groupRows, { candidates: exactHits, reason: "标准名对应到多家已有客户，需确认" }))
      continue
    }
    if (exactHits.length === 0 && fuzzyHits.length >= 1) {
      pending.push(baseItem("pending", hospitalName, groupRows, { candidates: fuzzyHits, reason: "名称接近已有客户，需确认后才合并，避免误覆盖" }))
      continue
    }

    const customer = exactHits[0]
    const existingContacts = new Set((customer?.contacts ?? []).map(contactKey))
    const seenNew = new Set<string>()
    const contactsToAdd: ContactInfo[] = []
    const oppSeen = new Set(
      opportunities.filter((o) => customer && o.customer_id === customer.id).map((o) => o.opp_name.trim()),
    )
    const oppsToAdd: Array<{ oppName: string; stage: OppStage | "" }> = []
    const followsToAdd: LeanImportPreviewItem["followsToAdd"] = []
    let lastFollowAt = ""

    for (const row of groupRows) {
      if (row.contactName) {
        const ck = contactKey({ name: row.contactName, phone: row.phone })
        if (existingContacts.has(ck) || seenNew.has(ck)) continue
        seenNew.add(ck)
        contactsToAdd.push({ name: row.contactName, title: row.title, phone: row.phone })
      }
      if (row.oppName) {
        if (!oppSeen.has(row.oppName) && !oppsToAdd.some((o) => o.oppName === row.oppName)) {
          oppsToAdd.push({ oppName: row.oppName, stage: parseOppStage(row.stageRaw) })
        }
      }
      if (row.note || row.lastFollow || row.nextFollow) {
        followsToAdd.push({
          content: row.note || "导入跟进",
          lastFollow: row.lastFollow,
          nextFollow: row.nextFollow,
          oppName: row.oppName,
        })
      }
      lastFollowAt = laterDate(lastFollowAt, row.lastFollow)
    }

    if (customer) {
      const curLast = (customer.last_follow_at ?? "").slice(0, 10)
      const nextLast = laterDate(curLast, lastFollowAt)
      const lastFollowPatch = nextLast && nextLast !== curLast ? nextLast : undefined
      if (!contactsToAdd.length && !oppsToAdd.length && !followsToAdd.length && !lastFollowPatch) {
        skip.push(baseItem("skip", hospitalName, groupRows, { customer, reason: "联系人、商机与跟进均已存在，已跳过" }))
        continue
      }
      update.push(
        baseItem("update", hospitalName, groupRows, {
          customer,
          contactsToAdd,
          oppsToAdd,
          followsToAdd,
          lastFollowAt: lastFollowPatch,
        }),
      )
      continue
    }

    create.push(
      baseItem("create", hospitalName, groupRows, {
        contactsToAdd,
        oppsToAdd,
        followsToAdd,
        lastFollowAt: lastFollowAt || undefined,
      }),
    )
  }

  return { create, update, skip, pending, errors }
}

function baseItem(
  group: LeanImportGroup,
  hospitalName: string,
  rows: LeanImportRow[],
  extra: Partial<LeanImportPreviewItem> = {},
): LeanImportPreviewItem {
  return {
    group,
    hospitalName,
    rows,
    contactsToAdd: extra.contactsToAdd ?? [],
    oppsToAdd: extra.oppsToAdd ?? [],
    followsToAdd: extra.followsToAdd ?? [],
    customer: extra.customer,
    candidates: extra.candidates,
    reason: extra.reason,
    lastFollowAt: extra.lastFollowAt,
  }
}

export function leanImportCounts(preview: LeanImportPreview): {
  create: number
  update: number
  skip: number
  pending: number
  errors: number
} {
  return {
    create: preview.create.length,
    update: preview.update.length,
    skip: preview.skip.length,
    pending: preview.pending.length,
    errors: preview.errors.length,
  }
}

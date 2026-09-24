// 竞品分析「事实聚合层」：把内部 4 类可核对源（软著/CRM 客户占用率/知识库/情报）
// 打包成结构化事实片段，喂给 useCompetitorAnalysis 的 prompt。
//
// 设计契约（批次 X1）：
// - AI 只能引用被喂进来的事实，不能凭记忆；因此每条事实必须带稳定 evidence id，
//   AI 返回 updates[].evidence_refs 指向具体 id，前端 Diff 展示"依据哪几条"。
// - id 前缀：cr:<regNo> / cust:<hospitalId>:<system> / kb:<docId>#<chunkIdx> / intel:<itemId>
// - 单段防溢出：软著≤20 / 客户≤15 / KB≤8 / intel≤20；超出走计数摘要。
// - 任何一类源失败静默回退空数组，不阻断分析（模型至少能拿到"该维度无新事实"的诚实信号）。
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import { listKbDocs, searchKbDocs, type KbDocRow, type KbSearchHit } from "@/lib/kbCore"
import { effectivePolicy } from "@/lib/kbPolicy"
import { loadCopyrights, type CopyrightRow } from "./copyrightCore"

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface CopyrightFacts {
  total: number
  /** 分类 → 条数（按软件分类 swClass 聚合） */
  byClass: Record<string, number>
  earliest: string
  latest: string
  /** 近 2 年新增的条目（按 regDate 倒序），最多 20 条 */
  recent2y: CopyrightRow[]
  /** 展示用样本（含 regNo/name/swClass/regDate），最多 20 条 */
  notable: CopyrightRow[]
  /** 别名匹配失败提示（当 total=0 时前端可显示"未在软著库找到 <aliases>"） */
  attemptedAliases: string[]
}

export interface CustomerOccupied {
  hospitalId: string
  hospitalName: string
  level: string
  region: string
  system: string
  vendor: string
  /** evidence id：cust:<hospitalId>:<systemSlug> */
  evidenceId: string
}

export interface CustomerShare {
  totalHospitalsTracked: number
  occupiedCount: number
  /** 已占用的（去重后），最多 15 条 */
  occupied: CustomerOccupied[]
  /** 系统维度：HIS / EMR / HIP / ... → 医院数 */
  bySystem: Record<string, number>
  /** 区域维度：省份 → 医院数 */
  byRegion: Record<string, number>
  attemptedAliases: string[]
  /** 抓取失败或返回空时的降级原因（可选） */
  note?: string
}

export interface KbEvidence {
  evidenceId: string
  docId: string
  docTitle: string
  folderPath: string
  category: string
  headingPath?: string
  snippet: string
}

export interface IntelEvidence {
  evidenceId: string
  itemId: string
  title: string
  summary: string
  publishedAt: string
  sourceName: string
  url: string
  itemType: string
}

export interface EvidenceBundle {
  cr: CopyrightFacts
  cust: CustomerShare
  kb: KbEvidence[]
  intel: IntelEvidence[]
  /** 拼装的完整事实上下文（进入 user message） */
  contextString: string
  /** 材料清单：给 UI 展示"本次用了哪几类源、命中多少条" */
  materialSummary: Array<{
    kind: "cr" | "cust" | "kb" | "intel" | "bid" | "ann" | "crx"
    label: string
    count: number
    note?: string
  }>
}

// ---------------------------------------------------------------------------
// 别名表（首批硬编码，不建 alias 集合）
// 竞品 name ↔ 软著 company / 客户 system_vendors.vendor 的映射
// ---------------------------------------------------------------------------

const COMPANY_ALIASES: Record<string, string[]> = {
  卫宁健康: ["卫宁健康", "卫宁", "winning", "南京卫宁", "Winning Health"],
  东软集团: ["东软", "Neusoft", "东软集团", "东软医疗"],
  东华医为: ["东华医为", "imedway", "东华"],
  创业慧康: ["创业慧康", "bsoft", "慧康", "创业"],
  久远银海: ["久远银海", "银海"],
  万达信息: ["万达信息", "万达"],
  嘉和美康: ["嘉和美康", "和美康", "嘉华"],
  麦迪科技: ["麦迪科技", "麦迪斯顿", "midi"],
  和仁科技: ["和仁", "浙江和仁", "HeRen"],
  智业软件: ["智业", "智业软件"],
  中联信息: ["中联", "重庆中联", "中联信息产业"],
  曼荼罗: ["曼荼罗", "mandala"],
  荣科科技: ["荣科", "荣科科技"],
  荣科智维: ["荣科智维"],
  易联众: ["易联众"],
  尚同软件: ["尚同"],
  天健科技: ["天健"],
  山大地纬: ["山大地纬", "地纬"],
  烟台荣昌: ["荣昌", "烟台荣昌"],
  中一科技: ["中一", "北京中一"],
  望海康信: ["望海康信", "望海"],
}

/** 综合 name / legal_name / 用户填的 keywords 生成检索别名集合（小写用于匹配） */
export function buildCompetitorAliases(name: string, legalName: string, keywords: string[] = []): string[] {
  const set = new Set<string>()
  const add = (s: string) => {
    const t = String(s || "").trim()
    if (t && t.length >= 2) set.add(t)
  }
  add(name)
  add(legalName)
  for (const a of COMPANY_ALIASES[name] || []) add(a)
  // legal_name 前 6 字（去"科技/信息/股份/集团/有限公司"）作为兜底
  const trimmed = String(legalName || "")
    .replace(/(有限责任公司|股份有限公司|有限公司|集团|科技|信息|技术|软件|软件股份|omedo)/g, "")
    .trim()
  if (trimmed.length >= 2) add(trimmed)
  for (const k of keywords || []) add(k)
  return [...set]
}

/** vendor 字段匹配：任一别名以大小写不敏感子串命中即视为占用 */
export function matchVendor(vendorStr: string, aliases: string[]): boolean {
  const hay = String(vendorStr || "").toLowerCase()
  if (!hay) return false
  for (const a of aliases) {
    const al = String(a).toLowerCase().trim()
    if (al.length >= 2 && hay.includes(al)) return true
  }
  return false
}

/** 软著行匹配：company 或 owner 命中任一别名 */
function matchCopyrightRow(row: CopyrightRow, aliases: string[]): boolean {
  return matchVendor(row.company, aliases) || matchVendor(row.owner, aliases)
}

// ---------------------------------------------------------------------------
// 1. 软著事实
// ---------------------------------------------------------------------------

export function buildCopyrightFactsFromRows(rows: CopyrightRow[], aliases: string[]): CopyrightFacts {
  const hits = rows.filter((r) => matchCopyrightRow(r, aliases))
  const byClass: Record<string, number> = {}
  for (const r of hits) {
    const k = r.swClass || "未分类"
    byClass[k] = (byClass[k] || 0) + 1
  }
  const dates = hits.map((r) => r.regDate).filter(Boolean).sort()
  const now = new Date()
  const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate())
    .toISOString()
    .slice(0, 10)
  const recent = hits
    .filter((r) => r.regDate >= twoYearsAgo)
    .sort((a, b) => (b.regDate || "").localeCompare(a.regDate || ""))
    .slice(0, 20)
  // notable 从 recent 里再取前 20；如果 recent 为空则按 regDate 倒序取 20
  const notable = (recent.length > 0 ? recent : [...hits].sort((a, b) => (b.regDate || "").localeCompare(a.regDate || ""))).slice(0, 20)
  return {
    total: hits.length,
    byClass,
    earliest: dates[0] || "",
    latest: dates[dates.length - 1] || "",
    recent2y: recent,
    notable,
    attemptedAliases: aliases,
  }
}

export async function buildCopyrightFacts(aliases: string[]): Promise<CopyrightFacts> {
  try {
    const { rows } = await loadCopyrights()
    return buildCopyrightFactsFromRows(rows, aliases)
  } catch {
    return { total: 0, byClass: {}, earliest: "", latest: "", recent2y: [], notable: [], attemptedAliases: aliases }
  }
}

// ---------------------------------------------------------------------------
// 2. CRM 客户占用率
// ---------------------------------------------------------------------------

interface CustomerApiRow {
  id: string
  hospital_name?: string
  level?: string
  region?: string
  system_vendors?: Array<{ system: string; vendor: string }>
}

async function fetchAllCustomersForShare(): Promise<{ rows: CustomerApiRow[]; error?: string }> {
  const base = getPocketBaseUrl()
  const authHeaders: Record<string, string> = vibexAuthHeaders()
  const headers: Record<string, string> = { "Content-Type": "application/json", ...authHeaders }
  const uid = authHeaders["X-Rh-User-Id"] || ""
  const all: CustomerApiRow[] = []
  // 客户量级：单部署通常 100–1500；perPage=200,最多 10 页 = 2000 覆盖绝大多数场景。
  for (let page = 1; page <= 10; page += 1) {
    try {
      const res = await fetch(
        `${base}/api/customers?rh_user_id=${encodeURIComponent(uid)}&page=${page}&perPage=200`,
        { headers },
      )
      if (!res.ok) return { rows: all, error: `HTTP ${res.status}` }
      const data = (await res.json()) as { items?: CustomerApiRow[]; perPage?: number }
      const rows = Array.isArray(data.items) ? data.items : []
      all.push(...rows)
      if (rows.length < 200) break
    } catch (e) {
      return { rows: all, error: e instanceof Error ? e.message : "fetch failed" }
    }
  }
  return { rows: all }
}

function sanitizeSystemSlug(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "").slice(0, 16) || "x"
}

export function buildCustomerShareFromRows(
  rows: CustomerApiRow[],
  aliases: string[],
): CustomerShare {
  const seen = new Set<string>()
  const occupied: CustomerOccupied[] = []
  const bySystem: Record<string, number> = {}
  const byRegion: Record<string, number> = {}
  for (const r of rows) {
    const vendors = Array.isArray(r.system_vendors) ? r.system_vendors : []
    for (const sv of vendors) {
      if (!matchVendor(sv.vendor, aliases)) continue
      const hid = String(r.id || "")
      if (!hid) continue
      const key = `${hid}::${sv.system}`
      if (seen.has(key)) continue
      seen.add(key)
      const region = String(r.region || "").slice(0, 20)
      const systemKey = String(sv.system || "其他").slice(0, 20)
      // region 前 2 字粗略视为省级；不做严格归一
      const regionKey = region.slice(0, 3) || "未知"
      bySystem[systemKey] = (bySystem[systemKey] || 0) + 1
      byRegion[regionKey] = (byRegion[regionKey] || 0) + 1
      occupied.push({
        hospitalId: hid,
        hospitalName: String(r.hospital_name || "").slice(0, 40),
        level: String(r.level || "").slice(0, 20),
        region,
        system: systemKey,
        vendor: String(sv.vendor || "").slice(0, 40),
        evidenceId: `cust:${hid}:${sanitizeSystemSlug(systemKey)}`,
      })
    }
  }
  occupied.sort((a, b) => b.level.localeCompare(a.level) || a.hospitalName.localeCompare(b.hospitalName))
  return {
    totalHospitalsTracked: rows.length,
    occupiedCount: occupied.length,
    occupied: occupied.slice(0, 15),
    bySystem,
    byRegion,
    attemptedAliases: aliases,
  }
}

export async function buildCustomerShare(aliases: string[]): Promise<CustomerShare> {
  const { rows, error } = await fetchAllCustomersForShare()
  const share = buildCustomerShareFromRows(rows, aliases)
  if (error) share.note = `CRM 拉取部分失败：${error}（已按拉到的 ${rows.length} 家统计）`
  return share
}

// ---------------------------------------------------------------------------
// 3. 知识库命中
// ---------------------------------------------------------------------------

let kbCache: { ts: number; rows: KbDocRow[] } | null = null
const KB_CACHE_TTL_MS = 5 * 60 * 1000

async function getKbDocsCached(): Promise<KbDocRow[]> {
  if (kbCache && Date.now() - kbCache.ts < KB_CACHE_TTL_MS) return kbCache.rows
  const rows = await listKbDocs({ perPage: 200 })
  kbCache = { ts: Date.now(), rows }
  return rows
}

/** 只保留允许进 AI 原文的文档（排除合同商务/资质证书等脱敏/禁止类） */
function filterKbDocsAllowedForAi(docs: KbDocRow[]): KbDocRow[] {
  return docs.filter((d) => {
    try {
      return effectivePolicy(d).ai_context_mode === "original"
    } catch {
      return true
    }
  })
}

export async function buildKbEvidence(aliases: string[], productHints: string[] = []): Promise<KbEvidence[]> {
  const nameQuery = aliases.slice(0, 3).join(" ")
  const prodQuery = productHints.slice(0, 2).join(" ")
  const question = `${nameQuery} ${prodQuery}`.trim() || aliases[0] || ""
  if (!question) return []
  let docs: KbDocRow[]
  try {
    docs = filterKbDocsAllowedForAi(await getKbDocsCached())
  } catch {
    return []
  }
  let hits: KbSearchHit[] = []
  try {
    hits = searchKbDocs(docs, question, 8)
  } catch {
    return []
  }
  return hits.slice(0, 8).map((h, i) => ({
    evidenceId: `kb:${h.doc.id}#${i}`,
    docId: h.doc.id,
    docTitle: String(h.doc.title || "").slice(0, 80),
    folderPath: String(h.doc.folder_path || "").slice(0, 60),
    category: String(h.doc.doc_category || "其他"),
    headingPath: h.headingPath ? String(h.headingPath).slice(0, 80) : undefined,
    snippet: String(h.snippet || "").slice(0, 400),
  }))
}

// ---------------------------------------------------------------------------
// 4. 情报命中（迁移自 useCompetitorAnalysis.fetchRelatedIntel，per_page 10→20，competitor 优先）
// ---------------------------------------------------------------------------

interface IntelApiItem {
  id: string
  title?: string
  summary?: string
  published_at?: string
  source_name?: string
  url?: string
  item_type?: string
}

export async function buildIntelEvidence(aliases: string[]): Promise<IntelEvidence[]> {
  const base = getPocketBaseUrl()
  const headers: Record<string, string> = { "Content-Type": "application/json", ...vibexAuthHeaders() }
  const terms = aliases.filter((a) => a && a.length >= 2).slice(0, 3)
  const map = new Map<string, IntelEvidence>()
  await Promise.all(
    terms.map(async (term) => {
      const params = new URLSearchParams({ q: term, per_page: "20", page: "1" })
      try {
        const res = await fetch(`${base}/api/intel/items?${params}`, { headers })
        if (!res.ok) return
        const data = await res.json()
        const items = (data.items || []) as IntelApiItem[]
        for (const it of items) {
          const id = String(it.id || "")
          if (!id || map.has(id)) continue
          map.set(id, {
            evidenceId: `intel:${id}`,
            itemId: id,
            title: String(it.title || ""),
            summary: String(it.summary || ""),
            publishedAt: String(it.published_at || ""),
            sourceName: String(it.source_name || ""),
            url: String(it.url || ""),
            itemType: String(it.item_type || ""),
          })
        }
      } catch {
        /* 单词查询失败忽略 */
      }
    }),
  )
  const all = [...map.values()]
  // competitor 类型优先，其次按时间倒序
  all.sort((a, b) => {
    const at = a.itemType === "competitor" ? 1 : 0
    const bt = b.itemType === "competitor" ? 1 : 0
    if (at !== bt) return bt - at
    return (b.publishedAt || "").localeCompare(a.publishedAt || "")
  })
  return all.slice(0, 20)
}

// ---------------------------------------------------------------------------
// 上下文拼装（给 AI 的 user message）
// ---------------------------------------------------------------------------

function formatCrSection(cr: CopyrightFacts): string {
  if (cr.total === 0) {
    return `【软著事实】未在软著登记库找到与「${cr.attemptedAliases.slice(0, 3).join("/")}」匹配的条目。若竞品有产品/技术类字段更新需求，本维度无新事实依据。`
  }
  const byClassStr = Object.entries(cr.byClass)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => `${k}=${v}`)
    .join("、")
  const notableStr = cr.notable
    .slice(0, 20)
    .map((r) => `- [cr:${r.regNo}] ${r.name}${r.version ? " " + r.version : ""}（${r.swClass || "未分类"}） 登记日 ${r.regDate}`)
    .join("\n")
  return `【软著事实·共 ${cr.total} 条 · 分类：${byClassStr} · 时间跨度 ${cr.earliest}~${cr.latest}】
近 2 年新增 ${cr.recent2y.length} 条，样本（最多 20 条）：
${notableStr}`
}

function formatCustSection(cust: CustomerShare): string {
  if (cust.occupiedCount === 0) {
    return `【CRM 客户占用】跟踪 ${cust.totalHospitalsTracked} 家客户中，未发现在用系统由「${cust.attemptedAliases.slice(0, 3).join("/")}」提供的记录。${cust.note || ""}`
  }
  const sysStr = Object.entries(cust.bySystem)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join("、")
  const regStr = Object.entries(cust.byRegion)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => `${k}=${v}`)
    .join("、")
  const samples = cust.occupied
    .slice(0, 15)
    .map((o) => `- [${o.evidenceId}] ${o.hospitalName}（${o.level || "等级未填"}/${o.region || "区域未填"}）使用 ${o.system} 系统，厂商标注：${o.vendor}`)
    .join("\n")
  return `【CRM 客户占用·共 ${cust.occupiedCount} 条命中，覆盖 ${cust.totalHospitalsTracked} 家跟踪医院】
按系统：${sysStr}
按区域（前 8）：${regStr}
样本（最多 15 条）：
${samples}${cust.note ? "\n" + cust.note : ""}`
}

function formatKbSection(kb: KbEvidence[]): string {
  if (kb.length === 0) return `【内部知识库】未检索到与该竞品直接相关的文档片段。`
  const rows = kb
    .map(
      (h) =>
        `- [${h.evidenceId}] ${h.docTitle}${h.headingPath ? " · " + h.headingPath : ""}（分类：${h.category}）\n  片段：${h.snippet}`,
    )
    .join("\n")
  return `【内部知识库·命中 ${kb.length} 段（限制在允许进 AI 原文的分类）】\n${rows}`
}

function formatIntelSection(intel: IntelEvidence[]): string {
  if (intel.length === 0) return `【关联情报】暂无匹配条目。`
  const rows = intel
    .slice(0, 20)
    .map(
      (it) =>
        `- [${it.evidenceId}${it.itemType === "competitor" ? " · 竞品" : ""}] [${it.publishedAt.slice(0, 10)}] ${it.title}（${it.sourceName}）\n  摘要：${(it.summary || "无").slice(0, 200)}`,
    )
    .join("\n")
  return `【关联情报·最近 ${intel.length} 条（竞品类优先）】\n${rows}`
}

export function assembleEvidenceContext(cr: CopyrightFacts, cust: CustomerShare, kb: KbEvidence[], intel: IntelEvidence[]): string {
  return [formatCrSection(cr), formatCustSection(cust), formatKbSection(kb), formatIntelSection(intel)].join("\n\n")
}

export function buildMaterialSummary(cr: CopyrightFacts, cust: CustomerShare, kb: KbEvidence[], intel: IntelEvidence[]) {
  return [
    { kind: "cr" as const, label: "软著登记", count: cr.total, note: `近 2 年新增 ${cr.recent2y.length}` },
    {
      kind: "cust" as const,
      label: "CRM 客户占用",
      count: cust.occupiedCount,
      note: `覆盖 ${cust.totalHospitalsTracked} 家跟踪医院${cust.note ? " · " + cust.note : ""}`,
    },
    { kind: "kb" as const, label: "内部知识库", count: kb.length },
    { kind: "intel" as const, label: "情报中心", count: intel.length },
  ]
}

// ---------------------------------------------------------------------------
// 顶层聚合：给 useCompetitorAnalysis 消费
// ---------------------------------------------------------------------------

export async function gatherEvidenceBundle(row: {
  name: string
  legal_name: string
  keywords?: string[]
  products?: string
}): Promise<EvidenceBundle> {
  const aliases = buildCompetitorAliases(row.name, row.legal_name, row.keywords || [])
  const productHints = String(row.products || "")
    .split(/[,，、\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .slice(0, 3)
  const [cr, cust, kb, intel] = await Promise.all([
    buildCopyrightFacts(aliases),
    buildCustomerShare(aliases),
    buildKbEvidence(aliases, productHints),
    buildIntelEvidence(aliases),
  ])
  const contextString = assembleEvidenceContext(cr, cust, kb, intel)
  const materialSummary = buildMaterialSummary(cr, cust, kb, intel)
  return { cr, cust, kb, intel, contextString, materialSummary }
}

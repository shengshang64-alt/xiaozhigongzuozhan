// 竞品软件著作权明细数据层：懒加载 public/data/competitor-copyrights.json（列式紧凑结构）后纯前端检索。
// 数据由 scripts/extract-competitor-copyrights.mjs 从《医疗信息化公司软件著作权汇总.xlsx》抽取，
// 13,505 条 / 20 家，登记事实可核对（登记号/日期），零 AI、零后端改动。
import { useMemo, useState } from "react"

export interface CopyrightRow {
  /** 公司简称（与竞品档案 name 对齐） */
  company: string
  /** 软件名称 */
  name: string
  /** 简称 */
  short: string
  /** 版本号 */
  version: string
  /** 软件分类 */
  swClass: string
  /** 行业分类 */
  indClass: string
  /** 登记号（如 2026SR0811498） */
  regNo: string
  /** 登记批准日期 */
  regDate: string
  /** 首次发表日期 */
  pubDate: string
  /** 著作权人（企业主体全称） */
  owner: string
}

interface RawPayload {
  generated: string
  source: string
  cols: (keyof CopyrightRow)[]
  rows: string[][]
}

let cache: Promise<{ meta: { generated: string; source: string }; rows: CopyrightRow[] }> | null = null

/** 懒加载软著明细（模块级缓存，重复调用不重复请求） */
export function loadCopyrights() {
  if (!cache) {
    const url = `${import.meta.env.BASE_URL}data/competitor-copyrights.json`.replace(/\/{2,}/g, "/")
    cache = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<RawPayload>
      })
      .then((json) => {
        const rows = json.rows.map((r) => {
          const o = {} as CopyrightRow
          json.cols.forEach((c, i) => {
            o[c] = r[i] ?? ""
          })
          return o
        })
        return { meta: { generated: json.generated, source: json.source }, rows }
      })
      .catch((err) => {
        cache = null // 失败不缓存，允许下次重试
        throw err
      })
  }
  return cache
}

/** 多字段包含式关键词匹配（空格分词，全部命中才算命中） */
function matchesQuery(haystacks: string[], q: string): boolean {
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const hay = haystacks.join(" ").toLowerCase()
  return terms.every((t) => hay.includes(t))
}

export interface CopyrightQuery {
  company: string // "all" 或公司简称
  q: string
  swClass: string // "all" 或分类名
  /** 登记日期范围（YYYY-MM-DD，空串为不限） */
  dateFrom: string
  dateTo: string
}

export function useCopyrightQuery(rows: CopyrightRow[] | null, initialCompany = "all") {
  const [company, setCompany] = useState<string>(initialCompany)
  const [q, setQ] = useState("")
  const [swClass, setSwClass] = useState<string>("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [page, setPage] = useState(1)

  const companies = useMemo(() => {
    if (!rows) return []
    return [...new Set(rows.map((r) => r.company))]
  }, [rows])

  const classOptions = useMemo(() => {
    if (!rows) return []
    const src = company === "all" ? rows : rows.filter((r) => r.company === company)
    return [...new Set(src.map((r) => r.swClass).filter(Boolean))].sort()
  }, [rows, company])

  /** 命中行（按登记日期倒序） */
  const filtered = useMemo(() => {
    if (!rows) return []
    return rows
      .filter(
        (r) =>
          (company === "all" || r.company === company) &&
          (swClass === "all" || r.swClass === swClass) &&
          (!dateFrom || r.regDate >= dateFrom) &&
          (!dateTo || r.regDate <= dateTo) &&
          matchesQuery([r.name, r.short, r.version, r.regNo, r.owner, r.swClass, r.indClass], q),
      )
      .sort((a, b) => (a.regDate === b.regDate ? a.regNo.localeCompare(b.regNo) : b.regDate.localeCompare(a.regDate)))
  }, [rows, company, swClass, dateFrom, dateTo, q])

  /** 各家命中数（公司下拉展示用） */
  const countByCompany = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of filtered) m.set(r.company, (m.get(r.company) || 0) + 1)
    return m
  }, [filtered])

  return {
    companies,
    classOptions,
    filtered,
    countByCompany,
    page,
    setPage,
    filters: { company, setCompany, q, setQ, swClass, setSwClass, dateFrom, setDateFrom, dateTo, setDateTo },
  }
}

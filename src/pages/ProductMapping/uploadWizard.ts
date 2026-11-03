import { normalizeCustomerLine } from "@/pages/SolutionStudio/checklistTypes"

// ---------------------------------------------------------------------------
// 上传向导（2026-10-28 产品映射重构）：任意业主/客户 Excel → 网格 → 表头行/名称列
// 可确认调整 → 保留整行原表单元格的条目清单。
// 旧实现 parseCustomerLinesFile 只取「每行第一个非空单元格」，序号/分类/说明全混成条目，
// 实测不可用；本模块把「哪一行是表头、哪几列拼成名称」交给用户一锤定音，并记住模板。
// 纯函数 + 可注入存储，node 环境可单测。
// ---------------------------------------------------------------------------

export type SheetGrid = {
  name: string
  /** 文本网格：每个单元格已压缩空白；行内长度不齐（以最大宽度为准补齐） */
  rows: string[][]
}

export type WizardConfig = {
  sheetName: string
  /** 表头行（网格内 0 起下标） */
  headerRow: number
  /** 参与拼接名称的列（0 起下标，可多列） */
  nameCols: number[]
}

export type ParsedCustomerItem = {
  norm: string
  raw: string
  cells: string[]
}

export type ParsedCustomerTable = WizardConfig & {
  /** 表头标签（空表头补「列N」），长度 = 网格最大宽度 */
  columns: string[]
  items: ParsedCustomerItem[]
  /** 因名称列为空被跳过的数据行数 */
  skippedEmpty: number
}

/** 读取 xlsx/xls/csv 为若干文本网格（跳过全空 sheet；xlsx 为 CJS 包，按需动态引入） */
export async function readWorkbookGrids(source: File | ArrayBuffer): Promise<SheetGrid[]> {
  const XLSX = await import("xlsx")
  const buf = source instanceof ArrayBuffer ? source : await source.arrayBuffer()
  const wb = XLSX.read(buf)
  const out: SheetGrid[] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const rows = XLSX.utils
      .sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: true })
      .map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "").replace(/\s+/g, " ").trim()) : []))
    if (rows.some((r) => r.some((c) => c))) out.push({ name, rows })
  }
  if (!out.length) throw new Error("文件内没有可解析的表格内容")
  return out
}

/** 表头行关键词（命中越多越像表头） */
const HEADER_KEYWORDS = [
  "序号", "名称", "系统", "模块", "分类", "类别", "项目", "内容", "数量", "单位",
  "单价", "金额", "备注", "说明", "要求", "参数", "厂家", "品牌", "规格", "型号", "功能", "清单",
]

/** 名称列候选关键词（这些列的内容才像「系统/模块条目」） */
const NAME_COL_KEYWORDS = ["名称", "系统", "模块", "项目", "内容", "清单", "设备", "软件", "服务"]

/** 一定不是名称列的表头（序号/金额/日期等） */
const NOT_NAME_COL = /序号|数量|单位|单价|金额|总价|备注|说明|厂家|品牌|型号|日期|时间|联系|电话|地址|编号|代码/

export function gridWidth(rows: string[][]): number {
  let w = 0
  for (const r of rows) w = Math.max(w, r.length)
  return w
}

/** 猜测表头行：前 15 行里关键词命中最多的行；都没有则取首个 ≥2 非空单元格的行 */
export function guessHeaderRow(rows: string[][]): number {
  let best = -1
  let bestScore = 0
  const limit = Math.min(rows.length, 15)
  for (let i = 0; i < limit; i++) {
    const row = rows[i] ?? []
    let score = 0
    let nonEmpty = 0
    for (const cell of row) {
      if (!cell) continue
      nonEmpty += 1
      if (HEADER_KEYWORDS.some((k) => cell.includes(k))) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      best = i
    } else if (best < 0 && nonEmpty >= 2) {
      best = i
    }
  }
  return best >= 0 ? best : 0
}

/**
 * 猜测名称列：表头含名称类关键词且不在排除列内；
 * 一个都没猜中时，取数据区平均文本最长、且不是纯数字的列。
 */
export function guessNameCols(rows: string[][], headerRow: number, width: number): number[] {
  const header = rows[headerRow] ?? []
  const hits: number[] = []
  for (let c = 0; c < width; c++) {
    const h = header[c] ?? ""
    if (!h || NOT_NAME_COL.test(h)) continue
    if (NAME_COL_KEYWORDS.some((k) => h.includes(k))) hits.push(c)
  }
  if (hits.length) return hits.slice(0, 3)
  // 兜底：数据区平均长度最长的文本列
  let bestCol = -1
  let bestAvg = 0
  for (let c = 0; c < width; c++) {
    let total = 0
    let n = 0
    for (let r = headerRow + 1; r < Math.min(rows.length, headerRow + 31); r++) {
      const v = (rows[r] ?? [])[c] ?? ""
      if (!v || /^\d+(\.\d+)?$/.test(v)) continue
      total += v.length
      n += 1
    }
    const avg = n ? total / n : 0
    if (avg > bestAvg) {
      bestAvg = avg
      bestCol = c
    }
  }
  return bestCol >= 0 ? [bestCol] : [0]
}

/** 表头标签：空表头补「列N」（1 起），长度对齐网格最大宽度 */
export function headerLabels(rows: string[][], headerRow: number, width: number): string[] {
  const header = rows[headerRow] ?? []
  const out: string[] = []
  for (let c = 0; c < width; c++) out.push(header[c] || `列${c + 1}`)
  return out
}

/** 按向导配置抽取条目：名称列拼接 → 归一化 → 去空/去重；cells 保留整行原表文本 */
export function extractCustomerTable(grid: SheetGrid, cfg: WizardConfig): ParsedCustomerTable {
  const width = gridWidth(grid.rows)
  const columns = headerLabels(grid.rows, cfg.headerRow, width)
  const items: ParsedCustomerItem[] = []
  const seen = new Set<string>()
  let skippedEmpty = 0
  for (let r = cfg.headerRow + 1; r < grid.rows.length; r++) {
    const row = grid.rows[r] ?? []
    const cells: string[] = []
    for (let c = 0; c < width; c++) cells.push(row[c] ?? "")
    if (!cells.some((c) => c)) continue // 全空行
    const name = cfg.nameCols.map((c) => cells[c] ?? "").filter(Boolean).join(" ").trim()
    const norm = normalizeCustomerLine(name)
    if (norm.length < 2) {
      if (name || cells.some((c) => c)) skippedEmpty += 1
      continue
    }
    if (seen.has(norm)) continue
    seen.add(norm)
    items.push({ norm, raw: name, cells })
  }
  return { ...cfg, sheetName: grid.name, columns, items, skippedEmpty }
}

// ---------------------------------------------------------------------------
// 模板记忆：同一来源的表格结构（表头指纹）→ 上次的解析配置，下次自动预填。
// 存 localStorage（单机口径，与设计方案「模板记忆」一致；不依赖 PB schema 变更）。
// ---------------------------------------------------------------------------

export type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void }

export type WizardTemplate = WizardConfig & {
  headers: string[]
  savedAt: string
}

const TEMPLATE_KEY = "pm_wizard_templates_v1"

function defaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage
  } catch {
    /* SSR / 隐私模式 */
  }
  return null
}

/** 表头指纹：与 sheet 名无关（业主可能改 sheet 名），只看归一化后的表头序列 */
export function templateFingerprint(headers: string[]): string {
  return headers.map((h) => (h ?? "").replace(/\s+/g, "").toLowerCase()).join("|")
}

export function loadWizardTemplates(store?: StorageLike): Record<string, WizardTemplate> {
  const s = store ?? defaultStorage()
  if (!s) return {}
  try {
    const raw = s.getItem(TEMPLATE_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw) as unknown
    return obj && typeof obj === "object" ? (obj as Record<string, WizardTemplate>) : {}
  } catch {
    return {}
  }
}

export function findWizardTemplate(headers: string[], store?: StorageLike): WizardTemplate | null {
  const all = loadWizardTemplates(store)
  return all[templateFingerprint(headers)] ?? null
}

export function saveWizardTemplate(t: WizardTemplate, store?: StorageLike): void {
  const s = store ?? defaultStorage()
  if (!s) return
  try {
    const all = loadWizardTemplates(s)
    all[templateFingerprint(t.headers)] = t
    // 模板不会很多，但防失控：只留最近 50 条
    const entries = Object.entries(all).sort((a, b) => String(b[1].savedAt).localeCompare(String(a[1].savedAt)))
    const trimmed = Object.fromEntries(entries.slice(0, 50))
    s.setItem(TEMPLATE_KEY, JSON.stringify(trimmed))
  } catch {
    /* 存储失败不影响主流程 */
  }
}

// ---------------------------------------------------------------------------
// B4 落库层（2026-10-22）：docx 表格 → 项目级结构化数据
//
// 为什么单独一层：抽取（docxTableExtract）只负责字节→二维数组，这里负责
//   ① 合并策略：同名文件重传时**整体替换**该文件的表，不叠加旧表；
//   ② 体积上限：PB 的 json 列有 1MB 硬上限（历史事故：R56「The maximum allowed JSON size is 1048576 bytes」），
//      这里在写入前按字节截断，宁可少存表，也不能让整次上传 PATCH 失败；
//   ③ 归类：按表头判「这是采购清单还是技术参数表」，供后续把原表回填到解析分区。
// 纯函数、零 DOM、零网络，可在 node 下单测。
// ---------------------------------------------------------------------------

import { mapHeaderColumns } from "@/lib/docxTableExtract"

export type TenderTableRecord = {
  /** 来源文件名（同名重传时按它整体替换） */
  file: string
  /** 该文件内第几张表（从 0 起，与 DocxTable.index 一致） */
  index: number
  /** 原样二维数组（合并单元格已展开为空格位） */
  rows: string[][]
}

export type TenderTableKind = "purchase_list" | "tech_params" | "other"

/** PB json 列上限 1MB，留出与其余字段共存的余量 */
export const TENDER_TABLES_MAX_BYTES = 600_000

const rowsBytes = (rows: string[][]): number => JSON.stringify(rows ?? []).length

export function tenderTablesBytes(list: TenderTableRecord[] | null | undefined): number {
  return JSON.stringify(list ?? []).length
}

/** 同名文件重传：先移除该文件的旧表，再追加新表 */
export function mergeTenderTables(
  prev: TenderTableRecord[] | null | undefined,
  file: string,
  tables: { index: number; rows: string[][] }[],
): TenderTableRecord[] {
  const kept = (prev ?? []).filter((t) => t.file !== file)
  const added = (tables ?? []).filter((t) => (t.rows ?? []).length > 1).map((t) => ({ file, index: t.index, rows: t.rows }))
  return [...kept, ...added]
}

/** 按体积截断：保留整张表，直到再加一张就超限为止（至少保留第一张，且至少 2 行） */
export function capTenderTables(
  list: TenderTableRecord[] | null | undefined,
  maxBytes: number = TENDER_TABLES_MAX_BYTES,
): TenderTableRecord[] {
  const out: TenderTableRecord[] = []
  let used = 0
  for (const t of list ?? []) {
    const size = rowsBytes(t.rows)
    if (out.length === 0) {
      // 第一张哪怕超限也要留（否则用户看不到任何表），但超限时截到 200 行
      out.push(size > maxBytes ? { ...t, rows: t.rows.slice(0, 200) } : t)
      used += rowsBytes(out[0].rows)
      continue
    }
    if (used + size > maxBytes) break
    out.push(t)
    used += size
  }
  return out
}

/** 表头关键词（除结构化列名外的兜底判据） */
const HEADER_TEXT: Record<Exclude<TenderTableKind, "other">, RegExp> = {
  purchase_list: /(序号|名称|清单|货物|品目|数量)/,
  tech_params: /(技术参数|参数要求|技术要求|指标|性能要求|功能要求)/,
}

/**
 * 表格归类：先看列名（序号+名称+数量 → 清单），再看表头文字。
 * 返回 "other" 时调用方不要硬套，按普通表格展示即可。
 */
export function classifyTenderTable(rows: string[][]): TenderTableKind {
  const head = (rows ?? []).slice(0, 2).flat()
  const cols = mapHeaderColumns(rows?.[0] ?? [])
  if (cols && (cols.qty !== undefined || cols.unit !== undefined || cols.no !== undefined)) return "purchase_list"
  const text = head.join(" ")
  if (HEADER_TEXT.purchase_list.test(text) && (cols?.name !== undefined || /数量/.test(text))) return "purchase_list"
  if (HEADER_TEXT.tech_params.test(text)) return "tech_params"
  return "other"
}

/** 项目里所有已还原表格的归类统计（给上传区做提示） */
export function summarizeTenderTables(list: TenderTableRecord[] | null | undefined): {
  total: number
  purchaseList: number
  techParams: number
} {
  let purchaseList = 0
  let techParams = 0
  for (const t of list ?? []) {
    const k = classifyTenderTable(t.rows)
    if (k === "purchase_list") purchaseList += 1
    else if (k === "tech_params") techParams += 1
  }
  return { total: (list ?? []).length, purchaseList, techParams }
}

/**
 * 取某一类表格中最"有料"的一张（行数最多）——同名文件多次上传、或招标包里多份文件都有清单时，
 * 用行数最多的那张作为回填来源，避免拿到一张只有表头的残表。
 */
export function pickTableOfKind(
  list: TenderTableRecord[] | null | undefined,
  kind: TenderTableKind,
): TenderTableRecord | null {
  let best: TenderTableRecord | null = null
  for (const t of list ?? []) {
    if (classifyTenderTable(t.rows) !== kind) continue
    if (!best || (t.rows?.length ?? 0) > (best.rows?.length ?? 0)) best = t
  }
  return best
}

/**
 * 技术参数表 → 逐条参数（保留原表行序与表内编号）。
 * 列映射：有「序号」列取它作编号；有「技术参数/参数/技术要求」列取该格作原文；
 * 都没有时把该行非编号列用「；」连起来（宁可整行照录，也不拆散原表）。
 */
export function tableToParamItems(rows: string[][]): { no: string; text: string }[] {
  const body = rows ?? []
  if (body.length < 2) return []
  const header = (body[0] ?? []).map((c) => String(c ?? "").replace(/[\s|｜:：]+/g, ""))
  const cols = mapHeaderColumns(body[0] ?? [])
  // 别名表没覆盖到的写法（如「技术参数及要求」「功能」「指标」）在这里兜底，避免整行进 text
  const noIdx =
    cols?.no ?? header.findIndex((h) => /^(序号|编号|项号|序)$/.test(h))
  // 「技术参数/要求/规格」是明确参数列；只有「功能/指标」这种宽列名时整行照录，避免丢列
  const strictSpec = header.findIndex((h) => /参数|要求|规格/.test(h))
  const looseSpec = header.findIndex((h) => /指标|功能/.test(h))
  const specIdx = cols?.spec ?? (strictSpec >= 0 ? strictSpec : looseSpec)
  const joinAll = strictSpec < 0
  const out: { no: string; text: string }[] = []
  for (let i = 1; i < body.length; i++) {
    const row = body[i] ?? []
    const cells = row.map((c) => String(c ?? "").trim())
    if (!cells.some(Boolean)) continue
    // 没有序号列时，行首纯数字仍按表内编号取（原表常见「1 | 参数…」）
    const fallbackNo = noIdx < 0 && /^\d+(\.\d+)*$/.test(cells[0] ?? "") ? 0 : -1
    const useNoIdx = noIdx >= 0 ? noIdx : fallbackNo
    const no = useNoIdx >= 0 ? cells[useNoIdx] ?? "" : ""
    let text = !joinAll && specIdx >= 0 ? cells[specIdx] ?? "" : ""
    if (!text) text = cells.filter((c, ci) => c && ci !== useNoIdx).join("；")
    if (text.trim()) out.push({ no, text: text.trim() })
  }
  return out
}

/**
 * 2026-10-22（B4：采购清单按投标文件格式输出）
 * 采购清单导出表：原表优先（列与单元格一字不改），末尾追加一列「投标响应」填「完全响应」；
 * 没有原表时用解析行还原出来的表（buildPurchaseListRows 的产物）。
 */
export function purchaseListExportRows(
  restored: TenderTableRecord | null,
  parsed: { columns: string[]; rows: string[][] } | null,
): string[][] {
  if (restored && (restored.rows?.length ?? 0) >= 2) {
    const [head, ...body] = restored.rows
    return [[...head, "投标响应"], ...body.map((r) => [...r, "完全响应"])]
  }
  if (parsed && parsed.rows.length) {
    return [[...parsed.columns, "投标响应"], ...parsed.rows.map((r) => [...r, "完全响应"])]
  }
  return []
}

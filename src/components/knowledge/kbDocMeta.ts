// 知识库 · 文档元信息口径（纯函数，零 React / 零网络）。
//
// ## 为什么单独一个文件
//
// 原型 kb/browse.html 的文档卡要展示 6 类信号：格式徽标 / 被引用次数 / 可对客性 /
// 相对时间 / 抽取价值分 / 目录来源。这些口径散在组件里会出现两个问题：
//   ① 同一个「8 天前」在文档库屏写一遍、检索屏又写一遍，几天后必然漂移；
//   ② 「被引用 N 次」这种**必须由真数据支撑**的信号，最容易在赶工时被写成假数字。
// 本文件把所有口径收敛到一处，并把「真数据 vs 还没有数据」的判断显式化。
//
// ## 数据真相（2026-11-11 实测 pocketbase/pb_data/data.db）
//
// | 信号 | 来源 | 现状 |
// |---|---|---|
// | 团队 2,175 篇 / 我的笔记 4,825 条 | kb_docs.visibility | ✅ 有真值 |
// | 可对客 / 仅内部 | kb_docs.kb_audience | ✅ 5,591 / 1,414 |
// | 已抽 N 条原子 | kb_docs.atom_count | ⚠️ 列存在但全为 0（回填只在新建原子时跑） |
// | 被引用 N 次 | kb_atoms.usage_count 聚合 | ⚠️ 列存在但全为 0（使用反哺链路未接线） |
//
// 因此：引用类信号**一律不填演示值**。没有真值时不渲染徽标，
// 而不是渲染一个「被引用 0 次」去糊弄——那会让用户以为「引用过 0 篇」是结论。
//
// 消费方：DocListPanel（文档库屏的文档卡）、KbSearchScreen（全文检索屏的命中行）、
// KbBrowseScreen（左栏「按引用数排」）。

import type { KbDocRow } from "@/lib/kbCore"

/**
 * 文档行上真实存在、但 KbDocRow 类型没声明的列。
 *
 * 为什么不直接改 lib/kbCore.ts 的 KbDocRow：那是全站共享的数据层类型，
 * 改它会让「哪些字段是契约」的口径扩散到别的模块。这里以扩展类型的方式
 * 只在知识库内部承认这些列，读到的值仍是服务端 publicExport 原样吐出的。
 */
export type KbDocMeta = KbDocRow & {
  /** 该文档抽出的知识原子条数（pb 回填的冗余字段，当前库中尚未回填） */
  atom_count?: number
  /** 解析状态：parsed（已解析）/ raw（原始未解析）/ extracted（已抽原子） */
  ingest_status?: string
  /** 抽取完成时间 */
  extract_at?: string
  /** 原文件字节数 */
  file_bytes?: number
  /** 解析出的正文字符数 */
  parsed_chars?: number
  /** 正文是否被截断 */
  is_truncated?: boolean
  /** 原文件路径 / 来源类型 / 采集时间 */
  origin_path?: string
  source_type?: string
  captured_at?: string
}

/** 文件格式 → 徽标文案（doc_format 存的是小写扩展名） */
export const DOC_FORMAT_LABEL: Record<string, string> = {
  docx: "DOCX",
  doc: "DOC",
  pptx: "PPTX",
  ppt: "PPT",
  pdf: "PDF",
  md: "MD",
  markdown: "MD",
  txt: "TXT",
  xlsx: "XLSX",
  xls: "XLS",
  csv: "CSV",
  zip: "ZIP",
  json: "JSON",
  html: "HTML",
}

/** 格式徽标语义色：按「这文件要不要打开看」分档，而不是按扩展名随机上色 */
export type DocFormatTone = "primary" | "success" | "warning" | "danger" | "neutral"

/** 格式 → 语义色档（红=高风险格式 / 琥珀=需要转换 / 灰=纯文本） */
export function docFormatTone(fmt: string): DocFormatTone {
  const f = String(fmt ?? "").toLowerCase()
  if (f === "doc" || f === "xls" || f === "ppt") return "warning"
  if (f === "zip") return "danger"
  if (f === "pdf" || f === "docx" || f === "pptx" || f === "xlsx") return "primary"
  if (f === "md" || f === "txt" || f === "csv" || f === "json" || f === "html") return "success"
  return "neutral"
}

/** 格式徽标文案（未知格式回落到大写扩展名，空则「FILE」） */
export function docFormatLabel(fmt: string): string {
  const f = String(fmt ?? "").toLowerCase()
  return DOC_FORMAT_LABEL[f] ?? (f ? f.toUpperCase() : "FILE")
}

/** 可对客性 → 徽标文案（kb_audience 口径：client_facing / internal_only） */
export function audienceLabel(audience: string | undefined): string | null {
  const a = String(audience ?? "").trim()
  if (a === "client_facing") return "可对客"
  if (a === "internal_only") return "仅内部"
  return null
}

/**
 * 相对时间（原型用的是「8 天前 / 13 天前 / 1 个月前 / 2 个月前」）。
 * 未提供 now 时按当前时刻算；测试里传固定 now 保证可断言。
 */
export function relativeTimeOf(iso: string | undefined, now = Date.now()): string {
  const t = Date.parse(String(iso ?? ""))
  if (!Number.isFinite(t)) return ""
  const diff = now - t
  if (diff < 0) return "刚刚"
  const min = Math.floor(diff / 60_000)
  if (min < 1) return "刚刚"
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  const month = Math.floor(day / 30)
  if (month < 12) return `${month} 个月前`
  return `${Math.floor(month / 12)} 年前`
}

/** 文件大小文案 */
export function fileSizeLabel(bytes: number | undefined): string | null {
  const b = Number(bytes)
  if (!Number.isFinite(b) || b <= 0) return null
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 引用数分档（原型 kb/browse.html 左栏「按引用数排」三档口径）：
 *   ≥10 次 = 活知识（被反复验证过，优先复用）
 *   3-9 次 = 常用
 *   0 次   = 从未被引用
 */
export type CitationBucket = "hot" | "warm" | "cold"

export function citationBucketOf(count: number): CitationBucket {
  if (count >= 10) return "hot"
  if (count >= 3) return "warm"
  return "cold"
}

export type CitationBucketRow = {
  key: CitationBucket
  label: string
  count: number
  /** 占总数的百分比（0-100，整数） */
  pct: number
}

/**
 * 按引用数分档统计（用于左栏「按引用数排」）。
 * 只统计**确实有引用数据**的文档——全库都没有引用记录时，返回空数组，
 * 由界面显示「还没有引用数据」，而不是画三条 0 的柱子。
 */
export function citationBucketRows(citationByDoc: Record<string, number>): CitationBucketRow[] {
  const counts = Object.values(citationByDoc)
  if (counts.length === 0) return []
  const total = counts.length
  const buckets: Record<CitationBucket, number> = { hot: 0, warm: 0, cold: 0 }
  for (const c of counts) buckets[citationBucketOf(c)] += 1
  const mk = (key: CitationBucket, label: string): CitationBucketRow => ({
    key,
    label,
    count: buckets[key],
    pct: total > 0 ? Math.round((buckets[key] / total) * 100) : 0,
  })
  return [
    mk("hot", "被引用 ≥10 次"),
    mk("warm", "被引用 3-9 次"),
    mk("cold", "从未被引用"),
  ]
}

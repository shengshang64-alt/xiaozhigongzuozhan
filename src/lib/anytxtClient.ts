// ---------------------------------------------------------------------------
// AnyTXT 本机全文搜索客户端（2026-10-29）
//
// 能力定位：补上「搜本机硬盘里的历史资料」——知识库/素材库只能搜已入库内容，
// 而用户电脑里大量老标书、方案、资质扫描件从未入库，写标书时翻不到。
//
// 架构：浏览器 → 同源 /__sc（出口反代）→ sidecar → AnyTXT(9920) → 本地索引
// 为什么绕一层：AnyTXT 的 JSON-RPC 没有 CORS 头，浏览器直连会被拦；
//              且 sidecar 已统一做超时与降级，前端不必重复处理。
//
// 设计原则（与 sidecarClient 一致）：这是「增强」不是「依赖」——
// AnyTXT 没装/没开时，所有原有功能照常工作。
// ---------------------------------------------------------------------------

// R2（整仓重构 · 部署壳）：地址不再写死 127.0.0.1——同事机浏览器里的 127.0.0.1 是自己那台，
// 会表现为「本机搜索永远说后端未启动」。统一走 ./sidecarBase 的同源 /__sc 出口。
import { describeSidecarUnavailable, sidecarFetch } from "./sidecarBase"

/** 健康状态缓存：可用缓存 60s，不可用缓存 10s（便于用户装完/开启后快速恢复） */
let healthCache: { online: boolean; at: number; message?: string } | null = null
const OK_TTL = 60_000
const FAIL_TTL = 10_000

export type AnytxtHealth = { online: boolean; message?: string; target?: string; latencyMs?: number }

/** 探测 AnyTXT 是否可用（不抛错） */
export async function probeAnytxt(force = false): Promise<AnytxtHealth> {
  const now = Date.now()
  if (!force && healthCache) {
    const ttl = healthCache.online ? OK_TTL : FAIL_TTL
    if (now - healthCache.at < ttl) return { online: healthCache.online, message: healthCache.message }
  }
  try {
    const res = await sidecarFetch("/anytxt/health", undefined, { timeoutMs: 3000 })
    if (!res.ok) {
      healthCache = { online: false, at: now, message: describeSidecarUnavailable() }
      return { online: false, message: describeSidecarUnavailable() }
    }
    const j = (await res.json()) as AnytxtHealth
    healthCache = { online: Boolean(j.online), at: now, message: j.message }
    return j
  } catch {
    healthCache = { online: false, at: now, message: describeSidecarUnavailable() }
    return { online: false, message: describeSidecarUnavailable() }
  }
}

export type AnytxtFile = {
  /** AnyTXT 内部文件 id，取片段时用 */
  id: string
  /** 文件名（不含路径） */
  name: string
  /** 绝对路径——界面默认不展示完整路径，避免泄露本机目录结构 */
  path: string
}

/**
 * 默认过滤掉的噪音路径（2026-10-30）：
 * 实测搜索会命中大量 AI 工具的中间产物（call_*.txt、workspace 临时文件）、
 * node_modules、.git、构建产物等 —— 这些对售前找资料毫无价值，还会淹没真实结果。
 */
export const DEFAULT_EXCLUDE_PATTERNS: RegExp[] = [
  /\\node_modules\\/i,
  /\\\.git\\/i,
  /\\dist\\/i,
  /\\\.playwright-cli\\/i,
  /\\\.dsh\\/i,
  /\\AppData\\/i,
  /\\\.vite/i,
  /\\call_[A-Za-z0-9_-]+\.(txt|json|md)$/i,
  /\\temp\\/i,
  /\\.qoder\\/i,
  /\\WorkBuddy\\/i,
  /\\Doubao\\/i,
  /\\ChatGPT\\/i,
  /\\data\\uploads\\/i,
  /\\tool-results\\/i,
  /\\test_data\\/i,
  /\\trash\\/i,
  /\\downloads\\/i,
  /\\Downloads\\/,
  /\\exports\\/i,
  /\\tenders\\/i,
  /测试标书/i,
  /\\_backup\\/i,
  /\\backup_-?/i,
  /\\site-packages\\/i,
  /\\dist-packages\\/i,
  /\\__pycache__\\/i,
  /\\venv\\/i,
  /\\.venv\\/i,
  /\\\.cache\\/i,
  /\\dict\.txt$/i,
  /\\words\.txt$/i,
  /\\requirements\.txt$/i,
  /\\package-lock\.json$/i,
  /\\pnpm-lock\.yaml$/i,
  /\\Temp\\/,
]

/** 判断路径是否属于噪音（默认过滤） */
export function isNoisePath(path: string, extra?: RegExp[]): boolean {
  const p = String(path ?? "")
  const pats = extra ?? DEFAULT_EXCLUDE_PATTERNS
  return pats.some((re) => re.test(p))
}

export type AnytxtSearchResult =
  | { ok: true; pattern: string; count: number; files: AnytxtFile[] }
  | { ok: false; error: string; message: string }

/** 全文搜索本机文件 */
export async function searchAnytxt(opts: {
  pattern: string
  filterDir?: string
  filterExt?: string
  limit?: number
  offset?: number
  order?: number
}): Promise<AnytxtSearchResult> {
  const pattern = String(opts.pattern ?? "").trim()
  if (!pattern) return { ok: false, error: "pattern_required", message: "请输入搜索关键词" }
  try {
    const res = await sidecarFetch(
      "/anytxt/search",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pattern,
          filterDir: opts.filterDir ?? "",
          filterExt: opts.filterExt ?? "*",
          limit: opts.limit ?? 100,
          offset: opts.offset ?? 0,
          order: opts.order ?? 0,
        }),
      },
      { timeoutMs: 8000 },
    )
    const j = await res.json()
    if (!j?.ok) return { ok: false, error: j?.error ?? "unknown", message: j?.message ?? "搜索失败" }
    const raw: AnytxtFile[] = Array.isArray(j.files) ? j.files : []
    // 过滤噪音路径（临时文件/依赖目录/构建产物），但若过滤后为空则保留原结果
    const cleaned = raw.filter((f) => !isNoisePath(f.path))
    const files = cleaned.length ? cleaned : raw
    const dropped = raw.length - cleaned.length
    return {
      ok: true,
      pattern: j.pattern ?? pattern,
      count: cleaned.length ? Math.max(Number(j.count ?? 0) - dropped, files.length) : Number(j.count ?? 0),
      files,
    }
  } catch (e) {
    return { ok: false, error: "request_failed", message: `搜索请求失败：${e instanceof Error ? e.message : String(e)}` }
  }
}

export type AnytxtContextItem = AnytxtFile & { text: string }
export type AnytxtContextResult =
  | { ok: true; pattern: string; count: number; items: AnytxtContextItem[] }
  | { ok: false; error: string; message: string }

/** 组合查询：搜索 + 并发取前 N 个命中片段（前端最常用） */
export async function contextAnytxt(opts: {
  pattern: string
  filterDir?: string
  filterExt?: string
  limit?: number
  topN?: number
}): Promise<AnytxtContextResult> {
  const pattern = String(opts.pattern ?? "").trim()
  if (!pattern) return { ok: false, error: "pattern_required", message: "请输入搜索关键词" }
  try {
    const res = await sidecarFetch(
      "/anytxt/context",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pattern,
          filterDir: opts.filterDir ?? "",
          filterExt: opts.filterExt ?? "*",
          limit: opts.limit ?? 50,
          topN: opts.topN ?? 5,
        }),
      },
      { timeoutMs: 15000 },
    )
    const j = await res.json()
    if (!j?.ok) return { ok: false, error: j?.error ?? "unknown", message: j?.message ?? "查询失败" }
    return { ok: true, pattern: j.pattern ?? pattern, count: Number(j.count ?? 0), items: Array.isArray(j.items) ? j.items : [] }
  } catch (e) {
    return { ok: false, error: "request_failed", message: `查询失败：${e instanceof Error ? e.message : String(e)}` }
  }
}

/** 只取某个文件的命中片段 */
export async function fragmentAnytxt(fid: string, pattern: string): Promise<{ ok: boolean; text?: string; message?: string }> {
  try {
    const res = await sidecarFetch("/anytxt/fragment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fid, pattern }),
    })
    const j = await res.json()
    return j?.ok ? { ok: true, text: String(j.text ?? "") } : { ok: false, message: j?.message ?? "取片段失败" }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "取片段失败" }
  }
}

// ---------------------------------------------------------------------------
// 以下是 2026-10-29 逆向 ATGUI.exe 字符串表后发现、官方文档未公开的接口
// （详见 vibex-local/sidecar/modules/anytxt.js 顶部注释）
// ---------------------------------------------------------------------------

/**
 * 按 fid 取整篇正文（GetRawTextByFID）。
 * 用途：把本机历史标书/方案整篇读出来喂给 AI —— 章节复用、事实核对、对照表生成。
 */
export async function rawTextAnytxt(fid: string): Promise<{ ok: boolean; text?: string; message?: string }> {
  if (!fid) return { ok: false, message: "缺少文件 id" }
  try {
    const res = await sidecarFetch(
      "/anytxt/rawtext",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fid }),
      },
      { timeoutMs: 30000 },
    )
    const j = await res.json()
    return j?.ok ? { ok: true, text: String(j.text ?? "") } : { ok: false, message: j?.message ?? "取正文失败" }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "取正文失败" }
  }
}

/**
 * 触发索引同步/重建（SyncIndex）。
 * 注意：索引范围（哪些目录）仍需在 AnyTXT GUI「设置 → 索引管理」里配置，
 * 本接口只触发已配置范围的重新扫描，不能凭空指定新目录。
 */
export async function syncIndexAnytxt(): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await sidecarFetch(
      "/anytxt/syncindex",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      { timeoutMs: 130000 },
    )
    const j = await res.json()
    return j?.ok ? { ok: true } : { ok: false, message: j?.message ?? "索引同步失败" }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "索引同步失败" }
  }
}

/**
 * OCR 识别（仅增强版）：扫描版招标文件/图片里的文字提取。
 * 传 fid（已索引文件）或 path（绝对路径）二选一。
 */
export async function ocrAnytxt(opts: { fid?: string; path?: string }): Promise<{ ok: boolean; text?: string; message?: string }> {
  if (!opts.fid && !opts.path) return { ok: false, message: "需要 fid 或 path" }
  try {
    const res = await sidecarFetch(
      "/anytxt/ocr",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      },
      { timeoutMs: 70000 },
    )
    const j = await res.json()
    return j?.ok ? { ok: true, text: String(j.text ?? "") } : { ok: false, message: j?.message ?? "OCR 失败" }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "OCR 失败" }
  }
}

/** 界面展示用的短路径：只保留末两级目录，避免暴露完整本机路径 */
export function shortPath(fullPath: string): string {
  if (!fullPath) return ""
  const parts = fullPath.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return fullPath
  return "…" + parts.slice(-2).join("/")
}

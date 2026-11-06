// ---------------------------------------------------------------------------
// 后端服务（sidecar）客户端封装
//
// 2026-10-27 用户拍板：「把解析、导出、大文件处理从浏览器挪到后端」。
// 本文件是前端唯一的调用入口，负责三件事：
//   ① 探测后端是否可用（缓存结果，避免每次请求都探）
//   ② 不可用时**自动降级**回浏览器端路径（不阻断用户）
//   ③ 统一超时与错误处理
//
// 设计原则：后端是「增强」不是「依赖」。sidecar 没起时，所有原有功能照常工作。
//
// R2（整仓重构 · 部署壳）：地址解析上收到 ./sidecarBase 单一真源。
// 此前本文件把它写死成 `http://127.0.0.1:7001`——在**同事电脑**的浏览器里，
// 127.0.0.1 指的是同事自己那台机器，所以四条增强功能全部静默降级（用户只看到
// 「已完成」，不知道跑的是降级版）。现在默认走同源 `/__sc` 前缀（由出口反代到
// 服务端），只有页面确实在本机时才回落 127.0.0.1。
// ---------------------------------------------------------------------------

import { describeSidecarUnavailable, sidecarFetch } from "./sidecarBase"

/** 健康状态缓存：探到可用缓存 60 秒，探到不可用缓存 10 秒（短，便于服务起来后快速恢复） */
let healthCache: { ok: boolean; at: number } | null = null
const OK_TTL = 60_000
const FAIL_TTL = 10_000

/** 探测后端是否可用（不抛错，只返回布尔） */
export async function probeSidecar(force = false): Promise<boolean> {
  const now = Date.now()
  if (!force && healthCache) {
    const ttl = healthCache.ok ? OK_TTL : FAIL_TTL
    if (now - healthCache.at < ttl) return healthCache.ok
  }
  try {
    const res = await sidecarFetch("/health", undefined, { timeoutMs: 1500 })
    const ok = res.ok && (await res.json())?.ok === true
    healthCache = { ok, at: now }
    return ok
  } catch {
    healthCache = { ok: false, at: now }
    return false
  }
}

/**
 * 「增强服务为什么用不了」的人话解释（R2 验收要求：不可用不许静默降级）。
 * 界面在降级时把它显示出来，用户才知道自己跑的是浏览器本地版本。
 */
export function sidecarUnavailableReason(): string {
  return describeSidecarUnavailable()
}

/** 后端服务信息（调试/状态页用） */
export async function sidecarInfo(): Promise<{ ok: boolean; node?: string; routes?: string[]; uptimeSec?: number }> {
  try {
    const res = await sidecarFetch("/health", undefined, { timeoutMs: 3000 })
    if (!res.ok) return { ok: false }
    return await res.json()
  } catch {
    return { ok: false }
  }
}

/** 后端请求统一封装：超时 + 错误信息可读化 */
async function postRaw(path: string, body: unknown, timeoutMs: number): Promise<Response> {
  return sidecarFetch(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { timeoutMs },
  )
}

async function postJson<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const res = await postRaw(path, body, timeoutMs)
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const j = await res.json()
      detail = j?.message ?? j?.error ?? detail
    } catch {
      /* ignore */
    }
    throw new Error(`后端服务返回错误：${detail}`)
  }
  return (await res.json()) as T
}

// ---------------------------------------------------------------------------
// 导出：探测能力 / 真导出
// ---------------------------------------------------------------------------

export type ExportChapter = { title: string; content: string }

export type ExportProbe = {
  chapters: number
  paragraphs: number
  chars: number
  estimatedBytes: number
}

/** 预估导出规模（小时级正文也能毫秒返回） */
export async function probeExport(chapters: ExportChapter[]): Promise<ExportProbe | null> {
  if (!(await probeSidecar())) return null
  try {
    return await postJson<ExportProbe>("/export/probe", { chapters }, 15_000)
  } catch {
    return null
  }
}

/**
 * 后端生成 docx 并触发下载。
 *
 * @returns true = 后端成功并已下载；false = 后端不可用/失败，调用方应退回原浏览器路径
 *
 * ⚠️ 大文件超时给到 120 秒：45.8 万字实测 308ms，但极端情况（含大量图片）要留余量。
 */
export async function exportDocxViaBackend(
  projectName: string,
  chapters: ExportChapter[],
  fileName: string,
  title = "投标文件",
): Promise<boolean> {
  if (!(await probeSidecar())) return false
  try {
    const res = await postRaw("/export/docx", { projectName, title, chapters, fileName }, 120_000)
    if (!res.ok) return false
    const blob = await res.blob()
    if (!blob.size) return false
    // 用 blob 触发下载（与原有 triggerBlobDownload 同口径）
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    // 延迟释放，避免某些浏览器下载未开始就失效
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return true
  } catch {
    return false
  }
}

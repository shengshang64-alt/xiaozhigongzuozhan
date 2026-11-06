// ---------------------------------------------------------------------------
// PPT 渲染质检 · 前端客户端（2026-10-30 补齐 5）
//
// 需求：「导出后将 PPTX 渲染为页面图片，检查实际效果；只检查 JSON 字数不算完成验收。」
//
// 为什么必须走后端：浏览器没有 PPTX 布局引擎（pptxgenjs 只能写不能渲染），
// 只有 LibreOffice 这类完整引擎才能把 pptx 真实排版出来。
//
// 设计：
//   · 调用前先探测 /health/render，不可用时**明确告知用户**，不假装通过
//   · 失败一律返回结构化原因（不吞错），由界面决定提示方式
//   · 只在用户主动点「渲染质检」时调用（一次渲染几十秒，不放进导出主链路）
// ---------------------------------------------------------------------------

import type { RenderIssue, RenderReport } from "./deckRenderCheck"

// R2（整仓重构 · 部署壳）：地址上收到 lib/sidecarBase 单一真源（同源 /__sc 优先，本机才回落 127.0.0.1）。
import { describeSidecarUnavailable, sidecarFetch } from "@/lib/sidecarBase"

export type RenderCapability = {
  ok: boolean
  soffice: string | null
  python: boolean
  pymupdf: boolean
  hint: string
}

/** 探测后端渲染能力（前端据此决定是否显示「渲染质检」入口） */
export async function probeRenderCapability(): Promise<RenderCapability> {
  try {
    const res = await sidecarFetch("/health/render", { method: "GET" }, { timeoutMs: 10_000 })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as RenderCapability
    return {
      ok: Boolean(data.ok),
      soffice: data.soffice ?? null,
      python: Boolean(data.python),
      pymupdf: Boolean(data.pymupdf),
      hint: String(data.hint ?? ""),
    }
  } catch (e) {
    return {
      ok: false,
      soffice: null,
      python: false,
      pymupdf: false,
      hint: `${describeSidecarUnavailable(e instanceof Error ? e.message : String(e))} 渲染质检还需要 LibreOffice 支持。`,
    }
  }
}

export type RenderCheckApiResult =
  | {
      ok: true
      report: RenderReport
      /** 每页缩略图（dataURL，可展示"实际效果"） */
      thumbs: { page: number; dataUrl: string; inkRatio: number }[]
    }
  | { ok: false; reason: string; /** 是否属于"环境不支持"（区别于"文件有问题"） */ capabilityMissing: boolean }

/**
 * 对导出后的 PPTX 字节做真实渲染检查。
 *
 * @param bytes 导出的 pptx 字节（与用户下载的完全一致，保证"检查的就是交付物"）
 */
export async function renderCheckDeck(bytes: Uint8Array, opts?: { dpi?: number; maxPages?: number }): Promise<RenderCheckApiResult> {
  // base64 编码（文件可能几 MB，分块拼接避免栈溢出）
  let b64: string
  try {
    b64 = bytesToBase64(bytes)
  } catch (e) {
    return { ok: false, reason: `PPTX 编码失败：${e instanceof Error ? e.message : String(e)}`, capabilityMissing: false }
  }

  let res: Response
  try {
    res = await sidecarFetch(
      "/ppt/render-check",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pptxBase64: b64, dpi: opts?.dpi ?? 96, maxPages: opts?.maxPages ?? 60 }),
      },
      // 渲染质检一次几十秒，超时给足；同时不设 timeout 会让用户以为卡死
      { timeoutMs: 240_000 },
    )
  } catch (e) {
    return {
      ok: false,
      reason: describeSidecarUnavailable(e instanceof Error ? e.message : String(e)),
      capabilityMissing: true,
    }
  }

  if (!res.ok) {
    return { ok: false, reason: `渲染服务返回 HTTP ${res.status}`, capabilityMissing: false }
  }

  type ApiBody = {
    ok: boolean
    error?: string
    message?: string
    pageCount?: number
    issues?: RenderIssue[]
    errorCount?: number
    warnCount?: number
    pass?: boolean | null
    pages?: { page: number; thumb: string; inkRatio: number }[]
  }
  let data: ApiBody
  try {
    data = (await res.json()) as ApiBody
  } catch {
    return { ok: false, reason: "渲染服务返回内容无法解析", capabilityMissing: false }
  }

  if (!data.ok) {
    const msg = String(data.message ?? data.error ?? "渲染质检失败")
    // convert_failed / render_failed 里的"未找到 LibreOffice"属于环境问题
    const capabilityMissing = /LibreOffice|PyMuPDF|python|未找到/i.test(msg)
    return { ok: false, reason: msg, capabilityMissing }
  }

  const issues = data.issues ?? []
  return {
    ok: true,
    report: {
      pageCount: Number(data.pageCount ?? 0),
      issues,
      errorCount: Number(data.errorCount ?? issues.filter((i) => i.severity === "error").length),
      warnCount: Number(data.warnCount ?? issues.filter((i) => i.severity === "warn").length),
      pass: data.pass ?? issues.every((i) => i.severity !== "error"),
    },
    thumbs: (data.pages ?? []).map((p) => ({
      page: p.page,
      dataUrl: `data:image/png;base64,${p.thumb}`,
      inkRatio: p.inkRatio,
    })),
  }
}

/** Uint8Array → base64（分块，避免大文件爆栈） */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ""
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const sub = bytes.subarray(i, i + CHUNK)
    binary += String.fromCharCode.apply(null, sub as unknown as number[])
  }
  return btoa(binary)
}

// PocketBase JSON fetch helpers (R109 single source of truth).
// Author: loop-R109
// The "GET base+path with vibex auth headers" pattern was copy-pasted across
// useGlobalSearch / useActivityFeed (silent T|null) and useBidWorkspace /
// useCustomerManagement (throwing T) with two subtly different failure modes
// (null vs throw, and CustomerManagement additionally exposing err.httpStatus).
// Centralizing them keeps auth/header assembly consistent going forward while
// each caller keeps its exact failure contract via the two exported helpers.
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"

export type PbJsonRequestOptions = {
  /** Attach the numeric HTTP status onto the thrown Error (err.httpStatus). */
  exposeHttpStatus?: boolean
}

/**
 * R56（2026-10-15 1MB 保存失败事故驱动）：PB 错误响应 → 可读原因。
 * 此前 `!res.ok` 只保留 `HTTP <status>`，**服务端 message 被整条丢掉**——于是
 * 「bid_chapters: The maximum allowed JSON size is 1048576 bytes.」这种根因到了 UI 上
 * 只剩「保存失败，请检查网络后重试」，用户以为网络问题去刷新，白丢一整天。
 * 优先级：**字段级 message**（PB 校验错误几乎都落在 data.<field>.message，如超长/不合法）
 * ＞ 顶层 message ＞ 仅状态码。
 */
export function describePbError(status: number, body: unknown): string {
  const rec = (body ?? {}) as Record<string, unknown>
  const top = typeof rec.message === "string" ? rec.message.trim() : ""
  const data = rec.data
  const fieldMsgs: string[] = []
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const [field, v] of Object.entries(data as Record<string, unknown>)) {
      const m = v && typeof v === "object" ? (v as { message?: unknown }).message : undefined
      if (typeof m === "string" && m.trim()) fieldMsgs.push(`${field}: ${m.trim()}`)
    }
  }
  const detail = fieldMsgs.length ? fieldMsgs.join("；") : top
  return detail ? `HTTP ${status} · ${detail}` : `HTTP ${status}`
}

/**
 * R56：把任何抛出的错误压成一句给用户看的失败原因。
 * pbJsonRequest 已把服务端 message 保真进 Error.message；网络层错误（Failed to fetch 等）
 * 原样透出——这样用户能一眼区分「服务端拒绝了这次保存」和「本机断网」，
 * 而旧文案「请检查网络后重试」会把两者都说成网络问题，诱导刷新丢内容。
 */
export function saveFailureReason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? "")
  const t = (msg || "").trim()
  if (!t) return "未知原因"
  return t.length > 160 ? `${t.slice(0, 160)}…` : t
}

/**
 * JSON request against PocketBase with vibex auth headers.
 * Throws `HTTP <status>`（带服务端原因，见 describePbError）when the response is not ok.
 */
export async function pbJsonRequest<T>(
  path: string,
  init?: RequestInit,
  options: PbJsonRequestOptions = {},
): Promise<T> {
  const res = await fetch(`${getPocketBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...vibexAuthHeaders(),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    // 读出原因再抛：不读 body 就等于把根因丢了（读取失败/非 JSON 时退回纯状态码）
    const body = await res.json().catch(() => null)
    const err = new Error(describePbError(res.status, body)) as Error & { httpStatus?: number }
    if (options.exposeHttpStatus) err.httpStatus = res.status
    throw err
  }
  return (await res.json()) as T
}

/**
 * Silent JSON GET: returns null on a non-ok response or any network/parse error.
 */
export async function pbJsonGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${getPocketBaseUrl()}${path}`, {
      headers: { "Content-Type": "application/json", ...vibexAuthHeaders() },
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

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
 * JSON request against PocketBase with vibex auth headers.
 * Throws `HTTP <status>` when the response is not ok.
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
    const err = new Error(`HTTP ${res.status}`) as Error & { httpStatus?: number }
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

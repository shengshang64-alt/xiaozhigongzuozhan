// 团队登录（R-201 阶段A）——仅在本地自用域启用（见 rhLogin.isLocalDeployHost）。
// 账号本体是 PocketBase 原生 users auth collection：登录走
// POST /api/collections/users/auth-with-password，token 由 PB 签发并校验；
// 姓名/角色档案在 /api/team/*（pocketbase/pb_hooks/team_auth.pb.js）。
// 本文件不 import rhLogin（rhLogin 会反过来读这里的缓存，避免循环依赖）。
import { getPocketBaseUrl } from "@/lib/pb"
import { clearKbCache } from "@/lib/kbDocCache"
import { clearLlmCache } from "@/lib/llmCache"

export type TeamRole = "admin" | "editor" | "viewer"

export type TeamProfile = {
  id: string
  email: string
  name: string
  role: TeamRole
  active: boolean
}

const TOKEN_KEY = "xiaozhi-team-token"
const PROFILE_KEY = "xiaozhi-team-profile"

export function getTeamToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || ""
  } catch {
    return ""
  }
}

export function getCachedTeamProfile(): TeamProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as TeamProfile
    return p && p.id && p.role ? p : null
  } catch {
    return null
  }
}

function storeSession(token: string, profile: TeamProfile): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  } catch {
    // ignore
  }
}

export function clearTeamSession(): void {
  // 先取当前登录用户 id：removeItem 之后就再也读不到了，缓存按用户分库必须拿 id 定位。
  const uid = getCachedTeamProfile()?.id ?? null
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(PROFILE_KEY)
    // 通知门禁退回登录页（logoutRhAccount / 401 失效都会走到这里）
    window.dispatchEvent(new Event("xiaozhi-team-logout"))
  } catch {
    // ignore
  }
  // R119 隐私收口：知识库文档快照（kb-doc-cache:<uid>，含病历/方案原文片段）与 LLM
  // 应答缓存（llm-resp-cache:<uid>）都按登录用户分库存于 IndexedDB。退出/切换账号必须
  // 一并失效，否则上一位用户的 PHI 会滞留本机磁盘、被同机下一位用户命中。清理本身是
  // fire-and-forget：缓存只是加速层，失败绝不阻断登出（内部已 try/catch，不会 reject）。
  if (uid) {
    void clearKbCache(uid)
    void clearLlmCache(uid)
  }
}

async function teamFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${getPocketBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(getTeamToken() ? { Authorization: `Bearer ${getTeamToken()}` } : {}),
      ...(init?.headers || {}),
    },
  })
}

export type TeamStatus = { needsSetup: boolean; userCount: number }

export async function fetchTeamStatus(): Promise<TeamStatus> {
  const res = await teamFetch("/api/team/status")
  if (!res.ok) throw new Error(`status ${res.status}`)
  const data = (await res.json()) as TeamStatus
  return { needsSetup: !!data.needsSetup, userCount: Number(data.userCount) || 0 }
}

async function fetchMe(): Promise<TeamProfile | null> {
  const res = await teamFetch("/api/team/me")
  if (!res.ok) return null
  const p = (await res.json()) as TeamProfile
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
  } catch {
    // ignore
  }
  return p
}

/** 用已有 token 换档案；失效自动清会话。登录门禁在每次刷新时调用。 */
export async function refreshTeamProfile(): Promise<TeamProfile | null> {
  if (!getTeamToken()) return null
  const p = await fetchMe()
  if (!p) clearTeamSession()
  return p
}

export type LoginResult = { ok: true; profile: TeamProfile } | { ok: false; message: string }

export async function teamLogin(email: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${getPocketBaseUrl()}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email.trim().toLowerCase(), password }),
  })
  if (!res.ok) {
    if (res.status === 400) return { ok: false, message: "账号或密码错误" }
    if (res.status === 429) return { ok: false, message: "尝试次数过多，请稍后再试" }
    return { ok: false, message: `登录失败（${res.status}）` }
  }
  const data = (await res.json()) as { token?: string }
  if (!data.token) return { ok: false, message: "服务端未返回登录凭证" }
  try {
    localStorage.setItem(TOKEN_KEY, data.token)
  } catch {
    // ignore
  }
  const profile = await fetchMe()
  if (!profile) {
    clearTeamSession()
    return { ok: false, message: "账号信息获取失败，请联系管理员" }
  }
  if (!profile.active) {
    clearTeamSession()
    return { ok: false, message: "该账号已被停用，请联系管理员" }
  }
  storeSession(data.token, profile)
  return { ok: true, profile }
}

/** 首个管理员自助初始化（仅 users 集合为空时服务端允许）。成功后直接登录。 */
export async function teamSetup(name: string, email: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${getPocketBaseUrl()}/api/team/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim(), email: email.trim().toLowerCase(), password }),
  })
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
  if (!res.ok) return { ok: false, message: data.message || `初始化失败（${res.status}）` }
  return teamLogin(email, password)
}

export function teamLogout(): void {
  clearTeamSession()
}

// ---------------------------------------------------------------------------
// 成员管理（admin 专属，服务端强制校验角色）
// ---------------------------------------------------------------------------

export type TeamMember = {
  id: string
  user_id: string
  name: string
  role: TeamRole
  active: boolean
}

export type TeamApiResult = { ok: boolean; data?: unknown; message?: string }

async function unwrap(res: Response, failMsg: string): Promise<TeamApiResult> {
  const data = (await res.json().catch(() => ({}))) as { message?: string }
  if (!res.ok) return { ok: false, message: (data as { message?: string }).message || `${failMsg}（${res.status}）` }
  return { ok: true, data }
}

export async function fetchTeamMembers(): Promise<{ ok: true; items: TeamMember[] } | { ok: false; message: string }> {
  const r = await unwrap(await teamFetch("/api/team/members"), "获取成员列表失败")
  if (!r.ok) return { ok: false, message: r.message || "获取成员列表失败" }
  return { ok: true, items: ((r.data as { items?: TeamMember[] }).items || []) }
}

export async function teamAddMember(input: {
  name: string
  email: string
  password: string
  role: TeamRole
}): Promise<TeamApiResult> {
  return unwrap(
    await teamFetch("/api/team/members", {
      method: "POST",
      body: JSON.stringify({ ...input, email: input.email.trim().toLowerCase() }),
    }),
    "创建成员失败",
  )
}

export async function teamUpdateMember(
  id: string,
  patch: { name?: string; role?: TeamRole; active?: boolean },
): Promise<TeamApiResult> {
  return unwrap(await teamFetch(`/api/team/members/${id}`, { method: "PATCH", body: JSON.stringify(patch) }), "更新成员失败")
}

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  admin: "管理员",
  editor: "编辑",
  viewer: "只读",
}

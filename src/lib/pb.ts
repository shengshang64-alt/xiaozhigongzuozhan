import PocketBase, { LocalAuthStore } from "pocketbase"

import { getAuthHeaders } from "./auth"

// VibeX 把每个 app 部署在子路径下 (/app-preview/app-<32hex>/ 或 /p/app-<32hex>/)。
// 这个正则提取该前缀; 本地直跑 dev (无前缀)时返回 null。
function matchVibexPrefix(): string | null {
  if (typeof window === "undefined") return null
  const m = window.location.pathname.match(/^\/(?:app-preview|p)\/app-[0-9a-f]{32}(?=\/|$)/)
  return m ? m[0] : null
}

// 从部署前缀里取出 appId (app-<32hex>); 本地直跑 dev (无前缀)时返回 null。
function matchVibexAppId(): string | null {
  const prefix = matchVibexPrefix()
  const m = prefix?.match(/app-[0-9a-f]{32}/)
  return m ? m[0] : null
}

// 浏览器侧用 VibeX 路径推 __pb 代理前缀; 本地直跑 dev (无 app-preview 前缀)时 fallback 到 /__pb
export function getPocketBaseUrl(): string {
  const prefix = matchVibexPrefix()
  return prefix ? `${prefix}/__pb` : "/__pb"
}

// React Router 的 basename: 子路径部署时返回 app 前缀, 本地 dev 返回 "/"。
// <BrowserRouter basename={getBasename()}> 之后, 站内 <Link to="/x"> / navigate("/x")
// 会自动拼上前缀, 不会再掉到域名根 (即 vibex.runninghub.cn/x 这种错误跳转)。
export function getBasename(): string {
  return matchVibexPrefix() ?? "/"
}

// 登录态(PocketBase authStore)按 app 隔离存 localStorage。预览域下多个 app
// 同源不同路径 —— 若都用 SDK 默认键 "pocketbase_auth" 会互相读到对方的会话
// (表现为"新建的自建登录应用一打开就已登录, 且用户名是另一个应用注册的")。
// 键带上 appId 后各 app 各存各的, 互不串号; 本地 dev(无 appId)退回单一键。
const AUTH_STORE_KEY = `pb_auth_${matchVibexAppId() ?? "local"}`

export const pb = new PocketBase(getPocketBaseUrl(), new LocalAuthStore(AUTH_STORE_KEY))

// 线上网关(VcAuthFilter)会把请求头里的 Authorization 一律当 RH 令牌校验——app
// 自己的 PocketBase token 走 Authorization 会被误判成非法 RH 令牌, 整个请求被
// 网关 401 (TOKEN_INVALID) 拒掉, 根本到不了后端。因此凡是经 control 代理的部署
// 形态 (app-preview / 发布 / 沙箱域), PB token 一律改走 X-Pb-Auth 自定义头,
// 由 control 在转发给 PocketBase 之前还原成 Authorization, 对 PB 侧无感。
// 本地直连 PB (localhost / 裸 IP, 中间没有 control) 时保持 Authorization 原样。
export const PB_USER_AUTH_HEADER = "X-Pb-Auth"

export function isDirectPbHost(): boolean {
  if (typeof window === "undefined") return false
  const host = window.location.hostname
  return host === "localhost" || host === "[::1]" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
}

// 裸 fetch (aigc.ts / llm.ts 等) 统一用这个拿 PB 登录头; 未登录返回空对象。
export function pbAuthHeader(token?: string | null): Record<string, string> {
  if (!token) return {}
  return isDirectPbHost() ? { Authorization: token } : { [PB_USER_AUTH_HEADER]: token }
}

// B1 沙箱域(*.apps.vibex.cn)上访问者身份靠 X-Vibex-Scoped-Token 承载
// (老域 getAuthHeaders() 返回空对象, 零影响)。挂在 SDK 层, 让所有
// pb.collection(...) 请求自动携带, 业务代码不用感知。
// 同时把 SDK 自动附加的 PB Authorization 改名为 X-Pb-Auth (原因见上)。
pb.beforeSend = (url, options) => {
  const headers: Record<string, string> = { ...((options.headers as Record<string, string>) || {}) }
  const token = pb.authStore.token
  if (token && !isDirectPbHost() && headers["Authorization"] === token) {
    delete headers["Authorization"]
    headers[PB_USER_AUTH_HEADER] = token
  }
  options.headers = { ...headers, ...getAuthHeaders() }
  return { url, options }
}

pb.authStore.onChange(() => {
  // hook for UI updates; 业务代码按需订阅
}, true)

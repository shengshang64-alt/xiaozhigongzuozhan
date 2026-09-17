export type RhJwtPayload = {
  sub?: string
  user_name?: string
  username?: string
  nickName?: string
  mobile?: string
  exp?: number
}

export type RhAccountInfo = {
  userId: string
  displayName: string
  avatar?: string
  totalCoin?: string
  walletBalance?: string
}

// ---------------------------------------------------------------------------
// B1 沙箱域双契约 (*.apps.vibex.cn)
//
// 沙箱域上 nginx 边缘会剥掉所有 RunningHub cookie/凭证头, 浏览器也没有跨站
// cookie —— 所以老的"继承父域 Rh-Accesstoken"流程在沙箱域**天然不存在**。
// 登录改走 scoped token, 两级获取, 对齐老域"打开即登录"的体验:
//
// 1. 静默兑换(无感, 默认自动): 页面加载后 fetchRhAccountInfo() 发现无 token,
//    自动嵌一个隐藏 iframe 到控制台 /sandbox-sso?silent=1。用户此前在
//    vibex.cn 控制台登录过, 控制台 origin 里就有 RH 登录态 → 直接兑换出
//    scoped token postMessage 回来, 全程零点击 —— 等价于老域的父域 cookie。
// 2. popup 兜底(需点击): 静默失败(控制台侧也没登录态)时 UI 显示登录按钮,
//    redirectToRhLogin() 弹 popup 走完整 RH SSO。
// 3. opener 丢失 / 弹窗被拦: 控制台 /sandbox-sso 兑换成功后用 URL fragment
//    (#vibex-sandbox-token=...) 回跳本 origin；本文件启动时消费并入库。同
//    origin 其它标签页靠 storage 事件同步（覆盖 SSO 回跳切断 opener 的场景）。
//
// token 到手后存 localStorage, 所有 __pb / aigc / llm 请求带
// X-Vibex-Scoped-Token。对业务代码的契约保持不变: getRhAccessToken() 真值
// 仍表示"已登录", decodeRhToken()?.sub 仍是 RH userId, redirectToRhLogin()
// 仍弹登录, fetchRhAccountInfo()/logoutRhAccount() 语义不变。不要在页面
// 代码里自行区分沙箱域 —— 本文件已经处理。
// ---------------------------------------------------------------------------

const SANDBOX_APEX = "apps.vibex.cn"
// 沙箱 SSO 承载页所在的控制台 origin。
//
// 决策(2026-07 走正门): 用 https://console.vibex.cn —— 与沙箱域同属 vibex.cn
// 一个站，隐藏 iframe 不触发存储分区，静默零点击兑换生效。控制台侧没登录态时
// popup 会跳主站 sso-login，主站已支持跨站回跳(白名单 vibex.cn + #rh-sso-token
// 交接，2026-07-10 已发版)，主站已登录则免二次登录直接回跳完成兑换。
// 详见 aiskill/docs/vibex_b1_source_isolation_plan.md。
const SANDBOX_SSO_BASE = "https://console.vibex.cn"
const SANDBOX_TRUSTED_ORIGINS = [
  "https://console.vibex.cn",
  "https://vibex.cn",
  "https://www.vibex.cn",
  "https://vibex.runninghub.cn",
]
const SCOPED_TOKEN_KEY = "vibex-scoped-token"
const SCOPED_TOKEN_EXPIRES_KEY = "vibex-scoped-token-expires"
const SCOPED_USER_KEY = "vibex-scoped-user"
const SANDBOX_APP_ID_CACHE_KEY = "vibex-sandbox-app-id"
// 与 console SandboxSsoPage 导出的 handoff 键保持一致（勿单独改一侧）。
const SANDBOX_HANDOFF_TOKEN_KEY = "vibex-sandbox-token"
const SANDBOX_HANDOFF_EXPIRES_KEY = "vibex-sandbox-expires"
const SANDBOX_HANDOFF_APP_KEY = "vibex-sandbox-app"
const SANDBOX_HANDOFF_USER_KEY = "vibex-sandbox-user"
// 用户主动登出标记: 置位期间禁止静默兑换(否则退出后隐藏 iframe 立刻把用户
// "登回去", 表现为"无法退出登录")。用户下次显式点登录、或任一路径拿到新
// token 时清除。
const SANDBOX_LOGGED_OUT_KEY = "vibex-sandbox-logged-out"

function isSandboxLoggedOut(): boolean {
  try {
    return localStorage.getItem(SANDBOX_LOGGED_OUT_KEY) === "1"
  } catch {
    return false
  }
}

function setSandboxLoggedOut(value: boolean): void {
  try {
    if (value) localStorage.setItem(SANDBOX_LOGGED_OUT_KEY, "1")
    else localStorage.removeItem(SANDBOX_LOGGED_OUT_KEY)
  } catch {
    // ignore
  }
}

export function isSandboxHost(): boolean {
  if (typeof window === "undefined") return false
  const host = window.location.hostname.toLowerCase()
  return host === SANDBOX_APEX || host.endsWith(`.${SANDBOX_APEX}`)
}

// ---------------------------------------------------------------------------
// 本地部署模式 (localhost / 127.0.0.1)
//
// 本应用被导出后在用户机器上自用运行, RunningHub SSO 完全不可达 —— 静默兑换
// 的隐藏 iframe 与 popup 兜底都拿不到 token, 于是全站永久停在"未登录"态:
// 所有页面挂登录横幅, 且 5 个页面 hook 里 requireLogin() 会把新建/保存动作
// 全部拦下, 后端集合的 rh_user_id 字段又是 required, 业务完全无法使用。
//
// 处理: 在本地域上提供一个固定的本地身份, 让整条链路"看起来已登录" ——
//   decodeRhToken().sub 有值  → 各 hook 的 userId 有值 → requireLogin 放行
//   fetchRhAccountInfo() 非空 → 壳层进入已登录渲染分支, 登录横幅自动消失
//   rh_user_id 有值           → 后端 required 校验通过, 83 处字段无需改动
//
// 作用域被严格限制在本地域, 线上 (vibex.cn / runninghub.cn) 行为完全不变。
// ---------------------------------------------------------------------------
const LOCAL_DEPLOY_HOSTS = ["localhost", "127.0.0.1", "::1"]
const LOCAL_DEPLOY_USER_ID = "local-user"
const LOCAL_DEPLOY_DISPLAY_NAME = "本地用户"

/** 当前是否运行在本地自用域（localhost / 127.0.0.1 / ::1）。 */
export function isLocalDeployHost(): boolean {
  if (typeof window === "undefined") return false
  const host = window.location.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  return LOCAL_DEPLOY_HOSTS.includes(host)
}

/** 本地自用域上使用的固定账号信息。 */
function localDeployAccount(): RhAccountInfo {
  return {
    userId: LOCAL_DEPLOY_USER_ID,
    displayName: LOCAL_DEPLOY_DISPLAY_NAME,
  }
}

type ScopedUser = {
  userId: string
  displayName: string
  avatar?: string
  totalCoin?: string
  walletBalance?: string
  hasApiKey?: boolean
}

function readScopedUser(): ScopedUser | null {
  try {
    const raw = localStorage.getItem(SCOPED_USER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ScopedUser
    return parsed && parsed.userId ? parsed : null
  } catch {
    return null
  }
}

function clearScopedToken(): void {
  try {
    localStorage.removeItem(SCOPED_TOKEN_KEY)
    localStorage.removeItem(SCOPED_TOKEN_EXPIRES_KEY)
    localStorage.removeItem(SCOPED_USER_KEY)
  } catch {
    // ignore
  }
}

export function getScopedToken(): string {
  if (!isSandboxHost()) return ""
  try {
    const token = localStorage.getItem(SCOPED_TOKEN_KEY) ?? ""
    if (!token) return ""
    const expires = Number(localStorage.getItem(SCOPED_TOKEN_EXPIRES_KEY) || 0)
    if (expires && Date.now() > expires) {
      clearScopedToken()
      return ""
    }
    return token
  } catch {
    return ""
  }
}

// aigc.ts / llm.ts / pb.ts 统一调这个拿沙箱身份头; 老域返回空对象, 零影响。
export function vibexAuthHeaders(): Record<string, string> {
  // 本地自用域: model_gateway / intel_center 两个 hook 的身份约定是"只认 vibex
  // 网关注入的 X-Rh-User-Id, 缺失一律 401"。本地不存在那层网关, 该头永远为空,
  // 于是模型配置页与情报中心会永久顶着一块登录横幅。这里补上固定身份头。
  if (isLocalDeployHost()) {
    return { "X-Rh-User-Id": LOCAL_DEPLOY_USER_ID }
  }
  const token = getScopedToken()
  return token ? { "X-Vibex-Scoped-Token": token } : {}
}

// 沙箱域 hostname 可能是 app-<32hex>(直接就是 app_id), 也可能是发布 slug;
// slug 形式需要问一次 control 的公开接口 /api/sandbox/app-info。
async function resolveSandboxAppId(): Promise<string> {
  const label = window.location.hostname.toLowerCase().split(".")[0]
  if (/^app-[0-9a-f]{32}$/.test(label)) return label
  try {
    const cached = sessionStorage.getItem(SANDBOX_APP_ID_CACHE_KEY)
    if (cached) return cached
  } catch {
    // ignore
  }
  try {
    const res = await fetch("/api/sandbox/app-info", { method: "GET" })
    if (!res.ok) return ""
    const data = (await res.json().catch(() => ({}))) as { appId?: string }
    const appId = data.appId || ""
    if (appId) {
      try {
        sessionStorage.setItem(SANDBOX_APP_ID_CACHE_KEY, appId)
      } catch {
        // ignore
      }
    }
    return appId
  } catch {
    return ""
  }
}

function storeScopedToken(data: {
  token: string
  expiresAt?: string
  user?: ScopedUser
  hasApiKey?: boolean
}): void {
  setSandboxLoggedOut(false)
  try {
    localStorage.setItem(SCOPED_TOKEN_KEY, data.token)
    if (data.expiresAt) {
      const expiresMs = Date.parse(data.expiresAt)
      if (Number.isFinite(expiresMs) && expiresMs > 0) {
        localStorage.setItem(SCOPED_TOKEN_EXPIRES_KEY, String(expiresMs))
      }
    }
    if (data.user?.userId) {
      const user: ScopedUser = {
        userId: String(data.user.userId),
        displayName: String(data.user.displayName || data.user.userId),
      }
      if (data.user.avatar) user.avatar = String(data.user.avatar)
      if (data.user.totalCoin != null) user.totalCoin = String(data.user.totalCoin)
      if (data.user.walletBalance != null) user.walletBalance = String(data.user.walletBalance)
      const hasApiKey = data.hasApiKey ?? data.user.hasApiKey
      if (typeof hasApiKey === "boolean") user.hasApiKey = hasApiKey
      localStorage.setItem(SCOPED_USER_KEY, JSON.stringify(user))
    }
  } catch {
    // ignore
  }
}

function expectedSandboxAppIdSync(): string {
  const label = window.location.hostname.toLowerCase().split(".")[0]
  if (/^app-[0-9a-f]{32}$/.test(label)) return label
  try {
    return sessionStorage.getItem(SANDBOX_APP_ID_CACHE_KEY) || ""
  } catch {
    return ""
  }
}

/**
 * 消费控制台 /sandbox-sso 在 opener 丢失时回跳带来的 fragment handoff。
 * 对齐 vibex.cn 的 #rh-sso-token：立刻入库并擦除地址栏，避免进历史记录。
 * 模块加载时自动调用；返回是否成功入库。
 */
export function consumeSandboxHandoffFragment(): boolean {
  if (!isSandboxHost()) return false
  try {
    const hash = window.location.hash
    if (!hash || !hash.includes(`${SANDBOX_HANDOFF_TOKEN_KEY}=`)) return false
    const params = new URLSearchParams(hash.replace(/^#/, ""))
    const token = (params.get(SANDBOX_HANDOFF_TOKEN_KEY) || "").trim()
    const expiresAt = (params.get(SANDBOX_HANDOFF_EXPIRES_KEY) || "").trim()
    const handoffApp = (params.get(SANDBOX_HANDOFF_APP_KEY) || "").trim()
    const userRaw = params.get(SANDBOX_HANDOFF_USER_KEY)
    params.delete(SANDBOX_HANDOFF_TOKEN_KEY)
    params.delete(SANDBOX_HANDOFF_EXPIRES_KEY)
    params.delete(SANDBOX_HANDOFF_APP_KEY)
    params.delete(SANDBOX_HANDOFF_USER_KEY)
    const rest = params.toString()
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search + (rest ? `#${rest}` : ""),
    )
    if (!token) return false
    const expected = expectedSandboxAppIdSync()
    if (handoffApp && expected && handoffApp !== expected) return false
    let user: ScopedUser | undefined
    if (userRaw) {
      try {
        const parsed = JSON.parse(userRaw) as ScopedUser
        if (parsed?.userId) user = parsed
      } catch {
        // ignore malformed user
      }
    }
    storeScopedToken({
      token,
      expiresAt: expiresAt || undefined,
      user,
      hasApiKey: user?.hasApiKey,
    })
    return true
  } catch {
    return false
  }
}

// 首屏前消费 fragment，避免 RhAccountMenu 先刷出未登录再跳一次。
try {
  if (typeof window !== "undefined") consumeSandboxHandoffFragment()
} catch {
  // ignore
}

function sandboxSsoUrl(appId: string, silent: boolean): string {
  const url = new URL("/sandbox-sso", SANDBOX_SSO_BASE)
  if (appId) url.searchParams.set("app_id", appId)
  url.searchParams.set("return_origin", window.location.origin)
  if (silent) url.searchParams.set("silent", "1")
  const inviteCode = getInviteCode()
  if (inviteCode) url.searchParams.set("inviteCode", inviteCode)
  return url.toString()
}

// 静默兑换: 隐藏 iframe 打开控制台 /sandbox-sso?silent=1。控制台 origin 有
// RH 登录态就直接兑换回传(零点击); 没有则收到 not_logged_in / 超时, 返回 false,
// 由 UI 降级为登录按钮。整个页面生命周期内并发调用共享一次尝试; 失败后 60s
// 内不重试(负缓存), 防止业务代码轮询 fetchRhAccountInfo 时反复起 iframe。
let silentAttempt: Promise<boolean> | null = null
let silentFailedAt = 0
const SILENT_RETRY_COOLDOWN_MS = 60_000
// 降级 token 在单次页面生命周期里只补兑一次，防止余额轮询形成无限重兑循环。
let retriedScopedTokenWithoutApiKey = false

export function ensureScopedTokenSilent(): Promise<boolean> {
  if (!isSandboxHost()) return Promise.resolve(false)
  const token = getScopedToken()
  const retryWithoutApiKey =
    Boolean(token) &&
    readScopedUser()?.hasApiKey === false &&
    !retriedScopedTokenWithoutApiKey
  if (token && !retryWithoutApiKey) return Promise.resolve(true)
  if (retryWithoutApiKey) retriedScopedTokenWithoutApiKey = true
  // 用户主动登出后不再静默兑换, 否则"退出登录"会被隐藏 iframe 秒级撤销。
  if (isSandboxLoggedOut()) return Promise.resolve(false)
  if (silentAttempt && !retryWithoutApiKey) return silentAttempt
  if (
    !retryWithoutApiKey &&
    silentFailedAt &&
    Date.now() - silentFailedAt < SILENT_RETRY_COOLDOWN_MS
  ) {
    return Promise.resolve(false)
  }
  silentAttempt = (async () => {
    const appId = await resolveSandboxAppId()
    if (!appId) return false
    return await new Promise<boolean>((resolve) => {
      const iframe = document.createElement("iframe")
      iframe.style.display = "none"
      iframe.setAttribute("aria-hidden", "true")
      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        window.removeEventListener("message", onMessage)
        window.clearTimeout(timer)
        iframe.remove()
        resolve(ok)
      }
      const onMessage = (event: MessageEvent) => {
        if (!SANDBOX_TRUSTED_ORIGINS.includes(event.origin.toLowerCase())) return
        const data = event.data as {
          type?: string
          token?: string
          expiresAt?: string
          user?: ScopedUser
          hasApiKey?: boolean
          reason?: string
        } | null
        if (!data) return
        if (data.type === "vibex-sandbox-token" && data.token) {
          storeScopedToken({
            token: data.token,
            expiresAt: data.expiresAt,
            user: data.user,
            hasApiKey: data.hasApiKey,
          })
          finish(true)
        } else if (data.type === "vibex-sandbox-token-error") {
          finish(false)
        }
      }
      // 控制台不可达/被 CSP 拦时兜底超时, 不能让页面一直等。
      const timer = window.setTimeout(() => finish(false), 8000)
      window.addEventListener("message", onMessage)
      iframe.src = sandboxSsoUrl(appId, true)
      document.body.appendChild(iframe)
    })
  })().then((ok) => {
    silentFailedAt = ok ? 0 : Date.now()
    return ok
  }).finally(() => {
    // 冷却期后允许重试(例如用户随后在另一个标签页登录了控制台)。
    window.setTimeout(() => {
      silentAttempt = null
    }, 0)
  })
  return silentAttempt
}

async function sandboxLogin(): Promise<void> {
  // 显式点击登录 = 撤销"已登出"状态, 恢复静默兑换资格。
  setSandboxLoggedOut(false)
  const appId = await resolveSandboxAppId()
  const url = new URL(sandboxSsoUrl(appId, false))

  const loginWindow = window.open(url.toString(), "vibex-sandbox-sso", "width=520,height=720")
  if (!loginWindow) {
    // popup 被拦: 顶层跳控制台兑换；完成后 /sandbox-sso 用 fragment 回跳本 origin。
    window.location.href = url.toString()
    return
  }
  loginWindow.focus()
  let settled = false
  const finish = (fromPopup: boolean) => {
    if (settled) return
    settled = true
    window.removeEventListener("message", onMessage)
    window.removeEventListener("storage", onStorage)
    window.clearInterval(timer)
    if (fromPopup) {
      try {
        loginWindow.close()
      } catch {
        // ignore
      }
    }
    window.location.reload()
  }
  const onMessage = (event: MessageEvent) => {
    if (!SANDBOX_TRUSTED_ORIGINS.includes(event.origin.toLowerCase())) return
    const data = event.data as {
      type?: string
      token?: string
      expiresAt?: string
      user?: ScopedUser
      hasApiKey?: boolean
    } | null
    if (!data || data.type !== "vibex-sandbox-token" || !data.token) return
    storeScopedToken({
      token: data.token,
      expiresAt: data.expiresAt,
      user: data.user,
      hasApiKey: data.hasApiKey,
    })
    finish(true)
  }
  // opener 被 SSO 切断时，兑换页会 fragment 回跳另一标签并写入 localStorage；
  // 本 tab 靠 storage 事件拿到 token。
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== localStorage) return
    if (event.key !== SCOPED_TOKEN_KEY || !event.newValue) return
    if (getScopedToken()) finish(false)
  }
  const timer = window.setInterval(() => {
    if (!loginWindow.closed) return
    window.clearInterval(timer)
    window.removeEventListener("message", onMessage)
    window.removeEventListener("storage", onStorage)
    if (getScopedToken()) window.location.reload()
  }, 800)
  window.addEventListener("message", onMessage)
  window.addEventListener("storage", onStorage)
}

export function getCookie(name: string): string {
  const prefix = `${name}=`
  return (
    document.cookie
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith(prefix))
      ?.slice(prefix.length) ?? ""
  )
}

function getParentDomain(): string {
  const host = window.location.hostname
  if (host === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return ""
  const parts = host.split(".")
  return parts.length >= 2 ? `.${parts.slice(-2).join(".")}` : ""
}

function setSharedCookie(name: string, value: string): void {
  const encoded = encodeURIComponent(value)
  const secure = window.location.protocol === "https:" ? ";Secure" : ""
  const domain = getParentDomain()
  document.cookie = `${name}=${encoded};Path=/;Max-Age=604800;SameSite=Lax${secure}`
  if (domain) {
    document.cookie = `${name}=${encoded};Path=/;Max-Age=604800;SameSite=Lax;Domain=${domain}${secure}`
  }
}

export function getRhAccessToken(): string {
  // 沙箱域没有 RH 主站令牌, "已登录"由 scoped token 表达; 返回它保证
  // `if (getRhAccessToken())` 之类的登录判断在两个域上语义一致。
  if (isSandboxHost()) return getScopedToken()
  const fromCookie = getCookie("Rh-Accesstoken")
  const fromStorage = localStorage.getItem("Rh-Accesstoken") ?? ""
  const token = decodeURIComponent(fromCookie || fromStorage)
  if (fromCookie && fromCookie !== fromStorage) localStorage.setItem("Rh-Accesstoken", token)
  if (!fromCookie && fromStorage) setSharedCookie("Rh-Accesstoken", token)
  return token
}

// 发布链接(/p/{app_id}/?inviteCode=xxx)携带发布者的 RH 邀请码。访问者首次进入时
// 落地的 inviteCode 存进 sessionStorage, 即使后续 SPA 跳转丢了 query 也能在登录/注册
// 时透传给 RH SSO, 让通过该链接注册的新用户归属到发布者名下。
const INVITE_STORAGE_KEY = "rh_invite_code"

export function getInviteCode(): string {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("inviteCode")
    if (fromUrl) {
      sessionStorage.setItem(INVITE_STORAGE_KEY, fromUrl)
      return fromUrl
    }
    return sessionStorage.getItem(INVITE_STORAGE_KEY) ?? ""
  } catch {
    return ""
  }
}

// 模块加载即落地一次邀请码, 防止 SPA 路由清掉 query 后再点登录就取不到了。
try {
  getInviteCode()
} catch {
  // ignore
}

export function getSsoLoginUrl(returnUrl = window.location.href): string {
  const loginUrl = new URL("https://www.runninghub.cn/sso-login")
  loginUrl.searchParams.set("returnUrl", returnUrl)
  const inviteCode = getInviteCode()
  if (inviteCode) loginUrl.searchParams.set("inviteCode", inviteCode)
  return loginUrl.toString()
}

function getPopupReturnUrl(): string {
  const url = new URL("/sso-popup-callback", window.location.origin)
  url.searchParams.set("from", window.location.href)
  return url.toString()
}

export function redirectToRhLogin(): void {
  if (isSandboxHost()) {
    void sandboxLogin()
    return
  }
  const url = getSsoLoginUrl(getPopupReturnUrl())
  const loginWindow = window.open(url, "runninghub-sso-login", "width=520,height=720")
  if (loginWindow) {
    loginWindow.focus()
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== "rh-sso-login-complete") return
      window.removeEventListener("message", onMessage)
      window.clearInterval(timer)
      try {
        loginWindow.close()
      } catch {
        // ignore
      }
      window.location.reload()
    }
    const timer = window.setInterval(() => {
      if (!loginWindow.closed) return
      window.clearInterval(timer)
      window.removeEventListener("message", onMessage)
      if (getRhAccessToken()) window.location.reload()
    }, 800)
    window.addEventListener("message", onMessage)
    return
  }

  try {
    if (window.top && window.top !== window) {
      window.top.location.href = getSsoLoginUrl()
      return
    }
  } catch {
    // Cross-origin frame access can throw; fall back to current window navigation.
  }
  window.location.href = url
}

export function decodeRhToken(): RhJwtPayload | null {
  // 本地自用域: 返回固定身份, 保证所有下游 hook 的 userId 非空。
  if (isLocalDeployHost()) {
    return { sub: LOCAL_DEPLOY_USER_ID, nickName: LOCAL_DEPLOY_DISPLAY_NAME }
  }
  // 沙箱域的 scoped token 是随机串不是 JWT; userId 来自兑换时缓存的用户信息,
  // 保持 decodeRhToken()?.sub 这个契约在两个域上都可用。
  if (isSandboxHost()) {
    const user = getScopedToken() ? readScopedUser() : null
    return user ? { sub: user.userId, nickName: user.displayName } : null
  }
  const token = getRhAccessToken()
  if (!token) return null
  const parts = token.replace(/^Bearer\s+/i, "").split(".")
  if (parts.length < 2) return null
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=")
    const decoded = atob(padded)
    const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

function authHeaders(): HeadersInit {
  const token = getRhAccessToken()
  return {
    "content-type": "application/json",
    ...(token ? { Authorization: `Bearer ${token.replace(/^Bearer\s+/i, "")}` } : {}),
  }
}

export async function fetchRhAccountInfo(): Promise<RhAccountInfo | null> {
  // 本地自用域: 直接返回固定身份, 跳过全部 SSO 兑换网络流程。
  if (isLocalDeployHost()) {
    return localDeployAccount()
  }
  // 沙箱域: /uc/* 不存在, 访问者信息来自 control 的 /api/sandbox/me
  // (会校验 scoped token 与当前 app 的绑定, 过期/吊销返回 401)。
  // 无 token 时先尝试一次静默兑换(隐藏 iframe, 零点击) —— 用户在 vibex.cn
  // 控制台登录过就能直接进入已登录态, 对齐老域"打开即登录"的体验。
  if (isSandboxHost()) {
    let token = getScopedToken()
    if (!token) {
      await ensureScopedTokenSilent().catch(() => false)
      token = getScopedToken()
    }
    if (
      token &&
      readScopedUser()?.hasApiKey === false &&
      !retriedScopedTokenWithoutApiKey
    ) {
      await ensureScopedTokenSilent().catch(() => false)
      token = getScopedToken()
    }
    if (!token) return null
    try {
      const res = await fetch("/api/sandbox/me", {
        method: "GET",
        headers: { "X-Vibex-Scoped-Token": token },
      })
      if (res.status === 401) {
        clearScopedToken()
        return null
      }
      const scopedToAccount = (user: ScopedUser): RhAccountInfo => ({
        userId: user.userId,
        displayName: user.displayName,
        avatar: user.avatar,
        totalCoin: user.totalCoin,
        walletBalance: user.walletBalance,
      })
      if (!res.ok) {
        // control 抖动时退回本地缓存, 不把已登录用户闪成未登录。
        const cachedUser = readScopedUser()
        return cachedUser ? scopedToAccount(cachedUser) : null
      }
      const data = (await res.json().catch(() => null)) as {
        userId?: string
        displayName?: string
        avatar?: string
        totalCoin?: string | number
        walletBalance?: string | number
      } | null
      if (!data?.userId) return null
      const user: ScopedUser = {
        userId: data.userId,
        displayName: data.displayName || `User ${data.userId}`,
      }
      if (data.avatar) user.avatar = String(data.avatar)
      if (data.totalCoin != null) user.totalCoin = String(data.totalCoin)
      if (data.walletBalance != null) user.walletBalance = String(data.walletBalance)
      storeScopedToken({ token, user, hasApiKey: readScopedUser()?.hasApiKey })
      return scopedToAccount(user)
    } catch {
      const cachedUser = readScopedUser()
      return cachedUser
        ? {
            userId: cachedUser.userId,
            displayName: cachedUser.displayName,
            avatar: cachedUser.avatar,
            totalCoin: cachedUser.totalCoin,
            walletBalance: cachedUser.walletBalance,
          }
        : null
    }
  }

  const payload = decodeRhToken()
  const userId = payload?.sub
  if (!getRhAccessToken() || !userId) return null

  const res = await fetch("/uc/getUserInfo", {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: JSON.stringify({ userId }),
  })
  const body = await res.json().catch(() => null)
  const data = body?.data ?? body
  if (!res.ok || !data) return null

  return {
    userId: data.id || userId,
    displayName:
      data.nickName ||
      data.mobile ||
      data.email ||
      payload.nickName ||
      payload.user_name ||
      payload.username ||
      `User ${userId}`,
    avatar: data.headIcon,
    totalCoin: data.totalCoin == null ? undefined : String(data.totalCoin),
    walletBalance: data.walletInfo?.balance == null ? undefined : String(data.walletInfo.balance),
  }
}

export async function logoutRhAccount(): Promise<void> {
  // 沙箱域: 吊销 scoped token + 清本地缓存, 并置"已登出"标记阻断静默兑换
  // (否则页面刷新后隐藏 iframe 会立刻重新签发 token, 用户永远退不出去)。
  // 不动 RH 主站登录态。
  if (isSandboxHost()) {
    setSandboxLoggedOut(true)
    const token = getScopedToken()
    if (token) {
      await fetch("/api/sandbox-token/revoke", {
        method: "POST",
        headers: { "X-Vibex-Scoped-Token": token },
      }).catch(() => undefined)
    }
    clearScopedToken()
    return
  }

  await fetch("/uc/logout", {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: "{}",
  }).catch(() => undefined)

  for (const key of ["Rh-Accesstoken", "Rh-Refreshtoken", "Rh-Identify"]) {
    localStorage.removeItem(key)
    document.cookie = `${key}=;Path=/;max-age=0`
    document.cookie = `${key}=;Path=/;Domain=.runninghub.cn;max-age=0`
  }
  localStorage.removeItem("userInfo")
}

// RunningHub 主站账号菜单的固定入口。这些页面是 RH 主站真实页面, 都带
// X-Frame-Options, 不能 iframe 内嵌到生成 app 里, 一律用 popup 承载真实流程。
// 这是账号菜单默认四个入口链接的唯一合法来源 —— 不要在业务代码里自造/拼接
// 其他 runninghub.cn 路径当作充值/会员/账单入口, 拼错会直接 404
// (真实事故: 曾经手写过一个不存在的 `/recharge` 路径)。
export const RH_MENU_LINKS = {
  console: { label: "控制台", url: "https://www.runninghub.cn/call-api/bill-task" },
  vip: { label: "开通会员", url: "https://www.runninghub.cn/vip-rights/2" },
  rechargeCash: { label: "余额充值", url: "https://www.runninghub.cn/vip-rights/4" },
  rechargeCoin: { label: "积分充值", url: "https://www.runninghub.cn/vip-rights/1" },
} as const

// 打开一个 RH 主站页面 popup。用于账号菜单里所有跳到 runninghub.cn 的入口
// (控制台/会员/充值等), 因为这些页面不能被 iframe 内嵌。popup 关闭后调用
// onClose(通常用来 fetchRhAccountInfo() 刷新余额, 让用户充值/开通会员回来
// 就能看到最新余额, 而不用手动刷新整个 app)。popup 被浏览器拦截时降级为
// _blank 新标签页(此时无法感知关闭, 不会触发 onClose)。
export function openRhWindow(url: string, onClose?: () => void): void {
  const popup = window.open(url, "_blank", "width=520,height=760")
  if (!popup) {
    window.open(url, "_blank", "noopener,noreferrer")
    return
  }
  popup.focus()
  if (!onClose) return
  const timer = window.setInterval(() => {
    if (!popup.closed) return
    window.clearInterval(timer)
    onClose()
  }, 800)
}

// 历史别名, 等价于 openRhWindow(RH_MENU_LINKS.rechargeCash.url, onClose)。
// 新代码直接用 openRhWindow + RH_MENU_LINKS, 保留这个只是兼容旧文案/旧调用点。
export function openRhRechargeWindow(onClose: () => void): void {
  openRhWindow(RH_MENU_LINKS.rechargeCash.url, onClose)
}

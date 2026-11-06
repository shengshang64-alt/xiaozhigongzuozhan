// ---------------------------------------------------------------------------
// 增强服务（sidecar）**地址解析的唯一真源**（R2 · 整仓重构 · 部署壳）
//
// 为什么要有这个文件——2026-11 之前，前端有 **4 个模块各自**把地址写死成
// `http://127.0.0.1:7001`：
//     lib/sidecarClient.ts      导出 / 大文件解析
//     lib/anytxtClient.ts       本机全文搜索
//     pages/PptQuote/aiImageProvider.ts   AI 插画
//     pages/PptQuote/deckRenderClient.ts  PPT 渲染质检
//
// 后果不是「报个错」而是**静默降级**：同事在自己电脑上打开
// `http://<上盛的机器IP>:8000`，浏览器里的 `127.0.0.1` 指的是**同事自己的电脑**，
// 那台机器上没有 sidecar → 四条增强功能全部悄悄退回浏览器路径，
// 界面只显示「已完成」，用户根本不知道跑的是降级版。
//
// 正确口径（D3「一个入口」）：
//   ① 页面从哪里来，增强服务就从哪里来 —— 同源 `/__sc` 前缀，由出口（Vite dev /
//      Vite preview / 将来的 Caddy）反代到服务端的 `127.0.0.1:7001`。
//      这样「同事机」和「本机」用的是**同一套相对路径**，谁也不用知道服务端 IP。
//   ② 显式覆盖优先：`VITE_SIDECAR_BASE`（部署到别的出口、或 sidecar 在另一台机）。
//   ③ `127.0.0.1:7001` 只在**页面本身就跑在本机**时才是合法候选——它是兜底，
//      不是默认值。这条是本文件要防的核心 bug。
//   ④ 真不可达时必须能说人话：区分「你没配出口」和「出口后面的服务没起」。
// ---------------------------------------------------------------------------

/** 服务端 sidecar 的默认端口（与 vibex-local/sidecar/server.mjs 的 `ZX_SIDECAR_PORT` 默认值同源）。 */
export const SIDECAR_DEFAULT_PORT = 7001

/** 同源反代前缀。出口侧（vite dev / preview / Caddy）把它剥掉再转发到服务端 :7001。 */
export const SIDECAR_PROXY_PREFIX = "/__sc"

/** 视为「本机」的主机名（IPv4/IPv6 回环 + localhost）。 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"])

/** 当前页面是否跑在本机（非浏览器环境 / 无法判定时按「本机」处理，保持旧行为）。 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  return LOOPBACK_HOSTS.has(String(host ?? "").trim().toLowerCase())
}

/**
 * 页面是否来自**另一台机器**（内网同事机的典型形态）。
 * 这是「写死 127.0.0.1」真正会咬人的场景：镜像里的 127.0.0.1 是访问者自己。
 */
export function isRemotePage(): boolean {
  if (typeof window === "undefined") return false
  const host = window.location?.hostname
  if (!host) return false
  return !isLoopbackHost(host)
}

/** 显式配置的基址（去尾斜杠）；未配置返回 null。 */
function envBase(): string | null {
  try {
    const raw = (import.meta.env?.VITE_SIDECAR_BASE as string | undefined) ?? ""
    const trimmed = raw.trim().replace(/\/+$/, "")
    return trimmed || null
  } catch {
    return null
  }
}

/**
 * 可尝试的基址**有序**列表（第一个是默认，后续是兜底）。
 *
 * - 配了 `VITE_SIDECAR_BASE` → **只用它**（部署方已明确指定，不再猜）。
 * - 否则：同源 `/__sc` 永远排第一（局域网、preview、Caddy 都适用）。
 * - 再否则：只有页面确实在本机时，才追加 `http://127.0.0.1:7001`。
 *   远程页面**绝不**追加——那正是「连到自己电脑」的陷阱。
 */
export function sidecarBaseCandidates(): string[] {
  const explicit = envBase()
  if (explicit) return [explicit]
  const list = [SIDECAR_PROXY_PREFIX]
  if (!isRemotePage()) list.push(`http://127.0.0.1:${SIDECAR_DEFAULT_PORT}`)
  return list
}

/** 已被证实可用的基址（同进程内复用；探到即用，避免每次请求都试错）。 */
let provenBase: string | null = null

/** 当前使用的基址：优先已证实的，否则候选里的第一个。 */
export function sidecarBase(): string {
  return provenBase ?? sidecarBaseCandidates()[0]
}

/** 记下可用基址（探测成功后调用）。 */
export function noteSidecarBase(base: string): void {
  provenBase = base.replace(/\/+$/, "")
}

/** 清空「已证实」记忆（测试用；也可用于用户手动重试）。 */
export function resetSidecarBase(): void {
  provenBase = null
}

/** 拼出完整 URL（`/__sc` + `/health` → `/__sc/health`；绝对基址直接拼）。 */
export function sidecarUrl(path: string, base: string = sidecarBase()): string {
  const p = path.startsWith("/") ? path : `/${path}`
  return `${base.replace(/\/+$/, "")}${p}`
}

/**
 * 「地址不对」这一类失败会换下一个候选重试；「服务真的报错」不重试。
 *
 * 为什么区分：`/ai-image/generate` 是**花钱**的接口，服务端已经收到并处理过，
 * 就不能因为 500 再打一遍。而 404 / 502 / 503 / 504 与网络拒绝都意味着
 * 「这个地址后面没有我们的服务」——请求没有落地，重试是安全的。
 */
const ADDRESS_MISS_STATUS = new Set([404, 502, 503, 504])

/**
 * 带候选梯子的 fetch：网络失败或「地址不对」时换下一个基址。
 *
 * @returns 第一个拿到的非「地址不对」响应；全部失败时抛出最后一个错误
 *          （错误信息里带候选清单，便于排查）。
 */
export async function sidecarFetch(
  path: string,
  init?: RequestInit,
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<Response> {
  const candidates = provenBase ? [provenBase, ...sidecarBaseCandidates().filter((c) => c !== provenBase)] : sidecarBaseCandidates()
  let lastError: unknown = null
  for (const base of candidates) {
    const ctrl = new AbortController()
    const timer = opts?.timeoutMs ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null
    // 外部取消也要能打断（渲染质检可能跑几十秒）
    const onAbort = () => ctrl.abort()
    opts?.signal?.addEventListener("abort", onAbort, { once: true })
    try {
      const res = await fetch(sidecarUrl(path, base), { ...init, signal: ctrl.signal })
      if (ADDRESS_MISS_STATUS.has(res.status)) {
        lastError = new Error(`增强服务在 ${base} 上不可用（HTTP ${res.status}）`)
        continue
      }
      noteSidecarBase(base)
      return res
    } catch (e) {
      lastError = e
    } finally {
      if (timer) clearTimeout(timer)
      opts?.signal?.removeEventListener("abort", onAbort)
    }
  }
  throw lastError instanceof Error ? lastError : new Error("增强服务不可达")
}

/**
 * 「增强功能为什么不能用」的人话解释（界面直接显示给用户）。
 *
 * R2 验收句点名：同事机打开增强功能**不能默默降级**，要么能用，要么说清原因。
 * 所以这里必须区分三种完全不同的情况，各给各的办法：
 */
export function describeSidecarUnavailable(detail?: string): string {
  // 原始报错（如 ECONNREFUSED / HTTP 404）附在句尾：用户报障时能直接截图，排查少一轮来回。
  const tail = detail && detail.trim() ? `（原始报错：${detail.trim()}）` : ""
  const explicit = envBase()
  if (explicit) {
    return `增强服务连不上（已配置地址 ${explicit}）。请确认该地址上的 sidecar 已启动；如需改地址，改 VITE_SIDECAR_BASE 后重新构建。${tail}`
  }
  if (isRemotePage()) {
    const host = typeof window !== "undefined" ? window.location.hostname : "该地址"
    return `当前页面来自 ${host}，增强服务需要经同一出口转发（/${SIDECAR_PROXY_PREFIX.slice(1)}）。请在服务端确认出口已配置 ${SIDECAR_PROXY_PREFIX} 反代，并确认 sidecar 已启动；配置好之前，导出/解析/生图会使用浏览器本地版本（功能可用但大文件受限）。${tail}`
  }
  return `增强服务未启动：本机 ${SIDECAR_DEFAULT_PORT} 端口没有响应，且出口前缀 /${SIDECAR_PROXY_PREFIX.slice(1)} 也不可用。请运行 start-local.cmd 拉起 sidecar；在此之前，相关功能使用浏览器本地版本。${tail}`
}

import { pb, getPocketBaseUrl, pbAuthHeader } from "./pb"
import { getAuthHeaders } from "./auth"
export async function fileToDataUrl(f: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(f)
  })
}

export interface AigcOutput {
  url: string
  type: "image" | "video" | "audio" | "3d" | "file"
}

export interface AigcSubmitResponse {
  ok: boolean
  taskId: string
  rhTaskId?: string
  status?: "running" | "queued" | "success" | "failed"
  model?: string
  error?: string
  errorCode?: string
  message?: string
}

// 兼容早期 scaffold 版 aigc.ts 的响应包络类型 (callAigc<AigcResponse<X>> 形式的存量页面代码)。
// 新代码不需要它: 标准模型直接用 AigcSubmitResponse / callAigc, AI 应用用 AiAppRunResponse。
export interface AigcResponse<T = unknown> {
  taskId: string
  task_id?: string
  rhTaskId?: string
  results: T[]
  outputs: AigcOutput[]
}

// 真实扣费明细, 来自 RH /openapi/v2/query 终态响应的 usage 字段 (只在 SUCCESS/FAILED 等终态出现)。
// thirdPartyConsumeMoney 通常是实付金额; consumeMoney/consumeCoins 常为 null。全部按字符串处理,
// 避免浮点精度问题 —— 展示时直接拼 "¥" + thirdPartyConsumeMoney, 不要 parseFloat 再格式化。
export interface AigcUsage {
  consumeMoney: string | null
  consumeCoins: string | null
  taskCostTime: string | null
  thirdPartyConsumeMoney: string | null
}

const LOGIN_REQUIRED_ZH = "请先登录 RunningHub 后再生成"

function authFailureHaystack(...parts: unknown[]): string {
  return parts
    .map((part) => {
      if (part == null) return ""
      if (typeof part === "string") return part
      try {
        return JSON.stringify(part)
      } catch {
        return String(part)
      }
    })
    .join(" ")
    .toLowerCase()
}

// 发布沙箱未登录 → control 401 {detail:{code:"SANDBOX_TOKEN_REQUIRED"}};
// RH key/登录态失效 → hook 412 rh_login_required。两者都要引导登录, 不能落成"网络繁忙"。
function isLoginRequiredSignal(status: number, ...parts: unknown[]): boolean {
  if (status === 412 || status === 401) return true
  const hay = authFailureHaystack(...parts)
  return (
    hay.includes("sandbox_token_required") ||
    hay.includes("sandbox_api_key_missing") ||
    hay.includes("rh_login_required") ||
    hay.includes("login_required") ||
    hay.includes("登录态已过期") ||
    hay.includes("请先登录")
  )
}

function buildHeaders(): Record<string, string> {
  // B1 沙箱域(*.apps.vibex.cn)上 getAuthHeaders() 返回 X-Vibex-Scoped-Token;
  // 老域返回空对象, 零影响。
  const headers: Record<string, string> = { "Content-Type": "application/json", ...getAuthHeaders() }
  // PB 登录头走 X-Pb-Auth 而非 Authorization, 避免被线上网关误当 RH 令牌校验(见 pb.ts)。
  Object.assign(headers, pbAuthHeader(pb.authStore.token))
  return headers
}

// 单次 submit, 不 poll. 页面直接用本函数的场景: 用户希望非阻塞提交后自己手工 poll
// (例如把 taskId 存 PB 后异步处理)。
// 泛型默认 AigcSubmitResponse; 存量代码 callAigc<AigcResponse<X>>(...) 也兼容。
export async function callAigc<T = AigcSubmitResponse>(path: string, body: unknown): Promise<T> {
  const base = getPocketBaseUrl()
  const url = `${base}${path.startsWith("/") ? path : "/" + path}`
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: buildHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    // hook 的结构化 message (如 429 "上一个任务还在生成中") 是给用户看的, 优先当
    // Error.message 抛出, 页面 catch 后直接展示; 技术细节保留在 status/body 上。
    let serverMsg: string
    try {
      serverMsg = String((JSON.parse(text || "{}") as { message?: string }).message || "")
    } catch {
      serverMsg = ""
    }
    throw Object.assign(new Error(serverMsg || `AIGC ${path} failed: HTTP ${res.status}`), {
      status: res.status,
      body: text,
    })
  }
  return (await res.json()) as T
}

// AI 应用 (rh-app) 异步 job 形态的薄封装: run / jobs/<id>/poll / upload / history 都是 POST,
// 返回 envelope 跟标准模型不同 (rh-ai-app.v1)。复用 callAigc 的 buildHeaders + __pb 代理,
// 只放开返回类型, 由调用方按 AiAppRunResponse / AiAppUploadResponse 等断言。
// 前端**禁止**裸 fetch /api/aigc (发布 publish-aigc-auth-scan 会拦), AI 应用一律走这个。
export async function callAiApp<T>(path: string, body: unknown): Promise<T> {
  return (await callAigc(path, body)) as unknown as T
}

// AI 应用 (rh-app) 的输出条目, 来自 /run 与 /jobs/<id>/poll 的 outputs/results。
export interface AiAppOutput {
  id?: string
  type: "image" | "video" | "audio" | "text" | "file"
  url: string
  text?: string
  fileType?: string
  filename?: string
  nodeId?: string
}

// AI 应用 run/poll 的统一响应包络 (version: rh-ai-app.v1)。
// usage 只在终态 (succeeded/failed) 出现, 是真实扣费明细。
export interface AiAppRunResponse {
  ok: boolean
  version: "rh-ai-app.v1"
  state: "queued" | "running" | "succeeded" | "failed" | "partial"
  job?: { jobId: string; taskId: string; state: string }
  outputs?: AiAppOutput[]
  results?: AiAppOutput[]
  usage?: AigcUsage
  error?: { code: string; message: string; retryable: boolean; taskId?: string; failedNode?: unknown }
}

export interface AiAppUploadResponse {
  ok: boolean
  fileName: string
}

export interface AigcUploadResponse {
  ok: boolean
  type: string
  download_url: string
  downloadUrl: string
  fileName: string
  size?: string
}

// upload 的老代际路由是 /api/aigc/media/upload (返回 { ok, downloadUrl }), 新代际是
// /api/aigc/upload。发布刷新只换前端 lib、不动 app 已装的 pb_hooks, 老后端上新路由
// 404 (真实事故: app-bcbdf4c8 老 hook + 刷新后新 lib, 上传全 404) —— 同理探测降级并记住。
// rh_vc_deploy 依赖 "legacyAigcUploadRoute" 这个标记判断本模板可以安全刷进老代际后端的 app。
let legacyAigcUploadRoute: boolean | null = null

const AIGC_UPLOAD_FILE_TYPES = ["image", "audio", "video", "zip"] as const
type AigcUploadFileType = (typeof AIGC_UPLOAD_FILE_TYPES)[number]

// 契约兼容 (勿删): 老世代 lib 的签名是 uploadAigcMedia(file, filename) => Promise<string
// (URL)>, 而新世代是 (file, fileType) => Promise<AigcUploadResponse>。发布刷新只换本
// 文件、不动 app 页面代码, 老页面拿新 lib 会把响应对象塞进 image_url → RH/火山侧
// "content[N].image_url is invalid" (真实事故: app-bcbdf4c8 刷新后当天 190 个该错误)。
// 打包器不做类型检查, 这种同名不同契约的漂移不会在构建期暴露, 只能运行时多态:
// 第二参不在 fileType 白名单里 → 判定为老契约的 filename, 走老行为返回纯 URL 字符串。
export async function uploadAigcMedia(file: File | Blob, fileType?: AigcUploadFileType): Promise<AigcUploadResponse>
export async function uploadAigcMedia(file: File | Blob, legacyFilename: string): Promise<string>
export async function uploadAigcMedia(
  file: File | Blob,
  second: string = "image",
): Promise<AigcUploadResponse | string> {
  const legacyCall = !(AIGC_UPLOAD_FILE_TYPES as readonly string[]).includes(second)
  const legacyFilename = legacyCall ? second : ""
  const fileType: AigcUploadFileType = legacyCall
    ? (AIGC_UPLOAD_FILE_TYPES.find((t) => file.type.startsWith(`${t}/`)) ?? "image")
    : (second as AigcUploadFileType)
  const base = getPocketBaseUrl()
  const headers: Record<string, string> = { ...getAuthHeaders(), ...pbAuthHeader(pb.authStore.token) }
  const doPost = (path: string) => {
    const form = new FormData()
    form.append("fileType", fileType)
    if (legacyFilename) form.append("file", file, legacyFilename)
    else form.append("file", file)
    return fetch(`${base}${path}`, { method: "POST", credentials: "include", headers, body: form })
  }
  let res = await doPost(legacyAigcUploadRoute === true ? "/api/aigc/media/upload" : "/api/aigc/upload")
  if (res.status === 404 && legacyAigcUploadRoute === null) {
    legacyAigcUploadRoute = true
    res = await doPost("/api/aigc/media/upload")
    if (res.status === 404) legacyAigcUploadRoute = null
  }
  if (res.status === 412 || res.status === 401) {
    // 老契约调用方靠 .status === 412 识别"需要重新登录"; 401 SANDBOX_TOKEN_* 归一成 412 保兼容。
    throw Object.assign(new Error("login_required"), { status: 412 })
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw Object.assign(new Error(`AIGC upload failed: HTTP ${res.status}`), {
      status: res.status,
      body: text,
    })
  }
  const data = (await res.json()) as AigcUploadResponse
  // 老路由只返回 { ok, downloadUrl }; 补齐新契约字段, 让两代后端对调用方无差别。
  if (!data.download_url && data.downloadUrl) data.download_url = data.downloadUrl
  if (!data.downloadUrl && data.download_url) data.downloadUrl = data.download_url
  if (!data.fileName) data.fileName = legacyFilename || (file instanceof File ? file.name : "upload.bin")
  if (legacyCall) return data.downloadUrl || data.download_url || ""
  return data
}

// AI 应用媒体上传: 浏览器原生 FormData 把文件以二进制直传给后端, 后端用 Go 原生
// $filesystem.fileFromMultipart() 拿文件, 完全跳过 base64。**视频/音频/大图必须走这个**——
// 不要再用 fileToDataUrl 把几十 MB 视频转 base64 塞 JSON: Goja 单线程逐字符解码会锁死 PB → 502/524。
// 本文件是 publish-aigc-auth-scan 的唯一豁免文件, 这里裸 fetch 合规;
// 不要手动设 Content-Type, 让浏览器自动带 multipart boundary (buildHeaders 会设 json, 故这里手搓 header)。
export async function uploadAiAppMedia(
  slug: string,
  file: File,
  fileType: "image" | "audio" | "video",
): Promise<AiAppUploadResponse> {
  const base = getPocketBaseUrl()
  const url = `${base}/api/aigc/ai-app/${slug}/upload?fileType=${encodeURIComponent(fileType)}`
  const headers: Record<string, string> = { ...getAuthHeaders(), ...pbAuthHeader(pb.authStore.token) }
  const form = new FormData()
  form.append("fileType", fileType)
  form.append("file", file)
  const res = await fetch(url, { method: "POST", credentials: "include", headers, body: form })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw Object.assign(new Error(`AI app upload failed: HTTP ${res.status}`), {
      status: res.status,
      body: text,
    })
  }
  return (await res.json()) as AiAppUploadResponse
}

// ============ AI 应用 (rh-app) 的提交/轮询/恢复 helper。页面不要自己写 while poll 循环。 ============

export interface AiAppPollOpts {
  // 默认 3000ms, 与旧版 useAiAppPage 模板行为一致
  pollIntervalMs?: number
  // 默认 60 分钟 (AI 应用是整条 workflow, 常远慢于单模型调用)
  deadlineMs?: number
  signal?: AbortSignal
}

function aiAppFailure(code: string, message: string, jobId: string, retryable = false): AiAppRunResponse {
  return {
    ok: false,
    version: "rh-ai-app.v1",
    state: "failed",
    job: { jobId, taskId: "", state: "failed" },
    outputs: [],
    results: [],
    error: { code, message, retryable },
  }
}

// 共享 poll 循环, 被 callAiAppAndPoll (提交后立即 poll) 和 resumeAiAppJob (对已有 jobId 恢复 poll)
// 复用。终态一律以 AiAppRunResponse 形式返回, **不 throw**:
// - 超时       → error.code = "TIMEOUT"
// - 连续断网   → error.code = "NETWORK"
// - 取消       → error.code = "ABORTED"
// - 412/401/登录错 → error.code = "RH_LOGIN_REQUIRED" (页面据此翻 needsRhLogin)
async function pollAiAppToResult(slug: string, jobId: string, opts?: AiAppPollOpts): Promise<AiAppRunResponse> {
  const interval = opts?.pollIntervalMs ?? 3000
  const deadline = Date.now() + (opts?.deadlineMs ?? 60 * 60_000)
  let consecutiveFails = 0
  while (true) {
    if (opts?.signal?.aborted) return aiAppFailure("ABORTED", "已取消", jobId)
    if (Date.now() > deadline) return aiAppFailure("TIMEOUT", "生成超时, 请重试", jobId, true)
    await new Promise((r) => setTimeout(r, interval))
    try {
      const pollRes = await callAiApp<AiAppRunResponse>(`/api/aigc/ai-app/${slug}/jobs/${encodeURIComponent(jobId)}/poll`, {})
      consecutiveFails = 0
      if (pollRes.state === "succeeded" || pollRes.state === "failed" || pollRes.state === "partial") {
        return pollRes
      }
      // queued / running → 继续 loop
    } catch (e) {
      const status = Number((e as { status?: number })?.status || 0)
      const body = String((e as { body?: string })?.body || "")
      const msg = String((e as Error)?.message || e)
      if ((e as { name?: string })?.name === "AbortError") return aiAppFailure("ABORTED", "已取消", jobId)
      if (isLoginRequiredSignal(status, msg, body)) {
        return aiAppFailure("RH_LOGIN_REQUIRED", LOGIN_REQUIRED_ZH, jobId)
      }
      consecutiveFails++
      if (consecutiveFails >= 5) {
        return aiAppFailure("NETWORK", "网络连接不稳定, 请检查网络后重试", jobId, true)
      }
    }
  }
}

// 提交 AI 应用 run + 自动 poll 到终态, 一次调用拿到 outputs。失败/超时/412 全部返回结构化
// AiAppRunResponse (state === "failed" + error), **不 throw**。
// 页面标准用法:
//   const r = await callAiAppAndPoll(SLUG, runBody)
//   if (r.state === "succeeded") { /* r.outputs, r.usage */ }
//   else { setErrorMsg(formatAiAppFailureMessage(r)); if (r.error?.code === "RH_LOGIN_REQUIRED") setNeedsRhLogin(true) }
export async function callAiAppAndPoll(slug: string, body: unknown, opts?: AiAppPollOpts): Promise<AiAppRunResponse> {
  let submitRes: AiAppRunResponse
  try {
    submitRes = await callAiApp<AiAppRunResponse>(`/api/aigc/ai-app/${slug}/run`, body)
  } catch (e) {
    const status = Number((e as { status?: number })?.status || 0)
    const errBody = String((e as { body?: string })?.body || "")
    const msg = String((e as Error)?.message || e)
    if (isLoginRequiredSignal(status, msg, errBody)) {
      return aiAppFailure("RH_LOGIN_REQUIRED", LOGIN_REQUIRED_ZH, "")
    }
    const busyHay = `${msg} ${errBody}`.toLowerCase()
    if (status === 429 || busyHay.includes("task_queue_maxed") || busyHay.includes("concurrency limit")) {
      return aiAppFailure("RH_TASK_QUEUE_MAXED", AI_APP_ERROR_MESSAGES_ZH.RH_TASK_QUEUE_MAXED, "", true)
    }
    return aiAppFailure("SUBMIT_FAILED", msg || "提交失败, 请重试", "", true)
  }
  if (
    submitRes.error?.code?.startsWith("APIKEY") ||
    isLoginRequiredSignal(0, submitRes.error?.code, submitRes.error?.message)
  ) {
    return aiAppFailure("RH_LOGIN_REQUIRED", LOGIN_REQUIRED_ZH, "")
  }
  const jobId = submitRes.job?.jobId
  if (!jobId) {
    // 同步完成 (部分 AI 应用 run 直接带 outputs 返回终态)
    if (submitRes.state === "succeeded" || submitRes.state === "failed") return submitRes
    return aiAppFailure(submitRes.error?.code || "SUBMIT_FAILED", submitRes.error?.message || "提交失败, 请重试", "", true)
  }
  return pollAiAppToResult(slug, jobId, opts)
}

// 恢复一个已提交、还没跑到终态的 AI 应用任务的 poll —— 用于页面挂载 (或用户手动点开"进行中"任务)
// 时, 把 history 里 status === "running" 的历史项接着跑完, 而不是让它在浏览器刷新/关闭重开后
// 就再也没人推进 (RH 那边任务其实早就跑完了, 只是没人来 poll 把结果写回 aigc_tasks)。
// 页面标准用法 (挂载时):
//   const r = await callAiApp<{ ok: boolean; items?: { jobId: string; status: string }[] }>(`/api/aigc/ai-app/${SLUG}/history`, {})
//   r.items?.filter((it) => it.status === "running").forEach((it) => {
//     // 先把 it 渲染成"进行中"卡片, 再后台续跑:
//     resumeAiAppJob(SLUG, it).then((res) => { /* 更新这张卡片: succeeded → url, failed → error */ })
//   })
// deadline 从这次 resume 调用开始计, 对已跑很久的任务重新 resume 不会立刻超时。
export async function resumeAiAppJob(
  slug: string,
  item: { jobId: string },
  opts?: AiAppPollOpts,
): Promise<AiAppRunResponse> {
  return pollAiAppToResult(slug, item.jobId, opts)
}

const AI_APP_ERROR_MESSAGES_ZH: Record<string, string> = {
  RH_LOGIN_REQUIRED: LOGIN_REQUIRED_ZH,
  TIMEOUT: "AI 生成超时 (可能服务器繁忙), 请稍后重试",
  NETWORK: "网络连接不稳定, 请检查网络后重试",
  ABORTED: "已取消",
  SUBMIT_FAILED: "提交生成任务失败 (网络或服务器繁忙), 请稍后重试",
  RH_TASK_QUEUE_MAXED: "上一个任务还在生成中, 请等它完成后再试",
}

// AiAppRunResponse 失败分支 → 中文详情的默认安全格式化（错误码 → 中文文案表的唯一出口）。
// 对**所有**错误码都把 RunningHub 返回的真实原因拼在中文文案后面 (除非与基础文案重复), 不做
// 白名单挑着拼 —— 白名单漏掉的分支会把 RH 真实报错 (如 "音频时长过短") 吞掉。
// 页面处理失败分支时直接调用这个函数, 不要自己按 error.code 写一份映射。
// RH_LOGIN_REQUIRED / SANDBOX_TOKEN_* 只展示登录引导, 不拼技术码。
export function formatAiAppFailureMessage(res: AiAppRunResponse): string {
  const code = String(res.error?.code || "")
  const raw = String(res.error?.message || "")
  const hay = `${code} ${raw}`.toLowerCase()
  let base = AI_APP_ERROR_MESSAGES_ZH[code] || ""
  if (!base) {
    if (code.startsWith("APIKEY") || isLoginRequiredSignal(0, code, raw)) base = AI_APP_ERROR_MESSAGES_ZH.RH_LOGIN_REQUIRED
    else if (hay.includes("insufficient") || hay.includes("balance") || hay.includes("余额") || hay.includes("点数") || hay.includes("积分")) base = "RunningHub 账户余额不足, 请充值后重试"
    else if (/content security audit|内容安全审查|内容审查|审核未通过|content moderation/i.test(raw)) base = "内容审核未通过"
    else base = "生成失败, 请稍后重试或换个 prompt"
  }
  if (base === AI_APP_ERROR_MESSAGES_ZH.RH_LOGIN_REQUIRED) return base
  if (raw && raw !== base) return `${base}: ${raw}`
  return base
}

// 多图/多文件上传的标准通路 —— media_params.multiple=true 的参数 (如图生图 imageUrls) 必须走这个,
// 不能只接单图。逐个错峰 (~300ms) 发起, 避免同一时刻打满 /api/aigc/upload; 单个文件上传失败会被
// 跳过而不是让整批失败。opts.maxCount 通常传契约里的 max_num, 超出的文件直接截断丢弃。
// 返回的 downloadUrl 顺序对应输入 files 里成功项的相对顺序 (失败项被过滤掉, 不占位)。
export async function uploadAigcMediaFiles(
  files: File[],
  fileType: "image" | "audio" | "video" | "zip" = "image",
  opts?: { maxCount?: number },
): Promise<string[]> {
  const capped = opts?.maxCount ? files.slice(0, opts.maxCount) : files
  const results = await Promise.all(
    capped.map(
      (file, i) =>
        new Promise<string>((resolve) => {
          setTimeout(() => {
            uploadAigcMedia(file, fileType)
              .then((res) => resolve(res.downloadUrl || ""))
              .catch(() => resolve(""))
          }, i * 300)
        }),
    ),
  )
  return results.filter((url) => !!url)
}

// 相对路径 → 当前 origin 绝对 URL（老代际导出, persistMediaUrl 依赖）。
export function toAbsoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  if (typeof window === "undefined") return path
  return `${window.location.origin}${path}`
}

// 老代际"外链落地到 PB media_assets"接口（/api/media/persist 是老 pb_hooks 路由,
// 发布刷新不动 app 已装的 hooks, 所以端点仍在）。失败一律返回原 URL 不阻塞主流程。
export async function persistMediaUrl(url: string, kind: string): Promise<string> {
  if (!url) return url
  if (url.includes("/api/files/media_assets/")) return toAbsoluteUrl(url)
  const base = getPocketBaseUrl()
  try {
    const res = await fetch(`${base}/api/media/persist`, {
      method: "POST",
      credentials: "include",
      headers: buildHeaders(),
      body: JSON.stringify({ url, kind }),
    })
    if (!res.ok) return url
    const data = (await res.json().catch(() => null)) as { ok?: boolean; url?: string } | null
    if (data?.ok && data.url) return toAbsoluteUrl(`${base}${data.url}`)
  } catch {
    // 落地失败时先用原 URL 不阻塞主流程
  }
  return url
}


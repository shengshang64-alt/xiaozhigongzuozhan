// ---------------------------------------------------------------------------
// AI 绘图 Provider 接口（2026-10-30 补齐 6-d）
//
// 需求原文（§六.4）：
//   「提供可配置的图像生成 Provider 接口，支持模型切换、失败重试和单页重新生成。」
//   「图片生成密钥只能放服务端，不得写入前端代码或浏览器环境变量。」
//   「AI 图片不得用于伪造：公司真实产品界面、真实项目照片、公司 Logo、
//     客户 Logo、认证证书、真实数据/图表/政策文件。」
//
// 本模块的设计：
//   · 前端只发「提示词 + 画幅 + 风格」，**不碰密钥**
//   · 实际调用走 sidecar（后端）/api/ai-image/generate，密钥在服务端环境变量
//   · 服务端未配置时返回明确原因，前端降级到搜图或占位（不假装成功）
//   · 负向提示词内置（禁止文字/水印/Logo/界面），降低生成伪文字概率
// ---------------------------------------------------------------------------

const SIDECAR_BASE = (import.meta.env.VITE_SIDECAR_BASE as string | undefined)?.replace(/\/$/, "") ?? "http://127.0.0.1:7001"

/** 画幅（与 PPT 版式位置对应） */
export type ImageAspect = "16:9" | "4:3" | "1:1" | "3:4"

/** 生成请求（前端可构造，不含任何密钥） */
export type AiImageRequest = {
  prompt: string
  /** 负向提示词（默认内置通用禁用项） */
  negativePrompt?: string
  aspect?: ImageAspect
  /** 风格约束（由全册视觉计划给出，保证同册统一） */
  stylePreset?: "photographic" | "illustrative" | "diagrammatic"
  /** 统一色调（取公司模板主色的文字描述，保证配图不与模板冲突） */
  colorHint?: string
  /** 单页重新生成时传页码，便于服务端日志与缓存分桶 */
  page?: number
}

// ---------------------------------------------------------------------------
// 界面配置存储（2026-10-31：用户反馈"AI 生图在哪配置"——原来只能改环境变量重启 sidecar）
//
// 与图库 Key 一致的做法：存 localStorage，界面可填。
// 安全性：只在本机浏览器 + 本机 sidecar 回环之间传递，不出机器。
// ---------------------------------------------------------------------------
const AI_CFG_KEY = "ppt-ai-image-config:"

export type AiProviderKind = "dashscope" | "zhipu" | "siliconflow" | "fal" | "qianwen" | "openai" | "custom"

export type AiImageConfig = {
  provider: AiProviderKind | ""
  key: string
  model: string
  base?: string
}

/** 各 provider 的默认模型与申请地址（界面展示用） */
export const AI_PROVIDER_PRESETS: Record<
  AiProviderKind,
  { label: string; defaultModel: string; keyUrl: string; note: string }
> = {
  dashscope: {
    label: "阿里通义万相",
    defaultModel: "wanx2.1-t2i-turbo",
    keyUrl: "https://dashscope.console.aliyun.com/apiKey",
    note: "国内直连，中文理解好，有免费额度",
  },
  zhipu: {
    label: "智谱 CogView",
    defaultModel: "cogview-3-flash",
    keyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    note: "国内直连，有免费模型 cogview-3-flash",
  },
  siliconflow: {
    label: "硅基流动",
    defaultModel: "black-forest-labs/FLUX.1-schnell",
    keyUrl: "https://cloud.siliconflow.cn/account/ak",
    note: "一个 Key 通吃 Flux/SD 等多家模型",
  },
  fal: {
    label: "fal.ai（Flux）",
    defaultModel: "fal-ai/flux/schnell",
    keyUrl: "https://fal.ai/dashboard/keys",
    note: "Flux 画质最好，需能访问国际接口",
  },
  openai: {
    label: "OpenAI DALL·E",
    defaultModel: "dall-e-3",
    keyUrl: "https://platform.openai.com/api-keys",
    note: "国内通常不可直连（实测超时）",
  },
  qianwen: {
    label: "千问 MaaS（qwen-image）",
    defaultModel: "qwen-image-2.0-pro",
    keyUrl: "https://maas.qianwenaiapi.com",
    note: "OpenAI 兼容端点；需在服务商后台开通图像模型权限",
  },
  custom: {
    label: "自定义端点",
    defaultModel: "",
    keyUrl: "",
    note: "兼容 OpenAI 格式的自建/代理服务",
  },
}

/** 读取界面配置 */
export function getAiImageConfig(): AiImageConfig {
  try {
    const raw = localStorage.getItem(AI_CFG_KEY)
    if (!raw) return { provider: "", key: "", model: "" }
    const o = JSON.parse(raw) as AiImageConfig
    return { provider: o.provider ?? "", key: o.key ?? "", model: o.model ?? "", base: o.base }
  } catch {
    return { provider: "", key: "", model: "" }
  }
}

/** 保存界面配置 */
export function setAiImageConfig(cfg: AiImageConfig): void {
  try {
    localStorage.setItem(AI_CFG_KEY, JSON.stringify(cfg))
  } catch {
    /* 隐私模式静默降级 */
  }
}

/** 是否已在界面配置好（界面据此决定是否显示"可用"） */
export function hasAiImageConfig(): boolean {
  const c = getAiImageConfig()
  return Boolean(c.provider && c.key)
}

export type AiImageResult =
  | { ok: true; dataUrl: string; provider: string; model?: string; prompt: string }
  | { ok: false; reason: string; /** 是否属于"未配置/不可用"（区别于生成失败） */ notConfigured: boolean }

/**
 * 内置负向提示词。
 *
 * 依据需求「AI 图片中尽量避免文字、水印、伪 Logo 和不可读界面」：
 * 图像模型最擅长画出"看起来像文字但读不出"的伪文字，这在交付物里是硬伤。
 */
export const DEFAULT_NEGATIVE_PROMPT = [
  "text", "words", "letters", "watermark", "logo", "signature", "brand name",
  "gibberish text", "fake UI", "readable interface", "chart labels",
  "low quality", "blurry", "distorted", "extra limbs", "deformed",
].join(", ")

/** 禁止 AI 生成的用途（需求明确列的 4 类，界面据此拦截） */
export const FORBIDDEN_AI_USES = [
  "公司真实产品界面",
  "真实项目照片 / 客户现场",
  "公司 Logo / 客户 Logo / 认证证书 / 资质证明",
  "真实数据、图表、政策文件、合同内容",
] as const

/**
 * 判断某个视觉计划项是否允许走 AI 生成。
 *
 * 保护规则（硬拦截，不只是提示）：
 *   · productScreenshot 永远不允许 AI 生成（只能用户上传）
 *   · 关键词命中"界面/截图/Logo/证书/资质"也不允许
 */
export function canUseAiFor(input: { visualType?: string; query?: string; title?: string }): { ok: boolean; reason?: string } {
  if (input.visualType === "productScreenshot") {
    return { ok: false, reason: "真实产品界面只能使用用户上传的截图，不能用 AI 生成" }
  }
  const hay = `${input.query ?? ""} ${input.title ?? ""}`
  const banned = ["界面", "截图", "Logo", "logo", "标志", "证书", "资质", "认证", "合同", "政策文件", "报表数据"]
  const hit = banned.find((b) => hay.includes(b))
  if (hit) {
    return { ok: false, reason: `内容涉及「${hit}」，按规范不得用 AI 生成（避免伪造真实界面/资质）` }
  }
  return { ok: true }
}

/** 组装最终提示词（结合全册风格与模板色调） */
export function buildAiPrompt(req: AiImageRequest): string {
  const parts: string[] = []
  const styleMap = {
    photographic: "professional photograph, realistic, natural lighting, medical/enterprise setting",
    illustrative: "clean modern vector illustration, flat design, soft gradients, professional",
    diagrammatic: "minimal technical diagram aesthetic, clean lines, structured layout",
  } as const
  if (req.stylePreset) parts.push(styleMap[req.stylePreset])
  if (req.colorHint) parts.push(`color palette: ${req.colorHint}`)
  parts.push(req.prompt)
  // 统一画幅描述（提高构图可控性）
  if (req.aspect === "16:9") parts.push("wide 16:9 composition, horizontal layout")
  return parts.join(", ")
}

/**
 * 调用 AI 绘图（经 sidecar，密钥在服务端）。
 *
 * 失败语义：
 *   · notConfigured=true → 服务端没配密钥，前端应降级（提示用户去配置或用搜图）
 *   · notConfigured=false → 生成失败（可重试）
 */
export async function generateAiImage(req: AiImageRequest): Promise<AiImageResult> {
  const guard = canUseAiFor({ visualType: "aiIllustration", query: req.prompt })
  if (!guard.ok) return { ok: false, reason: guard.reason ?? "不允许用 AI 生成", notConfigured: false }

  // 带上界面配置（若已填）；sidecar 优先用它，否则回落环境变量
  const cfg = getAiImageConfig()
  const body = {
    prompt: buildAiPrompt(req),
    negativePrompt: req.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT,
    aspect: req.aspect ?? "16:9",
    page: req.page ?? 0,
    ...(cfg.provider ? { provider: cfg.provider } : {}),
    ...(cfg.key ? { key: cfg.key } : {}),
    ...(cfg.model ? { model: cfg.model } : {}),
    ...(cfg.base ? { base: cfg.base } : {}),
  }

  let res: Response
  try {
    res = await fetch(`${SIDECAR_BASE}/ai-image/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch (e) {
    return {
      ok: false,
      reason: `无法连接绘图后端（${e instanceof Error ? e.message : String(e)}）`,
      notConfigured: true,
    }
  }

  type ApiBody = { ok: boolean; dataUrl?: string; provider?: string; model?: string; error?: string; message?: string; notConfigured?: boolean }
  let data: ApiBody
  try {
    data = (await res.json()) as ApiBody
  } catch {
    return { ok: false, reason: "绘图服务返回内容无法解析", notConfigured: false }
  }

  if (!data.ok || !data.dataUrl) {
    return {
      ok: false,
      reason: String(data.message ?? data.error ?? "图片生成失败"),
      notConfigured: Boolean(data.notConfigured),
    }
  }
  return { ok: true, dataUrl: data.dataUrl, provider: String(data.provider ?? "unknown"), model: data.model, prompt: body.prompt }
}

/** 探测 AI 绘图是否可用（界面据此决定是否显示"AI 配图"选项） */
export async function probeAiImage(): Promise<{ ok: boolean; provider: string | null; hint: string }> {
  try {
    const cfg = getAiImageConfig()
    const qs = new URLSearchParams()
    if (cfg.provider) qs.set("provider", cfg.provider)
    if (cfg.key) qs.set("key", cfg.key)
    if (cfg.model) qs.set("model", cfg.model)
    const url = `${SIDECAR_BASE}/ai-image/health${qs.toString() ? `?${qs}` : ""}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { ok?: boolean; provider?: string; hint?: string }
    return { ok: Boolean(data.ok), provider: data.provider ?? null, hint: String(data.hint ?? "") }
  } catch (e) {
    return {
      ok: false,
      provider: null,
      hint: `绘图服务不可达（${e instanceof Error ? e.message : String(e)}）。AI 配图需在服务端配置图像模型密钥。`,
    }
  }
}

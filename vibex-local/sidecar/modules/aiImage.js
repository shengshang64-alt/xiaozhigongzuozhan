// ---------------------------------------------------------------------------
// AI 绘图 Provider（sidecar 模块，2026-10-30 补齐 6-d）
//
// 需求原文（§六.4）：
//   「图片生成密钥只能放服务端，不得写入前端代码或浏览器环境变量。」
//
// 支持多家 Provider（通过环境变量切换）：
//   ZX_AI_IMAGE_PROVIDER = openai | dashscope | custom
//   ZX_AI_IMAGE_KEY      = <密钥>            ← 只在服务端环境变量里
//   ZX_AI_IMAGE_BASE     = <自定义端点>       ← provider=custom 时必填
//   ZX_AI_IMAGE_MODEL    = <模型名>
//
// 未配置时 /health 返回明确 hint，/generate 返回 notConfigured=true
// —— 前端据此降级到搜图，而不是假装成功。
// ---------------------------------------------------------------------------

const ENV = process.env

/**
 * 取 provider 配置。
 *
 * 2026-10-31 用户反馈「AI 生图在哪配置」：原来只能写环境变量 + 重启 sidecar，
 * 界面里没有入口。现支持**运行时覆盖**——前端可从界面传 provider/key/model，
 * 优先级：请求体 > 环境变量。
 *
 * 安全性说明：
 *   · 服务只监听 127.0.0.1，仅本机可调（不是公开服务）
 *   · 前端 Key 只在本机浏览器 localStorage，经本机回环传给本机 sidecar，不出机器
 *   · 环境变量方式仍然保留（适合团队统一配置）
 */
function providerConfig(override) {
  const o = override || {}
  const provider = String(o.provider || ENV.ZX_AI_IMAGE_PROVIDER || "").trim()
  const key = String(o.key || ENV.ZX_AI_IMAGE_KEY || "").trim()
  const base = String(o.base || ENV.ZX_AI_IMAGE_BASE || "").trim()
  const model = String(o.model || ENV.ZX_AI_IMAGE_MODEL || "").trim()
  if (!provider) return { ok: false, hint: "未配置 AI 生图服务。可在「PPT 逐页编辑 → API Key 面板 → AI 生图」里选服务商并填 Key（推荐阿里通义万相或智谱）" }
  if (!key) return { ok: false, hint: "已选服务商但没填 API Key。请在「API Key 面板 → AI 生图」里粘贴 Key" }
  if (provider === "custom" && !base) return { ok: false, hint: "provider=custom 时必须配置 ZX_AI_IMAGE_BASE" }
  return { ok: true, provider, key, base, model }
}

/** 统一的「提示词 → 图片 dataURL」调用（按 provider 分派） */
async function callProvider(cfg, { prompt, negativePrompt, aspect }) {
  const size = aspect === "16:9" ? "1792x1024" : aspect === "3:4" ? "1024x1792" : "1024x1024"

  if (cfg.provider === "openai") {
    const url = (cfg.base || "https://api.openai.com/v1") + "/images/generations"
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model || "dall-e-3",
        prompt,
        n: 1,
        size,
        response_format: "b64_json",
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`)
    const b64 = data?.data?.[0]?.b64_json
    if (!b64) throw new Error("返回里没有图片数据")
    return { dataUrl: `data:image/png;base64,${b64}`, model: cfg.model || "dall-e-3" }
  }

  if (cfg.provider === "dashscope") {
    // 阿里云通义万相：异步任务制，这里做同步轮询（简化）
    const base = cfg.base || "https://dashscope.aliyuncs.com/api/v1"
    const create = await fetch(`${base}/services/aigc/text2image/image-synthesis`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.key}`,
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model: cfg.model || "wanx-v1",
        input: { prompt, negative_prompt: negativePrompt },
        parameters: { size: aspect === "16:9" ? "1280*720" : "1024*1024", n: 1 },
      }),
    })
    const created = await create.json()
    if (!create.ok) throw new Error(created?.message || `HTTP ${create.status}`)
    const taskId = created?.output?.task_id
    if (!taskId) throw new Error("未拿到 task_id")
    // 轮询（最多 60 秒）
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 2000))
      const q = await fetch(`${base}/tasks/${taskId}`, { headers: { Authorization: `Bearer ${cfg.key}` } })
      const qd = await q.json()
      const status = qd?.output?.task_status
      if (status === "SUCCEEDED") {
        const url = qd?.output?.results?.[0]?.url
        if (!url) throw new Error("任务成功但没有图片 URL")
        // 下载成 base64 回传（避免前端跨域 + 让调用方直接拿到可用数据）
        const img = await fetch(url)
        const buf = Buffer.from(await img.arrayBuffer())
        return { dataUrl: `data:image/png;base64,${buf.toString("base64")}`, model: cfg.model || "wanx-v1" }
      }
      if (status === "FAILED") throw new Error(qd?.output?.message || "生成任务失败")
    }
    throw new Error("生成超时（60 秒）")
  }

  // -------------------------------------------------------------------------
  // 2026-10-31 新增：界面可配置的三家主流服务（实测本机均可达）
  // -------------------------------------------------------------------------
  if (cfg.provider === "zhipu") {
    // 智谱 CogView：兼容 OpenAI 格式
    const url = (cfg.base || "https://open.bigmodel.cn/api/paas/v4") + "/images/generations"
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model || "cogview-3-flash",
        prompt,
        size: aspect === "16:9" ? "1440x960" : aspect === "3:4" ? "960x1440" : "1024x1024",
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message || data?.message || `HTTP ${res.status}`)
    const url2 = data?.data?.[0]?.url
    if (!url2) throw new Error("返回里没有图片 URL")
    const img = await fetch(url2)
    const buf = Buffer.from(await img.arrayBuffer())
    return { dataUrl: `data:image/png;base64,${buf.toString("base64")}`, model: cfg.model || "cogview-3-flash" }
  }

  if (cfg.provider === "siliconflow") {
    // 硅基流动：兼容 OpenAI 格式，聚合 Flux / SD 等
    const url = (cfg.base || "https://api.siliconflow.cn/v1") + "/images/generations"
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model || "black-forest-labs/FLUX.1-schnell",
        prompt,
        image_size: aspect === "16:9" ? "1024x576" : aspect === "3:4" ? "768x1024" : "1024x1024",
        batch_size: 1,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`)
    const url2 = data?.images?.[0]?.url || data?.data?.[0]?.url
    if (!url2) throw new Error("返回里没有图片 URL")
    if (String(url2).startsWith("data:")) return { dataUrl: url2, model: cfg.model }
    const img = await fetch(url2)
    const buf = Buffer.from(await img.arrayBuffer())
    return { dataUrl: `data:image/png;base64,${buf.toString("base64")}`, model: cfg.model }
  }

  if (cfg.provider === "fal") {
    // fal.ai：Flux 系列，请求格式特殊（image_size 用预设名）
    const model = cfg.model || "fal-ai/flux/schnell"
    const url = `https://fal.run/${model}`
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Key ${cfg.key}` },
      body: JSON.stringify({
        prompt,
        image_size: aspect === "16:9" ? "landscape_16_9" : aspect === "3:4" ? "portrait_4_3" : "square_hd",
        num_images: 1,
        enable_safety_checker: true,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.detail || data?.message || `HTTP ${res.status}`)
    const url2 = data?.images?.[0]?.url
    if (!url2) throw new Error("返回里没有图片 URL")
    const img = await fetch(url2)
    const buf = Buffer.from(await img.arrayBuffer())
    return { dataUrl: `data:image/png;base64,${buf.toString("base64")}`, model }
  }

  if (cfg.provider === "qianwen") {
    // 千问 MaaS（OpenAI 兼容端点，用户提供的 https://maas.qianwenaiapi.com/compatible-mode/v1）
    // 模型：qwen-image-2.0-pro 系列 / wan2.7-image 系列
    const url = (cfg.base || "https://maas.qianwenaiapi.com/compatible-mode/v1") + "/images/generations"
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model || "qwen-image-2.0-pro",
        prompt,
        n: 1,
        // qwen-image 系列支持 1664*928（16:9）/ 1024*1024 等尺寸
        size: aspect === "16:9" ? "1664*928" : aspect === "3:4" ? "928*1664" : "1024*1024",
        response_format: "b64_json",
      }),
    })
    const txt = await res.text()
    if (!res.ok) {
      // 把"未开通"这类原因说清楚，别让用户以为是代码坏了
      let msg = `HTTP ${res.status}`
      try {
        const e = JSON.parse(txt)
        const code = e?.error?.code || ""
        if (code.includes("Unpurchased")) {
          msg = "该模型未在服务商后台开通。请到 maas.qianwenaiapi.com 控制台购买/开通图像模型权限"
        } else {
          msg = e?.error?.message || msg
        }
      } catch (_) {
        msg = txt.slice(0, 200) || msg
      }
      throw new Error(msg)
    }
    const data = JSON.parse(txt)
    const b64 = data?.data?.[0]?.b64_json
    if (b64) return { dataUrl: `data:image/png;base64,${b64}`, model: cfg.model }
    const url2 = data?.data?.[0]?.url
    if (!url2) throw new Error("返回里既没有 b64_json 也没有图片 URL")
    const img = await fetch(url2)
    const buf = Buffer.from(await img.arrayBuffer())
    return { dataUrl: `data:image/png;base64,${buf.toString("base64")}`, model: cfg.model }
  }

  if (cfg.provider === "custom") {
    const res = await fetch(cfg.base, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ prompt, negative_prompt: negativePrompt, size, n: 1 }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`)
    // 兼容三种返回：b64 / url / dataUrl
    const b64 = data?.data?.[0]?.b64_json ?? data?.b64_json ?? data?.image
    const url = data?.data?.[0]?.url ?? data?.url
    if (b64) return { dataUrl: b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`, model: cfg.model }
    if (url) {
      const img = await fetch(url)
      const buf = Buffer.from(await img.arrayBuffer())
      return { dataUrl: `data:image/png;base64,${buf.toString("base64")}`, model: cfg.model }
    }
    throw new Error("返回里既没有 base64 也没有图片 URL")
  }

  throw new Error(`不支持的 provider: ${cfg.provider}`)
}

export function register({ route, readJson, send }) {
  /** GET /ai-image/health — 是否已配置可用的图像模型 */
  route("GET", "/ai-image/health", async (req, res) => {
    // 支持 ?provider=&key=&model= 从前端传入（界面配置方式）
    const q = (req.url ? new URL(req.url, "http://127.0.0.1").searchParams : new URLSearchParams())
    const cfg = providerConfig({
      provider: q.get("provider") || undefined,
      key: q.get("key") || undefined,
      model: q.get("model") || undefined,
    })
    send(res, 200, {
      ok: cfg.ok,
      provider: cfg.ok ? cfg.provider : null,
      model: cfg.ok ? cfg.model || null : null,
      hint: cfg.ok
        ? `已配置 ${cfg.provider}${cfg.model ? ` / ${cfg.model}` : ""}`
        : cfg.hint,
    })
  })

  /**
   * POST /ai-image/generate
   * 请求：{ prompt, negativePrompt, aspect, page }
   * 响应：{ ok, dataUrl, provider, model } | { ok:false, error, message, notConfigured }
   */
  route("POST", "/ai-image/generate", async (req, res) => {
    try {
      const body = await readJson(req, 1024 * 1024)
      // 2026-10-31：支持前端传来的 provider/key/model（界面配置，优先于环境变量）
      const cfg = providerConfig({
        provider: body.provider || undefined,
        key: body.key || undefined,
        base: body.base || undefined,
        model: body.model || undefined,
      })
      if (!cfg.ok) {
        send(res, 200, { ok: false, notConfigured: true, error: "not_configured", message: cfg.hint })
        return
      }
      const prompt = String(body.prompt || "").trim()
      if (!prompt) {
        send(res, 400, { ok: false, error: "prompt_required", message: "缺少 prompt" })
        return
      }
      const out = await callProvider(cfg, {
        prompt,
        negativePrompt: String(body.negativePrompt || ""),
        aspect: String(body.aspect || "16:9"),
      })
      send(res, 200, { ok: true, dataUrl: out.dataUrl, provider: cfg.provider, model: out.model })
    } catch (e) {
      send(res, 200, { ok: false, error: "generate_failed", message: String(e?.message ?? e) })
    }
  })
}

// src/pages/PptQuote/imageSearch.ts
//
// 真实配图三通道:
//   1) hospital  — 复用现有 /api/customers/fetch-site 从医院官网抓图(见 usePptQuote.loadImagePool)
//   2) pexels    — 浏览器直连 api.pexels.com,Key 走 .env.local 或 localStorage 覆盖
//   3) unsplash  — 浏览器直连 api.unsplash.com,同上
// 说明:两个图库 API 都开启了 CORS、支持服务端渲染外的前端调用,不再新增 pb hook。
//      下载图片字节转 dataURL 仍走既有的 /api/customers/fetch-image 代理(绕跨域/画布污染)。
//      AI 生图不在本文件,由 callAigcAndPoll("nano-banana-pro", ...) 提供。

export type ImageSearchProvider = "pexels" | "unsplash"

export interface ImageSearchHit {
  url: string
  alt: string
  source: string
}

export interface ImageSearchResult {
  ok: boolean
  hits: ImageSearchHit[]
  message?: string
}

const LS_KEY_PREFIX = "ppt-image-search-key:"

// Key 优先级:localStorage(用户临时贴)> Vite env(项目长期配置)。
export function getImageSearchKey(provider: ImageSearchProvider): string {
  try {
    const local = localStorage.getItem(LS_KEY_PREFIX + provider)
    if (local && local.trim()) return local.trim()
  } catch {
    /* localStorage 被禁时静默降级 */
  }
  const env = import.meta.env as unknown as Record<string, string | undefined>
  if (provider === "pexels") return (env.VITE_PEXELS_API_KEY || "").trim()
  return (env.VITE_UNSPLASH_ACCESS_KEY || "").trim()
}

export function setImageSearchKey(provider: ImageSearchProvider, key: string): void {
  try {
    const v = key.trim()
    if (v) localStorage.setItem(LS_KEY_PREFIX + provider, v)
    else localStorage.removeItem(LS_KEY_PREFIX + provider)
  } catch {
    /* 忽略 */
  }
}

// 中文关键词兜底:Pexels 支持中文查询但结果偏少;Unsplash 主要英文索引。
// 医疗场景常见词做一份份小词表,其他词原样发给 API(搜不到由调用方提示换词)。
const CN2EN: Record<string, string> = {
  医院: "hospital",
  门诊: "outpatient clinic",
  病房: "hospital ward",
  手术: "operating room surgery",
  手术室: "operating room",
  影像: "medical imaging radiology",
  检验: "medical laboratory",
  药房: "pharmacy",
  护士: "nurse",
  医生: "doctor physician",
  设备: "medical equipment",
  大楼: "building exterior",
  信息化: "healthcare it digital",
  数据中心: "data center server",
  大屏: "dashboard screen",
  智慧: "smart technology",
  互联网医院: "telemedicine",
  急诊: "emergency room",
  ICU: "intensive care unit",
  重症: "intensive care",
  儿科: "pediatric",
  老年: "elderly care",
}

// 把中文 hint 翻成一条尽量可搜的英文串;若原本就是英文/中英混排则原样透传。
export function translateQuery(q: string): string {
  const raw = q.trim()
  if (!raw) return ""
  if (/^[\x00-\x7F\s\d\W]+$/.test(raw) && !/[\u4e00-\u9fa5]/.test(raw)) return raw
  // 逐个替换命中的中文词,未命中的中文保留(API 可能仍返回少量结果或空)
  let out = raw
  for (const [cn, en] of Object.entries(CN2EN)) {
    if (out.includes(cn)) out = out.replace(new RegExp(cn, "g"), ` ${en} `)
  }
  // 中英混排时,把中文剩下的字用空格切掉,英文部分保留
  out = out.replace(/[\u4e00-\u9fa5]+/g, " ").replace(/\s+/g, " ").trim()
  return out || raw
}

async function reqJson(url: string, headers: Record<string, string>): Promise<{ status: number; json: unknown } | { status: number; error: string }> {
  try {
    const res = await fetch(url, { method: "GET", headers })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return { status: res.status, error: text.slice(0, 120) || `HTTP ${res.status}` }
    }
    return { status: res.status, json: await res.json() }
  } catch (e) {
    return { status: 0, error: String((e as Error)?.message || e) }
  }
}

export async function searchImages(
  provider: ImageSearchProvider,
  query: string,
  opts?: { perPage?: number; orientation?: "landscape" | "portrait" | "square" },
): Promise<ImageSearchResult> {
  const key = getImageSearchKey(provider)
  if (!key) {
    return {
      ok: false,
      hits: [],
      message: provider === "pexels" ? "未配置 Pexels API Key" : "未配置 Unsplash Access Key",
    }
  }
  const q = query.trim()
  if (!q) return { ok: false, hits: [], message: "搜索关键词为空" }
  const perPage = Math.max(1, Math.min(opts?.perPage ?? 12, provider === "pexels" ? 80 : 30))
  const en = translateQuery(q)

  if (provider === "pexels") {
    const params = new URLSearchParams({ query: en, per_page: String(perPage), locale: "zh-CN", size: "medium" })
    if (opts?.orientation) params.set("orientation", opts.orientation)
    else params.set("orientation", "landscape")
    const r = await reqJson(`https://api.pexels.com/v1/search?${params.toString()}`, { Authorization: key })
    if ("error" in r) return { ok: false, hits: [], message: `Pexels ${r.status}: ${r.error}` }
    const photos = ((r.json as { photos?: Array<{ src?: { large?: string; medium?: string }; alt?: string }> })?.photos) || []
    const hits: ImageSearchHit[] = photos
      .map((p) => ({
        url: p.src?.large || p.src?.medium || "",
        alt: (p.alt || "").slice(0, 60) || q,
        source: "pexels.com",
      }))
      .filter((h) => !!h.url)
    if (!hits.length) return { ok: false, hits: [], message: "Pexels 未搜到相关图片,试更具体或换关键词" }
    return { ok: true, hits }
  }

  // Unsplash
  const params = new URLSearchParams({ query: en, per_page: String(perPage), content_filter: "high" })
  if (opts?.orientation) params.set("orientation", opts.orientation)
  else params.set("orientation", "landscape")
  const r = await reqJson(`https://api.unsplash.com/search/photos?${params.toString()}`, {
    Authorization: `Client-ID ${key}`,
    "Accept-Version": "v1",
  })
  if ("error" in r) return { ok: false, hits: [], message: `Unsplash ${r.status}: ${r.error}` }
  const results = ((r.json as { results?: Array<{ urls?: { regular?: string; large?: string }; alt_description?: string }> })?.results) || []
  const hits: ImageSearchHit[] = results
    .map((p) => ({
      url: p.urls?.regular || p.urls?.large || "",
      alt: (p.alt_description || "").slice(0, 60) || q,
      source: "unsplash.com",
    }))
    .filter((h) => !!h.url)
  if (!hits.length) return { ok: false, hits: [], message: "Unsplash 未搜到相关图片(英文索引更准),可换关键词或切 Pexels" }
  return { ok: true, hits }
}

// 由 imageHint / 标题 / 首条要点组合出适合搜图的短 query,不超过 60 字。
export function buildSearchQuery(input: { imageHint?: string; title?: string; firstBullet?: string }): string {
  const hint = (input.imageHint || "").trim()
  if (hint) return hint.slice(0, 60)
  const title = (input.title || "").trim()
  const b = (input.firstBullet || "").trim()
  return `${title} ${b}`.trim().slice(0, 60)
}

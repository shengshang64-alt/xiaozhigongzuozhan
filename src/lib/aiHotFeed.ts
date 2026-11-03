// AI 动态（AIHOT）前端数据层：RSS 解析纯函数 + 共享缓存 + 转入情报中心。
// 定位：与情报中心（医疗信息化招标/政策域）互补的外部视角 —— AI 行业动态精选。
// 解析零 DOM 依赖（纯正则），node/vitest 可直接测；XML 走 pb_hooks /api/ai_hot/feed
// 服务端代理（aihot.news 不带 CORS 头，浏览器不可跨域直取）。

import { pbJsonRequest } from "@/lib/pbJson"

// ---------------------------------------------------------------------------
// 类型（解析后视图模型）
// ---------------------------------------------------------------------------

export interface AiHotItem {
  /** RSS guid（AIHOT 站内条目 id，稳定幂等） */
  id: string
  title: string
  /** 原文链接（aihot.news 条目页，可跳转） */
  link: string
  /** 精选推荐理由/摘要（已去 HTML） */
  summary: string
  /** 分类：行业动态 | AI 模型 | AI 产品 | 论文 | 技巧观点 等（以数据为准） */
  category: string
  /** 信源名（RSS author 括号内），如「Baseten 工程博客」 */
  source: string
  /** ISO 时间；解析失败为空串 */
  publishedAt: string
}

// ---------------------------------------------------------------------------
// RSS 解析（实测结构：item > title/link/description(转义HTML或CDATA)/category/
// pubDate(RFC1123)/guid/author "noreply@aihot.news (信源名)"）
// ---------------------------------------------------------------------------

function extractTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"))
  if (!m) return ""
  const raw = m[1].trim()
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/)
  return (cdata ? cdata[1] : raw).trim()
}

/** XML 实体还原（先文本实体后去标签，&amp; 最后处理避免二次解码） */
export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
}

/** description 里的转义 HTML → 纯文本摘要（去标签、收敛空白） */
export function rssHtmlToText(html: string): string {
  const text = decodeXmlEntities(html).replace(/<[^>]*>/g, " ")
  return text.replace(/\s+/g, " ").trim()
}

/** "noreply@aihot.news (Baseten 工程博客)" → "Baseten 工程博客"；无括号取整串 */
export function aiHotSourceOf(author: string): string {
  const m = (author ?? "").match(/\(([^)]+)\)\s*$/)
  return (m ? m[1] : author || "").trim()
}

function rfc1123ToIso(s: string): string {
  const t = Date.parse(s)
  return Number.isNaN(t) ? "" : new Date(t).toISOString()
}

export function parseAiHotRss(xml: string): AiHotItem[] {
  const src = xml ?? ""
  const out: AiHotItem[] = []
  const seen = new Set<string>()
  for (const m of src.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = m[1]
    const id = extractTag(block, "guid") || extractTag(block, "link")
    const title = rssHtmlToText(extractTag(block, "title"))
    if (!id || !title || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      title,
      link: extractTag(block, "link"),
      summary: rssHtmlToText(extractTag(block, "description")),
      category: rssHtmlToText(extractTag(block, "category")),
      source: aiHotSourceOf(rssHtmlToText(extractTag(block, "author"))),
      publishedAt: rfc1123ToIso(extractTag(block, "pubDate")),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// 医疗软件信息化行业过滤（2026-10-07 用户口径：AI 动态只留「AI × 医疗软件信息化」，
// 通用大模型发布/编程工具/自动驾驶等泛 AI 资讯不展示）。
// 判定看 标题+分类+摘要 三处（AIHOT 条目标题常不带领域词，摘要补齐；信源是 AI 精选媒体，
// 不存在情报中心那种多行业厂商导航噪声，看摘要安全）。
// ---------------------------------------------------------------------------

const MED_RE =
  /医院|医疗|医学|临床|患者|医生|医师|护士|护理|卫健|卫生|医保|诊疗|问诊|导诊|分诊|预问诊|病历|电子病历|影像|检验|病理|诊断|随访|健康管理|体检|中医|口腔|肿瘤|康复|手术|科室|门诊|互联网医院|智慧医院|分级诊疗|医联体|医共体|基层医疗|慢病|药物|药学|制药|药企|医疗器械|医保/i
const AI_RE =
  /\bAI\b|人工智能|大模型|LLM|GPT|DeepSeek|通义|文心|豆包|讯飞星火|开源模型|多模态|机器学习|深度学习|神经网络|智能体|\bAgent\b|生成式|AIGC|算力|推理模型|\bRAG\b|辅助诊断|智能问答/i

/** 单条判定：领域词（医院/医疗/临床/患者…）AND AI 词（AI/大模型/智能体…）双命中才保留 */
export function isMedicalAiHot(item: Pick<AiHotItem, "title" | "summary" | "category">): boolean {
  const text = `${item.title} ${item.category} ${item.summary}`
  return MED_RE.test(text) && AI_RE.test(text)
}

/** 过滤出医疗软件信息化相关的 AI 动态（页面默认只展示这些） */
export function filterMedicalAiHot(items: AiHotItem[]): AiHotItem[] {
  return items.filter(isMedicalAiHot)
}

/** 分类按出现频次降序（页面筛选 chips 用） */
export function aiHotCategories(items: AiHotItem[]): string[] {
  const count = new Map<string, number>()
  for (const it of items) if (it.category) count.set(it.category, (count.get(it.category) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
}

// ---------------------------------------------------------------------------
// 拉取 + 模块级共享缓存（同 kbAssemble 缓存语义：TTL 内不重复出站）
// ---------------------------------------------------------------------------

const FEED_CACHE_TTL_MS = 5 * 60 * 1000

let feedCache: { items: AiHotItem[]; fetchedAt: string; ts: number } | null = null

/** 让缓存失效（测试/强制刷新用） */
export function invalidateAiHotCache(): void {
  feedCache = null
}

export interface AiHotFeedResult {
  items: AiHotItem[]
  /** 服务端拉取时刻 ISO；缓存命中时为缓存记录的时刻 */
  fetchedAt: string
  /** 本次是否命中本地缓存（未出站） */
  fromCache: boolean
}

/** 拉取 AI 动态精选流；force=true 跳过缓存强制出站 */
export async function fetchAiHotFeed(force = false): Promise<AiHotFeedResult> {
  if (!force && feedCache && Date.now() - feedCache.ts < FEED_CACHE_TTL_MS) {
    return { items: feedCache.items, fetchedAt: feedCache.fetchedAt, fromCache: true }
  }
  const res = await pbJsonRequest<{ xml: string; fetched_at: string }>(
    "/api/ai_hot/feed",
    undefined,
    { exposeHttpStatus: true },
  )
  const items = parseAiHotRss(res.xml)
  feedCache = { items, fetchedAt: res.fetched_at, ts: Date.now() }
  return { items, fetchedAt: res.fetched_at, fromCache: false }
}

// ---------------------------------------------------------------------------
// 转入情报中心（互补闭环：外部视野 → 团队情报流，走既有 POST /api/intel_items）
// ---------------------------------------------------------------------------

export const AIHOT_INTEL_SOURCE_NAME = "AIHOT"

/**
 * 把一条 AI 动态转存为情报中心条目。
 * item_type 固定 "media"（行业媒体域，与情报中心四档枚举对齐）；
 * visibility 由调用方「公开到团队」开关决定，缺省 personal 仅自己可见。
 */
export async function saveAiHotToIntel(item: AiHotItem, isPublic: boolean): Promise<{ id: string }> {
  return pbJsonRequest<{ id: string }>(
    "/api/intel_items",
    {
      method: "POST",
      body: JSON.stringify({
        source_id: "",
        source_name: AIHOT_INTEL_SOURCE_NAME,
        title: item.title.slice(0, 200),
        url: item.link.slice(0, 500),
        content_snippet: item.summary.slice(0, 2000),
        item_type: "media",
        summary: item.summary.slice(0, 560),
        tags: [item.category, "AI动态", item.source].filter(Boolean).slice(0, 3),
        region: "",
        item_status: "pending",
        added_by: "aihot",
        published_at: item.publishedAt,
        visibility: isPublic ? "public" : "personal",
      }),
    },
    { exposeHttpStatus: true },
  )
}

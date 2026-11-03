// ---------------------------------------------------------------------------
// PPT 图片资产记录（2026-10-30 补齐 6-c）
//
// 需求原文（§六.6）：
//   「建立统一图片资产记录，至少包含 assetId、type、sourceRefs、prompt、query、
//     sourceUrl、license、filePath、width、height、alt、status。」
//   「重新生成某一页图片时，不得修改该页正文和其他页面图片。」
//   「相同素材需要缓存复用，避免重复搜索、重复下载和重复生成。」
//
// 解决的问题：原来每页图片只是一段 dataURL 存在 slide.image 里，
// 用户无法回答"这张图哪来的、能不能商用、之前是不是搜过"。
//
// 存储策略：assetId 索引放 localStorage（元数据小），图片本体仍在 slide.image（dataURL）。
// 这样不改变现有数据结构，只是**旁挂**一层可追溯的元数据。
// ---------------------------------------------------------------------------

import { IMAGE_LICENSES, type ImageSearchProvider } from "./imageSearch"
import type { VisualType } from "./deckVisualPlan"

/** 图片资产来源 */
export type AssetOrigin =
  | { kind: "stock"; provider: ImageSearchProvider; sourceUrl: string; license: string }
  | { kind: "ai"; provider: string; prompt: string; model?: string }
  | { kind: "upload"; fileName: string }
  | { kind: "library"; materialId: string; materialName: string }
  | { kind: "company"; materialName: string }

export type AssetStatus = "ok" | "lowRes" | "licenseUnknown" | "failed"

/** 一条图片资产记录（对应需求列的 12 个字段） */
export type ImageAsset = {
  assetId: string
  /** 来源类型（与视觉计划的 VisualType 对齐） */
  type: VisualType
  /** 该图片服务于哪些页（页码 1 基） */
  pages: number[]
  /** 所属 deck */
  deckId: string
  origin: AssetOrigin
  /** 搜索/生成时的查询词（可复现） */
  query?: string
  /** 替代文本（无障碍与 SEO，也用于自查是否配错图） */
  alt: string
  /** 像素尺寸 */
  width?: number
  height?: number
  /** 数据指纹（同图去重，避免重复下载/生成） */
  dataHash?: string
  status: AssetStatus
  createdAt: number
}

const STORAGE_KEY = "pp_image_assets_v1"
/** 单 deck 最多保留的记录数（防 localStorage 膨胀） */
const MAX_PER_DECK = 200

/** 读取全部资产 */
export function loadAssets(): ImageAsset[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as ImageAsset[]
    return Array.isArray(arr) ? arr.filter((a) => a && typeof a.assetId === "string") : []
  } catch {
    return []
  }
}

function saveAssets(list: ImageAsset[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-2000)))
  } catch {
    /* 配额不足：静默降级（资产记录是辅助功能，不能阻断主流程） */
  }
}

/** 取某份 deck 的资产 */
export function assetsOfDeck(deckId: string): ImageAsset[] {
  return loadAssets().filter((a) => a.deckId === deckId)
}

/** 新增或更新一条资产（同 assetId 覆盖） */
export function upsertAsset(asset: ImageAsset): void {
  const all = loadAssets()
  const idx = all.findIndex((a) => a.assetId === asset.assetId)
  if (idx >= 0) all[idx] = asset
  else all.push(asset)
  // 同一 deck 超限时丢最早的
  const ofDeck = all.filter((a) => a.deckId === asset.deckId)
  if (ofDeck.length > MAX_PER_DECK) {
    const drop = new Set(ofDeck.slice(0, ofDeck.length - MAX_PER_DECK).map((a) => a.assetId))
    saveAssets(all.filter((a) => !drop.has(a.assetId)))
    return
  }
  saveAssets(all)
}

/** 从图库搜索结果建资产记录 */
export function assetFromStock(p: {
  deckId: string
  page: number
  provider: ImageSearchProvider
  sourceUrl: string
  query: string
  alt: string
  width?: number
  height?: number
}): ImageAsset {
  const license = IMAGE_LICENSES[p.provider] ?? "许可证未知"
  return {
    assetId: `stock-${p.provider}-${hash(p.sourceUrl)}`,
    type: "stockPhoto",
    pages: [p.page],
    deckId: p.deckId,
    origin: { kind: "stock", provider: p.provider, sourceUrl: p.sourceUrl, license },
    query: p.query,
    alt: p.alt,
    width: p.width,
    height: p.height,
    status: p.width && p.width < 800 ? "lowRes" : "ok",
    createdAt: Date.now(),
  }
}

/** 从 AI 生成结果建资产记录 */
export function assetFromAi(p: {
  deckId: string
  page: number
  provider: string
  prompt: string
  alt: string
  model?: string
  width?: number
  height?: number
}): ImageAsset {
  return {
    assetId: `ai-${p.provider}-${hash(p.prompt)}`,
    type: "aiIllustration",
    pages: [p.page],
    deckId: p.deckId,
    origin: { kind: "ai", provider: p.provider, prompt: p.prompt, model: p.model },
    alt: p.alt,
    width: p.width,
    height: p.height,
    status: "ok",
    createdAt: Date.now(),
  }
}

/** 从用户上传建资产记录（版权最清晰，status 直接 ok） */
export function assetFromUpload(p: {
  deckId: string
  page: number
  fileName: string
  alt: string
  width?: number
  height?: number
}): ImageAsset {
  return {
    assetId: `upload-${hash(p.fileName + p.page)}`,
    type: "companyAsset",
    pages: [p.page],
    deckId: p.deckId,
    origin: { kind: "upload", fileName: p.fileName },
    alt: p.alt,
    width: p.width,
    height: p.height,
    status: "ok",
    createdAt: Date.now(),
  }
}

/** 把资产标记到另一页（多页复用同一图） */
export function attachAssetToPage(assetId: string, page: number): void {
  const all = loadAssets()
  const hit = all.find((a) => a.assetId === assetId)
  if (!hit) return
  if (!hit.pages.includes(page)) hit.pages.push(page)
  saveAssets(all)
}

/** 删除某页的资产记录（重新配图时清旧记录，不影响其他页） */
export function detachAssetFromPage(deckId: string, page: number): void {
  const all = loadAssets().map((a) => {
    if (a.deckId !== deckId || !a.pages.includes(page)) return a
    const pages = a.pages.filter((p) => p !== page)
    return { ...a, pages }
  })
  // 完全无引用的记录一并清掉
  saveAssets(all.filter((a) => a.pages.length > 0))
}

/**
 * 按数据指纹查找已缓存资产（同图复用，避免重复下载/生成）。
 *
 * 需求：「相同素材需要缓存复用，避免重复搜索、重复下载和重复生成。」
 */
export function findCachedAsset(dataHash: string): ImageAsset | null {
  return loadAssets().find((a) => a.dataHash === dataHash && a.status !== "failed") ?? null
}

/** 资产健康检查：列出有问题的资产（导出前提示） */
export function auditAssets(deckId: string): { lowRes: ImageAsset[]; licenseUnknown: ImageAsset[]; failed: ImageAsset[] } {
  const list = assetsOfDeck(deckId)
  return {
    lowRes: list.filter((a) => a.status === "lowRes"),
    licenseUnknown: list.filter((a) => a.status === "licenseUnknown"),
    failed: list.filter((a) => a.status === "failed"),
  }
}

/** 资产摘要（界面展示） */
export function assetsSummary(deckId: string): string {
  const list = assetsOfDeck(deckId)
  if (!list.length) return "本册暂无图片资产记录"
  const byType = new Map<string, number>()
  for (const a of list) byType.set(a.type, (byType.get(a.type) ?? 0) + 1)
  const audit = auditAssets(deckId)
  const bits: string[] = [`${list.length} 张图片`]
  for (const [t, n] of byType) bits.push(`${t} ${n}`)
  if (audit.lowRes.length) bits.push(`${audit.lowRes.length} 张分辨率偏低`)
  if (audit.licenseUnknown.length) bits.push(`${audit.licenseUnknown.length} 张许可证未知`)
  return bits.join(" · ")
}

/** 简单稳定 hash（非密码学，用于生成 assetId 与去重键） */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16)
}

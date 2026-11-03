// 素材库纯函数（R-008）：文件名解析 / 哈希 / 压缩 / 与 PPT imageHint 的本地命中打分。
// 浏览器能力（canvas/crypto）包在显式函数里，纯逻辑部分可在 node 单测。
// PPT 生成命中素材库的取图顺序：①本地素材库 → ②实时搜图 → ③留空（需求提示词 §4）。

import type { MaterialItem } from "./materialTypes"

// ---------- 文件名解析（命名规范：来源_内容_日期.jpg，如 pexels_医院走廊_20261008.jpg） ----------

const DATE_LIKE = /^(\d{8}|\d{4}-?\d{2}-?\d{2})$/

/** 从文件名去扩展名、去尾部日期段，得到素材名 */
export function parseNameFromFileName(fileName: string): string {
  const base = String(fileName || "").replace(/\.[^.]+$/, "").trim()
  const segs = base.split(/[_\-\s]+/).filter(Boolean)
  while (segs.length > 1 && DATE_LIKE.test(segs[segs.length - 1])) segs.pop()
  return segs.join(" ").slice(0, 80) || "未命名素材"
}

/** 从文件名解析标签：保留内容词，丢日期与单字符，最多 6 个 */
export function parseTagsFromFileName(fileName: string): string[] {
  const base = String(fileName || "").replace(/\.[^.]+$/, "")
  const segs = base.split(/[_\-\s]+/).filter(Boolean)
  const tags: string[] = []
  for (const seg of segs) {
    if (DATE_LIKE.test(seg)) continue
    if ([...seg].length < 2) continue
    if (tags.includes(seg)) continue
    tags.push(seg)
    if (tags.length >= 6) break
  }
  return tags
}

export function guessOrientation(w: number, h: number): "landscape" | "portrait" | "square" {
  if (!w || !h) return "landscape"
  const diff = w / h
  if (diff > 1.05) return "landscape"
  if (diff < 0.95) return "portrait"
  return "square"
}

export function formatBytes(n: number): string {
  const v = Number(n) || 0
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
  return `${(v / 1024 / 1024).toFixed(2)} MB`
}

// ---------- dataURL / 哈希 ----------

/** dataURL 的二进制字节数（base64 段 3/4 折算，扣 padding） */
export function dataUrlBytes(dataUrl: string): number {
  const idx = String(dataUrl || "").indexOf(",")
  if (idx < 0) return 0
  const b64 = dataUrl.slice(idx + 1)
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0
  return Math.max(Math.floor((b64.length * 3) / 4) - padding, 0)
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const idx = String(dataUrl || "").indexOf(",")
  const b64 = idx >= 0 ? dataUrl.slice(idx + 1) : String(dataUrl || "")
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** sha256 hex（crypto.subtle 原生，浏览器与 Node18+ 均可） */
export async function sha256HexFromBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export async function sha256HexFromDataUrl(dataUrl: string): Promise<string> {
  return sha256HexFromBytes(dataUrlToBytes(dataUrl))
}

// ---------- 浏览器：解码 / 压缩 / 缩略图 ----------

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("图片解码失败"))
    img.src = src
  })
}

function drawToDataUrl(img: HTMLImageElement, maxEdge: number, quality: number): { dataUrl: string; width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(Math.round(img.naturalWidth * scale), 1)
  const h = Math.max(Math.round(img.naturalHeight * scale), 1)
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("无法创建画布")
  // 白底：架构图/截图常有透明区，转 JPEG 前铺底避免黑块
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return { dataUrl: canvas.toDataURL("image/jpeg", quality), width: w, height: h }
}

/** 缩略图：长边 400px（需求提示词 §1 硬性要求），JPEG 供网格快速渲染 */
export async function makeThumbDataUrl(dataUrl: string): Promise<string> {
  const img = await loadImageElement(dataUrl)
  return drawToDataUrl(img, 400, 0.7).dataUrl
}

/**
 * 入库原图体积收敛：≤6MB（与 uploadSlideImage 同限）直接用原 dataURL；
 * 超限先压长边 2200，再不行压 1400，仍超限报错（架构图导出大图场景）。
 */
export async function normalizeImageDataUrl(dataUrl: string): Promise<{ dataUrl: string; width: number; height: number; bytes: number }> {
  const MAX = 6 * 1024 * 1024
  const img = await loadImageElement(dataUrl)
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (dataUrlBytes(dataUrl) <= MAX) {
    return { dataUrl, width: w, height: h, bytes: dataUrlBytes(dataUrl) }
  }
  for (const [edge, q] of [[2200, 0.85], [1400, 0.75]] as const) {
    const shrunk = drawToDataUrl(img, edge, q)
    if (dataUrlBytes(shrunk.dataUrl) <= MAX) {
      return { dataUrl: shrunk.dataUrl, width: shrunk.width, height: shrunk.height, bytes: dataUrlBytes(shrunk.dataUrl) }
    }
  }
  throw new Error("图片过大（压缩后仍 >6MB），请手动缩小后再入库")
}

// ---------- PPT 本地命中打分（需求提示词 §4：imageHint + 标题 + 首条要点 匹配 name/tags/category） ----------

/** 抽检索词：CJK 连续段切二元组 + 拉丁/数字词（≥2 字符），去重 */
export function extractQueryTokens(...texts: string[]): string[] {
  const joined = texts.filter(Boolean).join(" ").toLowerCase()
  const tokens = new Set<string>()
  for (const word of joined.match(/[a-z0-9]{2,}/g) || []) tokens.add(word)
  for (const run of joined.match(/[\u4e00-\u9fff]+/g) || []) {
    if ([...run].length === 1) { tokens.add(run); continue }
    const chars = [...run]
    for (let i = 0; i < chars.length - 1; i++) tokens.add(chars[i] + chars[i + 1])
  }
  return [...tokens]
}

export type LocalMaterialPick = { item: MaterialItem; score: number }

/**
 * 本地命中打分：name 命中 +3 / tag 整词 +2 / tag 或分类部分命中 +1。
 * 阈值 ≥3（避免「平台」这类泛词误命中），按分排序取前 limit 条。
 */
export function matchMaterials(imageHint: string, title: string, firstBullet: string, items: MaterialItem[], limit = 3): LocalMaterialPick[] {
  const tokens = extractQueryTokens(imageHint, title, firstBullet)
  if (!tokens.length) return []
  const picks: LocalMaterialPick[] = []
  for (const item of items) {
    if (item.trashed) continue
    const name = (item.name || "").toLowerCase()
    const tags = (item.tags || []).map((t) => (t || "").toLowerCase())
    const category = (item.category || "").toLowerCase()
    let score = 0
    for (const token of tokens) {
      if (name.includes(token)) score += 3
      if (tags.includes(token)) score += 2
      else if (tags.some((t) => t.includes(token) && token.length >= 2)) score += 1
      if (category.includes(token)) score += 1
    }
    if (score >= 3) picks.push({ item, score })
  }
  return picks.sort((a, b) => b.score - a.score || (b.item.usage || 0) - (a.item.usage || 0)).slice(0, limit)
}

// ---------------------------------------------------------------------------
// PPT 素材库客户端（2026-10-30 补齐：把 deckMaterials 接进生成流程）
//
// 解决的问题：`deckMaterials.ts` 有完整的分块/检索/冲突检测能力，
// 但 usePptQuote 里 0 处调用 → 生成时素材全文塞提示词、sourceRefs 永远为空。
//
// 本文件负责「素材文件 → 可选素材库」的会话级管理：
//   · 上传解析（docx/pdf/pptx/xlsx/txt）→ 分块建索引
//   · 每页生成前按「标题+意图」检索相关片段 → 转 sourceRefs
//   · 冲突检测结果供界面提示
//
// 存储策略：只在内存 + sessionStorage 存**素材文本**（不落库，避免污染集合）。
// 理由：PPT 素材是一次性上下文，不像知识库需要长期治理；落库反而要清理。
// ---------------------------------------------------------------------------

import {
  buildLibrary,
  detectConflicts,
  librarySummary,
  parseMaterialFile,
  refsForSlide,
  type ConflictHit,
  type MaterialDoc,
  type MaterialLibrary,
} from "@/pages/PptQuote/deckMaterials"
import type { SourceRefZ } from "@/pages/PptQuote/deckSchema"

const STORAGE_KEY = "pp_materials_v1"

/** 一份可用的素材（界面展示用） */
export type MaterialItem = {
  id: string
  name: string
  kind: "content" | "visual"
  charCount: number
  chunkCount: number
  warnings: string[]
}

export type MaterialState = {
  items: MaterialItem[]
  /** 冲突（素材间数据打架，提示用户确认） */
  conflicts: ConflictHit[]
  /** 摘要（"内容素材 2 份（1.2 万字）…"） */
  summary: string
  /** 加载中 */
  busy: boolean
  /** 最近一次错误 */
  error: string | null
}

/** 内存中的素材库（会话级；刷新浏览器后从 sessionStorage 恢复文本再重建索引） */
let lib: MaterialLibrary | null = null

/** 把 MaterialDoc 裁成可持久化的最小形态（只留文本，索引重建） */
type PersistedDoc = { id: string; name: string; kind: "content" | "visual"; text: string; warnings: string[] }

function persist(docs: PersistedDoc[]): void {
  try {
    // 只存前 3 份、每份最多 6 万字，避免超 sessionStorage 配额
    const trimmed = docs.slice(0, 3).map((d) => ({ ...d, text: d.text.slice(0, 60_000) }))
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    /* 配额不足/隐私模式：静默降级为纯内存 */
  }
}

function restore(): MaterialDoc[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as PersistedDoc[]
    if (!Array.isArray(arr)) return []
    // 恢复时重新分块（chunkText 是纯函数，成本很低）
    return arr.map((d) => {
      const chunks: MaterialDoc["chunks"] = []
      // 复用 buildLibrary 内部的分块逻辑：直接构造空 chunks 再让 buildLibrary 处理不行，
      // 所以这里调用方需保证 doc.chunks 已就绪 → 用 chunkTextFromText 兜底
      return { ...d, chunks, charCount: d.text.length }
    })
  } catch {
    return []
  }
}

/** 从 sessionStorage 恢复并重建索引（页面加载时调一次） */
export function restoreLibrary(): MaterialLibrary | null {
  const docs = restore()
  if (!docs.length) return null
  // 恢复的 docs 没有 chunks，用 parseMaterialFile 的等价路径重建
  lib = buildLibraryFromTexts(docs)
  return lib
}

/** 从「纯文本 + 元信息」直接建库（恢复/测试用，跳过文件解析） */
export function buildLibraryFromTexts(
  docs: { id: string; name: string; kind: "content" | "visual"; text: string; warnings?: string[] }[],
): MaterialLibrary {
  const full: MaterialDoc[] = docs.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    text: d.text,
    chunks: [],
    warnings: d.warnings ?? [],
    charCount: d.text.length,
  }))
  // buildLibrary 会根据 doc.chunks 建索引；chunks 为空则没索引 → 这里手动补分块
  for (const d of full) {
    d.chunks = chunkOf(d.text, d.id, d.name)
  }
  const built = buildLibrary(full)
  // 关键：赋值给模块级 lib，否则 attachSourceRefs/hasMaterials 读不到这份素材
  lib = built
  return built
}

/** 内联分块（与 deckMaterials.chunkText 同规则，避免循环依赖导出问题） */
function chunkOf(text: string, materialId: string, materialName: string): MaterialDoc["chunks"] {
  const CHUNK_MAX = 600
  const lines = String(text ?? "").split("\n")
  const out: MaterialDoc["chunks"] = []
  let buf: string[] = []
  let len = 0
  let heading: string | undefined
  const flush = () => {
    const body = buf.join("\n").trim()
    if (body) {
      out.push({ id: `${materialId}#${out.length}`, materialId, materialName, index: out.length, text: body.slice(0, CHUNK_MAX), ...(heading ? { heading } : {}) })
    }
    buf = []
    len = 0
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (/^(第[一二三四五六七八九十]+[章节部分]|[一二三四五六七八九十]+[、.]|\d+(\.\d+)*[、.\s])/.test(line.slice(0, 40))) {
      flush()
      heading = line.slice(0, 40)
      buf.push(line)
      len = line.length
      continue
    }
    buf.push(line)
    len += line.length
    if (len >= 400) flush()
  }
  flush()
  return out
}

/** 上传并解析素材文件（支持多选，逐个追加） */
export async function addMaterialFiles(
  files: File[],
  kind: "content" | "visual" = "content",
): Promise<{ added: MaterialItem[]; errors: string[] }> {
  const added: MaterialItem[] = []
  const errors: string[] = []
  const current = lib?.docs ?? []
  const next: MaterialDoc[] = [...current]

  for (const f of files) {
    try {
      const doc = await parseMaterialFile(f, kind)
      if (doc.charCount < 50) {
        errors.push(`${f.name}：几乎没提取到文字（可能是扫描件），已跳过`)
        continue
      }
      next.push(doc)
      added.push({
        id: doc.id,
        name: doc.name,
        kind: doc.kind,
        charCount: doc.charCount,
        chunkCount: doc.chunks.length,
        warnings: doc.warnings,
      })
    } catch (e) {
      errors.push(`${f.name}：${e instanceof Error ? e.message : "解析失败"}`)
    }
  }

  if (added.length) {
    lib = buildLibrary(next)
    persist(next.map((d) => ({ id: d.id, name: d.name, kind: d.kind, text: d.text, warnings: d.warnings })))
  }
  return { added, errors }
}

/** 移除一份素材 */
export function removeMaterial(id: string): void {
  if (!lib) return
  const next = lib.docs.filter((d) => d.id !== id)
  lib = next.length ? buildLibrary(next) : null
  persist(next.map((d) => ({ id: d.id, name: d.name, kind: d.kind, text: d.text, warnings: d.warnings })))
}

/** 清空素材 */
export function clearMaterials(): void {
  lib = null
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** 当前素材状态（界面渲染用） */
export function getMaterialState(): MaterialState {
  if (!lib) {
    return { items: [], conflicts: [], summary: "", busy: false, error: null }
  }
  return {
    items: lib.docs.map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      charCount: d.charCount,
      chunkCount: d.chunks.length,
      warnings: d.warnings,
    })),
    conflicts: detectConflicts(lib),
    summary: librarySummary(lib),
    busy: false,
    error: null,
  }
}

/** 是否已有可用素材 */
export function hasMaterials(): boolean {
  return Boolean(lib && lib.docs.length)
}

/**
 * 为一大纲页检索素材 → sourceRefs。
 *
 * 这是「素材检索接入生成流程」的关键函数：
 * 生成前对每页调用一次，把召回的片段写进 plan.sourceRefs，
 * 逐页生成时只塞这几段（不塞全文），且落库后可追溯到具体素材段落。
 */
export function attachSourceRefs<T extends { title: string; intent?: string }>(
  plan: T[],
  topK = 3,
): (T & { sourceRefs?: SourceRefZ[] })[] {
  const current = lib
  if (!current) return plan
  return plan.map((p) => {
    const refs = refsForSlide(current, p.title, p.intent ?? "", topK)
    return refs.length ? { ...p, sourceRefs: refs } : p
  })
}

/** 素材库整体摘要（无素材时返回空串） */
export function materialLibrarySummary(): string {
  const current = lib
  return current ? librarySummary(current) : ""
}

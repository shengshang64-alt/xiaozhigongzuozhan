import { decodeRhToken } from "@/lib/rhLogin"
import { assembleAtomContext } from "@/lib/kbAtomAssemble"
import type { ChecklistLine } from "./checklistTypes"
import {
  MAX_STANDARD_MODULES,
  buildStandardChapterPreview,
  checkedChecklistLines,
  moduleKeyOf,
  moduleQueryOf,
  type ChapterSource,
  type StandardChapterPreview,
} from "./standardChapters"

// ---------------------------------------------------------------------------
// 按模块检索已审核知识原子（可注入 search，单测不打网络）。
// 检索失败时该模块记为缺项，不调用模型补写。
// ---------------------------------------------------------------------------

export type ModuleSourceSearch = (query: string) => Promise<ChapterSource[]>

const POOL = 3

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const cur = i
      i += 1
      out[cur] = await fn(items[cur])
    }
  })
  await Promise.all(workers)
  return out
}

export function defaultAtomSearch(userId: string | null): ModuleSourceSearch {
  return async (query: string) => {
    const res = await assembleAtomContext(userId, {
      query,
      usableFor: "proposal",
      topN: 6,
    })
    return res.hits.map((h) => ({
      kind: "atom" as const,
      id: h.atomId,
      title: h.title,
      docName: h.docName || h.title,
      quote: h.sourceQuote || "",
      body: h.body || h.sourceQuote || "",
      anchor: h.sourceAnchor || undefined,
    }))
  }
}

export async function collectStandardChapters(
  lines: ChecklistLine[],
  opts: {
    typeKey?: string
    title?: string
    search?: ModuleSourceSearch
    userId?: string | null
    maxModules?: number
  } = {},
): Promise<StandardChapterPreview> {
  const search = opts.search ?? defaultAtomSearch(opts.userId ?? decodeRhToken()?.sub ?? null)
  const max = opts.maxModules ?? MAX_STANDARD_MODULES
  const picked = checkedChecklistLines(lines).slice(0, max)
  const moduleSources: Record<string, ChapterSource[]> = {}
  await mapPool(picked, POOL, async (line) => {
    const key = moduleKeyOf(line)
    try {
      moduleSources[key] = await search(moduleQueryOf(line))
    } catch {
      moduleSources[key] = []
    }
  })
  return buildStandardChapterPreview({
    lines,
    moduleSources,
    typeKey: opts.typeKey,
    title: opts.title,
    maxModules: max,
  })
}

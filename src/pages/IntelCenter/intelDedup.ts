// 情报同题聚合（2026-11-02）：只合并展示，不删除任何库内记录。
// 同 URL 必为一组；归一化标题 + 同类型为一组。跨源转载保留来源清单与最完整的摘要/结构化字段。
import type { IntelItemRow } from "./useIntelCenter"

export type IntelDisplayItem = IntelItemRow & {
  duplicate_count?: number
  duplicate_sources?: string[]
}

export function normalizeIntelTitle(title: string): string {
  return String(title || "")
    .toLowerCase()
    .replace(/[【】（）()「」『』《》〈〉]/g, "")
    .replaceAll("[", "")
    .replaceAll("]", "")
    .replace(/[\s—–_·•|｜,，.。;；:：!！?？'"“”‘’-]/g, "")
    .trim()
}

function normalizedUrl(url: string): string {
  return String(url || "").trim().replace(/^https?:\/\//i, "").replace(/[?#].*$/, "").replace(/\/$/, "")
}

function mergeInto(base: IntelDisplayItem, other: IntelItemRow): void {
  base.duplicate_count = (base.duplicate_count ?? 1) + 1
  const names = new Set([base.source_name, ...(base.duplicate_sources ?? []), other.source_name].filter(Boolean))
  base.duplicate_sources = [...names]
  if (!base.summary || (other.summary?.length ?? 0) > base.summary.length) base.summary = other.summary
  if (!base.region && other.region) base.region = other.region
  if (!base.content_snippet || (other.content_snippet?.length ?? 0) > base.content_snippet.length) {
    base.content_snippet = other.content_snippet
  }
  const tags = new Set([...(base.tags ?? []), ...(other.tags ?? [])])
  base.tags = [...tags]
  if (other.structured) {
    const merged: Record<string, string | undefined> = { ...(base.structured ?? {}) }
    for (const [key, value] of Object.entries(other.structured)) {
      if (!merged[key] && value) merged[key] = value
    }
    base.structured = merged
  }
}

export function groupIntelItems(items: IntelItemRow[]): IntelDisplayItem[] {
  const byUrl = new Map<string, IntelDisplayItem>()
  const byTitle = new Map<string, IntelDisplayItem>()
  const out: IntelDisplayItem[] = []
  for (const item of items) {
    const uk = normalizedUrl(item.url)
    const tk = `${item.item_type || "other"}|${normalizeIntelTitle(item.title)}`
    const existing = (uk && byUrl.get(uk)) || (normalizeIntelTitle(item.title) && byTitle.get(tk))
    if (existing) {
      mergeInto(existing, item)
      if (uk) byUrl.set(uk, existing)
      if (normalizeIntelTitle(item.title)) byTitle.set(tk, existing)
      continue
    }
    const display: IntelDisplayItem = { ...item }
    out.push(display)
    if (uk) byUrl.set(uk, display)
    if (normalizeIntelTitle(item.title)) byTitle.set(tk, display)
  }
  return out
}

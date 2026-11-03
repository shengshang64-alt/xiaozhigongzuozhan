// 循环 9 C1：知识库「最近删除」本地回收桶（纯前端零服务端）——
// 删除成功后把文档快照写 localStorage（按账号隔离），仅本机浏览器可恢复；上限 20 条 FIFO。
export type KbTrashItem = {
  trashed_at: string
  doc_id: string
  title: string
  folder_path: string
  content: string
  doc_format: string
  visibility: string
  summary: string
  keywords: string[]
  source_file_name: string
  doc_category?: string
}

const TRASH_MAX = 20

function trashKey(userId: string): string {
  return `kb_trash_${userId}`
}

export function readKbTrash(userId: string | null): KbTrashItem[] {
  if (!userId) return []
  try {
    const raw = localStorage.getItem(trashKey(userId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as KbTrashItem[]) : []
  } catch {
    return []
  }
}

function writeKbTrash(userId: string, items: KbTrashItem[]): void {
  try {
    localStorage.setItem(trashKey(userId), JSON.stringify(items))
  } catch (e) {
    // 配额超 / 隐私模式：静默降级为不存桶，不影响删除主流程
    console.warn("kb trash write skipped", e)
  }
}

/** 删除成功后入桶（新条目置顶，超 20 条丢弃最旧）；未登录不落桶 */
export function pushKbTrash(userId: string | null, snapshot: Omit<KbTrashItem, "trashed_at">): void {
  if (!userId) return
  const items = readKbTrash(userId)
  items.unshift({ ...snapshot, trashed_at: new Date().toISOString() })
  writeKbTrash(userId, items.slice(0, TRASH_MAX))
}

/** 从桶内移除（恢复或彻底删除后调用） */
export function removeKbTrash(userId: string | null, trashedAt: string): void {
  if (!userId) return
  writeKbTrash(userId, readKbTrash(userId).filter((t) => t.trashed_at !== trashedAt))
}

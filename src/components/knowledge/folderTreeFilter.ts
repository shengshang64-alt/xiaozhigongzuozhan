// P2-2（2026-10-25）：目录树整备——树内搜索过滤 + 展开状态记忆。
// 纯函数与存储助手抽在本文件供单测；UI 接线在 FolderTree.tsx。
import type { FolderNode } from "@/pages/Knowledge/useKnowledge"

/**
 * 按目录名（大小写不敏感子串）过滤树：命中节点保留**整棵子树**（目录搜索的目的就是
 * 找到目标目录再进去，后代应当可见）；未命中但后代命中的保留祖先链；其余剪除。
 * 空查询原样返回同一引用（不触发重渲染语义）。
 */
export function filterFolderTree(root: FolderNode, query: string): FolderNode {
  const q = (query ?? "").trim().toLowerCase()
  if (!q) return root
  const walk = (node: FolderNode): FolderNode | null => {
    if ((node.label ?? "").toLowerCase().includes(q)) return node
    const kids: FolderNode[] = []
    for (const c of node.children) {
      const kept = walk(c)
      if (kept) kids.push(kept)
    }
    if (kids.length === 0) return null
    return { ...node, children: kids }
  }
  const kids: FolderNode[] = []
  for (const c of root.children) {
    const kept = walk(c)
    if (kept) kids.push(kept)
  }
  return { ...root, children: kids }
}

// ---------------------------------------------------------------------------
// 展开状态记忆（localStorage，按 用户×库 分桶）。存「用户主动碰过」的目录路径 → 展开
// 布尔；未记录的走默认规则（顶层展开、深层折叠）——只折叠过一个顶层目录不会连累
// 其它未触碰的顶层目录（首版用"展开集合"，写过一次后全部顶层被折叠，实测语义缺陷）。
// ---------------------------------------------------------------------------

const LS_PREFIX = "kb_folder_tree_expanded:"
const MAX_REMEMBERED = 500

function storageKey(scope: string): string {
  return LS_PREFIX + scope
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

/** 读取已记忆的展开状态映射（路径 → 是否展开）；无记录/脏值返回 null（走默认规则） */
export function readExpandedPrefs(scope: string): Record<string, boolean> | null {
  const st = safeLocalStorage()
  if (!st) return null
  try {
    const raw = st.getItem(storageKey(scope))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const out: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k] = v
    }
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

/** 记录一次展开/折叠（只更新该路径的状态，不牵动其它目录）；写失败静默 */
export function writeExpandedPref(scope: string, path: string, expanded: boolean): void {
  const st = safeLocalStorage()
  if (!st) return
  try {
    const cur = readExpandedPrefs(scope) ?? {}
    cur[path] = expanded
    const entries = Object.entries(cur).slice(-MAX_REMEMBERED)
    st.setItem(storageKey(scope), JSON.stringify(Object.fromEntries(entries)))
  } catch {
    /* 配额满/隐私模式：放弃本次记忆 */
  }
}

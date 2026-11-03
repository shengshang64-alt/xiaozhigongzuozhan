// 工作区标签页：状态规则 + 持久化（纯函数，零 DOM / 零依赖）
//
// 为什么单独一个文件：标签的"开/关/上限回收/持久化校验"是纯逻辑，值得脱离 React 单测
// （组件测试只能覆盖接线，规则边界如"上限回收绝不回收当前标签"用纯函数测更可靠）。
//
// 规则：
//  - 标签粒度 = 路由路径（本应用全是扁平顶层路径），同一路径只开一个标签
//  - items 顺序 = 打开顺序，激活不改变顺序（否则标签会来回跳，点一下就换位很难用）
//  - 回收依据单独记 touched（最近激活的排在队尾），超上限时回收"最久没用过且不是当前"的
//  - 关闭当前标签 → 激活右邻（没有则左邻）；永不关到空，保底回首页
//  - 持久化只存路径，读取时用 registry 校验：非法/已下线路由直接丢弃（防发版后残留死标签）

import { HOME_PATH, hasRoute } from "./routeRegistry"

/** 标签上限：超过后按最久未用回收（保活要占内存，必须有硬上限）。
 *  6 个：1600px 屏宽标签栏内可完整露出，再多就要横向滚动条，可读性骤降。 */
export const TAB_LIMIT = 6

/** 持久化键：换账号会在 resetForAccount 后重写 */
const STORAGE_KEY = "xz_workspace_tabs"

export type WorkspaceTabsState = {
  /** 已打开的标签路径（打开顺序，稳定不重排） */
  items: string[]
  /** 当前激活标签 */
  active: string
  /** 激活历史，队尾 = 最近激活（仅用于上限回收，不参与渲染顺序） */
  touched: string[]
}

/** 初始状态：只有当前路径（路径不合法时退回首页） */
export function initialTabs(path: string): WorkspaceTabsState {
  const first = hasRoute(path) ? path : HOME_PATH
  return { items: [first], active: first, touched: [first] }
}

/** 打开（或激活）一个标签 */
export function openTab(state: WorkspaceTabsState, path: string): WorkspaceTabsState {
  if (!hasRoute(path)) return state
  const items = state.items.includes(path) ? state.items : [...state.items, path]
  return { items: evict(items, path, state.touched, path), active: path, touched: touch(state.touched, path) }
}

/**
 * 上限回收：只在超出 TAB_LIMIT 时动，且**绝不回收当前激活标签**——
 * 回收正在看的页面等于把用户手上的活弄丢，宁可短暂超限。
 */
function evict(items: string[], active: string, touched: string[], justOpened: string): string[] {
  if (items.length <= TAB_LIMIT) return items
  const byRecency = [...touched].filter((p) => items.includes(p))
  // 补齐 touched 里可能缺失的项（历史数据/异常路径），按 items 顺序追加
  for (const p of items) if (!byRecency.includes(p)) byRecency.push(p)
  const candidates = byRecency.filter((p) => p !== active && p !== justOpened)
  const drop = candidates[0] ?? items.find((p) => p !== active && p !== justOpened)
  if (!drop) return items
  return items.filter((p) => p !== drop)
}

function touch(touched: string[], path: string): string[] {
  return [...touched.filter((p) => p !== path), path]
}

/** 关闭一个标签；关的是当前标签时激活右邻（没有则左邻） */
export function closeTab(state: WorkspaceTabsState, path: string): WorkspaceTabsState {
  if (!state.items.includes(path)) return state
  const idx = state.items.indexOf(path)
  const items = state.items.filter((p) => p !== path)
  const touched = state.touched.filter((p) => p !== path)
  if (items.length === 0) return { items: [HOME_PATH], active: HOME_PATH, touched: [HOME_PATH] }
  if (state.active !== path) return { items, active: state.active, touched }
  const next = items[Math.min(idx, items.length - 1)] ?? HOME_PATH
  return { items, active: next, touched: touched.includes(next) ? touched : [...touched, next] }
}

/** 关闭其他标签（保留 path 并激活） */
export function closeOtherTabs(state: WorkspaceTabsState, path: string): WorkspaceTabsState {
  const keep = state.items.includes(path) && hasRoute(path) ? path : state.active
  return { items: [keep], active: keep, touched: [keep] }
}

/** 全部关闭 → 回首页 */
export function closeAllTabs(): WorkspaceTabsState {
  return { items: [HOME_PATH], active: HOME_PATH, touched: [HOME_PATH] }
}

/** 关闭右侧标签（保留 path 及其左侧） */
export function closeTabsToRight(state: WorkspaceTabsState, path: string): WorkspaceTabsState {
  const idx = state.items.indexOf(path)
  if (idx < 0) return state
  const items = state.items.slice(0, idx + 1)
  const active = items.includes(state.active) ? state.active : path
  return { items, active, touched: state.touched.filter((p) => items.includes(p)) }
}

// ---------------------------------------------------------------------------
// 持久化（localStorage；读写全部 try/catch，坏数据一律丢弃而不是让壳崩掉）
// ---------------------------------------------------------------------------

/** 校验并规整任意持久化数据（非法路由/重复项/坏 active 一律丢弃）；坏数据返回 null。
 *  导出给 workspaceTabStore 复用，避免"两套校验"漂移。 */
export function sanitizeTabsState(raw: unknown): WorkspaceTabsState | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as { items?: unknown; active?: unknown; touched?: unknown }
  if (!Array.isArray(obj.items)) return null
  const items: string[] = []
  for (const v of obj.items) {
    if (typeof v !== "string" || !hasRoute(v) || items.includes(v)) continue
    if (items.length >= TAB_LIMIT) break
    items.push(v)
  }
  if (items.length === 0) return null
  const active = typeof obj.active === "string" && items.includes(obj.active) ? obj.active : items[items.length - 1]
  const touchedRaw = Array.isArray(obj.touched) ? obj.touched : []
  const touched = touchedRaw.filter((p): p is string => typeof p === "string" && items.includes(p))
  return { items, active, touched: touched.includes(active) ? touched : [...touched, active] }
}

/** 读取持久化标签；无/坏数据返回 null（由调用方决定用 initialTabs） */
export function loadTabs(): WorkspaceTabsState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return sanitizeTabsState(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveTabs(state: WorkspaceTabsState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 隐私模式/配额满：标签页退化为"当次会话内有效"，不打扰用户
  }
}

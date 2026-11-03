// 工作区标签的模块级存储（壳级单例）+ useSyncExternalStore 订阅
//
// 为什么不放在 React state 里：标签集合要跟着「路由变化」和「用户点击」两个来源走。若用
// useState + useEffect 同步路由，effect 里同步 setState 会撞 eslint 预算里的
// react-hooks/set-state-in-effect（该规则只许下降、不许新增），渲染期 setState 同理。
// 外部 store + useSyncExternalStore 是 React 官方推荐的"外部可变源"接法：路由同步放在
// layout effect 里调 ensureTab（不是 setState，不触发规则），点击类操作在事件处理里调；
// 订阅者由 store 通知重渲染。标签本来就是壳级单例，放模块里语义也最自然。
//
// 账号隔离：标签随登录账号走（换账号自动清空回当前页），存 localStorage 的键里带 uid，
// 避免 A 账号的标签被 B 账号恢复。同账号刷新则恢复上次标签（只恢复列表，内容由页面各自拉取）。

import { HOME_PATH, hasRoute } from "./routeRegistry"
import {
  type WorkspaceTabsState,
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  initialTabs,
  openTab,
  sanitizeTabsState,
} from "./workspaceTabs"

const STORAGE_KEY = "xz_workspace_tabs_v2"

type StoreState = { uid: string; tabs: WorkspaceTabsState }

const EMPTY: WorkspaceTabsState = { items: [HOME_PATH], active: HOME_PATH, touched: [HOME_PATH] }

let state: StoreState = { uid: "", tabs: EMPTY }
let hydrated = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

function persist(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 隐私模式/配额满：标签退化为当次会话有效，不打扰用户
  }
}

function setTabs(next: WorkspaceTabsState): void {
  // workspaceTabs 的规则函数都返回新对象；相同引用直接跳过，避免 useSyncExternalStore 无谓重渲染
  if (next === state.tabs) return
  state = { ...state, tabs: next }
  persist()
  emit()
}

/** 首次读取：从 localStorage 恢复（uid 一致才用，坏数据由 workspaceTabs.loadTabs 的校验兜掉） */
function hydrate(uid: string, pathname: string): void {
  if (hydrated && state.uid === uid) return
  hydrated = true
  let restored: WorkspaceTabsState | null = null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { uid?: unknown; tabs?: unknown }
      if (parsed && parsed.uid === uid) {
        // 复用 workspaceTabs 的同一套校验：非法路由/重复项/坏 active 一律丢弃
        restored = sanitizeTabsState(parsed.tabs)
      }
    }
  } catch {
    restored = null
  }
  state = { uid, tabs: restored ? openTab(restored, pathname) : initialTabs(pathname) }
  persist()
  emit()
}

// ---------------------------------------------------------------------------
// 对外 API
// ---------------------------------------------------------------------------

export function subscribeTabs(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getTabsSnapshot(): StoreState {
  return state
}

/** 路由同步 + 账号切换（在 layout effect 里调用；不是 setState，不触发 react-hooks 规则） */
export function ensureTab(uid: string, pathname: string): void {
  hydrate(uid, pathname)
  if (state.uid !== uid) {
    // 换账号：清空标签回到当前页，避免上一个账号的标签被继承（含其页面状态）
    state = { uid, tabs: initialTabs(pathname) }
    persist()
    emit()
    return
  }
  if (!hasRoute(pathname)) return // 未注册路径不建标签（内容区渲染 NotFound）
  setTabs(openTab(state.tabs, pathname))
}

/** 激活已打开的标签（点标签栏 / 供其它入口复用） */
export function activateTab(path: string): void {
  if (!hasRoute(path)) return
  setTabs(openTab(state.tabs, path))
}

export function closeTabAt(path: string): void {
  setTabs(closeTab(state.tabs, path))
}

export function closeOthersAt(path: string): void {
  setTabs(closeOtherTabs(state.tabs, path))
}

export function closeRightOf(path: string): void {
  setTabs(closeTabsToRight(state.tabs, path))
}

export function closeEveryTab(): void {
  setTabs(closeAllTabs())
}

/** 仅供测试：重置模块内部状态 */
export function __resetTabStoreForTest(): void {
  state = { uid: "", tabs: EMPTY }
  hydrated = false
  listeners.clear()
}

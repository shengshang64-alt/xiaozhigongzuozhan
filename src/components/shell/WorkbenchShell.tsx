import { createContext, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Toaster } from "sonner"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"
import { BackToTop } from "@/components/common/BackToTop"
import { decodeRhToken, type RhAccountInfo } from "@/lib/rhLogin"
import { TeamAuthGate } from "@/components/team-auth/TeamAuthGate"
import { hasRoute, labelFor } from "@/lib/routeRegistry"
import {
  activateTab,
  closeEveryTab,
  closeOthersAt,
  closeRightOf,
  closeTabAt,
  ensureTab,
  getTabsSnapshot,
  subscribeTabs,
} from "@/lib/workspaceTabStore"
import { SidebarNav } from "./SidebarNav"
import { TopBarShell } from "./TopBarShell"
import { FloatingAssistant } from "./FloatingAssistant"
import { TabbedOutlet } from "./TabbedOutlet"
import { WorkspaceTabs } from "./WorkspaceTabs"

/**
 * 壳级账号信息 context：RhAccountMenu 挂在壳顶栏，
 * 页面 View 可用 useContext(ShellAccountContext) 读取账号展示名。
 */
export const ShellAccountContext = createContext<RhAccountInfo | null>(null)

export function WorkbenchShell() {
  const [accountInfo, setAccountInfo] = useState<RhAccountInfo | null>(null)
  const [lastUserId, setLastUserId] = useState<string | null>(() => decodeRhToken()?.sub ?? null)
  // 登录态变化（登录/退出/切换账号）时 bump key，强制页面子树重挂载，
  // 各页 Logic hook 重新按新 token 初始化并拉取数据（不改动任何页面逻辑）。
  const [accountKey, setAccountKey] = useState(0)
  // 侧边栏折叠（对齐重构原型顶栏 ☰ 交互）
  // R93: 小屏（<1024px）首屏默认折叠，避免侧栏挤占主区，用户可通过顶栏 ☰ 手动展开
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 1024,
  )

  const handleAccountChange = useCallback(
    (account: RhAccountInfo | null) => {
      setAccountInfo(account)
      const uid = account?.userId ?? decodeRhToken()?.sub ?? null
      if (uid !== lastUserId) {
        setLastUserId(uid)
        setAccountKey((prev) => prev + 1)
      }
    },
    [lastUserId],
  )


  // 动态文档标题：切页时更新浏览器标签，多任务场景一眼识别
  const { pathname } = useLocation()
  const navigate = useNavigate()
  // 工作区标签（壳级单例 store）：标签栏与内容区共用同一份，见 lib/workspaceTabStore.ts
  const tabs = useSyncExternalStore(subscribeTabs, getTabsSnapshot).tabs

  // 路由变化 / 换账号 → 同步标签集合。放在 layout effect 里且不经 useState，避免
  // react-hooks/set-state-in-effect（该规则在 eslint 预算里只许下降）。
  const uid = accountInfo?.userId ?? decodeRhToken()?.sub ?? ""
  useLayoutEffect(() => {
    ensureTab(uid, pathname)
  }, [uid, pathname])

  // 每个标签记住自己的滚动位置：切走前存下、切回时还原（新标签从顶部开始）。
  // 滚动仍在 window 上（BackToTop / sticky 顶栏/侧栏逻辑一概不动），只是恢复目标值。
  const scrollByPathRef = useRef<Record<string, number>>({})
  const prevPathRef = useRef(pathname)
  useLayoutEffect(() => {
    const prev = prevPathRef.current
    if (prev !== pathname) {
      scrollByPathRef.current[prev] = window.scrollY
      window.scrollTo({ top: scrollByPathRef.current[pathname] ?? 0 })
      prevPathRef.current = pathname
    }
    document.title = hasRoute(pathname) ? `${labelFor(pathname)} · 小智工作站` : "小智工作站 · 售前工作台"
    // 保活副作用兜底：隐藏容器（display:none）里量不到尺寸，图表类页面（competitors 的 echarts 等）
    // 切回来可能保持 0×0 空白。激活后发一次 resize，让监听 window resize 的图表重新自适应。
    window.dispatchEvent(new Event("resize"))
  }, [pathname])

  // 标签栏动作：先改标签集合，再让地址跟上（关闭当前标签 → 落到邻居标签）
  const syncRouteTo = useCallback(
    (path: string) => {
      if (path !== pathname) navigate(path)
    },
    [navigate, pathname],
  )
  const handleActivateTab = useCallback(
    (path: string) => {
      activateTab(path)
      syncRouteTo(path)
    },
    [syncRouteTo],
  )
  const handleCloseTab = useCallback(
    (path: string) => {
      closeTabAt(path)
      syncRouteTo(getTabsSnapshot().tabs.active)
    },
    [syncRouteTo],
  )
  const handleCloseOthers = useCallback(
    (path: string) => {
      closeOthersAt(path)
      syncRouteTo(getTabsSnapshot().tabs.active)
    },
    [syncRouteTo],
  )
  const handleCloseRight = useCallback(
    (path: string) => {
      closeRightOf(path)
      syncRouteTo(getTabsSnapshot().tabs.active)
    },
    [syncRouteTo],
  )
  const handleCloseAll = useCallback(() => {
    closeEveryTab()
    syncRouteTo(getTabsSnapshot().tabs.active)
  }, [syncRouteTo])

  return (
    <ShellAccountContext.Provider value={accountInfo}>
      {/* R-201 阶段A：本地自用域整站登录门禁（未登录时不挂载工作台子树） */}
      <TeamAuthGate>
        <div
          className="flex min-h-screen bg-background text-foreground"
          // 2026-11-11：粘性层高口径集中到一个 CSS 变量，避免各页工具条硬编码 top 值而互相压字。
          // 页内工具条（BidToolbar / CrmToolbar / …）一律用
          // `sticky top-[calc(60px+var(--xz-tabs-h,0px))]`：上层是 h-[60px] 顶栏，
          // 标签栏只有「已打开 ≥2 个标签」时才渲染（38px），所以高度必须由这里按实际渲染结果下发，
          // 不能在工具条里写死——否则单标签时多出 38px 空洞，多标签时工具条又会被标签栏盖住 42px。
          style={{ "--xz-tabs-h": tabs.items.length > 1 ? "38px" : "0px" } as CSSProperties}
        >
          <SidebarNav accountInfo={accountInfo} collapsed={collapsed} />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBarShell
              onAccountChange={handleAccountChange}
              collapsed={collapsed}
              onToggleSidebar={() => setCollapsed((v) => !v)}
            />
            {/* 工作区标签栏：只有一个标签时不渲染（与改造前单页体验一致） */}
            <WorkspaceTabs
              tabs={tabs}
              onActivate={handleActivateTab}
              onClose={handleCloseTab}
              onCloseOthers={handleCloseOthers}
              onCloseRight={handleCloseRight}
              onCloseAll={handleCloseAll}
            />
            {/* 2026-10-31 移动端修复：
                实测小屏（390px）下文档仍被撑到 630px 可横向滚 240px——溢出源分散在多个组件里
                （标签栏内部的标签累计宽度、列表项长标题等），逐个修补容易漏。
                在内容主区统一 overflow-x-clip 兜底：内容自身若超宽由内部容器自己滚（如标签栏），
                但绝不允许把整页顶宽。用 clip 而非 hidden，避免影响 sticky 定位。 */}
            <main className="min-w-0 flex-1 overflow-x-clip px-4 pb-10 pt-5 lg:px-6">
              <div key={accountKey} className="mx-auto w-full min-w-0 max-w-[1560px]">
                <ErrorBoundary key={`eb-${accountKey}`}>
                  <TabbedOutlet tabs={tabs} pathname={pathname} />
                </ErrorBoundary>
        <BackToTop />
              </div>
            </main>
          </div>
          {/* B2：浮窗助手纳入账号 key 重挂载范围——切号即重挂载，useAssistant 重新 decode
              新 token，会话列表/失败消息按新账号隔离，杜绝跨账号串写 */}
          <FloatingAssistant key={`floating-assistant-${accountKey}`} />
          {/* 全站唯一 Toaster：所有页面 toast 由壳层统一渲染（设计规范 v1） */}
          <Toaster position="top-center" richColors />
        </div>
      </TeamAuthGate>
    </ShellAccountContext.Provider>
  )
}

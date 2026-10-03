import { createContext, useCallback, useEffect, useState } from "react"
import { Outlet, useLocation } from "react-router-dom"
import { Toaster } from "sonner"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"
import { BackToTop } from "@/components/common/BackToTop"
import { decodeRhToken, type RhAccountInfo } from "@/lib/rhLogin"
import { TeamAuthGate } from "@/components/team-auth/TeamAuthGate"
import { SidebarNav } from "./SidebarNav"
import { TopBarShell } from "./TopBarShell"
import { FloatingAssistant } from "./FloatingAssistant"

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
  const routeLabels: Record<string, string> = {
    "/": "作战驾驶舱",
    "/solution-studio": "方案编制",
    "/bid-workspace": "标书工作台",
    "/ppt-quote": "PPT 与报价",
    "/intel-center": "情报中心",
    "/competitors": "竞品分析",
    "/customer-management": "客户管理",
    "/knowledge": "知识库",
    "/format-tool": "格式刷新",
    "/assistant": "小智助手",
    "/model-config": "模型配置",
    "/team": "团队管理",
    "/qual-certs": "资质台账",
  }
  const { pathname } = useLocation()
  useEffect(() => {
    const label = routeLabels[pathname]
    document.title = label ? `${label} · 小智工作站` : "小智工作站 · 售前工作台"
    // 切页时重置主内容区滚动（避免从长列表跳入新页面后停在中间）
    window.scrollTo({ top: 0 })
  }, [pathname])

  return (
    <ShellAccountContext.Provider value={accountInfo}>
      {/* R-201 阶段A：本地自用域整站登录门禁（未登录时不挂载工作台子树） */}
      <TeamAuthGate>
        <div className="flex min-h-screen bg-background text-foreground">
          <SidebarNav accountInfo={accountInfo} collapsed={collapsed} />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBarShell
              onAccountChange={handleAccountChange}
              collapsed={collapsed}
              onToggleSidebar={() => setCollapsed((v) => !v)}
            />
            <main className="flex-1 px-4 pb-10 pt-5 lg:px-6">
              <div key={accountKey} className="mx-auto w-full max-w-[1560px]">
                <ErrorBoundary key={`eb-${accountKey}`}>
                  <Outlet />
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

// 保活内容区（多标签宿主）——替代原先的 <Outlet/>
//
// 为什么不用 <Outlet/>：路由一切换，React 就卸载旧页面、挂载新页面，页面上正在编的内容
// （标书章节草稿、选中的项目、滚动位置）全部丢失。标签页的价值恰恰在于"切走再切回来还在原处"，
// 所以这里把已打开的每个标签各挂一份，非当前标签用 hidden（display:none）隐藏——
// DOM 与组件状态全部保留，切回即恢复，不重新拉数据、不重跑挂载副作用。
//
// 取舍与边界：
//  - 只挂载"已打开"的标签（上限见 workspaceTabs.TAB_LIMIT），不是把 17 个页面全挂上。
//  - 隐藏的页面仍会跑自己的定时器（情报中心 15 分钟 tick、首页 30 秒时钟）。情报 tick 有服务端
//    30 分钟门控，后台继续跑反而让抓取不中断；这是保活的既有代价。
//  - 未注册路径不建标签，直接渲染 NotFound（浅链/写错的地址行为与改造前一致）。
//  - 每个标签各包一层 ErrorBoundary：某页崩掉不会把标签栏和其它标签一起带走。

import { Suspense } from "react"
import { ErrorBoundary } from "@/components/common/ErrorBoundary"
import { NotFound } from "@/components/common/NotFound"
import { ROUTE_BY_PATH, hasRoute } from "@/lib/routeRegistry"
import type { WorkspaceTabsState } from "@/lib/workspaceTabs"

// Suspense fallback 骨架：只在页面 chunk 首次加载的一瞬展示，通常 <50ms；
// 保持与内容区一致的 padding，视觉上无跳跃感（自 App.tsx 迁入）。
export function RouteFallback() {
  return (
    <div className="flex h-full min-h-[60vh] w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
        <span className="text-xs">页面加载中…</span>
      </div>
    </div>
  )
}

type TabbedOutletProps = {
  tabs: WorkspaceTabsState
  /** 当前地址（用于判断是否未注册路径） */
  pathname: string
}

export function TabbedOutlet({ tabs, pathname }: TabbedOutletProps) {
  // 路径未注册时直接渲染 404，不与已开标签的内容叠加。
  // 原先的实现把 NotFound 追加到 tabs 之后，遇到 active 标签路径与 pathname
  // 不一致（未注册时 tabs.active 仍保留最后一个已开标签），旧标签会与 NotFound
  // 一起渲染，看上去「页面没换」，给用户「静默失败」的错觉。
  if (!hasRoute(pathname)) {
    return (
      <ErrorBoundary key="eb-not-found">
        <NotFound />
      </ErrorBoundary>
    )
  }
  return (
    <>
      {tabs.items.map((path) => {
        const meta = ROUTE_BY_PATH[path]
        if (!meta) return null
        const Page = meta.Component
        const active = path === tabs.active
        return (
          // hidden 属性 = display:none：保留 DOM 与状态，但不占布局、不可聚焦
          <div key={path} hidden={!active} data-tab-panel={path}>
            <ErrorBoundary key={`eb-${path}`}>
              <Suspense fallback={<RouteFallback />}>
                <Page />
              </Suspense>
            </ErrorBoundary>
          </div>
        )
      })}
    </>
  )
}

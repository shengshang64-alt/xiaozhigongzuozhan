import { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { ChevronDown, Layers, MoreHorizontal } from "lucide-react"
import { preloadRoute } from "@/lib/routePreload"
import {
  NAV_GROUPS,
  NAV_MORE_PATHS,
  NAV_SIDEBAR_HIDDEN,
  ROUTE_BY_PATH,
  type RouteMeta,
} from "@/lib/routeRegistry"
import { decodeRhToken, isLocalDeployHost, type RhAccountInfo } from "@/lib/rhLogin"
import { getCachedTeamProfile } from "@/lib/teamAuth"

const MORE_SET = new Set<string>(NAV_MORE_PATHS)
const HIDDEN_SET = new Set<string>(NAV_SIDEBAR_HIDDEN)

const NAV_SECTIONS = NAV_GROUPS.map((group) => ({
  title: group.title,
  items: group.paths.map((path) => ROUTE_BY_PATH[path]).filter(Boolean),
}))

const MORE_ITEMS = NAV_GROUPS.flatMap((group) => group.paths)
  .map((path) => ROUTE_BY_PATH[path])
  .filter((item): item is RouteMeta => Boolean(item) && MORE_SET.has(item.path))

type SidebarNavProps = {
  accountInfo: RhAccountInfo | null
  collapsed?: boolean
}

function NavItem({
  item,
  pathname,
  collapsed,
  onNavigate,
}: {
  item: RouteMeta
  pathname: string
  collapsed: boolean
  onNavigate: (path: string) => void
}) {
  const Icon = item.icon
  const active = pathname === item.path
  return (
    <button
      type="button"
      title={item.label}
      onClick={() => onNavigate(item.path)}
      onMouseEnter={() => preloadRoute(item.path)}
      className={
        "group relative flex items-center gap-2.5 rounded-[9px] text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring " +
        (collapsed ? "justify-center px-0 py-[11px]" : "px-2.5 py-[9px]") +
        " " +
        (active
          ? "bg-gradient-to-r from-primary/35 to-primary/10 font-medium text-white"
          : "text-[#9BB8BD] hover:bg-white/[.06] hover:text-[#DCEEEC]")
      }
    >
      {active && (
        <span className="absolute -left-2.5 bottom-2 top-2 w-[3px] rounded-r-[3px] bg-primary" />
      )}
      <Icon className={"h-[19px] w-[19px] shrink-0 " + (active ? "text-[#22B8CE]" : "text-[#7FA09B] group-hover:text-[#9BB8BD]")} />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </button>
  )
}

export function SidebarNav({ accountInfo, collapsed = false }: SidebarNavProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const tokenPayload = decodeRhToken()
  // R-201 阶段A：团队管理入口仅本地域 + 管理员可见（写权限服务端另有强校验）
  const showAdminOnly = isLocalDeployHost() && getCachedTeamProfile()?.role === "admin"
  const displayName =
    accountInfo?.displayName ||
    tokenPayload?.nickName ||
    tokenPayload?.user_name ||
    tokenPayload?.username ||
    null
  const avatarInitial = displayName ? displayName.slice(0, 1).toUpperCase() : "访"

  const moreItems = MORE_ITEMS.filter((it) => !it.adminOnly || showAdminOnly)
  const moreActive = moreItems.some((it) => it.path === pathname)
  const [moreOpen, setMoreOpen] = useState(moreActive)
  useEffect(() => {
    if (moreActive) setMoreOpen(true)
  }, [moreActive])

  return (
    <aside
      className={
        "sticky top-0 z-50 flex h-screen shrink-0 flex-col border-r border-sidebar-border text-sidebar-foreground transition-[width] duration-200 " +
        "[background:linear-gradient(180deg,hsl(177_55%_11%)_0%,hsl(var(--sidebar-background))_100%)] " +
        // 2026-10-31 移动端修复：原来只有 collapsed 开关，小屏（390px）仍占 236px = 60% 视口，
        // 内容区只剩 150px 完全不可用（实测各页横向溢出 400~1100px）。
        // 小屏强制走折叠宽度 72px；sm 以上才允许 236px。
        (collapsed ? "w-[72px]" : "w-[72px] sm:w-[236px]")
      }
    >
      {/* Logo */}
      <header className={"flex shrink-0 items-center gap-2.5 border-b border-white/[.07] py-4 " + (collapsed ? "justify-center px-2" : "px-[18px]")}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-br from-primary to-[#0A5D76] text-white shadow-md">
          <Layers className="h-[19px] w-[19px]" />
        </span>
        {!collapsed && (
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[15px] font-bold text-[#EAF4F2]">售前工作台</span>
            <span className="block truncate text-[10px] tracking-wide text-[#6F908B]">PRESALES DESK</span>
          </span>
        )}
      </header>

      {/* Nav */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-1.5 pt-2.5">
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter(
            (it) =>
              (!it.adminOnly || showAdminOnly) &&
              !HIDDEN_SET.has(it.path) &&
              !MORE_SET.has(it.path),
          )
          if (items.length === 0) return null
          return (
          <div key={section.title} className="mb-1">
            {!collapsed && (
              <p className="px-2.5 pb-1.5 pt-3 text-[10px] font-medium tracking-[1.6px] text-[#5E7F7B]">
                {section.title}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {items.map((item) => (
                <NavItem
                  key={item.path}
                  item={item}
                  pathname={pathname}
                  collapsed={collapsed}
                  onNavigate={navigate}
                />
              ))}
            </div>
          </div>
          )
        })}
        {moreItems.length > 0 && (
          <div className="mb-1">
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-controls="sidebar-nav-more"
              title="更多"
              onClick={() => setMoreOpen((v) => !v)}
              className={
                "group relative flex w-full items-center gap-2.5 rounded-[9px] text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring " +
                (collapsed ? "justify-center px-0 py-[11px]" : "px-2.5 py-[9px]") +
                " " +
                (moreActive
                  ? "font-medium text-white"
                  : "text-[#9BB8BD] hover:bg-white/[.06] hover:text-[#DCEEEC]")
              }
            >
              <MoreHorizontal className={"h-[19px] w-[19px] shrink-0 " + (moreActive ? "text-[#22B8CE]" : "text-[#7FA09B] group-hover:text-[#9BB8BD]")} />
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1 truncate text-left">更多</span>
                  <ChevronDown className={"h-3.5 w-3.5 shrink-0 text-[#7FA09B] transition-transform " + (moreOpen ? "rotate-180" : "")} />
                </>
              )}
            </button>
            {moreOpen && (
              <div id="sidebar-nav-more" className="mt-0.5 flex flex-col gap-0.5">
                {moreItems.map((item) => (
                  <NavItem
                    key={item.path}
                    item={item}
                    pathname={pathname}
                    collapsed={collapsed}
                    onNavigate={navigate}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Account footer */}
      <footer className="shrink-0 p-2.5 lg:p-4">
        <button
          type="button"
          onClick={() => navigate("/model-config")}
          title="账户与模型配置"
          className={
            "flex w-full items-center gap-2.5 rounded-[11px] bg-white/[.06] p-2.5 transition-colors hover:bg-white/[.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring " +
            (collapsed ? "justify-center" : "")
          }
        >
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#22B8CE] to-primary text-[13px] font-semibold text-white">
            {avatarInitial}
          </span>
          {!collapsed && (
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[12.5px] font-medium text-[#E4F1EF]">
                {displayName ?? "本地用户"}
              </span>
              <span className="block truncate text-[10.5px] text-[#6F908B]">医疗售前工程师</span>
            </span>
          )}
        </button>
      </footer>
    </aside>
  )
}

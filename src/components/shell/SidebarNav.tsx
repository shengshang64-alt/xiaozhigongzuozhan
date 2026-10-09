import { useLocation, useNavigate } from "react-router-dom"
import {
  BookOpen,
  Bot,
  Building2,
  FileCheck2,
  FileText,
  LayoutGrid,
  Layers,
  Monitor,
  Images,
  Search,
  Settings,
  Flame,
  Type,
  UserCog,
  Users,
  ShieldCheck,
  ArrowLeftRight,
} from "lucide-react"
import { preloadRoute } from "@/lib/routePreload"
import { decodeRhToken, isLocalDeployHost, type RhAccountInfo } from "@/lib/rhLogin"
import { getCachedTeamProfile } from "@/lib/teamAuth"

type NavItem = { path: string; label: string; icon: typeof FileText; adminOnly?: boolean }
type NavSection = { title: string; items: NavItem[] }

// 导航分组与《小智工作站-重构设计方案》对齐（docs/redesign/）：按售前作战阶段重排
// 总览 → 发现 → 研判 → 制胜 → 决胜 → 沉淀 → 支撑（导航即作战地图）
const NAV_SECTIONS: NavSection[] = [
  {
    title: "总览",
    items: [{ path: "/", label: "作战驾驶舱", icon: LayoutGrid }],
  },
  {
    title: "发现",
    items: [
      { path: "/intel-center", label: "情报中心", icon: Search },
      { path: "/ai-hot", label: "AI 动态", icon: Flame },
    ],
  },
  {
    title: "研判",
    items: [{ path: "/customer-management", label: "客户管理", icon: Users }],
  },
  {
    title: "制胜",
    items: [
      { path: "/solution-studio", label: "方案工作室", icon: FileText },
      { path: "/product-mapping", label: "产品映射", icon: ArrowLeftRight },
      { path: "/ppt-quote", label: "PPT 与报价", icon: Monitor },
      { path: "/materials", label: "素材库", icon: Images },
    ],
  },
  {
    title: "决胜",
    items: [
      { path: "/bid-workspace", label: "标书工作台", icon: FileCheck2 },
      { path: "/format-tool", label: "格式刷新", icon: Type },
    ],
  },
  {
    title: "沉淀",
    items: [
      { path: "/knowledge", label: "知识库", icon: BookOpen },
      { path: "/qual-certs", label: "资质台账", icon: ShieldCheck },
      { path: "/competitors", label: "竞品分析", icon: Building2 },
    ],
  },
  {
    title: "支撑",
    items: [
      { path: "/assistant", label: "小智助手", icon: Bot },
      { path: "/model-config", label: "模型配置", icon: Settings },
      { path: "/team", label: "团队管理", icon: UserCog, adminOnly: true },
    ],
  },
]

type SidebarNavProps = {
  accountInfo: RhAccountInfo | null
  collapsed?: boolean
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

  return (
    <aside
      className={
        "sticky top-0 z-50 flex h-screen shrink-0 flex-col border-r border-sidebar-border text-sidebar-foreground transition-[width] duration-200 " +
        "[background:linear-gradient(180deg,hsl(177_55%_11%)_0%,hsl(var(--sidebar-background))_100%)] " +
        (collapsed ? "w-[72px]" : "w-[236px]")
      }
    >
      {/* Logo */}
      <header className={"flex items-center gap-2.5 border-b border-white/[.07] py-4 " + (collapsed ? "justify-center px-2" : "px-[18px]")}>
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
      <nav className="flex-1 overflow-y-auto px-2.5 pb-1.5 pt-2.5">
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((it) => !it.adminOnly || showAdminOnly)
          if (items.length === 0) return null
          return (
          <div key={section.title} className="mb-1">
            {!collapsed && (
              <p className="px-2.5 pb-1.5 pt-3 text-[10px] font-medium tracking-[1.6px] text-[#5E7F7B]">
                {section.title}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {items.map((item) => {
                const Icon = item.icon
                const active = pathname === item.path
                return (
                  <button
                    key={item.path}
                    type="button"
                    title={item.label}
                    onClick={() => navigate(item.path)}
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
              })}
            </div>
          </div>
          )
        })}
      </nav>

      {/* Account footer */}
      <footer className="p-2.5 lg:p-4">
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

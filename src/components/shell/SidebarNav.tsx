import { useLocation, useNavigate } from "react-router-dom"
import {
  BookOpen,
  Bot,
  FileCheck2,
  FileText,
  LayoutGrid,
  Layers,
  Monitor,
  Search,
  Settings,
  Users,
} from "lucide-react"
import { decodeRhToken, type RhAccountInfo } from "@/lib/rhLogin"

type NavItem = { path: string; label: string; icon: typeof FileText }
type NavSection = { title: string; items: NavItem[] }

const NAV_SECTIONS: NavSection[] = [
  {
    title: "概览",
    items: [{ path: "/", label: "工作台首页", icon: LayoutGrid }],
  },
  {
    title: "核心工作",
    items: [
      { path: "/solution-studio", label: "方案编制", icon: FileText },
      { path: "/bid-workspace", label: "标书工作", icon: FileCheck2 },
      { path: "/ppt-quote", label: "PPT 与报价", icon: Monitor },
    ],
  },
  {
    title: "资源与情报",
    items: [
      { path: "/intel-center", label: "情报中心", icon: Search },
      { path: "/customer-management", label: "客户管理", icon: Users },
      { path: "/knowledge", label: "知识库", icon: BookOpen },
    ],
  },
  {
    title: "系统",
    items: [
      { path: "/model-config", label: "模型配置", icon: Settings },
      { path: "/assistant", label: "小智助手", icon: Bot },
    ],
  },
]

type SidebarNavProps = {
  accountInfo: RhAccountInfo | null
}

export function SidebarNav({ accountInfo }: SidebarNavProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const tokenPayload = decodeRhToken()
  const displayName =
    accountInfo?.displayName ||
    tokenPayload?.nickName ||
    tokenPayload?.user_name ||
    tokenPayload?.username ||
    null
  const avatarInitial = displayName ? displayName.slice(0, 1).toUpperCase() : "访"

  return (
    <aside className="sticky top-0 z-50 flex h-screen w-[60px] shrink-0 flex-col border-r border-border bg-card lg:w-60">
      <header className="border-b border-border p-3 lg:p-5">
        <div className="flex items-center justify-center gap-2.5 lg:justify-start">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-md">
            <Layers className="h-5 w-5" />
          </span>
          <span className="hidden leading-tight lg:block">
            <span className="block text-sm font-bold text-foreground">售前工作台</span>
            <span className="block text-xs text-muted-foreground">医疗售前 · 效率中枢</span>
          </span>
        </div>
      </header>

      <nav className="flex-1 overflow-y-auto p-2 lg:p-3">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="mb-3">
            <p className="hidden px-3 pb-1.5 pt-2 text-xs font-medium tracking-wide text-muted-foreground lg:block">
              {section.title}
            </p>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const Icon = item.icon
                const active = pathname === item.path
                return (
                  <button
                    key={item.path}
                    type="button"
                    title={item.label}
                    onClick={() => navigate(item.path)}
                    className={
                      active
                        ? "flex items-center justify-center gap-2.5 rounded-lg bg-primary/10 px-2.5 py-2.5 text-sm font-medium text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:justify-start"
                        : "flex items-center justify-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:justify-start"
                    }
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    <span className="hidden lg:inline">{item.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <footer className="border-t border-border p-2 lg:p-4">
        <button
          type="button"
          onClick={() => navigate("/model-config")}
          title="账户与模型配置"
          className="flex w-full items-center justify-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:justify-start"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/60 text-sm font-semibold text-primary-foreground shadow-sm">
            {avatarInitial}
          </span>
          <span className="hidden min-w-0 leading-tight lg:block">
            <span className="block truncate text-sm font-medium text-foreground">
              {displayName ?? "本地用户"}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              医疗售前工程师
            </span>
          </span>
        </button>
      </footer>
    </aside>
  )
}

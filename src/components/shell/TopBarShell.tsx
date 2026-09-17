import { useLocation } from "react-router-dom"
import { RhAccountMenu } from "@/components/rh/RhAccountMenu"
import { GlobalCommandPalette } from "@/components/shell/GlobalCommandPalette"
import type { RhAccountInfo } from "@/lib/rhLogin"

const ROUTE_TITLES: Record<string, string> = {
  "/": "工作台首页",
  "/solution-studio": "方案编制",
  "/bid-workspace": "标书工作",
  "/ppt-quote": "PPT 与报价",
  "/intel-center": "情报中心",
  "/customer-management": "客户管理",
  "/knowledge": "知识库",
  "/model-config": "模型配置",
  "/assistant": "小智助手",
}

type TopBarShellProps = {
  onAccountChange: (account: RhAccountInfo | null) => void
}

export function TopBarShell({ onAccountChange }: TopBarShellProps) {
  const { pathname } = useLocation()
  const currentTitle = ROUTE_TITLES[pathname] ?? "工作台首页"

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-4 border-b border-border bg-card/90 px-4 backdrop-blur lg:px-6">
      <p className="truncate text-sm text-muted-foreground">
        售前工作台
        <span className="mx-1.5 text-muted-foreground/60">/</span>
        <span className="font-medium text-foreground">{currentTitle}</span>
      </p>

      <div className="flex shrink-0 items-center gap-3">
        <GlobalCommandPalette />
        <RhAccountMenu onAccountChange={onAccountChange} />
      </div>
    </header>
  )
}

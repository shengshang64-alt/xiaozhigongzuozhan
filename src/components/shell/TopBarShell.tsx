import { useState } from "react"
import { useLocation } from "react-router-dom"
import { Menu, Palette } from "lucide-react"
import { RhAccountMenu } from "@/components/rh/RhAccountMenu"
import { AppearanceDialog } from "@/components/shell/AppearanceDialog"
import { GlobalCommandPalette } from "@/components/shell/GlobalCommandPalette"
import { type RhAccountInfo } from "@/lib/rhLogin"
import { labelFor } from "@/lib/routeRegistry"

type TopBarShellProps = {
  onAccountChange: (account: RhAccountInfo | null) => void
  collapsed?: boolean
  onToggleSidebar?: () => void
}

export function TopBarShell({ onAccountChange, onToggleSidebar }: TopBarShellProps) {
  const { pathname } = useLocation()
  // 文案唯一真源 = lib/routeRegistry（原先本文件另有一份 ROUTE_TITLES，与侧栏文案漂移：
  // 同一路径一处叫「标书工作」一处叫「标书工作台」）
  const currentTitle = labelFor(pathname)
  const [appearanceOpen, setAppearanceOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 flex h-[60px] items-center gap-3 border-b border-border bg-card/85 px-4 backdrop-blur lg:px-6">
      {onToggleSidebar && (
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="折叠/展开导航"
          title="折叠/展开导航"
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Menu className="h-[18px] w-[18px]" />
        </button>
      )}

      <div className="min-w-0 text-[13px]">
        <span className="truncate font-semibold text-foreground">{currentTitle}</span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setAppearanceOpen(true)}
          title="个性化外观（模式/配色/背景图）"
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Palette className="h-[18px] w-[18px]" />
        </button>
        <GlobalCommandPalette />
        <RhAccountMenu onAccountChange={onAccountChange} />
      </div>
      <AppearanceDialog open={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
    </header>
  )
}

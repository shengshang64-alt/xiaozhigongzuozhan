// RunningHub 账号入口的唯一合法实现。这是 scaffold 自带的固定模板文件 ——
// 不要手写/重写这个组件, 也不要在页面里自己拼一个头像 + 退出按钮。
// 缺失时用 `mcp__rh-frontend__install_rh_account_menu` 重新安装。
//
// 交互契约(来自生产事故复盘, app-edc99b085e294da6a3e3b5ac413a4e33):
// - 点击头像**只打开菜单**, 退出登录必须是菜单里独立的危险色菜单项。
//   曾经把整个头像按钮的 onClick 直接绑 onLogout, 用户反馈"一点就退出登录"。
// - 充值/会员/控制台入口的 URL 只能来自 RH_MENU_LINKS, 不要自己拼
//   runninghub.cn 路径 —— 曾经手写过一个不存在的 `/recharge` 导致 404。
// - 这些入口都是 RH 主站真实页面(有 X-Frame-Options, 不能 iframe 内嵌),
//   一律用 openRhWindow 弹窗承载, 关闭后自动刷新余额。
import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronDown, LogOut, Wallet } from "lucide-react"
import {
  fetchRhAccountInfo,
  isLocalDeployHost,
  logoutRhAccount,
  openRhWindow,
  redirectToRhLogin,
  RH_MENU_LINKS,
  type RhAccountInfo,
} from "@/lib/rhLogin"

type RhAccountMenuProps = {
  /** 页面需要按登录态渲染其他内容时(比如需要登录才能生成), 用这个回调同步账号状态。 */
  onAccountChange?: (account: RhAccountInfo | null) => void
  className?: string
}

export function RhAccountMenu({ onAccountChange, className }: RhAccountMenuProps) {
  const [account, setAccount] = useState<RhAccountInfo | null>(null)
  const [ready, setReady] = useState(false)
  const [open, setOpen] = useState(false)
  const [avatarBroken, setAvatarBroken] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const refreshAccount = useCallback(async () => {
    const info = await fetchRhAccountInfo()
    setAccount(info)
    onAccountChange?.(info)
    return info
    // onAccountChange 由调用方按需传入, 不强制要求其引用稳定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let mounted = true
    refreshAccount().finally(() => {
      if (mounted) setReady(true)
    })
    return () => {
      mounted = false
    }
  }, [refreshAccount])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  const handleLogout = useCallback(async () => {
    setOpen(false)
    await logoutRhAccount()
    window.location.reload()
  }, [])

  const openMenuLink = useCallback(
    (url: string) => {
      setOpen(false)
      openRhWindow(url, () => {
        refreshAccount()
      })
    },
    [refreshAccount],
  )

  if (!ready) {
    return <div className={`h-9 w-24 animate-pulse rounded-full bg-muted ${className ?? ""}`} aria-hidden="true" />
  }

  // 本地自用域: 没有 RunningHub 账号体系可用, 只渲染一个静态身份标签 ——
  // 不提供登录按钮、充值入口、退出登录等任何账号操作。
  if (isLocalDeployHost()) {
    const localDisplayName = account?.displayName ?? "本地用户"
    return (
      <span
        className={`inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-card-foreground shadow-sm ${className ?? ""}`}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
          {localDisplayName.slice(0, 1)}
        </span>
        <span className="max-w-[8rem] truncate">{localDisplayName}</span>
      </span>
    )
  }

  if (!account) {
    return (
      <button
        type="button"
        onClick={redirectToRhLogin}
        className={`rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-md transition-transform hover:scale-105 hover:shadow-lg focus-visible:shadow-[var(--focus-ring)] ${className ?? ""}`}
      >
        使用 RunningHub 登录
      </button>
    )
  }

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-card-foreground shadow-sm transition-transform hover:scale-105 hover:shadow-md focus-visible:shadow-[var(--focus-ring)]"
      >
        {account.avatar && !avatarBroken ? (
          <img
            src={account.avatar}
            alt=""
            className="h-6 w-6 rounded-full object-cover"
            onError={() => setAvatarBroken(true)}
          />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
            {account.displayName.slice(0, 1)}
          </span>
        )}
        <span className="max-w-[8rem] truncate">{account.displayName}</span>
        {account.walletBalance !== undefined && (
          <span className="hidden items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground sm:flex">
            <Wallet className="h-3 w-3 text-primary" />
            {account.walletBalance}
          </span>
        )}
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-60 overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-lg"
        >
          <div className="px-3 py-2 text-xs text-muted-foreground">
            当前登录: <span className="text-foreground">{account.displayName}</span>
          </div>
          <div className="mx-2 mb-2 flex items-center justify-between rounded-md bg-muted px-2 py-2">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Wallet className="h-4 w-4 text-primary" />
              钱包余额
            </span>
            <span className="text-base font-semibold text-foreground">{account.walletBalance ?? "0"}</span>
          </div>

          <div className="my-1 border-t border-border" />

          <RhMenuLinkItem label={RH_MENU_LINKS.console.label} onClick={() => openMenuLink(RH_MENU_LINKS.console.url)} />
          <RhMenuLinkItem label={RH_MENU_LINKS.vip.label} onClick={() => openMenuLink(RH_MENU_LINKS.vip.url)} />
          <RhMenuLinkItem
            label={RH_MENU_LINKS.rechargeCash.label}
            onClick={() => openMenuLink(RH_MENU_LINKS.rechargeCash.url)}
            highlight
          />
          <RhMenuLinkItem
            label={RH_MENU_LINKS.rechargeCoin.label}
            onClick={() => openMenuLink(RH_MENU_LINKS.rechargeCoin.url)}
          />

          <div className="my-1 border-t border-border" />

          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-muted"
          >
            <LogOut className="h-4 w-4" />
            退出登录
          </button>
        </div>
      )}
    </div>
  )
}

function RhMenuLinkItem({
  label,
  onClick,
  highlight,
}: {
  label: string
  onClick: () => void
  highlight?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`block w-full px-3 py-2 text-left text-sm hover:bg-muted ${
        highlight ? "font-medium text-primary" : "text-foreground"
      }`}
    >
      {label}
    </button>
  )
}

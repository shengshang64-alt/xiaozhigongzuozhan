// 工作区标签栏（浏览器式多标签）
//
// 位置：顶栏（sticky top-0 h-[60px]）正下方，自身 sticky top-[60px]，横向滚动不换行。
// 交互：点选激活；× 关闭；中键关闭；右键菜单「关闭 / 关闭其他 / 关闭右侧 / 全部关闭」。
// 视觉沿用现有 token（border-border / bg-card / text-muted-foreground / focus ring），不引入新依赖。
//
// 两个实现取舍：
//  1) 标签体与关闭键是两个并列的真按钮，不嵌套（嵌套 button 是非法 HTML，且会与下拉触发器的
//     点击语义打架）。
//  2) 右键菜单用本组件内的轻量浮层，不用 DropdownMenu：Radix 的 Trigger 默认左键开菜单，
//     而这里左键必须留给「切换标签」，为它改触发语义反而更绕。
//
// 状态不在本组件：标签集合由 WorkbenchShell 持有（与内容区 TabbedOutlet 共用同一份），
// 本组件只渲染与派发动作，避免两处各存一份标签状态而漂移。

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { ROUTE_BY_PATH } from "@/lib/routeRegistry"
import type { WorkspaceTabsState } from "@/lib/workspaceTabs"

type WorkspaceTabsProps = {
  tabs: WorkspaceTabsState
  onActivate: (path: string) => void
  onClose: (path: string) => void
  onCloseOthers: (path: string) => void
  onCloseRight: (path: string) => void
  onCloseAll: () => void
}

export function WorkspaceTabs({
  tabs,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseRight,
  onCloseAll,
}: WorkspaceTabsProps) {
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null)

  // 右键菜单：Esc 关闭（点外部由遮罩处理）
  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [menu])

  if (tabs.items.length <= 1) return null // 只有一个标签时不占一行：与改造前的单页体验一致

  const closeMenu = () => setMenu(null)

  return (
    <>
      {/* 2026-10-31 移动端修复：overflow-x-auto 在 sticky + flex 子项下不总能约束 scrollWidth，
          实测文档仍被撑到 630px（视口 390）。因此保留一层宽度兜底。
          2026-11-11 修复（粘性栏滚走）：兜底容器此前是**独立一层**、且带 overflow-hidden。
          两个原因都会让内层 position:sticky 失效：
            ① overflow-hidden 让该层成为滚动容器 → sticky 相对它定位；
            ② 即便换成不建滚动容器的 overflow-clip，该层高度也只有标签栏自身 38px，
               sticky 只能在 0 像素范围内「粘」住。
          实测：滚动 400px 后标签栏 top=-340，已滚出视口，切标签必须先把页面滚回顶部。
          现把兜底与粘性合并到同一层（父级是整列内容区，高度足够），内层继续横向滚动。 */}
      <div className="sticky top-[60px] z-30 min-w-0 max-w-full overflow-x-clip">
      <div
        role="tablist"
        aria-label="已打开的页面"
        // 2026-10-31 移动端修复：加 max-w-full + min-w-0。
        // overflow-x-auto 只在自身内容超宽时生效，但若不限制自身宽度，
        // 它会被父级 flex 容器的 min-width:auto 撑开，把整页顶出横向滚动（实测 630px）。
        className="flex h-[38px] min-w-0 max-w-full items-stretch gap-1 overflow-x-auto overscroll-x-contain border-b border-border bg-card/70 px-2 backdrop-blur"
      >
        {tabs.items.map((path) => {
          const meta = ROUTE_BY_PATH[path]
          if (!meta) return null
          const active = path === tabs.active
          const Icon = meta.icon
          return (
            <div
              key={path}
              className={`group my-1 flex shrink-0 items-center rounded-t-[8px] border border-b-0 pl-2.5 pr-1.5 transition-colors ${
                active
                  ? "border-border bg-background"
                  : "border-transparent bg-secondary/40 hover:bg-secondary"
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                title={meta.label}
                onClick={() => onActivate(path)}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    // 中键关闭（浏览器习惯）
                    e.preventDefault()
                    onClose(path)
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ path, x: e.clientX, y: e.clientY })
                }}
                className={`flex items-center gap-1.5 py-1.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-[14px] w-[14px] shrink-0" />
                <span className="max-w-[10rem] truncate">{meta.label}</span>
              </button>
              <button
                type="button"
                aria-label={`关闭 ${meta.label}`}
                title={`关闭 ${meta.label}`}
                onClick={() => onClose(path)}
                className="ml-0.5 flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-60 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-[12px] w-[12px]" />
              </button>
            </div>
          )
        })}
      </div>
      </div>

      {menu && (
        <>
          {/* 点任意处关闭菜单 */}
          <div className="fixed inset-0 z-40" onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu() }} />
          <div
            role="menu"
            className="fixed z-50 min-w-[9rem] overflow-hidden rounded-md border border-border bg-popover py-1 text-[13px] text-popover-foreground shadow-md"
            style={{ left: menu.x, top: menu.y }}
          >
            {[
              { label: "关闭", run: () => onClose(menu.path) },
              { label: "关闭其他", run: () => onCloseOthers(menu.path) },
              { label: "关闭右侧", run: () => onCloseRight(menu.path) },
              { label: "全部关闭", run: onCloseAll },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  item.run()
                  closeMenu()
                }}
                className="block w-full px-3 py-1.5 text-left transition-colors hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

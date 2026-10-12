import {
  BookOpen,
  Bot,
  Building2,
  Calculator,
  FileCheck2,
  FilePlus2,
  FileText,
  History,
  LayoutGrid,
  Loader2,
  Monitor,
  Images,
  Newspaper,
  Search,
  Settings,
  Target,
  Users,
  ArrowLeftRight,
  type LucideIcon,
} from "lucide-react"
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { useGlobalSearch, type SearchResultGroup } from "./useGlobalSearch"

// 全局命令面板 View：触发按钮（顶栏搜索位）+ Cmd+K 浮层，只消费 useGlobalSearch props。

const NAV_ICONS: Record<string, LucideIcon> = {
  "/": LayoutGrid,
  "/solution-studio": FileText,
  "/product-mapping": ArrowLeftRight,
  "/bid-workspace": FileCheck2,
  "/ppt-quote": Monitor,
  "/materials": Images,
  "/intel-center": Newspaper,
  "/competitors": Building2,
  "/customer-management": Users,
  "/knowledge": BookOpen,
  "/model-config": Settings,
  "/assistant": Bot,
}

const GROUP_ICONS: Record<SearchResultGroup["key"], LucideIcon> = {
  customer: Building2,
  opportunity: Target,
  intel: Newspaper,
  bid: FileCheck2,
  solution: FileText,
  deck: Monitor,
  quote: Calculator,
  kb: BookOpen,
}

const ACTION_ICONS: Record<string, LucideIcon> = {
  "new-solution": FilePlus2,
  "new-bid": FileCheck2,
  "new-quote": Calculator,
  "ask-assistant": Bot,
  "add-intel": Newspaper,
}

export function GlobalCommandPalette() {
  const s = useGlobalSearch()

  return (
    <>
      <button
        type="button"
        onClick={() => s.handleOpenChange(true)}
        aria-label="打开全局搜索（⌘K）"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary/40 text-muted-foreground shadow-sm transition-colors hover:bg-card hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:w-72 md:justify-start md:gap-2 md:px-3"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="hidden text-sm font-normal md:inline">搜索客户、标书、情报…</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-muted-foreground md:inline">
          ⌘K
        </kbd>
      </button>

      <CommandDialog
        open={s.open}
        onOpenChange={s.handleOpenChange}
        title="全局搜索"
        description="搜索客户、商机、情报、标书、方案、PPT、报价与知识文档"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={s.query}
            onValueChange={s.setQuery}
            placeholder="搜索客户、商机、情报、标书、方案、PPT、报价、知识文档…"
          />
          <CommandList>
            {s.searching ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                正在搜索…
              </div>
            ) : (
              <>
                {!s.hasQuery && (
                  <CommandGroup heading="快捷动作">
                    {s.quickActions.map((action) => {
                      const Icon = ACTION_ICONS[action.key] ?? Search
                      return (
                        <CommandItem key={action.key} value={`action-${action.key}`} onSelect={() => s.go(action.route)}>
                          <Icon className="text-primary" />
                          <span className="flex-1">{action.label}</span>
                          <span className="text-xs text-muted-foreground">{action.hint}</span>
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                )}

                {!s.hasQuery && s.recentPages.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading="最近访问">
                      {s.recentPages.map((page) => {
                        const Icon = NAV_ICONS[page.path] ?? History
                        return (
                          <CommandItem key={`recent-${page.path}`} value={`recent-${page.path}`} onSelect={() => s.go(page.path)}>
                            <Icon className="text-muted-foreground" />
                            <span className="flex-1">{page.label}</span>
                            <History className="h-3.5 w-3.5 text-muted-foreground" />
                          </CommandItem>
                        )
                      })}
                    </CommandGroup>
                  </>
                )}

                {s.filteredNav.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading="页面导航">
                      {s.filteredNav.map((page) => {
                        const Icon = NAV_ICONS[page.path] ?? LayoutGrid
                        return (
                          <CommandItem key={`nav-${page.path}`} value={`nav-${page.path}`} onSelect={() => s.go(page.path)}>
                            <Icon className="text-muted-foreground" />
                            <span className="flex-1">{page.label}</span>
                          </CommandItem>
                        )
                      })}
                    </CommandGroup>
                  </>
                )}

                {s.groups.map((group) => {
                  const GroupIcon = GROUP_ICONS[group.key] ?? Search
                  return (
                    <CommandGroup key={group.key} heading={group.label}>
                      {group.items.map((item) => (
                        <CommandItem
                          key={`${group.key}-${item.id}`}
                          value={`${group.key}-${item.id}`}
                          onSelect={() => s.go(item.route)}
                        >
                          <GroupIcon className="text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{item.title}</span>
                            {item.subtitle ? (
                              <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
                            ) : null}
                          </span>
                        </CommandItem>
                      ))}
                      <CommandItem
                        value={`${group.key}-more`}
                        onSelect={() => s.go(group.moreRoute)}
                        className="text-primary"
                      >
                        <GroupIcon />
                        查看更多「{group.label}」
                      </CommandItem>
                    </CommandGroup>
                  )
                })}

                {s.noResults && (
                  <div className="flex flex-col items-center gap-2 border-dashed py-16 text-center">
                    <Search className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">没有找到相关内容</p>
                    <p className="text-xs text-muted-foreground">换个关键词试试，或直接问小智</p>
                    <CommandItem
                      value="ask-assistant-fallback"
                      onSelect={() => s.go(s.askAssistantRoute)}
                      className="mt-2 border border-primary/40 text-primary"
                    >
                      <Bot />
                      问小智：{s.query.trim()}
                    </CommandItem>
                  </div>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}

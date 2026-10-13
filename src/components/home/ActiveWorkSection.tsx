import { useNavigate } from "react-router-dom"
import {
  ArrowRight,
  Calculator,
  FileCheck2,
  FileText,
  FolderOpen,
  Loader2,
  Monitor,
  type LucideIcon,
} from "lucide-react"
import { ACTIVE_WORK_KIND_LABEL, type ActiveWorkItem, type ActiveWorkKind } from "@/pages/Home/activeWork"

// 首页「工作台进行中事项」只读卡（R196）：跨工作台真实在制项目的聚合总览，点击跳转，
// 不写任何数据。图标沿用全局命令面板对工作台集合的既有取色（bid/solution/deck/quote）。

const KIND_ICONS: Record<ActiveWorkKind, LucideIcon> = {
  bid: FileCheck2,
  solution: FileText,
  deck: Monitor,
  quote: Calculator,
}

type ActiveWorkSectionProps = {
  items: ActiveWorkItem[]
  loading: boolean
  /** R302：四个工作台的在制计数（可能是下限），用于诚实说明「只列了最近 12 项」 */
  total?: number
}

export function ActiveWorkSection({ items, loading, total }: ActiveWorkSectionProps) {
  const navigate = useNavigate()
  return (
    <section className="mb-5 rounded-xl border border-border bg-card shadow-md">
      <header className="flex min-h-14 items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <FolderOpen className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-foreground">工作台进行中事项</h2>
          <p className="truncate text-xs text-muted-foreground">
            {total !== undefined && total > items.length
              ? `共 ${total} 项在制，总览只列最近 ${items.length} 项`
              : "来自标书 / 方案 / PPT / 报价的在制项目，点击查看"}
          </p>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          正在汇总各工作台在制项目…
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <FolderOpen className="h-7 w-7 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">各工作台暂无进行中事项</p>
          <p className="text-xs text-muted-foreground">新建标书、方案、PPT 或报价后，会自动出现在这里</p>
        </div>
      ) : (
        <ul className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const Icon = KIND_ICONS[item.kind]
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => navigate(item.route)}
                  className="group flex w-full items-center gap-3 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {ACTIVE_WORK_KIND_LABEL[item.kind]}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="shrink-0">{item.statusLabel}</span>
                      {item.subtitle ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{item.subtitle}</span>
                        </>
                      ) : null}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

import { useNavigate } from "react-router-dom"
import {
  AlertOctagon,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FolderOpen,
  ListTodo,
  ShieldCheck,
  Target,
  TrendingUp,
  type LucideIcon,
} from "lucide-react"
import type { MustSeeCategory, MustSeeItem, MustSeeToday, ProjectItem } from "@/pages/Home/useHome"

// home-02：今日必看行动条——首屏唯一强调整点，把「逾期 / 今日到期 / 进行中」三类行动项置顶聚合。
// 纯展示层，数据由 useHome 的 mustSee 派生（复用已拉取的待办 / 待跟进商机 / 项目，零新增请求）。

const MAX_ROWS = 3

const CATEGORY_ICONS: Record<MustSeeCategory, LucideIcon> = {
  qual: ShieldCheck,
  todo: ListTodo,
  opp: Target,
  project: FolderOpen,
}

type GroupTone = {
  label: string
  Icon: LucideIcon
  text: string
  chip: string
}

const GROUP_TONE: Record<MustSeeItem["group"], GroupTone> = {
  overdue: { label: "已逾期", Icon: AlertTriangle, text: "text-destructive", chip: "bg-destructive/10 text-destructive" },
  dueToday: { label: "今日到期", Icon: CalendarClock, text: "text-warning", chip: "bg-warning/10 text-warning" },
  active: { label: "进行中", Icon: TrendingUp, text: "text-muted-foreground", chip: "bg-muted text-muted-foreground" },
}

const GROUP_ORDER: MustSeeItem["group"][] = ["overdue", "dueToday", "active"]

type MustSeeTodayBarProps = {
  data: MustSeeToday
  loading: boolean
  onOpenProject: (item: ProjectItem) => void
}

function FeedItem({ item, onClick }: { item: MustSeeItem; onClick: (item: MustSeeItem) => void }) {
  const CatIcon = CATEGORY_ICONS[item.category] ?? AlertOctagon
  return (
    <button
      type="button"
      onClick={() => onClick(item)}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <CatIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {item.title}
        <span className="ml-1.5 text-xs text-muted-foreground">{item.meta}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{item.detail}</span>
    </button>
  )
}

export function MustSeeTodayBar({ data, loading, onOpenProject }: MustSeeTodayBarProps) {
  const navigate = useNavigate()
  const handleClick = (item: MustSeeItem) => {
    if (item.project) {
      onOpenProject(item.project)
      return
    }
    if (item.route) navigate(item.route)
  }
  const groups = GROUP_ORDER.map((key) => ({ key, tone: GROUP_TONE[key], items: data[key] })).filter(
    (g) => g.items.length > 0,
  )

  return (
    <section className="mb-5 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/[0.06] to-transparent shadow-md ring-1 ring-primary/10">
      <header className="flex min-h-14 items-center gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <AlertOctagon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">今日必看</h2>
          <p className="truncate text-xs text-muted-foreground">逾期、今日到期与进行中的行动项，点击直达处理</p>
        </div>
        {data.total > 0 ? (
          <span className="ml-auto hidden shrink-0 rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground sm:inline-flex">
            {data.total} 项待处理
          </span>
        ) : null}
      </header>

      <div className="px-3 py-3">
        {loading && data.total === 0 ? (
          <p className="px-1 py-3 text-sm text-muted-foreground">正在汇总今日行动项…</p>
        ) : data.total === 0 ? (
          <div className="flex items-center gap-2 px-1 py-3 text-sm text-foreground">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
            今天没有逾期或到期事项，专注推进就好
          </div>
        ) : (
          <div className="flex flex-col gap-3 lg:flex-row lg:gap-6">
            {groups.map((g) => (
              <div key={g.key} className="min-w-0 flex-1">
                <div className={`mb-1 flex items-center gap-1.5 px-1 text-xs font-semibold ${g.tone.text}`}>
                  <g.tone.Icon className="h-3.5 w-3.5" />
                  {g.tone.label}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${g.tone.chip}`}>
                    {g.items.length}
                  </span>
                </div>
                <div className="flex flex-col">
                  {g.items.slice(0, MAX_ROWS).map((item) => (
                    <FeedItem key={item.id} item={item} onClick={handleClick} />
                  ))}
                </div>
                {g.items.length > MAX_ROWS ? (
                  <p className="px-2.5 pt-0.5 text-[11px] text-muted-foreground">
                    另有 {g.items.length - MAX_ROWS} 项，见下方对应模块
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

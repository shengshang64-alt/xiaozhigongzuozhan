// 驾驶舱「投标节点」卡（2026-09-28 路线图：投标日历 MVP）
// 开标/截标是最硬的 deadline——集中展示未来 60 天有开标时间的项目（紧急度分档），
// 并提示「未填开标时间」的进行中项目引导补录（提示必须有出路）。
// 组件自持拉取（作战室懒加载同款模式），不触碰 useBidWorkspace/useHome。
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { CalendarClock, Loader2 } from "lucide-react"
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"

type BidNodeRow = {
  id: string
  project_name?: string
  hospital?: string
  bid_open_date?: string
  stage?: string
  deleted_at?: string
}

type UpcomingNode = {
  id: string
  title: string
  hospital: string
  date: string
  daysLeft: number
}

const HORIZON_DAYS = 60

export function BidNodesCard() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<BidNodeRow[]>([])
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`${getPocketBaseUrl()}/api/bid_projects?rh_user_id=${encodeURIComponent(rhUid())}&page=1&perPage=200`, {
      headers: { "Content-Type": "application/json", ...vibexAuthHeaders() },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { items?: BidNodeRow[] }) => {
        if (!alive) return
        setRows((data.items ?? []).filter((b) => !b.deleted_at))
        setLoading(false)
      })
      .catch(() => {
        if (alive) setHidden(true)
      })
    return () => {
      alive = false
    }
  }, [])

  function rhUid(): string {
    // 与 vibexAuthHeaders 同源：本地部署共享池身份由 headers 提供，这里仅用于 query 过滤
    const h = vibexAuthHeaders() as Record<string, string>
    return h["X-Rh-User-Id"] || "local-user"
  }

  const today = new Date(new Date().toDateString()).getTime()
  const upcoming: UpcomingNode[] = []
  const missing: BidNodeRow[] = []
  for (const b of rows) {
    const d = (b.bid_open_date || "").trim()
    if (!d) {
      // 已解析/编制中的项目才提醒补录（归档项目不再需要）
      if (b.stage && b.stage !== "archived") missing.push(b)
      continue
    }
    const t = new Date(`${d}T00:00:00`).getTime()
    if (Number.isNaN(t)) continue
    const days = Math.round((t - today) / 86400000)
    if (days >= 0 && days <= HORIZON_DAYS) {
      upcoming.push({
        id: b.id,
        title: b.project_name || "未命名项目",
        hospital: b.hospital || "",
        date: d,
        daysLeft: days,
      })
    }
  }
  upcoming.sort((a, b) => a.daysLeft - b.daysLeft)

  // 无投标项目：整个卡片不渲染（首页保持聚焦）
  if (hidden || (rows.length === 0 && !loading)) return null

  const tone = (days: number) =>
    days <= 7
      ? "bg-destructive/10 text-destructive border-destructive/30"
      : days <= 30
        ? "bg-amber-500/10 text-amber-600 border-amber-400/30"
        : "border-border bg-card text-foreground"

  return (
    <section className="mb-5 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/[0.06] to-transparent p-4 shadow-md ring-1 ring-primary/10">
      <header className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <CalendarClock className="h-4 w-4" />
        </span>
        <h3 className="min-w-0 flex-1 text-sm font-semibold text-foreground">投标节点 · 未来 {HORIZON_DAYS} 天</h3>
      </header>
      {loading ? (
        <p className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在读取投标项目…
        </p>
      ) : upcoming.length === 0 ? (
        <div className="px-1 py-1 text-xs text-muted-foreground">
          未来 {HORIZON_DAYS} 天没有开标项目。
          {missing.length > 0 ? (
            <>
              {" "}
              <span className="text-foreground">
                {missing.length} 个项目未填开标时间
              </span>
              （如：{missing[0].project_name?.slice(0, 20) || missing[0].id}）——补录后开标前会在这里提醒。
            </>
          ) : null}
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {upcoming.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => navigate(`/bid-workspace?project=${n.id}`)}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-secondary/60 ${tone(n.daysLeft)}`}
              >
                <span className="shrink-0 font-mono text-sm font-semibold">{n.date}</span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {n.title}
                  {n.hospital ? <span className="ml-1.5 text-xs text-muted-foreground">{n.hospital}</span> : null}
                </span>
                <span className="shrink-0 text-xs font-medium">
                  {n.daysLeft === 0 ? "今天开标" : `剩 ${n.daysLeft} 天`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {missing.length > 0 && upcoming.length > 0 ? (
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          另有 {missing.length} 个项目未填开标时间，补录后纳入提醒。
        </p>
      ) : null}
    </section>
  )
}

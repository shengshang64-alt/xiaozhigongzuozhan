import { useMemo } from "react"
import { CalendarCheck, PhoneCall, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { localDateStamp } from "@/lib/dateStamp"
import type { CustomerRow } from "@/pages/CustomerManagement/customerTypes"

// ---------------------------------------------------------------------------
// 跟进队列 · 独立屏（UX-v2：prototype/customer/followup.html）。
// 按未跟进时长分组（超 90 / 60–90 / 30–60 天 / 无记录），把「快被忘掉的医院」
// 排到最前面；「去跟进」跳该客户详情，用详情里既有的快捷跟进落记录。
// 口径：elapsed = now - last_follow_at（客户档案的唯一跟进时间字段，天级精度足够分桶）。
// 分页是真实边界：只统计已加载的客户，分页未拉满时如实标注，不冒充全量。
// ---------------------------------------------------------------------------

type FollowupQueueScreenProps = {
  customers: CustomerRow[]
  totalCount: number | null
  hasMore: boolean
  /** 「今天」的基准值：由调用方注入（React 渲染层不直接取 Date.now，与全站口径一致） */
  nowMs: number
  onSelectCustomer: (customerId: string) => void
  onNewCustomer: () => void
}

type Group = { key: string; title: string; tone: string; desc: string; rows: CustomerRow[] }

/** 天数 → 分组；与原型 followup.html 的 30/60/90 三档对齐，无记录单独成组 */
function bucketOf(elapsedDays: number | null): string {
  if (elapsedDays === null) return "none"
  if (elapsedDays > 90) return "d90"
  if (elapsedDays > 60) return "d60"
  if (elapsedDays > 30) return "d30"
  return "fresh"
}

const GROUP_META: Record<string, { title: string; tone: string; desc: string }> = {
  none: { title: "从未跟进", tone: "text-destructive", desc: "建档后还没有任何跟进记录" },
  d90: { title: "超 90 天未跟进", tone: "text-destructive", desc: "再放着大概率就凉了，优先唤醒" },
  d60: { title: "60–90 天未跟进", tone: "text-warning", desc: "关键窗口期，本周安排一次接触" },
  d30: { title: "30–60 天未跟进", tone: "text-warning", desc: "保持温度，别让商机沉底" },
  fresh: { title: "30 天内跟进过", tone: "text-primary", desc: "节奏正常，无需处理" },
}

const GROUP_ORDER = ["none", "d90", "d60", "d30", "fresh"]

export function FollowupQueueScreen({ customers, totalCount, hasMore, nowMs, onSelectCustomer, onNewCustomer }: FollowupQueueScreenProps) {
  const groups = useMemo<Group[]>(() => {
    const buckets = new Map<string, CustomerRow[]>()
    for (const c of customers) {
      const raw = c.last_follow_at ? new Date(c.last_follow_at).getTime() : Number.NaN
      const elapsed = Number.isFinite(raw) ? Math.floor((nowMs - raw) / 86_400_000) : null
      const key = bucketOf(elapsed)
      const list = buckets.get(key) ?? []
      list.push(c)
      buckets.set(key, list)
    }
    return GROUP_ORDER.filter((k) => (buckets.get(k)?.length ?? 0) > 0).map((key) => ({
      key,
      rows: (buckets.get(key) ?? []).slice().sort((a, b) => {
        // 组内排序：最久没跟的排最前；都无记录按更新时间倒序
        const ta = a.last_follow_at ? new Date(a.last_follow_at).getTime() : Number.POSITIVE_INFINITY
        const tb = b.last_follow_at ? new Date(b.last_follow_at).getTime() : Number.POSITIVE_INFINITY
        if (ta !== tb) return ta - tb
        return (b.updated ?? "").localeCompare(a.updated ?? "")
      }),
      ...GROUP_META[key],
    }))
  }, [customers, nowMs])

  const staleTotal = groups.filter((g) => g.key !== "fresh").reduce((sum, g) => sum + g.rows.length, 0)

  return (
    <div className="pb-10">
      {/* 数据条：真值；分页未拉满时如实标注统计边界 */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-lg border border-border bg-card px-4 py-2.5 text-xs shadow-md">
        <span className="text-muted-foreground">
          需要唤醒 <b className="tabular-nums text-destructive">{staleTotal}</b> 家
        </span>
        <span className="text-muted-foreground">
          节奏正常 <b className="tabular-nums text-primary">{groups.find((g) => g.key === "fresh")?.rows.length ?? 0}</b> 家
        </span>
        <span className="text-muted-foreground">
          已统计 <b className="tabular-nums text-card-foreground">{customers.length}</b>
          {totalCount != null && totalCount > customers.length ? ` / 共 ${totalCount}` : ""} 家
          {hasMore ? "（分页未拉完，加载更多后统计更全）" : ""}
        </span>
      </div>

      {customers.length === 0 ? (
        <section className="mx-auto mt-10 max-w-md rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center shadow-md">
          <Users className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <h2 className="mt-3 text-sm font-semibold text-card-foreground">还没有客户档案</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            先在「客户列表」新建医院客户并补全档案，跟进超过 30 天的会自动出现在这个队列里。
          </p>
          <Button size="sm" className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90" onClick={onNewCustomer}>
            新建客户
          </Button>
        </section>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.key} className="rounded-lg border border-border bg-card shadow-md">
              <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
                <CalendarCheck className={`h-4 w-4 shrink-0 ${g.tone}`} />
                <h3 className="text-sm font-semibold text-card-foreground">{g.title}</h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{g.rows.length} 家</span>
                <span className="ml-auto hidden text-xs text-muted-foreground sm:block">{g.desc}</span>
              </header>
              <ul className="divide-y divide-border/60">
                {g.rows.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium text-card-foreground" title={c.hospital_name}>
                      {c.hospital_name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {c.level ? `${c.level}` : ""}
                      {c.region ? ` · ${c.region}` : ""}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {c.last_follow_at ? `最近跟进 ${localDateStamp(new Date(c.last_follow_at))}` : "从未跟进"}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 border-primary/40 px-2 text-xs text-primary hover:bg-primary/10"
                      onClick={() => onSelectCustomer(c.id)}
                      title="打开该客户详情，用快捷跟进落一条记录"
                    >
                      <PhoneCall className="mr-1 h-3 w-3" />
                      去跟进
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

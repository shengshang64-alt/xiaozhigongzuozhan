import { useRef, useState } from "react"
import { Target, Plus, Loader2 } from "lucide-react"
import { fmtAmount, type OppStage, type OpportunityRow } from "@/pages/CustomerManagement/customerTypes"

const COLUMNS: { key: string; label: string }[] = [
  { key: "lead", label: "线索" },
  { key: "contact", label: "接触" },
  { key: "needs", label: "需求确认" },
  { key: "solution", label: "方案阶段" },
  { key: "bidding", label: "投标" },
  { key: "won", label: "中标" },
  { key: "lost", label: "失单" },
]

type KanbanBoardProps = {
  boardGroups: Record<string, OpportunityRow[]>
  /** D1：可精确推断的商机总数；null=末页拉满、总数未知（不再显示伪 total） */
  totalCount: number | null
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onOpenOpportunity: (opp: OpportunityRow) => void
  onNewOpportunity: () => void
  onMoveStage: (opp: OpportunityRow, target: OppStage) => void
}

export function KanbanBoard({
  boardGroups,
  totalCount,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpenOpportunity,
  onNewOpportunity,
  onMoveStage,
}: KanbanBoardProps) {
  const total = Object.values(boardGroups).reduce((sum, list) => sum + list.length, 0)
  // 循环8 C5：本地今天 YYYY-MM-DD，用于卡片「下次跟进」徽章逾期判定
  const todayStr = (() => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })()
  // A2-9 轻量 HTML5 拖拽换阶段：拖卡片到目标阶段列，乐观更新 + toast，失败回滚
  const dragOppRef = useRef<OpportunityRow | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)

  return (
    <section className="py-2">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Target className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-foreground">商机看板</h2>
            <p className="text-xs text-muted-foreground">
              {totalCount != null && totalCount > total
                ? `已加载 ${total} / 共 ${totalCount} 条商机`
                : totalCount != null
                  ? `共 ${totalCount} 条商机`
                  : `已加载 ${total} 条商机`}
              ，按阶段列排布，点卡片看详情，拖卡片换阶段；拖到「中标 / 失单」需确认并补跟进
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onNewOpportunity}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Plus className="h-4 w-4" />
          新建商机
        </button>
      </header>

      {total === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-5 py-16 text-center shadow-md">
          <Target className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">看板还空着</p>
          <p className="mt-1 text-xs text-muted-foreground">先创建客户，再为客户添加商机，推进情况一目了然</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
          {COLUMNS.map((col) => {
            const list = boardGroups[col.key] ?? []
            const dropActive = dragOverCol === col.key
            return (
              <div
                key={col.key}
                onDragOver={(e) => {
                  const dragged = dragOppRef.current
                  if (!dragged || dragged.stage === col.key) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = "move"
                  setDragOverCol(col.key)
                }}
                onDragLeave={() => setDragOverCol((prev) => (prev === col.key ? null : prev))}
                onDrop={(e) => {
                  e.preventDefault()
                  const dragged = dragOppRef.current
                  dragOppRef.current = null
                  setDragOverCol(null)
                  if (!dragged || dragged.stage === col.key) return
                  onMoveStage(dragged, col.key as OppStage)
                }}
                className={`flex min-h-40 flex-col rounded-lg border p-2.5 transition-colors ${
                  dropActive
                    ? "border-primary bg-primary/5 ring-2 ring-primary/40"
                    : "border-border bg-secondary/40"
                }`}
              >
                <div className="flex shrink-0 items-center justify-between px-1 py-1.5">
                  <p className="text-xs font-semibold text-foreground">{col.label}</p>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{list.length}</span>
                </div>
                <div className="mt-1 flex flex-col gap-2">
                  {list.map((opp) => {
                    const isWon = opp.stage === "won"
                    const isLost = opp.stage === ("lost" as OppStage)
                    const ended = isWon || isLost
                    return (
                      <button
                        key={opp.id}
                        type="button"
                        draggable={!ended}
                        onDragStart={(e) => {
                          if (ended) return
                          dragOppRef.current = opp
                          e.dataTransfer.effectAllowed = "move"
                          e.dataTransfer.setData("text/plain", opp.id)
                        }}
                        onDragEnd={() => {
                          dragOppRef.current = null
                          setDragOverCol(null)
                        }}
                        onClick={() => onOpenOpportunity(opp)}
                        title={ended ? undefined : "拖动到其他阶段列可推进商机"}
                        className={
                          ended
                            ? "rounded-md border border-border bg-muted/60 px-3 py-2.5 text-left opacity-70 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            : "cursor-grab rounded-md border border-border bg-card px-3 py-2.5 text-left shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        }
                      >
                        <p className="text-xs text-muted-foreground">{opp.customer_name || "未知客户"}</p>
                        <p className="mt-0.5 text-sm font-medium text-foreground">{opp.opp_name}</p>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
                          {opp.expected_amount > 0 ? (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                              {fmtAmount(opp.expected_amount)}
                            </span>
                          ) : (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                              待定
                            </span>
                          )}
                          {/* 循环8 C5：下次跟进日期小徽章——无值不显示，逾期（非终态）用 destructive 配色 */}
                          {(opp.next_follow_date ?? "").slice(0, 10) && (
                            <span
                              className={
                                opp.next_follow_date.slice(0, 10) < todayStr && !ended
                                  ? "rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                                  : "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                              }
                            >
                              跟进 {opp.next_follow_date.slice(5, 10)}
                            </span>
                          )}
                          {ended && (
                            <span className={isWon ? "badge-success" : "badge-danger"}>
                              {isWon ? "中标" : "失单"}
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-4 py-2 text-sm font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
            加载更多商机
          </button>
        </div>
      )}
    </section>
  )
}

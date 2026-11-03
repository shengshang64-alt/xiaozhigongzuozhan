import { useState } from "react"
import { Clock, Loader2, MessageSquarePlus, Trash2 } from "lucide-react"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { RECORD_TYPES, fmtDateTime, type FollowRecordRow } from "@/pages/CustomerManagement/customerTypes"

type FollowTimelineProps = {
  records: FollowRecordRow[]
  recordsLoading: boolean
  /** D1：可精确推断的记录总数；null=末页拉满、总数未知 */
  totalRecords: number | null
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  quickType: string
  setQuickType: (value: string) => void
  quickContent: string
  setQuickContent: (value: string) => void
  onAddFollow: () => void
  addingFollow: boolean
  /** A1：删除单条跟进记录（ConfirmDialog 确认后调用，成功后本地剔除） */
  onDeleteFollow: (recordId: string) => void
  deletingFollowId: string | null
}

export function FollowTimeline({
  records,
  recordsLoading,
  totalRecords,
  hasMore,
  loadingMore,
  onLoadMore,
  quickType,
  setQuickType,
  quickContent,
  setQuickContent,
  onAddFollow,
  addingFollow,
  onDeleteFollow,
  deletingFollowId,
}: FollowTimelineProps) {
  // A1：待确认删除的记录 id；目标记录从列表消失（删除成功）即自动关弹窗
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const confirmTarget = confirmDeleteId ? records.find((r) => r.id === confirmDeleteId) ?? null : null
  const confirmBusy = confirmTarget != null && deletingFollowId === confirmTarget.id
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-md lg:p-5">
      <header className="flex min-h-14 items-center gap-2">
        <Clock className="h-4 w-4 text-primary" />
        <h3 className="text-base font-semibold text-foreground">跟进时间线</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {totalRecords != null ? Math.max(totalRecords, records.length) : records.length} 条
        </span>
      </header>

      <div className="mt-3 flex items-center gap-2">
        <select
          value={quickType}
          onChange={(e) => setQuickType(e.target.value)}
          aria-label="跟进方式"
          className="h-9 shrink-0 cursor-pointer rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {RECORD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          value={quickContent}
          onChange={(e) => setQuickContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              onAddFollow()
            }
          }}
          placeholder="记录一条跟进，回车即保存"
          className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <button
          type="button"
          onClick={onAddFollow}
          disabled={addingFollow}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-primary/40 px-3 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          {addingFollow ? "保存中" : "添加"}
        </button>
      </div>

      <div className="mt-4">
        {recordsLoading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            跟进记录加载中…
          </div>
        ) : records.length === 0 ? (
          <p className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
            还没有跟进记录，添加第一条吧
          </p>
        ) : (
          <ol className="relative flex flex-col gap-4 border-l border-border pl-5">
            {records.map((record) => (
              <li key={record.id} className="group relative">
                <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary shadow-sm" />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {record.record_type}
                  </span>
                  {record.stage_change && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {record.stage_change}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">{fmtDateTime(record.created)}</span>
                  {/* A1：hover 浮现的删除操作位，统一 ConfirmDialog 确认 */}
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(record.id)}
                    aria-label="删除这条跟进记录"
                    className="ml-auto rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-foreground">{record.content}</p>
              </li>
            ))}
          </ol>
        )}
        {!recordsLoading && records.length > 0 && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <p className="text-xs text-muted-foreground">
              已加载 {records.length} 条{totalRecords != null ? ` / 共 ${totalRecords} 条` : ""}
            </p>
            {hasMore && (
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {loadingMore && <Loader2 className="h-3 w-3 animate-spin" />}
                加载更多跟进
              </button>
            )}
          </div>
        )}
      </div>

      {/* A1：删除跟进记录确认（danger 态）；删除成功后记录从列表消失，弹窗随之自动关闭 */}
      <ConfirmDialog
        open={confirmTarget != null}
        onOpenChange={(next) => {
          if (!next && !confirmBusy) setConfirmDeleteId(null)
        }}
        title="删除跟进记录"
        description="这条跟进记录将被永久删除，不可恢复。确定删除吗？"
        confirmText="确认删除"
        tone="danger"
        busy={confirmBusy}
        onConfirm={() => {
          if (confirmTarget) onDeleteFollow(confirmTarget.id)
        }}
      />
    </div>
  )
}

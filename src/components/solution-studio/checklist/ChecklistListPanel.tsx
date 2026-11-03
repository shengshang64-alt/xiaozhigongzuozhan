import { ClipboardList, Loader2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { fmtMoney, targetLabel, type ChecklistRecord } from "@/pages/SolutionStudio/checklistTypes"
import type { UseChecklist } from "@/pages/SolutionStudio/checklistLogic"

// ---------------------------------------------------------------------------
// 我的建设清单列表
// ---------------------------------------------------------------------------

function ChecklistCard({
  rec,
  onOpen,
  onDelete,
}: {
  rec: ChecklistRecord
  onOpen: () => void
  onDelete: () => void
}) {
  const itemCount = (rec.items ?? []).filter((l) => l.checked !== false).length
  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-md transition-shadow hover:shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{rec.checklist_name}</p>
        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          {rec.source_mode === "rating" ? "评级匹配" : "客户清单匹配"}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{rec.hospital || "未填医院"}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {(rec.rating_targets ?? []).length ? (
          (rec.rating_targets ?? []).map((code) => (
            <span key={code} className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {targetLabel(code)}
            </span>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">未指定评级目标</span>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {itemCount} 个条目 · 合计 {fmtMoney(rec.total_amount)} · 更新于 {(rec.updated ?? "").slice(0, 10)}
      </p>
      <div className="mt-auto flex items-center gap-2 pt-3">
        <Button size="sm" variant="outline" onClick={onOpen} className="border-border text-card-foreground hover:bg-secondary">
          <ClipboardList className="mr-1 h-3.5 w-3.5" />
          重开编辑
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} className="text-muted-foreground hover:text-destructive">
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          删除
        </Button>
      </div>
    </div>
  )
}

export function ChecklistListPanel({ ck }: { ck: UseChecklist }) {
  return (
    <section className="flex h-full flex-col rounded-2xl border border-border bg-card p-4 shadow-md">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-foreground">我的建设清单</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">清单保存在服务端，可重开编辑或带入方案</p>
        </div>
        <Button size="sm" onClick={ck.openChecklistWizard} className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90">
          <Plus className="mr-1 h-4 w-4" />
          新建清单
        </Button>
      </div>

      {ck.checklistsLoading ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-xs text-muted-foreground">清单加载中…</p>
        </div>
      ) : ck.myChecklists.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-xl border border-dashed border-border bg-secondary/50 py-16 text-center">
          <ClipboardList className="h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium text-foreground">还没有建设清单</p>
          <p className="mt-1 text-xs text-muted-foreground">从评级目标自动勾选，或粘贴客户清单逐条匹配生成</p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3">
          {ck.myChecklists.map((rec) => (
            <ChecklistCard
              key={rec.id}
              rec={rec}
              onOpen={() => ck.openChecklistDetail(rec.id)}
              onDelete={() => void ck.deleteChecklist(rec.id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

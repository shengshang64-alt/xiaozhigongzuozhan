import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  PROJECT_SOURCE_LABEL,
  type BackfillPreview,
  backfillCounts,
} from "@/pages/CustomerManagement/projectBackfill"

type ProjectBackfillDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  loading: boolean
  applying: boolean
  preview: BackfillPreview | null
  error?: string
  onRefresh: () => void
  onApply: () => void
}

function GroupSection({
  title,
  hint,
  count,
  children,
}: {
  title: string
  hint: string
  count: number
  children: ReactNode
}) {
  return (
    <section className="rounded-md border border-border px-3 py-2.5">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-card-foreground">
          {title}
          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{count}</span>
        </h3>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </header>
      <div className="mt-2 max-h-36 overflow-auto text-xs text-muted-foreground">{children}</div>
    </section>
  )
}

export function ProjectBackfillDialog({
  open,
  onOpenChange,
  loading,
  applying,
  preview,
  error,
  onRefresh,
  onApply,
}: ProjectBackfillDialogProps) {
  const counts = preview ? backfillCounts(preview) : null
  const applicable = (counts?.create ?? 0) + (counts?.link ?? 0)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>从项目回填客户</DialogTitle>
        </DialogHeader>
        <p className="text-sm leading-relaxed text-foreground">
          从在编投标、方案、报价里抽出医院名，对不上的先建仅有名称的档案，对得上且未挂商机的补建或复用商机。模糊相近的只列入待确认，不会自动写入。
        </p>
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在汇总项目与客户档案…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : preview && counts ? (
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>待建档 {counts.create}</span>
              <span>待挂商机 {counts.link}</span>
              <span>已对齐 {counts.aligned}</span>
              <span>待确认 {counts.pending}</span>
              {counts.skippedEmpty ? <span>无医院名 {counts.skippedEmpty}</span> : null}
              {counts.skippedDeleted ? <span>已排除回收站 {counts.skippedDeleted}</span> : null}
            </div>
            <GroupSection title="待建档" hint="只写医院名与来源备注，不填其它字段" count={counts.create}>
              {preview.create.length === 0 ? (
                <p>没有需要对档的新医院。</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {preview.create.map((item) => (
                    <li key={`${item.project.source}:${item.project.id}`}>
                      {item.project.hospital}
                      <span className="ml-1 text-[11px] text-muted-foreground/80">
                        （{PROJECT_SOURCE_LABEL[item.project.source]} · {item.project.name || "未命名项目"}）
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </GroupSection>
            <GroupSection title="待挂商机" hint="对得上且项目还没挂商机，将建或复用后写回" count={counts.link}>
              {preview.link.length === 0 ? (
                <p>没有需要挂接的项目。</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {preview.link.map((item) => (
                    <li key={`${item.project.source}:${item.project.id}`}>
                      {item.customer?.hospital_name}
                      <span className="ml-1 text-[11px] text-muted-foreground/80">
                        （{PROJECT_SOURCE_LABEL[item.project.source]} · {item.project.name || "未命名项目"}
                        {item.reuseOpportunity ? " · 复用已有商机" : " · 新建商机"}
                        {item.canWriteOpportunityId ? "" : " · 方案只在商机上记反向引用"}）
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </GroupSection>
            <GroupSection title="已对齐" hint="无需处理" count={counts.aligned}>
              {preview.aligned.length === 0 ? <p>没有已对齐的项目。</p> : <p>共 {counts.aligned} 条已挂好，确认时不会改动。</p>}
            </GroupSection>
            <GroupSection title="待确认" hint="模糊或一对多，确认应用时不会写入" count={counts.pending}>
              {preview.pending.length === 0 ? (
                <p>没有待确认的近似名称。</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {preview.pending.map((item) => (
                    <li key={`${item.project.source}:${item.project.id}`}>
                      {item.project.hospital}
                      <span className="ml-1 text-[11px] text-muted-foreground/80">
                        （{PROJECT_SOURCE_LABEL[item.project.source]} · 接近{" "}
                        {(item.candidates ?? []).map((c) => c.hospital_name).join("、") || "已有档案"}）
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </GroupSection>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">还没有预览结果。</p>
        )}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading || applying}>
            重新预览
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={applying}>
            取消
          </Button>
          <Button type="button" size="sm" onClick={onApply} disabled={!preview || applying || loading || applicable === 0}>
            {applying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            确认应用（{applicable} 条）
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

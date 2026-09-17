import { Eraser, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type CleanupIrrelevantDialogProps = {
  open: boolean
  busy: boolean
  info: { count: number; samples: string[] } | null
  onClose: () => void
  onConfirm: () => void
}

/** 存量不相关情报一键清理：先展示命中数与样例，确认后才删除（删除不可恢复） */
export function CleanupIrrelevantDialog({ open, busy, info, onClose, onConfirm }: CleanupIrrelevantDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-lg rounded-2xl border-border bg-card shadow-lg">
        <DialogHeader>
          <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-primary">
            <Eraser className="h-3.5 w-3.5" />
            情报清理
          </p>
          <DialogTitle className="text-xl text-foreground">清理不相关情报</DialogTitle>
          <DialogDescription>
            按医疗信息化建设口径（HIS/EMR/集成平台/数据中心/AI/信创/智慧医院等项目、招标、政策、技术方案）筛查存量采集条目，以下命中项将被删除且不可恢复；手动录入的情报不受影响。
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-border bg-background px-3 py-2.5">
          <p className="text-sm font-medium text-foreground">
            命中 <span className="text-primary">{info?.count ?? 0}</span> 条不相关条目
          </p>
          {info && info.samples.length > 0 && (
            <ul className="mt-2 flex max-h-44 flex-col gap-1 overflow-y-auto">
              {info.samples.map((s, i) => (
                <li key={`${s}-${i}`} className="truncate text-xs leading-relaxed text-muted-foreground" title={s}>
                  · {s}
                </li>
              ))}
              {info.count > info.samples.length && (
                <li className="text-xs text-muted-foreground">…另有 {info.count - info.samples.length} 条</li>
              )}
            </ul>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} disabled={busy} className="border-border text-muted-foreground shadow-sm hover:text-foreground">
            取消
          </Button>
          <Button onClick={onConfirm} disabled={busy} className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]">
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            确认清理
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

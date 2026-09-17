import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { STAGE_LABEL, type OppStage, type OpportunityRow } from "@/pages/CustomerManagement/customerTypes"

type StageChangeDialogProps = {
  stageDialog: { opp: OpportunityRow; target: OppStage } | null
  stageRecordContent: string
  setStageRecordContent: (value: string) => void
  lostReasonDraft: string
  setLostReasonDraft: (value: string) => void
  onConfirm: () => void
  onClose: () => void
  saving: boolean
}

export function StageChangeDialog({
  stageDialog,
  stageRecordContent,
  setStageRecordContent,
  lostReasonDraft,
  setLostReasonDraft,
  onConfirm,
  onClose,
  saving,
}: StageChangeDialogProps) {
  if (!stageDialog) return null
  const { opp, target } = stageDialog
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            推进到「{STAGE_LABEL[target]}」
          </DialogTitle>
          <DialogDescription>
            {opp.opp_name}：{opp.stage ? STAGE_LABEL[opp.stage] : "未设置"} → {STAGE_LABEL[target]}。推进阶段需要同时留一条跟进记录。
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 grid gap-3">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">本阶段跟进记录（必填）</p>
            <textarea
              value={stageRecordContent}
              onChange={(e) => setStageRecordContent(e.target.value)}
              rows={3}
              placeholder="这次推进做了什么、和谁沟通、达成了什么共识…"
              className="w-full rounded-md border border-border bg-background p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          {target === "lost" && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">失单原因（选填）</p>
              <input
                value={lostReasonDraft}
                onChange={(e) => setLostReasonDraft(e.target.value)}
                placeholder="如：预算取消 / 竞品低价中标"
                className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-transform hover:scale-105 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            确认推进
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

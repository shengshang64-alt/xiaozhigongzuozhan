import { Sparkles } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { SkillFillState } from "@/pages/Assistant/useAssistant"

type SkillFillDialogProps = {
  fill: SkillFillState | null
  onValue: (slot: string, value: string) => void
  onConfirm: () => void
  onCancel: () => void
}

export function SkillFillDialog({ fill, onValue, onConfirm, onCancel }: SkillFillDialogProps) {
  return (
    <Dialog open={fill !== null} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="max-w-md rounded-xl border-border bg-card shadow-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            {fill?.skillName ?? "补填技能空位"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            把这个技能的空位填好，小智会按模板帮你发出这条指令。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          {(fill?.slots ?? []).map((slot) => (
            <label key={slot} className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">{slot}</span>
              <input
                value={fill?.values[slot] ?? ""}
                onChange={(e) => onValue(slot, e.target.value)}
                placeholder={`请输入${slot}`}
                className="h-9 rounded-md border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </label>
          ))}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm text-muted-foreground shadow-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-md transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Sparkles className="h-3.5 w-3.5" />
            发给小智
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  kindLabel,
  ratingSelectionIsActive,
  type RequirementExtractPreview,
  type RequirementItem,
} from "./requirementExtract"
import type { RatingSelection } from "@/pages/SolutionStudio/ratingTags"

// ---------------------------------------------------------------------------
// 抽取预览：先让用户看条目和评级识别结果，确认后再进入对照 / 评级筛选。
// 不在这里保存建设清单，也不调用模型。
// ---------------------------------------------------------------------------

export function RequirementExtractDialog({
  preview,
  busy,
  onClose,
  onConfirm,
}: {
  preview: RequirementExtractPreview | null
  busy?: boolean
  onClose: () => void
  onConfirm: (payload: { items: RequirementItem[]; ratingSel: RatingSelection; context: string }) => void
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!preview) return
    const next: Record<string, boolean> = {}
    for (const it of preview.items) next[it.norm] = true
    setChecked(next)
  }, [preview])

  const selected = useMemo(() => (preview?.items ?? []).filter((it) => checked[it.norm] !== false), [preview, checked])
  const hasItems = (preview?.items.length ?? 0) > 0
  const hasRating = ratingSelectionIsActive(preview?.rating.selection)

  return (
    <Dialog open={Boolean(preview) || Boolean(busy)} onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto" data-testid="req-extract-dialog">
        <DialogHeader>
          <DialogTitle>预览抽取结果</DialogTitle>
          <DialogDescription>
            先确认条目和评级识别，再进入对照。不会写入已保存的建设清单。未命中的条目可在对照里再手动触发 AI 初匹配。
          </DialogDescription>
        </DialogHeader>

        {busy || !preview ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在从文件抽取条目（本地规则，不调用模型）…
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{kindLabel(preview.kind)}</span>
              <span className="text-muted-foreground">{preview.fileName}</span>
              <span className="text-muted-foreground">共 {preview.items.length} 条</span>
            </div>

            {preview.rating.labels.length > 0 && (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2" data-testid="req-extract-ratings">
                <p className="text-xs font-medium text-foreground">识别到的评级目标</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {preview.rating.labels.map((l) => (
                    <span key={l} className="rounded-md border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[11px] text-primary">
                      {l}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  组合口径为并集：五级四甲 = 病历五级或互联互通四甲，不会当成智慧管理。
                </p>
              </div>
            )}

            {preview.warnings.map((w) => (
              <p key={w} className="text-[11px] text-muted-foreground">
                {w}
              </p>
            ))}

            {hasItems && (
              <div className="max-h-64 overflow-auto rounded-md border border-border">
                <ul className="divide-y divide-border">
                  {preview.items.map((it, idx) => (
                    <li key={it.norm} className="flex items-start gap-2 px-3 py-1.5">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={checked[it.norm] !== false}
                        aria-label={`选中 ${it.raw}`}
                        onChange={(e) => setChecked((prev) => ({ ...prev, [it.norm]: e.target.checked }))}
                      />
                      <span className="w-6 shrink-0 text-[11px] text-muted-foreground">{idx + 1}</span>
                      <span>{it.raw}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <div className="flex flex-wrap gap-2">
            {hasRating && (
              <Button
                type="button"
                variant={hasItems ? "outline" : "default"}
                data-testid="req-extract-confirm-rating"
                disabled={busy || !preview}
                onClick={() =>
                  preview &&
                  onConfirm({
                    items: [],
                    ratingSel: preview.rating.selection,
                    context: preview.context,
                  })
                }
              >
                按评级筛选公司清单
              </Button>
            )}
            {hasItems && (
              <Button
                type="button"
                data-testid="req-extract-confirm-compare"
                disabled={busy || !preview || selected.length === 0}
                onClick={() =>
                  preview &&
                  onConfirm({
                    items: selected,
                    ratingSel: preview.rating.selection,
                    context: preview.context,
                  })
                }
              >
                进入对照（{selected.length} 条）
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

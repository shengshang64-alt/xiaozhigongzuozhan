import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  maskInstitutionName,
  type ModuleChapterDraft,
  type StandardChapterPreview,
} from "@/pages/SolutionStudio/standardChapters"

// ---------------------------------------------------------------------------
// 标准章节预览：展示按模块归并的来源、合并正文和缺项。
// 确认只会带入新建方案的大纲/骨架，不会覆盖已有方案正文。验收可只预览。
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: ModuleChapterDraft["status"] }) {
  const map = {
    ok: { label: "已整理", className: "border-emerald-300 bg-emerald-50 text-emerald-800" },
    thin: { label: "素材偏少", className: "border-amber-300 bg-amber-50 text-amber-900" },
    missing: { label: "缺项", className: "border-destructive/40 bg-destructive/10 text-destructive" },
  }
  const m = map[status]
  return <span className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${m.className}`}>{m.label}</span>
}

export function StandardChaptersDialog({
  preview,
  busy,
  onClose,
  onConfirm,
}: {
  preview: StandardChapterPreview | null
  busy?: boolean
  onClose: () => void
  onConfirm?: (preview: StandardChapterPreview) => void
}) {
  return (
    <Dialog open={Boolean(preview) || Boolean(busy)} onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto" data-testid="standard-chapters-dialog">
        <DialogHeader>
          <DialogTitle>预览标准章节</DialogTitle>
          <DialogDescription>
            按已确认模块，整理知识库里已审核的素材。先核对企业来源和缺项，确认后才带入新建方案的大纲骨架，不会覆盖已有方案正文，也不会用模型编造缺项段落。
          </DialogDescription>
        </DialogHeader>

        {busy || !preview ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在按模块检索已审核知识原子并整理（本地归并，不调用模型）…
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{preview.title}</span>
              <span>已整理 {preview.stats.ok}</span>
              <span>素材偏少 {preview.stats.thin}</span>
              <span>缺项 {preview.stats.missing}</span>
            </div>
            {preview.warnings.map((w) => (
              <p key={w} className="text-[11px] text-muted-foreground">
                {w}
              </p>
            ))}
            <div className="max-h-[52vh] space-y-2 overflow-auto pr-1">
              {preview.modules.map((m) => (
                <section key={m.moduleKey} className="rounded-md border border-border px-3 py-2" data-testid="standard-chapter-module" data-module-title={m.moduleTitle} data-status={m.status}>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium text-foreground">{m.moduleTitle}</h3>
                    <StatusBadge status={m.status} />
                  </div>
                  {m.gapReason ? <p className="mt-1 text-[12px] text-muted-foreground">{m.gapReason}</p> : null}
                  {m.body ? (
                    <pre className="mt-2 whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-foreground/90">{maskInstitutionName(m.body)}</pre>
                  ) : null}
                  {m.sources.length > 0 ? (
                    <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                      {m.sources.map((s, i) => (
                        <li key={`${s.id}-${i}`}>
                          来源 {i + 1}：{maskInstitutionName(s.docName || s.title)}
                          {s.anchor ? ` · ${s.anchor}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy} data-testid="standard-chapters-close">
            关闭预览
          </Button>
          {onConfirm && preview && !busy ? (
            <Button
              type="button"
              data-testid="standard-chapters-confirm"
              onClick={() => onConfirm(preview)}
              title="带入新建方案大纲骨架，不会覆盖已有方案"
            >
              带入方案大纲骨架
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useRef, useState } from "react"
import { FolderOpen, ImagePlus, Loader2, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FIGURE_TEMPLATE_KIND_LABEL, type FigureTemplate, type FigureTemplateKind } from "@/pages/BidWorkspace/figureAssets"

// ---------------------------------------------------------------------------
// 2026-10 配图需求轮：章节配图区工具——上传本地截图/架构图/流程图 + 图模板库复用。
// 上传与落库逻辑在 useBidWorkspace（uploadChapterFigure / insertFigureTemplate /
// removeFigureTemplateById），本组件只做文件选择与模板清单展示。
// ---------------------------------------------------------------------------

type FigureInsertToolsProps = {
  disabled?: boolean
  busy?: boolean
  templates: FigureTemplate[]
  onUpload: (file: File) => void
  onInsert: (t: FigureTemplate) => void
  onRemove: (id: string) => void
}

const KIND_ORDER: FigureTemplateKind[] = ["architecture", "flow", "screenshot"]

export function FigureInsertTools({ disabled, busy, templates, onUpload, onInsert, onRemove }: FigureInsertToolsProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [libOpen, setLibOpen] = useState(false)
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onUpload(f)
          e.target.value = ""
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || busy}
        onClick={() => fileRef.current?.click()}
        title="上传本地截图/架构图/流程图，插入本章并自动存入模板库"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
        上传插图
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled || busy}
        onClick={() => setLibOpen(true)}
        title="从模板库插入（跨项目复用）"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        模板库{templates.length ? `（${templates.length}）` : ""}
      </Button>
      <Dialog open={libOpen} onOpenChange={setLibOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4" /> 图模板库
            </DialogTitle>
            <DialogDescription>
              上传过的架构图 / 流程图 / 系统截图都自动存在这里，换项目也能一键插入本章（导出 Word 时随配图插入正文）。
            </DialogDescription>
          </DialogHeader>
          {templates.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
              模板库还是空的——点「上传插图」传一张试试，会自动登记进来。
            </p>
          ) : (
            <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
              {KIND_ORDER.map((kind) => {
                const list = templates.filter((t) => t.kind === kind)
                if (!list.length) return null
                return (
                  <div key={kind} className="space-y-1.5">
                    <p className="text-xs font-semibold text-foreground">{FIGURE_TEMPLATE_KIND_LABEL[kind]}</p>
                    {list.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
                        <img src={t.url} alt="" loading="lazy" className="h-10 w-16 shrink-0 rounded border border-border object-cover" />
                        <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={t.name}>
                          {t.name}
                        </span>
                        <Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={() => onInsert(t)}>
                          插入本章
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => onRemove(t.id)}
                          title="从模板库移除（不影响已插入章节的图）"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

import { useEffect, useState } from "react"
import { Check, FileStack, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { FormatSettings } from "@/pages/BidWorkspace/bidTypes"
import { extractDocxFormat, extractedToFields, type FormatField } from "@/pages/BidWorkspace/bidDocxFormatExtract"

const AUTO_KEY = "xiaozhi.bid.formatSync.auto.v1"

type Props = {
  open: boolean
  file: File | null
  current: FormatSettings | null
  onClose: () => void
  onApply: (patch: Partial<FormatSettings>, autoNextTime: boolean) => void
}

export function FormatSyncDialog({ open, file, current, onClose, onApply }: Props) {
  const [busy, setBusy] = useState(false)
  const [fields, setFields] = useState<FormatField[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [autoNext, setAutoNext] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open || !file) {
      setFields([]); setSelected(new Set()); setError("")
      return
    }
    setBusy(true)
    setAutoNext(localStorage.getItem(AUTO_KEY) === "1")
    void extractDocxFormat(file)
      .then((ext) => {
        const fs = extractedToFields(ext)
        setFields(fs)
        setSelected(new Set(fs.map((f) => f.key)))
        if (!fs.length) setError("未从这份 docx 里提取到可识别的格式（可能是扫描版或无样式模板）")
      })
      .catch((e) => setError(e instanceof Error ? e.message : "格式提取失败"))
      .finally(() => setBusy(false))
  }, [open, file])

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const apply = () => {
    const patch: Partial<FormatSettings> = {}
    for (const f of fields) if (selected.has(f.key)) f.apply(patch)
    if (autoNext) localStorage.setItem(AUTO_KEY, "1")
    else localStorage.removeItem(AUTO_KEY)
    onApply(patch, autoNext)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileStack className="h-4 w-4 text-primary" />
            从底稿同步格式
          </DialogTitle>
          <DialogDescription>
            从「{file?.name ?? "底稿"}」提取到 {fields.length} 项格式设置。勾选要应用的项，点"应用"合并到本项目的格式配置。
          </DialogDescription>
        </DialogHeader>

        {busy && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在解析 docx 样式表...
          </div>
        )}
        {error && !busy && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>
        )}
        {!busy && !error && fields.length > 0 && (
          <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground">
                <tr>
                  <th className="w-8 px-2 py-1.5"></th>
                  <th className="px-2 py-1.5 text-left font-medium">项</th>
                  <th className="px-2 py-1.5 text-left font-medium">当前</th>
                  <th className="px-2 py-1.5 text-left font-medium">底稿提取值</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => {
                  const cur = current ? currentValue(f.key, current) : "-"
                  const isSel = selected.has(f.key)
                  return (
                    <tr key={f.key} className="border-t border-border hover:bg-secondary/30">
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => toggle(f.key)}
                          className={`inline-flex h-4 w-4 items-center justify-center rounded border ${isSel ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}
                          aria-label={isSel ? "取消选中" : "选中"}
                        >
                          {isSel && <Check className="h-3 w-3" />}
                        </button>
                      </td>
                      <td className="px-2 py-1.5 font-medium text-foreground">{f.label}</td>
                      <td className="px-2 py-1.5 text-muted-foreground line-through decoration-muted-foreground/40">{cur}</td>
                      <td className="px-2 py-1.5 text-foreground" title={f.evidence ?? ""}>
                        <span className="font-mono text-xs">{f.value}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={autoNext}
            onChange={(e) => setAutoNext(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#0e9f8a]"
          />
          下次上传底稿时自动应用全部提取项（不再弹此窗）
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            onClick={apply}
            disabled={busy || !selected.size}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            应用 {selected.size} 项格式
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function currentValue(key: string, s: FormatSettings): string {
  switch (key) {
    case "paper": return s.paper
    case "margins": {
      const m = s.margins
      return `上${m.top} 下${m.bottom} 左${m.left} 右${m.right} cm`
    }
    case "bodyFont": return s.body?.font ?? "-"
    case "bodySize": return s.body?.size ?? "-"
    case "bodyLineSpacing": return s.body?.lineSpacing ?? "-"
    default: {
      const mm = /^heading([1-6])$/.exec(key)
      if (mm) {
        const h = s.heading?.[Number(mm[1]) - 1]
        if (!h) return "-"
        const parts: string[] = []
        if (h.font) parts.push(`字体 ${h.font}`)
        if (h.size) parts.push(`字号 ${h.size}`)
        return parts.join(" . ") || "-"
      }
      return "-"
    }
  }
}

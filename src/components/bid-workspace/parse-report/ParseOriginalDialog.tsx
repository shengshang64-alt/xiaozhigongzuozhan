import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MapPin } from "lucide-react"
import { locateOriginal, type OriginalHit } from "./parseOriginalLocator"

/**
 * 解析页「原文定位」弹窗（只读）。
 *
 * 用途：风险卡片 / 隐式硬约束 / ★▲ 条款里的「看原文」入口统一走这里——
 * 用户拿到一条结论后，第一件事是回招标原文核一眼，而不是再读一遍结论。
 * 面板只读招标原文，不改任何解析结果，也不写库。
 */
export function ParseOriginalDialog({
  open,
  onClose,
  tenderText,
  title,
  line,
  excerpt,
}: {
  open: boolean
  onClose: () => void
  /** 招标文件全文（不传/空时弹窗给出「没有保留原文」的口径） */
  tenderText: string | undefined
  /** 结论简称（弹窗标题用） */
  title: string
  /** 解析/扫描记录的 1 起行号；0 表示没有 */
  line?: number
  /** 原文摘录（无行号时用它本地检索） */
  excerpt?: string
}) {
  const hit: OriginalHit = locateOriginal(tenderText, { line, excerpt, context: 3 })
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl rounded-2xl border-border bg-card shadow-lg">
        <DialogHeader>
          <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-primary">
            <MapPin className="h-3.5 w-3.5" />
            回招标原文核对
          </p>
          <DialogTitle className="text-lg leading-snug text-foreground">{title}</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">{hit.note}</DialogDescription>
        </DialogHeader>
        {hit.how === "none" ? (
          <p className="rounded-md border border-dashed border-border bg-background px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">
            没有可定位的原文位置。可以到第 1 步「招标文件」里用关键词搜索，或重新导入原文后再解析。
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
              <span>
                {hit.how === "line" ? "按行号定位" : "按原文摘录定位"} · 命中第 {hit.line} 行
              </span>
              <span>
                显示第 {hit.from}–{hit.to} 行
              </span>
            </div>
            <ol className="max-h-[26rem] overflow-y-auto bg-background">
              {hit.rows.map((r) => (
                <li
                  key={r.no}
                  className={`flex gap-3 border-b border-border/40 px-3 py-1.5 text-sm leading-relaxed last:border-0 ${
                    r.hit ? "bg-warning/15 font-medium text-foreground" : "text-foreground/80"
                  }`}
                >
                  <span className="w-12 shrink-0 select-none text-right text-xs tabular-nums text-muted-foreground">
                    {r.no}
                  </span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                    {r.text || <span className="text-muted-foreground/60">（空行）</span>}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

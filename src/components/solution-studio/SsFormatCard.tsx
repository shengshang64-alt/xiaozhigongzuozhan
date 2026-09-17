import { FileCog } from "lucide-react"
import { PAPER_OPTIONS, type FormatPaper, type FormatSettings } from "@/pages/BidWorkspace/bidTypes"

type SsFormatCardProps = {
  fmt: FormatSettings
  onPatch: (patch: Partial<FormatSettings>) => void
}

const MARGIN_FIELDS: { key: "top" | "bottom" | "left" | "right"; label: string }[] = [
  { key: "top", label: "上" },
  { key: "bottom", label: "下" },
  { key: "left", label: "左" },
  { key: "right", label: "右" },
]

/** 循环 9 C2：方案导出页面格式简版设置卡（纸张/页边距/页码；按方案存 localStorage，导出 Word 生效） */
export function SsFormatCard({ fmt, onPatch }: SsFormatCardProps) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-md">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <FileCog className="h-4 w-4 text-primary" />
        导出页面格式
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">导出 Word 时生效：纸张、页边距与页码；按方案保存，刷新不丢</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          纸张
          <select
            value={fmt.paper}
            onChange={(e) => onPatch({ paper: e.target.value as FormatPaper })}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {PAPER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {MARGIN_FIELDS.map((m) => (
          <label key={m.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            边距{m.label}(cm)
            <input
              type="number"
              min={0.5}
              max={6}
              step={0.1}
              value={fmt.margins[m.key]}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isFinite(n)) return
                onPatch({ margins: { ...fmt.margins, [m.key]: Math.min(6, Math.max(0.5, n)) } })
              }}
              className="h-8 w-16 rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
        ))}
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={fmt.pageNumber}
            onChange={(e) => onPatch({ pageNumber: e.target.checked })}
            className="h-4 w-4 accent-primary"
          />
          页脚页码
        </label>
      </div>
    </section>
  )
}

import { useState } from "react"
import { PencilLine, Save } from "lucide-react"
import type { IntelItemRow, IntelStructured } from "@/pages/IntelCenter/useIntelCenter"

type Props = {
  item: IntelItemRow
  onSave: (item: IntelItemRow, structured: IntelStructured) => Promise<boolean>
}

const FIELDS: Array<{ key: keyof IntelStructured; label: string; placeholder: string }> = [
  { key: "buyer", label: "采购人", placeholder: "如：安徽中医药大学第一附属医院" },
  { key: "code", label: "项目编号", placeholder: "如：2026BFAFZ50845" },
  { key: "budget", label: "预算金额", placeholder: "如：2500万元（不确定请留空）" },
  { key: "deadline", label: "投标截止", placeholder: "如：2026-11-20 09:30" },
  { key: "winner", label: "中标人", placeholder: "中标公告可填" },
  { key: "won_amount", label: "中标金额", placeholder: "如：890.5万元" },
]

/** 招标要素人工补正：抓不到正文时也能依据原文补齐；留空字段表示未知，不臆造。 */
export function IntelStructuredEditor({ item, onSave }: Props) {
  const [open, setOpen] = useState(() => !item.structured?.deadline || !item.structured?.budget)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<IntelStructured>(() => ({ ...(item.structured ?? {}) }))

  const submit = async () => {
    setBusy(true)
    const cleaned: IntelStructured = {}
    for (const { key } of FIELDS) {
      const value = String(form[key] ?? "").trim()
      if (value) cleaned[key] = value
    }
    const ok = await onSave(item, cleaned)
    if (ok) setOpen(false)
    setBusy(false)
  }

  return (
    <section className="mt-3.5 rounded-lg border border-dashed border-primary/35 bg-primary/5 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <PencilLine className="h-3.5 w-3.5" />
        {open ? "收起人工补正" : "补正招标要素"}
      </button>
      {open && (
        <div className="mt-2.5">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            请对照「查看原文」补录；留空表示原文未明确，保存后用于截止提醒与新建标书任务预填。
          </p>
          <div className="mt-2 grid gap-2">
            {FIELDS.map(({ key, label, placeholder }) => (
              <label key={key} className="grid grid-cols-[3.5rem_1fr] items-center gap-2 text-xs">
                <span className="text-muted-foreground">{label}</span>
                <input
                  value={String(form[key] ?? "")}
                  onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="h-8 min-w-0 rounded-md border border-border bg-background px-2 text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Save className="h-3.5 w-3.5" />
            {busy ? "保存中…" : "保存招标要素"}
          </button>
        </div>
      )}
    </section>
  )
}

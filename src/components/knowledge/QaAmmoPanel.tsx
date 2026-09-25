// 弹药库页签（轮次 D-3）：approved QA 对列表 + 新增表单 + 行内编辑 + 删除确认。
import { useState } from "react"
import { Check, Copy, Loader2, Plus, ShieldCheck, Pencil, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { KB_CATEGORIES } from "@/lib/kbPolicy"
import type { KbQaPairRow } from "@/lib/kbQa"

type QaAmmoPanelProps = {
  approvedPairs: KbQaPairRow[]
  loading: boolean
  createQaPair: (question: string, answer: string, category: string, visibility: string) => Promise<boolean>
  updateQaPair: (
    row: KbQaPairRow,
    patch: Partial<Pick<KbQaPairRow, "question" | "answer" | "category" | "visibility">>,
  ) => Promise<boolean>
  deleteQaPair: (row: KbQaPairRow) => Promise<void>
}

const EMPTY_FORM = { question: "", answer: "", category: "其他", visibility: "team" }

function VisibilityPills({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-muted p-0.5">
      {(
        [
          { key: "team", label: "团队可见" },
          { key: "personal", label: "仅自己" },
        ] as const
      ).map((opt) => (
        <button
          key={opt.key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.key)}
          className={`rounded-full px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            value === opt.key
              ? "bg-card font-medium text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function QaAmmoPanel({ approvedPairs, loading, createQaPair, updateQaPair, deleteQaPair }: QaAmmoPanelProps) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ question: "", answer: "", category: "其他", visibility: "team" })
  const [deleteTarget, setDeleteTarget] = useState<KbQaPairRow | null>(null)

  const submitCreate = async () => {
    if (saving) return
    setSaving(true)
    const ok = await createQaPair(form.question, form.answer, form.category, form.visibility)
    setSaving(false)
    if (ok) {
      setForm({ ...EMPTY_FORM })
      setShowForm(false)
    }
  }

  const startEdit = (row: KbQaPairRow) => {
    setEditingId(row.id)
    setEditForm({
      question: row.question ?? "",
      answer: row.answer ?? "",
      category: KB_CATEGORIES.includes(row.category as never) ? row.category : "其他",
      visibility: row.visibility === "personal" ? "personal" : "team",
    })
  }

  const submitEdit = async (row: KbQaPairRow) => {
    if (saving) return
    setSaving(true)
    const ok = await updateQaPair(row, editForm)
    setSaving(false)
    if (ok) setEditingId(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          已审批的标准问答（{approvedPairs.length} 条），高置信命中时直接出答案、不产生 AI 费用
        </p>
        <Button
          size="sm"
          variant={showForm ? "outline" : "default"}
          onClick={() => setShowForm((v) => !v)}
          className={showForm ? "h-7 gap-1 text-xs" : "h-7 gap-1 bg-primary text-xs text-primary-foreground shadow-sm"}
        >
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? "收起" : "新增问答"}
        </Button>
      </div>

      {showForm ? (
        <div className="animate-in fade-in slide-in-from-top-2 space-y-2 rounded-lg border border-primary/30 bg-background p-3 shadow-md duration-300">
          <input
            value={form.question}
            onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
            placeholder="标准问题（必填），例如：互联互通评级需要哪些材料？"
            aria-label="标准问题"
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <textarea
            value={form.answer}
            onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
            placeholder="标准答案（必填），团队认可的统一口径…"
            aria-label="标准答案"
            rows={4}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              aria-label="问答分类"
              className="h-8 cursor-pointer rounded-md border border-border bg-background px-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {KB_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <VisibilityPills value={form.visibility} onChange={(v) => setForm((f) => ({ ...f, visibility: v }))} />
            <Button
              size="sm"
              onClick={() => void submitCreate()}
              disabled={saving || !form.question.trim() || !form.answer.trim()}
              className="h-8 gap-1 bg-primary text-xs text-primary-foreground shadow-sm transition-all hover:shadow-md"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              入库
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          正在加载弹药库…
        </div>
      ) : approvedPairs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <ShieldCheck className="h-7 w-7 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">弹药库还是空的</p>
          <p className="max-w-64 text-xs leading-relaxed text-muted-foreground">
            把团队认可的标准问答沉淀进来，问知识库时高置信命中直接出答案，不产生 AI 费用
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {approvedPairs.map((row) => (
            <li key={row.id} className="rounded-lg border border-border bg-background p-2.5 shadow-sm">
              {editingId === row.id ? (
                <div className="space-y-2">
                  <input
                    value={editForm.question}
                    onChange={(e) => setEditForm((f) => ({ ...f, question: e.target.value }))}
                    aria-label="编辑问题"
                    className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                  <textarea
                    value={editForm.answer}
                    onChange={(e) => setEditForm((f) => ({ ...f, answer: e.target.value }))}
                    aria-label="编辑答案"
                    rows={4}
                    className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <select
                      value={editForm.category}
                      onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                      aria-label="编辑分类"
                      className="h-8 cursor-pointer rounded-md border border-border bg-background px-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {KB_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <VisibilityPills
                      value={editForm.visibility}
                      onChange={(v) => setEditForm((f) => ({ ...f, visibility: v }))}
                    />
                    <span className="flex items-center gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="h-7 text-xs">
                        取消
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void submitEdit(row)}
                        disabled={saving || !editForm.question.trim() || !editForm.answer.trim()}
                        className="h-7 gap-1 bg-primary text-xs text-primary-foreground"
                      >
                        <Check className="h-3 w-3" />
                        保存
                      </Button>
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 text-sm font-semibold text-foreground">{row.question}</p>
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText("问：" + row.question + "\n答：" + row.answer).then(
                            () => toast.success("已复制问答，可直接发给客户"),
                            () => toast.error("复制失败，请手动选择文本"),
                          )
                        }}
                        aria-label="复制这条问答"
                        title="复制问答"
                        className="rounded p-1 text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(row)}
                        aria-label="编辑这条问答"
                        className="rounded p-1 text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(row)}
                        aria-label="删除这条问答"
                        className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{row.answer}</p>
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs">
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-primary">{row.category || "其他"}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 ${
                        row.visibility === "personal" ? "bg-muted text-muted-foreground" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {row.visibility === "personal" ? "仅自己" : "团队可见"}
                    </span>
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="删除问答对"
        description={deleteTarget ? `确定删除「${deleteTarget.question}」吗？删除后不再参与命中。` : ""}
        confirmText="删除"
        tone="danger"
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (target) void deleteQaPair(target)
        }}
      />
    </div>
  )
}

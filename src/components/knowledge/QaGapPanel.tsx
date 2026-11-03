// 待补答页签（轮次 D-3）：检索 0 命中自动入队的问题列表，行内补答 → 入弹药库 / 删除。
import { useState } from "react"
import { Check, HelpCircle, Loader2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { KB_CATEGORIES } from "@/lib/kbPolicy"
import type { KbQaPairRow } from "@/lib/kbQa"
import { formatDateTimeDisplay } from "@/lib/dateDisplay"

type QaGapPanelProps = {
  pendingPairs: KbQaPairRow[]
  loading: boolean
  approveQaPending: (row: KbQaPairRow, answer: string, category: string) => Promise<boolean>
  deleteQaPair: (row: KbQaPairRow) => Promise<void>
}

function formatTime(iso: string): string {
  return formatDateTimeDisplay(iso)
}

export function QaGapPanel({ pendingPairs, loading, approveQaPending, deleteQaPair }: QaGapPanelProps) {
  const [expandingId, setExpandingId] = useState<string | null>(null)
  const [answerDraft, setAnswerDraft] = useState("")
  const [categoryDraft, setCategoryDraft] = useState("其他")
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<KbQaPairRow | null>(null)

  const openFill = (row: KbQaPairRow) => {
    setExpandingId(row.id)
    setAnswerDraft(row.answer ?? "")
    setCategoryDraft(KB_CATEGORIES.includes(row.category as never) ? row.category : "其他")
  }

  const submitFill = async (row: KbQaPairRow) => {
    if (saving) return
    setSaving(true)
    const ok = await approveQaPending(row, answerDraft, categoryDraft)
    setSaving(false)
    if (ok) setExpandingId(null)
  }

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <HelpCircle className="h-3.5 w-3.5 text-primary" />
        问知识库没命中、或在回答上点「答得不对」的问题会记入这里，补上答案入库后，下次同样的问题直接命中
      </p>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          正在加载…
        </div>
      ) : pendingPairs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <Check className="h-7 w-7 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">没有待补答的问题</p>
          <p className="max-w-60 text-xs leading-relaxed text-muted-foreground">
            知识库覆盖得不错；后续提问没命中时会自动记录到这里
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {pendingPairs.map((row) => (
            <li key={row.id} className="rounded-lg border border-border bg-background p-2.5 shadow-sm">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {row.question}
                    {/* 轮次 4 B1：来源为「答得不对」负反馈的条目加小徽标（复用现有 source 字段，零 collection 变更） */}
                    {row.source === "user_feedback" ? (
                      <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full bg-primary/10 px-1.5 py-0.5 align-middle text-xs font-medium text-primary">
                        反馈
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    记录于 {formatTime(row.created)} · {row.visibility === "personal" ? "仅自己" : "团队可见"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(row)}
                  aria-label="删除这条待补答"
                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {expandingId === row.id ? (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={answerDraft}
                    onChange={(e) => setAnswerDraft(e.target.value)}
                    placeholder="补上团队认可的标准答案…"
                    aria-label="补充答案"
                    rows={4}
                    className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <select
                      value={categoryDraft}
                      onChange={(e) => setCategoryDraft(e.target.value)}
                      aria-label="问答分类"
                      className="h-8 cursor-pointer rounded-md border border-border bg-background px-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {KB_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <span className="flex items-center gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setExpandingId(null)} className="h-7 text-xs">
                        取消
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void submitFill(row)}
                        disabled={saving || !answerDraft.trim()}
                        className="h-7 gap-1 bg-primary text-xs text-primary-foreground"
                      >
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        入库
                      </Button>
                    </span>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openFill(row)}
                  className="mt-2 h-7 gap-1 border-primary/40 text-xs text-primary hover:bg-primary/10 hover:text-primary"
                >
                  <Check className="h-3 w-3" />
                  补答
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="移除待补答"
        description={deleteTarget ? `确定移除「${deleteTarget.question}」吗？` : ""}
        confirmText="移除"
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

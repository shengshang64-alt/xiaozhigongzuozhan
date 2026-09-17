// 文档「分类与 AI 策略」块（轮次 D-1）：分类 select + AI 上下文模式三选 +
// 检索权重滑杆（0.1–3）+ 敏感开关；改动经 useKnowledge.updateDocPolicy 防抖 PATCH。
import { ShieldAlert, SlidersHorizontal } from "lucide-react"
import {
  AI_CONTEXT_MODE_LABELS,
  categoryOf,
  effectivePolicy,
  KB_CATEGORIES,
  type AiContextMode,
} from "@/lib/kbPolicy"
import type { KbDocRow } from "@/lib/kbCore"

type DocPolicyPatch = Partial<
  Pick<KbDocRow, "doc_category" | "ai_context_mode" | "retrieval_weight" | "is_sensitive">
>

type DocPolicySectionProps = {
  doc: KbDocRow
  editable: boolean
  updateDocPolicy: (doc: KbDocRow, patch: DocPolicyPatch) => void
}

const MODE_ORDER: AiContextMode[] = ["original", "sanitized_summary", "blocked"]

export function DocPolicySection({ doc, editable, updateDocPolicy }: DocPolicySectionProps) {
  const policy = effectivePolicy(doc)

  const patchPolicy = (next: { mode?: AiContextMode; weight?: number; sensitive?: boolean }) => {
    // 策略字段一旦显式改动，三字段一起写死，避免半显式半默认造成歧义
    updateDocPolicy(doc, {
      ai_context_mode: next.mode ?? policy.ai_context_mode,
      retrieval_weight: next.weight ?? policy.retrieval_weight,
      is_sensitive: next.sensitive ?? policy.is_sensitive,
    })
  }

  return (
    <section className="shrink-0 space-y-2.5 border-b border-border bg-muted/30 px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
        分类与 AI 策略
        {!editable ? <span className="font-normal text-muted-foreground">（仅可编辑者能调整）</span> : null}
      </p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">分类</span>
          <select
            value={categoryOf(doc)}
            disabled={!editable}
            onChange={(e) => updateDocPolicy(doc, { doc_category: e.target.value })}
            aria-label="文档分类"
            className="h-8 min-w-0 flex-1 cursor-pointer rounded-md border border-border bg-background px-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {KB_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">AI 上下文</span>
          <div className="flex min-w-0 flex-1 items-center gap-1 rounded-full bg-muted p-0.5">
            {MODE_ORDER.map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={!editable}
                onClick={() => patchPolicy({ mode })}
                aria-pressed={policy.ai_context_mode === mode}
                className={`flex-1 rounded-full px-1.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed ${
                  policy.ai_context_mode === mode
                    ? mode === "blocked"
                      ? "bg-card font-medium text-destructive shadow-sm"
                      : "bg-card font-medium text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {AI_CONTEXT_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">检索权重</span>
          <input
            type="range"
            min={0.1}
            max={3}
            step={0.1}
            value={policy.retrieval_weight}
            disabled={!editable}
            onChange={(e) => patchPolicy({ weight: Number(e.target.value) })}
            aria-label="检索权重"
            className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed"
          />
          <span className="w-8 shrink-0 text-right font-mono text-xs text-foreground">
            {policy.retrieval_weight.toFixed(1)}
          </span>
        </label>
        <button
          type="button"
          disabled={!editable}
          onClick={() => patchPolicy({ sensitive: !policy.is_sensitive })}
          aria-pressed={policy.is_sensitive}
          className={`flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60 ${
            policy.is_sensitive
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-border bg-background text-muted-foreground hover:text-foreground"
          }`}
        >
          <ShieldAlert className="h-3.5 w-3.5" />
          {policy.is_sensitive ? "敏感资料（默认不进 AI 原文）" : "标记为敏感资料"}
        </button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        脱敏摘要：问答与小智只引用摘要不出现原文；禁止进 AI：完全不参与检索。合同商务、资质证书分类默认脱敏。
      </p>
    </section>
  )
}

import { Check } from "lucide-react"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import { PIPELINE_STEPS, stepEntryMissing, stepGateConfirmed, type BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"

type PipelineStepperProps = Pick<UseBidWorkspace, "activeStep" | "requestStep" | "activeProject">

function stepDone(step: number, proj: BidProjectRecord | null): boolean {
  if (!proj) return false
  if (step === 1) return (proj.tender_text ?? "").trim().length > 0
  if (step === 2) return !!proj.parse_report
  if (step === 3) return proj.bid_chapters.some((c) => (c.content ?? "").trim().length > 0)
  if (step === 4) return !!proj.dup_report
  if (step === 5) return !!proj.void_check
  if (step === 6) return !!proj.ai_review
  if (step === 7) return proj.stage === "archived"
  return false
}

export function PipelineStepper({ activeStep, requestStep, activeProject }: PipelineStepperProps) {
  return (
    <nav className="mx-auto max-w-7xl px-4 pt-5">
      <ol className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-border bg-card p-2 shadow-md">
        {PIPELINE_STEPS.map((s) => {
          const isActive = s.step === activeStep
          const done = stepDone(s.step, activeProject)
          // 第九轮改造 1：该步骤对应的交卷闸门已确认时，图标右上角加小勾徽标（只提示不拦导航）
          const gateOk = stepGateConfirmed(s.step, activeProject?.stage_gates ?? null)
          // 第十一轮改造 3：步骤准入按产物判定——前置产物缺失时点击 toast 说明缺什么，就绪即放行
          const entryMissing = stepEntryMissing(s.step, activeProject)
          // A2-9：前置步骤未完成时，用 tooltip 说明该先做哪一步（放行逻辑以产物为准）
          const missingPrev = activeProject
            ? PIPELINE_STEPS.filter((x) => x.step < s.step).find((x) => !stepDone(x.step, activeProject))
            : undefined
          const stepTitle = entryMissing
            ? `${s.short}：${entryMissing}`
            : missingPrev && !done
              ? `${s.short}：建议先完成「第${missingPrev.step}步 · ${missingPrev.label}」`
              : s.short
          return (
            <li key={s.step} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => requestStep(s.step)}
                title={stepTitle}
                className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  isActive
                    ? "border border-primary/40 bg-primary/10 text-primary"
                    : "border border-transparent text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
                }`}
              >
                <span
                  className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    done
                      ? "bg-primary text-primary-foreground"
                      : isActive
                        ? "border border-primary text-primary"
                        : "border border-border bg-muted text-muted-foreground"
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : s.step}
                  {gateOk && (
                    <span
                      title="该环节交卷闸门已确认"
                      className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-card"
                    >
                      <Check className="h-2.5 w-2.5" />
                    </span>
                  )}
                </span>
                <span className={`truncate text-xs font-medium ${isActive ? "text-primary" : ""}`}>{s.label}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

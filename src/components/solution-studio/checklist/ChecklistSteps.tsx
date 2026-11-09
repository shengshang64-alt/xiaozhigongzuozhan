import { toast } from "sonner"

import type { ChecklistStep } from "@/pages/SolutionStudio/checklistSummary"

export function ChecklistSteps({
  steps,
  onStepClick,
}: {
  steps: ChecklistStep[]
  onStepClick?: (key: 1 | 2 | 3) => void
}) {
  return (
    <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {steps.map((step) => {
        const on = step.state === "on"
        const done = step.state === "done"
        return (
          <button
            key={step.key}
            type="button"
            onClick={() => {
              if (step.lockReason) {
                toast.message(step.lockReason)
                return
              }
              onStepClick?.(step.key)
            }}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              on
                ? "border-primary/40 bg-primary/10"
                : done
                  ? "border-border bg-card"
                  : "border-border bg-card/70 opacity-80"
            }`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                done
                  ? "bg-primary text-primary-foreground"
                  : on
                    ? "border-2 border-primary bg-card text-primary"
                    : "border border-border bg-muted text-muted-foreground"
              }`}
            >
              {step.key}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-foreground">{step.title}</span>
              <span className="block text-[12px] text-muted-foreground">{step.detail}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

import { Check } from "lucide-react"

// ---------------------------------------------------------------------------
// fmt6 分步向导条：①上传文档 → ②选择/微调模板 → ③预览对比 → ④保存套用。
// 步骤状态全部由产物派生（上传成功 / 选中模板 / 识别出 spec / 已保存），纯展示不可点跳。
// ---------------------------------------------------------------------------

const WIZ_STEPS = ["上传文档", "选择标准模板", "预览对比", "保存套用"]

export function FormatWizardStepper({ activeStep, anomalyCount }: { activeStep: number; anomalyCount: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-border bg-card p-2 shadow-md">
      {WIZ_STEPS.map((label, i) => {
        const step = i + 1
        const done = step < activeStep
        const isActive = step === activeStep
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              className={`flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-medium ${
                isActive
                  ? "border border-primary/40 bg-primary/10 text-primary"
                  : done
                    ? "text-primary"
                    : "text-muted-foreground"
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  done ? "bg-primary text-primary-foreground" : isActive ? "border border-primary text-primary" : "border border-border bg-muted text-muted-foreground"
                }`}
              >
                {done ? <Check className="h-3 w-3" /> : step}
              </span>
              <span className="truncate">{label}</span>
              {isActive && step === 3 && anomalyCount > 0 && (
                <span className="shrink-0 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-destructive-foreground">{anomalyCount}</span>
              )}
            </span>
            {i < WIZ_STEPS.length - 1 && <span className="hidden h-px flex-1 bg-border sm:block" />}
          </li>
        )
      })}
    </ol>
  )
}

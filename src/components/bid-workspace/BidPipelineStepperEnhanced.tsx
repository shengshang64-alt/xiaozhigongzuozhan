// 投标七步流程步骤条（UX-v2：严格按 prototype/assets/design.css 的 .steps / .step 复刻）
//
// 原型规格（逐条对齐，勿随意改）：
//   .steps  白底 + 1px 边框 + 圆角 md + 阴影 sh-1 + padding 12/14 + 横向滚动
//   .step   flex-1 + min-width 112px + 24px 数字圆圈 + 两行文字（标题 12.2px / 状态 10.8px）
//   连接线  除最后一项外，绝对定位 1px 线，right:6px、top:12px、宽 calc(100% - 34px)
//   状态    未开始=灰边圈；done=绿底圈；on=主色底圈 + 4px 主色光环；warn=琥珀
//
// 历史说明（2026-11-11 二次修正）：上一版改成「胶囊 + 箭头」是我误读——原型就是
// 圆圈步骤条，胶囊并非原型样式。本次按 design.css 逐值复刻。
// 同时删除两处假内容：「保存草稿(自动)」按钮只有 console.log；「3 小时/45 分钟」
// 时长是拍脑袋演示值。第 3 步只显示真实章进度。
import { Check } from "lucide-react"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"
import { PIPELINE_STEPS, stepGateConfirmed } from "@/pages/BidWorkspace/bidTypes"

/** 检查交卷闸门是否已确认（stage_gates 是 { gates } 对象，委托 bidTypes 权威实现） */
function isGateConfirmed(step: number, project: BidProjectRecord | null): boolean {
  return stepGateConfirmed(step, project?.stage_gates ?? null)
}

/** 检查某步是否完成 */
function stepDone(step: number, project: BidProjectRecord | null): boolean {
  if (!project) return false
  switch (step) {
    case 1: return (project.tender_text ?? "").trim().length > 0
    case 2: return !!project.parse_report
    case 3: return project.bid_chapters.some((c) => (c.content ?? "").trim().length > 0)
    case 4: return !!project.dup_report
    case 5: return !!project.void_check
    case 6: return !!project.ai_review
    case 7: return project.stage === "archived"
    default: return false
  }
}

interface BidPipelineStepperEnhancedProps {
  activeStep: number
  requestStep: (step: number) => void
  activeProject: BidProjectRecord | null
}

export function BidPipelineStepperEnhanced({
  activeStep,
  requestStep,
  activeProject,
}: BidPipelineStepperEnhancedProps) {
  const chapters = activeProject?.bid_chapters
  const doneChapters = (chapters ?? []).filter((c) => (c.content ?? "").trim().length > 0).length

  return (
    <nav
      aria-label="投标七步流程"
      className="flex items-start overflow-x-auto rounded-lg border border-border bg-card px-3.5 py-3 shadow-sm"
    >
      {PIPELINE_STEPS.map((step) => {
        const isCompleted = stepDone(step.step, activeProject)
        const isCurrent = step.step === activeStep
        const gateOk = isCompleted && isGateConfirmed(step.step, activeProject)
        // 第 3 步：真实章进度（唯一有真进度数据的步骤）
        const statusText =
          step.step === 3 && (chapters?.length ?? 0) > 0
            ? `已写 ${doneChapters}/${chapters?.length} 章`
            : isCompleted
              ? "已完成"
              : isCurrent
                ? "进行中"
                : "待开始"

        // 圆圈配色：on > done > 默认（原型的 .step.on / .step.done 优先级）
        const circleClass = isCurrent
          ? "border-primary bg-primary text-primary-foreground shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]"
          : isCompleted
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-card text-muted-foreground"

        return (
          <button
            key={step.step}
            type="button"
            onClick={() => requestStep(step.step)}
            title={step.short}
            className="group/step relative flex min-w-[112px] flex-1 items-start gap-2.5 pr-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {/* 连接线：除最后一项外，right 6px / top 12px / 宽 calc(100% - 34px) */}
            {step.step !== PIPELINE_STEPS.length && (
              <span
                aria-hidden="true"
                className="absolute right-1.5 top-3 h-px w-[calc(100%-34px)] bg-border"
              />
            )}
            {/* 24px 数字圆圈 */}
            <span
              className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] text-[11.5px] font-semibold tabular-nums transition-colors ${circleClass}`}
              aria-hidden="true"
            >
              {isCompleted ? <Check size={12} strokeWidth={3} /> : step.step}
            </span>
            {/* 两行文字：标题 + 状态 */}
            <span className="min-w-0 pt-px">
              <span
                className={`block text-[12.2px] font-semibold leading-[1.35] transition-colors ${
                  isCurrent ? "text-primary" : isCompleted ? "text-card-foreground" : "text-muted-foreground"
                } group-hover/step:text-primary`}
              >
                {step.label}
                {gateOk && (
                  <span className="ml-1 inline-block align-middle text-[10px] text-primary" title="该环节交卷闸门已确认">
                    ✓
                  </span>
                )}
              </span>
              <span className="mt-px block truncate text-[10.8px] text-muted-foreground">{statusText}</span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}

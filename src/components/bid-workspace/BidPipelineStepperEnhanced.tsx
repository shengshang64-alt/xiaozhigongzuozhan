// UX-R3: S1+S2 标书域优化 2026-11-08
// UX-v2（2026-11-11）拆屏：原「当前任务上下文面板」（通栏章节导航 + 快速工具假按钮）整体拆除——
// 同一份 bid_chapters 的树已由 ComposeStep 左栏 BidChapterNavTree 承担（分组/三态字数/快捷动作/
// 商务组卷核对都在那），正文编写屏回到原型 draft.html 的「步骤条在顶 + 左树 + 中写作 + 右栏」。
// UX-v2 视觉收口（同日）：步骤条按 draft.html 重画——大圆圈 + 绝对定位连线在 max-w 容器里会
// 溢出裁切（首尾步骤文字被切），改为紧凑横排小圆点 + flex-wrap；色彩统一全站 token
// （primary/muted），不再 green/blue 硬色。原「操作按钮栏」整块删除：
//   · 「保存草稿 (自动)」是假按钮（仅 console.log，自动保存一直存在）；
//   · 「返回上一步 / 继续编写」与点击步骤跳转重复；
//   · 时长列（“3 小时 / 45 分钟”）为拍脑袋演示值，按铁律删除，只保留第 3 步真实章进度。
import { CheckCircle, CheckCircle2, ChevronRight } from "lucide-react"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"
import { PIPELINE_STEPS, stepGateConfirmed } from "@/pages/BidWorkspace/bidTypes"

// ---------------------------------------------------------------------------
// 辅助函数（TASK-2.1 Bug 2.3：统一放在组件定义之前，定义顺序一目了然）
// ---------------------------------------------------------------------------

// 辅助函数：检查交卷闸门是否已确认
// （TASK-2.1 修复中发现的类型失配：stage_gates 是 { gates: GateRecord[] } 对象而非数组，
// 原按 gateIndex 位置取 confirmed 永远取不到。委托给 bidTypes 的权威实现，
// 与旧 PipelineStepper 同语义：STEP_GATE_MAP 定步骤→闸门映射，findGateRecord 查确认态。）
function isGateConfirmed(step: number, project: BidProjectRecord | null): boolean {
  return stepGateConfirmed(step, project?.stage_gates ?? null)
}

// 辅助函数：检查某步是否完成
function stepDone(step: number, project: BidProjectRecord | null): boolean {
  if (!project) return false
  switch (step) {
    case 1: return (project.tender_text ?? "").trim().length > 0
    case 2: return !!project.parse_report
    case 3: return project.bid_chapters.some(c => (c.content ?? "").trim().length > 0)
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
  return (
    <nav aria-label="投标七步流程" className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
      {PIPELINE_STEPS.map((step, idx) => {
        const isCompleted = stepDone(step.step, activeProject)
        const isCurrent = step.step === activeStep
        const gateOk = isCompleted && isGateConfirmed(step.step, activeProject)
        // 第 3 步显示真实章进度（唯一有真进度数据的步骤）
        const chapters = activeProject?.bid_chapters
        const progressText =
          step.step === 3 && chapters && chapters.length > 0
            ? `${chapters.filter((c) => (c.content ?? "").trim().length > 0).length}/${chapters.length} 章`
            : null
        return (
          <span key={step.step} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => requestStep(step.step)}
              title={isCurrent ? `当前：${step.short}` : isCompleted ? `已完成：${step.short}` : step.short}
              className={`group/step flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                isCurrent
                  ? "border-primary bg-primary/10 font-semibold text-primary"
                  : isCompleted
                    ? "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                  isCompleted ? "bg-primary text-primary-foreground" : isCurrent ? "border border-primary text-primary" : "border border-border text-muted-foreground"
                }`}
                aria-hidden="true"
              >
                {isCompleted ? <CheckCircle size={11} /> : <span className="text-[9px] font-semibold tabular-nums">{step.step}</span>}
              </span>
              <span className="whitespace-nowrap">{step.label}</span>
              {progressText && (
                <span className="rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium tabular-nums text-primary">
                  {progressText}
                </span>
              )}
              {/* 交卷闸门确认徽标 */}
              {gateOk && (
                <CheckCircle2
                  size={11}
                  className="shrink-0 text-primary"
                  aria-label="该环节交卷闸门已确认"
                />
              )}
            </button>
            {idx < PIPELINE_STEPS.length - 1 && (
              <ChevronRight size={12} className="shrink-0 text-muted-foreground/50" aria-hidden="true" />
            )}
          </span>
        )
      })}
    </nav>
  )
}

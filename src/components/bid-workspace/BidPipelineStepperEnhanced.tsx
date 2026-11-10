// UX-R3: S1+S2 标书域优化 2026-11-08
// UX-v2（2026-11-11）拆屏：原「当前任务上下文面板」（通栏章节导航 + 快速工具假按钮）整体拆除——
// 同一份 bid_chapters 的树已由 ComposeStep 左栏 BidChapterNavTree 承担（分组/三态字数/快捷动作/
// 商务组卷核对都在那），正文编写屏回到原型 draft.html 的「步骤条在顶 + 左树 + 中写作 + 右栏」。
import { CheckCircle, Circle, Clock } from "lucide-react"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"
import { PIPELINE_STEPS, stepGateConfirmed } from "@/pages/BidWorkspace/bidTypes"
import { Button } from "@/components/ui/button"

// ---------------------------------------------------------------------------
// 辅助函数（TASK-2.1 Bug 2.3：统一放在组件定义之前，定义顺序一目了然；
// 均为函数声明本可靠提升，此处按脚本要求收敛为「先辅助函数、后组件、最后内部子组件」）
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

// 保存草稿的处理函数
function handleSaveDraft() {
  // TODO: 实现实际的保存逻辑
  console.log('Draft saved at', new Date().toISOString())
}
interface PipelineStepData {
  id: number
  label: string
  shortLabel: string
  status: 'completed' | 'current' | 'pending'
  progress?: { completed: number; total: number; text: string }
  duration?: string
  onJumpToStep?: (stepId: number) => void
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
  // 构建七步数据，包含进度信息
  const pipelineSteps: PipelineStepData[] = PIPELINE_STEPS.map((step) => {
    const isCompleted = stepDone(step.step, activeProject)
    const isCurrent = step.step === activeStep
    const status = isCompleted ? 'completed' : isCurrent ? 'current' : 'pending' as const

    // 为第 3 步（编制投标文件）添加章节进度
    let chapterProgress = undefined
    if (step.step === 3 && activeProject?.bid_chapters) {
      const completedChapters = activeProject.bid_chapters.filter(c =>
        (c.content ?? "").trim().length > 0
      ).length
      const totalChapters = activeProject.bid_chapters.length
      const percentage = totalChapters > 0 ? Math.round((completedChapters / totalChapters) * 100) : 0

      chapterProgress = {
        completed: completedChapters,
        total: totalChapters,
        text: `${percentage}% (${completedChapters}/${totalChapters}章)`
      }
    }

    // 估算完成时间（从实际数据或默认值）
    let estimatedDuration = undefined
    if (isCompleted && step.step <= 3) {
      // 假设：解析招标文件 3 小时，生成大纲 45 分钟，编制取决于章节数
      const durations = ['3 小时', '45 分钟']
      estimatedDuration = durations[step.step - 1] || '进行中'
    }

    return {
      id: step.step,
      label: step.label,
      shortLabel: step.short,
      status,
      progress: chapterProgress,
      duration: estimatedDuration,
      onJumpToStep: (stepId: number) => requestStep(stepId)
    }
  })

  return (
    <div className="space-y-6">
      {/* 主流程步骤条 */}
      <div className="relative">
        {/* 连接线 */}
        <div className="absolute top-12 left-0 right-0 h-1 bg-gray-200 rounded-full"></div>

        <div className="flex justify-between relative z-10">
          {pipelineSteps.map((step) => (
            <div
              key={step.id}
              className="flex flex-col items-center cursor-pointer group w-0"
              onClick={() => step.onJumpToStep?.(step.id)}
            >
              {/* 状态圆圈 */}
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all transform group-hover:scale-110 ${
                  step.status === 'completed'
                    ? 'bg-green-100 shadow-sm'
                    : step.status === 'current'
                      ? 'bg-white border-4 border-blue-500 shadow-lg animate-pulse'
                      : 'bg-gray-100 border-2 border-gray-300'
                }`}
              >
                {step.status === 'completed' && (
                  <CheckCircle size={20} className="text-green-600" />
                )}
                {step.status === 'current' && (
                  <>
                    <Clock size={18} className="text-blue-600" />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="w-2 h-2 bg-blue-500 rounded-full animate-ping"></span>
                    </span>
                  </>
                )}
                {step.status === 'pending' && (
                  <Circle size={18} className="text-gray-400" />
                )}

                {/* 非当前步骤显示步骤号（TASK-2.1 Bug 2.1：!step.status === 'current' 恒为 false，分支永不渲染） */}
                {step.status !== 'current' && !step.progress && (
                  <span className={`absolute font-semibold ${
                    step.status === 'completed' ? 'text-green-600' :
                    'text-gray-400'
                  }`}>
                    {step.id}
                  </span>
                )}

                {/* 交卷闸门确认徽标 */}
                {step.status === 'completed' && isGateConfirmed(step.id, activeProject) && (
                  <span
                    title="该环节交卷闸门已确认"
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-white"
                  >
                    <CheckCircle size={8} className="ml-0.5" />
                  </span>
                )}
              </div>

              {/* 标签信息 */}
              <div className="mt-3 text-center min-w-[80px]">
                <div
                  className={`font-medium text-xs leading-tight mb-1 transition-colors ${
                    step.status === 'current' ? 'text-blue-600' :
                    step.status === 'completed' ? 'text-green-600' :
                    'text-gray-500'
                  }`}
                >
                  {step.label}
                </div>

                {/* 进度/时长信息 */}
                {step.progress ? (
                  <div className="text-xs text-gray-600 mt-1">
                    <div className="font-semibold">{step.progress.text}</div>
                    <div className="mt-0.5 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full"
                        style={{ width: `${(step.progress.completed / step.progress.total) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                ) : step.duration ? (
                  <div className="text-xs text-gray-500 mt-1">{step.duration}</div>
                ) : step.status === 'pending' ? (
                  <div className="text-xs text-gray-400 mt-1">待开始</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 操作按钮栏 */}
      <div className="flex justify-center gap-4 pt-4">
        <Button
          variant="outline"
          onClick={() => {
            if (activeStep > 1) {
              requestStep(activeStep - 1)
            }
          }}
          disabled={activeStep <= 1}
          className="px-6 py-2.5"
        >
          ← 返回上一步
        </Button>

        <Button
          variant="ghost"
          onClick={() => handleSaveDraft()}
          className="px-6 py-2.5 text-gray-600"
        >
          💾 保存草稿 (自动)
        </Button>

        <Button
          onClick={() => {
            if (activeStep < 7) {
              requestStep(activeStep + 1)
            }
          }}
          disabled={activeStep >= 7}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white"
        >
          {activeStep === 7 ? '完成 →' : '继续编写 →'}
        </Button>
      </div>

    </div>
  )
}


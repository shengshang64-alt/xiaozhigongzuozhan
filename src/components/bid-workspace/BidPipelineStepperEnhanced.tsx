// UX-R3: S1+S2 标书域优化 2026-11-08
import { useState } from "react"
import { CheckCircle, ChevronDown, ChevronRight, Circle, Clock } from "lucide-react"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"
import { PIPELINE_STEPS, stepGateConfirmed } from "@/pages/BidWorkspace/bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"
import { Button } from "@/components/ui/button"
import { BizAssemblyCheckDialog } from "@/components/bid-workspace/BizAssemblyCheckDialog"

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

// ---------------------------------------------------------------------------
// UX-R3 S1（2026-11-08）：章节行三态判定 + part 分组
// ---------------------------------------------------------------------------

/** 章节行三态：done=完成（绿）/ partial=部分成稿（蓝，显字数）/ empty=未写（灰） */
type ChapterRowState = "done" | "partial" | "empty"

/**
 * 三态判定（S1 验收口径）：content 非空且达预估字数 80%+ 为完成；非空未达为部分；空为未写。
 * 预算未知（chapterBudgets 未传 / 该章预算 ≤0）时保持旧口径：非空即完成——存量调用方零行为变化。
 */
function chapterRowState(ch: Chapter, budget?: number): ChapterRowState {
  const content = ch.content ?? ""
  if (!content.trim()) return "empty"
  if (!budget || budget <= 0) return "done"
  return content.length >= budget * 0.8 ? "done" : "partial"
}

/** 字数缩写：1234 → "1.2k字"，800 → "800字"（S1 部分成稿行右侧小字） */
function fmtCharCount(len: number): string {
  if (len >= 1000) {
    const k = (len / 1000).toFixed(1).replace(/\.0$/, "")
    return `${k}k字`
  }
  return `${len}字`
}

/**
 * part → 分组（S1）：biz=商务部分 / tech 或缺省=技术部分（与 bidTypes.isBizPart 的
 * 「无 part 一律按技术章」存量语义一致）/ 仅防御性保留其他非空取值入「其他」。
 */
const CHAPTER_GROUPS: { key: string; label: string; match: (part?: string) => boolean }[] = [
  { key: "biz", label: "商务部分", match: (p) => p === "biz" },
  { key: "tech", label: "技术部分", match: (p) => p === "tech" || p == null },
  { key: "other", label: "其他", match: (p) => p != null && p !== "biz" && p !== "tech" },
]

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
  /** UX-R3 S1：当前编辑章 id（行高亮 + 自动展开所在分组）；缺省不高亮、全部分组默认展开 */
  activeChapterId?: string | null
  /** UX-R3 S1：点击章节行切换编辑章 */
  selectChapter?: (nodeId: string) => void
  /** UX-R3 S1：与 bid_chapters 下标对齐的每章预算字数（三态判定用；缺省退化为非空即完成） */
  chapterBudgets?: number[]
  /** UX-R3 S1：行 hover 快捷动作——写 / 续写 / 精修（复用编制页现有生成通道） */
  generateChapter?: (nodeId: string) => void
  continueChapter?: (nodeId: string) => void
  refineChapter?: (nodeId: string, kind: "rewrite" | "expand" | "condense") => void
  /** UX-R3 S4：商务组卷检查「一键补入」（useBidWorkspace.addBizAssemblyItems） */
  addBizAssemblyItems?: (titles: string[]) => void
}

export function BidPipelineStepperEnhanced({
  activeStep,
  requestStep,
  activeProject,
  activeChapterId,
  selectChapter,
  chapterBudgets,
  generateChapter,
  continueChapter,
  refineChapter,
  addBizAssemblyItems
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

      {/* 当前任务上下文面板 */}
      <CurrentTaskContextPanel
        currentStep={activeStep}
        project={activeProject}
        activeChapterId={activeChapterId}
        selectChapter={selectChapter}
        chapterBudgets={chapterBudgets}
        generateChapter={generateChapter}
        continueChapter={continueChapter}
        refineChapter={refineChapter}
        addBizAssemblyItems={addBizAssemblyItems}
      />
    </div>
  )
}

/** 分组渲染单元：组名 + 完成度 + 迷你进度条 + 折叠态下的章节行列表 */
interface ChapterGroupData {
  key: string
  label: string
  rows: { ch: Chapter; idx: number; state: ChapterRowState }[]
}

// 当前任务上下文面板组件
function CurrentTaskContextPanel({
  currentStep,
  project,
  activeChapterId,
  selectChapter,
  chapterBudgets,
  generateChapter,
  continueChapter,
  refineChapter,
  addBizAssemblyItems,
}: {
  currentStep: number
  project: BidProjectRecord | null
  activeChapterId?: string | null
  selectChapter?: (nodeId: string) => void
  chapterBudgets?: number[]
  generateChapter?: (nodeId: string) => void
  continueChapter?: (nodeId: string) => void
  refineChapter?: (nodeId: string, kind: "rewrite" | "expand" | "condense") => void
  addBizAssemblyItems?: (titles: string[]) => void
}) {
  const [userToggled, setUserToggled] = useState<Record<string, boolean>>({})
  // UX-R3 S4：商务组卷检查弹窗开关（纯 UI 状态）
  const [bizCheckOpen, setBizCheckOpen] = useState(false)

  // 只在第 3 步（编制投标文件）显示上下文面板（沿用旧判据：bid_chapters 真值判断，空数组仍渲染空态）
  if (currentStep !== 3 || !project?.bid_chapters) {
    return null
  }

  const chapters = project.bid_chapters
  const indexed = chapters.map((ch, idx) => ({
    ch,
    idx,
    state: chapterRowState(ch, chapterBudgets?.[idx]),
  }))
  const groups: ChapterGroupData[] = CHAPTER_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    rows: indexed.filter((r) => g.match(r.ch.part)),
  })).filter((g) => g.rows.length > 0)

  const hasActiveChapter = !!activeChapterId && chapters.some((c) => c.node_id === activeChapterId)
  // 折叠态为渲染时纯派生（避免 effect 内 setState）：用户显式切换 > 当前章自动展开 > 全展开。
  // 当前编辑章所在组随 activeChapterId 变化自动展开，无需副作用同步。
  const isCollapsed = (g: ChapterGroupData): boolean => {
    const override = userToggled[g.key]
    if (override !== undefined) return override
    if (!hasActiveChapter) return false
    return !g.rows.some((r) => r.ch.node_id === activeChapterId)
  }
  const toggleGroup = (g: ChapterGroupData) => {
    const next = !isCollapsed(g)
    setUserToggled((prev) => ({ ...prev, [g.key]: next }))
  }

  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
      {/* 面板头：标题 + 总量 */}
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-base font-semibold text-gray-800">📑 章节导航</h3>
        <span className="text-xs text-gray-500">共 {chapters.length} 章</span>
      </div>

      {/* S1：分组大纲树——组头（名称/完成度/迷你进度条）+ 32px 行高三态章节行 */}
      <div className="max-h-[400px] space-y-2 overflow-y-auto pr-1">
        {groups.length === 0 && (
          <p className="py-6 text-center text-xs text-gray-500">
            还没有章节大纲——回到第 1-2 步完成解析后先生成大纲
          </p>
        )}
        {groups.map((g) => {
          const doneCount = g.rows.filter((r) => r.state === "done").length
          const total = g.rows.length
          const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0
          const collapsed = isCollapsed(g)
          return (
            <div key={g.key}>
              <button
                type="button"
                aria-expanded={!collapsed}
                onClick={() => toggleGroup(g)}
                className="flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left hover:bg-gray-100"
              >
                <span className="shrink-0 text-gray-500">
                  {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </span>
                <span className="shrink-0 text-xs font-semibold text-gray-700">{g.label}</span>
                <span className={`shrink-0 text-xs ${doneCount === total ? "text-green-600" : "text-gray-500"}`}>
                  {doneCount}/{total}
                </span>
                <span className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-gray-200">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-blue-400 to-blue-600"
                    style={{ width: `${pct}%` }}
                  ></span>
                </span>
                {/* UX-R3 S4：商务组卷一键核对入口（仅商务组头） */}
                {g.key === "biz" && (
                  <span
                    role="button"
                    tabIndex={0}
                    title="按通用规则核对商务必备件是否齐套（投标函/授权书/开标一览表/分项报价表/资格声明等）"
                    onClick={(e) => {
                      e.stopPropagation()
                      setBizCheckOpen(true)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        e.stopPropagation()
                        setBizCheckOpen(true)
                      }
                    }}
                    className="ml-auto shrink-0 rounded border border-primary/40 px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    📋 组卷检查
                  </span>
                )}
              </button>
              {!collapsed && (
                <div className="mt-0.5 space-y-0.5 pl-3">
                  {g.rows.map((r) => {
                    const isCurrent = !!r.ch.node_id && r.ch.node_id === activeChapterId
                    const charLen = (r.ch.content ?? "").length
                    const hasActions = !!(generateChapter || continueChapter || refineChapter)
                    return (
                      <div
                        key={r.ch.node_id || r.idx}
                        data-chapter-row
                        className={`group/chrow flex h-8 cursor-pointer items-center gap-2 rounded-md border-l-[3px] py-1 pl-2 pr-1.5 transition-colors hover:bg-gray-100 ${
                          isCurrent
                            ? "border-blue-500 bg-blue-50"
                            : r.state === "done"
                              ? "border-green-500 bg-green-50"
                              : r.state === "partial"
                                ? "border-blue-400 bg-blue-50/60"
                                : "border-gray-300 bg-white"
                        }`}
                        onClick={() => selectChapter?.(r.ch.node_id)}
                      >
                        <span
                          className={`w-4 shrink-0 text-center text-xs ${
                            isCurrent
                              ? "text-blue-600"
                              : r.state === "done"
                                ? "text-green-600"
                                : r.state === "partial"
                                  ? "text-blue-500"
                                  : "text-gray-400"
                          }`}
                          title={r.state === "done" ? "已完成" : r.state === "partial" ? "部分成稿" : "未写"}
                        >
                          {r.state === "done" ? "✓" : r.state === "partial" ? "◐" : "○"}
                        </span>
                        <span
                          className={`min-w-0 flex-1 truncate text-sm ${
                            isCurrent ? "font-medium text-blue-700" : "text-gray-800"
                          }`}
                        >
                          {r.ch.title || `第${r.idx + 1}章`}
                        </span>
                        {r.state === "partial" && (
                          <span className="shrink-0 text-xs text-blue-600">{fmtCharCount(charLen)}</span>
                        )}
                        {hasActions && (
                          <span className="hidden shrink-0 items-center gap-0.5 group-hover/chrow:flex">
                            {generateChapter && (
                              <button
                                type="button"
                                title="生成本章正文"
                                className="rounded px-1.5 py-0.5 text-xs text-blue-600 hover:bg-blue-100"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  generateChapter(r.ch.node_id)
                                }}
                              >
                                写
                              </button>
                            )}
                            {continueChapter && (
                              <button
                                type="button"
                                title="从断点续写本章"
                                className="rounded px-1.5 py-0.5 text-xs text-blue-600 hover:bg-blue-100"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  continueChapter(r.ch.node_id)
                                }}
                              >
                                续
                              </button>
                            )}
                            {refineChapter && (
                              <button
                                type="button"
                                title="按版式与文风精修本章"
                                className="rounded px-1.5 py-0.5 text-xs text-blue-600 hover:bg-blue-100"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  refineChapter(r.ch.node_id, "rewrite")
                                }}
                              >
                                精
                              </button>
                            )}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* S2：快速工具降级为一行图标按钮（图标 + 小字 + hover 说明），视觉重心让给章节树 */}
      <div className="mt-2 flex items-center gap-1 border-t border-gray-200 pt-2">
        <span className="mr-1 shrink-0 text-xs text-gray-400">快速工具</span>
        {[
          { icon: "📚", label: "素材", title: "引用素材库" },
          { icon: "📊", label: "插图", title: "插入图表" },
          { icon: "🤖", label: "AI助手", title: "AI 写作助手" },
          { icon: "💾", label: "草稿", title: "保存草稿" },
        ].map((t) => (
          <button
            key={t.label}
            type="button"
            title={t.title}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            <span aria-hidden="true">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* UX-R3 S4：商务组卷检查弹窗（组头「📋 组卷检查」打开；缺失项可一键补入） */}
      <BizAssemblyCheckDialog
        open={bizCheckOpen}
        onOpenChange={setBizCheckOpen}
        chapters={chapters}
        onAddMissing={addBizAssemblyItems}
      />
    </div>
  )
}

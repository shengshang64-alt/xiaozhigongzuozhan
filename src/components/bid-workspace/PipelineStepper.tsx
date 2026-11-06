import { Check } from "lucide-react"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import { PIPELINE_STEPS, stepEntryMissing, stepGateConfirmed, type BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"

type PipelineStepperProps = Pick<UseBidWorkspace, "activeStep" | "requestStep" | "activeProject"> & {
  /** 重构轮：未响应条款数（第③步橙色角标，缺失橙） */
  missCount?: number
  /** 重构轮：废标重大风险待核销数（第⑤步红色角标，废标红） */
  riskCount?: number
  /**
   * 是否在步骤条上重复展示「待响应 / 废标风险」计数角标。
   * 默认 false——这两项计数已在 WarRoom 风险灯里各展示一份，避免同一数字出现两处；
   * 需要就地提示时传 true 即可恢复角标显示（能力保留，不做删除）。
   */
  showRiskMeta?: boolean
}

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

/**
 * 流程步骤条。项目级提醒（开标倒计时 / 待响应 / 废标风险计数）统一收在「项目信息栏」
 * 与「WarRoom 风险灯」里各展示一份，本组件默认不再重复渲染；需要时用 showRiskMeta 打开。
 */
export function PipelineStepper({ activeStep, requestStep, activeProject, missCount = 0, riskCount = 0, showRiskMeta = false }: PipelineStepperProps) {
  return (
    <nav aria-label="投标流程步骤" className="mx-auto max-w-7xl px-4 pt-5">
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
          // T10 a11y：可访问名恒定带序号与完成态——完成步骤视觉上是勾号图标（svg 无文本），
          // 此前屏幕阅读器只读到「招标文件」丢了「第1步/已完成」，与待办步骤「3 投标文件编制」不一致；闸门徽标同理并入可读名。
          const stepAria = `第${s.step}步 ${s.label}${done ? "（已完成）" : isActive ? "（当前步骤）" : ""}${gateOk ? " · 交卷闸门已确认" : ""}`
          // 重构轮：第⑤步废标红 / 第③步缺失橙（与主色 done 态互斥优先级：风险 > 完成）
          const isRisk = s.step === 5 && riskCount > 0
          const isMiss = s.step === 3 && missCount > 0 && !isRisk
          return (
            <li key={s.step} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => requestStep(s.step)}
                title={stepTitle}
                aria-label={stepAria}
                aria-current={isActive ? "step" : undefined}
                className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  isActive
                    ? isRisk
                      ? "border border-destructive/50 bg-destructive/10 text-destructive"
                      : "border border-primary/40 bg-primary/10 text-primary"
                    : "border border-transparent text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    isRisk
                      ? "bg-destructive text-destructive-foreground"
                      : done
                        ? "bg-primary text-primary-foreground"
                        : isActive
                          ? isMiss
                            ? "border border-warning text-warning"
                            : "border border-primary text-primary"
                          : "border border-border bg-muted text-muted-foreground"
                  }`}
                >
                  {isRisk ? "!" : done ? <Check className="h-3.5 w-3.5" /> : s.step}
                  {gateOk && !isRisk && (
                    <span
                      title="该环节交卷闸门已确认"
                      className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-card"
                    >
                      <Check className="h-2.5 w-2.5" />
                    </span>
                  )}
                </span>
                <span className={`truncate text-xs font-medium ${isActive ? (isRisk ? "text-destructive" : "text-primary") : ""}`}>{s.label}</span>
                {showRiskMeta && isRisk && (
                  <span className="shrink-0 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-destructive-foreground" title={`${riskCount} 项废标重大风险待核销`}>
                    {riskCount}
                  </span>
                )}
                {showRiskMeta && isMiss && !isRisk && (
                  <span className="shrink-0 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning" title={`${missCount} 项招标条款尚未响应`}>
                    {missCount}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

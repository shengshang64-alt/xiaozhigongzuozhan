import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { ResultRegisterCard } from "@/components/bid-workspace/ResultRegisterCard"
import { StageHistoryPanel } from "@/components/bid-workspace/StageHistoryPanel"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"

type ArchivePanelProps = Pick<
  UseBidWorkspace,
  | "activeProject"
  | "isArchivedLocked"
  | "resultFormOpen"
  | "openResultForm"
  | "closeResultForm"
  | "resultDraft"
  | "setResultDraft"
  | "bidAmountDraft"
  | "setBidAmountDraft"
  | "resultLostReasonDraft"
  | "setResultLostReasonDraft"
  | "resultSaving"
  | "submitBidResult"
  | "retrySyncResult"
  | "syncFailedStep"
  | "linkedOpportunityName"
  | "stageHistory"
  | "stageHistoryLoading"
  | "loadStageHistory"
  | "restoreSnapshot"
  | "snapshotBusyId"
  | "resetProject"
  | "resetConfirmOpen"
  | "setResetConfirmOpen"
>

export function ArchivePanel(p: ArchivePanelProps) {
  const { activeProject } = p
  if (!activeProject) return null
  const proj = activeProject
  // 循环 6 A1：归档判定与 isArchivedLocked 同口径（archived 位或 stage 任一命中），兼容存量单口径数据
  const archived = proj.archived === true || proj.stage === "archived"
  return (
    <section className="mx-auto max-w-7xl px-4 pb-14 pt-5">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-background via-secondary to-card px-6 py-6 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground lg:text-2xl">归档复盘</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              开标出结果后在这里登记中标或失单，并回顾本项目的工作记录。组卷和导出请到第 7 步。
            </p>
          </div>
          {archived && (
            <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              已归档 · 只读
            </span>
          )}
        </div>
      </header>

      <div className="mt-5">
        <ResultRegisterCard
          activeProject={activeProject}
          resultFormOpen={p.resultFormOpen}
          openResultForm={p.openResultForm}
          closeResultForm={p.closeResultForm}
          resultDraft={p.resultDraft}
          setResultDraft={p.setResultDraft}
          bidAmountDraft={p.bidAmountDraft}
          setBidAmountDraft={p.setBidAmountDraft}
          resultLostReasonDraft={p.resultLostReasonDraft}
          setResultLostReasonDraft={p.setResultLostReasonDraft}
          resultSaving={p.resultSaving}
          submitBidResult={p.submitBidResult}
          retrySyncResult={p.retrySyncResult}
          syncFailedStep={p.syncFailedStep}
          linkedOpportunityName={p.linkedOpportunityName}
          locked={p.isArchivedLocked}
        />
      </div>

      <div className="mt-5">
        <StageHistoryPanel
          stageHistory={p.stageHistory}
          stageHistoryLoading={p.stageHistoryLoading}
          loadStageHistory={p.loadStageHistory}
          restoreSnapshot={p.restoreSnapshot}
          snapshotBusyId={p.snapshotBusyId}
        />
      </div>

      <footer className="mt-10 rounded-lg border border-border bg-card p-5 text-center shadow-md">
        <p className="text-sm font-medium text-foreground">
          {archived ? "本项目已归档，投标结果与工作记录仍可查看" : "登记结果后，可在页头「项目管理」中归档本项目"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          各环节结果均已保存在本项目工作记录中
        </p>
      </footer>

      <ConfirmDialog
        open={p.resetConfirmOpen}
        onOpenChange={p.setResetConfirmOpen}
        title="重置项目为初始状态？"
        description="解析报告、大纲、全部章节正文、偏离表与检查 / 评标报告、闸门确认将被清空（招标文件文本保留）。重置前会自动保存一份全量备份，可在工作记录中随时恢复。"
        confirmText="确认重置"
        cancelText="再想想"
        tone="danger"
        onConfirm={() => void p.resetProject()}
      />
    </section>
  )
}

import { ArrowRight, ClipboardList, Download, FileCheck2, Loader2, Scale, Table2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { GateChecklist } from "@/components/bid-workspace/GateChecklist"
import { SubmissionReadinessPanel } from "@/components/bid-workspace/SubmissionReadinessPanel"
import {
  archiveCardGuidance,
  type ArchiveExportKey,
} from "@/components/bid-workspace/archiveExport"
import { ResultRegisterCard } from "@/components/bid-workspace/ResultRegisterCard"
import { StageHistoryPanel } from "@/components/bid-workspace/StageHistoryPanel"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"

type ArchivePanelProps = Pick<
  UseBidWorkspace,
  | "activeProject"
  | "requestStep"
  | "splitProseLongParagraphs"
  | "exportBusy"
  | "exportBidWord"
  | "exportReport"
  | "exportDeviationWord"
  | "exportAllDocs"
  | "archiveProject"
  | "unarchiveActiveProject"
  | "isArchivedLocked"
  | "confirmGate"
  | "resetGate"
  | "voidCriticalUnresolved"
  | "gatesUnconfirmed"
  | "allGatesConfirmed"
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
  const { activeProject, exportBusy, exportBidWord, exportReport, exportDeviationWord, exportAllDocs, allGatesConfirmed, gatesUnconfirmed } = p
  if (!activeProject) return null
  const proj = activeProject
  // 循环 6 A1：归档判定与 isArchivedLocked 同口径（archived 位或 stage 任一命中），兼容存量单口径数据
  const archived = proj.archived === true || proj.stage === "archived"
  const cards: {
    key: ArchiveExportKey
    title: string
    desc: string
    icon: typeof Download
    onClick: () => void
  }[] = [
    {
      key: "bid",
      title: "投标文件 Word",
      desc: "技术标全文，章—节标题层级完整，配图自动转图片插入",
      icon: FileCheck2,
      onClick: () => void exportBidWord(),
    },
    {
      key: "deviation",
      title: "技术偏离表",
      desc: "招标技术条款逐条响应程度、摘要与响应位置（归档全套文档含此表）",
      icon: Table2,
      onClick: () => void exportDeviationWord(),
    },
    {
      key: "parse",
      title: "解析报告",
      desc: "项目概况、评分办法、资质、废标条款、时间节点",
      icon: ClipboardList,
      onClick: () => void exportReport("parse"),
    },
    {
      key: "check",
      title: "查重与废标检查报告",
      desc: "相似段落对照 + 废标条款逐条判定",
      icon: FileCheck2,
      onClick: () => void exportReport("dup_void"),
    },
    {
      key: "eval",
      title: "模拟评标报告",
      desc: "AI 逐项打分、人工打分与对比结论",
      icon: Scale,
      onClick: () => void exportReport("eval"),
    },
  ]
  return (
    <section className="mx-auto max-w-7xl px-4 pb-14 pt-5">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-background via-secondary to-card px-6 py-6 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground lg:text-2xl">归档导出</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              一键导出全套投标文档（Word 格式，本地生成不经过服务器）。归档后项目仍可随时查看、继续导出，环节结果全部保留。
            </p>
          </div>
          {/* 归档 / 解除归档已移到页头「项目管理」菜单（BidWorkspacePage），此处不再重复放按钮 */}
          {archived && (
            <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              已归档 · 只读
            </span>
          )}
        </div>
      </header>

      {/* 第四轮改造：投标结果登记卡（导出卡片上方） */}
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

      {/* 2026-10-23（P0-1 交卷清单）：跨步骤汇总——用户走完前三步就不走了，
          这里把"离交卷还差什么"摊平成一件事一行，每行都能跳去处理 */}
      <div className="mt-5">
        <SubmissionReadinessPanel project={activeProject} onGo={(step) => p.requestStep(step)} onSplitProse={p.splitProseLongParagraphs} />
      </div>

      {/* 第九轮改造 1：交卷闸门卡（结果登记之后、导出卡片上方） */}
      <div className="mt-5">
        <GateChecklist
          activeProject={activeProject}
          confirmGate={p.confirmGate}
          resetGate={p.resetGate}
          voidCriticalUnresolved={p.voidCriticalUnresolved}
        />
      </div>

      {/* 第九轮改造 1：全套导出——五闸门确认齐才可用 */}
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-5 py-4 shadow-md">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">导出全套文档</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            按「投标文件 → 技术偏离表 → 解析报告 → 检查报告 → 评标报告」顺序一次导出全部已就绪文档
          </p>
        </div>
        <span className="flex shrink-0 flex-wrap items-center gap-2">
          {!allGatesConfirmed && (
            <span className="rounded-full bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
              还有 {gatesUnconfirmed} 个闸门未确认
            </span>
          )}
          <Button
            onClick={() => void exportAllDocs()}
            disabled={!allGatesConfirmed || exportBusy === "all"}
            className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)] disabled:opacity-60"
          >
            {exportBusy === "all" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
            {exportBusy === "all" ? "全套导出中…" : "导出全套文档"}
          </Button>
        </span>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        {cards.map((card) => {
          const Icon = card.icon
          const busy = exportBusy === card.key
          const g = archiveCardGuidance(card.key, proj)
          return (
            <article key={card.key} className="flex h-full flex-col rounded-lg border border-border bg-card p-5 shadow-md">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary shadow-sm">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-foreground">{card.title}</h2>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{card.desc}</p>
                </div>
              </div>
              <div className="mt-auto pt-4">
                <Button
                  variant="outline"
                  onClick={card.onClick}
                  disabled={!g.ready || busy}
                  title={!g.ready ? g.missingHint : undefined}
                  className="w-full border-border text-card-foreground shadow-sm hover:bg-secondary disabled:opacity-60"
                >
                  {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
                  {busy ? "导出中…" : g.ready ? "导出 Word" : (g.shortLabel ?? "内容未就绪")}
                </Button>
                {!g.ready && !busy && (
                  <button
                    type="button"
                    onClick={() => p.requestStep(g.step)}
                    className="mt-2 flex w-full items-center justify-center gap-1 rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <ArrowRight className="h-3 w-3" />
                    前往第 {g.step} 步 · {g.goLabel}
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>

      {/* 第十一轮改造 4：工作记录快照面板（可查看 / 恢复任意历史版本） */}
      <div className="mt-5">
        <StageHistoryPanel
          stageHistory={p.stageHistory}
          stageHistoryLoading={p.stageHistoryLoading}
          loadStageHistory={p.loadStageHistory}
          restoreSnapshot={p.restoreSnapshot}
          snapshotBusyId={p.snapshotBusyId}
        />
      </div>

      {/* 危险操作「重置为初始状态」已移到页头「项目管理」菜单；此处仅保留二次确认框 */}

      <footer className="mt-10 rounded-lg border border-border bg-card p-5 text-center shadow-md">
        <p className="text-sm font-medium text-foreground">
          {archived ? "本项目已归档，感谢使用标书工作台" : "完成导出后即可归档本项目"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          项目「{proj.project_name}」· {proj.hospital || "采购人未填写"} · 各环节结果均已保存
        </p>
      </footer>

      {/* 第十一轮改造 5：重置二次确认（danger） */}
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

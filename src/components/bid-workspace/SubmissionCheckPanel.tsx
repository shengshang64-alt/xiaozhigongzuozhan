import { useMemo, useState } from "react"
import { AlertTriangle, ArrowRightCircle, CheckCircle2, ClipboardCheck, Download, FileSearch, Loader2, Scale, ShieldAlert, SpellCheck, TriangleAlert, Wand2 } from "lucide-react"
import { copyTextToClipboard } from "@/lib/clipboard"
import { formatDateTimeDisplay } from "@/lib/dateDisplay"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { SubmissionChecklistPanel } from "@/components/bid-workspace/SubmissionChecklistPanel"
import { DeliveryActionPanel } from "@/components/bid-workspace/DeliveryActionPanel"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import { PARSE_STEP } from "@/components/bid-workspace/pipelineStep"
import {
  aggregateAuditByChapter,
  COVERAGE_LEVEL_LABEL,
  FORMAT_RULE_LABEL,
  REVIEW_STATUS_LABEL,
  SEVERITY_LABEL,
  SUBMISSION_KIND_LABEL,
  type CoverageAuditEntry,
  type CoverageLevel,
  type ChapterAuditImprovement,
  type FactConflict,
  type ReviewStatus,
  type SeverityLevel,
  type SubmissionCheckItem,
  type TextAuditReport,
} from "@/pages/BidWorkspace/bidTypes"

// D3/R89：AI 内容护栏标签映射（consistencyGuard 模块自源，不经 bidTypes 中转）
import { CONSISTENCY_RULE_LABEL, CONSISTENCY_SEVERITY_LABEL } from "@/pages/BidWorkspace/prompts/consistencyGuard"
import { scanStaleVersionInText, staleRefHint } from "@/pages/BidWorkspace/standardCurrency"

type SubmissionCheckPanelProps = Pick<
  UseBidWorkspace,
  | "activeProject"
  | "requestStep"
  | "submissionLoading"
  | "submissionFailed"
  | "startSubmissionCheck"
  | "jumpToSubmissionGap"
  | "setSubmissionReviewStatus"
  | "coverageAudit"
  | "coverageAuditBusy"
  | "startCoverageAudit"
  | "supplementFromAudit"
  | "chapterReflowBusy"
  | "reflowChapterFromAudit"
  | "quoteFixBusy"
  | "startQuoteRewriteFix"
  | "isArchivedLocked"
  | "startFactPatch"
  | "factPatchBusy"
  | "textAuditBusy"
  | "startTextAudit"
  | "fixTyposBusy"
  | "startFixTypos"
  | "jumpToAuditChapter"
>

const SEVERITY_VARIANT: Record<SeverityLevel, "danger" | "warning" | "neutral"> = {
  critical: "danger",
  major: "warning",
  minor: "neutral",
}

const REVIEW_FILTERS: { key: "all" | ReviewStatus; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待核销" },
  { key: "addressed", label: "已处理" },
  { key: "skipped", label: "已跳过" },
]

/** 第九轮改造 2：未覆盖清单项升级——severity 徽标 + 整改建议 + 核销动作（与废标检查同一套模式） */
function GapItemRow({
  item,
  onJump,
  onReviewStatus,
  onSkipRequest,
}: {
  item: SubmissionCheckItem
  onJump: (label: string) => void
  onReviewStatus: (index: number, reviewStatus: ReviewStatus) => void
  onSkipRequest: (item: SubmissionCheckItem) => void
}) {
  const isVoid = item.kind === "void"
  const settled = item.review_status !== "pending"
  return (
    <li
      className={`rounded-md border px-3 py-2.5 ${
        settled
          ? "border-border bg-muted/30"
          : isVoid
            ? "border-destructive/30 bg-destructive/5"
            : "border-warning/30 bg-warning/5"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              isVoid ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"
            }`}
          >
            {SUBMISSION_KIND_LABEL[item.kind]}
          </span>
          <Badge variant={SEVERITY_VARIANT[item.severity]}>{SEVERITY_LABEL[item.severity]}</Badge>
          <span className={`text-xs leading-relaxed ${settled ? "text-muted-foreground line-through" : "text-card-foreground"}`}>
            {item.label}
          </span>
          {settled && (
            <Badge variant={item.review_status === "addressed" ? "success" : "neutral"}>
              {REVIEW_STATUS_LABEL[item.review_status]}
            </Badge>
          )}
        </span>
        <span className="flex shrink-0 flex-wrap items-center gap-2">
          {item.review_status === "pending" ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onReviewStatus(item.index, "addressed")}
                className="border-primary/40 text-primary hover:bg-primary/10"
              >
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                标记已处理
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSkipRequest(item)}
                className="border-border text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
              >
                跳过（填原因）
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReviewStatus(item.index, "pending")}
              className="border-border text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
            >
              撤销核销
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onJump(item.label)}
            className="border-primary/40 text-primary hover:bg-primary/10"
          >
            <ArrowRightCircle className="mr-1 h-3.5 w-3.5" />
            去最相关章节
          </Button>
        </span>
      </div>
      {item.suggestion && !settled && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">整改建议：{item.suggestion}</p>
      )}
      {item.review_status === "skipped" && item.skip_reason && (
        <p className="mt-1.5 text-xs text-muted-foreground">跳过原因：{item.skip_reason}</p>
      )}
    </li>
  )
}

/** 循环 5 A2：覆盖审计卡——逐节核对写作方案是否在正文中落实；partial/missing 节可一键补写（复用条级重写通道） */
const COVERAGE_BADGE_CLASS: Record<CoverageLevel, string> = {
  full: "bg-primary/10 text-primary",
  partial: "bg-warning/10 text-warning",
  missing: "bg-destructive/10 text-destructive",
  over: "border border-destructive/40 bg-destructive/10 text-destructive",
}

/** R103：按章聚合改进建议列表——聚合章内问题小节的漏点/收敛要求与建议，支持复制回注文本与整章串行回注 */
function ChapterImprovementList({
  improvements,
  locked,
  busy,
  reflowBusy,
  onReflow,
}: {
  improvements: ChapterAuditImprovement[]
  locked: boolean
  busy: boolean
  reflowBusy: string | null
  onReflow: (chapterId: string) => void
}) {
  if (!improvements.length) {
    return (
      <p className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-4 text-center text-xs font-medium text-primary">
        全部技术节均已按写作方案落实，无按章回注的改进建议
      </p>
    )
  }
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {improvements.map((group) => (
        <li
          key={group.chapterId}
          className={`rounded-md border px-3 py-2.5 ${
            group.worst === "missing" || group.worst === "over"
              ? "border-destructive/30 bg-destructive/5"
              : "border-warning/30 bg-warning/5"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${COVERAGE_BADGE_CLASS[group.worst]}`}>
                {COVERAGE_LEVEL_LABEL[group.worst]}
              </span>
              <span className="text-xs font-medium text-card-foreground">{group.chapterTitle}</span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">问题 {group.problemCount} 节</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void copyTextToClipboard(group.directive, {
                    successMessage: `已复制「${group.chapterTitle}」改进建议，可粘贴给人工修改参考`,
                    errorMessage: "复制失败，请手动选择文本复制",
                  })
                }}
                className="shrink-0 border-border text-muted-foreground hover:bg-secondary"
              >
                复制建议
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={locked || busy || !!reflowBusy}
                onClick={() => onReflow(group.chapterId)}
                title="把本章各问题小节的漏点/收敛要求注入对应小节重写，逐条串行执行（一次费用确认，其余小节不动）"
                className="shrink-0 border-primary/40 text-primary hover:bg-primary/10"
              >
                {reflowBusy === group.chapterId ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1.5 h-3.5 w-3.5" />}
                {reflowBusy === group.chapterId ? "回注中…" : "整章回注整改"}
              </Button>
            </span>
          </div>
          <ul className="mt-1.5 flex flex-col gap-1">
            {group.items.map((item) => (
              <li key={item.leaf_id} className="rounded-md border border-border/60 bg-background px-2.5 py-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${COVERAGE_BADGE_CLASS[item.covered]}`}>
                    {COVERAGE_LEVEL_LABEL[item.covered]}
                  </span>
                  <span className="min-w-0 flex-1 text-xs font-medium text-card-foreground">{item.title}</span>
                </div>
                {!!item.missing_points.length && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs leading-relaxed text-muted-foreground">
                    {item.missing_points.map((point, i) => (
                      <li key={`${item.leaf_id}-p${i}`}>{point}</li>
                    ))}
                  </ul>
                )}
                {item.suggestion && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">建议：{item.suggestion}</p>}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

function CoverageAuditCard({
  entries,
  busy,
  locked,
  chaptersReady,
  onRun,
  onSupplement,
  improvements,
  reflowBusy,
  onReflow,
}: {
  entries: CoverageAuditEntry[] | null
  busy: boolean
  locked: boolean
  chaptersReady: boolean
  onRun: () => void
  onSupplement: (leafId: string) => void
  improvements: ChapterAuditImprovement[]
  reflowBusy: string | null
  onReflow: (chapterId: string) => void
}) {
  // R103：视图切换——逐节明细（默认，行为与旧版一致）/ 按章聚合（章级改进建议与整章回注）
  const [view, setView] = useState<"leaf" | "chapter">("leaf")
  const fullCount = entries?.filter((e) => e.covered === "full").length ?? 0
  const partialCount = entries?.filter((e) => e.covered === "partial").length ?? 0
  const missingCount = entries?.filter((e) => e.covered === "missing").length ?? 0
  const overCount = entries?.filter((e) => e.covered === "over").length ?? 0
  return (
    <div className="mt-4 rounded-lg border border-border bg-card p-4 shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-card-foreground">
            <FileSearch className="h-4 w-4 text-primary" />
            覆盖审计
            {entries && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                共 {entries.length} 节
              </span>
            )}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            逐节核对写作方案（写作焦点、必守事实、表格计划）是否在正文中落实，输出覆盖档位、漏点与过度承诺（加码）清单；部分落实 / 未落实的节可一键补写，过度承诺的节可一键修正（作为附加要求注入该节重写，走一次生成费用确认）；切「按章聚合」可按章查看全部改进建议并一键回注整改
          </p>
        </div>
        {entries && (
          <span className="flex shrink-0 items-center gap-1.5">
            {([
              { key: "leaf", label: "逐节明细" },
              { key: "chapter", label: "按章聚合" },
            ] as const).map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                className={`rounded-full px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  view === v.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-card-foreground"
                }`}
              >
                {v.label}
              </button>
            ))}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onRun}
          disabled={busy || !chaptersReady || locked}
          title={locked ? "已归档项目为只读，解除归档后可编辑" : undefined}
          className="shrink-0 border-primary/40 text-primary hover:bg-primary/10"
        >
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />}
          {busy ? "审计中…" : entries ? "重新审计" : "运行覆盖审计"}
        </Button>
      </div>
      {!chaptersReady && (
        <p className="mt-3 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          投标文件还没有正文，请先完成「投标文件编制」环节再做覆盖审计
        </p>
      )}
      {busy && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-primary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在逐节核对写作方案与正文的覆盖情况，约需 1 分钟…
        </p>
      )}
      {entries && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-primary/10 px-3 py-1 font-medium text-primary">全部落实 {fullCount}</span>
            <span className="rounded-full bg-warning/10 px-3 py-1 font-medium text-warning">部分落实 {partialCount}</span>
            <span className="rounded-full bg-destructive/10 px-3 py-1 font-medium text-destructive">未落实 {missingCount}</span>
            <span className="rounded-full bg-destructive/10 px-3 py-1 font-medium text-destructive">过度承诺 {overCount}</span>
          </div>
          {view === "leaf" && (
          <ul className="mt-3 flex flex-col gap-2">
            {entries.map((entry) => (
              <li
                key={entry.leaf_id}
                className={`rounded-md border px-3 py-2.5 ${
                  entry.covered === "missing"
                    ? "border-destructive/30 bg-destructive/5"
                    : entry.covered === "over"
                      ? "border-destructive/30 bg-card"
                      : entry.covered === "partial"
                        ? "border-warning/30 bg-warning/5"
                        : "border-border bg-muted/30"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${COVERAGE_BADGE_CLASS[entry.covered]}`}>
                      {COVERAGE_LEVEL_LABEL[entry.covered]}
                    </span>
                    <span className="text-xs font-medium text-card-foreground">{entry.title}</span>
                  </span>
                  {entry.covered !== "full" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={locked || busy || !chaptersReady}
                      onClick={() => onSupplement(entry.leaf_id)}
                      title={locked ? "已归档项目为只读，解除归档后可编辑" : entry.covered === "over" ? "把过度承诺点作为收敛要求注入该节重写（走一次生成费用确认）" : "把漏点作为附加要求注入该节重写（走一次生成费用确认）"}
                      className="shrink-0 border-primary/40 text-primary hover:bg-primary/10"
                    >
                      {entry.covered === "over" ? "修正" : "补写"}
                    </Button>
                  )}
                </div>
                {!!entry.missing_points.length && (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs leading-relaxed text-muted-foreground">
                    {entry.missing_points.map((point, i) => (
                      <li key={`${entry.leaf_id}-p${i}`}>{point}</li>
                    ))}
                  </ul>
                )}
                {entry.suggestion && (
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">建议：{entry.suggestion}</p>
                )}
              </li>
            ))}
          </ul>
          )}
          {view === "chapter" && (
            <ChapterImprovementList
              improvements={improvements}
              locked={locked}
              busy={busy || !chaptersReady}
              reflowBusy={reflowBusy}
              onReflow={onReflow}
            />
          )}
        </>
      )}
      {!entries && !busy && chaptersReady && (
        <p className="mt-3 rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          尚未运行覆盖审计；审计结果仅本次会话内有效，不落库
        </p>
      )}
    </div>
  )
}

/** T18：文本审计卡（错别字 + 逻辑谬误，易标 rejection-check 两路移植）——独立于交卷体检的常驻卡 */
function TextAuditCard({
  report,
  busy,
  fixBusy,
  locked,
  hasExternal,
  onRun,
  onFixTypos,
  onJumpChapter,
  onExport,
}: {
  report: TextAuditReport | null
  busy: "" | "typo" | "logic" | "both"
  fixBusy: boolean
  locked: boolean
  hasExternal: boolean
  onRun: (scope: "typo" | "logic" | "both") => void
  onFixTypos: () => void
  onJumpChapter: (docId: string) => void
  onExport: () => void
}) {
  const typoCount = report?.typos.length ?? 0
  const logicCount = report?.logic.length ?? 0
  const busyLabel = busy === "typo" ? "错别字检查中…" : busy === "logic" ? "逻辑检查中…" : busy === "both" ? "文本审计中…" : ""
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-card-foreground">
            <FileSearch className="h-4 w-4 text-primary" />
            文本审计（错别字 · 逻辑谬误）
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                typoCount + logicCount ? "bg-warning/10 text-warning" : report ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}
            >
              {report ? (typoCount + logicCount ? `错别字 ${typoCount} · 逻辑 ${logicCount}` : "未发现问题") : "未检查"}
            </span>
            {report && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {report.source === "external" ? "对象：外部投标文件" : "对象：成稿章节"} · {formatDateTimeDisplay(report.checked_at)}
              </span>
            )}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            AI 检查高确信错别字（逐条经原文位置校验，幻觉条目自动丢弃）与逻辑谬误/前后不一致（人员、设备、工期、金额、参数等口径）。
            {hasExternal ? "当前检查对象为外部投标文件全文。" : "当前检查对象为已成稿章节正文。"}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy || locked}
            onClick={() => onRun("typo")}
            className="h-7 border-primary/40 text-primary hover:bg-primary/10"
          >
            {busy === "typo" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <SpellCheck className="mr-1 h-3 w-3" />}
            错别字检查
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy || locked}
            onClick={() => onRun("logic")}
            className="h-7 border-primary/40 text-primary hover:bg-primary/10"
          >
            {busy === "logic" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Scale className="mr-1 h-3 w-3" />}
            逻辑检查
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy || locked}
            onClick={() => onRun("both")}
            className="h-7 border-primary/40 text-primary hover:bg-primary/10"
          >
            {busy === "both" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Wand2 className="mr-1 h-3 w-3" />}
            一键审计
          </Button>
          {report && (
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              onClick={onExport}
              className="h-7 border-border text-muted-foreground hover:text-foreground"
            >
              <Download className="mr-1 h-3 w-3" />
              导出报告
            </Button>
          )}
        </div>
      </div>
      {busy && <p className="mt-2 flex items-center gap-1.5 text-xs text-primary"><Loader2 className="h-3.5 w-3.5 animate-spin" />{busyLabel}超长正文自动分段检查，进度见 toast。</p>}
      {report && (
        <div className="mt-3 flex flex-col gap-3">
          {!!report.failed?.length && (
            <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs leading-relaxed">
              <p className="font-medium text-warning">核对失败的章（{report.failed.length}）——重跑「一键审计」只补这些章</p>
              <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
                {report.failed.map((f, i) => (
                  <li key={`f-${i}`}>
                    {f.docTitle}：{f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {typoCount > 0 && (
            <details open>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs font-semibold text-card-foreground">
                错别字（{typoCount} 处，按行号定位）
                {!hasExternal && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={fixBusy || locked}
                    onClick={onFixTypos}
                    className="h-6 border-primary/40 px-2 text-xs text-primary hover:bg-primary/10"
                  >
                    {fixBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
                    一键修正
                  </Button>
                )}
              </summary>
              <ul className="mt-2 flex flex-col gap-1.5">
                {report.typos.map((t, i) => (
                  <li key={`t-${i}`} className="rounded-md border border-border/60 bg-background px-3 py-2 text-xs leading-relaxed">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="warning">错别字</Badge>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                        {t.docTitle} · 第 {t.line} 行附近
                      </span>
                      <span className="font-medium text-destructive">{t.wrongText}</span>
                      <ArrowRightCircle className="h-3 w-3 text-primary" />
                      <span className="font-medium text-primary">{t.correctText}</span>
                    </div>
                    <p className="mt-1 truncate text-muted-foreground">…{t.excerpt}…</p>
                    <p className="mt-0.5 text-muted-foreground">{t.reason}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {logicCount > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-card-foreground">逻辑谬误 / 前后不一致（{logicCount} 处）</summary>
              <ul className="mt-2 flex flex-col gap-1.5">
                {report.logic.map((l, i) => (
                  <li key={`l-${i}`} className="rounded-md border border-border/60 bg-background px-3 py-2 text-xs leading-relaxed">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="warning">逻辑</Badge>
                      <span className="font-medium text-card-foreground">{l.title}</span>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                        {l.docTitle} · {l.locationHint}
                      </span>
                      {!hasExternal && l.docId !== "external" && (
                        <button
                          type="button"
                          onClick={() => onJumpChapter(l.docId)}
                          className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20"
                        >
                          跳转修改
                        </button>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-muted-foreground">原文：{l.originalText}</p>
                    <p className="mt-0.5 text-muted-foreground">{l.fallacyReason}</p>
                    <p className="mt-0.5 text-primary">建议：{l.suggestion}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!typoCount && !logicCount && (
            <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-4 text-center text-xs font-medium text-primary">
              本次审计未发现高确信的错别字或逻辑问题（不代表零风险，重要标书建议人工再通读一遍）
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** 循环 8 A3：事实一致性核对区卡——矛盾行样式与快捷工具「事实核对」结果弹窗一致，一键修复复用 startFactPatch */
function FactConflictCard({
  conflicts,
  patchBusy,
  locked,
  onPatch,
}: {
  conflicts: FactConflict[]
  patchBusy: boolean
  locked: boolean
  onPatch: () => void
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-card-foreground">
            <Scale className="h-4 w-4 text-primary" />
            事实一致性核对
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                conflicts.length ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
              }`}
            >
              {conflicts.length ? `发现 ${conflicts.length} 处矛盾` : "未发现口径矛盾"}
            </span>
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            随交卷体检按全局事实表逐条核对各章命中段落的数字与承诺口径；修改事实表或正文后可点「重新审计」复检
          </p>
        </div>
        {conflicts.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={onPatch}
            disabled={patchBusy || locked}
            title={locked ? "已归档项目为只读，解除归档后可编辑" : undefined}
            className="shrink-0 border-primary/40 text-primary hover:bg-primary/10"
          >
            {patchBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1.5 h-3.5 w-3.5" />}
            {patchBusy ? "修复中…" : "一键修复"}
          </Button>
        )}
      </div>
      {conflicts.length === 0 ? (
        <p className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-4 text-center text-xs font-medium text-primary">
          各章命中段落与全局事实表口径一致
        </p>
      ) : (
        <div className="mt-3 grid gap-3">
          {conflicts.map((c, i) => (
            <div key={i} className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="flex items-start gap-1.5 text-xs font-semibold text-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                {c.fact}
              </p>
              {c.chapter && <p className="mt-1.5 text-xs text-muted-foreground">所在章：{c.chapter}</p>}
              {c.quote && (
                <p className="mt-1.5 rounded border-l-2 border-destructive/50 bg-background px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
                  「{c.quote}」
                </p>
              )}
              {c.suggestion && <p className="mt-1.5 text-xs leading-relaxed text-primary">建议：{c.suggestion}</p>}
            </div>
          ))}
          <p className="text-xs leading-relaxed text-muted-foreground">
            一键修复按矛盾清单生成精准替换补丁，只有能在对应章唯一命中的原文才会被替换，其余自动跳过；修复完成后建议重新体检复检。
          </p>
        </div>
      )}
    </div>
  )
}

export function SubmissionCheckPanel({
  activeProject,
  requestStep,
  submissionLoading,
  submissionFailed,
  startSubmissionCheck,
  jumpToSubmissionGap,
  setSubmissionReviewStatus,
  coverageAudit,
  coverageAuditBusy,
  startCoverageAudit,
  supplementFromAudit,
  chapterReflowBusy,
  reflowChapterFromAudit,
  quoteFixBusy,
  startQuoteRewriteFix,
  isArchivedLocked,
  startFactPatch,
  factPatchBusy,
  textAuditBusy,
  startTextAudit,
  fixTyposBusy,
  startFixTypos,
  jumpToAuditChapter,
}: SubmissionCheckPanelProps) {
  // 第九轮改造 2：核销筛选 + 跳过原因弹窗（纯 UI 状态）
  const [reviewFilter, setReviewFilter] = useState<"all" | ReviewStatus>("all")
  const [skipTarget, setSkipTarget] = useState<SubmissionCheckItem | null>(null)
  const [skipReason, setSkipReason] = useState("")
  const check = activeProject?.submission_check ?? null
  const chaptersReady = (activeProject?.bid_chapters ?? []).some((c) => (c.content ?? "").trim())
  // R103：按章聚合改进建议（纯本地聚合零 AI；供覆盖审计卡「按章聚合」视图与整章回注消费）
  const coverageImprovements = useMemo(
    () => (coverageAudit && activeProject ? aggregateAuditByChapter(coverageAudit, activeProject.bid_outline ?? []) : []),
    [coverageAudit, activeProject],
  )
  const covered = check ? check.items.filter((i) => i.covered).length : 0
  const total = check?.items.length ?? 0
  const gaps = check ? check.items.filter((i) => !i.covered) : []
  const voidGaps = gaps.filter((i) => i.kind === "void").length
  const unresolvedGaps = gaps.filter((i) => i.review_status === "pending")
  const filteredGaps = gaps.filter((i) => reviewFilter === "all" || i.review_status === reviewFilter)
  // 第十七轮 17C：本地格式规则检查报告（零 AI），随交卷体检一并生成
  const formatReport = check?.format_report ?? null
  const formatHits = formatReport?.hits ?? []
  // r287（切片2·整改）：引文改写命中数（整改回注按钮可见性；实际定位与封顶以本地重算为准）
  const quoteRewriteHitCount = formatHits.filter((h) => h.rule === "quote_rewrite").length
  // 循环 8 A3：事实一致性核对结果（null=未跑/失败或老数据，[]=跑过且无矛盾，不渲染区卡）
  const factConflicts = check?.fact_conflicts ?? null
  // D3/R89：AI 内容护栏结果（null=未跑/失败，[]=跑过无问题；只报不拦，绿态也渲染区卡收口）
  const consistencyIssues = check?.consistency_issues ?? null
  // R275：正文级编制依据版本时效检查（零 AI，兜底暴露旧版引用；只报不拦）
  const staleVersionHits = useMemo(() => {
    const chapters = activeProject?.bid_chapters ?? []
    const fullText = chapters.map((c) => c.content ?? "").join("\n")
    return fullText ? scanStaleVersionInText(fullText) : []
  }, [activeProject?.bid_chapters])
  return (
    <section className="mx-auto max-w-7xl px-4 pb-14">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-background via-secondary to-card px-6 py-6 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-3xl font-bold text-foreground">
              <ClipboardCheck className="h-7 w-7 text-primary" />
              交卷体检
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              交卷前最后一道质量闸：以评标委员会视角，对全部评分项与废标条款逐条审计投标文件是否「实质响应」——只认对应的措施、承诺与数据，不认关键词堆砌。未覆盖项带严重度与整改建议，补写后回来「标记已处理」，确实不适用的可「跳过」并填原因留痕。
            </p>
          </div>
          <Button
            variant="outline"
            onClick={startSubmissionCheck}
            disabled={submissionLoading || !chaptersReady}
            className="shrink-0 border-primary/40 text-primary shadow-sm hover:bg-primary/10 focus-visible:shadow-[var(--focus-ring)]"
          >
            {submissionLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-1.5 h-4 w-4" />}
            {submissionLoading ? "审计中，约需 1-2 分钟…" : check ? "重新审计" : "运行交卷体检"}
          </Button>
        </div>
        {!chaptersReady && (
          <p className="mt-3 rounded-md border border-dashed border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
            投标文件还没有正文，请先完成「投标文件编制」环节
          </p>
        )}
      </header>

      <div className="mt-5">
        {submissionLoading ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-primary/30 bg-card py-16 text-center shadow-md">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium text-card-foreground">评标委员会（AI）正在逐条审计实质响应…</p>
            <p className="text-xs text-muted-foreground">评分项看可得分内容，废标条款从严判定</p>
          </div>
        ) : submissionFailed && !check ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-destructive/30 bg-card py-16 text-center shadow-md">
            <TriangleAlert className="h-8 w-8 text-destructive" />
            <p className="text-sm font-medium text-card-foreground">审计未完成，请重试或人工复核</p>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              本次审计结果无法确认，为避免误导，未把任何条目标记为未覆盖；可点右上角「重新审计」再试一次
            </p>
          </div>
        ) : check ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 shadow-md">
              {total > 0 ? (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    unresolvedGaps.length ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary"
                  }`}
                >
                  实质响应覆盖率 {covered}/{total}
                </span>
              ) : (
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                  AI 实质响应审计未运行
                </span>
              )}
              {voidGaps > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  废标条款未覆盖 {voidGaps} 条
                </span>
              )}
              {total > 0 && (
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                  评分项未覆盖 {gaps.length - voidGaps} 条
                </span>
              )}
              {formatReport && (
                <span
                  className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                    formatHits.length ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary"
                  }`}
                >
                  <FileSearch className="h-3.5 w-3.5" />
                  格式检查 {formatHits.length ? `命中 ${formatHits.length} 处` : "全部通过"}
                </span>
              )}
              {factConflicts && (
                <span
                  className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                    factConflicts.length ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                  }`}
                >
                  <Scale className="h-3.5 w-3.5" />
                  {factConflicts.length ? `事实矛盾 ${factConflicts.length} 处` : "事实口径一致"}
                </span>
              )}
              {consistencyIssues && (
                <span
                  className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                    consistencyIssues.length ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary"
                  }`}
                >
                  <FileSearch className="h-3.5 w-3.5" />
                  {consistencyIssues.length ? `内容护栏 ${consistencyIssues.length} 处提示` : "内容护栏通过"}
                </span>
              )}
              {staleVersionHits.length > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  标准时效 {staleVersionHits.length} 处
                </span>
              )}
              {gaps.length > 0 && (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    unresolvedGaps.length ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                  }`}
                >
                  未核销 {unresolvedGaps.length} 条
                </span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                审计时间：{formatDateTimeDisplay(check.checked_at)}
              </span>
            </div>
            {submissionFailed && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-card-foreground">
                最近一次重新审计未完成，下面仍是上一次成功的审计结果，可再次点「重新审计」重试
              </p>
            )}
            {total === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-card px-4 py-6 text-center text-xs leading-relaxed text-muted-foreground">
                本次未运行 AI 实质响应审计（缺少评分办法或废标条款的解析结果），下方仅为本地格式规则检查结果；补齐解析项后可点「重新审计」
              </p>
            ) : gaps.length === 0 ? (
              <p className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-8 text-center text-sm font-medium text-primary">
                全部审计项均已实质响应，可放心进入讲标准备与归档
              </p>
            ) : (
              <div className="rounded-lg border border-border bg-card p-4 shadow-md">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-card-foreground">未覆盖清单（按风险从高到低）</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      废标条款未覆盖 = 红色危险项，交卷前必须逐条解决；评分项未覆盖 = 失分风险，建议回编制环节补写实质响应
                    </p>
                  </div>
                  <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {REVIEW_FILTERS.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setReviewFilter(f.key)}
                        className={`rounded-full px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                          reviewFilter === f.key
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:text-card-foreground"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </span>
                </div>
                <ul className="mt-3 flex flex-col gap-2">
                  {filteredGaps.length ? (
                    [...filteredGaps.filter((i) => i.kind === "void"), ...filteredGaps.filter((i) => i.kind === "scoring")].map((item) => (
                      <GapItemRow
                        key={`${item.kind}-${item.index}`}
                        item={item}
                        onJump={jumpToSubmissionGap}
                        onReviewStatus={(index, reviewStatus) => setSubmissionReviewStatus(index, reviewStatus)}
                        onSkipRequest={(it) => {
                          setSkipTarget(it)
                          setSkipReason("")
                        }}
                      />
                    ))
                  ) : (
                    <li className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                      当前筛选条件下没有条目，换个筛选看看
                    </li>
                  )}
                </ul>
              </div>
            )}
            {gaps.length > 0 && (
              <details className="rounded-lg border border-border bg-card p-4 shadow-md">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                  查看全部 {total} 条审计明细（含已覆盖项的证据摘录）
                </summary>
                <ul className="mt-3 flex flex-col gap-1.5">
                  {check.items.map((item) => (
                    <li key={`${item.kind}-${item.index}`} className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-2 text-xs">
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${
                          item.covered
                            ? "bg-primary/10 text-primary"
                            : item.kind === "void"
                              ? "bg-destructive/10 text-destructive"
                              : "bg-warning/10 text-warning"
                        }`}
                      >
                        {item.covered ? "已响应" : "未覆盖"}
                      </span>
                      {!item.covered && (
                        <Badge variant={SEVERITY_VARIANT[item.severity]}>{SEVERITY_LABEL[item.severity]}</Badge>
                      )}
                      {!item.covered && item.review_status !== "pending" && (
                        <Badge variant={item.review_status === "addressed" ? "success" : "neutral"}>
                          {REVIEW_STATUS_LABEL[item.review_status]}
                        </Badge>
                      )}
                      <span className="min-w-0 flex-1 leading-relaxed text-card-foreground">
                        [{SUBMISSION_KIND_LABEL[item.kind]}] {item.label}
                      </span>
                      {item.evidence && <span className="shrink-0 text-muted-foreground">证据：{item.evidence}</span>}
                      {!item.covered && item.suggestion && (
                        <span className="shrink-0 text-muted-foreground">建议：{item.suggestion}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {formatReport && (
              <div className="rounded-lg border border-border bg-card p-4 shadow-md">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-card-foreground">
                      <FileSearch className="h-4 w-4 text-primary" />
                      格式规则检查
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          formatHits.length ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary"
                        }`}
                      >
                        {formatHits.length ? `命中 ${formatHits.length} 处` : "全部通过"}
                      </span>
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      按编制环节「格式与暗标设置」中勾选的检查项对各章正文本地扫描（零费用）：超链接 / 加粗下划线标记 / 水印词 / 彩色标记 / 空白页 / 连续空行 / 半角标点密度 / 暗标页数交叉核对 / 数字口径一致性（有全局事实表时自动加测）/ 报价超最高限价 / 承诺不够与参数加码 / 占位元话语残留 / 金额大小写一致性
                      {formatReport.checked_at ? ` · 检查时间 ${formatDateTimeDisplay(formatReport.checked_at)}` : ""}
                    </p>
                  </div>
                  {quoteRewriteHitCount > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={startQuoteRewriteFix}
                      disabled={quoteFixBusy}
                      className="shrink-0 border-primary/40 text-primary shadow-sm hover:bg-primary/10 focus-visible:shadow-[var(--focus-ring)]"
                    >
                      {quoteFixBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1.5 h-3.5 w-3.5" />}
                      {quoteFixBusy ? "整改回注中…" : `引文改写整改（${quoteRewriteHitCount} 处）`}
                    </Button>
                  )}
                </div>
                {formatHits.length === 0 ? (
                  <p className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-4 text-center text-xs font-medium text-primary">
                    各章正文未发现勾选的格式禁则内容
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {formatHits.map((hit, i) => (
                      <li
                        key={`${hit.rule}-${i}`}
                        className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-2 text-xs"
                      >
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${
                            hit.level === "warn" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {hit.level === "warn" ? "警告" : "提示"}
                        </span>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                          {FORMAT_RULE_LABEL[hit.rule]}
                        </span>
                        <span className="shrink-0 font-medium text-card-foreground">{hit.chapter}</span>
                        <span className="min-w-0 flex-1 truncate leading-relaxed text-muted-foreground">{hit.quote}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  命中处请回编制环节修改正文；调整检查范围去「投标文件编制」环节的「格式与暗标设置」面板重新勾选
                </p>
              </div>
            )}
            {/* R275：编制依据版本时效告警卡（兜底：用户未打开规范库补选时也能看到，零 AI） */}
            {staleVersionHits.length > 0 && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 shadow-md">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-warning">
                  <AlertTriangle className="h-4 w-4" />
                  编制依据版本时效：正文中检出 {staleVersionHits.length} 处疑似引用旧版标准
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-warning/80">
                  以规范库（37 条）为事实源，确定性比对正文中的标准编号年份；只报不拦，未命中库内的标准不报（防误伤）。如需更换为现行版本，可回编制环节「规范库补选」核实。
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {staleVersionHits.map((r) => (
                    <li key={`${r.item.code}-${r.citedYear}`} className="text-xs leading-snug text-warning">
                      {staleRefHint(r)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* 循环 8 A3：第三区卡——事实一致性核对（null=未跑/失败不渲染；[]=跑过无矛盾渲染绿态） */}
            {factConflicts && (
              <FactConflictCard
                conflicts={factConflicts}
                patchBusy={factPatchBusy}
                locked={isArchivedLocked}
                onPatch={() => startFactPatch(factConflicts)}
              />
            )}
            {/* D3/R89：第四区卡——AI 内容护栏（只报不拦；null=未跑/失败不渲染；处置由用户判断） */}
            {consistencyIssues && (
              <div className="rounded-lg border border-border bg-card p-4 shadow-md">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-card-foreground">
                      <FileSearch className="h-4 w-4 text-primary" />
                      AI 内容护栏（量化依据 / 量级自洽 / 政策时效）
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          consistencyIssues.length ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary"
                        }`}
                      >
                        {consistencyIssues.length ? `提示 ${consistencyIssues.length} 处` : "未发现问题"}
                      </span>
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      逐章将正文与全局事实表、招标原文、知识库参考做语义核对（与本地数字对账互补不替代）；
                      只报不拦——不自动改写任何正文，是否修改由你判断。受每日预算闸限制，超预算章节可能未检查。
                    </p>
                  </div>
                </div>
                {consistencyIssues.length === 0 ? (
                  <p className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-4 text-center text-xs font-medium text-primary">
                    各章未发现量化依据、量级自洽或政策时效问题
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {consistencyIssues.map((it, i) => (
                      <li
                        key={`${it.rule}-${i}`}
                        className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-2 text-xs"
                      >
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${
                            it.severity === "critical"
                              ? "bg-destructive/10 text-destructive"
                              : it.severity === "major"
                                ? "bg-warning/10 text-warning"
                                : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {CONSISTENCY_SEVERITY_LABEL[it.severity]}
                        </span>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                          {CONSISTENCY_RULE_LABEL[it.rule]}
                        </span>
                        {it.location && <span className="shrink-0 font-medium text-card-foreground">{it.location}</span>}
                        <span className="min-w-0 flex-1 leading-relaxed text-card-foreground">{it.issue}</span>
                        {it.evidence && (
                          <span className="w-full min-w-0 truncate leading-relaxed text-muted-foreground">
                            原文：{it.evidence}
                          </span>
                        )}
                        {it.suggestion && (
                          <span className="w-full min-w-0 leading-relaxed text-primary/90">建议：{it.suggestion}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center shadow-md">
            <ClipboardCheck className="mx-auto h-9 w-9 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-card-foreground">尚未执行交卷体检</p>
            <p className="mt-1 text-xs text-muted-foreground">模拟评标看分数，交卷体检看响应——两项都过了再出手</p>
          </div>
        )}
        {/* T18：文本审计卡（错别字 + 逻辑谬误）——独立于交卷体检的常驻卡，自成入口自成存档 */}
        <TextAuditCard
          report={activeProject?.text_audit ?? null}
          busy={textAuditBusy}
          fixBusy={fixTyposBusy}
          locked={isArchivedLocked}
          hasExternal={activeProject?.bid_source_mode === "external" && !!(activeProject?.bid_external_text ?? "").trim()}
          onRun={startTextAudit}
          onFixTypos={startFixTypos}
          onJumpChapter={jumpToAuditChapter}
          onExport={() => {
            if (activeProject) void import("@/pages/BidWorkspace/bidFiles").then((m) => m.exportTextAuditDocx(activeProject))
          }}
        />
        {/* 循环 5 A2：覆盖审计卡——与交卷体检互补（体检查响应覆盖，审计查写作方案落实），始终可见 */}
        <CoverageAuditCard
          entries={coverageAudit}
          busy={coverageAuditBusy}
          locked={isArchivedLocked}
          chaptersReady={chaptersReady}
          onRun={startCoverageAudit}
          onSupplement={supplementFromAudit}
          improvements={coverageImprovements}
          reflowBusy={chapterReflowBusy}
          onReflow={reflowChapterFromAudit}
        />
        {/* R25（A3 / bid-checklist-01）：交卷前合规清单——形式要件与资质文件逐项确认，与排版/内容检查互补；key 按项目重挂载以本机初始化进度 */}
        <SubmissionChecklistPanel
          key={activeProject?.id ?? ""}
          projectId={activeProject?.id ?? ""}
          report={activeProject?.parse_report ?? null}
          locked={isArchivedLocked}
          onGoParse={!isArchivedLocked ? () => requestStep(PARSE_STEP) : undefined}
        />
        {/* R288（bid-placeholder-owner-split · P1）：交付前必办清单——占位按「谁来办」分流并逐项勾销，
            直接回答「还有几项等我拍板」；判据与 scripts/bid-delivery-gate.mjs 同源，只报不拦 */}
        <DeliveryActionPanel
          key={`actions-${activeProject?.id ?? ""}`}
          projectId={activeProject?.id ?? ""}
          chapters={activeProject?.bid_chapters ?? []}
          projectName={activeProject?.project_name ?? ""}
          locked={isArchivedLocked}
        />
      </div>

      <Dialog open={!!skipTarget} onOpenChange={(open) => !open && setSkipTarget(null)}>
        <DialogContent className="max-w-md border-border bg-card text-card-foreground">
          <DialogHeader>
            <DialogTitle className="text-base text-foreground">跳过该未覆盖项核销</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
              跳过表示确认该项暂不处理（如确实不适用），必须填写原因留痕，交卷闸门与导出报告里都会带上。
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md border border-border bg-background px-3 py-2 text-xs leading-relaxed text-foreground">
            [{skipTarget ? SUBMISSION_KIND_LABEL[skipTarget.kind] : ""}] {skipTarget?.label}
          </p>
          <Textarea
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
            placeholder="跳过原因（必填），如：该评分项为可选加分项，本次投标策略性放弃"
            rows={3}
            maxLength={200}
            className="resize-none border-border bg-background text-sm focus-visible:shadow-[var(--focus-ring)]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSkipTarget(null)} className="border-border text-muted-foreground hover:bg-secondary">
              取消
            </Button>
            <Button
              disabled={!skipReason.trim()}
              onClick={() => {
                if (skipTarget) setSubmissionReviewStatus(skipTarget.index, "skipped", skipReason)
                setSkipTarget(null)
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              确认跳过并留痕
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

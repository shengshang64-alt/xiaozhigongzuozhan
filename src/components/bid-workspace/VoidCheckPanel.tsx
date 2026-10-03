import { useState } from "react"
import { ArrowRightCircle, CheckCircle2, Loader2, ShieldAlert, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTimeDisplay } from "@/lib/dateDisplay"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import {
  REVIEW_STATUS_LABEL,
  SEVERITY_LABEL,
  VOID_STATUS_LABEL,
  effectiveVoidStatus,
  sectionText,
  type ReviewStatus,
  type SeverityLevel,
  type VoidCheck,
  type VoidItem,
  type VoidStatus,
} from "@/pages/BidWorkspace/bidTypes"

type VoidCheckPanelProps = Pick<
  UseBidWorkspace,
  | "activeProject"
  | "voidLoading"
  | "startVoidCheck"
  | "toggleVoidManual"
  | "setVoidManualStatus"
  | "setVoidReviewStatus"
  | "jumpToResponseNode"
  | "voidMissingTitles"
  | "goParseStep"
  | "isArchivedLocked"
  | "bidSourceMode"
  | "sealBusy"
  | "sealResult"
  | "startSealCheck"
>

/** 第九轮改造 2：合规状态 / 严重度 → 语义四档 badge variant */
const STATUS_VARIANT: Record<VoidStatus, "success" | "warning" | "danger"> = {
  compliant: "success",
  partial: "warning",
  non_compliant: "danger",
}

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

const SEVERITY_FILTERS: { key: "all" | SeverityLevel; label: string }[] = [
  { key: "all", label: "全部级别" },
  { key: "critical", label: "重大" },
  { key: "major", label: "较大" },
  { key: "minor", label: "轻微" },
]

export function VoidItemsList({
  check,
  onToggleManual,
  onManualStatus,
  onReviewStatus,
  onSkipRequest,
  onJumpResponse,
  locked = false,
}: {
  check: VoidCheck
  onToggleManual?: (itemId: string) => void
  onManualStatus?: (itemId: string, status: VoidStatus) => void
  onReviewStatus?: (itemId: string, reviewStatus: ReviewStatus) => void
  onSkipRequest?: (item: VoidItem) => void
  onJumpResponse?: (responseLocation: string) => void
  /** 循环 6 A1：归档只读——核销矩阵全部写操作控件禁用（QuickToolsPanel 只读复用不传，默认 false） */
  locked?: boolean
}) {
  return (
    <ul className="flex flex-col gap-3">
      {check.items.map((item, i) => {
        const status = effectiveVoidStatus(item)
        return (
          <li key={item.id} className="rounded-lg border border-border bg-card shadow-md">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
              <p className="min-w-0 flex-1 text-sm font-medium text-foreground">
                <span className="mr-1.5 font-mono text-xs text-primary">{i + 1}</span>
                {item.clause}
              </p>
              <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                <Badge variant={SEVERITY_VARIANT[item.severity]}>{SEVERITY_LABEL[item.severity]}</Badge>
                <Badge variant={STATUS_VARIANT[status]}>
                  {VOID_STATUS_LABEL[status]}
                  {item.manual_checked ? "（已复核）" : ""}
                </Badge>
                {item.review_status !== "pending" && (
                  <Badge variant={item.review_status === "addressed" ? "success" : "neutral"}>
                    {REVIEW_STATUS_LABEL[item.review_status]}
                  </Badge>
                )}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 px-4 py-3 lg:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">招标位置 / 投标响应</p>
                {item.source_location && (
                  <p className="mt-1 text-xs text-muted-foreground">招标位置：{item.source_location}</p>
                )}
                <p className="mt-1 rounded-md border border-border bg-background p-2.5 text-xs leading-relaxed text-foreground">
                  {item.response || "（未找到对应响应）"}
                </p>
                {item.response_location && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    响应位置：
                    {onJumpResponse ? (
                      <button
                        type="button"
                        onClick={() => onJumpResponse(item.response_location)}
                        className="inline-flex items-center gap-0.5 rounded text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <ArrowRightCircle className="h-3.5 w-3.5" />
                        {item.response_location}
                      </button>
                    ) : (
                      item.response_location
                    )}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {item.evidence && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">证据摘录</p>
                    <p className="mt-1 rounded-md border border-border bg-background p-2.5 text-xs leading-relaxed text-foreground">
                      {item.evidence}
                    </p>
                  </div>
                )}
                {item.suggestion && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">整改建议</p>
                    <p className="mt-1 rounded-md border border-border bg-background p-2.5 text-xs leading-relaxed text-foreground">
                      {item.suggestion}
                    </p>
                  </div>
                )}
                {item.reason && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">判定说明</p>
                    <p className="mt-1 rounded-md border border-border bg-background p-2.5 text-xs leading-relaxed text-foreground">
                      {item.reason}
                    </p>
                  </div>
                )}
              </div>
            </div>
            {item.review_status === "skipped" && item.skip_reason && (
              <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                跳过原因：{item.skip_reason}
              </p>
            )}
            {onToggleManual && onManualStatus && onReviewStatus && onSkipRequest && (
              <footer className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={item.manual_checked}
                    onChange={() => onToggleManual(item.id)}
                    disabled={locked}
                    title={locked ? "已归档项目为只读" : undefined}
                    className="h-3.5 w-3.5 accent-primary disabled:cursor-not-allowed"
                  />
                  人工复核确认
                </label>
                <span className="mx-1 h-4 w-px bg-border" />
                <span className="text-xs text-muted-foreground">人工改判：</span>
                {(["compliant", "partial", "non_compliant"] as VoidStatus[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => onManualStatus(item.id, v)}
                    disabled={locked}
                    title={locked ? "已归档项目为只读" : undefined}
                    className={`rounded-full px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60 ${
                      item.manual_status === v
                        ? v === "compliant"
                          ? "bg-primary text-primary-foreground"
                          : v === "partial"
                            ? "bg-secondary text-secondary-foreground ring-1 ring-border"
                            : "bg-destructive text-destructive-foreground"
                        : "bg-muted text-muted-foreground hover:text-card-foreground"
                    }`}
                  >
                    {VOID_STATUS_LABEL[v]}
                  </button>
                ))}
                <span className="mx-1 h-4 w-px bg-border" />
                {item.review_status === "pending" ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onReviewStatus(item.id, "addressed")}
                      disabled={locked}
                      title={locked ? "已归档项目为只读" : undefined}
                      className="border-primary/40 text-primary hover:bg-primary/10"
                    >
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                      标记已处理
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onSkipRequest(item)}
                      disabled={locked}
                      title={locked ? "已归档项目为只读" : undefined}
                      className="border-border text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
                    >
                      跳过（填原因）
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onReviewStatus(item.id, "pending")}
                    disabled={locked}
                    title={locked ? "已归档项目为只读" : undefined}
                    className="border-border text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
                  >
                    撤销核销
                  </Button>
                )}
              </footer>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function VoidCheckPanel({
  activeProject,
  voidLoading,
  startVoidCheck,
  toggleVoidManual,
  setVoidManualStatus,
  setVoidReviewStatus,
  jumpToResponseNode,
  voidMissingTitles,
  goParseStep,
  isArchivedLocked,
  bidSourceMode,
  sealBusy,
  sealResult,
  startSealCheck,
}: VoidCheckPanelProps) {
  // 第九轮改造 2：核销矩阵筛选器 + 跳过原因弹窗（纯 UI 状态）
  const [reviewFilter, setReviewFilter] = useState<"all" | ReviewStatus>("all")
  const [severityFilter, setSeverityFilter] = useState<"all" | SeverityLevel>("all")
  const [skipTarget, setSkipTarget] = useState<VoidItem | null>(null)
  const [skipReason, setSkipReason] = useState("")
  const check = activeProject?.void_check ?? null
  const clauseCount = sectionText(activeProject?.parse_report ?? null, "void_items")
    .split(/\n+/)
    .filter((l) => l.trim()).length
  const chaptersReady =
    bidSourceMode === "external"
      ? !!(activeProject?.bid_external_text ?? "").trim()
      : (activeProject?.bid_chapters ?? []).some((c) => (c.content ?? "").trim())
  const compliantCount = check ? check.items.filter((it) => effectiveVoidStatus(it) === "compliant").length : 0
  const partialCount = check ? check.items.filter((it) => effectiveVoidStatus(it) === "partial").length : 0
  const nonCompliantCount = check ? check.items.filter((it) => effectiveVoidStatus(it) === "non_compliant").length : 0
  const criticalCount = check
    ? check.items.filter((it) => it.severity === "critical" && effectiveVoidStatus(it) !== "compliant" && it.review_status === "pending").length
    : 0
  const filteredItems = check
    ? check.items.filter(
        (it) =>
          (reviewFilter === "all" || it.review_status === reviewFilter) &&
          (severityFilter === "all" || it.severity === severityFilter),
      )
    : []
  return (
    <section className="mx-auto max-w-7xl px-4 pb-14 pt-5">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-background via-secondary to-card px-6 py-6 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-3xl font-bold text-foreground">
              废标项检查
              {bidSourceMode === "external" && <Badge variant="neutral">外部标书审查</Badge>}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              对照解析出的 {clauseCount || "—"} 条废标条款，AI 逐条输出合规核销矩阵：合规状态 + 严重度 + 招标/投标双向定位 + 证据摘录 + 整改建议。跳章整改后回来「标记已处理」，确实不适用的可「跳过」并填原因留痕。
            </p>
          </div>
          <Button
            onClick={startVoidCheck}
            disabled={voidLoading || !clauseCount || !chaptersReady || isArchivedLocked}
            title={isArchivedLocked ? "已归档项目为只读，解除归档后可重新检查" : undefined}
            className="shrink-0 bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
          >
            {voidLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1.5 h-4 w-4" />}
            {voidLoading ? "逐条比对中…" : check ? "重新检查" : "运行废标项检查"}
          </Button>
        </div>
        {!clauseCount && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5">
            <p className="text-xs text-foreground">
              {voidMissingTitles.length
                ? `该检查依赖「${voidMissingTitles.join("、")}」解析项，请先回到解析环节勾选并解析`
                : "还没有废标条款，请先完成「AI 解析报告」环节（也可在解析报告中手动补充条款）"}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={goParseStep}
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              前往解析环节
            </Button>
          </div>
        )}
        {clauseCount > 0 && !chaptersReady && (
          <p className="mt-3 rounded-md border border-dashed border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
            投标文件还没有正文，请先完成「投标文件编制」环节
          </p>
        )}
      </header>

      {voidLoading ? (
        <div className="mt-8 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-primary/30 bg-card py-16 text-center shadow-md">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-foreground">AI 正在逐条比对废标条款…</p>
          <p className="text-xs text-muted-foreground">判定偏保守，拿不准的会标为「部分合规」提醒你人工确认</p>
        </div>
      ) : !check ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border bg-card py-16 text-center shadow-md">
          <ShieldAlert className="mx-auto h-9 w-9 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">尚未执行废标项检查</p>
          <p className="mt-1 text-xs text-muted-foreground">开标前务必跑一遍，任何一条「不合规」都可能直接废标</p>
        </div>
      ) : (
        <div className="mt-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-4 text-center shadow-md">
              <p className="text-2xl font-bold text-primary">{compliantCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">合规</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 text-center shadow-md">
              <p className="text-2xl font-bold text-warning">{partialCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">部分合规</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 text-center shadow-md">
              <p className={`text-2xl font-bold ${nonCompliantCount ? "text-destructive" : "text-foreground"}`}>{nonCompliantCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">不合规</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 text-center shadow-md">
              <p className={`text-2xl font-bold ${criticalCount ? "text-destructive" : "text-foreground"}`}>{criticalCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">critical 未核销</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 shadow-md">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">核销状态</span>
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
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">严重度</span>
              {SEVERITY_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setSeverityFilter(f.key)}
                  className={`rounded-full px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    severityFilter === f.key
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-card-foreground"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </span>
            <span className="ml-auto text-xs text-muted-foreground">
              {filteredItems.length}/{check.items.length} 条 · 检查时间 {formatDateTimeDisplay(check.checked_at)}
            </span>
          </div>

          <div className="mt-4">
            {filteredItems.length ? (
              <VoidItemsList
                check={{ ...check, items: filteredItems }}
                onToggleManual={toggleVoidManual}
                onManualStatus={setVoidManualStatus}
                onReviewStatus={setVoidReviewStatus}
                onSkipRequest={(item) => {
                  setSkipTarget(item)
                  setSkipReason("")
                }}
                onJumpResponse={jumpToResponseNode}
                locked={isArchivedLocked}
              />
            ) : (
              <p className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground shadow-md">
                当前筛选条件下没有条目，换个筛选看看
              </p>
            )}
          </div>
        </div>
      )}

      <Dialog open={!!skipTarget} onOpenChange={(open) => !open && setSkipTarget(null)}>
        <DialogContent className="max-w-md border-border bg-card text-card-foreground">
          <DialogHeader>
            <DialogTitle className="text-base text-foreground">跳过该废标条款核销</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
              跳过表示确认该条款暂不处理（如确实不适用），必须填写原因留痕，交卷闸门与导出报告里都会带上。
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md border border-border bg-background px-3 py-2 text-xs leading-relaxed text-foreground">
            {skipTarget?.clause}
          </p>
          <Textarea
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
            placeholder="跳过原因（必填），如：该条款仅适用于联合体投标，本项目单独投标不适用"
            rows={3}
            maxLength={200}
            className="resize-none border-border bg-background text-sm focus-visible:shadow-[var(--focus-ring)]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSkipTarget(null)} className="border-border text-muted-foreground hover:bg-secondary">
              取消
            </Button>
            <Button
              disabled={!skipReason.trim() || isArchivedLocked}
              onClick={() => {
                if (skipTarget) setVoidReviewStatus(skipTarget.id, "skipped", skipReason)
                setSkipTarget(null)
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              确认跳过并留痕
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Q28 切片B：电子签章体检——仅 external + PDF 可用 */}
      {bidSourceMode === "external" && (
        <div className="mt-5 rounded-lg border border-border bg-card px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">电子签章体检</h2>
            <Button
              size="sm"
              variant="outline"
              disabled={sealBusy}
              onClick={() => void startSealCheck()}
              className="border-primary/40 text-primary hover:bg-primary/10"
            >
              {sealBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />}
              {sealBusy ? "逐页扫描中…" : "运行签章体检"}
            </Button>
          </div>
          {!sealResult && !sealBusy && (
            <p className="mt-2 text-xs text-muted-foreground">
              基于 PDF 页面操作流统计贴图 / 矢量曲线 / 彩色填充三判据，判定各页是否存在签章特征（仅 PDF 投标文件支持）。
            </p>
          )}
          {sealResult && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                扫描 {sealResult.scannedPages}/{sealResult.totalPages} 页，
                疑似无签章 {sealResult.results.filter((r) => r.sealAbsent).length} 页
                （可疑率 {Math.round(sealResult.absentRatio * 100)}%）。
              </p>
              {sealResult.results.some((r) => r.sealAbsent) && (
                <ul className="space-y-1.5">
                  {sealResult.results
                    .filter((r) => r.sealAbsent)
                    .map((r) => (
                      <li key={r.pageNo} className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs">
                        <span className="mt-0.5 shrink-0 font-medium text-destructive">【机器检测】</span>
                        <span className="text-foreground">
                          第 {r.pageNo} 页未检测到签章特征（无贴图、无矢量曲线、无彩色填充文本），
                          请先核对平台上传原件，排除上传/导出环节剥离签章的技术性丢失。
                        </span>
                      </li>
                    ))}
                </ul>
              )}
              {sealResult.imagePageRatio > 0 && (
                <p className="text-xs text-muted-foreground">
                  含图像页占比 {Math.round(sealResult.imagePageRatio * 100)}%——若文件为扫描件，建议人工核对签章页。
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

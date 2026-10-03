import { AlertTriangle, CheckCircle2, Loader2, Pencil, RefreshCw, Trophy, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import { BID_RESULT_LABEL, type BidResult } from "@/pages/BidWorkspace/bidTypes"
// R012（B-3 阶段二）：失单原因结构化——共享定义已上收到 @/lib/lostReason（Round 28 商机侧接入后单一真源）
import { LOST_REASON_CODES, splitLostReason } from "@/lib/lostReason"
import { formatDateTimeDisplay } from "@/lib/dateDisplay"

export { LOST_REASON_CODES }

type ResultRegisterCardProps = Pick<
  UseBidWorkspace,
  | "activeProject"
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
>

const RESULT_BADGE: Record<Exclude<BidResult, "">, string> = {
  won: "bg-primary/10 text-primary",
  lost: "bg-destructive/10 text-destructive",
  pending: "bg-muted text-muted-foreground",
}

const RESULT_CHOICES: { value: Exclude<BidResult, "">; label: string; icon: typeof Trophy }[] = [
  { value: "won", label: "中标", icon: Trophy },
  { value: "lost", label: "失单", icon: XCircle },
  { value: "pending", label: "待定", icon: CheckCircle2 },
]

/** ⑦ 归档环节内的投标结果登记卡：登记中标/失单/待定并自动回流关联商机（第四轮改造） */
export function ResultRegisterCard({
  activeProject,
  resultFormOpen,
  openResultForm,
  closeResultForm,
  resultDraft,
  setResultDraft,
  bidAmountDraft,
  setBidAmountDraft,
  resultLostReasonDraft,
  setResultLostReasonDraft,
  resultSaving,
  submitBidResult,
  retrySyncResult,
  syncFailedStep,
  linkedOpportunityName,
  locked = false,
}: ResultRegisterCardProps & {
  /** 循环 6 A1：归档只读——登记 / 修改 / 重新同步全部禁用（只读展示保留） */
  locked?: boolean
}) {
  if (!activeProject) return null
  const proj = activeProject
  const registered = proj.bid_result !== "" && proj.bid_result !== null && proj.bid_result !== undefined
  const result = proj.bid_result as Exclude<BidResult, ""> | ""
  const linked = Boolean(proj.opportunity_id)
  const { code: lostReasonCode, detail: lostReasonDetail } = splitLostReason(resultLostReasonDraft)

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex min-h-10 flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">投标结果登记</h2>
          {registered && result && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${RESULT_BADGE[result] ?? RESULT_BADGE.pending}`}>
              {BID_RESULT_LABEL[result]}
            </span>
          )}
        </div>
        {!resultFormOpen && (
          <Button
            variant={registered ? "outline" : "default"}
            onClick={openResultForm}
            disabled={locked}
            title={locked ? "已归档项目为只读，解除归档后可登记结果" : undefined}
            className={
              registered
                ? "border-border text-card-foreground shadow-sm hover:bg-secondary"
                : "bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
            }
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            {registered ? "修改" : "登记结果"}
          </Button>
        )}
      </header>

      {resultFormOpen ? (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2">
            {RESULT_CHOICES.map((c) => {
              const Icon = c.icon
              const active = resultDraft === c.value
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setResultDraft(c.value)}
                  className={
                    active
                      ? "inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      : "inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                  {c.label}
                </button>
              )
            })}
          </div>
          {resultDraft === "won" && (
            <label className="mt-3 grid max-w-xs gap-1.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">中标金额（万元，可留空；留空则保留原金额）</span>
              <input
                type="number"
                min={0}
                value={bidAmountDraft}
                onChange={(e) => setBidAmountDraft(e.target.value)}
                placeholder="如：320"
                className="h-9 rounded-md border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </label>
          )}
          {resultDraft === "lost" && (
            <>
              <label className="mt-3 grid max-w-xs gap-1.5 text-sm">
                <span className="text-xs font-medium text-muted-foreground">失单原因类别（R012 结构化，便于复盘聚合）</span>
                <select
                  value={lostReasonCode}
                  onChange={(e) => {
                    const code = e.target.value
                    setResultLostReasonDraft(code ? `【${code}】${lostReasonDetail}` : lostReasonDetail)
                  }}
                  className="h-9 rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <option value="">未分类（仅填明细）</option>
                  {LOST_REASON_CODES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="mt-2 grid gap-1.5 text-sm">
                <span className="text-xs font-medium text-muted-foreground">失单明细（可留空，如：价格分落后 8%）</span>
                <textarea
                  value={lostReasonDetail}
                  onChange={(e) => setResultLostReasonDraft(lostReasonCode ? `【${lostReasonCode}】${e.target.value}` : e.target.value)}
                  rows={2}
                  placeholder="补充说明，方便后续复盘"
                  className="rounded-md border border-border bg-background px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </label>
            </>
          )}
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {linked
              ? `登记中标/失单后将自动同步到关联商机「${linkedOpportunityName}」：更新商机阶段并写一条跟进记录`
              : "关联商机后登记结果将自动同步到客户管理；当前未关联，结果只保存在本项目"}
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              onClick={() => void submitBidResult()}
              disabled={resultSaving || locked}
              title={locked ? "已归档项目为只读" : undefined}
              className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
            >
              {resultSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {resultSaving ? "登记中…" : "登记结果"}
            </Button>
            <Button variant="outline" onClick={closeResultForm} disabled={resultSaving} className="border-border text-muted-foreground hover:text-foreground">
              取消
            </Button>
          </div>
        </div>
      ) : registered ? (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-foreground">
            {result === "won" && proj.bid_amount !== null && proj.bid_amount > 0 && (
              <span>中标金额：<strong className="font-bold text-primary">{proj.bid_amount} 万元</strong></span>
            )}
            {result === "lost" && proj.lost_reason && (
              <span className="text-muted-foreground">
                失单原因：
                {(() => {
                  const { code, detail } = splitLostReason(proj.lost_reason)
                  return code ? `${code}${detail ? ` · ${detail}` : ""}` : detail || proj.lost_reason
                })()}
              </span>
            )}
            {proj.result_synced_at && (
              <span className="text-xs text-muted-foreground">已同步到客户管理 · {formatDateTimeDisplay(proj.result_synced_at)}</span>
            )}
          </div>
          {syncFailedStep ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {syncFailedStep === "stage"
                  ? "同步商机阶段失败，结果已保存在本项目"
                  : syncFailedStep === "record"
                    ? "写入跟进记录失败，商机阶段已更新"
                    : "同步时间回写失败，回流可能已完成"}
              </p>
              {/* 循环 7 A3：归档 + 同步失败态给出解除归档引导，避免横幅成死路 */}
              {locked && (
                <p className="w-full text-xs text-muted-foreground">项目已归档，解除归档后可重新同步</p>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void retrySyncResult()}
                disabled={resultSaving || locked}
                title={locked ? "已归档项目为只读" : undefined}
                className="border-primary/40 text-primary hover:bg-primary/10"
              >
                {resultSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                重新同步商机
              </Button>
            </div>
          ) : (
            !linked && result !== "pending" && (
              <p className="text-xs text-muted-foreground">关联商机后登记结果将自动同步到客户管理</p>
            )
          )}
        </div>
      ) : (
        <p className="mt-2 rounded-md border border-dashed border-border py-4 text-center text-xs leading-relaxed text-muted-foreground">
          开标出结果后在这里登记中标/失单/待定，{linked ? "结果会自动回流到关联商机" : "关联商机后结果会自动同步到客户管理"}
        </p>
      )}
    </section>
  )
}

import { useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, CheckCircle2, ExternalLink, FileCheck2, FileText, Loader2, Pencil, Sparkles, Trash2, XCircle } from "lucide-react"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { localDateStamp } from "@/lib/dateStamp"
import {
  BID_STAGE_LABEL,
  bidResultBadgeClass,
  bidResultLabel,
  PIPELINE_STAGES,
  STAGE_LABEL,
  fmtAmount,
  fmtDate,
  fmtDateTime,
  isTerminalStage,
  type BidProjectLinkRow,
  type CustomerRow,
  type FollowRecordRow,
  type OppStage,
  type OpportunityRow,
} from "@/pages/CustomerManagement/customerTypes"
import { SkillPickerFor } from "@/components/common/SkillPicker"
import type { UseScopeSkills } from "@/hooks/useScopeSkills"

type OpportunityDetailPanelProps = {
  opportunity: OpportunityRow
  customer: CustomerRow | null
  records: FollowRecordRow[]
  linkedBids: BidProjectLinkRow[]
  onRequestStageChange: (opp: OpportunityRow, target: OppStage) => void
  onEdit: () => void
  onClose: () => void
  // A1：删除商机（详情面板内统一 ConfirmDialog 确认后调用，成功后由 Logic 关闭面板）
  onDelete: () => void
  deleting: boolean
  // C1（循环 6 N2）：删除确认弹窗打开前的下游引用检测——计数为 null 时静默降级用原文案
  deleteRefCounts: { bids: number; quotes: number } | null
  deleteRefsChecking: boolean
  onPreDeleteCheck: (oppId: string) => Promise<void>
  aiSuggestions: string[]
  suggesting: boolean
  onSuggest: () => void
  onApplyNextAction: (suggestion: string) => void
  onApplyRecord: (suggestion: string) => void
  // 轮次 F：customer-follow 技能选择器源
  followSkills: UseScopeSkills
}

export function OpportunityDetailPanel({
  opportunity,
  customer,
  records,
  linkedBids,
  onRequestStageChange,
  onEdit,
  onClose,
  onDelete,
  deleting,
  deleteRefCounts,
  deleteRefsChecking,
  onPreDeleteCheck,
  aiSuggestions,
  suggesting,
  onSuggest,
  onApplyNextAction,
  onApplyRecord,
  followSkills,
}: OpportunityDetailPanelProps) {
  // A2-9: Follow-up records show only the most recent 5 by default, with a "View All" toggle to expand
  const [showAllRecords, setShowAllRecords] = useState(false)
  // A1：删除商机确认弹窗开合（本地 UI 态）
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const ended = isTerminalStage(opportunity.stage)
  // 循环8 C5：下次跟进逾期判定（按本地日期的 YYYY-MM-DD 字典序比较即可）
  const nextFollow = (opportunity.next_follow_date ?? "").slice(0, 10)
  const todayStr = localDateStamp()
  const nextFollowOverdue = Boolean(nextFollow) && nextFollow < todayStr && !ended
  const currentIdx = PIPELINE_STAGES.indexOf(opportunity.stage as OppStage)
  const refRoute = opportunity.ref_type === "solution" ? "/solution-studio" : "/bid-workspace"
  // C1：有下游引用时确认弹窗文案升级带计数警告（不阻断强删）；计数为 null/全 0 时文案不变
  const refParts: string[] = []
  if (deleteRefCounts) {
    if (deleteRefCounts.bids > 0) refParts.push(`${deleteRefCounts.bids} 个投标项目`)
    if (deleteRefCounts.quotes > 0) refParts.push(`${deleteRefCounts.quotes} 份报价单`)
  }
  const deleteDescription =
    `将删除商机「${opportunity.opp_name}」及其阶段与金额信息，删除后不可恢复。已登记的关联待办与历史跟进记录不会一并删除，如需清理请手动处理。` +
    (refParts.length > 0
      ? `该商机关联 ${refParts.join(" / ")}，删除后这些项目的结果回流将失败，建议先在对应项目里解除关联。`
      : "")
  // C1：点删除先等引用计数返回（失败静默降级为 null）再开弹窗
  const handleDeleteClick = () => {
    if (deleting || deleteRefsChecking) return
    void (async () => {
      await onPreDeleteCheck(opportunity.id)
      setConfirmDeleteOpen(true)
    })()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4 shadow-md lg:p-5">
        <header className="flex min-h-14 items-start justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground">
              {opportunity.customer_name || customer?.hospital_name || "未知客户"} 的商机
            </p>
            <h3 className="mt-0.5 text-lg font-semibold text-foreground">{opportunity.opp_name}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Pencil className="h-3.5 w-3.5 text-primary" />
              编辑
            </button>
            <button
              type="button"
              onClick={handleDeleteClick}
              disabled={deleting || deleteRefsChecking}
              className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-background px-2.5 py-1.5 text-xs font-medium text-destructive shadow-sm transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {deleteRefsChecking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {deleteRefsChecking ? "检查关联…" : "删除"}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="收起商机详情"
              className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              收起
            </button>
          </div>
        </header>

        {ended ? (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted/60 p-3">
            {opportunity.stage === "won" ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
            ) : (
              <XCircle className="h-5 w-5 shrink-0 text-destructive" />
            )}
            <div>
              <p className="text-sm font-semibold text-foreground">
                已{opportunity.stage === "won" ? "中标" : "失单"}（终态）
              </p>
              {opportunity.stage === "lost" && opportunity.lost_reason && (
                <p className="mt-0.5 text-xs text-muted-foreground">失单原因：{opportunity.lost_reason}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-xs font-medium text-muted-foreground">阶段推进（点击下一阶段，需补一条跟进记录）</p>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {PIPELINE_STAGES.map((stage, index) => {
                const isCurrent = stage === opportunity.stage
                const reached = index <= currentIdx
                return (
                  <div key={stage} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onRequestStageChange(opportunity, stage)}
                      disabled={isCurrent}
                      className={
                        isCurrent
                          ? "rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary ring-1 ring-primary"
                          : reached
                            ? "rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
                            : "rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      }
                    >
                      {STAGE_LABEL[stage]}
                    </button>
                    {index < PIPELINE_STAGES.length - 1 && (
                      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                  </div>
                )
              })}
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              <button
                type="button"
                onClick={() => onRequestStageChange(opportunity, "won")}
                className="rounded-full border border-primary/40 bg-card px-3 py-1 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                中标
              </button>
              <button
                type="button"
                onClick={() => onRequestStageChange(opportunity, "lost")}
                className="rounded-full border border-destructive/40 bg-card px-3 py-1 text-xs font-medium text-destructive shadow-sm transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                失单
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-md border border-border bg-background p-3 shadow-sm">
            <p className="text-xs text-muted-foreground">预计金额</p>
            <p className="mt-1 text-sm font-bold text-foreground">
              {opportunity.expected_amount > 0 ? fmtAmount(opportunity.expected_amount) : "待定"}
            </p>
          </div>
          <div className="rounded-md border border-border bg-background p-3 shadow-sm">
            <p className="text-xs text-muted-foreground">预计成交</p>
            <p className="mt-1 text-sm font-bold text-foreground">
              {opportunity.expected_close_date ? fmtDate(opportunity.expected_close_date) : "待定"}
            </p>
          </div>
          {/* 循环8 C5：第五卡「下次跟进」——逾期且非终态时用 destructive 文字色提示 */}
          <div className="rounded-md border border-border bg-background p-3 shadow-sm">
            <p className="text-xs text-muted-foreground">下次跟进</p>
            <p className={`mt-1 text-sm font-bold ${nextFollowOverdue ? "text-destructive" : "text-foreground"}`}>
              {nextFollow ? fmtDate(nextFollow) : "未安排"}
              {nextFollowOverdue && <span className="ml-1 text-xs font-medium">已逾期</span>}
            </p>
          </div>
          <div className="col-span-2 rounded-md border border-border bg-background p-3 shadow-sm sm:col-span-1">
            <p className="text-xs text-muted-foreground">下一步动作</p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {opportunity.next_action || "待补充，可用 AI 跟进建议生成"}
            </p>
          </div>
        </div>

        {opportunity.ref_name && (
          <Link
            to={refRoute}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-primary shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {opportunity.ref_type === "solution" ? "关联方案" : "关联标书项目"}：{opportunity.ref_name}
          </Link>
        )}
        {opportunity.notes && (
          <p className="mt-3 rounded-md border border-dashed border-border bg-background p-3 text-xs leading-relaxed text-muted-foreground">
            参与人备注：{opportunity.notes}
          </p>
        )}

        {/* 2026-10-28（DS-R06）：补「商机 → 下一步材料」的流程断点。
            DS-R05 只在「关联投标」空态里补了去标书工作台的链接，但方案这条线仍是死的：
            产品支持「商机关联方案」（建方案时选商机 → 回写 opportunities.ref_type=solution），
            可商机详情里没有任何入口能走过去。这里独立成一个「下一步」区，两条线并列。
            要去的两个入口都带 opportunity=<id>&hospital=<医院名> 深链，目标页据此预置。 */}
        <div className="mt-4 border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <p className="text-xs font-semibold text-muted-foreground">基于本商机继续做材料</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Link
              to={`/solution-studio?opportunity=${encodeURIComponent(opportunity.id)}&hospital=${encodeURIComponent(
                customer?.hospital_name ?? opportunity.customer_name ?? "",
              )}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-card px-2.5 py-1 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <FileText className="h-3.5 w-3.5" /> 去方案工作室新建
              <ExternalLink className="h-3 w-3" />
            </Link>
            <Link
              to={`/bid-workspace?opportunity=${encodeURIComponent(opportunity.id)}&hospital=${encodeURIComponent(
                customer?.hospital_name ?? opportunity.customer_name ?? "",
              )}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <FileCheck2 className="h-3.5 w-3.5" /> 去标书工作台新建
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {/* 第二轮改造：关联投标（按 bid_projects.opportunity_id 匹配，点击跳标书工作台） */}
        <div className="mt-4 border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-primary" />
            <p className="text-xs font-semibold text-muted-foreground">关联投标</p>
            {linkedBids.length > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{linkedBids.length} 个</span>
            )}
          </div>
          {linkedBids.length === 0 ? (
            <p className="mt-2 rounded-md border border-dashed border-border py-3 text-center text-xs text-muted-foreground">
              在标书工作中关联本商机后，投标结果会自动同步到这里（入口见上方「基于本商机继续做材料」）
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {linkedBids.map((bid) => {
                const result = bid.bid_result ?? ""
                return (
                  <li key={bid.id}>
                    <Link
                      to={`/bid-workspace?project=${bid.id}`}
                      className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{bid.project_name || "未命名投标项目"}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {BID_STAGE_LABEL[bid.stage] ?? bid.stage}
                          {result === "won" && bid.bid_amount ? ` · 中标金额 ${bid.bid_amount} 万元` : ""}
                          {result === "lost" && bid.lost_reason ? ` · 失单原因：${bid.lost_reason}` : ""}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${bidResultBadgeClass(result)}`}>
                        {bidResultLabel(result)}
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-primary" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-md lg:p-5">
        <header className="flex min-h-14 flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-base font-semibold text-foreground">AI 跟进建议</h3>
          </div>
          <button
            type="button"
            onClick={onSuggest}
            disabled={suggesting}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-transform hover:scale-105 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {suggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {suggesting ? "生成中…" : aiSuggestions.length > 0 ? "重新生成建议" : "生成跟进建议"}
          </button>
        </header>
        <div className="mt-1">
          <SkillPickerFor scope="customer-follow" source={followSkills} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          基于客户档案、当前阶段与最近跟进记录生成，采纳后可存为下一步动作或跟进记录
        </p>
        {aiSuggestions.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2">
            {aiSuggestions.map((suggestion, index) => (
              <li
                key={`${index}-${suggestion.slice(0, 12)}`}
                className="rounded-md border border-border bg-background p-3 shadow-sm"
              >
                <p className="text-sm leading-relaxed text-foreground">{suggestion}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onApplyNextAction(suggestion)}
                    className="rounded-md border border-primary/40 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    设为下一步动作
                  </button>
                  <button
                    type="button"
                    onClick={() => onApplyRecord(suggestion)}
                    className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    存为跟进记录
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          !suggesting && (
            <p className="mt-3 rounded-md border border-dashed border-border py-5 text-center text-xs text-muted-foreground">
              还没有建议，点右上角按钮生成
            </p>
          )
        )}
        {records.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="text-xs font-semibold text-muted-foreground">该商机的跟进记录</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {(showAllRecords ? records : records.slice(0, 5)).map((record) => (
                <li key={record.id} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">[{fmtDateTime(record.created)}]</span>{" "}
                  {record.record_type}
                  {record.stage_change ? `（${record.stage_change}）` : ""}：{record.content}
                </li>
              ))}
            </ul>
            {records.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllRecords((v) => !v)}
                className="mt-2 rounded text-xs font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {showAllRecords ? "收起" : `查看全部 ${records.length} 条跟进`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* A1：删除商机统一走全站 ConfirmDialog（danger 态），确认后 DELETE + 本地剔除 + 关面板 */}
      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={(next) => {
          if (!deleting) setConfirmDeleteOpen(next)
        }}
        title="删除商机"
        description={deleteDescription}
        confirmText="确认删除"
        tone="danger"
        busy={deleting}
        onConfirm={onDelete}
      />
    </div>
  )
}

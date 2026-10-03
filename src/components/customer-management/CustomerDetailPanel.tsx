import { useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, ChevronDown, FileCheck2, FileText, Loader2, Plus, Receipt, Target } from "lucide-react"
import { CustomerProfileCard } from "@/components/customer-management/CustomerProfileCard"
import { FollowTimeline } from "@/components/customer-management/FollowTimeline"
import {
  CHAIN_KIND_LABEL,
  fmtAmount,
  fmtDate,
  isTerminalStage,
  STAGE_LABEL,
  type ChainAssetItem,
  type ChainAssetKind,
  type CustomerRow,
  type FollowRecordRow,
  type OppStage,
  type OpportunityRow,
} from "@/pages/CustomerManagement/customerTypes"

const CHAIN_KIND_ICON: Record<ChainAssetKind, typeof FileText> = {
  solution: FileText,
  bid: FileCheck2,
  quote: Receipt,
}

type CustomerDetailPanelProps = {
  customer: CustomerRow
  opportunities: OpportunityRow[]
  selectedOpportunityId: string | null
  onSelectOpportunity: (oppId: string) => void
  onNewOpportunity: (customerId: string) => void
  onEditCustomer: () => void
  /** T7：删除当前客户（详情面板内 ConfirmDialog 确认后调用，成功后由 Logic 关闭面板） */
  onDeleteCustomer: (customerId: string) => void
  deletingCustomerId: string | null
  /** 单家定向智能补全（透传给 CustomerProfileCard） */
  onEnrichOne: (customerId: string) => void
  enrichingOneId: string | null
  chainAssets: ChainAssetItem[]
  chainLoading: boolean
  followRecords: FollowRecordRow[]
  recordsLoading: boolean
  followTotalCount: number | null
  followHasMore: boolean
  followLoadingMore: boolean
  onLoadMoreFollows: () => void
  quickType: string
  setQuickType: (value: string) => void
  quickContent: string
  setQuickContent: (value: string) => void
  onAddFollow: () => void
  addingFollow: boolean
  /** A1：删除单条跟进记录（透传给 FollowTimeline） */
  onDeleteFollow: (recordId: string) => void
  deletingFollowId: string | null
  contactName: string
  setContactName: (value: string) => void
  contactTitle: string
  setContactTitle: (value: string) => void
  contactPhone: string
  setContactPhone: (value: string) => void
  onAddContact: () => void
  onRemoveContact: (index: number) => void
  savingContact: boolean
}

export function CustomerDetailPanel({
  customer,
  opportunities,
  selectedOpportunityId,
  onSelectOpportunity,
  onNewOpportunity,
  onEditCustomer,
  onDeleteCustomer,
  deletingCustomerId,
  onEnrichOne,
  enrichingOneId,
  chainAssets,
  chainLoading,
  followRecords,
  recordsLoading,
  followTotalCount,
  followHasMore,
  followLoadingMore,
  onLoadMoreFollows,
  quickType,
  setQuickType,
  quickContent,
  setQuickContent,
  onAddFollow,
  addingFollow,
  onDeleteFollow,
  deletingFollowId,
  contactName,
  setContactName,
  contactTitle,
  setContactTitle,
  contactPhone,
  setContactPhone,
  onAddContact,
  onRemoveContact,
  savingContact,
}: CustomerDetailPanelProps) {
  // 「全链路资产」折叠区开合（本地 UI 状态；A2-9 空时显示引导性空态，不再整区隐藏）
  const [chainOpen, setChainOpen] = useState(true)
  return (
    <div className="flex flex-col gap-4">
      <CustomerProfileCard
        customer={customer}
        onEdit={onEditCustomer}
        onDelete={onDeleteCustomer}
        deleting={deletingCustomerId === customer.id}
        opportunityCount={opportunities.length}
        onEnrichOne={onEnrichOne}
        enrichingOneId={enrichingOneId}
        contactName={contactName}
        setContactName={setContactName}
        contactTitle={contactTitle}
        setContactTitle={setContactTitle}
        contactPhone={contactPhone}
        setContactPhone={setContactPhone}
        onAddContact={onAddContact}
        onRemoveContact={onRemoveContact}
        savingContact={savingContact}
      />

      <div className="rounded-lg border border-border bg-card p-4 shadow-md lg:p-5">
        <header className="flex min-h-14 items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            <h3 className="text-base font-semibold text-foreground">商机</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {opportunities.length} 条
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNewOpportunity(customer.id)}
            className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-background px-2.5 py-1.5 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            新建商机
          </button>
        </header>
        {opportunities.length === 0 ? (
          <p className="mt-2 rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
            该客户下还没有商机，点「新建商机」开一条
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {opportunities.map((opp) => {
              const ended = isTerminalStage(opp.stage)
              const active = opp.id === selectedOpportunityId
              return (
                <li key={opp.id}>
                  <button
                    type="button"
                    onClick={() => onSelectOpportunity(opp.id)}
                    className={
                      active
                        ? "flex w-full items-center gap-3 rounded-md border-2 border-primary bg-primary/5 p-3 text-left shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        : ended
                          ? "flex w-full items-center gap-3 rounded-md border border-border bg-muted/50 p-3 text-left opacity-75 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          : "flex w-full items-center gap-3 rounded-md border border-border bg-background p-3 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">{opp.opp_name}</p>
                        <span
                          className={
                            opp.stage === "won"
                              ? "badge-success"
                              : opp.stage === "lost"
                                ? "badge-danger"
                                : "badge-neutral"
                          }
                        >
                          {opp.stage ? STAGE_LABEL[opp.stage as OppStage] : "未设置"}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {[
                          opp.expected_amount > 0 ? `预计 ${fmtAmount(opp.expected_amount)}` : "",
                          opp.expected_close_date ? `${fmtDate(opp.expected_close_date)} 成交` : "",
                          opp.next_action ? `下一步：${opp.next_action}` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ") || "暂无金额与下一步动作"}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-primary" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* 第二轮改造：全链路资产折叠区（商机区之后、跟进时间线之前；A2-9 空时显示引导性空态） */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-md lg:p-5">
        <button
          type="button"
          onClick={() => setChainOpen((prev) => !prev)}
          className="flex min-h-14 w-full items-center justify-between gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md"
        >
          <span className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-primary" />
            <span className="text-base font-semibold text-foreground">全链路资产</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{chainAssets.length} 项</span>
          </span>
          {chainLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${chainOpen ? "rotate-180" : ""}`} />
          )}
        </button>
        {chainOpen && !chainLoading && chainAssets.length === 0 && (
          <div className="mt-3 rounded-md border border-dashed border-border px-4 py-10 text-center">
            <FileText className="mx-auto h-7 w-7 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium text-foreground">还没有关联的全链路资产</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              为「{customer.hospital_name}」完成一份方案、报价或投标项目后，会自动归集到这里
            </p>
            <Link
              to="/solution-studio"
              className="mt-3 inline-block rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              去「方案编制」创建方案
            </Link>
          </div>
        )}
        {chainOpen && !chainLoading && chainAssets.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5">
            {chainAssets.map((asset) => {
              const Icon = CHAIN_KIND_ICON[asset.kind]
              return (
                <li key={`${asset.kind}-${asset.id}`}>
                  <Link
                    to={asset.route}
                    className="flex w-full items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{asset.name}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {CHAIN_KIND_LABEL[asset.kind]}
                        </span>
                        {asset.statusLabel && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            {asset.statusLabel}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {asset.updated ? `更新于 ${fmtDate(asset.updated)}` : ""}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-primary" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <FollowTimeline
        records={followRecords}
        recordsLoading={recordsLoading}
        totalRecords={followTotalCount}
        hasMore={followHasMore}
        loadingMore={followLoadingMore}
        onLoadMore={onLoadMoreFollows}
        quickType={quickType}
        setQuickType={setQuickType}
        quickContent={quickContent}
        setQuickContent={setQuickContent}
        onAddFollow={onAddFollow}
        addingFollow={addingFollow}
        onDeleteFollow={onDeleteFollow}
        deletingFollowId={deletingFollowId}
      />
    </div>
  )
}

import { useState } from "react"
import { Building2, LayoutGrid, Users } from "lucide-react"
import { CustomerDataCheckupDialog } from "@/components/customer-management/CustomerDataCheckupDialog"
import { CostConfirmDialog } from "@/components/rh/CostConfirmDialog"
import { PageHeader } from "@/components/shell/PageHeader"
import { CrmToolbar } from "@/components/customer-management/CrmToolbar"
import { CrmStatsRow } from "@/components/customer-management/CrmStatsRow"
import { CustomerListPanel } from "@/components/customer-management/CustomerListPanel"
import { CustomerDetailPanel } from "@/components/customer-management/CustomerDetailPanel"
import { CustomerFormDialog } from "@/components/customer-management/CustomerFormDialog"
import { OpportunityDialog } from "@/components/customer-management/OpportunityDialog"
import { OpportunityDetailPanel } from "@/components/customer-management/OpportunityDetailPanel"
import { StageChangeDialog } from "@/components/customer-management/StageChangeDialog"
import { KanbanBoard } from "@/components/customer-management/KanbanBoard"
import { WinLossReviewPanel } from "@/components/customer-management/WinLossReviewPanel"
import type { useCustomerManagement } from "./useCustomerManagement"

export function CustomerManagementPage(p: ReturnType<typeof useCustomerManagement>) {
  // R216 数据体检面板
  const [checkupOpen, setCheckupOpen] = useState(false)

  return (
    <div className="animate-in fade-in duration-500 text-foreground">
      <CrmToolbar
        modelOptions={p.modelOptions}
        selectedModelKey={p.selectedModelKey}
        handleSelectModel={p.handleSelectModel}
        onNewCustomer={p.openNewCustomer}
        onNewOpportunity={() => p.openNewOpportunity()}
      />

      <PageHeader
        title="客户管理"
        desc="医院客户档案与商机跟进，把每家目标医院跟到位，数据保存在服务端"
      />

      <main>
        <CrmStatsRow
          customerCount={p.stats.customerCount}
          activeOppCount={p.stats.activeOppCount}
          monthFollowCount={p.stats.monthFollowCount}
          customerCountCapped={p.customerCountCapped}
          activeOppCountCapped={p.oppCapped}
          monthFollowCountCapped={p.followCapped}
        />


        <section className="mb-5 flex w-fit items-center gap-1 rounded-full bg-muted p-0.5">
          <button
            type="button"
            onClick={() => p.setView("list")}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              p.view === "list"
                ? "bg-card font-medium text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Users className="h-4 w-4" />
            客户列表
          </button>
          <button
            type="button"
            onClick={() => p.setView("board")}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              p.view === "board"
                ? "bg-card font-medium text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
            商机看板
          </button>
        </section>

        {p.view === "list" ? (
          <div className="grid items-start gap-4 pb-10 lg:grid-cols-[2fr_3fr]">
            <CustomerListPanel
              customers={p.filteredCustomers}
              totalCount={p.totalCustomers}
              loadedCount={p.customers.length}
              hasMore={p.customersHasMore}
              loadingMore={p.customersLoadingMore}
              onLoadMore={() => void p.loadMoreCustomers()}
              dataLoading={p.dataLoading}
                    searchText={p.searchText}
              setSearchText={p.setSearchText}
              typeFilter={p.typeFilter}
              setTypeFilter={p.setTypeFilter}
              regionFilter={p.regionFilter}
              setRegionFilter={p.setRegionFilter}
              regionOptions={p.regionOptions}
              sortBy={p.sortBy}
              setSortBy={p.setSortBy}
              selectedCustomerId={p.selectedCustomer?.id ?? null}
              onSelectCustomer={p.selectCustomer}
              onOpenCheckup={() => setCheckupOpen(true)}
              oppCountByCustomer={p.oppCountByCustomer}
              onNewCustomer={p.openNewCustomer}
              batchEnriching={p.batchEnriching}
              batchProgress={p.batchProgress}
              onBatchEnrich={(limit) => void p.runBatchEnrich(limit)}
              onCancelBatchEnrich={p.cancelBatchEnrich}
            />

            <div className="min-h-60">
              {p.selectedOpportunity ? (
                <OpportunityDetailPanel
                  opportunity={p.selectedOpportunity}
                  customer={p.selectedCustomer}
                  records={p.oppRecords}
                  linkedBids={p.linkedBids}
                  onRequestStageChange={p.requestStageChange}
                  onEdit={() => p.openEditOpportunity(p.selectedOpportunity!)}
                  onClose={p.closeOpportunity}
                  onDelete={() => void p.deleteOpportunity(p.selectedOpportunity!.id)}
                  deleting={p.deletingOppId === p.selectedOpportunity.id}
                  deleteRefCounts={p.deleteOppRefCounts}
                  deleteRefsChecking={p.deleteRefsChecking}
                  onPreDeleteCheck={p.checkOpportunityDeleteRefs}
                  aiSuggestions={p.aiSuggestions}
                  suggesting={p.suggesting}
                  onSuggest={p.runSuggest}
                  onApplyNextAction={p.applySuggestionAsNextAction}
                  onApplyRecord={p.applySuggestionAsRecord}
                  followSkills={p.customerFollowSkills}
                />
              ) : p.selectedCustomer ? (
                <CustomerDetailPanel
                  customer={p.selectedCustomer}
                  opportunities={p.customerOpps}
                  siteLeads={p.siteLeads?.customerId === p.selectedCustomer.id ? p.siteLeads.leads : []}
                  leadSavingUrl={p.leadSavingKey}
                  onLeadToOpportunity={(lead) => void p.convertLeadToOpportunity(p.selectedCustomer!, lead)}
                  selectedOpportunityId={null}
                  onSelectOpportunity={p.selectOpportunity}
                  onNewOpportunity={p.openNewOpportunity}
                  onEditCustomer={() => p.openEditCustomer(p.selectedCustomer!)}
                  onDeleteCustomer={p.deleteCustomer}
                  deletingCustomerId={p.deletingCustomerId}
                  onEnrichOne={p.enrichOneCustomer}
                  enrichingOneId={p.enrichingOneId}
                  chainAssets={p.chainAssets}
                  chainLoading={p.chainLoading}
                  followRecords={p.followRecords}
                  recordsLoading={p.recordsLoading}
                  followTotalCount={p.totalRecords}
                  followHasMore={p.recordsHasMore}
                  followLoadingMore={p.recordsLoadingMore}
                  onLoadMoreFollows={() => void p.loadMoreFollowRecords()}
                  quickType={p.quickType}
                  setQuickType={p.setQuickType}
                  quickContent={p.quickContent}
                  setQuickContent={p.setQuickContent}
                  onAddFollow={p.addQuickFollow}
                  addingFollow={p.addingFollow}
                  onDeleteFollow={(recordId) => void p.deleteFollowRecord(recordId)}
                  deletingFollowId={p.deletingFollowId}
                  contactName={p.contactName}
                  setContactName={p.setContactName}
                  contactTitle={p.contactTitle}
                  setContactTitle={p.setContactTitle}
                  contactPhone={p.contactPhone}
                  setContactPhone={p.setContactPhone}
                  onAddContact={p.addContact}
                  onRemoveContact={p.removeContact}
                  savingContact={p.savingContact}
                />
              ) : (
                <div className="flex h-full min-h-60 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card py-16 text-center shadow-md">
                  <Building2 className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">
                    从左侧选一位客户查看档案与商机
                  </p>
                  <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
                    客户详情里可以补档案、加联系人、记跟进、开商机，并用 AI 生成下一步跟进建议
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="pb-10">
            <KanbanBoard
              boardGroups={p.boardGroups}
              totalCount={p.totalOpps}
              hasMore={p.oppsHasMore}
              loadingMore={p.oppsLoadingMore}
              onLoadMore={() => void p.loadMoreOpportunities()}
              onOpenOpportunity={p.openOpportunityFromBoard}
              onNewOpportunity={() => p.openNewOpportunity()}
              onMoveStage={(opp, target) => void p.moveOpportunityStage(opp, target)}
            />
            {/* Round 28（winloss-01）：丢单原因 Pareto + 分客群胜率；口径=已加载数据，分页中如实标注 */}
            <WinLossReviewPanel
              opportunities={p.opportunities}
              customers={p.customers}
              partial={p.totalOpps === null || p.customersHasMore}
            />
          </div>
        )}
      </main>

      <CustomerFormDialog
        open={p.customerFormOpen}
        onClose={p.closeCustomerForm}
        isEdit={Boolean(p.editingCustomerId)}
        draft={p.customerDraft}
        setDraftField={p.setDraftField}
        aiFields={p.customerAiFields}
        aiMatching={p.aiMatching}
        onAiMatch={p.runAiMatch}
        extractText={p.extractText}
        setExtractText={p.setExtractText}
        extracting={p.extracting}
        onExtract={p.runExtract}
        fetchingSite={p.fetchingSite}
        onFetchSite={p.runFetchSite}
        articleUrl={p.articleUrl}
        setArticleUrl={p.setArticleUrl}
        onFetchUrl={p.runFetchUrl}
        onSave={p.saveCustomer}
        saving={p.savingCustomer}
        profileSkills={p.customerProfileSkills}
      />

      <OpportunityDialog
        open={p.oppFormOpen}
        onClose={p.closeOppForm}
        isEdit={Boolean(p.editingOppId)}
        draft={p.oppDraft}
        setOppField={p.setOppField}
        customers={p.customers}
        oppCustomerId={p.oppCustomerId}
        setOppCustomerId={p.setOppCustomerId}
        noCustomerHint={p.oppNoMatchHint}
        refOptions={p.refOptions}
        refsHasMore={p.refsHasMore}
        refsLoadingMore={p.refsLoadingMore}
        onLoadMoreRefs={() => void p.loadMoreRefs()}
        onSave={p.saveOpportunity}
        saving={p.savingOpp}
      />

      <StageChangeDialog
        stageDialog={p.stageDialog}
        stageRecordContent={p.stageRecordContent}
        setStageRecordContent={p.setStageRecordContent}
        lostReasonDraft={p.lostReasonDraft}
        setLostReasonDraft={p.setLostReasonDraft}
        onConfirm={p.confirmStageChange}
        onClose={p.closeStageDialog}
        saving={p.savingStage}
      />

      <CostConfirmDialog {...p.costConfirm} />
      <CustomerDataCheckupDialog
        open={checkupOpen}
        onOpenChange={setCheckupOpen}
        customers={p.customers}
        onLocateCustomer={(customerId) => {
          setCheckupOpen(false)
          p.selectCustomer(customerId)
        }}
      />
    </div>
  )
}

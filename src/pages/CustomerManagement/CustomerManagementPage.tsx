// UX-R2: 客户管理 已按 docs/ux-review-2026-11 修复 2026-11-07（右栏默认健康度总览 / 缺 N 项可点击补全 / 模型提示收敛小黄点 / 批量补全先确认）
import { useMemo, useState } from "react"
import { Building2, LayoutGrid, Table2, Users } from "lucide-react"
import { CustomerDataCheckupDialog } from "@/components/customer-management/CustomerDataCheckupDialog"
import { CustomerHealthPanel } from "@/components/customer-management/CustomerHealthPanel"
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
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable"
import { localDateStamp } from "@/lib/dateStamp"
import { normalizeHospitalLevel } from "./customerNormalize"
import type { CustomerRow } from "./customerTypes"
import type { useCustomerManagement } from "./useCustomerManagement"

export function CustomerManagementPage(p: ReturnType<typeof useCustomerManagement>) {
  // R216 数据体检面板
  const [checkupOpen, setCheckupOpen] = useState(false)
  // UX-R2：「缺 N 项」角标逐项去补全——打开编辑弹窗后聚焦的草稿字段 key
  const [fillFocusField, setFillFocusField] = useState<string | null>(null)
  const handleFillField = (customerId: string, fieldKey: string) => {
    p.selectCustomer(customerId)
    const customer = p.customers.find((c) => c.id === customerId) ?? null
    if (customer) p.openEditCustomer(customer)
    setFillFocusField(fieldKey)
  }

  // R236 客户「表格」视图列定义：全部取既有字段，零 schema；床位数右对齐便于扫读
  const tableColumns = useMemo<DataTableColumn<CustomerRow>[]>(
    () => [
      { key: "hospital_name", header: "医院名称", sortAccessor: (c) => c.hospital_name, render: (c) => <span className="font-medium text-foreground">{c.hospital_name}</span> },
      { key: "hospital_type", header: "类型", sortAccessor: (c) => c.hospital_type, render: (c) => c.hospital_type || "-" },
      { key: "level", header: "等级", sortAccessor: (c) => c.level, render: (c) => (c.level ? normalizeHospitalLevel(c.level) : "-") },
      { key: "region", header: "区域", sortAccessor: (c) => c.region, render: (c) => c.region || "-" },
      { key: "beds_total", header: "床位数", align: "right", sortAccessor: (c) => c.beds_total, render: (c) => (c.beds_total > 0 ? c.beds_total.toLocaleString("zh-CN") : "-") },
      { key: "last_follow_at", header: "最近跟进", sortAccessor: (c) => c.last_follow_at, render: (c) => (c.last_follow_at ? localDateStamp(new Date(c.last_follow_at)) : "未跟进") },
      { key: "updated", header: "更新于", sortAccessor: (c) => c.updated, render: (c) => (c.updated ? localDateStamp(new Date(c.updated)) : "-") },
    ],
    [],
  )

  // R236 抽出右侧详情面板，供「列表」与「表格」两种视图复用（避免重复实现）
  const detailPanel = (
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
                // UX-R2（docs/ux-review-2026-11 §二）：未选客户时右栏不再空白——健康度总览面板
                <CustomerHealthPanel
                  customers={p.customers}
                  partial={p.customersHasMore}
                  totalCount={p.totalCustomers}
                  onSelectCustomer={p.selectCustomer}
                  onNewCustomer={p.openNewCustomer}
                />
              )}
            </div>
  )


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
          <button
            type="button"
            onClick={() => p.setView("table")}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              p.view === "table"
                ? "bg-card font-medium text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Table2 className="h-4 w-4" />
            客户表格
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
              onRequestFillField={(customer, fieldKey) => handleFillField(customer.id, fieldKey)}
            />

            {detailPanel}
          </div>
        ) : p.view === "board" ? (
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
        ) : (
          <div className="grid items-start gap-4 pb-10 lg:grid-cols-[2fr_3fr]">
            <div className="min-w-0">
              <DataTable<CustomerRow>
                columns={tableColumns}
                rows={p.filteredCustomers}
                getRowId={(c) => c.id}
                selectedRowId={p.selectedCustomer?.id ?? null}
                onRowClick={(c) => p.selectCustomer(c.id)}
                initialSort={{ key: "updated", dir: "desc" }}
                pageSize={20}
                caption="客户列表表格视图"
                emptyState={
                  <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                    <Building2 className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">没有匹配的客户，试试放宽筛选条件</p>
                  </div>
                }
              />
              <p className="mt-2 px-1 text-xs text-muted-foreground">
                点击任意行查看该客户档案与商机；表头可排序
              </p>
            </div>
            {detailPanel}
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
        focusField={fillFocusField}
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

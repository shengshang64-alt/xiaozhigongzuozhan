import { Building2, Loader2, Search, Sparkles, MapPin, Target, Clock } from "lucide-react"
import { HOSPITAL_TYPES, fmtDate, type CustomerRow } from "@/pages/CustomerManagement/customerTypes"

type CustomerListPanelProps = {
  customers: CustomerRow[]
  /** D1：可精确推断的客户总数；null=末页拉满、总数未知（hook 模板 totalItems 不可信） */
  totalCount: number | null
  loadedCount: number
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  dataLoading: boolean
  searchText: string
  setSearchText: (value: string) => void
  typeFilter: string
  setTypeFilter: (value: string) => void
  regionFilter: string
  setRegionFilter: (value: string) => void
  regionOptions: string[]
  sortBy: "updated" | "name"
  setSortBy: (value: "updated" | "name") => void
  selectedCustomerId: string | null
  onSelectCustomer: (customerId: string) => void
  oppCountByCustomer: Record<string, number>
  onNewCustomer: () => void
}

export function CustomerListPanel({
  customers,
  totalCount,
  loadedCount,
  hasMore,
  loadingMore,
  onLoadMore,
  dataLoading,
  searchText,
  setSearchText,
  typeFilter,
  setTypeFilter,
  regionFilter,
  setRegionFilter,
  regionOptions,
  sortBy,
  setSortBy,
  selectedCustomerId,
  onSelectCustomer,
  oppCountByCustomer,
  onNewCustomer,
}: CustomerListPanelProps) {
  const selectClass =
    "h-9 cursor-pointer rounded-md border border-border bg-card px-2 text-xs font-medium text-card-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"

  return (
    <section className="flex h-full flex-col rounded-lg border border-border bg-card p-4 shadow-md lg:p-5">
      <header className="flex min-h-14 shrink-0 items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">客户列表</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {totalCount != null ? `共 ${totalCount} 家医院客户` : `已加载 ${loadedCount} 家医院客户`}
          </p>
        </div>
        <button
          type="button"
          onClick={onNewCustomer}
          className="rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          新建客户
        </button>
      </header>

      <div className="mt-1 flex shrink-0 flex-col gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="搜索医院名称（全量）"
            className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="按医院类型筛选"
            className={selectClass}
          >
            <option value="">全部类型</option>
            {HOSPITAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            aria-label="按地区筛选"
            className={selectClass}
          >
            <option value="">全部地区</option>
            {regionOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "updated" | "name")}
            aria-label="排序方式"
            className={selectClass}
          >
            <option value="updated">最近更新</option>
            <option value="name">按名称</option>
          </select>
        </div>
      </div>

      <div className="mt-4 flex-1 overflow-y-auto">
        {dataLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            客户加载中…
          </div>
        ) : customers.length === 0 && (searchText.trim() || typeFilter || regionFilter) ? (
          <div className="rounded-lg border border-dashed border-border px-5 py-16 text-center">
            <Search className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-foreground">没有匹配的结果</p>
            <p className="mt-1 text-xs text-muted-foreground">换个关键词，或清除筛选条件浏览全部客户</p>
            <button
              type="button"
              onClick={() => {
                setSearchText("")
                setTypeFilter("")
                setRegionFilter("")
              }}
              className="mt-4 rounded-md border border-primary/40 px-4 py-2 text-sm font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              清除筛选
            </button>
          </div>
        ) : customers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-5 py-16 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-foreground">
              输入医院名称，AI 帮你建档案
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              自动匹配医院等级、门诊量、床位与重点科室，生成档案初稿后逐项核实
            </p>
            <button
              type="button"
              onClick={onNewCustomer}
              className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              新建第一位客户
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {customers.map((customer) => {
              const active = customer.id === selectedCustomerId
              const oppCount = oppCountByCustomer[customer.id] ?? 0
              return (
                <li key={customer.id}>
                  <button
                    type="button"
                    onClick={() => onSelectCustomer(customer.id)}
                    className={
                      active
                        ? "w-full rounded-lg border-2 border-primary bg-primary/5 px-3 py-2.5 text-left shadow-md transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        : "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 shrink-0 text-primary" />
                        <p className="text-sm font-semibold text-foreground">{customer.hospital_name}</p>
                      </div>
                      {customer.level && (
                        <span className="badge-neutral shrink-0">
                          {customer.level}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {customer.hospital_type && <span>{customer.hospital_type}</span>}
                      {customer.region && (
                        <span className="inline-flex items-center gap-0.5">
                          <MapPin className="h-3 w-3" />
                          {customer.region}
                        </span>
                      )}
                      {customer.beds_total > 0 && <span>床位 {customer.beds_total}</span>}
                      {customer.outpatient_daily > 0 && <span>日门诊 {customer.outpatient_daily}</span>}
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-xs">
                      {oppCount > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                          <Target className="h-3 w-3" />
                          在跟商机 {oppCount}
                        </span>
                      ) : (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">暂无在跟商机</span>
                      )}
                      {customer.last_follow_at && (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          最近跟进 {fmtDate(customer.last_follow_at)}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {!dataLoading && customers.length > 0 && (
          <div className="mt-3 flex flex-col items-center gap-2">
            {!searchText.trim() && !typeFilter && !regionFilter && (
              <p className="text-xs text-muted-foreground">
                已加载 {customers.length} 家{totalCount != null ? ` / 共 ${totalCount} 家` : ""}
              </p>
            )}
            {hasMore && (
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {loadingMore && <Loader2 className="h-3 w-3 animate-spin" />}
                加载更多客户
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

import { Building2, Download, Eye, EyeOff, Loader2, Search, Sparkles, MapPin, Target, Wand2 } from "lucide-react"
import { useMemo, useState } from "react"
import { normalizeHospitalLevel, normalizeRegion, isTestCustomer } from "@/pages/CustomerManagement/customerNormalize"
import { computeMissingFields, HOSPITAL_TYPES, type CustomerRow } from "@/pages/CustomerManagement/customerTypes"
import { exportToCsv } from "@/lib/exportCsv"
import { localDateStamp } from "@/lib/dateStamp"

// 缺失字段 key → 中文名（供缺失徽标 title 展示；与 computeMissingFields 返回的 key 对齐）
const MISSING_FIELD_LABEL: Record<string, string> = {
  level: "等级",
  region: "地区",
  website: "官网",
  address: "地址",
  it_lead: "信息化负责人",
  outpatient_daily: "日门诊量",
  outpatient_yearly: "年门诊量",
  beds_total: "住院床位",
  annual_revenue: "年营业收入",
  key_departments: "重点科室",
  leadership: "领导班子",
}

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
  batchEnriching: boolean
  batchProgress: { done: number; total: number }
  onBatchEnrich: (limit?: number) => void
  onCancelBatchEnrich: () => void
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
  batchEnriching,
  batchProgress,
  onBatchEnrich,
  onCancelBatchEnrich,
}: CustomerListPanelProps) {
  // T7 演示模式（组件自持 state，不跨层传递）：给医院演示前一键隐藏名称含「测试」的客户；
  // localStorage 持久化让开关状态跨会话记住。过滤规则走 isTestCustomer 纯函数（有单测）。
  const DEMO_MODE_KEY = "crm_demo_mode"
  const [demoMode, setDemoModeState] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(DEMO_MODE_KEY) === "1"
    } catch {
      return false
    }
  })
  const setDemoMode = (on: boolean) => {
    setDemoModeState(on)
    try {
      window.localStorage.setItem(DEMO_MODE_KEY, on ? "1" : "0")
    } catch {
      /* localStorage 不可用时仅本次会话生效 */
    }
  }
  const visibleCustomers = useMemo(
    () => (demoMode ? customers.filter((c) => !isTestCustomer(c.hospital_name)) : customers),
    [customers, demoMode],
  )
  const demoHiddenCount = customers.length - visibleCustomers.length
  const selectClass =
    "h-9 cursor-pointer rounded-md border border-border bg-card px-2 text-xs font-medium text-card-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"

  const handleExport = () => {
    const headers = ["名称", "类型", "地区", "等级", "最近跟进", "更新时间"]
    const rows = visibleCustomers.map((c) => [c.hospital_name, c.hospital_type ?? "", c.region ?? "", c.level ?? "", c.last_follow_at ?? "", c.updated ?? ""])
    exportToCsv(`客户列表_${localDateStamp()}.csv`, headers, rows)
  }


  return (
    <section className="flex h-full flex-col rounded-lg border border-border bg-card p-4 shadow-md lg:p-5">
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">客户列表</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {batchEnriching
              ? `批量补全中 ${batchProgress.done}/${batchProgress.total}…`
              : totalCount != null
                ? `共 ${totalCount} 家医院客户`
                : `已加载 ${loadedCount} 家医院客户`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {batchEnriching ? (
            <button
              type="button"
              onClick={onCancelBatchEnrich}
              className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive shadow-sm transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              停止
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onBatchEnrich(3)}
              disabled={customers.length === 0}
              title="优先补齐缺失最多的医院：抓取官网/概况/领导班子(含二级详情)/信息公开，并百科·公示·年报多来源兜底，用 AI 补全门诊量·床位·年收入·重点科室·领导团队等空白字段（已填字段不覆盖，结果均标记「AI 提供需核实」，请逐项核对）"
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Wand2 className="h-3.5 w-3.5" />
              批量补全
            </button>
          )}
          <button
            type="button"
            onClick={handleExport}
            disabled={visibleCustomers.length === 0}
            title="导出当前列表为 CSV"
            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Download className="h-3.5 w-3.5" />
            导出
          </button>
          <button
            type="button"
            onClick={onNewCustomer}
            className="rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            新建客户
          </button>
        </div>
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
          {/* T7 演示模式开关：给医院演示前一键隐藏测试数据；隐藏数量如实可见。
              用 aria-pressed 的 toggle button（不用 role=switch）：IAB/自动化对 switch 控件的
              鼠标派发不稳定（2026-09-27 实测所有点击通道失效），toggle button 语义同样准确 */}
          <button
            type="button"
            aria-pressed={demoMode}
            onClick={() => setDemoMode(!demoMode)}
            title={demoMode ? "演示模式已开启：名称含「测试」的客户已隐藏" : "演示模式：隐藏名称含「测试」的客户（给医院演示前清场用）"}
            className={`inline-flex h-9 items-center gap-1 rounded-md border px-2.5 text-xs font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              demoMode
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border bg-card text-card-foreground hover:bg-secondary"
            }`}
          >
            {demoMode ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            演示模式
          </button>
        </div>
      </div>
      {demoMode && demoHiddenCount > 0 ? (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          <EyeOff className="h-3 w-3" />
          演示模式：已隐藏 {demoHiddenCount} 家名称含「测试」的客户
        </p>
      ) : null}

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
        ) : visibleCustomers.length === 0 ? (
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
          <ul className="flex flex-col gap-1.5">
            {visibleCustomers.map((customer) => {
              const active = customer.id === selectedCustomerId
              const oppCount = oppCountByCustomer[customer.id] ?? 0
              const missing = computeMissingFields(customer)
              const regionLabel = normalizeRegion(customer.region)
              return (
                <li key={customer.id}>
                  <button
                    type="button"
                    onClick={() => onSelectCustomer(customer.id)}
                    className={
                      active
                        ? "w-full rounded-lg border-2 border-primary bg-primary/5 px-3 py-2 text-left shadow-md transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        : "w-full rounded-lg border border-border bg-background px-3 py-2 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    }
                  >
                    {/* 第一行：医院名（截断）+ 等级徽章 */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Building2 className="h-4 w-4 shrink-0 text-primary" />
                        <p className="truncate text-sm font-semibold text-foreground" title={customer.hospital_name}>
                          {customer.hospital_name}
                        </p>
                      </div>
                      {customer.level && (
                        <span className="badge-neutral shrink-0">
                          {normalizeHospitalLevel(customer.level)}
                        </span>
                      )}
                    </div>
                    {/* 第二行：地区 · 类型（左） + 完整度徽标 + 在跟商机数（右，仅有时显示） */}
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <div className="flex min-w-0 items-center gap-x-1.5 overflow-hidden whitespace-nowrap">
                        {/* T1（2026-09-27）：展示走 normalizeRegion 归一（「安徽省合肥市」→「安徽」，
                            「部门」等脏值归一失败不显示，宁缺毋错），库内原始值不动 */}
                        {regionLabel && (
                          <span className="inline-flex min-w-0 items-center gap-0.5">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate">{regionLabel}</span>
                          </span>
                        )}
                        {regionLabel && customer.hospital_type && <span className="shrink-0 opacity-40">·</span>}
                        {customer.hospital_type && <span className="truncate">{customer.hospital_type}</span>}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {missing.length > 0 ? (
                          <span
                            className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                            title={`缺 ${missing.length} 项：${missing.map((k) => MISSING_FIELD_LABEL[k] ?? k).join("、")}`}
                          >
                            缺 {missing.length} 项
                          </span>
                        ) : (
                          <span
                            className="inline-flex shrink-0 items-center rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                            title="核心字段已齐全"
                          >
                            ✓ 完整
                          </span>
                        )}
                        {oppCount > 0 && (
                          <span
                            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary"
                            title={`在跟商机 ${oppCount} 个`}
                          >
                            <Target className="h-3 w-3" />
                            {oppCount}
                          </span>
                        )}
                      </div>
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
                已加载 {visibleCustomers.length} 家{totalCount != null ? ` / 共 ${totalCount} 家` : ""}
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

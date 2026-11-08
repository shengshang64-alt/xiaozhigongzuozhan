import { useEffect, useMemo, useRef, useState } from "react"
import * as HoverCard from "@radix-ui/react-hover-card"
import { CheckCircle2, ChevronDown, ChevronRight, Copy, Inbox, Info, LayoutGrid, Loader2, Plus, RefreshCw, SlidersHorizontal, Star, Table2 } from "lucide-react"
import { copyTextToClipboard } from "@/lib/clipboard"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CostConfirmDialog } from "@/components/rh/CostConfirmDialog"
import { PageHeader } from "@/components/shell/PageHeader"
import { IntelToolbar } from "@/components/intel-center/IntelToolbar"
import { IntelStatsRow } from "@/components/intel-center/IntelStatsRow"
import { IntelItemCard } from "@/components/intel-center/IntelItemCard"
import { IntelBrowseRow } from "@/components/intel-center/IntelBrowseRow"
import { IntelDailyBrief } from "@/components/intel-center/IntelDailyBrief"
import { IntelDetailPanel } from "@/components/intel-center/IntelDetailPanel"
import { ManualEntryDialog } from "@/components/intel-center/ManualEntryDialog"
import { CleanupIrrelevantDialog } from "@/components/intel-center/CleanupIrrelevantDialog"
import { PrefsDialog } from "@/components/intel-center/PrefsDialog"
import { SourceManagerPanel } from "@/components/intel-center/SourceManagerPanel"
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable"
import { localDateStamp } from "@/lib/dateStamp"
import { ITEM_STATUS_LABEL, SOURCE_TYPE_LABEL, type IntelItemRow, type IntelSourceType, type IntelListSortKey, type useIntelCenter } from "./useIntelCenter"
import { shouldScrollDetailIntoView } from "./detailScroll"
import { describeAutoFetch, describeWaitForNextRound } from "./intelAutoFetchCopy"

// UX-R2: 情报中心 已按 docs/ux-review-2026-11 修复 2026-11-07
// （双模式：待办（默认，仅待确认大卡 + 实心确认 + 滑出动画）/ 浏览（紧凑行 + 表格）；
//   指标卡语义化可点击；数据源说明收进 ⓘ 弹层；筛选收敛为一行 + 高级筛选抽屉；
//   操作分层：确认实心主按钮，AI 打标/忽略/标线索/原文收 ⋯ 菜单）

// 筛选行片组（与原 IntelFilterRail 同口径；rail 组件保留作回滚，不再挂载）
const TYPE_ITEMS: { key: "all" | IntelSourceType; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "policy", label: "政策" },
  { key: "bid", label: "招标中标" },
  { key: "competitor", label: "竞品" },
  { key: "media", label: "行业媒体" },
  // UX-R2（docs/ux-review-2026-11 §二十三·减法项）：AI 动态并入——原 AI 动态内容按此类型过滤
  { key: "tech", label: "行业前沿" },
]
const STATUS_ITEMS: { key: "active" | "pending" | "confirmed" | "ignored"; label: string }[] = [
  { key: "pending", label: "待确认" },
  { key: "confirmed", label: "已确认" },
  { key: "ignored", label: "已忽略" },
  { key: "active", label: "进行中" },
]
const SINCE_ITEMS: { key: "all" | "7" | "30"; label: string }[] = [
  { key: "7", label: "近 7 天" },
  { key: "30", label: "近 30 天" },
  { key: "all", label: "全部时间" },
]
function chipClass(on: boolean): string {
  return on
    ? "rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors"
    : "rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
}

export function IntelCenterPage(p: ReturnType<typeof useIntelCenter>) {
  const enabledCount = p.sources.filter((s) => s.enabled).length
  const errorCount = p.sources.filter((s) => s.last_status === "error").length
  // R3 · D4「情报关页即停」：抓取只在页面打开时进行，界面必须如实说清楚（原句「后台定时抓取
  // 为尽力而为」会让用户以为服务端在跑）。跟踪可见性，暂停/恢复时文案也要跟着变。
  const [pageVisible, setPageVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  )
  useEffect(() => {
    const onVis = () => setPageVisible(document.visibilityState === "visible")
    document.addEventListener("visibilitychange", onVis)
    return () => document.removeEventListener("visibilitychange", onVis)
  }, [])
  const autoFetchCopy = describeAutoFetch({ pageVisible })
  const waitNextRoundCopy = describeWaitForNextRound({ pageVisible })
  // intel-01 降噪：右栏低频面板默认折叠为一行，压进场屏数
  const [srcOpen, setSrcOpen] = useState(false)
  const [aiHelpOpen, setAiHelpOpen] = useState(false)

  // R237 情报「表格」视图：卡片/表格切换，表格便于横向比对与排序（复用 DataTable）
  // UX-R2：intelView 现只在浏览模式下生效（rows=紧凑行 / table=表格）；待办模式固定大卡片
  const [intelView, setIntelView] = useState<"rows" | "table">("rows")
  // UX-R2：双模式——「待办」（默认，只看待确认）与「浏览」（全部情报）
  const [viewMode, setViewMode] = useState<"todo" | "browse">("todo")
  // UX-R2：高级筛选抽屉（时间/标签/地区/来源/排序收拢）
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // UX-R2：确认/忽略后的滑出动画——条目状态已变但仍保留渲染 300ms 播退出动画
  const [exitingIds, setExitingIds] = useState<string[]>([])
  const markExiting = (id: string) => {
    setExitingIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
    window.setTimeout(() => setExitingIds((prev) => prev.filter((x) => x !== id)), 380)
  }
  // UX-R2：待办列表 = 待确认 + 正在播滑出动画的条目（避免确认瞬间消失、看不出去了哪）
  const todoItems = useMemo(
    () => p.displayItems.filter((i) => (i.my_status || "pending") === "pending" || exitingIds.includes(i.id)),
    [p.displayItems, exitingIds],
  )
  const handleTodoConfirm = (item: IntelItemRow) => {
    markExiting(item.id)
    p.confirmItem(item)
  }
  const handleTodoIgnore = (item: IntelItemRow) => {
    markExiting(item.id)
    p.ignoreItem(item)
  }
  // UX-R2：指标卡「待我确认」计数探针随页面挂载刷新一次
  useEffect(() => {
    void p.refreshPendingTotal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 2026-11-04（审计 P1）：1024–1279px 是两栏布局，详情面板被挤到整张列表下方，
  // 点卡片后详情确实渲染了但**视口毫无变化**（列表几十条卡片，详情在几屏之外），
  // 用户以为「点了没反应」。窄布局下打开详情即把详情区滚进视口。
  const detailRef = useRef<HTMLElement | null>(null)
  const hasDetail = p.detailItem != null
  useEffect(() => {
    if (!shouldScrollDetailIntoView(typeof window === "undefined" ? 0 : window.innerWidth, hasDetail)) return
    // 等详情真正挂载完再滚（同一帧里 ref 可能还是空的）
    const id = window.requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
    return () => window.cancelAnimationFrame(id)
  }, [hasDetail, p.detailItem?.id])

  const isStarred = p.isStarred
  const intelColumns = useMemo<DataTableColumn<IntelItemRow>[]>(
    () => [
      { key: "star", header: "收藏", width: "52px", align: "center", render: (r) => (isStarred(r.id) ? <Star className="mx-auto h-3.5 w-3.5 text-warning" fill="currentColor" /> : <span className="text-muted-foreground/40">—</span>) },
      { key: "title", header: "标题", sortAccessor: (r) => r.title, render: (r) => <span className="line-clamp-1 font-medium text-foreground">{r.title}</span> },
      { key: "type", header: "类型", width: "88px", sortAccessor: (r) => r.item_type, render: (r) => SOURCE_TYPE_LABEL[r.item_type] ?? "-" },
      { key: "region", header: "地区", width: "84px", sortAccessor: (r) => r.region, render: (r) => r.region || "-" },
      { key: "source", header: "来源", sortAccessor: (r) => r.source_name, render: (r) => <span className="line-clamp-1 text-muted-foreground">{r.source_name}</span> },
      { key: "status", header: "状态", width: "72px", sortAccessor: (r) => r.my_status || r.item_status, render: (r) => ITEM_STATUS_LABEL[r.my_status || r.item_status] ?? "-" },
      { key: "published", header: "发布", width: "104px", sortAccessor: (r) => r.published_at, render: (r) => (r.published_at ? localDateStamp(new Date(r.published_at)) : "-") },
    ],
    [isStarred],
  )


  return (
    <div className="animate-in fade-in duration-500 text-foreground">
      <IntelToolbar
        modelOptions={p.modelOptions}
        selectedModelKey={p.selectedModelKey}
        onSelectModel={p.handleSelectModel}
        onOpenSources={p.openSourcesPanel}
        onOpenEntry={p.openEntryDialog}
        onOpenCleanup={p.openCleanupPreview}
        onOpenPrefs={p.openPrefsDialog}
        cleanupBusy={p.cleanupBusy}
        onExport={p.exportItems}
        exportCount={p.itemList.length}
        batchMode={p.batchMode}
        batchBusy={p.batchBusy}
        onToggleBatch={p.toggleBatchMode}
        onWeeklyReport={p.generateWeeklyReport}
        reportLoading={p.reportLoading}
      />

      <main className="pb-10">
        <PageHeader
          title="情报中心"
          desc="政策动态、竞品动向、招标中标、行业媒体四类医疗信息化情报聚合，公共情报全员共享，确认/忽略/收藏每人独立"
        />

        {/* UX-R2：双模式开关（页面顶部）——处理与浏览两种心智分开 */}
        <div className="mb-4 inline-flex items-center gap-1 rounded-full bg-muted p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("todo")}
            aria-pressed={viewMode === "todo"}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              viewMode === "todo" ? "bg-card font-medium text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CheckCircle2 className="h-4 w-4" />
            待办模式
            {p.pendingTotal > 0 ? (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${viewMode === "todo" ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>
                {p.pendingTotal}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setViewMode("browse")}
            aria-pressed={viewMode === "browse"}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              viewMode === "browse" ? "bg-card font-medium text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
            浏览模式
          </button>
        </div>

        <IntelStatsRow
          enabledCount={enabledCount}
          sourceCount={p.sources.length}
          errorCount={errorCount}
          totalItems={p.totalItems}
          pendingTotal={p.pendingTotal}
          starredCount={p.starredIds.length}
          onOpenTodo={() => {
            setViewMode("todo")
            p.handleStatusTab("pending")
          }}
          onOpenBrowse={() => setViewMode("browse")}
          onOpenSources={p.openSourcesPanel}
        />

        {/* UX-R2：数据源与抓取说明收进 ⓘ 弹层（原整段说明条不再占据首屏） */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <HoverCard.Root>
            <HoverCard.Trigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Info className="h-3.5 w-3.5 text-primary" />
                数据源与抓取说明
              </button>
            </HoverCard.Trigger>
            <HoverCard.Portal>
              <HoverCard.Content side="bottom" align="start" sideOffset={6} className="z-50 w-[26rem] rounded-lg border border-border bg-card p-4 shadow-lg animate-in fade-in zoom-in-95 duration-200">
                <p className="text-xs leading-relaxed text-foreground">
                  <RefreshCw className="mr-1 inline h-3.5 w-3.5 text-primary" />
                  {autoFetchCopy}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{waitNextRoundCopy}</p>
                <p className="mt-2 text-xs text-muted-foreground">情报来源为公开网站，仅供售前参考；抓取失败的源请结合手动录入使用。</p>
              </HoverCard.Content>
            </HoverCard.Portal>
          </HoverCard.Root>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            启用源 {enabledCount}/{p.sources.length}
          </span>
          {errorCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setSrcOpen(true)
                document.getElementById("intel-src-status")?.scrollIntoView({ behavior: "smooth", block: "center" })
                p.openSourcesPanel()
              }}
              title="点击打开信息源管理，查看失败的源并重试"
              className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {errorCount} 个源抓取失败 · 点击处理
            </button>
          )}
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            当前筛选 {p.totalItems} 条
          </span>
        </div>

        {/* UX-R2：筛选收敛——一行主筛选（类型 / 状态 / 搜索）+「高级筛选」抽屉（时间 / 标签 / 地区 / 来源 / 排序）；
            原左筛选栏（IntelFilterRail）与中部筛选行（IntelFilterBar）合并于此，两套并存的问题消除 */}
        <section className="mb-4 rounded-lg border border-border bg-card p-3 shadow-md">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-muted-foreground">类型</span>
            {TYPE_ITEMS.map((it) => (
              <button key={it.key} type="button" onClick={() => p.handleTypeTab(it.key)} className={chipClass(p.typeTab === it.key)}>
                {it.label}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <span className="text-[11px] font-semibold text-muted-foreground">状态</span>
            {STATUS_ITEMS.map((it) => (
              <button
                key={it.key}
                type="button"
                onClick={() => p.handleStatusTab(it.key)}
                className={chipClass(p.statusTab === it.key)}
                title="按你自己的确认状态筛选，不影响其他成员"
              >
                {it.label}
              </button>
            ))}
            <div className="relative ml-auto min-w-52 flex-1 sm:max-w-xs">
              <input
                value={p.searchInput}
                onChange={(ev) => p.setSearchInput(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") p.submitSearch()
                }}
                placeholder="搜索标题、摘要或正文…"
                aria-label="搜索情报"
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-expanded={advancedOpen}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                advancedOpen || p.sinceRange !== "all" || p.activeTag || p.regionFilter !== "all" || p.sourceFilter !== "all"
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-card text-card-foreground hover:bg-secondary"
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              高级筛选
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
            </button>
          </div>
          {advancedOpen ? (
            <div className="mt-3 grid gap-3 border-t border-border pt-3 lg:grid-cols-[auto_auto_1fr]">
              <div>
                <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">时间范围</p>
                <div className="flex flex-wrap gap-1.5">
                  {SINCE_ITEMS.map((it) => (
                    <button key={it.key} type="button" onClick={() => p.handleSinceChange(it.key)} className={chipClass(p.sinceRange === it.key)}>
                      {it.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">标签</p>
                <div className="flex max-w-md flex-wrap gap-1.5">
                  {p.allTags.length === 0 ? (
                    <span className="text-xs text-muted-foreground">暂无标签（AI 打标后出现）</span>
                  ) : (
                    p.allTags.slice(0, 16).map((tag) => (
                      <button key={tag} type="button" onClick={() => p.handleTagClick(tag)} className={chipClass(p.activeTag === tag)}>
                        {tag}
                      </button>
                    ))
                  )}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <select
                  value={p.regionFilter}
                  onChange={(ev) => p.handleRegionFilter(ev.target.value)}
                  title="按情报涉及的区域筛选"
                  aria-label="按地区筛选"
                  className="h-9 self-end rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {p.regionOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  value={p.sourceFilter}
                  onChange={(ev) => p.handleSourceFilter(ev.target.value)}
                  title="按信息源筛选"
                  aria-label="按信息源筛选"
                  className="h-9 max-w-52 self-end rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {p.sourceOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2 self-end">
                  <select
                    value={p.listSortKey}
                    onChange={(ev) => p.setListSortKey(ev.target.value as IntelListSortKey)}
                    title="列表排序口径（关注项始终置顶）"
                    aria-label="列表排序"
                    className="h-9 max-w-36 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <option value="published">按发布时刻</option>
                    <option value="added">按加入时刻</option>
                    <option value="title">按标题</option>
                  </select>
                  <button
                    type="button"
                    onClick={p.clearFilters}
                    className="h-9 rounded-md border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    清空
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        {/* UX-R2：双栏布局（原左筛选栏并入上方筛选行） */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0 space-y-4">
            <IntelDailyBrief
              work={p.dailyWork}
              onOpenDetail={p.openDetail}
              onConfirm={p.confirmItem}
              onIgnore={p.ignoreItem}
            />

            {/* UX-R2：循环 12 存量不相关情报引导横幅（原位保留） */}
            {p.cleanupSuggested && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 animate-in fade-in duration-300">
                <span className="min-w-0 flex-1 text-xs leading-relaxed text-card-foreground">
                  检测到 {p.cleanupInfo?.count ?? 0} 条与医疗软件信息化行业无关的存量采集内容（机械加工、航空、遥感等跨行业条目）；清理只删采集条目，手动录入不受影响，新采集已按行业口径自动过滤
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void p.openCleanupPreview()}
                    className="rounded-md border border-warning/50 bg-card px-2.5 py-1 text-xs font-medium text-warning shadow-sm transition-colors hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning"
                  >
                    查看并清理
                  </button>
                  <button
                    type="button"
                    onClick={p.dismissCleanupSuggested}
                    className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    暂不处理
                  </button>
                </span>
              </div>
            )}

            {/* 循环 10 小改 2：批量操作条（批量态显示） */}
            {p.batchMode && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 animate-in fade-in duration-300">
                <span className="text-xs font-medium text-primary">已选 {p.batchSelectedIds.length} 条</span>
                <button
                  type="button"
                  disabled={p.batchBusy || p.batchSelectedIds.length === 0}
                  onClick={() => void p.batchSetStatus("confirmed")}
                  className="rounded-md border border-primary/40 bg-card px-2.5 py-1 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  批量确认
                </button>
                <button
                  type="button"
                  disabled={p.batchBusy || p.batchSelectedIds.length === 0}
                  onClick={() => void p.batchSetStatus("ignored")}
                  className="rounded-md border border-border bg-card px-2.5 py-1 text-xs text-card-foreground shadow-sm transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  批量忽略
                </button>
                <button
                  type="button"
                  disabled={p.batchBusy || p.batchSelectedIds.length === 0}
                  onClick={() => void p.batchToggleStar()}
                  className="rounded-md border border-border bg-card px-2.5 py-1 text-xs text-card-foreground shadow-sm transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  批量收藏 / 取消
                </button>
                <button
                  type="button"
                  disabled={p.batchBusy || p.batchSelectedIds.length === 0}
                  onClick={p.aiTagBatch}
                  title="对选中情报调用 AI 生成摘要与标签（会计费）"
                  className="rounded-md border border-primary/40 bg-card px-2.5 py-1 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  批量 AI 增强
                </button>
                <button
                  type="button"
                  disabled={p.batchBusy}
                  onClick={p.clearBatchSelect}
                  className="ml-auto rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-card-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  取消选择
                </button>
              </div>
            )}

            {viewMode === "todo" ? (
              /* UX-R2：待办模式——只看待确认，大卡片 + 实心确认按钮 + 滑出动画 */
              todoItems.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card py-14 text-center shadow-md">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                  <p className="text-sm font-medium text-foreground">待办清空了，一条待确认的情报都没有</p>
                  <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                    新情报抓取入库后会出现在这里；想浏览已确认/已忽略的历史情报，切到「浏览模式」
                  </p>
                  <Button type="button" size="sm" variant="outline" onClick={() => setViewMode("browse")}>
                    切到浏览模式
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                  {todoItems.map((item) => (
                    <IntelItemCard
                      key={item.id}
                      item={item}
                      starred={p.isStarred(item.id)}
                      aiTagging={p.aiTagging(item.id)}
                      focused={p.isItemFocused(item)}
                      lead={p.isLead(item.id)}
                      onToggleLead={p.toggleLead}
                      onOpenDetail={p.openDetail}
                      onConfirm={handleTodoConfirm}
                      onIgnore={handleTodoIgnore}
                      onAiTag={p.aiTagItem}
                      onToggleStar={p.toggleStar}
                      batchMode={p.batchMode}
                      selected={p.batchSelectedIds.includes(item.id)}
                      onToggleSelect={p.toggleBatchSelect}
                      todoMode
                      exiting={exitingIds.includes(item.id)}
                    />
                  ))}
                </div>
              )
            ) : (
              <>
                {/* UX-R2：浏览模式——紧凑行式列表（约 64px/行），保留表格视图切换 */}
                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => setIntelView("rows")}
                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      intelView === "rows"
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    紧凑行
                  </button>
                  <button
                    type="button"
                    onClick={() => setIntelView("table")}
                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      intelView === "table"
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Table2 className="h-3.5 w-3.5" />
                    表格
                  </button>
                </div>

                {p.batchMode ? (
                  <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    批量勾选在「待办模式」的大卡片上进行（每张卡片左上角有勾选框）——当前处于浏览模式，只做浏览与查看
                  </p>
                ) : null}

                {p.itemsLoading && p.displayItems.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card py-16 text-sm text-muted-foreground shadow-md">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    正在加载情报…
                  </div>
                ) : p.displayItems.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card py-16 text-center shadow-md">
                    <Inbox className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">当前筛选条件下暂无情报</p>
                    <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                      {waitNextRoundCopy}也可以到信息源管理里添加更对口的信息源，或手动录入你掌握的情报。
                    </p>
                    <div className="mt-1 flex gap-2">
                      <button
                        type="button"
                        onClick={p.openSourcesPanel}
                        className="rounded-md border border-border px-3.5 py-2 text-sm text-card-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        管理信息源
                      </button>
                      <button
                        type="button"
                        onClick={p.openEntryDialog}
                        className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <Plus className="h-4 w-4" />
                        手动录入
                      </button>
                    </div>
                  </div>
                ) : intelView === "table" ? (
                  <DataTable<IntelItemRow>
                    columns={intelColumns}
                    rows={p.displayItems}
                    getRowId={(r) => r.id}
                    onRowClick={p.openDetail}
                    selectedRowId={p.detailItem?.id ?? null}
                    initialSort={{ key: "published", dir: "desc" }}
                    caption="情报列表表格视图"
                  />
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border bg-card shadow-md">
                    {p.displayItems.map((item) => (
                      <IntelBrowseRow
                        key={item.id}
                        item={item}
                        starred={p.isStarred(item.id)}
                        focused={p.isItemFocused(item)}
                        onOpenDetail={p.openDetail}
                        onToggleStar={p.toggleStar}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {p.hasMore && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={p.loadMore}
                  disabled={p.itemsLoading}
                  className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {p.itemsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  加载更多情报
                </button>
              </div>
            )}
          </section>

          <aside ref={detailRef} className="scroll-mt-24 space-y-4">
            <div className="lg:sticky lg:top-[7.5rem] lg:max-h-[calc(100vh-9rem)]">
              <IntelDetailPanel
                item={p.detailItem}
                starred={p.detailItem ? p.isStarred(p.detailItem.id) : false}
                aiTagging={p.detailItem ? p.aiTagging(p.detailItem.id) : false}
                lead={p.detailItem ? p.isLead(p.detailItem.id) : false}
                onClose={p.closeDetail}
                onConfirm={p.confirmItem}
                onIgnore={p.ignoreItem}
                onAiTag={p.aiTagItem}
                onToggleStar={p.toggleStar}
                onToggleLead={p.toggleLead}
                onCreateBidTask={p.createBidTask}
                onConvertToOpp={p.convertToOpportunity}
                onSaveStructured={p.saveStructured}
              />
            </div>

            <div className="rounded-lg border border-border bg-card p-4 shadow-md">
              <button
                type="button"
                id="intel-src-status"
                aria-expanded={srcOpen}
                onClick={() => setSrcOpen((v) => !v)}
                className="flex w-full items-center gap-1.5 text-left"
              >
                {srcOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <h2 className="text-sm font-semibold text-foreground">信息源状态</h2>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {p.sources.length} 个{errorCount > 0 ? `·${errorCount} 异常` : ""}
                </span>
              </button>
              {srcOpen && (
                <>
                  <p className="mt-2 text-xs text-muted-foreground">内置 {p.sources.filter((s) => s.is_builtin).length} 个 · 自定义 {p.sources.filter((s) => !s.is_builtin).length} 个</p>
                  <ul className="mt-3 space-y-2">
                    {p.sources.slice(0, 6).map((source) => (
                      <li key={source.id} className="flex items-center gap-2 text-xs">
                        <span
                          className={
                            source.last_status === "error"
                              ? "h-2 w-2 shrink-0 rounded-full bg-destructive"
                              : source.enabled
                                ? "h-2 w-2 shrink-0 rounded-full bg-primary"
                                : "h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40"
                          }
                        />
                        <span className="truncate text-foreground">{source.source_name}</span>
                        <span className="ml-auto shrink-0 text-muted-foreground">
                          {SOURCE_TYPE_LABEL[source.source_type] ?? ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={p.openSourcesPanel}
                    className="mt-3.5 w-full rounded-md border border-border px-3 py-2 text-sm text-card-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    查看全部并管理
                  </button>
                </>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4 shadow-md">
              <h2 className="text-sm font-semibold text-foreground">我的收藏</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                已收藏 {p.starredIds.length} 条情报。在情报卡片上点星标即可收藏。
              </p>
            </div>

            <div className="rounded-lg border border-dashed border-border bg-card p-4 shadow-md">
              <button
                type="button"
                aria-expanded={aiHelpOpen}
                onClick={() => setAiHelpOpen((v) => !v)}
                className="flex w-full items-center gap-1.5 text-left"
              >
                {aiHelpOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <h2 className="text-sm font-semibold text-foreground">AI 摘要打标</h2>
              </button>
              {aiHelpOpen && (
                <>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    对感兴趣的条目点「AI 摘要打标」，AI 会生成不超过 120 字的售前视角摘要，并自动判定情报类型、地区与标签。
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    当前模型来源：{p.modelOptions.length > 0 ? "可在页内工具栏切换" : "平台默认模型"}
                  </p>
                </>
              )}
            </div>

            <p className="px-1 text-xs leading-relaxed text-muted-foreground">
              情报来源为公开网站，仅供售前参考；抓取失败的源请结合手动录入使用
            </p>
          </aside>
        </div>
      </main>

      {/* 重构轮：AI 情报周报弹窗 */}
      <Dialog open={p.reportOpen} onOpenChange={(open) => { if (!open) p.closeReport() }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-3.5">
            <DialogTitle className="flex items-center gap-2 text-base">
              AI 情报周报
              {p.reportLoading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            </DialogTitle>
            <DialogDescription className="text-xs">基于近 7 天高分待办、临期与已确认情报由 AI 汇总生成，发布前请人工核对</DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto px-5 py-4">
            {p.reportLoading && !p.reportText ? (
              <div className="space-y-2.5">
                {[86, 64, 92, 70, 58].map((w, i) => (
                  <div key={i} className="h-3.5 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />
                ))}
                <p className="pt-2 text-xs text-muted-foreground">正在汇总近 7 天情报并生成周报…</p>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">{p.reportText}</pre>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!p.reportText || p.reportLoading}
              onClick={() => {
                void copyTextToClipboard(p.reportText, {
                  successMessage: "周报已复制到剪贴板",
                  errorMessage: "复制失败，请手动选择文本",
                })
              }}
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              复制周报
            </Button>
            <Button type="button" size="sm" disabled={p.reportLoading} onClick={p.generateWeeklyReport}>
              {p.reportLoading ? "生成中…" : "重新生成"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ManualEntryDialog
        open={p.entryDialogOpen}
        title={p.entryTitle}
        onTitle={p.setEntryTitle}
        url={p.entryUrl}
        onUrl={p.setEntryUrl}
        snippet={p.entrySnippet}
        onSnippet={p.setEntrySnippet}
        itemType={p.entryType}
        onItemType={p.setEntryType}
        region={p.entryRegion}
        onRegion={p.setEntryRegion}
        saving={p.entrySaving}
        onSubmit={p.submitEntry}
        onClose={p.closeEntryDialog}
        isPublic={p.entryIsPublic}
        onIsPublic={p.setEntryIsPublic}
        fetchingUrl={p.entryFetchingUrl}
        onFetchUrl={p.fetchEntryUrl}
      />

      <CleanupIrrelevantDialog
        open={p.cleanupOpen}
        busy={p.cleanupBusy}
        info={p.cleanupInfo}
        onClose={p.closeCleanup}
        onConfirm={p.confirmCleanup}
      />

      <SourceManagerPanel
        open={p.sourcesPanelOpen}
        sources={p.sources}
        sourcesLoading={p.sourcesLoading}
        fetchingSourceId={p.fetchingSourceId}
        newName={p.newSourceName}
        onNewName={p.setNewSourceName}
        newUrl={p.newSourceUrl}
        onNewUrl={p.setNewSourceUrl}
        newType={p.newSourceType}
        onNewType={p.setNewSourceType}
        adding={p.addingSource}
        onAdd={p.addSource}
        onToggle={p.toggleSource}
        onDelete={p.deleteSource}
        onFetchNow={p.fetchSourceNow}
        retryingFailed={p.retryingFailed}
        onRetryFailed={p.retryFailedSources}
        enriching={p.enriching}
        enrichPhase={p.enrichPhase}
        onRunEnrich={p.runIntelEnrich}
        onClose={p.closeSourcesPanel}
      />

      <PrefsDialog
        open={p.prefsDialogOpen}
        prefs={p.prefs}
        sourceNames={p.prefsSourceNames}
        saving={p.prefsSaving}
        onClose={p.closePrefsDialog}
        onSave={p.savePrefs}
      />

      <CostConfirmDialog {...p.costConfirm} />
    </div>
  )
}

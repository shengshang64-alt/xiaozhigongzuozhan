import { useEffect, useState } from "react"
import { Loader2, MessageCircle, Plus, RefreshCw, Trash2, Wrench, X } from "lucide-react"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import {
  fmtIntelTime,
  SOURCE_TYPE_LABEL,
  type IntelSourceRow,
  type IntelSourceType,
} from "@/pages/IntelCenter/useIntelCenter"

type SourceManagerPanelProps = {
  open: boolean
  sources: IntelSourceRow[]
  sourcesLoading: boolean
  fetchingSourceId: string
  newName: string
  onNewName: (v: string) => void
  newUrl: string
  onNewUrl: (v: string) => void
  newType: IntelSourceType
  onNewType: (v: IntelSourceType) => void
  adding: boolean
  onAdd: () => void
  onToggle: (source: IntelSourceRow) => void
  onDelete: (source: IntelSourceRow) => void
  onFetchNow: (source: IntelSourceRow) => void
  /** T3 一键重试全部失败源：重试进行中（行级 spinner 复用 fetchingSourceId） */
  retryingFailed: boolean
  onRetryFailed: () => void
  /** T8 存量数据修复（enrich 回填）：运行标志 + 阶段文案 */
  enriching: boolean
  enrichPhase: string
  onRunEnrich: () => void
  onClose: () => void
}

// T3：把 Go 底层网络错误翻成售前看得懂的结论；原始明细保留在 title 悬浮里便于排查
function humanizeSourceError(raw: string): string {
  const s = raw || ""
  if (/dial tcp: lookup/i.test(s)) return "域名解析失败（站点可能已改名或停用）"
  if (/connection refused/i.test(s)) return "对方拒绝连接（服务器在线但未开放访问）"
  if (/dial tcp/i.test(s)) return "连不上对方服务器（可能宕机或本机网络限制）"
  if (/HTTP (403|412)/.test(s)) return "对方拒绝机器抓取（反爬验证，人工浏览器访问正常）"
  if (/HTTP 404/.test(s)) return "页面地址失效（对方网站可能已改版）"
  if (/HTTP 5\d\d/.test(s)) return "对方服务器故障（通常是暂时的，可稍后重试）"
  if (/tls|x509/i.test(s)) return "对方证书异常（加密连接失败）"
  return s || "未知原因"
}

function statusHint(source: IntelSourceRow): { text: string; detail: string; className: string } {
  if (source.last_status === "ok") {
    return {
      text: source.fetched_count > 0
        ? `抓取成功 · 累计 ${source.fetched_count} 条`
        : "抓取成功 · 暂无新的相关条目",
      detail: "",
      className: "text-primary",
    }
  }
  if (source.last_status === "error") {
    return {
      text: `抓取失败：${humanizeSourceError(source.last_error)}`,
      detail: source.last_error || "",
      className: "text-destructive",
    }
  }
  return { text: "尚未抓取，等待下一轮自动抓取", detail: "", className: "text-muted-foreground" }
}

type SourceRowProps = {
  source: IntelSourceRow
  fetchingSourceId: string
  onToggle: (source: IntelSourceRow) => void
  onRequestDelete: (source: IntelSourceRow) => void
  onFetchNow: (source: IntelSourceRow) => void
}

function SourceRow({ source, fetchingSourceId, onToggle, onRequestDelete, onFetchNow, weekAdded }: SourceRowProps & { weekAdded?: number }) {
  const hint = statusHint(source)
  return (
    <li className="rounded-lg border border-border bg-background p-3.5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-foreground">{source.source_name}</p>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {SOURCE_TYPE_LABEL[source.source_type] ?? source.source_type}
        </span>
        {!source.enabled && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">已停用</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onFetchNow(source)}
            disabled={!source.enabled || fetchingSourceId === source.id}
            title={source.enabled ? "立即抓取" : "启用后可抓取"}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-card-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {fetchingSourceId === source.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 text-primary" />
            )}
            立即抓取
          </button>
          <button
            type="button"
            onClick={() => onToggle(source)}
            className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {source.enabled ? "停用" : "启用"}
          </button>
          {!source.is_builtin && (
            <button
              type="button"
              onClick={() => onRequestDelete(source)}
              title="删除信息源"
              className="rounded-md border border-destructive/40 p-1.5 text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="truncate text-muted-foreground underline-offset-2 transition-colors hover:text-primary hover:underline"
        >
          {source.url}
        </a>
        {source.last_fetch_at && (
          <span className="text-muted-foreground">
            {source.last_status === "error" ? "最近尝试" : "上次成功"} {fmtIntelTime(source.last_fetch_at)}
          </span>
        )}
      </div>
      <p className={`mt-1 truncate text-xs ${hint.className}`} title={hint.detail || undefined}>
        {hint.text}
        {typeof weekAdded === "number" && weekAdded >= 0 ? (
          <span className="ml-1.5 font-normal text-muted-foreground">· 近 7 天新增 {weekAdded} 条</span>
        ) : null}
      </p>
    </li>
  )
}

export function SourceManagerPanel({
  open,
  sources,
  sourcesLoading,
  fetchingSourceId,
  newName,
  onNewName,
  newUrl,
  onNewUrl,
  newType,
  onNewType,
  adding,
  onAdd,
  onToggle,
  onDelete,
  onFetchNow,
  retryingFailed,
  onRetryFailed,
  enriching,
  enrichPhase,
  onRunEnrich,
  onClose,
}: SourceManagerPanelProps) {
  // 删除信息源走模态确认；Escape 关闭面板（确认框打开时让位给确认框）
  const [pendingDelete, setPendingDelete] = useState<IntelSourceRow | null>(null)
  useEffect(() => {
    if (!open || pendingDelete) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, pendingDelete, onClose])
  // 源贡献度统计（2026-09-28）：近 7 天新增按源聚合，识别贡献源与僵尸源（抓成功但 0 新增）
  // R216 缺陷修复：本 Hook 原先排在 `if (!open) return null` 之后，属条件性 Hook 调用——
  //   面板关闭时 React 少注册一个 Hook，再次打开时 Hook 顺序变化，会抛
  //   "Rendered fewer hooks than expected" 并导致整页白屏（情报源管理是最高频入口）。
  //   修法：所有 Hook 一律提到 early-return 之前，用 open 作为 effect 内部守卫而非跳过调用。
  const [weekStats, setWeekStats] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    if (!open || weekStats) return
    fetch("/api/intel/source-stats", { headers: { "Content-Type": "application/json", ...vibexAuthHeaders() } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status))))
      .then((data: { stats?: Array<{ source_id: string; week_added: number }> }) => {
        const map: Record<string, number> = {}
        for (const st of data.stats ?? []) map[st.source_id] = st.week_added
        setWeekStats(map)
      })
      .catch(() => setWeekStats({}))
  }, [open, weekStats])
  // Hook 全部调用完毕后才允许 early-return（React Hooks 规则：Hook 不得出现在条件分支中）
  if (!open) return null
  // T3 健康概览：失败源置顶展示，问题源不用在 40 行里逐条找
  const failedOf = (list: IntelSourceRow[]) => list.filter((s) => s.enabled && s.last_status === "error")
  const errorCount = failedOf(sources).length
  const enabledTotal = sources.filter((s) => s.enabled).length
  const healthFirst = (a: IntelSourceRow, b: IntelSourceRow) =>
    Number(b.enabled && b.last_status === "error") - Number(a.enabled && a.last_status === "error")
  const builtinSources = sources.filter((s) => s.is_builtin).sort(healthFirst)
  const mySources = sources.filter((s) => !s.is_builtin).sort(healthFirst)
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">
        <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-foreground">信息源管理</h2>
          <p className={`text-xs ${errorCount > 0 ? "text-destructive" : "text-muted-foreground"}`}>
            {errorCount > 0
              ? `启用源 ${enabledTotal} 个，其中 ${errorCount} 个抓取失败`
              : "每 30 分钟自动抓取一轮到期的启用源，也可手动立即抓取"}
          </p>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={onRunEnrich}
              disabled={enriching}
              title="对缺描述/区域未知的条目重新抓取正文并生成摘要、标签、区域（零 AI 费用，最长约 1 分钟）"
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-card-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {enriching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
              {enriching ? enrichPhase || "修复中…" : "修复数据"}
            </button>
            {errorCount > 0 ? (
              <button
                type="button"
                onClick={onRetryFailed}
                disabled={retryingFailed}
                title={`把 ${errorCount} 个失败源逐个重抓一遍（每个最多等待 15 秒）`}
                className="flex items-center gap-1 rounded-md border border-primary/40 px-2.5 py-1.5 text-xs text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {retryingFailed ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {retryingFailed ? "重试中…" : `重试失败源（${errorCount}）`}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              title="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {sourcesLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              正在加载信息源…
            </div>
          ) : (
            <>
              <section>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">公共源（内置）</h3>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {builtinSources.length} 个 · 全员共享
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  覆盖卫健委、医保局、政府采购网、主流医疗信息化厂商与行业媒体；抓取结果全员可见，只能启停、不可删除
                </p>
                {builtinSources.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">内置源加载中…</p>
                ) : (
                  <ul className="mt-2.5 space-y-2.5">
                    {builtinSources.map((source) => (
                      <SourceRow
                        key={source.id}
                        source={source}
                        fetchingSourceId={fetchingSourceId}
                        onToggle={onToggle}
                        onRequestDelete={setPendingDelete}
                        onFetchNow={onFetchNow}
                      weekAdded={weekStats?.[source.id]}
                      />
                    ))}
                  </ul>
                )}
              </section>

              <section className="mt-5">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">我的源（个人）</h3>
                  <span className="rounded-full border border-dashed border-primary/40 px-2 py-0.5 text-xs text-primary">
                    {mySources.length} 个 · 仅自己可见
                  </span>
                </div>
                <div className="mt-2.5 rounded-lg border border-dashed border-border bg-background p-3.5">
                  <p className="text-xs font-semibold text-foreground">添加自定义信息源</p>
                  <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
                    <input
                      value={newName}
                      onChange={(ev) => onNewName(ev.target.value)}
                      placeholder="名称，例如：某省卫健委"
                      maxLength={100}
                      className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    />
                    <input
                      value={newUrl}
                      onChange={(ev) => onNewUrl(ev.target.value)}
                      placeholder="列表页网址 https://…"
                      maxLength={500}
                      className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    />
                    <div className="flex gap-2">
                      <select
                        value={newType}
                        onChange={(ev) => onNewType(ev.target.value as IntelSourceType)}
                        className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <option value="policy">政策动态</option>
                        <option value="competitor">竞品动向</option>
                        <option value="bid">招标中标</option>
                        <option value="media">行业媒体</option>
                      </select>
                      <button
                        type="button"
                        onClick={onAdd}
                        disabled={adding}
                        className="flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <Plus className="h-4 w-4" />
                        {adding ? "添加中" : "添加"}
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">我的源抓取结果只进你自己的情报流，不影响其他成员</p>
                </div>
                {mySources.length > 0 && (
                  <ul className="mt-2.5 space-y-2.5">
                    {mySources.map((source) => (
                      <SourceRow
                        key={source.id}
                        source={source}
                        fetchingSourceId={fetchingSourceId}
                        onToggle={onToggle}
                        onRequestDelete={setPendingDelete}
                        onFetchNow={onFetchNow}
                      weekAdded={weekStats?.[source.id]}
                      />
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>

        <footer className="shrink-0 space-y-1.5 border-t border-border px-4 py-3">
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
            <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            微信公众号列表页无法直接订阅；可在手动录入中粘贴公众号文章链接同步单篇
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            部分网站可能限制抓取，失败原因会如实显示；只入库医疗信息化相关内容，抓不到的情报可以手动录入
          </p>
        </footer>
      </div>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null)
        }}
        title="删除信息源"
        description={pendingDelete ? `确定删除「${pendingDelete.source_name}」吗？删除后将不再抓取该来源。` : ""}
        confirmText="删除"
        tone="danger"
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete)
          setPendingDelete(null)
        }}
      />
    </div>
  )
}

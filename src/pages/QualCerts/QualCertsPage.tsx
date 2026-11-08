// 资质证书台账页：危险度分档统计卡（点击过滤）+ 三档预警条（逐条定位高亮）+ DataTable（⋯菜单 / 批量操作）
// 设计依据 docs/06 §一.1 与 docs/未来功能规划路线图.md（证书过期直接废标 → 提前预警）
// UX-R2: 资质台账 已按 docs/ux-review-2026-11 修复 2026-11-07（统计卡危险度重排与点击过滤 / 预警逐条定位高亮 /
//        行操作收敛 ⋯ 菜单 / 复选框批量选择 + 浮动操作条 + 批量登记有效期弹窗）
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  AlertTriangle,
  CalendarClock,
  CheckCheck,
  Download,
  FileSearch,
  Loader2,
  Locate,
  MoreHorizontal,
  Pencil,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable"
import type { UseQualCerts } from "./useQualCerts"
import {
  QUAL_CATEGORIES,
  filterQualRows,
  isAutoDerivedValidity,
  qualBucket,
  qualDueLabel,
  type QualBucket,
  type QualCertRow,
} from "./qualsCore"
import { exportToCsv } from "@/lib/exportCsv"
import { localDateStamp } from "@/lib/dateStamp"

const BUCKET_LABEL: Record<QualBucket, string> = {
  expired: "已过期",
  critical: "30 天内到期",
  warning: "90 天内到期",
  ok: "状态正常",
  unknown: "未登记有效期",
}
const BUCKET_CLASS: Record<QualBucket, string> = {
  expired: "badge-danger",
  critical: "badge-warning",
  warning: "badge-warning",
  ok: "badge-success",
  unknown: "badge-neutral",
}
// 三档预警条之外的桶（ok / unknown）只用于计数展示

// UX-R2：统计卡按危险度排序（红→橙→黄→灰→灰），值与 qualBucket 分档一一对应
type StatCardBucket = Extract<QualBucket, "expired" | "critical" | "warning" | "unknown"> | "total"
const STAT_CARD_ORDER: StatCardBucket[] = ["expired", "critical", "unknown", "warning", "total"]
const STAT_CARD_TONE: Record<StatCardBucket, { wrap: string; icon: string; value: string }> = {
  expired: { wrap: "border-destructive/40 bg-destructive/5", icon: "text-destructive", value: "text-destructive" },
  critical: { wrap: "border-amber-400/50 bg-amber-500/5", icon: "text-amber-500", value: "text-amber-600" },
  unknown: { wrap: "border-yellow-400/60 bg-yellow-500/5", icon: "text-yellow-500", value: "text-yellow-600" },
  warning: { wrap: "border-border bg-card", icon: "text-muted-foreground", value: "text-foreground" },
  total: { wrap: "border-border bg-card", icon: "text-muted-foreground", value: "text-foreground" },
}

/** 与 qualsCore 分档口径一致：已过期 danger、≤90 天 warning、正常 success、未登记 neutral */
function qualDueBadge(row: Pick<QualCertRow, "valid_to">, todayMs: number): { due: string; cls: string } {
  const due = qualDueLabel(row.valid_to, todayMs)
  const isExpired = due.startsWith("已过期")
  const daysMatch = /^剩 (\d+) 天$/.exec(due)
  const isSoon = due === "今天到期" || (daysMatch != null && parseInt(daysMatch[1], 10) <= 90)
  const cls = !row.valid_to ? "badge-neutral" : isExpired ? "badge-danger" : isSoon ? "badge-warning" : "badge-success"
  return { due, cls }
}

function exportCsvOf(rows: QualCertRow[], filename: string) {
  const headers = ["证照名称", "类别", "证书编号", "发证机关", "有效期开始", "有效期截止", "适用范围", "更新时间"]
  const body = rows.map((r) => [r.cert_name, r.category, r.cert_no, r.issuer, r.valid_from, r.valid_to, r.scope, r.updated])
  exportToCsv(filename, headers, body)
}

function handleExport(p: UseQualCerts) {
  exportCsvOf(p.rows, `资质台账_${localDateStamp()}.csv`)
}

export function QualCertsPage({ p }: { p: UseQualCerts }) {
  const { summary } = p
  // R250(r2-r012 收尾)：台账改为复用全站 DataTable——点表头三态排序、超 20 条分页、
  // 顶部按展示字段搜索。默认按「有效期至」升序，最急的证照排最前（原为服务端返回序）。
  const [keyword, setKeyword] = useState("")
  // UX-R2：统计卡点击过滤（再点一次或点「台账总数」清除）
  const [bucketFilter, setBucketFilter] = useState<QualBucket | null>(null)
  // UX-R2：预警条「定位」——滚动到行并 animate-pulse 高亮 2 秒
  const [highlightId, setHighlightId] = useState<string | null>(null)
  // UX-R2：批量选择（跨过滤条件保留；有效选中集 = 勾选集 ∩ 现存行——派生而非 effect 写 state，
  // 行删除后失效的勾选自动剔除，无需同步 effect）
  const [pickedIds, setPickedIds] = useState<string[]>([])
  const selectedIds = useMemo(() => pickedIds.filter((id) => p.rows.some((r) => r.id === id)), [pickedIds, p.rows])
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchDate, setBatchDate] = useState("")
  const [batchBusy, setBatchBusy] = useState(false)
  // UX-R2：续期登记（复用编辑表单，标题与提示区分意图）与扫描件查看
  const [renewing, setRenewing] = useState<QualCertRow | null>(null)
  const [fileViewRow, setFileViewRow] = useState<QualCertRow | null>(null)

  const todayMs = new Date(new Date().toDateString()).getTime()
  const baseRows = useMemo(() => filterQualRows(p.rows, keyword), [p.rows, keyword])
  const visibleRows = useMemo(
    () => (bucketFilter ? baseRows.filter((r) => qualBucket(r.valid_to, todayMs) === bucketFilter) : baseRows),
    [baseRows, bucketFilter, todayMs],
  )

  // 批量选择：全选口径 = 当前筛选结果（visibleRows）
  const allSelected = visibleRows.length > 0 && visibleRows.every((r) => selectedIds.includes(r.id))
  const someSelected = visibleRows.some((r) => selectedIds.includes(r.id))
  const toggleRow = (id: string) =>
    setPickedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  const toggleAll = () =>
    setPickedIds((prev) => {
      if (allSelected) return prev.filter((id) => !visibleRows.some((r) => r.id === id))
      const add = visibleRows.map((r) => r.id).filter((id) => !prev.includes(id))
      return [...prev, ...add]
    })

  // UX-R2：定位 = 清过滤 → 滚动到行（data-qual-row 锚点）→ animate-pulse 高亮 2 秒
  const locateRow = (id: string) => {
    setKeyword("")
    setBucketFilter(null)
    setHighlightId(id)
  }
  useEffect(() => {
    if (!highlightId) return
    const scrollTimer = window.setTimeout(() => {
      const el = document.querySelector(`[data-qual-row="${CSS.escape(highlightId)}"]`)
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" })
      else toast.info("该证书不在当前表格页——已清除过滤，按「有效期至」升序通常在第 1 页")
    }, 60)
    const clearTimer = window.setTimeout(() => setHighlightId(null), 2060)
    return () => {
      window.clearTimeout(scrollTimer)
      window.clearTimeout(clearTimer)
    }
  }, [highlightId])

  const startRenew = (row: QualCertRow) => {
    setRenewing(row)
    p.openEdit(row)
  }

  const submitBatchValidity = async () => {
    if (!batchDate || batchBusy) return
    setBatchBusy(true)
    try {
      const { ok, failed } = await p.batchRegisterValidity(selectedIds, batchDate)
      if (failed.length === 0) {
        toast.success(`已为 ${ok} 张证书登记有效期`)
      } else {
        const names = failed
          .map((id) => p.rows.find((r) => r.id === id)?.cert_name ?? id)
          .slice(0, 3)
          .join("、")
        toast.error(`${ok} 张已登记，${failed.length} 张失败：${names}${failed.length > 3 ? " 等" : ""}`)
      }
      setBatchOpen(false)
      setBatchDate("")
      setPickedIds([])
    } finally {
      setBatchBusy(false)
    }
  }

  const exportSelected = () => {
    const picked = p.rows.filter((r) => selectedIds.includes(r.id))
    exportCsvOf(picked, `资质台账_已选${picked.length}项_${localDateStamp()}.csv`)
    toast.success(`已导出选中的 ${picked.length} 条证照`)
  }

  const columns: DataTableColumn<QualCertRow>[] = [
    {
      // UX-R2：批量选择列（不排序）
      key: "select",
      header: (
        <input
          type="checkbox"
          aria-label="全选当前列表"
          checked={allSelected}
          onChange={toggleAll}
          ref={(el) => {
            if (el) el.indeterminate = someSelected && !allSelected
          }}
          className="h-4 w-4 cursor-pointer rounded border-border align-middle"
        />
      ),
      render: (row) => (
        <input
          type="checkbox"
          aria-label={`选择 ${row.cert_name}`}
          checked={selectedIds.includes(row.id)}
          onChange={() => toggleRow(row.id)}
          className="h-4 w-4 cursor-pointer rounded border-border align-middle"
        />
      ),
      headerClassName: "w-10",
      className: "w-10",
    },
    {
      key: "cert_name",
      header: "证照名称",
      sortAccessor: (row) => row.cert_name,
      render: (row) => (
        <span>
          <span className="font-medium text-foreground">{row.cert_name}</span>
          {row.notes ? <span className="block text-xs text-muted-foreground/80">{row.notes.slice(0, 26)}</span> : null}
        </span>
      ),
    },
    {
      key: "category",
      header: "类别",
      sortAccessor: (row) => row.category,
      headerClassName: "hidden sm:table-cell",
      className: "hidden sm:table-cell text-muted-foreground",
      render: (row) => row.category || "—",
    },
    {
      key: "cert_no",
      header: "证书编号",
      sortAccessor: (row) => row.cert_no,
      headerClassName: "hidden md:table-cell",
      className: "hidden md:table-cell font-mono text-xs text-muted-foreground",
      render: (row) => row.cert_no || "—",
    },
    {
      key: "valid_to",
      header: "有效期至",
      sortAccessor: (row) => row.valid_to,
      render: (row) => {
        const { due, cls } = qualDueBadge(row, todayMs)
        // P3-6：自动解析的有效期（来自文件名/目录名解析）加「待核验」徽标——
        // 文件名里的日期可能是编制时间而非证书有效期，投标引用前必须核对原件
        const autoDerived = isAutoDerivedValidity(row.notes)
        return (
          <span>
            <span className={`inline-flex items-center gap-1 ${cls}`}>{row.valid_to || "未登记"}</span>
            <span className="ml-1 text-xs text-muted-foreground">{row.valid_to ? due : ""}</span>
            {autoDerived ? (
              <span
                className="ml-1 inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-1.5 text-[10px] font-medium text-warning"
                title="该有效期由文件名/目录名自动解析，可能是编制时间而非证书有效期——投标引用前请核对证书原件"
              >
                待核验
              </span>
            ) : null}
          </span>
        )
      },
    },
    {
      key: "scope",
      header: "适用范围",
      sortAccessor: (row) => row.scope,
      headerClassName: "hidden lg:table-cell",
      className: "hidden lg:table-cell text-xs text-muted-foreground",
      render: (row) => row.scope || "—",
    },
    {
      key: "actions",
      header: "操作",
      align: "right",
      render: (row) => (
        <QualRowActions
          row={row}
          p={p}
          onRenew={startRenew}
          onViewFile={(r) => setFileViewRow(r)}
        />
      ),
    },
  ]
  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground">资质证书台账</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            证书过期直接废标——登记全部证照与有效期，按 90/30 天与已过期三档预警；投标前务必核对
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            aria-pressed={p.hardBlock}
            onClick={() => p.setHardBlock(!p.hardBlock)}
            title={
              p.hardBlock
                ? "已开启：导出标书时若有过期/临期证书将直接阻断导出"
                : "开启后：导出标书时若有过期/临期证书将直接阻断导出（严谨交付建议）"
            }
            className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              p.hardBlock
                ? "border-destructive/50 bg-destructive/10 text-destructive"
                : "border-border bg-card text-card-foreground hover:bg-secondary"
            }`}
          >
            {p.hardBlock ? "导出硬拦截：开" : "导出硬拦截：关"}
          </button>
          <Button
            variant="outline"
            onClick={() => handleExport(p)}
            disabled={p.rows.length === 0}
            className="gap-1.5 shadow-sm"
            title="导出当前台账为 CSV（供投标附件/行政复核）"
          >
            <Download className="h-4 w-4" />
            导出
          </Button>
          <Button onClick={p.openCreate} className="gap-1.5 shadow-md">
            <Plus className="h-4 w-4" />
            登记资质
          </Button>
        </div>
      </header>

      {/* UX-R2：统计卡按危险度排序（红→橙→黄→灰→灰），全部可点击过滤，再点一次清除 */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {STAT_CARD_ORDER.map((b) => {
          const tone = STAT_CARD_TONE[b]
          const count = b === "total" ? summary.total : summary.buckets[b]
          const active = b !== "total" && bucketFilter === b
          const hint =
            b === "total"
              ? "点击清除过滤，显示全部证照"
              : b === "unknown"
                ? "点击列出待补录有效期的证照，可用批量登记一次补齐"
                : `点击只看${BUCKET_LABEL[b as QualBucket]}的证照`
          return (
            <button
              key={b}
              type="button"
              aria-pressed={active}
              title={hint}
              onClick={() => setBucketFilter((prev) => (b === "total" ? null : prev === b ? null : (b as QualBucket)))}
              className={`rounded-lg border p-3 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                active ? "ring-2 ring-primary" : tone.wrap
              }`}
            >
              <p className={`flex items-center gap-1 text-xs text-muted-foreground ${tone.icon}`}>
                {b === "expired" ? (
                  <ShieldAlert className="h-3.5 w-3.5" />
                ) : b === "unknown" ? (
                  <AlertTriangle className="h-3.5 w-3.5" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                {b === "unknown" ? `⚠ ${BUCKET_LABEL.unknown}` : BUCKET_LABEL[b as QualBucket]}
              </p>
              <p className={`mt-1 text-2xl font-bold ${tone.value}`}>
                {count}
                {b === "unknown" && count > 0 ? <span className="ml-1 text-sm font-medium">张</span> : null}
              </p>
              {active ? <p className="mt-0.5 text-[10px] text-primary">已过滤 · 再点取消</p> : null}
            </button>
          )
        })}
      </div>

      {/* 预警明细（UX-R2：每条带「定位」按钮，直达表格行并高亮 2 秒） */}
      {summary.alerts.length > 0 ? (() => {
        // R228(r2-r010)：自检三档之和 == 预警总数，与驾驶舱 qualRiskView.total 同口径；
        // 不等说明数据或分档逻辑有漂移，页面内标注提示而非静默忽略。
        const tierSum = summary.buckets.expired + summary.buckets.critical + summary.buckets.warning
        const selfCheckOk = tierSum === summary.alerts.length
        return (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4" />
            到期预警（{summary.alerts.length} 项）——投标引用前必须核实
            {selfCheckOk ? (
              <span
                className="ml-1 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-normal text-success"
                title={`已过期 ${summary.buckets.expired} + 30天内 ${summary.buckets.critical} + 90天内 ${summary.buckets.warning} = ${tierSum}`}
              >
                ✓ 口径校验通过
              </span>
            ) : (
              <span
                className="ml-1 rounded bg-destructive/20 px-1.5 py-0.5 text-[10px] font-normal text-destructive"
                title={`三档之和 ${tierSum} ≠ 预警数 ${summary.alerts.length}，请联系维护`}
              >
                ⚠ 口径异常
              </span>
            )}
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {summary.alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`shrink-0 ${BUCKET_CLASS[a.bucket]}`}>{BUCKET_LABEL[a.bucket]}</span>
                <span className="font-medium text-foreground">{a.cert_name}</span>
                {a.category ? <span className="text-muted-foreground">{a.category}</span> : null}
                <span className="text-muted-foreground">{a.valid_to}</span>
                <span className="text-muted-foreground">
                  {a.days_left == null ? qualDueLabel(a.valid_to, new Date(new Date().toDateString()).getTime()) : `剩 ${a.days_left} 天`}
                </span>
                <button
                  type="button"
                  onClick={() => locateRow(a.id)}
                  aria-label={`定位 ${a.cert_name}`}
                  className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Locate className="h-3 w-3" />
                  定位
                </button>
              </li>
            ))}
          </ul>
        </div>
        )
      })() : null}

      {/* 台账列表 */}
      {p.loading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          正在加载台账…
        </div>
      ) : p.rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card py-14 text-center">
          <ShieldCheck className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">台账还是空的</p>
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
            登记营业执照、CMMI、ISO、ITSS、软著、人员证书等的有效期，系统按 90/30 天与已过期三档提前预警
          </p>
          <Button onClick={p.openCreate} size="sm" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            登记第一批资质
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索证照名称 / 类别 / 编号 / 发证机关 / 适用范围"
              aria-label="搜索资质台账"
              className="max-w-sm border-border bg-card shadow-sm"
            />
            {keyword.trim() ? (
              <>
                <span className="text-xs text-muted-foreground">匹配 {visibleRows.length} / {p.rows.length} 条</span>
                <button
                  type="button"
                  onClick={() => setKeyword("")}
                  className="rounded-md px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  清除搜索
                </button>
              </>
            ) : null}
            {bucketFilter ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                已过滤：{BUCKET_LABEL[bucketFilter]} {visibleRows.length} 条
                <button
                  type="button"
                  onClick={() => setBucketFilter(null)}
                  aria-label="清除过滤"
                  className="rounded-full px-1 text-primary/70 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  ✕
                </button>
              </span>
            ) : null}
          </div>
          <DataTable<QualCertRow>
            columns={columns}
            rows={visibleRows}
            getRowId={(row) => row.id}
            initialSort={{ key: "valid_to", dir: "asc" }}
            pageSize={20}
            caption="资质证书台账"
            emptyState={
              bucketFilter
                ? `没有「${BUCKET_LABEL[bucketFilter]}」的证照——这是好事，点击上方卡片清除过滤`
                : keyword.trim()
                  ? "没有匹配的证照，换个关键词或清除搜索"
                  : "暂无证照，点上方「登记资质」开始维护台账"
            }
            rowProps={(row) => ({
              "data-qual-row": row.id,
              className: highlightId === row.id ? "animate-pulse bg-warning/15" : undefined,
            })}
          />
        </>
      )}

      {/* UX-R2：批量浮动操作条（选中 >0 时出现） */}
      {selectedIds.length > 0 && !p.loading ? (
        <div className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 shadow-lg">
          <span className="text-xs font-medium text-foreground">已选 {selectedIds.length} 项</span>
          <Button size="sm" onClick={() => setBatchOpen(true)} className="gap-1">
            <CalendarClock className="h-3.5 w-3.5" />
            批量登记有效期
          </Button>
          <Button size="sm" variant="outline" onClick={exportSelected} className="gap-1">
            <Download className="h-3.5 w-3.5" />
            批量导出
          </Button>
          <button
            type="button"
            onClick={() => setPickedIds([])}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            取消选择
          </button>
        </div>
      ) : null}

      {/* UX-R2：批量登记有效期弹窗（一个日期应用到全部选中行，覆盖原值需知晓） */}
      <Dialog open={batchOpen} onOpenChange={(o) => (!o && !batchBusy ? setBatchOpen(false) : undefined)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>批量登记有效期</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            将把已选 <span className="font-semibold text-foreground">{selectedIds.length}</span>{" "}
            张证书的「有效期至」统一登记为所选日期（覆盖原值，可用于批量续期或补录）。
          </p>
          <label htmlFor="qc-batch-date" className="mt-2 block text-xs font-medium text-muted-foreground">
            有效期至 *
          </label>
          <Input
            id="qc-batch-date"
            type="date"
            value={batchDate}
            onChange={(e) => setBatchDate(e.target.value)}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBatchOpen(false)} disabled={batchBusy}>
              取消
            </Button>
            <Button onClick={() => void submitBatchValidity()} disabled={!batchDate || batchBusy} className="gap-1.5">
              {batchBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
              应用到 {selectedIds.length} 张
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* UX-R2：查看扫描件（file_ref 为位置描述，非文件本体） */}
      <Dialog open={fileViewRow != null} onOpenChange={(o) => (!o ? setFileViewRow(null) : undefined)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>扫描件位置 · {fileViewRow?.cert_name}</DialogTitle>
          </DialogHeader>
          {fileViewRow?.file_ref ? (
            <p className="rounded-md border border-border bg-muted/40 p-3 text-sm leading-relaxed text-foreground">
              {fileViewRow.file_ref}
            </p>
          ) : (
            <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              该证书未登记扫描件位置——点「编辑」补充「扫描件位置」字段，方便投标前快速取件。
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* 登记/编辑/续期表单 */}
      <Dialog open={p.formOpen} onOpenChange={(o) => (!o ? p.closeForm() : undefined)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {renewing ? `续期登记 · ${renewing.cert_name}` : p.editing ? "编辑资质" : "登记资质"}
            </DialogTitle>
          </DialogHeader>
          {renewing ? (
            <p className="-mt-1 text-xs text-muted-foreground">
              更新「有效期至」后保存即可完成续期；如需修改其他字段请用「编辑」。
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="qc-name" className="mb-1 block text-xs font-medium text-muted-foreground">证照名称 *</label>
              <Input
                id="qc-name"
                value={p.draft.cert_name}
                onChange={(e) => p.setDraft({ ...p.draft, cert_name: e.target.value })}
                placeholder="如：CMMI5 证书"
              />
            </div>
            <div>
              <label htmlFor="qc-cat" className="mb-1 block text-xs font-medium text-muted-foreground">类别</label>
              <select
                id="qc-cat"
                value={p.draft.category}
                onChange={(e) => p.setDraft({ ...p.draft, category: e.target.value })}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
              >
                {QUAL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="qc-no" className="mb-1 block text-xs font-medium text-muted-foreground">证书编号</label>
              <Input id="qc-no" value={p.draft.cert_no} onChange={(e) => p.setDraft({ ...p.draft, cert_no: e.target.value })} />
            </div>
            <div>
              <label htmlFor="qc-from" className="mb-1 block text-xs font-medium text-muted-foreground">有效期起</label>
              <Input
                id="qc-from"
                type="date"
                value={p.draft.valid_from}
                onChange={(e) => p.setDraft({ ...p.draft, valid_from: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="qc-to" className="mb-1 block text-xs font-medium text-muted-foreground">有效期至 *</label>
              <Input
                id="qc-to"
                type="date"
                value={p.draft.valid_to}
                onChange={(e) => p.setDraft({ ...p.draft, valid_to: e.target.value })}
                autoFocus={renewing != null}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="qc-issuer" className="mb-1 block text-xs font-medium text-muted-foreground">发证机关</label>
              <Input id="qc-issuer" value={p.draft.issuer} onChange={(e) => p.setDraft({ ...p.draft, issuer: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="qc-scope" className="mb-1 block text-xs font-medium text-muted-foreground">适用项目类型（选填）</label>
              <Input
                id="qc-scope"
                value={p.draft.scope}
                onChange={(e) => p.setDraft({ ...p.draft, scope: e.target.value })}
                placeholder="如：信息化建设、运维服务"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="qc-file" className="mb-1 block text-xs font-medium text-muted-foreground">扫描件位置（选填，知识库/本地路径描述）</label>
              <Input id="qc-file" value={p.draft.file_ref} onChange={(e) => p.setDraft({ ...p.draft, file_ref: e.target.value })} />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                id="qc-ext"
                type="checkbox"
                checked={p.draft.external_ok}
                onChange={(e) => p.setDraft({ ...p.draft, external_ok: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <label htmlFor="qc-ext" className="mb-1 block text-xs font-medium text-muted-foreground">可对外提供（投标可用）</label>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="qc-notes" className="mb-1 block text-xs font-medium text-muted-foreground">备注</label>
              <Input id="qc-notes" value={p.draft.notes} onChange={(e) => p.setDraft({ ...p.draft, notes: e.target.value })} />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => { p.closeForm(); setRenewing(null) }}>
              取消
            </Button>
            <Button onClick={() => { void p.saveDraft().then(() => setRenewing(null)) }} disabled={p.busy} className="gap-1.5">
              {p.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {p.editing ? "保存修改" : "登记"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function QualRowActions({
  row,
  p,
  onRenew,
  onViewFile,
}: {
  row: QualCertRow
  p: UseQualCerts
  onRenew: (row: QualCertRow) => void
  onViewFile: (row: QualCertRow) => void
}) {
  const [pendingDelete, setPendingDelete] = useState(false)
  return (
    <>
      {/* UX-R2：操作收敛为 ⋯ 菜单（原 16px 双图标热区过小），删除保留二次确认 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${row.cert_name} 操作菜单`}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onSelect={() => p.openEdit(row)} className="gap-2">
            <Pencil className="h-3.5 w-3.5" />
            编辑
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onRenew(row)} className="gap-2">
            <CalendarClock className="h-3.5 w-3.5" />
            续期登记
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onViewFile(row)} className="gap-2">
            <FileSearch className="h-3.5 w-3.5" />
            查看扫描件
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setPendingDelete(true)}
            className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={pendingDelete}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(false)
        }}
        title="删除资质"
        description={`确定删除「${row.cert_name}」吗？删除后不可恢复。`}
        confirmText="删除"
        tone="danger"
        onConfirm={() => {
          setPendingDelete(false)
          void p.removeRow(row)
        }}
      />
    </>
  )
}

// UX-R2: 方案工作室 已按 docs/ux-review-2026-11 修复 2026-11-07（数据条过滤/教学卡折叠/操作分层/模板下拉）
import { useMemo, useState } from "react"
import { Archive, Boxes, ChevronDown, Copy, Download, FilePlus2, Layers, LayoutGrid, Loader2, MoreHorizontal, Search, Table2, Trash2, X } from "lucide-react"
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { useCompanyTemplates } from "@/components/common/companyTemplates"
import type { UseSolutionStudio } from "@/pages/SolutionStudio/useSolutionStudio"
import { exportToCsv } from "@/lib/exportCsv"
import { localDateStamp } from "@/lib/dateStamp"
import { formatShortDateTime } from "@/lib/dateDisplay"
import {
  DOC_STATUS_LABEL,
  SOLUTION_TYPES,
  SYSTEM_OPTIONS,
  typeLabel,
  type DocStatus,
  type SolutionRecord,
  type SolutionTypeKey,
} from "@/pages/SolutionStudio/solutionTypes"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

type SolutionListPanelProps = Pick<
  UseSolutionStudio,
  | "solutions"
  | "solutionStats"
  | "listLoading"
  | "searchKeyword"
  | "setSearchKeyword"
  | "openNewWizard"
  | "openSolution"
  | "openReuseWizard"
  | "openSolutionToKb"
  | "deleteSolution"
  | "userId"
>

function statusTone(jobStatus: DocStatus): string {
  // 徽标语义档（全站设计规范 v1）：已完成=主色档，生成中=关注档，其余=中性档
  if (jobStatus === "done") return "bg-primary/10 text-primary"
  if (jobStatus === "generating") return "bg-warning/10 text-warning"
  return "bg-muted text-muted-foreground"
}

/** 统计卡（对齐原型 stat-card：标签 + 大数字 + 说明行） */

function SolutionCard({
  rec,
  onOpen,
  onReuse,
  onImportToKb,
  onDelete,
}: {
  rec: SolutionRecord
  onOpen: () => void
  onReuse: () => void
  onImportToKb: () => void
  onDelete: () => void
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const doneCount = (rec.chapters ?? []).filter((c) => c.gen_status === "done").length
  const totalCount = (rec.chapters ?? []).length
  return (
    <article className="group flex h-full flex-col rounded-lg border border-border bg-card p-5 text-left shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <h3 className="truncate text-base font-semibold text-foreground group-hover:text-primary">{rec.solution_name}</h3>
          <p className="mt-1 truncate text-sm text-muted-foreground">{rec.hospital || "未填客户医院"}</p>
        </button>
        <Badge variant="outline" className="shrink-0 rounded-full border-primary/30 bg-primary/10 text-xs font-normal text-primary">
          {typeLabel(rec.solution_type)}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className={`rounded-full px-2.5 py-0.5 ${statusTone(rec.doc_status)}`}>
          {DOC_STATUS_LABEL[rec.doc_status] ?? rec.doc_status}
        </span>
        {totalCount > 0 && <span>正文 {doneCount}/{totalCount} 章</span>}
        <span>更新于 {formatShortDateTime(rec.updated)}</span>
      </div>
      <div className="mt-auto flex items-center gap-2 pt-4">
        {/* UX-R2（docs/ux-review-2026-11 §五）：操作分层——「打开编辑」实心主按钮，
            以此为底稿 / 入素材库 / 删除收进 ⋯ 菜单（删除保留二次确认） */}
        <Button size="sm" onClick={onOpen} className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90">
          打开编辑
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`方案 ${rec.solution_name} 更多操作`}
              title="以此为底稿 / 入素材库 / 删除"
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <MoreHorizontal className="h-4 w-4" />
              更多
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={onReuse} className="gap-2">
              <Copy className="h-3.5 w-3.5" /> 以此为底稿
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onImportToKb} className="gap-2">
              <Archive className="h-3.5 w-3.5" /> 入素材库
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setConfirmingDelete(true)}
              className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" /> 删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* 确认走模态对话框，不再用行内按钮 + onBlur（焦点切换会吃掉鼠标点击） */}
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="删除方案"
        description={`确定删除「${rec.solution_name}」吗？删除后不可恢复。`}
        confirmText="删除"
        tone="danger"
        onConfirm={() => {
          setConfirmingDelete(false)
          onDelete()
        }}
      />
    </article>
  )
}

export function SolutionListPanel(p: SolutionListPanelProps) {
  // UX-R2：模板下载收进「新建方案」下拉（数据与下载复用 CompanyTemplateHint 抽出的 hook）
  const { rows: templateRows, busyId: templateBusyId, download: downloadTemplate } = useCompanyTemplates(
    "solution",
    "spec",
  )
  // UX-R2：数据条状态过滤（全部 / 编写中 / 已完成）
  const [activeStatus, setActiveStatus] = useState<"all" | "drafting" | "done">("all")
  // 类型筛选为纯前端视图过滤（叠加在 hook 的搜索过滤之上），不改动数据层，风险最低。
  const [activeType, setActiveType] = useState<SolutionTypeKey | "all">("all")
  // O-004：列表表格化（DataTable 复用第五站），默认卡片保持既有体验不变
  const [listView, setListView] = useState<"card" | "table">("card")
  const visible = useMemo(
    () =>
      p.solutions.filter(
        (s) =>
          (activeType === "all" || s.solution_type === activeType) &&
          (activeStatus === "all" || (activeStatus === "done" ? s.doc_status === "done" : s.doc_status !== "done")),
      ),
    [p.solutions, activeType, activeStatus],
  )

  const solutionColumns = useMemo<DataTableColumn<SolutionRecord>[]>(
    () => [
      {
        key: "name",
        header: "方案名称",
        sortAccessor: (r) => r.solution_name,
        render: (r) => (
          <span className="block max-w-[280px] truncate font-medium text-foreground">{r.solution_name}</span>
        ),
      },
      {
        key: "type",
        header: "类型",
        width: "96px",
        className: "px-2 py-2",
        headerClassName: "px-2 py-2",
        sortAccessor: (r) => r.solution_type,
        render: (r) => (
          <Badge variant="outline" className="rounded-full border-primary/30 bg-primary/10 text-xs font-normal text-primary">
            {typeLabel(r.solution_type)}
          </Badge>
        ),
      },
      {
        key: "hospital",
        header: "医院",
        sortAccessor: (r) => r.hospital,
        render: (r) => <span className="block max-w-[180px] truncate">{r.hospital || "—"}</span>,
      },
      {
        key: "status",
        header: "状态",
        width: "96px",
        className: "px-2 py-2",
        headerClassName: "px-2 py-2",
        sortAccessor: (r) => r.doc_status,
        render: (r) => (
          <span className={`rounded-full px-2 py-0.5 text-xs ${statusTone(r.doc_status)}`}>
            {DOC_STATUS_LABEL[r.doc_status] ?? r.doc_status}
          </span>
        ),
      },
      {
        key: "chapters",
        header: "正文",
        width: "64px",
        align: "right",
        className: "px-2 py-2",
        headerClassName: "px-2 py-2",
        sortAccessor: (r) => (r.chapters ?? []).filter((c) => c.gen_status === "done").length,
        render: (r) => {
          const total = (r.chapters ?? []).length
          if (!total) return <span className="text-muted-foreground">—</span>
          const doneCount = (r.chapters ?? []).filter((c) => c.gen_status === "done").length
          return <span className="tabular-nums">{doneCount}/{total} 章</span>
        },
      },
      {
        key: "updated",
        header: "更新时间",
        width: "128px",
        className: "px-2 py-2",
        headerClassName: "px-2 py-2",
        sortAccessor: (r) => r.updated,
        render: (r) => <span className="whitespace-nowrap text-muted-foreground">{formatShortDateTime(r.updated)}</span>,
      },
    ],
    [],
  )

  const handleExportSolutions = () => {
    const headers = ["方案名称", "类型", "医院", "状态", "创建时间", "更新时间"]
    const rows = visible.map((s) => [s.solution_name, s.solution_type, s.hospital, s.doc_status, s.created, s.updated])
    exportToCsv(`方案列表_${localDateStamp()}.csv`, headers, rows)
  }

  const filtering = Boolean(p.searchKeyword.trim()) || activeType !== "all"

  return (
    <section className="mx-auto max-w-7xl px-4 pb-10">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-background via-secondary to-card px-6 py-8 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
        <p className="text-xs font-medium tracking-wide text-primary">医疗售前工作台</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">方案编制</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          选择方案类型、填写医院项目信息，生成符合医疗信息化行业惯例的多级大纲，逐章产出规划 / 可研 / 初设 / 定制 / 标准方案正文，在线精修后导出 Word 交付文档。
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {/* UX-R2（docs/ux-review-2026-11 §五）：模板下载条收进「新建方案」下拉——
              模板行由 useCompanyTemplates 惰性拉取，无模板时菜单只含向导项 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]">
                <FilePlus2 className="mr-1.5 h-4 w-4" />
                新建方案
                <ChevronDown className="ml-0.5 h-3.5 w-3.5 opacity-80" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onSelect={p.openNewWizard} className="gap-2">
                <FilePlus2 className="h-3.5 w-3.5 text-primary" />
                从向导新建方案
              </DropdownMenuItem>
              {templateRows.length > 0 ? (
                <>
                  <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">公司标准模版下载</div>
                  {templateRows.map((r) => (
                    <DropdownMenuItem
                      key={r.id}
                      onSelect={() => void downloadTemplate(r)}
                      disabled={templateBusyId === r.id}
                      className="gap-2"
                    >
                      <Download className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{r.name}</span>
                      {templateBusyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    </DropdownMenuItem>
                  ))}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={handleExportSolutions} disabled={visible.length === 0} className="shadow-sm">
            <Download className="mr-1.5 h-4 w-4" />
            导出 CSV
          </Button>
        </div>
      </header>

      {/* UX-R2（docs/ux-review-2026-11 §五）：三张统计卡压成一行数据条，点击过滤（数字始终反映全量） */}
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-5 py-3.5 shadow-sm">
        {([
          { key: "all" as const, label: "全部", value: p.solutionStats.total },
          { key: "drafting" as const, label: "编写中", value: p.solutionStats.drafting },
          { key: "done" as const, label: "已完成", value: p.solutionStats.done },
        ]).map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={activeStatus === s.key}
            onClick={() => setActiveStatus(s.key)}
            title={`只看${s.label}的方案${activeStatus === s.key ? "（再点取消）" : ""}`}
            className="inline-flex items-baseline gap-1.5 rounded transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className={`text-lg font-bold tabular-nums ${activeStatus === s.key ? "text-primary" : "text-foreground"}`}>{s.value}</span>
            <span className={`text-xs ${activeStatus === s.key ? "font-medium text-primary" : "text-muted-foreground"}`}>{s.label}</span>
          </button>
        ))}
        {activeStatus !== "all" ? (
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            已过滤：{activeStatus === "done" ? "已完成" : "编写中"}
          </span>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">覆盖 {SOLUTION_TYPES.length} 类方案类型</span>
      </div>

      {/* 类型筛选 chips + 搜索框 */}
      <div className="mt-8 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setActiveType("all")}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            activeType === "all"
              ? "border-primary bg-primary text-primary-foreground shadow-sm"
              : "border-border bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          全部
        </button>
        {SOLUTION_TYPES.map((t) => {
          const active = activeType === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveType(t.key)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                active
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          )
        })}
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={p.searchKeyword}
            onChange={(e) => p.setSearchKeyword(e.target.value)}
            placeholder="搜索方案名 / 医院 / 类型"
            className="pl-9 focus-visible:shadow-[var(--focus-ring)]"
          />
        </div>
      </div>

      {!p.listLoading && visible.length > 0 && (
        <div className="mt-5 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            共 {visible.length} 个方案{filtering ? "（已按搜索/类型筛选）" : ""}
          </p>
          {/* O-004 视图切换：卡片网格 / 对照表格 */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setListView("card")}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                listView === "card"
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              卡片
            </button>
            <button
              type="button"
              onClick={() => setListView("table")}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                listView === "table"
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Table2 className="h-3.5 w-3.5" />
              表格
            </button>
          </div>
        </div>
      )}

      {p.listLoading ? (
        <div className="mt-6 flex items-center justify-center gap-2 rounded-lg border border-border bg-card py-16 text-sm text-muted-foreground shadow-md">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          方案加载中…
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card py-16 text-center shadow-md">
          <FilePlus2 className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">{filtering ? "没有匹配的方案" : "还没有方案"}</p>
          <p className="text-xs text-muted-foreground">
            {filtering ? "换个关键词或类型试试" : "从选择方案类型开始，AI 生成大纲后逐章产出正文"}
          </p>
          {filtering ? (
            <Button
              variant="outline"
              onClick={() => {
                p.setSearchKeyword("")
                setActiveType("all")
              }}
              className="mt-3 gap-1.5 border-primary/40 text-primary shadow-sm hover:bg-primary/10 hover:text-primary"
            >
              <X className="h-3.5 w-3.5" />
              清空搜索与筛选
            </Button>
          ) : (
            <Button variant="outline" onClick={p.openNewWizard} className="mt-3 border-primary/40 text-primary shadow-sm hover:bg-primary/10 hover:text-primary focus-visible:shadow-[var(--focus-ring)]">
              <FilePlus2 className="mr-1.5 h-4 w-4" />
              新建第一个方案
            </Button>
          )}
        </div>
      ) : listView === "table" ? (
        <DataTable<SolutionRecord>
          className="mt-4"
          columns={solutionColumns}
          rows={visible}
          getRowId={(r) => r.id}
          onRowClick={(r) => p.openSolution(r)}
          initialSort={{ key: "updated", dir: "desc" }}
          emptyState="无匹配方案"
          caption="方案列表表格视图"
        />
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((rec) => (
            <SolutionCard
              key={rec.id}
              rec={rec}
              onOpen={() => p.openSolution(rec)}
              onReuse={() => p.openReuseWizard(rec)}
              onImportToKb={() => p.openSolutionToKb(rec)}
              onDelete={() => void p.deleteSolution(rec)}
            />
          ))}
        </div>
      )}

      {/* UX-R2：教学信息默认折叠（details 模式）——新手可展开，老用户不再被打扰 */}
      <details className="mt-8 rounded-xl border border-border bg-card shadow-md">
        <summary className="flex cursor-pointer select-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
          📖 新手指南：方案类型说明 与 行业系统库
          <span className="ml-auto text-xs font-normal text-muted-foreground">点击展开 / 收起</span>
        </summary>
        <div className="grid grid-cols-1 gap-4 border-t border-border p-5 lg:grid-cols-[3fr_2fr]">
        <div className="rounded-xl border border-border bg-card p-5 shadow-md">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Layers className="h-4 w-4 text-primary" />
            方案类型说明
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {SOLUTION_TYPES.map((t) => (
              <li key={t.key} className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  {t.label}
                </span>
                <span className="text-sm leading-relaxed text-muted-foreground">{t.desc}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-md">
          <h2 className="flex items-center justify-between gap-2 text-base font-semibold text-foreground">
            <span className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-primary" />
              行业系统库
            </span>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">已就绪</span>
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            覆盖医疗信息化主流系统，方案生成时按建设清单自动引用对应系统内容。
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {SYSTEM_OPTIONS.map((s) => (
              <span key={s} className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                {s}
              </span>
            ))}
          </div>
        </div>
        </div>
      </details>

      <footer className="mt-12 border-t border-border pt-6 text-center text-xs text-muted-foreground">
        方案数据保存在服务端，正文生成按实际 token 用量扣费
      </footer>
    </section>
  )
}

import { useMemo, useState } from "react"
import { Archive, Boxes, Copy, Download, FilePlus2, Layers, Loader2, Search, Trash2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { CompanyTemplateHint } from "@/components/common/CompanyTemplateHint"
import type { UseSolutionStudio } from "@/pages/SolutionStudio/useSolutionStudio"
import { exportToCsv } from "@/lib/exportCsv"
import { localDateStamp } from "@/lib/dateStamp"
import {
  DOC_STATUS_LABEL,
  SOLUTION_TYPES,
  SYSTEM_OPTIONS,
  typeLabel,
  type DocStatus,
  type SolutionRecord,
  type SolutionTypeKey,
} from "@/pages/SolutionStudio/solutionTypes"

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
function StatCard({
  icon,
  label,
  value,
  hint,
  hintClass,
}: {
  icon: React.ReactNode
  label: string
  value: number
  hint: string
  hintClass?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-md lg:p-5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <p className="mt-1.5 text-3xl font-bold tabular-nums text-foreground">{value}</p>
      <p className={`mt-1 text-xs ${hintClass ?? "text-muted-foreground"}`}>{hint}</p>
    </div>
  )
}

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
        <span>更新于 {new Date(rec.updated).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div className="mt-auto flex items-center gap-2 pt-4">
        {/* A2-10：卡片动作统一 outline，唯一 bg-primary 留给列表页「新建方案」 */}
        <Button size="sm" variant="outline" onClick={onOpen} className="border-primary/40 text-primary shadow-sm hover:bg-primary/10 hover:text-primary">
          打开编辑
        </Button>
        <Button size="sm" variant="outline" onClick={onReuse} className="border-border text-muted-foreground hover:text-foreground">
          <Copy className="mr-1 h-3.5 w-3.5" />
          以此为底稿
        </Button>
        <Button size="sm" variant="ghost" onClick={onImportToKb} className="text-muted-foreground hover:text-primary" title="把成稿章节拆块入素材库">
          <Archive className="mr-1 h-3.5 w-3.5" />
          入素材库
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" aria-label={`删除方案 ${rec.solution_name}`} title="删除方案" onClick={() => setConfirmingDelete(true)}>
          <Trash2 className="h-4 w-4" />
        </Button>
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
  // 类型筛选为纯前端视图过滤（叠加在 hook 的搜索过滤之上），不改动数据层，风险最低。
  const [activeType, setActiveType] = useState<SolutionTypeKey | "all">("all")
  const visible = useMemo(
    () => (activeType === "all" ? p.solutions : p.solutions.filter((s) => s.solution_type === activeType)),
    [p.solutions, activeType],
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
          <Button onClick={p.openNewWizard} className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]">
            <FilePlus2 className="mr-1.5 h-4 w-4" />
            新建方案
          </Button>
          <Button variant="outline" onClick={handleExportSolutions} disabled={visible.length === 0} className="shadow-sm">
            <Download className="mr-1.5 h-4 w-4" />
            导出 CSV
          </Button>

        </div>
        {/* R-203：本场景配套的公司标准模版（附件4 方案模板 + 封面示例 + 格式规范），点击即下载 */}
        <CompanyTemplateHint scenario="solution" extraScenario="spec" />
      </header>

      {/* 统计卡：始终反映全量方案（不受搜索/类型过滤影响），对齐原型 g3 stat-row */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={<Layers className="h-3.5 w-3.5" />}
          label="全部方案"
          value={p.solutionStats.total}
          hint={`覆盖 ${SOLUTION_TYPES.length} 类方案类型`}
        />
        <StatCard
          icon={<FilePlus2 className="h-3.5 w-3.5" />}
          label="编写中"
          value={p.solutionStats.drafting}
          hint="大纲 / 生成中 / 部分成稿"
        />
        <StatCard
          icon={<Archive className="h-3.5 w-3.5" />}
          label="已完成交付"
          value={p.solutionStats.done}
          hint="可导出 Word 交付"
          hintClass="text-primary"
        />
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

      {/* 底部信息卡：方案类型说明 + 行业系统库（均来自真实常量，非 mock） */}
      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
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

      <footer className="mt-12 border-t border-border pt-6 text-center text-xs text-muted-foreground">
        方案数据保存在服务端，正文生成按实际 token 用量扣费
      </footer>
    </section>
  )
}

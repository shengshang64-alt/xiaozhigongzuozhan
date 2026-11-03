import { useRef, useState, type ChangeEvent, type ReactNode } from "react"
import { Archive, ArchiveRestore, CalendarClock, Download, FileCheck2, LayoutGrid, Loader2, Plus, Search, Table2, Trash2, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { CompanyTemplateHint } from "@/components/common/CompanyTemplateHint"
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import { daysUntil, displayStageLabel, effectiveHospital, isGenTargetChapter, normalizeBidScope, type BidProjectRecord, type BidStage } from "@/pages/BidWorkspace/bidTypes"
import { extractTenderMeta, tenderMetaHits } from "@/pages/BidWorkspace/tenderMeta"
import { exportToCsv } from "@/lib/exportCsv"
import { localDateStamp } from "@/lib/dateStamp"
import { isTrulyDoneChapter } from "@/pages/BidWorkspace/chapterCompletion"

// 2026-10-20：这个「成稿章数」此前用 (c.content ?? "").trim() 判断，与编制页口径不一致。
// 编制页（useBidWorkspace 的 doneChapterCount / techChapterTotal）用的是
// isGenTargetChapter（只算当前 scope 的生成目标章，商务骨架章不计）+ isTrulyDoneChapter
// （gen_status === "done" 且无待生成小节）。两套口径并存的结果是：同一个项目，列表里显示
// 「8/20 章成稿」，点进去却写着「3/12 已生成」——用户会以为自己看错了。
// 现在统一继承编制页口径，分母也换成同一组目标章；顺带修掉原写法的一个老问题：
// 分母含商务骨架章，而表头合计只加技术章，两个数本来就对不上。
// 附带收益：新判据只看 gen_status 与小节状态，不再对每章正文调 .trim()（那会复制整串），
// 比原写法快得多。
function chapterProgress(proj: BidProjectRecord): { done: number; total: number } {
  const scope = normalizeBidScope(proj.gen_options)
  const generateDemo = proj.gen_options?.generate_demo === true
  const targets = proj.bid_chapters.filter((c) => isGenTargetChapter(c, scope, generateDemo))
  return { done: targets.filter((c) => isTrulyDoneChapter(c)).length, total: targets.length }
}

/** 排序与展示共用同一份算法，避免两处各算一遍。
 * 单位「章成稿」并进返回值，而不是写成 `{值} 章成稿`：JSX 里「表达式 + 空格 + 文字」是三个
 * 相邻文本节点，格式化工具或编辑器若把换行插进去，前导空格会被折叠掉、显示成「3/129章成稿」。 */
function chapterProgressLabel(proj: BidProjectRecord): string {
  const p = chapterProgress(proj)
  return `${p.done}/${p.total} 章成稿`
}

type ListView = "active" | "archived" | "trash"

type BidProjectListProps = Pick<
  UseBidWorkspace,
  | "projects"
  | "projectsCapped"
  | "listLoading"
  | "searchKeyword"
  | "setSearchKeyword"
  | "openNewDialog"
  | "openProject"
  | "deleteProject"
  | "listView"
  | "setListView"
  | "recentDeleted"
  | "softDeleteProject"
  | "restoreProject"
  | "setProjectArchived"
  | "newDialogOpen"
  | "setNewDialogOpen"
  | "formProjectName"
  | "setFormProjectName"
  | "formTenderNo"
  | "setFormTenderNo"
  | "formHospital"
  | "setFormHospital"
  | "formBidOpenDate"
  | "setFormBidOpenDate"
  | "formOpportunityId"
  | "setFormOpportunityId"
  | "dialogOppOptions"
  | "oppOptionsCapped"
  | "creating"
  | "createProject"
>

const STAGE_BADGE: Record<BidStage, string> = {
  pending_parse: "bg-muted text-muted-foreground",
  composing: "bg-primary/10 text-primary",
  checking: "bg-warning/10 text-warning",
  evaluated: "bg-primary/10 text-primary",
  archived: "bg-muted text-muted-foreground",
}

function CountdownChip({ dateStr }: { dateStr: string }) {
  const days = daysUntil(dateStr)
  if (days === null) return null
  if (days < 0) {
    return (
      <span className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
        <CalendarClock className="h-3 w-3" />
        已开标
      </span>
    )
  }
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs ${
        days <= 7 ? "bg-destructive/10 font-medium text-destructive" : "bg-primary/10 text-primary"
      }`}
    >
      <CalendarClock className="h-3 w-3" />
      距开标 {days} 天
    </span>
  )
}

// 第十一轮改造 1：回收站保留 30 天，剩余天数 = 30 + daysUntil(deleted_at)（daysUntil 对过去时间为负）
const TRASH_RETAIN_DAYS = 30

function trashRemainDays(deletedAt: string): number | null {
  const d = daysUntil(deletedAt)
  if (d === null) return null
  return Math.max(0, TRASH_RETAIN_DAYS + d)
}

function TrashRemainChip({ deletedAt }: { deletedAt: string }) {
  const remain = trashRemainDays(deletedAt)
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs ${
        remain !== null && remain <= 3
          ? "bg-destructive/10 font-medium text-destructive"
          : "bg-muted text-muted-foreground"
      }`}
    >
      <CalendarClock className="h-3 w-3" />
      {remain === null ? "即将自动清除" : `${remain} 天后自动清除`}
    </span>
  )
}

function CardActionButton({
  title,
  danger,
  onClick,
  children,
}: {
  title: string
  danger?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`rounded-md p-1.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        danger
          ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          : "text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
      }`}
    >
      {children}
    </button>
  )
}

function ProjectCard({
  proj,
  view,
  onOpen,
  onArchive,
  onUnarchive,
  onSoftDelete,
  onRestore,
  onPurge,
}: {
  proj: BidProjectRecord
  view: ListView
  onOpen: (rec: BidProjectRecord) => void
  onArchive: (rec: BidProjectRecord) => void
  onUnarchive: (rec: BidProjectRecord) => void
  onSoftDelete: (rec: BidProjectRecord) => void
  onRestore: (rec: BidProjectRecord) => void
  onPurge: (rec: BidProjectRecord) => void
}) {
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpen(proj)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(proj)
      }}
      className="group flex h-full cursor-pointer flex-col rounded-lg border border-border bg-card p-5 text-left shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{proj.project_name}</h3>
        {view === "archived" ? (
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">已归档 · 只读留档</span>
        ) : (
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STAGE_BADGE[proj.stage] ?? STAGE_BADGE.pending_parse}`}>
            {displayStageLabel(proj)}
          </span>
        )}
      </div>
      <p className="mt-2 truncate text-xs text-muted-foreground">
        {effectiveHospital(proj) || "采购人未填写"}
        {proj.tender_no ? ` · ${proj.tender_no}` : ""}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {view === "trash" ? (
          <TrashRemainChip deletedAt={proj.deleted_at} />
        ) : (
          <CountdownChip dateStr={proj.bid_open_date} />
        )}
        {view !== "trash" && (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
            {chapterProgressLabel(proj)}
          </span>
        )}
      </div>
      <div className="mt-auto flex items-center justify-between pt-4">
        <span className="text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {view === "trash" ? "点击可查看（还原后继续编辑）" : "点击进入流水线"}
        </span>
        <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {view === "active" && (
            <>
              <CardActionButton title="归档项目" onClick={() => onArchive(proj)}>
                <Archive className="h-4 w-4" />
              </CardActionButton>
              <CardActionButton title="删除（移入回收站）" danger onClick={() => onSoftDelete(proj)}>
                <Trash2 className="h-4 w-4" />
              </CardActionButton>
            </>
          )}
          {view === "archived" && (
            <>
              <CardActionButton title="取消归档" onClick={() => onUnarchive(proj)}>
                <ArchiveRestore className="h-4 w-4" />
              </CardActionButton>
              <CardActionButton title="删除（移入回收站）" danger onClick={() => onSoftDelete(proj)}>
                <Trash2 className="h-4 w-4" />
              </CardActionButton>
            </>
          )}
          {view === "trash" && (
            <>
              <CardActionButton title="还原项目" onClick={() => onRestore(proj)}>
                <Undo2 className="h-4 w-4" />
              </CardActionButton>
              <CardActionButton title="彻底删除（不可恢复）" danger onClick={() => onPurge(proj)}>
                <Trash2 className="h-4 w-4" />
              </CardActionButton>
            </>
          )}
        </span>
      </div>
    </article>
  )
}

export function BidProjectList(p: BidProjectListProps) {
  const [pendingDelete, setPendingDelete] = useState<BidProjectRecord | null>(null)
  // 撤销提醒条折叠态：>3 条时默认只显示前 3 条，避免把项目列表顶出首屏
  const [undoExpanded, setUndoExpanded] = useState(false)
  // ux-03：新建投标唯一必填「项目名称」——hook 已有 toast 兼底但一闪而过、不落字段；此处补行内红框+红字提示+自动聚焦
  const [projNameErr, setProjNameErr] = useState("")
  const projNameRef = useRef<HTMLInputElement>(null)
  // 导入招标文件自动识别（R-新增）：本地解析 + 规则抽取，零 AI 零上传；识别结果只用于预填，用户可改
  const tenderFileRef = useRef<HTMLInputElement>(null)
  const [metaBusy, setMetaBusy] = useState(false)
  const [metaNote, setMetaNote] = useState("")
  const onPickTenderFile = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0]
    ev.target.value = "" // 清空 value：同一个文件改完再选一次也能触发
    if (!file) return
    setMetaBusy(true)
    setMetaNote("")
    try {
      // 动态引入：bidFiles 会拉 docx/pdfjs，静态引入会让 BidWorkspace 路由壳静态可达重库
      // （onDemandHeavyLibs.test.ts 的 R147 按需加载红线）。只有真选文件时才把它拉进来。
      const { extractTenderFileText } = await import("@/pages/BidWorkspace/bidFiles")
      const text = await extractTenderFileText(file)
      const meta = extractTenderMeta(text)
      const hits = tenderMetaHits(meta)
      if (meta.projectName) p.setFormProjectName(meta.projectName)
      if (meta.tenderNo) p.setFormTenderNo(meta.tenderNo)
      if (meta.hospital) p.setFormHospital(meta.hospital)
      if (meta.bidOpenDate) p.setFormBidOpenDate(meta.bidOpenDate)
      if (meta.projectName) setProjNameErr("")
      setMetaNote(hits.length ? `已识别并填入：${hits.join("、")}，请核对后再创建` : "没识别出可用信息，请手动填写")
    } catch (err) {
      setMetaNote(err instanceof Error ? err.message : "文件解析失败，请改用 .docx / .pdf / .txt")
    } finally {
      setMetaBusy(false)
    }
  }
  const submitCreate = () => {
    if (!p.formProjectName.trim()) {
      setProjNameErr("请填写项目名称后再创建")
      projNameRef.current?.focus()
      return
    }
    setProjNameErr("")
    void p.createProject()
  }
  const handleExportBids = () => {
    const headers = ["项目名称", "招标编号", "医院", "阶段", "开标日期"]
    const rows = p.projects.map((proj) => [proj.project_name, proj.tender_no, proj.hospital, proj.stage, proj.bid_open_date])
    exportToCsv(`投标项目_${localDateStamp()}.csv`, headers, rows)
  }
  // R250（r2-r012 收尾）：项目列表「卡片/表格」双视图。默认仍是卡片，既有行为零变化；
  // 表格复用全站 DataTable（点表头三态排序 + 超 20 条分页），列全部取卡片已在用的字段，零新增数据。
  const [displayMode, setDisplayMode] = useState<"card" | "table">("card")
  const chapterDoneCount = (proj: BidProjectRecord) => chapterProgress(proj).done
  const chaptersColumn: DataTableColumn<BidProjectRecord> = {
    key: "chapters",
    header: "成稿章节",
    align: "right",
    sortAccessor: chapterDoneCount,
    render: (proj) => (
      <span className="text-xs text-muted-foreground">
        {chapterProgressLabel(proj)}
      </span>
    ),
  }
  const tableColumns: DataTableColumn<BidProjectRecord>[] = [
    {
      key: "project_name",
      header: "项目名称",
      sortAccessor: (proj) => proj.project_name,
      render: (proj) => <span className="font-medium text-foreground">{proj.project_name}</span>,
    },
    {
      key: "hospital",
      header: "客户医院",
      sortAccessor: (proj) => effectiveHospital(proj),
      render: (proj) => <span className="text-muted-foreground">{effectiveHospital(proj) || "采购人未填写"}</span>,
    },
    {
      key: "tender_no",
      header: "招标编号",
      sortAccessor: (proj) => proj.tender_no,
      render: (proj) => <span className="font-mono text-xs text-muted-foreground">{proj.tender_no || "—"}</span>,
    },
    {
      key: "stage",
      header: "阶段",
      sortAccessor: (proj) => displayStageLabel(proj),
      render: (proj) =>
        p.listView === "archived" ? (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">已归档 · 只读留档</span>
        ) : (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STAGE_BADGE[proj.stage] ?? STAGE_BADGE.pending_parse}`}>
            {displayStageLabel(proj)}
          </span>
        ),
    },
    {
      key: "bid_open_date",
      header: "开标时间",
      sortAccessor: (proj) => proj.bid_open_date,
      render: (proj) =>
        p.listView === "trash" ? (
          <TrashRemainChip deletedAt={proj.deleted_at} />
        ) : (
          <span className="inline-flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{proj.bid_open_date || "未登记"}</span>
            <CountdownChip dateStr={proj.bid_open_date} />
          </span>
        ),
    },
    // 回收站卡片本就不显示成稿进度，表格同口径
    ...(p.listView === "trash" ? [] : [chaptersColumn]),
    {
      key: "actions",
      header: "操作",
      align: "right",
      render: (proj) => (
        <span className="inline-flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {p.listView === "active" && (
            <>
              <CardActionButton title="归档项目" onClick={() => void p.setProjectArchived(proj, true)}>
                <Archive className="h-4 w-4" />
              </CardActionButton>
              <CardActionButton title="删除（移入回收站）" danger onClick={() => void p.softDeleteProject(proj)}>
                <Trash2 className="h-4 w-4" />
              </CardActionButton>
            </>
          )}
          {p.listView === "archived" && (
            <>
              <CardActionButton title="取消归档" onClick={() => void p.setProjectArchived(proj, false)}>
                <ArchiveRestore className="h-4 w-4" />
              </CardActionButton>
              <CardActionButton title="删除（移入回收站）" danger onClick={() => void p.softDeleteProject(proj)}>
                <Trash2 className="h-4 w-4" />
              </CardActionButton>
            </>
          )}
          {p.listView === "trash" && (
            <>
              <CardActionButton title="还原项目" onClick={() => void p.restoreProject(proj)}>
                <Undo2 className="h-4 w-4" />
              </CardActionButton>
              <CardActionButton title="彻底删除（不可恢复）" danger onClick={() => setPendingDelete(proj)}>
                <Trash2 className="h-4 w-4" />
              </CardActionButton>
            </>
          )}
        </span>
      ),
    },
  ]

  return (
    <main className="animate-in fade-in duration-500">
      <section className="mx-auto max-w-7xl px-4 pt-8">
        <header className="rounded-2xl border border-border bg-gradient-to-br from-background via-secondary to-card px-6 py-8 shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-primary">
                <FileCheck2 className="h-3.5 w-3.5" />
                投标全流程工作台
              </p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">投标项目</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                每个项目按「导入招标文件 → AI 解析评分办法与废标条款 → 编制投标文件 → 查重 → 废标自查 → 模拟评标 → 归档导出」推进，各环节结果都保存在项目内，随时回来继续。
              </p>
            </div>
            <Button
              variant="outline"
              onClick={handleExportBids}
              disabled={p.projects.length === 0}
              className="shadow-sm"
            >
              <Download className="mr-1.5 h-4 w-4" />
              导出 CSV
            </Button>
            <Button
              onClick={p.openNewDialog}
              className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              新建投标项目
            </Button>
          </div>
          {/* R-203：本场景配套的公司标准模版（附件3 投标模板 + 附件1 全文范本 + 格式规范），点击即下载 */}
          <CompanyTemplateHint scenario="bid" extraScenario="spec" />
        </header>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {/* 第十一轮改造 1：视图切换胶囊（进行中 / 已归档 / 回收站） */}
          <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-sm">
            {(
              [
                { key: "active", label: "进行中" },
                { key: "archived", label: "已归档" },
                { key: "trash", label: "回收站" },
              ] as { key: ListView; label: string }[]
            ).map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => p.setListView(v.key)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  p.listView === v.key
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          {/* R250：卡片/表格显示方式切换（默认卡片） */}
          <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-sm" role="group" aria-label="显示方式">
            <button
              type="button"
              aria-pressed={displayMode === "card"}
              onClick={() => setDisplayMode("card")}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                displayMode === "card" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              卡片
            </button>
            <button
              type="button"
              aria-pressed={displayMode === "table"}
              onClick={() => setDisplayMode("table")}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                displayMode === "table" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Table2 className="h-3.5 w-3.5" />
              表格
            </button>
          </div>
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={p.searchKeyword}
              onChange={(e) => p.setSearchKeyword(e.target.value)}
              placeholder="搜索项目名 / 招标编号 / 客户医院"
              className="border-border bg-card pl-9 shadow-sm focus-visible:shadow-[var(--focus-ring)]"
            />
          </div>
          <span className="text-xs text-muted-foreground">
            共 {p.projects.length} 个项目
            {p.projectsCapped && <span className="ml-1.5 text-muted-foreground">（仅显示最近 200 个）</span>}
          </span>
        </div>

        {/* 第十一轮改造 1：近 7 天删除撤销提醒条（仅进行中视图显示，逐项撤销）。
            折叠优化：删除项目超过 3 个时默认只显示前 3 个，点「展开全部」看其余——
            避免大量删除项把项目列表顶出首屏。 */}
        {p.listView === "active" && p.recentDeleted.length > 0 && (
          <div className="mt-4 rounded-xl border border-border bg-card p-3 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-foreground">
                最近删除了 {p.recentDeleted.length} 个项目，7 天内可直接撤销：
              </p>
              {p.recentDeleted.length > 3 && (
                <button
                  type="button"
                  onClick={() => setUndoExpanded(!undoExpanded)}
                  className="text-xs text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {undoExpanded ? "收起 ▲" : `展开全部 ${p.recentDeleted.length} 项 ▼`}
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {(undoExpanded ? p.recentDeleted : p.recentDeleted.slice(0, 3)).map((rec) => (
                <span key={rec.id} className="flex items-center gap-1.5 rounded-full bg-muted py-1 pl-3 pr-1 text-xs text-muted-foreground">
                  {rec.project_name}
                  <button
                    type="button"
                    onClick={() => void p.restoreProject(rec)}
                    className="rounded-full px-2 py-0.5 font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    撤销
                  </button>
                </span>
              ))}
              {!undoExpanded && p.recentDeleted.length > 3 && (
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground/70">
                  还有 {p.recentDeleted.length - 3} 项…
                </span>
              )}
            </div>
          </div>
        )}

        {p.listLoading ? (
          <div className="mt-10 flex flex-col items-center gap-3 py-16 text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <p className="text-sm">项目列表加载中…</p>
          </div>
        ) : p.projects.length === 0 && p.searchKeyword.trim() ? (
          <div className="mt-10 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card py-16 text-center shadow-md">
            <Search className="h-9 w-9 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">没有匹配的结果</p>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              换个关键词试试，或清除搜索浏览全部投标项目
            </p>
            <Button
              variant="outline"
              onClick={() => p.setSearchKeyword("")}
              className="mt-2 border-primary/40 text-primary hover:bg-primary/10"
            >
              清除筛选
            </Button>
          </div>
        ) : p.projects.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-border bg-card py-16 text-center shadow-md">
            <FileCheck2 className="mx-auto h-9 w-9 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-foreground">
              {p.listView === "archived"
                ? "还没有归档项目"
                : p.listView === "trash"
                  ? "回收站是空的"
                  : "还没有投标项目"}
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
              {p.listView === "archived"
                ? displayMode === "table"
                  ? "在表格行的「操作」列点「归档」，完结的项目会收进这里留档，随时可取消归档"
                  : "在项目卡片上点「归档」，完结的项目会收进这里留档，随时可取消归档"
                : p.listView === "trash"
                  ? "删除的项目会先进回收站保留 30 天，期间可还原，超期自动彻底清除"
                  : "点「新建投标项目」，导入招标文件后 AI 会提取评分办法、资质要求与废标条款，帮你把标书做扎实"}
            </p>
            {p.listView === "active" && (
              <Button onClick={p.openNewDialog} variant="outline" className="mt-5 border-primary/40 text-primary hover:bg-primary/10">
                <Plus className="mr-1.5 h-4 w-4" />
                新建第一个项目
              </Button>
            )}
          </div>
        ) : displayMode === "table" ? (
          <div className="mt-5 pb-16">
            <DataTable<BidProjectRecord>
              columns={tableColumns}
              rows={p.projects}
              getRowId={(proj) => proj.id}
              onRowClick={(proj) => p.openProject(proj)}
              pageSize={20}
              emptyState="没有匹配的投标项目"
              caption="投标项目列表表格视图"
            />
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 pb-16 md:grid-cols-2 xl:grid-cols-3">
            {p.projects.map((proj) => (
              <ProjectCard
                key={proj.id}
                proj={proj}
                view={p.listView}
                onOpen={p.openProject}
                onArchive={(rec) => void p.setProjectArchived(rec, true)}
                onUnarchive={(rec) => void p.setProjectArchived(rec, false)}
                onSoftDelete={(rec) => void p.softDeleteProject(rec)}
                onRestore={(rec) => void p.restoreProject(rec)}
                onPurge={setPendingDelete}
              />
            ))}
          </div>
        )}
        <p className="sr-only">
          招标文件在浏览器本地解析，不会上传原文件
        </p>
      </section>

      <Dialog open={p.newDialogOpen} onOpenChange={(open) => { if (!open) setProjNameErr(""); p.setNewDialogOpen(open) }}>
        <DialogContent className="max-w-md rounded-2xl border-border bg-card shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">新建投标项目</DialogTitle>
            <DialogDescription>填写基本信息，创建后进入流水线导入招标文件</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="grid gap-0.5">
                  <span className="text-sm font-medium text-foreground">导入招标文件自动识别</span>
                  <span className="text-xs text-muted-foreground">
                    选招标文件（.docx / .pdf / .txt），本地识别项目名称、招标编号、客户医院、开标时间并自动填好；文件不上传，识别结果可再改
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => tenderFileRef.current?.click()}
                  disabled={metaBusy}
                  className="shrink-0 border-border text-foreground hover:text-foreground"
                >
                  {metaBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-1.5 h-4 w-4" />}
                  {metaBusy ? "识别中…" : "选择文件"}
                </Button>
              </div>
              <input
                ref={tenderFileRef}
                type="file"
                accept=".docx,.pdf,.txt,.md"
                className="hidden"
                onChange={(e) => void onPickTenderFile(e)}
              />
              {metaNote && (
                <p className={metaNote.startsWith("已识别") ? "mt-2 text-xs font-medium text-primary" : "mt-2 text-xs text-muted-foreground"}>
                  {metaNote}
                </p>
              )}
            </div>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-foreground">项目名称 <span className="text-destructive">*</span></span>
              <Input
                ref={projNameRef}
                value={p.formProjectName}
                aria-invalid={Boolean(projNameErr)}
                onChange={(e) => { p.setFormProjectName(e.target.value); if (projNameErr) setProjNameErr("") }}
                placeholder="如：市一院智慧医院信息化建设项目"
                className={projNameErr ? "border-destructive bg-background focus-visible:shadow-[var(--focus-ring)]" : "border-border bg-background focus-visible:shadow-[var(--focus-ring)]"}
              />
              {projNameErr && (
                <p role="alert" className="text-xs font-medium text-destructive">{projNameErr}</p>
              )}
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-foreground">招标编号</span>
              <Input
                value={p.formTenderNo}
                onChange={(e) => p.setFormTenderNo(e.target.value)}
                placeholder="如：ZB2026-0912"
                className="border-border bg-background focus-visible:shadow-[var(--focus-ring)]"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-foreground">客户医院</span>
              <Input
                value={p.formHospital}
                onChange={(e) => p.setFormHospital(e.target.value)}
                placeholder="如：市第一人民医院"
                className="border-border bg-background focus-visible:shadow-[var(--focus-ring)]"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-foreground">开标时间</span>
              <Input
                type="date"
                value={p.formBidOpenDate}
                onChange={(e) => p.setFormBidOpenDate(e.target.value)}
                className="border-border bg-background focus-visible:shadow-[var(--focus-ring)]"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-foreground">关联商机</span>
              <select
                value={p.formOpportunityId}
                onChange={(e) => p.setFormOpportunityId(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <option value="">暂不关联（可稍后在项目流水线头部关联）</option>
                {p.dialogOppOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.customer_name ? `${o.customer_name} · ${o.opp_name}` : o.opp_name}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                {p.dialogOppOptions.length === 0
                  ? "客户管理里还没有商机，创建后可回来关联；关联后登记投标结果将自动回流商机"
                  : "按客户医院匹配的商机排在前面；关联后登记投标结果将自动回流商机"}
                {p.oppOptionsCapped && "（仅显示最近 200 个商机）"}
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => p.setNewDialogOpen(false)} className="border-border text-muted-foreground hover:text-foreground">
              取消
            </Button>
            <Button onClick={submitCreate} disabled={p.creating} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {p.creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              创建项目
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 第十一轮改造 1：回收站「彻底删除」二次确认（不可恢复） */}
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(v) => !v && setPendingDelete(null)}
        title="彻底删除投标项目"
        description={`确定彻底删除「${pendingDelete?.project_name ?? ""}」吗？全部环节结果将一并删除，此操作不可恢复。`}
        confirmText="彻底删除"
        cancelText="再想想"
        tone="danger"
        onConfirm={() => {
          if (pendingDelete) void p.deleteProject(pendingDelete)
          setPendingDelete(null)
        }}
      />
    </main>
  )
}

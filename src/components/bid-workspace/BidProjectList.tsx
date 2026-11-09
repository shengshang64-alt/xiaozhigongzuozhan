import { useRef, useState, type ChangeEvent, type ReactNode } from "react"
import { Archive, ArchiveRestore, CalendarClock, Download, FileCheck2, LayoutGrid, Loader2, MoreHorizontal, Plus, Search, Table2, Trash2, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/common/DataStates"
import { BidReviewSummary } from "./BidReviewSummary"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { useCompanyTemplates } from "@/components/common/companyTemplates"
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
import { daysUntilLocalDay, displayStageLabel, effectiveHospital, effectiveVoidStatus, isGenTargetChapter, normalizeBidScope, type BidProjectRecord, type BidStage } from "@/pages/BidWorkspace/bidTypes"
import {
  UX_LIST_STEPS,
  UX_STEP_CIRCLE,
  archiveResultView,
  cardBarPercent,
  cardCtaLabel,
  cardFootTime,
  currentUxStep,
  draftCharCount,
  formatBudgetPhrase,
  stageBadgeClass,
  uxStepCaption,
  uxStepDone,
} from "./bidListCardModel"
import { extractTenderMeta, tenderMetaHits } from "@/pages/BidWorkspace/tenderMeta"
import { bidOpenDateDay } from "@/lib/bidOpenDay"
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

// ---------------------------------------------------------------------------
// UX-R3 S5（2026-11-08）：项目卡「卡在哪一步」一眼可见
// 原来卡片只显示「0/0 章成稿」——无大纲时这个数字既无意义也让人无从下手。
// 改为：七步微缩条（完成绿 / 当前蓝脉冲 / 未开始灰）+ 语义化状态文案。
// 数据完全由既有产物推导（与本文件 chapterProgress 及流水线 stepDone 同一套判据），零新增字段。
// ---------------------------------------------------------------------------

/** 单步完成判定：与 BidPipelineStepperEnhanced.stepDone 逐条同义（列表页不得引入组件依赖） */
function stepDoneForList(step: number, proj: BidProjectRecord): boolean {
  switch (step) {
    case 1: return (proj.tender_text ?? "").trim().length > 0
    case 2: return !!proj.parse_report
    case 3: return proj.bid_chapters.some((c) => (c.content ?? "").trim().length > 0)
    case 4: return !!proj.dup_report
    case 5: return !!proj.void_check
    case 6: return !!proj.ai_review
    case 7: return proj.stage === "archived"
    default: return false
  }
}

/** 七步微缩条：7 个小圆点横向排列 */
function StepStrip({ proj }: { proj: BidProjectRecord }) {
  const current = currentUxStep(proj, stepDoneForList)
  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      {UX_LIST_STEPS.map((s, i) => {
        const done = uxStepDone(s.step, proj, stepDoneForList)
        const isCurrent = s.step === current && !done
        return (
          <span key={s.step} className="inline-flex items-center">
            <span
              title={`${UX_STEP_CIRCLE[s.step]} ${s.title}：${done ? "已完成" : isCurrent ? "当前" : "未开始"}`}
              className={`h-1.5 w-1.5 rounded-full ${
                done
                  ? "bg-primary"
                  : isCurrent
                    ? "animate-pulse bg-primary ring-1 ring-primary/40"
                    : "bg-border"
              }`}
            />
            {i < UX_LIST_STEPS.length - 1 && <span className="h-px w-1 bg-border" />}
          </span>
        )
      })}
    </span>
  )
}

/**
 * 卡片底部的风险徽标（与原型 bid/list.html 一致）。
 *
 * 数据全真，逐项来自既有字段：
 *  · 废标风险 → void_check.items 里 status=risk 且未被人工改判的条数
 *  · 偏离未应答 → response_map.rows 里 response_level=unanswered 的条数
 *  · 评分点缺 → ai_review 里未被覆盖的评分项条数（无 ai_review 时不显示）
 *
 * 都为 0 时返回空数组（不显示空徽标，避免噪音）。
 */
function riskBadgesOf(proj: BidProjectRecord): { text: string; tone: "red" | "amber" | "orange" }[] {
  const out: { text: string; tone: "red" | "amber" | "orange" }[] = []

  // VoidStatus = compliant | partial | non_compliant；「风险」= non_compliant（人工改判优先）
  const voidRisks = (proj.void_check?.items ?? []).filter(
    (it) => effectiveVoidStatus(it) === "non_compliant",
  ).length
  if (voidRisks > 0) out.push({ text: `${voidRisks} 处废标风险`, tone: "red" })

  // ResponseLevel = full | partial | deviation | ""；空串 = 未填响应，等价于「未应答」
  const unanswered = (proj.response_map?.rows ?? []).filter(
    (r) => !r.response_level,
  ).length
  if (unanswered > 0) out.push({ text: `偏离表 ${unanswered} 条未应答`, tone: "orange" })

  return out
}

/**
 * 语义化成稿状态文案：
 *   无大纲 → 「待生成大纲」
 *   有大纲 → 「编写中 X/Y 章」（全部完成时「已成稿 X/Y 章」）
 * 回收站不显示进度（沿用旧口径）。
 */
function progressStatusLabel(proj: BidProjectRecord): string {
  const hasOutline = (proj.bid_outline?.length ?? 0) > 0 || proj.bid_chapters.some((c) => (c.title ?? "").trim().length > 0)
  if (!hasOutline) return "待生成大纲"
  const p = chapterProgress(proj)
  if (p.total === 0) return "待生成大纲"
  if (p.done >= p.total) return `已成稿 ${p.done}/${p.total} 章`
  return `编写中 ${p.done}/${p.total} 章`
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
> & {
  /**
   * 未过滤的全量项目。缺省时回退到 `projects`。
   * 列表页的数据条要按全局口径统计（不随视图/搜索变化），传它才有意义。
   */
  allProjects?: BidProjectRecord[]
}

const STAGE_BADGE: Record<BidStage, string> = {
  pending_parse: "bg-muted text-muted-foreground",
  composing: "bg-primary/10 text-primary",
  checking: "bg-warning/10 text-warning",
  evaluated: "bg-primary/10 text-primary",
  archived: "bg-muted text-muted-foreground",
}

function CountdownChip({ dateStr }: { dateStr: string }) {
  const days = daysUntilLocalDay(dateStr)
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
  const d = daysUntilLocalDay(deletedAt)
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

function CardProgressBar({ proj }: { proj: BidProjectRecord }) {
  const doneSteps = UX_LIST_STEPS.filter((s) => uxStepDone(s.step, proj, stepDoneForList)).length
  const { pct, amber } = cardBarPercent(chapterProgress(proj), doneSteps, isStuckOutline(proj))
  return (
    <div className={`mt-2 h-1.5 overflow-hidden rounded-full ${amber ? "bg-amber-100" : "bg-emerald-100"}`} aria-hidden="true">
      <i className={`block h-full rounded-full ${amber ? "bg-amber-500" : "bg-emerald-600"}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function isStuckOutline(proj: BidProjectRecord): boolean {
  return uxStepCaption(proj, stepDoneForList).startsWith("③")
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
  const riskBadges = view === "trash" ? [] : riskBadgesOf(proj)
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
      <div className="flex items-center justify-between gap-2">
        <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">标书</span>
        {view === "archived" ? (
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">已归档 · 只读留档</span>
        ) : (
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${stageBadgeClass(displayStageLabel(proj), proj.stage)}`}>
            {displayStageLabel(proj)}
          </span>
        )}
      </div>
      <h3 className="mt-2 min-w-0 truncate text-base font-semibold text-foreground">{proj.project_name}</h3>
      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
        {[proj.tender_no || null, effectiveHospital(proj) || null, formatBudgetPhrase(proj)].filter(Boolean).join(" · ") || "采购人未填写"}
      </p>
      {view !== "trash" && (
        <div className="mt-3 flex items-center gap-2">
          <StepStrip proj={proj} />
          <span className="text-xs font-medium text-muted-foreground">{uxStepCaption(proj, stepDoneForList)}</span>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {view === "trash" ? (
          <TrashRemainChip deletedAt={proj.deleted_at} />
        ) : (
          <CountdownChip dateStr={proj.bid_open_date} />
        )}
        {view !== "trash" && (
          <span className="text-xs text-muted-foreground">
            {progressStatusLabel(proj)}
            {draftCharCount(proj) > 0 ? ` · ${draftCharCount(proj).toLocaleString("zh-CN")} 字` : ""}
          </span>
        )}
      </div>
      {/* 风险徽标（与原型 bid/list.html 一致）：只在真有风险时出现，全 0 不留空行 */}
      {view !== "trash" ? (
        <CardProgressBar proj={proj} />
      ) : null}
      {view !== "trash" && riskBadges.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {riskBadges.map((b) => (
            <span
              key={b.text}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                b.tone === "red"
                  ? "bg-destructive/10 text-destructive"
                  : b.tone === "orange"
                    ? "bg-warning/10 text-warning"
                    : "bg-amber/10 text-amber"
              }`}
            >
              {b.text}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <span className="font-mono text-xs text-muted-foreground">
          {view === "trash" ? "点击可查看（还原后继续编辑）" : cardFootTime(proj, cardCtaLabel(proj, stepDoneForList))}
        </span>
        {view !== "trash" ? (
          <span className="text-xs font-medium text-primary">
            {cardCtaLabel(proj, stepDoneForList)}
          </span>
        ) : null}
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
  // UX-R3 S5：公司标准模版——从头部提示条收进「新建投标项目」下拉（惰性拉取，无模板时菜单不含该组）
  const { rows: templateRows, busyId: templateBusyId, download: downloadTemplate } = useCompanyTemplates("bid", "spec")
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
  const [focusSection, setFocusSection] = useState<"active" | "archived" | "trash">("active")
  const archivedDetailsRef = useRef<HTMLDetailsElement>(null)
  const scrollToSection = (id: "active" | "archived" | "trash") => {
    setFocusSection(id)
    if (id === "archived" && archivedDetailsRef.current) archivedDetailsRef.current.open = true
    document.getElementById(`bid-sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }
  const chapterDoneCount = (proj: BidProjectRecord) => chapterProgress(proj).done
  const chaptersColumn: DataTableColumn<BidProjectRecord> = {
    key: "chapters",
    header: "成稿章节",
    align: "right",
    sortAccessor: chapterDoneCount,
    render: (proj) => (
      <span className="text-xs text-muted-foreground">
        {progressStatusLabel(proj)}
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
      render: (proj) => (
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STAGE_BADGE[proj.stage] ?? STAGE_BADGE.pending_parse}`}>
          {displayStageLabel(proj)}
        </span>
      ),
    },
    {
      key: "bid_open_date",
      header: "开标时间",
      sortAccessor: (proj) => proj.bid_open_date,
      render: (proj) => (
        <span className="inline-flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{proj.bid_open_date || "未登记"}</span>
          <CountdownChip dateStr={proj.bid_open_date} />
        </span>
      ),
    },
    chaptersColumn,
    {
      key: "actions",
      header: "操作",
      align: "right",
      render: (proj) => (
        <span className="inline-flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <CardActionButton title="归档项目" onClick={() => void p.setProjectArchived(proj, true)}>
            <Archive className="h-4 w-4" />
          </CardActionButton>
          <CardActionButton title="删除（移入回收站）" danger onClick={() => void p.softDeleteProject(proj)}>
            <Trash2 className="h-4 w-4" />
          </CardActionButton>
        </span>
      ),
    },
  ]

  // ---- 与原型 bid/list.html 对齐的页头统计 ----
  // 全部用 allProjects（未过滤全量）：数据条是全局口径，不随视图/搜索变化
  const all = p.allProjects ?? p.projects
  const isArchivedRec = (proj: BidProjectRecord) => proj.archived === true || proj.stage === "archived"
  const activeCount = all.filter((proj) => !proj.deleted_at && !isArchivedRec(proj)).length
  const archivedCount = all.filter((proj) => !proj.deleted_at && isArchivedRec(proj)).length
  const trashCount = all.filter((proj) => !!proj.deleted_at).length
  // 本周需开标：开标日落在「今天起 7 天内」（含今天）的项目数
  const weekOpeningCount = all.filter((proj) => {
    if (proj.deleted_at) return false
    const d = daysUntilLocalDay(proj.bid_open_date)
    return d !== null && d >= 0 && d <= 7
  }).length
  // 最近更新：项目里 updated 的最大值（截到「YYYY-MM-DD HH:mm」）
  const latestUpdated = all.reduce<string>((acc, proj) => {
    const u = (proj.updated ?? "").replace(" ", "T")
    return u > acc ? u : acc
  }, "")
    .slice(0, 16)
    .replace("T", " ")

  /**
   * 已归档表格列（与原型 bid/list.html 的归档表一致）：
   * 项目名称 / 开标日 / 结果 / 中标金额 / 归档时间 / 操作。
   * 结果与金额取自 bid_result / bid_amount（归档复盘回填的真实字段）。
   */
  const archivedColumns: DataTableColumn<BidProjectRecord>[] = [
    {
      key: "name",
      header: "项目名称",
      sortAccessor: (proj) => proj.project_name ?? "",
      render: (proj) => (
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{proj.project_name}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {proj.tender_no || "无招标编号"}
            {formatBudgetPhrase(proj)
              ? ` · ${formatBudgetPhrase(proj)!.replace("预算 ", "")}预算`
              : effectiveHospital(proj)
                ? ` · ${effectiveHospital(proj)}`
                : ""}
          </div>
        </div>
      ),
    },
    {
      key: "openDate",
      header: "开标日",
      width: "112px",
      sortAccessor: (proj) => proj.bid_open_date ?? "",
      render: (proj) => <span className="font-mono text-xs">{bidOpenDateDay(proj.bid_open_date) || "—"}</span>,
    },
    {
      key: "result",
      header: "结果",
      width: "88px",
      sortAccessor: (proj) => proj.bid_result ?? "",
      render: (proj) => {
        const r = archiveResultView(proj)
        const cls =
          r.tone === "green" ? "badge-success" : r.tone === "red" ? "badge-danger" : r.tone === "gray" ? "badge-neutral bg-muted text-muted-foreground" : "badge-neutral"
        return <span className={cls}>{r.text}</span>
      },
    },
    {
      key: "amount",
      header: "中标金额",
      width: "104px",
      align: "right",
      sortAccessor: (proj) => proj.bid_amount ?? null,
      render: (proj) => (
        <span className="font-mono text-xs">
          {proj.bid_result === "won" && proj.bid_amount ? `${(proj.bid_amount / 10000).toFixed(1)} 万` : "—"}
        </span>
      ),
    },
    {
      key: "archivedAt",
      header: "归档时间",
      width: "112px",
      sortAccessor: (proj) => proj.updated ?? "",
      render: (proj) => <span className="font-mono text-xs">{(proj.updated ?? "").slice(0, 10) || "—"}</span>,
    },
    {
      key: "ops",
      header: "操作",
      width: "96px",
      align: "right",
      render: (proj) => (
        <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="outline" size="sm" onClick={() => p.openProject(proj)}>
            复盘
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" title="更多操作">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void p.setProjectArchived(proj, false)}>取消归档</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPendingDelete(proj)} className="text-destructive">
                移入回收站
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      ),
    },
  ]

  // ---- 与原型 bid/list.html 一致：归档/回收站改为「同页区块」，不再是独立视图 ----
  const activeProjects = all.filter((proj) => !proj.deleted_at && !isArchivedRec(proj))
  const archivedProjects = all.filter((proj) => !proj.deleted_at && isArchivedRec(proj))
  const trashProjects = all.filter((proj) => !!proj.deleted_at)
  const kw = p.searchKeyword.trim().toLowerCase()
  const matchKw = (proj: BidProjectRecord) => {
    if (!kw) return true
    return (
      (proj.project_name ?? "").toLowerCase().includes(kw) ||
      (proj.tender_no ?? "").toLowerCase().includes(kw) ||
      (effectiveHospital(proj) ?? "").toLowerCase().includes(kw)
    )
  }
  const shownActive = activeProjects.filter(matchKw)
  const shownArchived = archivedProjects.filter(matchKw)
  const shownTrash = trashProjects.filter(matchKw)

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
              {/* 与原型 bid/list.html 对齐：标题带「进行中 N」徽标 + 一行 meta */}
              <h1 className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
                投标项目
                {activeCount > 0 ? (
                  <span className="rounded-full bg-info/10 px-2.5 py-0.5 text-xs font-semibold text-info">
                    进行中 {activeCount}
                  </span>
                ) : null}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                每张卡片直接告诉你这个项目<b className="text-foreground">卡在七步的哪一步</b>，而不是进去才发现。七步各自独立成屏，点步骤可直接跳到对应工作面。
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span>
                  本周需开标 <b className="font-semibold text-foreground">{weekOpeningCount}</b> 个
                </span>
                {latestUpdated ? (
                  <span>
                    最近更新 <b className="font-mono text-foreground">{latestUpdated}</b>
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={handleExportBids}
                disabled={p.projects.length === 0}
                className="shadow-sm"
              >
                <Download className="mr-1.5 h-4 w-4" />
                导出 CSV
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" title="模板与工具" aria-label="模板与工具" className="shadow-sm">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">模板与工具</div>
                  {templateRows.length === 0 ? (
                    <DropdownMenuItem disabled>暂无已导入的模板</DropdownMenuItem>
                  ) : (
                    templateRows.map((r) => (
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
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                onClick={p.openNewDialog}
                className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
              >
                <Plus className="mr-1.5 h-4 w-4" />
                新建投标项目
              </Button>
            </div>
          </div>
        </header>

        {/* 与原型 bid/list.html 对齐：页头下方先是一条数据条 */}
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-card px-4 py-2.5 text-xs shadow-sm">
          <span className="text-info">
            进行中 <b className="ml-1 font-mono text-sm font-semibold">{activeCount}</b>
          </span>
          <span className="text-muted-foreground">
            已归档 <b className="ml-1 font-mono text-sm font-semibold text-foreground">{archivedCount}</b>
          </span>
          <span className="text-muted-foreground">
            回收站 <b className="ml-1 font-mono text-sm font-semibold text-foreground">{trashCount}</b>
          </span>
          <span className={weekOpeningCount > 0 ? "text-destructive" : "text-muted-foreground"}>
            本周需开标 <b className="ml-1 font-mono text-sm font-semibold">{weekOpeningCount}</b>
          </span>
          <span className="ml-auto text-muted-foreground">
            共 <b className="ml-1 font-mono text-sm font-semibold text-foreground">{all.length}</b> 个项目
          </span>
        </div>

        {/* 筛选栏顺序与原型一致：搜索 → 视图 chips → 显示方式 */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={p.searchKeyword}
              onChange={(e) => p.setSearchKeyword(e.target.value)}
              placeholder="搜索项目名 / 招标编号 / 客户医院"
              className="border-border bg-card pl-9 shadow-sm focus-visible:shadow-[var(--focus-ring)]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="定位区块">
            {([
              ["active", "进行中", activeCount],
              ["archived", "已归档", archivedCount],
              ["trash", "回收站", trashCount],
            ] as const).map(([id, label, n]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={focusSection === id}
                onClick={() => scrollToSection(id)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  focusSection === id
                    ? "border-primary/40 bg-primary/10 font-medium text-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
                <span className="font-mono">{n}</span>
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">视图</span>
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
        </div>

        {/* 第十一轮改造 1：近 7 天删除撤销提醒条（仅进行中视图显示，逐项撤销）。
            折叠优化：删除项目超过 3 个时默认只显示前 3 个，点「展开全部」看其余——
            避免大量删除项把项目列表顶出首屏。 */}
        {p.recentDeleted.length > 0 && (
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

        <div id="bid-sec-active">
        {p.listLoading ? (
          <div className="mt-10 flex flex-col items-center gap-3 py-16 text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <p className="text-sm">项目列表加载中…</p>
          </div>
        ) : shownActive.length === 0 && p.searchKeyword.trim() ? (
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
        ) : shownActive.length === 0 ? (
          <EmptyState
            className="mt-10"
            icon={<FileCheck2 className="mx-auto h-9 w-9 text-muted-foreground" />}
            title="还没有投标项目"
            hint="点「新建投标项目」，导入招标文件后 AI 会提取评分办法、资质要求与废标条款，帮你把标书做扎实"
            action={
              <Button onClick={p.openNewDialog} variant="outline" className="border-primary/40 text-primary hover:bg-primary/10">
                <Plus className="mr-1.5 h-4 w-4" />
                新建第一个项目
              </Button>
            }
          />
        ) : displayMode === "table" ? (
          <div className="mt-5">
            <DataTable<BidProjectRecord>
              columns={tableColumns}
              rows={shownActive}
              getRowId={(proj) => proj.id}
              onRowClick={(proj) => p.openProject(proj)}
              pageSize={20}
              emptyState="没有匹配的投标项目"
              caption="投标项目列表表格视图"
            />
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shownActive.map((proj) => (
              <ProjectCard
                key={proj.id}
                proj={proj}
                view="active"
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
        </div>
        {/* 复盘汇总：与原型一致放在主列表之后（无已结束项目时收敛为一行提示） */}
        <div className="mt-6">
          <BidReviewSummary projects={all} />
        </div>

        {/* ---------- 已归档：折叠区（与原型 bid/list.html 一致，同页展示） ---------- */}
        <details ref={archivedDetailsRef} id="bid-sec-archived" className="mt-6 rounded-xl border border-border bg-card shadow-md">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-sm hover:bg-secondary/40">
              <Archive className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-foreground">已归档</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {shownArchived.length}
              </span>
              <span className="text-xs text-muted-foreground">归档后只读，可复用到新项目</span>
              <span className="ml-auto text-xs text-muted-foreground">展开 / 收起</span>
            </summary>
            <div className="border-t border-border">
              <DataTable<BidProjectRecord>
                columns={archivedColumns}
                rows={shownArchived}
                getRowId={(proj) => proj.id}
                onRowClick={(proj) => p.openProject(proj)}
                pageSize={20}
                emptyState="没有归档项目"
                caption="已归档投标项目"
              />
            </div>
        </details>

        {/* ---------- 回收站：卡片（与原型一致，同页展示） ---------- */}
        <section id="bid-sec-trash" className="mt-6 rounded-xl border border-border bg-card shadow-md">
          <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">回收站</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {shownTrash.length}
            </span>
            <span className="text-xs text-muted-foreground">删除的项目保留 30 天，可恢复</span>
          </header>
          {shownTrash.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 px-5 py-10 text-center">
              <Trash2 className="h-7 w-7 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">回收站是空的</p>
              <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                删除的投标项目会在这里保留 30 天，期间可随时恢复；归档项目不进回收站。
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={p.openNewDialog}
              >
                ＋ 导入新招标
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {shownTrash.map((proj) => (
                <li key={proj.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{proj.project_name}</span>
                  <TrashRemainChip deletedAt={proj.deleted_at} />
                  <Button variant="ghost" size="sm" onClick={() => void p.restoreProject(proj)}>
                    <Undo2 className="mr-1 h-3.5 w-3.5" /> 还原
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setPendingDelete(proj)}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> 彻底删除
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

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

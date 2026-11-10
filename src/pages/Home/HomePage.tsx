import { useContext, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { ChevronDown } from "lucide-react"
import { ActiveWorkSection } from "@/components/home/ActiveWorkSection"
import { ActivityFeedSection } from "@/components/home/ActivityFeedSection"
import { BidNodesCard } from "@/components/home/BidNodesCard"
import { BidReviewCard } from "@/components/home/BidReviewCard"
import { OppsCard } from "@/components/home/CustomerOverviewSection"
import { CompactProgressPanel } from "@/components/home/CompactProgressPanel"
import { CompactWelcomeBar } from "@/components/home/CompactWelcomeBar"
import { FollowUpReminderCard } from "@/components/home/FollowUpReminderCard"
import { FunnelCard } from "@/components/home/FunnelCard"
import { HomeSubtabs } from "@/components/home/HomeSubtabs"
import { IntelSection } from "@/components/home/IntelSection"
import { MustSeeTodayBar } from "@/components/home/MustSeeTodayBar"
import { NewKeyMetrics } from "@/components/home/NewKeyMetrics"
import { PriorityTasksBoard } from "@/components/home/PriorityTasksBoard"
import { ProjectsSection } from "@/components/home/ProjectsSection"
import { QuickActionButtons } from "@/components/home/QuickActionButtons"
import { StatsRow } from "@/components/home/StatsRow"
import { TodoCard } from "@/components/home/TodoCard"
import { ShellAccountContext } from "@/components/shell/WorkbenchShell"
import {
  eventsTodayOf,
  keyMetricsOf,
  nearestDeadlineOf,
  priorityTasksOf,
  todayStartMs,
} from "./homeLayout"
import { parseHomeTab } from "./homeTabs"
import type { useHome } from "./useHome"

// ---------------------------------------------------------------------------
// UX-v2（prototype/home/ 四屏）：原首页 14 个区块竖排约 2958px、投标节点与复盘被折进
// 「更多模块」里看不见——拆成四个屏内 Tab（?tab= 切换，口径见 homeTabs.ts）：
//   总览     = 欢迎条 + 关键预警 + 今日优先任务 + 进行中事项 + 该唤醒的商机 + 快捷入口；
//              非原型区块（商机概览 / 团队动态 / 情报摘要 / 进行中全量）收进底部折叠区
//              「更多首页模块」，新建投标项目与项目详情弹窗（ProjectsSection）常驻挂载，
//              保证从优先任务/预警点「去处理」时详情弹窗一定在。
//   待办中心 = 全部待办分桶（逾期/今天/明天/本周/无日期）+ 增删改 + 今日必看全量；
//   投标节点 = 未来 60 天开标/截标节点（BidNodesCard 自拉取，紧急度分档 + 补录提示）；
//   投标复盘 = 商机漏斗 + 胜负复盘（有真结果才出数据，空态由卡片自带，不造中标率）。
// 零破坏性约束：所有模块一个不删，只在四个 Tab 间重新归位。
// ---------------------------------------------------------------------------

/** 总览底部折叠区里的非原型模块：原样保留，不给总览首屏添堵 */
function MoreHomeModules(p: ReturnType<typeof useHome>) {
  return (
    <div className="space-y-5 p-4">
      <OppsCard stats={p.crmStats} recentOpps={p.crmRecentOpps} loading={p.crmLoading} />
      <ActiveWorkSection items={p.activeWork} loading={p.activeWorkLoading} total={p.activeWorkTotal} />
      <ActivityFeedSection events={p.activityEvents} loading={p.activityLoading} />
      <IntelSection intelItems={p.intelItems} intelLoading={p.intelLoading} />
    </div>
  )
}

function OverviewTab(p: ReturnType<typeof useHome>) {
  const shellAccount = useContext(ShellAccountContext)
  const displayName = shellAccount?.displayName ?? p.accountInfo?.displayName ?? null
  const todayLabel = new Date().toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  })
  const [moreOpen, setMoreOpen] = useState(false)

  // 首屏派生数据（纯函数见 homeLayout.ts，可单测）；时钟用 useHome 的 30s 心跳 nowTick，
  // 不在渲染期直接调 Date.now()（react-hooks/purity 约束，且与待办分桶的口径同源）
  const { nowTick } = p
  const deadline = useMemo(() => nearestDeadlineOf(p.projects, todayStartMs(nowTick)), [p.projects, nowTick])
  const metrics = useMemo(() => keyMetricsOf(p.qualRisk, p.intelPendingCount, deadline), [p.qualRisk, p.intelPendingCount, deadline])
  const priorityTasks = useMemo(() => priorityTasksOf(p.mustSee, 3), [p.mustSee])
  const todayEvents = useMemo(() => eventsTodayOf(p.activityEvents, nowTick), [p.activityEvents, nowTick])

  return (
    <>
      <CompactWelcomeBar
        dateLabel={todayLabel}
        greeting={p.greeting}
        displayName={displayName}
        summaryLines={[
          p.overdueTodoCount > 0 ? `${p.overdueTodoCount} 条待办已逾期` : "",
          p.intelPendingCount > 0 ? `${p.intelPendingCount} 条情报待确认` : "",
          p.qualRisk.urgent > 0 ? `资质${p.qualRisk.line}（投标核验）` : "",
        ].filter(Boolean)}
      />

      <NewKeyMetrics
        metrics={metrics}
        loading={p.crmLoading && p.intelLoading}
        onOpenDeadlineProject={() => {
          if (deadline) {
            const project = p.projects.find((pr) => pr.id === deadline.projectId)
            if (project) p.openProjectDetail(project)
          }
        }}
      />

      <PriorityTasksBoard
        tasks={priorityTasks}
        total={p.mustSee.total}
        loading={p.todosLoading || p.crmLoading || p.projectsLoading}
        onOpenProject={(task) => {
          if (task.project) p.openProjectDetail(task.project)
        }}
      />

      <CompactProgressPanel
        activeWork={p.activeWork}
        activeWorkTotal={p.activeWorkTotal}
        activeWorkLoading={p.activeWorkLoading}
        todayEvents={todayEvents}
        eventsLoading={p.activityLoading}
      />

      {/* 原型右列「快捷入口」：待办速记 + 常用动作（既有能力，位置不变） */}
      <QuickActionButtons
        todoInput={p.todoInput}
        setTodoInput={p.setTodoInput}
        todoDueDate={p.todoDueDate}
        setTodoDueDate={p.setTodoDueDate}
        addTodo={p.addTodo}
        todoAdding={p.todoAdding}
      />

      {/* 原型「该唤醒的商机」：超期未跟进商机提醒（真数据，来自客户管理口径） */}
      <FollowUpReminderCard items={p.followDueOpps} loading={p.crmLoading} />

      {/* 原有非原型模块整体折叠：展开即回看商机概览 / 动态 / 情报，零功能损失 */}
      <section className="mb-5 rounded-xl border border-border bg-card shadow-md">
        <button
          type="button"
          onClick={() => setMoreOpen((prev) => !prev)}
          aria-expanded={moreOpen}
          className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <ChevronDown className={`h-4 w-4 transition-transform ${moreOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">更多首页模块</span>
            <span className="block truncate text-xs text-muted-foreground">商机概览 · 进行中全量 · 团队动态 · 情报摘要</span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{moreOpen ? "收起" : "展开"}</span>
        </button>
        {moreOpen ? <MoreHomeModules {...p} /> : null}
      </section>

      {/* 新建投标项目 + 项目详情弹窗挂载点：必须常驻，折叠区收起时优先任务仍能打开详情 */}
      <ProjectsSection
        projects={p.projects}
        projectsLoading={p.projectsLoading}
        projectsCapped={p.projectsCapped}
        newProjectOpen={p.newProjectOpen}
        openNewProject={p.openNewProject}
        closeNewProject={p.closeNewProject}
        projectForm={p.projectForm}
        setProjectField={p.setProjectField}
        submitProject={p.submitProject}
        savingProject={p.savingProject}
        selectedProject={p.selectedProject}
        openProjectDetail={p.openProjectDetail}
        closeProjectDetail={p.closeProjectDetail}
        progressDraft={p.progressDraft}
        setProgressDraft={p.setProgressDraft}
        notesDraft={p.notesDraft}
        setNotesDraft={p.setNotesDraft}
        saveProjectDetail={p.saveProjectDetail}
        savingDetail={p.savingDetail}
      />
    </>
  )
}

/** 待办中心：统计行（真值）+ 分桶待办（增删改）+ 今日必看全量（按来源分组） */
function TodosTab(p: ReturnType<typeof useHome>) {
  return (
    <>
      <StatsRow
        activeWorkCount={p.activeWorkTotal}
        activeWorkByKind={p.activeWorkByKind}
        activeWorkTruncated={p.activeWorkTruncated}
        activeWorkCaveat={p.activeWorkCaveat}
        pendingTodoCount={p.pendingTodoCount}
        doneTodoCount={p.doneTodoCount}
        overdueTodoCount={p.overdueTodoCount}
      />
      <TodoCard
        buckets={p.todoBuckets}
        todosLoading={p.todosLoading}
        todoInput={p.todoInput}
        setTodoInput={p.setTodoInput}
        todoDueDate={p.todoDueDate}
        setTodoDueDate={p.setTodoDueDate}
        addTodo={p.addTodo}
        todoAdding={p.todoAdding}
        toggleTodo={p.toggleTodo}
        deleteTodo={p.deleteTodo}
        pendingTodoCount={p.pendingTodoCount}
        overdueTodoCount={p.overdueTodoCount}
        todosCapped={p.todosCapped}
      />
      <div className="mt-5">
        <MustSeeTodayBar
          data={p.mustSee}
          loading={p.todosLoading || p.crmLoading || p.projectsLoading}
          onOpenProject={p.openProjectDetail}
        />
      </div>
    </>
  )
}

/** 投标节点：未来 60 天开标/截标时间轴（组件自持拉取，紧急度分档 + 未填开标时间补录提示） */
function CalendarTab() {
  return (
    <>
      <BidNodesCard />
      {/* BidNodesCard 拉取失败时会整卡隐藏（hidden），这里给一行兜底出口，避免本屏空白无解释 */}
      <BidNodesCardFallbackNote />
    </>
  )
}

/** BidNodesCard 失败即自隐，兜底说明写在卡外，保证「投标节点」屏永不死白 */
function BidNodesCardFallbackNote() {
  return (
    <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
      这里汇总各投标项目的开标 / 截标日期（数据来自投标工作台项目档案）。如果上方没有内容：
      项目尚未填开标时间，或列表暂时拉取失败——去「标书工作台 · ① 导入招标」补录开标时间后，节点会自动出现在这里。
    </p>
  )
}

/** 投标复盘：商机漏斗 + 胜负复盘。数据全 0 时两张卡自带空态，不画空图不造中标率 */
function ReviewTab(p: ReturnType<typeof useHome>) {
  return (
    <>
      <FunnelCard data={p.oppFunnel} total={p.oppFunnelTotal} loading={p.crmLoading} />
      <div className="mt-5">
        <BidReviewCard review={p.bidReview} loading={p.crmLoading} />
      </div>
    </>
  )
}

export function HomePage(p: ReturnType<typeof useHome>) {
  const [searchParams] = useSearchParams()
  const tab = parseHomeTab(searchParams.get("tab"))

  return (
    <div className="animate-in fade-in duration-500 text-foreground">
      <HomeSubtabs active={tab} />

      {tab === "todos" ? (
        <TodosTab {...p} />
      ) : tab === "calendar" ? (
        <CalendarTab />
      ) : tab === "review" ? (
        <ReviewTab {...p} />
      ) : (
        <OverviewTab {...p} />
      )}
    </div>
  )
}

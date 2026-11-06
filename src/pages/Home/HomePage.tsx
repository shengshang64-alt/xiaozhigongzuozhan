import { useContext, useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"
import { ActiveWorkSection } from "@/components/home/ActiveWorkSection"
import { ActivityFeedSection } from "@/components/home/ActivityFeedSection"
import { BidReviewCard } from "@/components/home/BidReviewCard"
import { OppsCard } from "@/components/home/CustomerOverviewSection"
import { CompactProgressPanel } from "@/components/home/CompactProgressPanel"
import { CompactWelcomeBar } from "@/components/home/CompactWelcomeBar"
import { FollowUpReminderCard } from "@/components/home/FollowUpReminderCard"
import { FunnelCard } from "@/components/home/FunnelCard"
import { IntelSection } from "@/components/home/IntelSection"
import { BidNodesCard } from "@/components/home/BidNodesCard"
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
import type { useHome } from "./useHome"

// ---------------------------------------------------------------------------
// Phase 1 改版（UI/UX 升级，docs/AI-Implementation-Specification-v2.md 任务 1.1）：
// 首屏只保留 5 个核心模块（欢迎条 / 关键指标 / 优先任务 / 快捷操作 / 进度速览），
// 目标首屏高度 ≤1200px（原 14 卡竖排约 2958px）。
//
// 零破坏性约束：原有 11 个模块一个不删——全部原样收进底部「更多工作台模块」折叠区
// （默认收起，展开即回到改版前的完整首页，含待办增删改与项目详情弹框等全部功能）。
// 今日必看条（MustSeeTodayBar）与新的优先任务看板同源（mustSee），前者保留在折叠区
// 兜底展示全部行动项，后者只取前 3 项强聚焦。
// ---------------------------------------------------------------------------

/** 折叠区里的原有模块：按改版前的页面顺序原样保留 */
function MoreWorkbenchModules(p: ReturnType<typeof useHome>) {
  return (
    <div className="space-y-5 p-4">
      <MustSeeTodayBar
        data={p.mustSee}
        loading={p.todosLoading || p.crmLoading || p.projectsLoading}
        onOpenProject={p.openProjectDetail}
      />
      <BidNodesCard />
      <StatsRow
        activeWorkCount={p.activeWorkTotal}
        activeWorkByKind={p.activeWorkByKind}
        activeWorkTruncated={p.activeWorkTruncated}
        activeWorkCaveat={p.activeWorkCaveat}
        pendingTodoCount={p.pendingTodoCount}
        doneTodoCount={p.doneTodoCount}
        overdueTodoCount={p.overdueTodoCount}
      />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <FunnelCard data={p.oppFunnel} total={p.oppFunnelTotal} loading={p.crmLoading} />
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
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <OppsCard stats={p.crmStats} recentOpps={p.crmRecentOpps} loading={p.crmLoading} />
        <FollowUpReminderCard items={p.followDueOpps} loading={p.crmLoading} />
      </div>
      <BidReviewCard review={p.bidReview} loading={p.crmLoading} />
      <ActivityFeedSection events={p.activityEvents} loading={p.activityLoading} />
      <IntelSection intelItems={p.intelItems} intelLoading={p.intelLoading} />
      <ActiveWorkSection items={p.activeWork} loading={p.activeWorkLoading} total={p.activeWorkTotal} />
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
    </div>
  )
}

export function HomePage(p: ReturnType<typeof useHome>) {
  const shellAccount = useContext(ShellAccountContext)
  const displayName = shellAccount?.displayName ?? p.accountInfo?.displayName ?? null
  const todayLabel = new Date().toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  })

  // 折叠区默认收起：改版后首屏高度预算的关键开关
  const [moreOpen, setMoreOpen] = useState(false)

  // 首屏 5 模块的派生数据（纯函数见 homeLayout.ts，可单测）；时钟用 useHome 的 30s 心跳 nowTick，
  // 不在渲染期直接调 Date.now()（react-hooks/purity 约束，且与待办分桶的口径同源）
  const { nowTick } = p
  const deadline = useMemo(() => nearestDeadlineOf(p.projects, todayStartMs(nowTick)), [p.projects, nowTick])
  const metrics = useMemo(() => keyMetricsOf(p.qualRisk, p.intelPendingCount, deadline), [p.qualRisk, p.intelPendingCount, deadline])
  const priorityTasks = useMemo(() => priorityTasksOf(p.mustSee, 3), [p.mustSee])
  const todayEvents = useMemo(() => eventsTodayOf(p.activityEvents, nowTick), [p.activityEvents, nowTick])

  return (
    <div className="animate-in fade-in duration-500 text-foreground">
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

      <QuickActionButtons
        todoInput={p.todoInput}
        setTodoInput={p.setTodoInput}
        todoDueDate={p.todoDueDate}
        setTodoDueDate={p.setTodoDueDate}
        addTodo={p.addTodo}
        todoAdding={p.todoAdding}
      />

      <CompactProgressPanel
        activeWork={p.activeWork}
        activeWorkTotal={p.activeWorkTotal}
        activeWorkLoading={p.activeWorkLoading}
        todayEvents={todayEvents}
        eventsLoading={p.activityLoading}
      />

      {/* 原有 11 个模块整体折叠：展开即回到改版前首页，零功能损失 */}
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
            <span className="block text-sm font-semibold text-foreground">更多工作台模块</span>
            <span className="block truncate text-xs text-muted-foreground">
              今日必看 · 投标节点 · 商机漏斗 · 待办 · 项目跟进 · 团队动态 · 情报摘要
            </span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{moreOpen ? "收起" : "展开"}</span>
        </button>
        {moreOpen ? <MoreWorkbenchModules {...p} /> : null}
      </section>
    </div>
  )
}

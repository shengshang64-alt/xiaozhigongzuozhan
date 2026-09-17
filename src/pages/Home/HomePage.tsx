import { useContext } from "react"
import { ActivityFeedSection } from "@/components/home/ActivityFeedSection"
import { BidReviewCard } from "@/components/home/BidReviewCard"
import { OppsCard } from "@/components/home/CustomerOverviewSection"
import { FollowUpReminderCard } from "@/components/home/FollowUpReminderCard"
import { IntelSection } from "@/components/home/IntelSection"
import { ProjectsSection } from "@/components/home/ProjectsSection"
import { StatsRow } from "@/components/home/StatsRow"
import { TodoCard } from "@/components/home/TodoCard"
import { WelcomeBanner } from "@/components/home/WelcomeBanner"
import { ShellAccountContext } from "@/components/shell/WorkbenchShell"
import type { useHome } from "./useHome"

export function HomePage(p: ReturnType<typeof useHome>) {
  const shellAccount = useContext(ShellAccountContext)
  const displayName = shellAccount?.displayName ?? p.accountInfo?.displayName ?? null
  const todayLabel = new Date().toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  })

  return (
    <div className="animate-in fade-in duration-500 text-foreground">
      <WelcomeBanner
        dateLabel={todayLabel}
        greeting={p.greeting}
        displayName={displayName}
      />

      <StatsRow
        activeProjectCount={p.activeProjectCount}
        activeProjectsCapped={p.projectsCapped}
        pendingTodoCount={p.pendingTodoCount}
        doneTodoCount={p.doneTodoCount}
        overdueTodoCount={p.overdueTodoCount}
      />

      <div className="mb-5 grid items-start gap-4 lg:grid-cols-2">
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
        <OppsCard
          stats={p.crmStats}
          recentOpps={p.crmRecentOpps}
          loading={p.crmLoading}
        />
      </div>

      <FollowUpReminderCard items={p.followDueOpps} loading={p.crmLoading} />

      <BidReviewCard review={p.bidReview} loading={p.crmLoading} />

      <ActivityFeedSection events={p.activityEvents} loading={p.activityLoading} />

      <IntelSection intelItems={p.intelItems} intelLoading={p.intelLoading} />

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

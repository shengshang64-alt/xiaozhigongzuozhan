import { Building2, CalendarDays, FolderOpen, Loader2, Plus, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { PROJECT_TYPES, type ProjectForm, type ProjectItem } from "@/pages/Home/useHome"

type ProjectsSectionProps = {
  projects: ProjectItem[]
  projectsLoading: boolean
  projectsCapped: boolean
  newProjectOpen: boolean
  openNewProject: () => void
  closeNewProject: () => void
  projectForm: ProjectForm
  setProjectField: <K extends keyof ProjectForm>(key: K, value: ProjectForm[K]) => void
  submitProject: () => void
  savingProject: boolean
  selectedProject: ProjectItem | null
  openProjectDetail: (item: ProjectItem) => void
  closeProjectDetail: () => void
  progressDraft: number
  setProgressDraft: (value: number) => void
  notesDraft: string
  setNotesDraft: (value: string) => void
  saveProjectDetail: () => void
  savingDetail: boolean
}

const inputClass =
  "h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"

function typeBadgeClass(projectType: string): string {
  // 徽标语义档（全站设计规范 v1）：方案=主色档，其余=中性档
  return projectType === "方案"
    ? "bg-primary/10 text-primary"
    : "bg-muted text-muted-foreground"
}

function formatDeadline(deadline: string): string {
  if (!deadline) return "未设置截止日期"
  return `截止 ${deadline.slice(0, 10)}`
}

export function ProjectsSection({
  projects,
  projectsLoading,
  projectsCapped,
  newProjectOpen,
  openNewProject,
  closeNewProject,
  projectForm,
  setProjectField,
  submitProject,
  savingProject,
  selectedProject,
  openProjectDetail,
  closeProjectDetail,
  progressDraft,
  setProgressDraft,
  notesDraft,
  setNotesDraft,
  saveProjectDetail,
  savingDetail,
}: ProjectsSectionProps) {
  return (
    <section className="pb-8">
      <header className="flex min-h-14 items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <FolderOpen className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground">我的项目跟进清单</h2>
            <p className="truncate text-xs text-muted-foreground">手工登记的跟进事项，进度随时可改；各工作台在制项目见上方聚合卡</p>
          </div>
        </div>
        <button
          type="button"
          onClick={openNewProject}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-md transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Plus className="h-4 w-4" />
          新增项目
        </button>
      </header>

      {projectsLoading ? (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-border bg-card py-12 text-sm text-muted-foreground shadow-md">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          项目加载中…
        </div>
      ) : projects.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card py-14 text-center shadow-md">
          <FolderOpen className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            还没有登记跟进事项
          </p>
          <p className="text-xs text-muted-foreground">
            项目按方案 / 标书 / PPT / 报价分类跟进，进度随时可改
          </p>
          <button
            type="button"
            onClick={openNewProject}
            className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-md border border-primary/40 px-4 text-sm font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Plus className="h-4 w-4" />
            新增第一个项目
          </button>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openProjectDetail(item)}
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5 text-left shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold leading-snug text-foreground">{item.project_name}</p>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${typeBadgeClass(item.project_type)}`}>
                  {item.project_type}
                </span>
              </div>
              <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  {item.hospital || "未填写客户医院"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                  {formatDeadline(item.deadline)}
                </span>
              </div>
              <div className="mt-auto">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">进度</span>
                  <span className="font-semibold text-primary">{item.progress}%</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, item.progress))}%` }}
                  />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* T2.1：拉满 200 条视为可能截断，底部提示行（与 todos capped 同模式） */}
      {projectsCapped && !projectsLoading && projects.length > 0 ? (
        <p className="pt-3 text-center text-xs text-muted-foreground">仅显示最近 200 个项目</p>
      ) : null}

      {/* 新增项目 */}
      <Dialog open={newProjectOpen} onOpenChange={(open) => !open && closeNewProject()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新增项目</DialogTitle>
            <DialogDescription>填写项目基本信息，创建后可随时在卡片上查看与调整</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">项目名称</label>
              <input
                value={projectForm.projectName}
                onChange={(e) => setProjectField("projectName", e.target.value)}
                placeholder="如：某市人民医院智慧病房方案"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">项目类型</label>
              <div className="flex flex-wrap gap-2">
                {PROJECT_TYPES.map((typeOption) => (
                  <button
                    key={typeOption}
                    type="button"
                    onClick={() => setProjectField("projectType", typeOption)}
                    className={
                      projectForm.projectType === typeOption
                        ? "rounded-full border border-primary bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary"
                        : "rounded-full border border-border bg-background px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    }
                  >
                    {typeOption}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">客户医院</label>
                <input
                  value={projectForm.hospital}
                  onChange={(e) => setProjectField("hospital", e.target.value)}
                  placeholder="如：某市人民医院"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">截止日期</label>
                <input
                  type="date"
                  value={projectForm.deadline}
                  onChange={(e) => setProjectField("deadline", e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">备注</label>
              <textarea
                value={projectForm.notes}
                onChange={(e) => setProjectField("notes", e.target.value)}
                placeholder="项目背景、关键节点等（可选）"
                rows={3}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pb-1">
            <button
              type="button"
              onClick={closeNewProject}
              className="inline-flex h-10 items-center rounded-md border border-border bg-background px-4 text-sm font-medium text-card-foreground shadow-sm transition-colors hover:bg-secondary"
            >
              取消
            </button>
            <button
              type="button"
              onClick={submitProject}
              disabled={savingProject}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-md transition-transform hover:scale-105 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {savingProject ? "创建中…" : "创建项目"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 项目详情 */}
      <Dialog open={Boolean(selectedProject)} onOpenChange={(open) => !open && closeProjectDetail()}>
        <DialogContent className="sm:max-w-md">
          {selectedProject && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 pr-8">
                  <span className="truncate">{selectedProject.project_name}</span>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${typeBadgeClass(selectedProject.project_type)}`}>
                    {selectedProject.project_type}
                  </span>
                </DialogTitle>
                <DialogDescription>
                  {selectedProject.hospital || "未填写客户医院"} · {formatDeadline(selectedProject.deadline)}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-5 py-2">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">项目进度</label>
                    <span className="text-sm font-bold text-primary">{progressDraft}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={progressDraft}
                    onChange={(e) => setProgressDraft(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${progressDraft}%` }}
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">备注</label>
                  <textarea
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    placeholder="记录项目进展、关键沟通结论…"
                    rows={4}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 pb-1">
                <button
                  type="button"
                  onClick={closeProjectDetail}
                  className="inline-flex h-10 items-center gap-1 rounded-md border border-border bg-background px-4 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                  关闭
                </button>
                <button
                  type="button"
                  onClick={saveProjectDetail}
                  disabled={savingDetail}
                  className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-md transition-transform hover:scale-105 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {savingDetail ? "保存中…" : "保存修改"}
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}

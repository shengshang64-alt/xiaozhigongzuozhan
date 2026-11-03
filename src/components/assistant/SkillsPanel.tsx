import { useState } from "react"
import { Check, Loader2, Pencil, Plus, Trash2, Wand2 } from "lucide-react"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { PRESET_SKILLS, type SkillRow } from "@/lib/assistantCore"
import { normalizeScopes, SCOPE_CATALOG, scopeLabel } from "@/lib/skillCore"

type SkillsPanelProps = {
  customSkills: SkillRow[]
  onInvoke: (skillName: string, template: string) => void
  onAdd: (skillName: string, template: string, scopes: string[], description: string) => Promise<boolean>
  onUpdate: (row: SkillRow, skillName: string, template: string, scopes: string[], description: string) => Promise<boolean>
  onDelete: (row: SkillRow) => void
}

export function SkillsPanel({ customSkills, onInvoke, onAdd, onUpdate, onDelete }: SkillsPanelProps) {
  const [formOpen, setFormOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<SkillRow | null>(null)
  const [formName, setFormName] = useState("")
  const [formTemplate, setFormTemplate] = useState("")
  const [formDesc, setFormDesc] = useState("")
  const [formScopes, setFormScopes] = useState<string[]>(["assistant"])
  const [pendingDeleteSkill, setPendingDeleteSkill] = useState<SkillRow | null>(null)
  const [formBusy, setFormBusy] = useState(false)

  const openAdd = () => {
    setEditingRow(null)
    setFormName("")
    setFormTemplate("")
    setFormDesc("")
    setFormScopes(["assistant"])
    setFormOpen(true)
  }

  const openEdit = (row: SkillRow) => {
    setEditingRow(row)
    setFormName(row.skill_name)
    setFormTemplate(row.prompt_template)
    setFormDesc(row.description ?? "")
    setFormScopes(normalizeScopes(row.applicable_scopes))
    setFormOpen(true)
  }

  const toggleScope = (scope: string) => {
    setFormScopes((prev) => (prev.includes(scope) ? prev.filter((v) => v !== scope) : [...prev, scope]))
  }

  const submitForm = async () => {
    if (formBusy) return
    setFormBusy(true)
    try {
      const ok = editingRow
        ? await onUpdate(editingRow, formName, formTemplate, formScopes, formDesc)
        : await onAdd(formName, formTemplate, formScopes, formDesc)
      if (ok) {
        setFormOpen(false)
        setEditingRow(null)
      }
    } finally {
      setFormBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        <section className="mb-4">
          <header className="mb-1.5 flex items-center gap-1.5">
            <Wand2 className="h-3.5 w-3.5 text-primary" />
            <h4 className="text-xs font-semibold text-foreground">预置技能</h4>
          </header>
          <div className="flex flex-col gap-1.5">
            {PRESET_SKILLS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onInvoke(s.name, s.template)}
                className="rounded-lg border border-border bg-background px-2.5 py-2 text-left shadow-sm transition-all hover:scale-[1.02] hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <p className="text-xs font-semibold text-foreground">{s.name}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
                <p className="mt-1 flex flex-wrap gap-1">
                  {s.scopes.map((sc) => (
                    <span
                      key={sc}
                      className="rounded-full bg-primary/10 px-1.5 py-0.5 text-xs leading-none text-primary"
                    >
                      {scopeLabel(sc)}
                    </span>
                  ))}
                </p>
              </button>
            ))}
          </div>
        </section>

        <section>
          <header className="mb-1.5 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-foreground">我的自定义指令</h4>
            <button
              type="button"
              onClick={openAdd}
              className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Plus className="h-3 w-3" />
              新增
            </button>
          </header>

          {formOpen ? (
            <div className="mb-2 rounded-lg border border-border bg-background p-2.5 shadow-sm">
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="指令名称，例如：竞品对比速查"
                aria-label="指令名称"
                className="mb-2 h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <input
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="技能说明（可选），例如：用于竞品章节的对比口径"
                aria-label="技能说明"
                className="mb-2 h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <textarea
                value={formTemplate}
                onChange={(e) => setFormTemplate(e.target.value)}
                rows={4}
                placeholder={"提示词模板，用 {{空位名}} 标记发送前要补填的内容，例如：\n请对比 {{竞品名称}} 与我们产品在 {{模块}} 上的差异"}
                aria-label="提示词模板"
                className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <div className="mt-2">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  适用功能点（技能会在所选功能点的 AI 入口出现）
                </p>
                <div className="flex flex-wrap gap-1">
                  {SCOPE_CATALOG.map((sc) => {
                    const active = formScopes.includes(sc.scope)
                    return (
                      <button
                        key={sc.scope}
                        type="button"
                        onClick={() => toggleScope(sc.scope)}
                        className={`rounded-full border px-2 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {sc.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="mt-2 flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setFormOpen(false)
                    setEditingRow(null)
                  }}
                  disabled={formBusy}
                  className="inline-flex h-7 items-center rounded-md px-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void submitForm()}
                  disabled={formBusy}
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground shadow-sm transition-transform hover:scale-105 disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {formBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  {editingRow ? "保存修改" : "添加"}
                </button>
              </div>
            </div>
          ) : null}

          {customSkills.length === 0 && !formOpen ? (
            <div className="flex flex-col items-center rounded-lg border border-dashed border-border bg-card px-3 py-8 text-center">
              <Wand2 className="h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium text-card-foreground">还没有自定义指令</p>
              <p className="mt-1 text-xs text-muted-foreground">把常用的提问做成模板，一键发送</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {customSkills.map((row) => {
                const rowScopes = normalizeScopes(row.applicable_scopes)
                return (
                  <li
                    key={row.id}
                    className="group rounded-lg border border-border bg-background px-2.5 py-2 shadow-sm"
                  >
                    <div className="flex items-start gap-1.5">
                      <button
                        type="button"
                        onClick={() => onInvoke(row.skill_name, row.prompt_template)}
                        className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <p className="truncate text-xs font-semibold text-foreground transition-colors group-hover:text-primary">
                          {row.skill_name}
                        </p>
                        {row.description && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.description}</p>
                        )}
                        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {row.prompt_template}
                        </p>
                        <p className="mt-1 flex flex-wrap gap-1">
                          {rowScopes.map((sc) => (
                            <span
                              key={sc}
                              className="rounded-full bg-primary/10 px-1.5 py-0.5 text-xs leading-none text-primary"
                            >
                              {scopeLabel(sc)}
                            </span>
                          ))}
                        </p>
                      </button>
                      <button
                        type="button"
                        aria-label="编辑指令"
                        onClick={() => openEdit(row)}
                        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-60 transition-opacity hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label="删除指令"
                        onClick={() => setPendingDeleteSkill(row)}
                        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-60 transition-opacity hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
      <p className="mt-2 shrink-0 text-xs leading-relaxed text-muted-foreground">
        技能可在对应功能点的 AI 入口被带入，也可作为对话指令发送。
      </p>
      <ConfirmDialog
        open={Boolean(pendingDeleteSkill)}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteSkill(null)
        }}
        title="删除自定义指令"
        description={pendingDeleteSkill ? `确定删除「${pendingDeleteSkill.skill_name}」吗？删除后不可恢复。` : ""}
        confirmText="删除"
        tone="danger"
        onConfirm={() => {
          if (pendingDeleteSkill) onDelete(pendingDeleteSkill)
          setPendingDeleteSkill(null)
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// SkillPicker — 全站通用「带入技能」紧凑选择器
// 受控组件：skills / selectedIds / filledVars / onToggle / onSetVar 全部由调用页 hook
// （useScopeSkills）持有，本组件只管展示与交互；选择顺序即注入顺序。
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronDown, Wand2 } from "lucide-react"
import type { SkillRow } from "@/lib/assistantCore"
import { parseSkillPlaceholders, scopeLabel, type SkillScope } from "@/lib/skillCore"
import type { UseScopeSkills } from "@/hooks/useScopeSkills"

export interface SkillPickerProps {
  scope: SkillScope
  skills: SkillRow[]
  selectedIds: string[]
  filledVars: Record<string, Record<string, string>>
  onToggle: (id: string) => void
  onSetVar: (id: string, slot: string, value: string) => void
  /** 下拉面板对齐方向，默认 left */
  align?: "left" | "right"
}

/** 便捷接线：直接吃 useScopeSkills 的返回对象 */
export function SkillPickerFor({
  scope,
  source,
  align,
}: {
  scope: SkillScope
  source: UseScopeSkills
  align?: "left" | "right"
}) {
  return (
    <SkillPicker
      scope={scope}
      skills={source.scopeSkills}
      selectedIds={source.selectedIds}
      filledVars={source.filledVars}
      onToggle={source.toggleSkill}
      onSetVar={source.setSkillVar}
      align={align}
    />
  )
}

export function SkillPicker(p: SkillPickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocDown)
    return () => document.removeEventListener("mousedown", onDocDown)
  }, [open])

  const count = p.selectedIds.length
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:shadow-[var(--focus-ring)] ${
          count > 0
            ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
            : "border-border bg-background text-muted-foreground hover:text-foreground"
        }`}
      >
        <Wand2 className="h-3.5 w-3.5" />
        {count > 0 ? `技能·${count}` : "带入技能"}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-1.5 w-80 rounded-xl border border-border bg-card p-3 text-card-foreground shadow-lg animate-in fade-in slide-in-from-top-1 duration-200 ${
            p.align === "right" ? "right-0" : "left-0"
          }`}
        >
          <p className="text-xs font-medium text-card-foreground">
            带入「{scopeLabel(p.scope)}」技能
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            勾选的技能将按顺序附加到本次 AI 生成
          </p>

          {p.skills.length === 0 ? (
            <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-4 text-center">
              <p className="text-xs text-muted-foreground">
                还没有适用于该功能点的技能
              </p>
              <Link
                to="/assistant"
                onClick={() => setOpen(false)}
                className="mt-1.5 inline-block text-xs font-medium text-primary hover:underline"
              >
                去小智技能面板创建 →
              </Link>
            </div>
          ) : (
            <div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-0.5">
              {p.skills.map((sk) => {
                const checked = p.selectedIds.includes(sk.id)
                const order = p.selectedIds.indexOf(sk.id) + 1
                const slots = checked ? parseSkillPlaceholders(sk.prompt_template) : []
                return (
                  <div
                    key={sk.id}
                    className={`rounded-lg border p-2 transition-colors ${
                      checked ? "border-primary/40 bg-primary/5" : "border-border bg-background"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => p.onToggle(sk.id)}
                      className="flex w-full items-start gap-2 text-left"
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-xs font-semibold ${
                          checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-transparent"
                        }`}
                      >
                        {checked ? order : ""}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-card-foreground">
                          {sk.skill_name}
                        </span>
                        {sk.description && (
                          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                            {sk.description}
                          </span>
                        )}
                      </span>
                    </button>

                    {checked && slots.length > 0 && (
                      <div className="mt-2 space-y-1.5 border-t border-border pt-2">
                        {slots.map((slot) => (
                          <label key={slot} className="block">
                            <span className="text-xs text-muted-foreground">{slot}</span>
                            <input
                              value={p.filledVars[sk.id]?.[slot] ?? ""}
                              onChange={(e) => p.onSetVar(sk.id, slot, e.target.value)}
                              placeholder={`填写「${slot}」（不填则保留空位名）`}
                              className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                            />
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

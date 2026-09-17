import { useState } from "react"
import { ChevronDown, Loader2, Plus, Save, Sparkles, TableProperties, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"

type GlobalFactsPanelProps = Pick<
  UseBidWorkspace,
  | "globalFactsSource"
  | "factDraft"
  | "setFactDraft"
  | "factAiBusy"
  | "startGenerateFactSettings"
  | "saveGlobalFacts"
  | "settingsSaved"
>

/**
 * 第十六轮 B1 改造 1.2：编制步骤设置区的「全局事实表」折叠面板。
 * 事实清单行内编辑/删除 + 新增输入 + 来源徽标（自动抽取=字段空 / 人工编辑=字段非空）；
 * 「AI 生成事实设定」走费用确认，结果只进编辑态；「保存事实表」才 PATCH global_facts 落库。
 */
export function GlobalFactsPanel(p: GlobalFactsPanelProps) {
  const [open, setOpen] = useState(false)
  const [newFact, setNewFact] = useState("")

  const manual = p.globalFactsSource === "manual"

  const updateLine = (idx: number, value: string) => {
    p.setFactDraft((prev) => prev.map((l, i) => (i === idx ? value : l)))
  }
  const removeLine = (idx: number) => {
    p.setFactDraft((prev) => prev.filter((_, i) => i !== idx))
  }
  const addLine = () => {
    const v = newFact.trim()
    if (!v) return
    p.setFactDraft((prev) => [...prev, v])
    setNewFact("")
  }

  return (
    <div className="rounded-lg border border-border bg-card shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
        aria-expanded={open}
      >
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
          <TableProperties className="h-4 w-4 text-primary" />
          全局事实表
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {p.factDraft.length} 条
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              manual ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            {manual ? "人工编辑" : "自动抽取"}
          </span>
          {!p.settingsSaved && (
            <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              保存中…
            </span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-border px-4 py-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            事实是全文统一口径（工期、响应时间、人员配置、设备型号数量、质保期、验收标准、项目经理等），
            大纲与各章正文一律按此书写。当前为{manual ? "人工编辑版（优先生效）" : "解析报告自动抽取版"}，
            任何修改保存后即切换为人工编辑版；清空全部条目并保存可回退自动抽取。
          </p>

          <div className="mt-3 grid gap-2">
            {p.factDraft.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                暂无事实条目——可点「AI 生成事实设定」从解析报告提炼，或在下方手动添加
              </p>
            ) : (
              p.factDraft.map((line, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    value={line}
                    onChange={(e) => updateLine(idx, e.target.value)}
                    placeholder="主题：统一口径"
                    className="border-border bg-background text-xs focus-visible:shadow-[var(--focus-ring)]"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`删除第 ${idx + 1} 条事实`}
                    onClick={() => removeLine(idx)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <Input
              value={newFact}
              onChange={(e) => setNewFact(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  addLine()
                }
              }}
              placeholder="新增一条事实，如：工期：合同签订后 90 日历天内交付"
              className="border-border bg-background text-xs focus-visible:shadow-[var(--focus-ring)]"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={addLine}
              disabled={!newFact.trim()}
              className="shrink-0 border-border text-card-foreground shadow-sm hover:bg-secondary"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              添加
            </Button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              onClick={p.startGenerateFactSettings}
              disabled={p.factAiBusy}
              className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 focus-visible:shadow-[var(--focus-ring)]"
            >
              {p.factAiBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
              {p.factAiBusy ? "正在提炼事实设定…" : "AI 生成事实设定"}
            </Button>
            <Button
              variant="outline"
              onClick={p.saveGlobalFacts}
              className="border-primary/40 text-primary shadow-sm hover:bg-primary/10"
            >
              <Save className="mr-1.5 h-4 w-4" />
              保存事实表
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            AI 生成结果先进入编辑态，可继续修改；点「保存事实表」后才写入项目并在后续生成中生效。
          </p>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from "react"
import { ArrowLeft, ArrowRight, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { OutlineTreeEditor } from "@/components/solution-studio/OutlineTreeEditor"
import { SkillPickerFor } from "@/components/common/SkillPicker"
import type { UseSolutionStudio } from "@/pages/SolutionStudio/useSolutionStudio"
import { BUDGET_RANGES, HOSPITAL_LEVELS, SYSTEM_OPTIONS } from "@/pages/SolutionStudio/solutionTypes"
import { calcTotal, fmtMoney, type ChecklistRecord } from "@/pages/SolutionStudio/checklistTypes"

type NewSolutionWizardProps = Pick<
  UseSolutionStudio,
  | "wizardOpen"
  | "wizardStep"
  | "setWizardStep"
  | "closeWizard"
  | "solutionTypes"
  | "formTypeKey"
  | "setFormTypeKey"
  | "formSolutionName"
  | "setFormSolutionName"
  | "formHospital"
  | "setFormHospital"
  | "formOpportunityId"
  | "setFormOpportunityId"
  | "wizardOppOptions"
  | "formInfo"
  | "setFormInfo"
  | "formChecklistId"
  | "outlineDraft"
  | "outlineLoading"
  | "confirming"
  | "submitWizardInfo"
  | "confirmOutline"
  | "outlineRename"
  | "outlineRemove"
  | "outlineAddChild"
  | "outlineAddRoot"
  | "outlineMove"
  | "outlineSkills"
> & {
  checklistOptions: ChecklistRecord[]
  onPickChecklist: (id: string) => void
  /** 从 CheckProduct 产品库自动汇总的「产品/系统」候选列表（非空时优先作为 systems 标签云） */
  productNames?: string[]
}

const STEP_TITLES = ["选择方案类型", "填写项目信息", "确认方案大纲"]

function FieldLabel({ text, required }: { text: string; required?: boolean }) {
  return (
    <label className="mb-1.5 block text-sm font-medium text-foreground">
      {text}
      {required && <span className="ml-0.5 text-destructive">*</span>}
    </label>
  )
}

export function NewSolutionWizard(p: NewSolutionWizardProps) {
  const info = p.formInfo
  const setInfo = p.setFormInfo
  const linkedChecklist = p.checklistOptions.find((c) => c.id === p.formChecklistId) ?? null
  // 产品库候选：优先使用外部传入的 CheckProduct.product_name 去重列表；老数据回退到 SYSTEM_OPTIONS
  const catalogNames = (p.productNames ?? []).filter(Boolean)
  const systemPresets = catalogNames.length > 0 ? catalogNames : SYSTEM_OPTIONS
  const inPresets = (s: string) => systemPresets.includes(s)
  const toggleSystem = (sys: string) => {
    const has = info.systems.includes(sys)
    setInfo({ ...info, systems: has ? info.systems.filter((s) => s !== sys) : [...info.systems, sys] })
  }

  // 自定义系统清单用本地草稿编辑：输入「、」不再被瞬间吃掉，失焦/提交时归一回 info.systems
  const [customSystemsDraft, setCustomSystemsDraft] = useState("")
  useEffect(() => {
    if (p.wizardOpen) {
      setCustomSystemsDraft(
        p.formInfo.systems.filter((s) => !inPresets(s)).join("、"),
      )
    }
    // 仅在向导打开时重置草稿
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.wizardOpen])
  const customPreview = customSystemsDraft
    .split(/[、,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
  const commitCustomSystems = () => {
    const presets = info.systems.filter((s) => inPresets(s))
    setInfo({ ...info, systems: [...presets, ...customPreview.filter((s) => !presets.includes(s))] })
  }
  // T5 内联必填校验：第二步「生成大纲」空值时当场标红，不再只靠 toast
  const [submitTried, setSubmitTried] = useState(false)
  // 重开向导时复位提示（React 官方推荐的「渲染期调整状态」，非 effect 内 setState）
  const [prevOpen, setPrevOpen] = useState(p.wizardOpen)
  if (prevOpen !== p.wizardOpen) {
    setPrevOpen(p.wizardOpen)
    if (p.wizardOpen) setSubmitTried(false)
  }
  const hospitalError = submitTried && !p.formHospital.trim()
  const systemsError = submitTried && info.systems.length === 0 && customPreview.length === 0
  const trySubmitInfo = () => {
    commitCustomSystems()
    setSubmitTried(true)
    if (!p.formHospital.trim()) return
    if (info.systems.length === 0 && customPreview.length === 0) return
    p.submitWizardInfo()
  }
  return (
    <Dialog open={p.wizardOpen} onOpenChange={(open) => !open && p.closeWizard()}>
      <DialogContent
        className="max-h-[90vh] max-w-3xl overflow-y-auto"
        onKeyDown={(e) => {
          // 循环7 C4：Enter 触发当前步主按钮（1 下一步 / 2 生成大纲 / 3 确认大纲）；
          // textarea 保留换行；按钮与 Radix 下拉浮层内交给原生行为避免双触发
          // 循环8 C3：原生 select（关联商机）键盘选完选项的 Enter 也豁免，不提前触发主动作
          if (e.key !== "Enter" || e.shiftKey) return
          const target = e.target as HTMLElement
          if (
            target.tagName === "TEXTAREA" ||
            target.tagName === "BUTTON" ||
            target.tagName === "SELECT" ||
            target.isContentEditable ||
            target.closest("[data-radix-popper-content-wrapper]")
          )
            return
          e.preventDefault()
          if (p.wizardStep === 1) {
            p.setWizardStep(2)
          } else if (p.wizardStep === 2) {
            if (p.outlineLoading) return
            trySubmitInfo()
          } else if (p.wizardStep === 3) {
            if (p.outlineLoading || p.confirming) return
            void p.confirmOutline()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-foreground">新建方案</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            三步完成：选类型 → 填医院项目信息 → 确认 AI 生成的大纲
          </DialogDescription>
        </DialogHeader>

        <ol className="mt-2 flex items-center gap-2">
          {STEP_TITLES.map((title, i) => {
            const stepNo = i + 1
            const reached = p.wizardStep >= stepNo
            return (
              <li key={title} className="flex flex-1 items-center gap-2">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    reached ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {stepNo}
                </span>
                <span className={`hidden text-xs sm:block ${reached ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                  {title}
                </span>
                {i < 2 && <span className="h-px flex-1 bg-border" />}
              </li>
            )
          })}
        </ol>

        {p.wizardStep === 1 && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {p.solutionTypes.map((t) => {
                const selected = p.formTypeKey === t.key
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => p.setFormTypeKey(t.key)}
                    className={`rounded-lg border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      selected
                        ? "border-primary bg-primary/10 shadow-md"
                        : "border-border bg-card shadow-sm hover:border-primary/40 hover:shadow-md"
                    }`}
                  >
                    <p className={`text-sm font-semibold ${selected ? "text-primary" : "text-foreground"}`}>{t.label}</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t.desc}</p>
                  </button>
                )
              })}
            </div>

            {/* 素材来源：将“关联建设清单”前置到 Step 1，作为大卡片醒目入口 */}
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 shadow-sm">
              <FieldLabel text="素材来源 · 关联建设清单（推荐）" />
              <p className="mb-2 text-xs text-muted-foreground">
                选一份已有的建设清单：将自动预填医院名称与建设系统清单，AI 大纲会按清单条目覆盖分系统章节。
              </p>
              <Select value={p.formChecklistId} onValueChange={p.onPickChecklist}>
                <SelectTrigger className="w-full bg-card">
                  <SelectValue placeholder="不关联，下一步手动勾选建设系统" />
                </SelectTrigger>
                <SelectContent>
                  {p.checklistOptions.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      还没有建设清单，先到「建设清单」创建或从产品库导入。
                    </div>
                  ) : (
                    p.checklistOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.checklist_name}
                        {c.hospital ? ` · ${c.hospital}` : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {linkedChecklist && (
                <p className="mt-2 rounded-md border border-primary/30 bg-card px-2.5 py-1.5 text-xs text-primary">
                  已选「{linkedChecklist.checklist_name}」：
                  {(linkedChecklist.items ?? []).filter((l) => l.checked !== false).length} 个条目、合计{" "}
                  {fmtMoney(calcTotal(linkedChecklist.items ?? []))}，下一步系统标签已自动带入。
                </p>
              )}
            </div>
          </div>
        )}

        {p.wizardStep === 2 && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {linkedChecklist ? (
              <div className="sm:col-span-2">
                <p className="rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs text-primary">
                  已关联清单「{linkedChecklist.checklist_name}」：从清单带入{" "}
                  {new Set(
                    (linkedChecklist.items ?? [])
                      .filter((l) => l.checked !== false)
                      .map((l) => l.product_name),
                  ).size}{" "}
                  个系统，下方标签已自动勾选（可手动补充）。方案将按清单覆盖分系统章节。
                </p>
              </div>
            ) : (
              <div className="sm:col-span-2">
                <p className="rounded-md border border-dashed border-border bg-muted/20 px-2.5 py-1.5 text-xs text-muted-foreground">
                  未关联建设清单，可手动勾选下方系统标签；建议到上一步选一份清单，AI 大纲会更贴合医院实际。
                </p>
              </div>
            )}
            <div className="sm:col-span-2">
              <FieldLabel text="方案名称" />
              <Input
                value={p.formSolutionName}
                onChange={(e) => p.setFormSolutionName(e.target.value)}
                placeholder="选填，默认「医院名 + 方案类型」，如 XX 市人民医院信息化规划方案"
              />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel text="关联商机（可选）" />
              <select
                value={p.formOpportunityId}
                onChange={(e) => p.setFormOpportunityId(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <option value="">不关联（创建后可在客户管理中手动关联）</option>
                {p.wizardOppOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.customer_name ? `${o.customer_name} · ${o.opp_name}` : o.opp_name}
                  </option>
                ))}
              </select>
              {p.formOpportunityId && (
                <p className="mt-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs text-primary">
                  创建后该商机会自动关联本方案，可在客户管理的商机详情里直接跳转查看
                </p>
              )}
            </div>
            <div>
              <FieldLabel text="医院名称" required />
              <Input
                value={p.formHospital}
                onChange={(e) => p.setFormHospital(e.target.value)}
                placeholder="如：XX 市人民医院"
                aria-invalid={hospitalError}
                className={hospitalError ? "border-destructive focus-visible:ring-destructive" : undefined}
              />
              {hospitalError ? <p role="alert" className="mt-1 text-xs text-destructive">请填写医院名称</p> : null}
            </div>
            <div>
              <FieldLabel text="医院等级" />
              <Select
                value={info.hospital_level}
                onValueChange={(v) => setInfo({ ...info, hospital_level: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOSPITAL_LEVELS.map((lv) => (
                    <SelectItem key={lv} value={lv}>
                      {lv}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <FieldLabel text="床位规模" />
              <Input
                value={info.bed_scale}
                onChange={(e) => setInfo({ ...info, bed_scale: e.target.value })}
                placeholder="如：开放床位 1200 张"
              />
            </div>
            <div>
              <FieldLabel text="日门诊量" />
              <Input
                value={info.outpatient_scale}
                onChange={(e) => setInfo({ ...info, outpatient_scale: e.target.value })}
                placeholder="如：日均门诊 3500 人次"
              />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel text="需求科室" />
              <Input
                value={info.demand_departments}
                onChange={(e) => setInfo({ ...info, demand_departments: e.target.value })}
                placeholder="如：信息科、门诊部、检验科、影像科、护理部"
              />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel text="建设内容 / 系统清单" required />
              <div className="flex flex-wrap gap-2">
                {systemPresets.map((sys) => {
                  const on = info.systems.includes(sys)
                  return (
                    <button
                      key={sys}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleSystem(sys)}
                      className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                        on
                          ? "border-primary bg-primary text-primary-foreground shadow-sm"
                          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-card-foreground"
                      }`}
                    >
                      {sys}
                    </button>
                  )
                })}
              </div>
              {systemsError ? (
                <p role="alert" className="mt-1 text-xs text-destructive">请至少勾选或填写一个建设系统</p>
              ) : null}
              <Input
                className="mt-2"
                value={customSystemsDraft}
                onChange={(e) => setCustomSystemsDraft(e.target.value)}
                onBlur={commitCustomSystems}
                placeholder="其他系统用顿号分隔补充，如：院感管理、血透管理"
              />
              {customPreview.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className="text-xs text-muted-foreground">已识别：</span>
                  {customPreview.map((sys) => (
                    <span key={sys} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                      {sys}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <FieldLabel text="预算范围" />
              <Select value={info.budget_range} onValueChange={(v) => setInfo({ ...info, budget_range: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUDGET_RANGES.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <FieldLabel text="特殊要求（选填）" />
              <Textarea
                value={info.special_requirements}
                onChange={(e) => setInfo({ ...info, special_requirements: e.target.value })}
                placeholder="如：需通过电子病历五级评审、与现有 XX 系统对接、信创环境适配、分期建设等"
                rows={3}
              />
            </div>
          </div>
        )}

        {p.wizardStep === 3 && (
          <div className="mt-4">
            <OutlineTreeEditor
              nodes={p.outlineDraft}
              onRename={p.outlineRename}
              onRemove={p.outlineRemove}
              onMove={p.outlineMove}
              onAddChild={p.outlineAddChild}
              onAddRoot={p.outlineAddRoot}
            />
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
          <Button
            variant="outline"
            onClick={() => (p.wizardStep === 1 ? p.closeWizard() : p.setWizardStep((p.wizardStep - 1) as 1 | 2))}
            className="border-border text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            {p.wizardStep === 1 ? "取消" : "上一步"}
          </Button>
          {p.wizardStep === 1 && (
            <Button onClick={() => p.setWizardStep(2)} className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90">
              下一步
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {p.wizardStep === 2 && (
            <div className="flex items-center gap-2">
              <SkillPickerFor scope="solution-outline" source={p.outlineSkills} align="right" />
              <Button
                onClick={trySubmitInfo}
                disabled={p.outlineLoading}
                className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                {p.outlineLoading ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    大纲生成中…
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1.5 h-4 w-4" />
                    生成方案大纲
                  </>
                )}
              </Button>
            </div>
          )}
          {p.wizardStep === 3 && (
            <Button onClick={() => void p.confirmOutline()} disabled={p.outlineLoading || p.confirming} className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90">
              {p.confirming ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  创建中…
                </>
              ) : (
                <>
                  确认大纲，进入编制
                  <ArrowRight className="ml-1 h-4 w-4" />
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

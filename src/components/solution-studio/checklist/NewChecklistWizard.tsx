import { useRef, useState } from "react"
import { ArrowLeft, FileUp, Loader2, Sparkles, Wand2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { SkillPickerFor } from "@/components/common/SkillPicker"
import { RATING_GROUPS, calcTotal, fmtMoney } from "@/pages/SolutionStudio/checklistTypes"
import type { UseChecklist } from "@/pages/SolutionStudio/checklistLogic"
import { MatchKindBadge, RatingHitsBadges, SourceBadge } from "./ChecklistBadges"

// ---------------------------------------------------------------------------
// 新建建设清单向导：路径 A 评级匹配 / 路径 B 客户清单匹配
// ---------------------------------------------------------------------------

const STEP_HINT: Record<string, string> = {
  path: "选择清单生成路径",
  targets: "多选评级目标，系统按产品评级标签自动勾选",
  autocheck: "人工增删改勾选后保存清单",
  raw: "粘贴客户清单文本或上传 Excel",
  match: "未命中条目人工指定后生成清单，人工映射沉淀到团队映射库",
}

function SaveFields({
  ck,
  nameError,
  onNameInput,
  onNameBlur,
}: {
  ck: UseChecklist
  nameError: string
  onNameInput: (value: string) => void
  onNameBlur: () => void
}) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">清单名称 *</label>
        <Input
          value={ck.ckName}
          onChange={(e) => onNameInput(e.target.value)}
          onBlur={onNameBlur}
          aria-invalid={Boolean(nameError)}
          placeholder="如：XX 市人民医院信息化建设清单"
          className={nameError ? "border-destructive focus-visible:ring-destructive" : ""}
        />
        {nameError && <p className="mt-1 text-xs text-destructive">{nameError}</p>}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">客户医院</label>
        <Input value={ck.ckHospital} onChange={(e) => ck.setCkHospital(e.target.value)} placeholder="如：XX 市人民医院" />
      </div>
    </div>
  )
}

// A2-8：数量 / 单价编辑期允许空串草稿，失焦统一归一为合法数字
function WizardNumCell({
  value,
  ariaLabel,
  className,
  onCommit,
}: {
  value: number
  ariaLabel: string
  className: string
  onCommit: (n: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <Input
      type="number"
      min={0}
      aria-label={ariaLabel}
      className={className}
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const raw = (draft ?? "").trim()
        const n = Number(raw)
        onCommit(raw !== "" && Number.isFinite(n) && n >= 0 ? n : 0)
        setDraft(null)
      }}
    />
  )
}

export function NewChecklistWizard({ ck }: { ck: UseChecklist }) {
  const [addProductId, setAddProductId] = useState("")
  const fileRef = useRef<HTMLInputElement | null>(null)
  // A2-8：名称必填行内提示 + 有脏数据时关闭前确认
  const [nameError, setNameError] = useState("")
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)

  const checkedCount = ck.ckLines.filter((l) => l.checked).length

  const wizardDirty = Boolean(
    ck.ckName.trim() ||
      ck.ckHospital.trim() ||
      ck.ckRawText.trim() ||
      ck.ckTargets.length > 0 ||
      ck.ckLines.length > 0 ||
      ck.ckMatchRows.length > 0,
  )

  const handleNameInput = (value: string) => {
    ck.setCkName(value)
    if (nameError) setNameError("")
  }

  const handleNameBlur = () => {
    if (!ck.ckName.trim()) setNameError("请填写清单名称后才能保存")
  }

  const requestClose = () => {
    if (wizardDirty) setConfirmCloseOpen(true)
    else ck.closeChecklistWizard()
  }

  const handleUpload = async (file: File) => {
    try {
      const { parseCustomerLinesFile } = await import("@/pages/SolutionStudio/checklistExports")
      const lines = await parseCustomerLinesFile(file)
      if (!lines.length) {
        toast.error("未从文件中解析到清单条目")
        return
      }
      ck.startCustomerMatch(lines, lines.join("\n"))
    } catch {
      toast.error("Excel 解析失败，请检查文件内容")
    }
  }

  return (
    <>
    <Dialog open={ck.ckWizardOpen} onOpenChange={(open) => !open && requestClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-foreground">新建建设清单</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{STEP_HINT[ck.ckStep]}</DialogDescription>
        </DialogHeader>

        {ck.ckStep === "path" && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => ck.setCkStep("targets")}
              className="rounded-xl border border-border bg-card p-5 text-left shadow-md transition-all hover:border-primary/40 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <p className="text-sm font-semibold text-primary">按评级目标匹配</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                多选电子病历 / 互联互通 / 智慧服务 / 智慧管理评级档位，按产品评级标签自动勾选我公司产品，公司未覆盖的评级要求系统自动标「外购」。
              </p>
            </button>
            <button
              type="button"
              onClick={() => ck.setCkStep("raw")}
              className="rounded-xl border border-border bg-card p-5 text-left shadow-md transition-all hover:border-primary/40 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <p className="text-sm font-semibold text-primary">按客户清单匹配</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                粘贴客户清单文本或上传 Excel，逐条归一化后本地模糊 + AI 语义匹配我公司产品，未命中人工指定，映射沉淀后续自动命中。
              </p>
            </button>
          </div>
        )}

        {ck.ckStep === "targets" && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {RATING_GROUPS.map((g) => (
              <div key={g.key} className="rounded-xl border border-border bg-secondary/40 p-4">
                <p className="text-sm font-medium text-foreground">{g.label}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {g.levels.map((lv) => {
                    const code = `${g.key}:${lv.value}`
                    const on = ck.ckTargets.includes(code)
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => ck.toggleTarget(code)}
                        className={`rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                          on
                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                            : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-card-foreground"
                        }`}
                      >
                        {lv.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            <div className="sm:col-span-2">
              <Button onClick={ck.applyAutoCheck} disabled={!ck.ckTargets.length} className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90">
                <Wand2 className="mr-1 h-4 w-4" />
                生成自动勾选表
              </Button>
            </div>
          </div>
        )}

        {ck.ckStep === "autocheck" && (
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                已勾选 {checkedCount} / {ck.ckLines.length} 项 · 合计 {fmtMoney(calcTotal(ck.ckLines))}
              </p>
              <div className="flex items-center gap-2">
                <Select value={addProductId} onValueChange={setAddProductId}>
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="选择我公司产品追加" />
                  </SelectTrigger>
                  <SelectContent>
                    {ck.companyProducts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.product_name}
                        {p.module_name ? ` · ${p.module_name}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!addProductId}
                  onClick={() => {
                    ck.addWizardLineFromProduct(addProductId)
                    setAddProductId("")
                  }}
                  className="border-border text-muted-foreground hover:text-foreground"
                >
                  追加
                </Button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead className="sticky top-0 bg-secondary/80 backdrop-blur">
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">勾选</th>
                    <th className="px-3 py-2 font-medium">来源</th>
                    <th className="px-3 py-2 font-medium">产品 / 模块</th>
                    <th className="px-3 py-2 font-medium">评级关联</th>
                    <th className="px-3 py-2 font-medium">数量</th>
                    <th className="px-3 py-2 font-medium">单价</th>
                    <th className="px-3 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {ck.ckLines.map((l) => (
                    <tr key={l.line_id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => ck.toggleLineChecked(l.line_id)}
                          className={`flex h-5 w-5 items-center justify-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                            l.checked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"
                          }`}
                          aria-label="勾选"
                        >
                          {l.checked ? "✓" : ""}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <SourceBadge source={l.source} />
                      </td>
                      <td className="px-3 py-2 text-foreground">
                        {l.product_name}
                        <span className="text-xs text-muted-foreground">{l.module_name ? ` · ${l.module_name}` : ""}</span>
                      </td>
                      <td className="px-3 py-2">
                        <RatingHitsBadges hits={l.rating_hits} />
                      </td>
                      <td className="px-3 py-2">
                        <WizardNumCell
                          ariaLabel="数量"
                          className="h-8 w-16"
                          value={l.qty}
                          onCommit={(n) => ck.updateWizardLine(l.line_id, { qty: n })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <WizardNumCell
                          ariaLabel="单价"
                          className="h-8 w-24"
                          value={l.unit_price}
                          onCommit={(n) => ck.updateWizardLine(l.line_id, { unit_price: n })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Button size="sm" variant="ghost" onClick={() => ck.removeWizardLine(l.line_id)} className="text-muted-foreground hover:text-destructive">
                          移除
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SaveFields ck={ck} nameError={nameError} onNameInput={handleNameInput} onNameBlur={handleNameBlur} />
            <div className="mt-4 flex justify-end">
              <Button
                onClick={ck.saveRatingChecklist}
                disabled={ck.ckSaving || !ck.ckName.trim()}
                className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60"
              >
                保存清单
              </Button>
            </div>
          </div>
        )}

        {ck.ckStep === "raw" && (
          <div className="mt-4">
            <Textarea
              rows={10}
              value={ck.ckRawText}
              onChange={(e) => ck.setCkRawText(e.target.value)}
              placeholder={"每行一个系统条目，如：\n1. 电子病历系统（含质控）\n2、集成平台 V3.0\n(3) 互联网医院平台"}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => fileRef.current?.click()} className="border-border text-muted-foreground hover:text-foreground">
                <FileUp className="mr-1 h-4 w-4" />
                上传客户清单 Excel
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleUpload(file)
                  e.target.value = ""
                }}
              />
              <SkillPickerFor scope="checklist-match" source={ck.matchSkills} />
              <Button
                onClick={() => ck.startCustomerMatch(ck.ckRawText.split("\n"), ck.ckRawText)}
                disabled={ck.ckMatchBusy || !ck.ckRawText.trim()}
                className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                {ck.ckMatchBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
                开始匹配
              </Button>
            </div>
          </div>
        )}

        {ck.ckStep === "match" && (
          <div className="mt-4">
            {ck.ckMatchBusy && (
              <p className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                AI 语义匹配进行中，完成后未命中条目可人工指定…
              </p>
            )}
            <div className="max-h-96 overflow-y-auto rounded-lg border border-border">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="sticky top-0 bg-secondary/80 backdrop-blur">
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">客户条目</th>
                    <th className="px-3 py-2 font-medium">匹配方式</th>
                    <th className="px-3 py-2 font-medium">我公司产品</th>
                    <th className="px-3 py-2 font-medium">处理</th>
                  </tr>
                </thead>
                <tbody>
                  {ck.ckMatchRows.map((r) => (
                    <tr key={r.row_id} className={`border-b border-border/60 last:border-0 ${r.resolution === "ignore" ? "opacity-50" : ""}`}>
                      <td className="px-3 py-2 text-foreground">{r.norm}</td>
                      <td className="px-3 py-2">
                        <MatchKindBadge kind={r.kind} />
                      </td>
                      <td className="px-3 py-2">
                        {r.resolution === "company" ? (
                          <Select value={r.product_id} onValueChange={(v) => ck.setMatchProduct(r.row_id, v)}>
                            <SelectTrigger className="h-8 w-52">
                              <SelectValue placeholder={r.product_name || "选择我公司产品"} />
                            </SelectTrigger>
                            <SelectContent>
                              {ck.companyProducts.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.product_name}
                                  {p.module_name ? ` · ${p.module_name}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : r.resolution === "external" ? (
                          <span className="text-xs text-destructive">标为外购系统</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">已忽略</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex gap-1">
                          {r.resolution !== "company" && (
                            <Button size="sm" variant="ghost" onClick={() => ck.setMatchResolution(r.row_id, "company")} className="text-muted-foreground hover:text-foreground">
                              公司
                            </Button>
                          )}
                          {r.resolution !== "external" && (
                            <Button size="sm" variant="ghost" onClick={() => ck.setMatchResolution(r.row_id, "external")} className="text-muted-foreground hover:text-destructive">
                              外购
                            </Button>
                          )}
                          {r.resolution !== "ignore" && (
                            <Button size="sm" variant="ghost" onClick={() => ck.setMatchResolution(r.row_id, "ignore")} className="text-muted-foreground hover:text-foreground">
                              忽略
                            </Button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SaveFields ck={ck} nameError={nameError} onNameInput={handleNameInput} onNameBlur={handleNameBlur} />
            <div className="mt-4 flex justify-end">
              <Button
                onClick={ck.saveMatchChecklist}
                disabled={ck.ckSaving || ck.ckMatchBusy || !ck.ckName.trim()}
                className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60"
              >
                生成清单
              </Button>
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
          <Button
            variant="outline"
            onClick={() => {
              if (ck.ckStep === "targets" || ck.ckStep === "raw") ck.setCkStep("path")
              else if (ck.ckStep === "autocheck") ck.setCkStep("targets")
              else if (ck.ckStep === "match") ck.setCkStep("raw")
              else requestClose()
            }}
            className="border-border text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            {ck.ckStep === "path" ? "取消" : "上一步"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {ck.ckStep === "autocheck" || ck.ckStep === "match" ? "保存后可在清单详情继续编辑并导出" : ""}
          </p>
        </div>
      </DialogContent>
    </Dialog>
    <ConfirmDialog
      open={confirmCloseOpen}
      onOpenChange={setConfirmCloseOpen}
      title="关闭新建清单？"
      description="当前清单内容尚未保存，关闭后将丢失且不可恢复。"
      confirmText="仍要关闭"
      tone="danger"
      onConfirm={() => {
        setConfirmCloseOpen(false)
        ck.closeChecklistWizard()
      }}
    />
    </>
  )
}

import { useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeftRight, Brain, Database, Download, FileUp, ListChecks, Loader2, Save, ShieldCheck, Sparkles, Table2, Trash2, Upload } from "lucide-react"
import { CompanyLibraryDialog } from "./CompanyLibraryDialog"
import { CompareTable } from "./CompareTable"
import { MappingMemoryDialog } from "./MappingMemoryDialog"
import { UploadWizardDialog } from "./UploadWizardDialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent } from "@/components/ui/card"
import { CostConfirmDialog } from "@/components/rh/CostConfirmDialog"
import { SkillPickerFor } from "@/components/common/SkillPicker"
import { calcTotal, fmtMoney, RATING_GROUPS, type ChecklistLine } from "@/pages/SolutionStudio/checklistTypes"
import { ratingSelectionText } from "./ratingCoverage"
import type { UseProductMapping } from "./useProductMapping"

// ---------------------------------------------------------------------------
// 产品映射 View（2026-10-28 重构）：
//   上传向导（任意 Excel 原表保留）→ 离线匹配（记忆库/规则）→ 对照表（原表列+映射列组）
//   → 人工调整（可搜索目录选择器）→ 记忆库沉淀 → 导出（对照表 / 覆盖视角 / 骨架回填）
//   AI 语义匹配为可选手动触发（离线优先，数据出不出本机由用户决定）。
// ---------------------------------------------------------------------------

const SOURCE_TABS: { key: UseProductMapping["sourceTab"]; label: string }[] = [
  { key: "paste", label: "上传 / 粘贴" },
  { key: "bid", label: "从招标文件" },
  { key: "solution", label: "从方案 / 需求" },
]

const VIEWS: { key: "compare" | "checklist"; label: string; icon: typeof Table2 }[] = [
  { key: "compare", label: "一一对照", icon: ArrowLeftRight },
  { key: "checklist", label: "建设清单", icon: ListChecks },
]

function NumCell({ value, ariaLabel, onCommit }: { value: number; ariaLabel: string; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <Input
      type="number"
      min={0}
      aria-label={ariaLabel}
      className="h-8 w-24"
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

function SourcePanel({ p }: { p: UseProductMapping }) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const navigate = useNavigate()
  const [bidId, setBidId] = useState("")
  const [solId, setSolId] = useState("")

  return (
    <Card className="mb-5 shadow-sm">
      <CardContent className="p-5">
        <div className="mb-4 flex w-fit items-center gap-1 rounded-full bg-muted p-0.5">
          {SOURCE_TABS.map((t) => {
            const active = p.sourceTab === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => p.setSourceTab(t.key)}
                className={`rounded-full px-4 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  active ? "bg-card font-medium text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {p.sourceTab === "paste" && (
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button onClick={() => fileRef.current?.click()} disabled={p.productsLoading}>
                <FileUp className="mr-1 h-4 w-4" />
                上传清单 Excel（推荐）
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) p.openWizard(file)
                  e.target.value = ""
                }}
              />
              <span className="text-xs text-muted-foreground">
                支持任意格式的业主清单：向导里确认表头行和名称列，原表所有列会保留进对照表。
              </span>
            </div>
            <Textarea
              rows={6}
              value={p.rawText}
              onChange={(e) => p.setRawText(e.target.value)}
              placeholder={"或者直接粘贴文本，每行一个系统 / 模块条目：\n1. 电子病历系统（含质控）\n2、集成平台 V3.0\n(3) 门急诊挂号收费"}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <SkillPickerFor scope="product-map" source={p.matchSkills} />
              <Button
                variant="outline"
                onClick={() => p.startMatch(p.rawText.split("\n"), p.rawText)}
                disabled={p.busy || p.productsLoading || !p.rawText.trim()}
              >
                {p.busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
                按粘贴文本对照
              </Button>
            </div>
          </div>
        )}

        {p.sourceTab === "bid" && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[280px] flex-1">
              <label className="mb-1 block text-xs font-medium text-foreground">选择已解析的招标项目</label>
              <Select value={bidId} onValueChange={setBidId}>
                <SelectTrigger>
                  <SelectValue placeholder={p.sourceLoading ? "加载中…" : p.bids.length ? "选择招标项目" : "暂无招标项目，请先到标书工作台解析"} />
                </SelectTrigger>
                <SelectContent>
                  {p.bids.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.project_name}
                      {b.hospital ? ` · ${b.hospital}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={p.busy || p.productsLoading || !bidId}
              onClick={() => {
                p.importFromBid(p.bids.find((b) => b.id === bidId))
                setBidId("")
              }}
            >
              <Sparkles className="mr-1 h-4 w-4" />
              导入采购清单并对照
            </Button>
          </div>
        )}

        {p.sourceTab === "bid" && !p.sourceLoading && p.bids.length === 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
            <span>还没有已解析的招标项目：先到标书工作台上传解析招标公告，「采购清单」即可一键导入做对照。</span>
            <Button type="button" size="sm" variant="outline" onClick={() => navigate("/bid-workspace")}>
              去标书工作台
            </Button>
          </div>
        )}

        {p.sourceTab === "solution" && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[280px] flex-1">
              <label className="mb-1 block text-xs font-medium text-foreground">选择已有方案 / 需求</label>
              <Select value={solId} onValueChange={setSolId}>
                <SelectTrigger>
                  <SelectValue placeholder={p.sourceLoading ? "加载中…" : p.solutions.length ? "选择方案" : "暂无带建设清单快照的方案"} />
                </SelectTrigger>
                <SelectContent>
                  {p.solutions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.solution_name}
                      {s.hospital ? ` · ${s.hospital}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={p.busy || p.productsLoading || !solId}
              onClick={() => {
                p.importFromSolution(p.solutions.find((s) => s.id === solId))
                setSolId("")
              }}
            >
              <Sparkles className="mr-1 h-4 w-4" />
              导入需求条目并对照
            </Button>
          </div>
        )}

        {p.sourceTab === "solution" && !p.sourceLoading && p.solutions.length === 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
            <span>还没有带建设清单快照的方案：在方案工作室生成并保存清单快照后，即可回到这里挑选导入。</span>
            <Button type="button" size="sm" variant="outline" onClick={() => navigate("/solution-studio")}>
              去方案工作室
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ChecklistTable({ p }: { p: UseProductMapping }) {
  const kept = p.checklistLines.filter((l) => l.checked !== false)
  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">
        共 {p.checklistLines.length} 项 · 已勾选 {kept.length} 项 · 合计 {fmtMoney(calcTotal(kept))}
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-secondary/80 backdrop-blur">
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">勾选</th>
              <th className="px-3 py-2 font-medium">来源</th>
              <th className="px-3 py-2 font-medium">产品 / 模块</th>
              <th className="px-3 py-2 font-medium">数量</th>
              <th className="px-3 py-2 font-medium">单价</th>
            </tr>
          </thead>
          <tbody>
            {p.checklistLines.map((l: ChecklistLine) => (
              <tr key={l.line_id} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => p.updateLineEdit(l.line_id, { checked: !l.checked })}
                    className={`flex h-5 w-5 items-center justify-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      l.checked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"
                    }`}
                    aria-label="勾选"
                  >
                    {l.checked ? "✓" : ""}
                  </button>
                </td>
                <td className="px-3 py-2">
                  {l.source === "external" ? (
                    <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs text-destructive">外购</span>
                  ) : (
                    <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">我公司</span>
                  )}
                </td>
                <td className="px-3 py-2 text-foreground">
                  {l.product_name}
                  <span className="text-xs text-muted-foreground">{l.module_name ? ` · ${l.module_name}` : ""}</span>
                </td>
                <td className="px-3 py-2">
                  <NumCell ariaLabel="数量" value={l.qty} onCommit={(n) => p.updateLineEdit(l.line_id, { qty: n })} />
                </td>
                <td className="px-3 py-2">
                  <NumCell ariaLabel="单价" value={l.unit_price} onCommit={(n) => p.updateLineEdit(l.line_id, { unit_price: n })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * 评级筛选条（2026-10-29）
 *
 * 用户需求：公司清单导出要先按评级要求筛一遍，再把客户提到的要求补进来，
 * 并明确标注三方/公司/自定义；评级必选项必须体现。
 * 这里既是筛选控件的入口，也是「当前会导出什么」的实时预览。
 */
function RatingFilterBar({ p }: { p: UseProductMapping }) {
  const st = p.ratingStats
  const selectedText = ratingSelectionText(p.ratingSel)
  const hasSel = Boolean(selectedText)
  return (
    <div className="mb-4 rounded-lg border border-border bg-secondary/30 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-xs font-medium text-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          评级要求
        </span>
        <span className="text-[11px] text-muted-foreground">选中后按评级筛模块，「必选」强制带出</span>
        {hasSel && (
          <button type="button" onClick={p.clearRating} className="text-[11px] text-primary hover:underline">
            清除
          </button>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={p.includeRatingOptional}
            onChange={(e) => p.setIncludeRatingOptional(e.target.checked)}
            className="h-3 w-3 accent-primary"
          />
          含「可选」评级模块
        </label>
      </div>

      <div className="mt-2 space-y-1.5">
        {RATING_GROUPS.map((g) => {
          const picked = p.ratingSel[g.key] ?? []
          return (
            <div key={g.key} className="flex flex-wrap items-center gap-1.5">
              <span className="w-20 shrink-0 text-[11px] text-muted-foreground">{g.short}</span>
              {g.levels.map((lv) => {
                const on = picked.includes(lv.value)
                return (
                  <button
                    key={lv.value}
                    type="button"
                    onClick={() => p.toggleRating(g.key, lv.value)}
                    aria-pressed={on}
                    className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      on
                        ? "border-primary bg-primary/10 font-medium text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {lv.label}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
        <span className="text-foreground">将导出 {st.total} 项</span>
        <span>·</span>
        <span className="font-medium text-destructive">评级必选 {st.required}</span>
        <span>·</span>
        <span className="text-emerald-600">公司 {st.company}</span>
        <span>·</span>
        <span className="text-orange-600">三方 {st.thirdparty}</span>
        <span>·</span>
        <span className="text-violet-600">自定义 {st.custom}</span>
        <span>·</span>
        <span>客户清单已覆盖 {st.coveredByCustomer}</span>
      </div>
    </div>
  )
}

function ResultSection({ p }: { p: UseProductMapping }) {
  const skeletonRef = useRef<HTMLInputElement | null>(null)
  const aiLeft = p.rows.filter((r) => r.kind === "none" && r.resolution === "company").length
  return (
    <Card className="shadow-sm">
      <CardContent className="p-5">
        <RatingFilterBar p={p} />
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex w-fit items-center gap-1 rounded-full bg-muted p-0.5">
            {VIEWS.map((v) => {
              const active = p.view === v.key
              const Icon = v.icon
              return (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => p.setView(v.key)}
                  className={`inline-flex items-center gap-1 rounded-full px-4 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    active ? "bg-card font-medium text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {v.label}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="text-emerald-600">命中 {p.matchedCount}</span>
            <span>·</span>
            <span className="text-amber-600">待确认 {p.suggestedCount}</span>
            <span>·</span>
            <span className="text-red-600">无匹配 {p.unmatchedCount}</span>
            <span>·</span>
            <span>外购 {p.externalCount}</span>
            <span>·</span>
            <span>忽略 {p.ignoredCount}</span>
          </div>
        </div>

        {(p.suggestedCount > 0 || aiLeft > 0) && p.view === "compare" && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
            {p.suggestedCount > 0 && (
              <Button size="sm" variant="outline" onClick={() => void p.adoptAllSuggestions()}>
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                一键采纳全部建议（{p.suggestedCount}）
              </Button>
            )}
            {aiLeft > 0 && (
              <Button size="sm" variant="outline" onClick={p.runAiMatch} disabled={p.busy}>
                {p.busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Brain className="mr-1 h-3.5 w-3.5" />}
                AI 语义匹配剩余 {aiLeft} 条（可选）
              </Button>
            )}
            <span className="text-xs text-muted-foreground">离线规则与记忆库已完成第一轮对照；AI 仅在你点击后运行。</span>
          </div>
        )}

        {p.busy && (
          <p className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            AI 语义匹配进行中，完成后未命中条目可人工指定…
          </p>
        )}

        {p.view === "compare" ? <CompareTable p={p} /> : <ChecklistTable p={p} />}

        <div className="mt-5 grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">映射结果名称 *</label>
            <Input value={p.name} onChange={(e) => p.setName(e.target.value)} placeholder="如：XX 市人民医院产品映射" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">客户医院</label>
            <Input value={p.hospital} onChange={(e) => p.setHospital(e.target.value)} placeholder="如：XX 市人民医院" />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={p.clearResult} className="text-muted-foreground hover:text-destructive">
            <Trash2 className="mr-1 h-4 w-4" />
            清空
          </Button>
          <Button variant="outline" onClick={() => void p.exportCompare()} className="border-border text-muted-foreground hover:text-foreground">
            <Download className="mr-1 h-4 w-4" />
            导出对照表
          </Button>
          <Button variant="outline" onClick={() => void p.exportCoverage()} className="border-border text-muted-foreground hover:text-foreground">
            <Download className="mr-1 h-4 w-4" />
            导出覆盖视角
          </Button>
          <Button onClick={() => void p.exportRatingCoverage()} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Download className="mr-1 h-4 w-4" />
            导出评级覆盖清单
          </Button>
          <Button variant="outline" onClick={() => void p.exportCompanyStandard()} className="border-border text-muted-foreground hover:text-foreground">
            <Download className="mr-1 h-4 w-4" />
            导出公司标准清单
          </Button>
          <Button variant="outline" onClick={() => skeletonRef.current?.click()} className="border-border text-muted-foreground hover:text-foreground">
            <FileUp className="mr-1 h-4 w-4" />
            骨架回填导出
          </Button>
          <input
            ref={skeletonRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void p.exportSkeleton(file)
              e.target.value = ""
            }}
          />
          <Button onClick={() => void p.saveMapping()} disabled={p.saving || p.busy || !p.name.trim()}>
            {p.saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            保存到建设清单
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function ProductMappingPage(p: UseProductMapping) {
  const [companyLibOpen, setCompanyLibOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const oneLinkRef = useRef<HTMLInputElement | null>(null)
  return (
    <div className="animate-in fade-in duration-500 text-foreground">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">产品映射</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            上传业主清单（Excel 原表保留），系统按「记忆库 → 离线规则」自动对照公司 ONE-LINK 标准清单；
            匹配不上的人工指定并自动记忆，下次同类条目自动命中。支持对照表与目录覆盖视角导出。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setMemoryOpen(true)} className="border-border text-muted-foreground hover:text-foreground">
            <Brain className="mr-1 h-4 w-4" />
            记忆库
          </Button>
          <Button variant="outline" onClick={() => setCompanyLibOpen(true)} className="border-border text-muted-foreground hover:text-foreground">
            <Database className="mr-1 h-4 w-4" />
            公司库
          </Button>
          <Button variant="outline" onClick={() => oneLinkRef.current?.click()} disabled={p.oneLinkBusy} className="border-border text-muted-foreground hover:text-foreground">
            {p.oneLinkBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
            导入 ONE-LINK 到公司库
          </Button>
          <input
            ref={oneLinkRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void p.previewOneLink(file)
              e.target.value = ""
            }}
          />
        </div>
      </header>

      {p.productsLoading && (
        <p className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          公司标准清单加载中…
        </p>
      )}

      <SourcePanel p={p} />

      {p.hasResult ? (
        <ResultSection p={p} />
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          上传清单或选择来源开始对照后，此处将按「原表列 + 映射列」展示对照结果。
        </p>
      )}

      <CostConfirmDialog {...p.costConfirm} />

      <UploadWizardDialog file={p.wizardFile} onClose={p.closeWizard} onConfirm={p.confirmWizard} />

      <MappingMemoryDialog
        open={memoryOpen}
        onOpenChange={setMemoryOpen}
        products={p.companyProducts}
        onChanged={p.reloadMappings}
      />

      <Dialog open={Boolean(p.oneLinkSummary)} onOpenChange={(open) => !open && p.cancelOneLink()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认导入 ONE-LINK 标准清单？</DialogTitle>
            <DialogDescription>
              工作表「{p.oneLinkSummary?.sheet ?? ""}」共解析出 {p.oneLinkSummary?.rowCount ?? 0} 个模块行、{p.oneLinkSummary?.productCount ?? 0} 个产品。
              确认后将写入公司标准库（check_products），已存在的映射记忆与对照结果不受影响。
            </DialogDescription>
          </DialogHeader>
          {p.oneLinkSummary && p.oneLinkSummary.filledColumns.length > 0 && (
            <p className="text-xs text-muted-foreground">已对合并列向下填充：{p.oneLinkSummary.filledColumns.join("、")}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={p.cancelOneLink} disabled={p.oneLinkBusy}>
              取消
            </Button>
            <Button onClick={() => void p.commitOneLink()} disabled={p.oneLinkBusy}>
              {p.oneLinkBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              确认导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CompanyLibraryDialog open={companyLibOpen} onOpenChange={setCompanyLibOpen} />
    </div>
  )
}

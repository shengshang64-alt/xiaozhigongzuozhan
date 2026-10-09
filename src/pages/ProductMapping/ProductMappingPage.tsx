import { useRef, useState } from "react"
import { ArrowLeftRight, Database, Download, FileUp, ListChecks, Loader2, Save, Sparkles, Table2, Trash2, Upload } from "lucide-react"
import { CompanyLibraryDialog } from "./CompanyLibraryDialog"
import { toast } from "sonner"
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
import { MatchKindBadge } from "@/components/solution-studio/checklist/ChecklistBadges"
import { calcTotal, fmtMoney, type ChecklistLine, type MatchRow } from "@/pages/SolutionStudio/checklistTypes"
import { candidateLabel, fieldText } from "./mappingCore"
import type { UseProductMapping } from "./useProductMapping"

// ---------------------------------------------------------------------------
// 产品映射 View：三来源建设清单输入 + ONE-LINK 一一对照 + 公司格式展示/导出
// ---------------------------------------------------------------------------

const SOURCE_TABS: { key: UseProductMapping["sourceTab"]; label: string }[] = [
  { key: "paste", label: "粘贴 / Excel" },
  { key: "bid", label: "从招标文件" },
  { key: "solution", label: "从方案 / 需求" },
]

const VIEWS: { key: "compare" | "checklist"; label: string; icon: typeof Table2 }[] = [
  { key: "compare", label: "一一对照", icon: ArrowLeftRight },
  { key: "checklist", label: "建设清单", icon: ListChecks },
]

/** 公司规范展示列（对齐 ONE-LINK《按公司规范》） */
const COMPANY_COLS: { key: Parameters<typeof fieldText>[1]; label: string }[] = [
  { key: "product_belong", label: "产品归属" },
  { key: "category", label: "产品类别" },
  { key: "product_name", label: "产品名称" },
  { key: "module_category", label: "模块分类" },
  { key: "module_name", label: "模块名称" },
  { key: "standard_name", label: "标准名称" },
  { key: "module_attr", label: "模块属性" },
  { key: "coefficient", label: "系数" },
  { key: "recommendation", label: "建议" },
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
  const [bidId, setBidId] = useState("")
  const [solId, setSolId] = useState("")

  const handleUpload = async (file: File) => {
    try {
      const { parseCustomerLinesFile } = await import("@/pages/SolutionStudio/checklistExports")
      const lines = await parseCustomerLinesFile(file)
      if (!lines.length) {
        toast.error("未从文件中解析到清单条目")
        return
      }
      p.startMatch(lines, lines.join("\n"))
    } catch {
      toast.error("Excel 解析失败，请检查文件内容")
    }
  }

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
            <Textarea
              rows={8}
              value={p.rawText}
              onChange={(e) => p.setRawText(e.target.value)}
              placeholder={"每行一个系统 / 模块条目，如：\n1. 电子病历系统（含质控）\n2、集成平台 V3.0\n(3) 门急诊挂号收费"}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => fileRef.current?.click()} className="border-border text-muted-foreground hover:text-foreground">
                <FileUp className="mr-1 h-4 w-4" />
                上传建设清单 Excel
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
              <SkillPickerFor scope="product-map" source={p.matchSkills} />
              <Button
                onClick={() => p.startMatch(p.rawText.split("\n"), p.rawText)}
                disabled={p.busy || p.productsLoading || !p.rawText.trim()}
              >
                {p.busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
                开始一一对照
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
      </CardContent>
    </Card>
  )
}

function CompareTable({ p }: { p: UseProductMapping }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
        <thead className="sticky top-0 bg-secondary/80 backdrop-blur">
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">客户条目</th>
            <th className="px-3 py-2 font-medium">匹配方式</th>
            {COMPANY_COLS.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-3 py-2 font-medium">
                {c.label}
              </th>
            ))}
            <th className="px-3 py-2 font-medium">备注</th>
            <th className="px-3 py-2 font-medium">调整</th>
          </tr>
        </thead>
        <tbody>
          {p.compareRows.map((r) => (
            <tr key={r.row_id} className={`border-b border-border/60 last:border-0 ${r.resolution === "ignore" ? "opacity-50" : ""}`}>
              <td className="px-3 py-2 text-foreground">{r.customer}</td>
              <td className="px-3 py-2">
                <MatchKindBadge kind={r.kind} />
              </td>
              {r.product ? (
                COMPANY_COLS.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-3 py-2 text-foreground">
                    {fieldText(r.product, c.key) || <span className="text-muted-foreground">—</span>}
                  </td>
                ))
              ) : (
                <>
                  <td className="px-3 py-2" colSpan={COMPANY_COLS.length}>
                    {r.resolution === "external" ? (
                      <span className="text-xs text-destructive">标为外购系统</span>
                    ) : r.resolution === "ignore" ? (
                      <span className="text-xs text-muted-foreground">已忽略</span>
                    ) : (
                      <span className="rounded-full border border-amber-400/50 bg-amber-100 px-2 py-0.5 text-xs text-amber-700">留空待人工</span>
                    )}
                  </td>
                </>
              )}
              <td className="px-3 py-2">
                <Input
                  className="h-8 w-40"
                  value={p.rowNotes[r.row_id] ?? ""}
                  onChange={(e) => p.setRowNote(r.row_id, e.target.value)}
                  placeholder="一对多其余/命名错位说明"
                  aria-label="备注"
                />
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1">
                  <Select value={r.product?.id ?? ""} onValueChange={(v) => p.setMatchProduct(r.row_id, v)}>
                    <SelectTrigger className="h-8 w-40">
                      <SelectValue placeholder="指定公司条目" />
                    </SelectTrigger>
                    <SelectContent>
                      {p.companyProducts.map((prod) => (
                        <SelectItem key={prod.id} value={prod.id}>
                          {candidateLabel(prod)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <ResolutionButtons row={r} onSet={(res) => p.setMatchResolution(r.row_id, res)} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ResolutionButtons({ row, onSet }: { row: { resolution: MatchRow["resolution"] }; onSet: (r: MatchRow["resolution"]) => void }) {
  return (
    <span className="flex gap-1">
      {row.resolution !== "company" && (
        <Button size="sm" variant="ghost" onClick={() => onSet("company")} className="px-2 text-muted-foreground hover:text-foreground">
          公司
        </Button>
      )}
      {row.resolution !== "external" && (
        <Button size="sm" variant="ghost" onClick={() => onSet("external")} className="px-2 text-muted-foreground hover:text-destructive">
          外购
        </Button>
      )}
      {row.resolution !== "ignore" && (
        <Button size="sm" variant="ghost" onClick={() => onSet("ignore")} className="px-2 text-muted-foreground hover:text-foreground">
          忽略
        </Button>
      )}
    </span>
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

function ResultSection({ p }: { p: UseProductMapping }) {
  const skeletonRef = useRef<HTMLInputElement | null>(null)
  return (
    <Card className="shadow-sm">
      <CardContent className="p-5">
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
            <span>命中 {p.matchedCount}</span>
            <span>·</span>
            <span>待人工 {p.unmatchedCount}</span>
            <span>·</span>
            <span>外购 {p.externalCount}</span>
            <span>·</span>
            <span>忽略 {p.ignoredCount}</span>
          </div>
        </div>

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
            导出一一对照
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
  // R-006 公司库查看入口：当前生效清单的浏览/查询/导出
  const [companyLibOpen, setCompanyLibOpen] = useState(false)
  const oneLinkRef = useRef<HTMLInputElement | null>(null)
  return (
    <div className="animate-in fade-in duration-500 text-foreground">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">产品映射</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            输入信息化「建设清单」，与我公司《智慧医院 ONE-LINK》标准清单逐条一一对照，AI 先匹配、未命中人工调整，支持公司格式展示与导出。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
          选择来源并「开始一一对照」后，此处将展示客户条目与我公司标准模块的对照结果。
        </p>
      )}

      <CostConfirmDialog {...p.costConfirm} />

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

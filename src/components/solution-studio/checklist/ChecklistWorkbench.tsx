import { useMemo, useState } from "react"
import { FileSpreadsheet, Plus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ProductLibraryPanel } from "@/components/solution-studio/checklist/ProductLibraryPanel"
import { ChecklistAmountCard } from "./ChecklistAmountCard"
import { ChecklistSteps } from "./ChecklistSteps"
import type { UseChecklist } from "@/pages/SolutionStudio/checklistLogic"
import {
  buildAmountBreakdown,
  buildChecklistSteps,
  formatBreakdownInline,
  recommendFromPeerChecklists,
  recommendFromRequirementText,
} from "@/pages/SolutionStudio/checklistSummary"
import {
  calcTotal,
  formatAmountWan,
  lineSubtotalYuan,
  mapRequirementSegments,
  type ChecklistLine,
} from "@/pages/SolutionStudio/checklistTypes"

const PAGE_DESC = (
  <>
    把客户需求原文转成<b>可报价的系统清单</b>，再一键转成方案大纲。清单独立于编辑器：它服务立项与报价，不参与正文写作。
  </>
)

export function ChecklistWorkbench({
  ck,
  onStartSolution,
  outlineGenerated = false,
  onImportRequest,
  onExportRequest,
}: {
  ck: UseChecklist
  onStartSolution: (checklistId: string) => void
  outlineGenerated?: boolean
  onImportRequest?: () => void
  onExportRequest?: () => void
}) {
  const rec = ck.activeChecklist
  const items = rec?.items ?? []
  const checkedItems = items.filter((l) => l.checked !== false)
  const uncheckedItems = items.filter((l) => l.checked === false)
  const raw = rec?.customer_raw ?? ""
  const segments = useMemo(() => mapRequirementSegments(raw, items), [raw, items])
  const breakdown = useMemo(() => buildAmountBreakdown(items), [items])
  const steps = useMemo(
    () =>
      buildChecklistSteps({
        segmentCount: segments.length,
        lineCount: items.length,
        checkedCount: checkedItems.length,
        outlineGenerated,
      }),
    [segments.length, items.length, checkedItems.length, outlineGenerated],
  )
  const recos = useMemo(() => {
    const fromText = recommendFromRequirementText(raw, items, ck.companyProducts)
    const fromPeers = recommendFromPeerChecklists(rec, ck.myChecklists)
    return [...fromText, ...fromPeers]
  }, [raw, items, ck.companyProducts, rec, ck.myChecklists])

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importDraft, setImportDraft] = useState("")
  const [addProductId, setAddProductId] = useState("")

  const openImport = () => {
    if (onImportRequest) {
      onImportRequest()
      return
    }
    if (!rec) {
      ck.openChecklistWizard()
      return
    }
    setImportDraft(rec.customer_raw ?? "")
    setImportOpen(true)
  }

  const handleExport = () => {
    if (onExportRequest) {
      onExportRequest()
      return
    }
    if (!rec) {
      toast.message("请先选择或生成清单")
      return
    }
    void import("@/pages/SolutionStudio/checklistExports").then(({ exportChecklistXlsx }) => exportChecklistXlsx(rec))
  }

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const mappedLineCount = new Set(segments.flatMap((s) => s.lineIds)).size

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground lg:text-2xl">建设清单</h1>
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">{PAGE_DESC}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            <span>
              客户 <b className="font-semibold text-foreground">{rec?.hospital?.trim() || "—"}</b>
            </span>
            <span>
              系统 <b className="font-semibold text-foreground">{items.length}</b> 项
            </span>
            <span>
              合计{" "}
              <b className="font-semibold text-foreground">
                {rec ? formatAmountWan(calcTotal(items)) : "—"}
              </b>
            </span>
            {ck.myChecklists.length > 1 ? (
              <button
                type="button"
                onClick={() => setSwitcherOpen(true)}
                className="text-xs text-primary hover:underline"
              >
                切换清单
              </button>
            ) : rec ? (
              <span className="text-xs text-muted-foreground">{rec.checklist_name}</span>
            ) : null}
            {ck.checklistSaveState === "error" ? (
              <button type="button" onClick={ck.retryChecklistSave} className="text-xs text-destructive hover:underline">
                保存失败，点击重试
              </button>
            ) : ck.checklistSaveState === "saving" ? (
              <span className="text-xs text-muted-foreground">保存中…</span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={openImport}>
            导入需求原文
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={!rec}>
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            导出清单 Excel
          </Button>
        </div>
      </div>

      <ChecklistSteps
        steps={steps}
        onStepClick={(key) => {
          if (key === 1) scrollTo("ck-req-card")
          if (key === 2) scrollTo("ck-list-card")
          if (key === 3) scrollTo("ck-amount-card")
        }}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(260px,0.9fr)]">
        <div className="flex flex-col gap-4">
          <section id="ck-list-card" className="rounded-xl border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <h3 className="text-[13.5px] font-semibold text-foreground">系统清单</h3>
              <span className="text-xs text-muted-foreground">
                {items.length} 项 · 已勾 {checkedItems.length} 项
              </span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setLibraryOpen(true)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  从产品库追加
                </button>
                <Button size="sm" variant="outline" onClick={() => (rec ? setAddOpen(true) : ck.openChecklistWizard())}>
                  ＋ 加系统
                </Button>
              </div>
            </div>
            <div className="px-2 py-2">
              {!rec ? (
                <EmptyHint text="还没有建设清单。导入需求原文或新建清单后，系统项会显示在这里。" action="新建清单" onAction={ck.openChecklistWizard} />
              ) : items.length === 0 ? (
                <EmptyHint text="清单还没有系统项。可手动加系统，或从产品库追加。" action="＋ 加系统" onAction={() => setAddOpen(true)} />
              ) : (
                items.map((line) => (
                  <SystemRow
                    key={line.line_id}
                    line={line}
                    expanded={expandedId === line.line_id}
                    onToggleExpand={() => setExpandedId((cur) => (cur === line.line_id ? null : line.line_id))}
                    onToggleChecked={() => ck.updateActiveLine(line.line_id, { checked: line.checked === false })}
                    onChange={(patch) => ck.updateActiveLine(line.line_id, patch)}
                    onRemove={() => ck.removeActiveLine(line.line_id)}
                  />
                ))
              )}
            </div>
            <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              {formatBreakdownInline(breakdown)}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-[13.5px] font-semibold text-foreground">一键从知识库推荐</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">按需求关键词 + 同区域中标记录</p>
            </div>
            <div className="flex flex-col gap-3 px-4 py-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const fromText = recommendFromRequirementText(raw, items, ck.companyProducts)
                    if (!fromText.length) {
                      toast.message("暂无推荐，请先完善需求原文或知识库")
                      return
                    }
                    let added = 0
                    for (const item of fromText) {
                      const id = item.id.startsWith("prod:") ? item.id.slice(5) : ""
                      if (id) {
                        ck.addActiveLineFromProduct(id)
                        added += 1
                      }
                    }
                    if (added) toast.success(`已追加 ${added} 个产品库推荐系统`)
                  }}
                >
                  从知识库推荐系统
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const fromPeers = recommendFromPeerChecklists(rec, ck.myChecklists)
                    if (!fromPeers.length) toast.message("暂无同类立项清单可参考")
                    else toast.message(`找到 ${fromPeers.length} 条同类清单参考，见下方推荐理由`)
                  }}
                >
                  参考同类立项清单
                </Button>
              </div>
              <div className="text-[13px] font-semibold text-foreground">推荐理由</div>
              {recos.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">暂无推荐，请先完善需求原文或知识库</p>
              ) : (
                recos.map((item, idx) => (
                  <div key={item.id} className="flex items-start gap-2 text-[13px] leading-relaxed">
                    <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">
                      {idx + 1}
                    </span>
                    <span className="text-foreground">{item.text}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <section id="ck-req-card" className="rounded-xl border border-border bg-card shadow-sm lg:col-span-1">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <h3 className="text-[13.5px] font-semibold text-foreground">需求原文</h3>
              <span className="text-xs text-muted-foreground">
                {segments.length} 段{mappedLineCount ? ` · 已映射 ${mappedLineCount} 条` : ""}
              </span>
              {segments.length > 0 && segments.every((s) => s.mapping === "mapped") ? (
                <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  已映射到清单
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-3 px-4 py-3">
              {segments.length === 0 ? (
                <EmptyHint text="还没有需求原文。导入后将按段展示，并尝试映射到系统清单。" action="导入需求原文" onAction={openImport} />
              ) : (
                segments.map((seg) => (
                  <div key={seg.id} className="rounded-lg border border-border px-3 py-2.5">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <MappingBadge mapping={seg.mapping} />
                      {seg.hitLabels.length ? (
                        <span className="text-[11px] text-muted-foreground">{seg.hitLabels.join(" / ")}</span>
                      ) : null}
                    </div>
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{seg.text}</p>
                  </div>
                ))
              )}
            </div>
          </section>

          <div id="ck-amount-card" className="flex flex-col gap-3">
            <ChecklistAmountCard
              breakdown={breakdown}
              checkedCount={checkedItems.length}
              onGenerateOutline={() => {
                if (!rec) {
                  toast.message("请先选择或生成清单")
                  return
                }
                if (checkedItems.length < 1) {
                  toast.message("请至少勾选 1 项系统再生成大纲")
                  return
                }
                onStartSolution(rec.id)
              }}
            />
            {uncheckedItems.length > 0 ? (
              <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
                <span className="mt-0.5 font-semibold">!</span>
                <div>
                  <b>{uncheckedItems.length} 项未勾选</b>
                  {uncheckedLabel(uncheckedItems)}会在大纲里缺少对应章节，投标时可能被判「未响应」。
                </div>
              </div>
            ) : null}
          </div>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>加系统</DialogTitle>
            <DialogDescription>从我公司产品库追加一行，或新增外购行。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Select value={addProductId} onValueChange={setAddProductId}>
              <SelectTrigger>
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
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="outline"
              onClick={() => {
                ck.addActiveExternalLine()
                setAddOpen(false)
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              外购行
            </Button>
            <Button
              disabled={!addProductId}
              onClick={() => {
                ck.addActiveLineFromProduct(addProductId)
                setAddProductId("")
                setAddOpen(false)
              }}
            >
              追加到清单
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>从产品库追加</DialogTitle>
            <DialogDescription>维护或挑选产品后，用「加系统」把条目写入当前清单。</DialogDescription>
          </DialogHeader>
          <ProductLibraryPanel ck={ck} />
        </DialogContent>
      </Dialog>

      <Dialog open={switcherOpen} onOpenChange={setSwitcherOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>切换清单</DialogTitle>
            <DialogDescription>选择要在本屏打开的建设清单。</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-1 overflow-y-auto">
            {ck.myChecklists.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  ck.openChecklistDetail(item.id)
                  setSwitcherOpen(false)
                }}
                className={`flex w-full flex-col rounded-md border px-3 py-2 text-left text-sm ${
                  rec?.id === item.id ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/50"
                }`}
              >
                <span className="font-medium">{item.checklist_name || "未命名清单"}</span>
                <span className="text-xs text-muted-foreground">
                  {item.hospital || "—"} · {(item.items ?? []).length} 项
                </span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSwitcherOpen(false)
                ck.openChecklistWizard()
              }}
            >
              新建清单
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>导入需求原文</DialogTitle>
            <DialogDescription>粘贴客户需求文本，保存后显示在本屏「需求原文」卡，不会另起一份清单。</DialogDescription>
          </DialogHeader>
          <Textarea
            value={importDraft}
            onChange={(e) => setImportDraft(e.target.value)}
            rows={12}
            placeholder="粘贴客户需求原文，可按段落或条目换行…"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                ck.updateActiveCustomerRaw(importDraft)
                setImportOpen(false)
                toast.success("需求原文已保存到本清单")
              }}
            >
              保存到需求原文
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EmptyHint({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <div className="px-2 py-6 text-center">
      <p className="text-[13px] text-muted-foreground">{text}</p>
      <Button size="sm" variant="outline" className="mt-3" onClick={onAction}>
        {action}
      </Button>
    </div>
  )
}

function MappingBadge({ mapping }: { mapping: "mapped" | "partial" | "unmapped" }) {
  const map = {
    mapped: "bg-emerald-50 text-emerald-700",
    partial: "bg-amber-50 text-amber-800",
    unmapped: "bg-muted text-muted-foreground",
  } as const
  const label = { mapped: "已映射", partial: "部分映射", unmapped: "未映射" } as const
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${map[mapping]}`}>{label[mapping]}</span>
}

function uncheckedLabel(items: ChecklistLine[]): string {
  const names = items.map((l) => (l.product_name ?? "").trim()).filter(Boolean)
  if (!names.length) return " "
  const shown = names.slice(0, 3).join("、")
  const extra = names.length > 3 ? "等" : ""
  return `（${shown}${extra}）`
}

function SystemRow({
  line,
  expanded,
  onToggleExpand,
  onToggleChecked,
  onChange,
  onRemove,
}: {
  line: ChecklistLine
  expanded: boolean
  onToggleExpand: () => void
  onToggleChecked: () => void
  onChange: (patch: Partial<ChecklistLine>) => void
  onRemove: () => void
}) {
  const name = line.product_name || line.module_name || "未命名系统"
  return (
    <div className={`rounded-md px-2 ${line.checked === false ? "opacity-70" : ""}`}>
      <div className="flex items-center gap-2 py-1.5">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={line.checked !== false}
            onChange={onToggleChecked}
            className="h-4 w-4 accent-primary"
          />
          <button type="button" onClick={onToggleExpand} className="min-w-0 flex-1 truncate text-left text-foreground">
            {name}
            {line.module_name && line.product_name && line.module_name !== line.product_name ? (
              <span className="text-muted-foreground"> · {line.module_name}</span>
            ) : null}
          </button>
        </label>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {formatAmountWan(lineSubtotalYuan(line))}
        </span>
      </div>
      {expanded ? (
        <div className="mb-2 ml-6 grid grid-cols-2 gap-2 rounded-md border border-border bg-secondary/30 p-2 sm:grid-cols-4">
          <label className="text-[11px] text-muted-foreground">
            数量
            <Input
              type="number"
              min={0}
              className="mt-1 h-8"
              value={line.qty}
              onChange={(e) => onChange({ qty: Number(e.target.value) || 0 })}
            />
          </label>
          <label className="text-[11px] text-muted-foreground">
            单位
            <Input className="mt-1 h-8" value={line.unit} onChange={(e) => onChange({ unit: e.target.value })} />
          </label>
          <label className="text-[11px] text-muted-foreground">
            单价（元）
            <Input
              type="number"
              min={0}
              className="mt-1 h-8"
              value={line.unit_price}
              onChange={(e) => onChange({ unit_price: Number(e.target.value) || 0 })}
            />
          </label>
          <label className="text-[11px] text-muted-foreground">
            备注
            <Input className="mt-1 h-8" value={line.remark} onChange={(e) => onChange({ remark: e.target.value })} />
          </label>
          <div className="col-span-full">
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={onRemove}>
              删除此行
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

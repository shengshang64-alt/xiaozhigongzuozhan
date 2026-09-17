import { useRef, useState } from "react"
import {
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Download,
  FileUp,
  ListChecks,
  Loader2,
  Plus,
  Save,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
} from "lucide-react"
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
import {
  downloadProductTemplate,
  exportProducts,
  parseProductFile,
} from "@/pages/SolutionStudio/checklistExports"
import {
  PRODUCT_STATUS_OPTIONS,
  RATING_GROUPS,
  type CheckProduct,
  type ProductDraft,
  type RatingGroupKey,
} from "@/pages/SolutionStudio/checklistTypes"
import type { UseChecklist } from "@/pages/SolutionStudio/checklistLogic"

// ---------------------------------------------------------------------------
// 产品库：我公司产品（可增删改 + Excel 导入导出 + 技术参数库）/ 行业标准系统库（只读 + 纳入）
// ---------------------------------------------------------------------------

function RatingTagsCell({ product }: { product: CheckProduct }) {
  const tags = product.rating_tags ?? {}
  const chips = RATING_GROUPS.filter((g) => (tags[g.key] ?? []).length).map(
    (g) => `${g.short} ${(tags[g.key] ?? []).join("/")}`,
  )
  if (!chips.length) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <span className="flex max-w-56 flex-wrap gap-1">
      {chips.map((c) => (
        <span key={c} className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          {c}
        </span>
      ))}
    </span>
  )
}

function ProductTable({
  rows,
  readonly,
  onEdit,
  onDelete,
  onAdopt,
  onEditParams,
  selectMode,
  selectedIds,
  onToggleSelect,
  emptyTitle,
  emptyHint,
}: {
  rows: CheckProduct[]
  readonly: boolean
  onEdit?: (p: CheckProduct) => void
  onDelete?: (p: CheckProduct) => void
  onAdopt?: (p: CheckProduct) => void
  /** 轮次 E-3：技术参数编辑（我公司产品页签） */
  onEditParams?: (p: CheckProduct) => void
  /** 轮次 E-3：多选模式（导出参数响应表） */
  selectMode?: boolean
  selectedIds?: string[]
  onToggleSelect?: (id: string) => void
  /** 循环 6 C3：空态两行式引导（标题 + 指引文案），缺省回退「暂无数据」 */
  emptyTitle?: string
  emptyHint?: string
}) {
  const columnCount = 9 + (selectMode ? 1 : 0)
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[860px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/60 text-xs text-muted-foreground">
            {selectMode && <th className="w-10 px-3 py-2 font-medium">选</th>}
            <th className="px-3 py-2 font-medium">类别</th>
            <th className="px-3 py-2 font-medium">产品线</th>
            <th className="px-3 py-2 font-medium">产品名称</th>
            <th className="px-3 py-2 font-medium">模块 / 功能</th>
            <th className="px-3 py-2 font-medium">计费方式</th>
            <th className="px-3 py-2 font-medium">单价</th>
            <th className="px-3 py-2 font-medium">状态</th>
            <th className="px-3 py-2 font-medium">评级关联</th>
            <th className="px-3 py-2 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const paramCount = (p.tech_params ?? []).length
            const selected = selectedIds?.includes(p.id) ?? false
            return (
              <tr key={p.id} className="border-b border-border/60 last:border-0 hover:bg-secondary/40">
                {selectMode && (
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onToggleSelect?.(p.id)}
                      title={selected ? "取消勾选" : "勾选后可导出参数响应表"}
                      className="text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {selected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                    </button>
                  </td>
                )}
                <td className="px-3 py-2 text-muted-foreground">{p.category || "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.product_line || "—"}</td>
                <td className="px-3 py-2 font-medium text-foreground">{p.product_name}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {p.module_name}
                  {p.module_func ? ` · ${p.module_func}` : ""}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{p.charge_mode || "—"}</td>
                <td className="px-3 py-2 text-foreground">{Number(p.unit_price) ? Number(p.unit_price).toLocaleString("zh-CN") : "—"}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      p.status === "在售" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {p.status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <RatingTagsCell product={p} />
                </td>
                <td className="px-3 py-2">
                  {readonly ? (
                    <Button size="sm" variant="ghost" onClick={() => onAdopt?.(p)} className="text-primary hover:bg-primary/10">
                      纳入我公司
                    </Button>
                  ) : (
                    <span className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => onEditParams?.(p)} className="text-muted-foreground hover:text-primary" title="维护技术参数与竞品备注">
                        <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
                        参数
                        {paramCount > 0 && (
                          <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">{paramCount}</span>
                        )}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onEdit?.(p)} className="text-muted-foreground hover:text-foreground">
                        编辑
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onDelete?.(p)} className="text-muted-foreground hover:text-destructive">
                        删除
                      </Button>
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
          {!rows.length && (
            <tr>
              <td colSpan={columnCount} className="px-3 py-16 text-center">
                <p className="text-sm font-medium text-foreground">{emptyTitle ?? "暂无数据"}</p>
                <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
                  {emptyHint ?? "添加数据后会自动显示在这里"}
                </p>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function DraftRatingEditor({ draft, onChange }: { draft: ProductDraft; onChange: (next: ProductDraft) => void }) {
  const toggle = (groupKey: RatingGroupKey, value: string) => {
    const cur = draft.rating_tags[groupKey] ?? []
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
    onChange({ ...draft, rating_tags: { ...draft.rating_tags, [groupKey]: next } })
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {RATING_GROUPS.map((g) => (
        <div key={g.key} className="rounded-lg border border-border bg-secondary/40 p-3">
          <p className="text-xs font-medium text-foreground">{g.label}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {g.levels.map((lv) => {
              const on = (draft.rating_tags[g.key] ?? []).includes(lv.value)
              return (
                <button
                  key={lv.value}
                  type="button"
                  onClick={() => toggle(g.key, lv.value)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    on
                      ? "border-primary bg-primary text-primary-foreground"
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
    </div>
  )
}

/** 技术参数编辑对话框（轮次 E-3）：行内编辑 + 增删行 + 上移下移，400ms 防抖自动保存 */
function TechParamDialog({ ck }: { ck: UseChecklist }) {
  const product = ck.paramProduct
  return (
    <Dialog open={ck.paramDialogOpen} onOpenChange={(open) => !open && ck.requestCloseParamEditor()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            技术参数 · {product?.product_name ?? ""}
            {product?.module_name ? <span className="ml-1.5 text-sm font-normal text-muted-foreground">{product.module_name}</span> : null}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            参数名与参数值必填，竞品对比备注选填；编辑后自动保存，导出参数响应表时逐参数一行
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-2">
          {ck.paramDraft.length === 0 && (
            <p className="rounded-lg border border-dashed border-border bg-secondary/40 px-3 py-8 text-center text-xs text-muted-foreground">
              还没有技术参数，点击下方「添加参数」开始维护
            </p>
          )}
          {ck.paramDraft.map((row, i) => (
            <div key={i} className="grid grid-cols-1 items-center gap-2 rounded-lg border border-border bg-secondary/30 p-2 sm:grid-cols-[minmax(0,5fr)_minmax(0,5fr)_minmax(0,6fr)_auto]">
              <Input
                value={row.param_name}
                onChange={(e) => ck.setParamRow(i, { param_name: e.target.value })}
                placeholder="参数名 *（如：并发用户数）"
                className="h-8 text-xs"
              />
              <Input
                value={row.param_value}
                onChange={(e) => ck.setParamRow(i, { param_value: e.target.value })}
                placeholder="参数值 *（如：≥5000）"
                className="h-8 text-xs"
              />
              <Input
                value={row.competitor_note ?? ""}
                onChange={(e) => ck.setParamRow(i, { competitor_note: e.target.value })}
                placeholder="竞品对比备注（选填）"
                className="h-8 text-xs"
              />
              <span className="flex items-center gap-0.5">
                <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => ck.moveParamRow(i, -1)} title="上移" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" disabled={i === ck.paramDraft.length - 1} onClick={() => ck.moveParamRow(i, 1)} title="下移" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => ck.removeParamRow(i)} title="删除该参数" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <Button size="sm" variant="outline" onClick={ck.addParamRow} className="border-primary/40 text-primary hover:bg-primary/10 hover:text-primary">
            <Plus className="mr-1 h-3.5 w-3.5" />
            添加参数
          </Button>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {ck.paramDirty && (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                保存中…
              </>
            )}
            <Button size="sm" variant="ghost" onClick={ck.requestCloseParamEditor} className="text-muted-foreground hover:text-foreground">
              关闭
            </Button>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ProductLibraryPanel({ ck }: { ck: UseChecklist }) {
  const [libTab, setLibTab] = useState<"company" | "industry">("company")
  const fileRef = useRef<HTMLInputElement | null>(null)
  const draft = ck.productDraft

  const handleImportFile = async (file: File) => {
    try {
      const rows = await parseProductFile(file)
      await ck.importProductRows(rows)
    } catch {
      toast.error("Excel 解析失败，请使用模板格式")
    }
  }

  return (
    <section className="flex h-full flex-col rounded-2xl border border-border bg-card p-4 shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-secondary p-1">
          <button
            type="button"
            onClick={() => setLibTab("company")}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              libTab === "company" ? "bg-card font-medium text-card-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            我公司产品
          </button>
          <button
            type="button"
            onClick={() => setLibTab("industry")}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              libTab === "industry" ? "bg-card font-medium text-card-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            行业标准系统库
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {libTab === "company" ? (
            <>
              {ck.paramSelectMode ? (
                <>
                  <span className="text-xs text-muted-foreground">已选 {ck.selectedProductIds.length} 个产品</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={ck.exportSelectedTechParams}
                    disabled={ck.selectedProductIds.length === 0}
                    title={ck.selectedProductIds.length === 0 ? "先勾选要导出的产品" : "导出所选产品的参数响应表 .xlsx"}
                    className="border-primary/40 text-primary hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                  >
                    <Download className="mr-1 h-3.5 w-3.5" />
                    导出参数响应表
                  </Button>
                  <Button size="sm" variant="ghost" onClick={ck.toggleParamSelectMode} className="text-muted-foreground hover:text-foreground">
                    <X className="mr-1 h-3.5 w-3.5" />
                    退出多选
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={ck.toggleParamSelectMode} className="border-border text-muted-foreground hover:text-foreground" title="勾选若干产品后导出参数响应表">
                  <ListChecks className="mr-1 h-3.5 w-3.5" />
                  多选导出参数
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => downloadProductTemplate()} className="border-border text-muted-foreground hover:text-foreground">
                <Download className="mr-1 h-3.5 w-3.5" />
                下载模板
              </Button>
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={ck.importBusy} className="border-border text-muted-foreground hover:text-foreground">
                <FileUp className="mr-1 h-3.5 w-3.5" />
                {ck.importBusy ? "导入中…" : "Excel 导入"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => exportProducts(ck.companyProducts)} className="border-border text-muted-foreground hover:text-foreground">
                <Download className="mr-1 h-3.5 w-3.5" />
                导出
              </Button>
              <Button size="sm" onClick={ck.openAddCompanyProduct} className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90">
                <Plus className="mr-1 h-4 w-4" />
                新增产品
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={ck.openAddIndustryProduct} className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90">
              <Plus className="mr-1 h-4 w-4" />
              补充行业系统
            </Button>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleImportFile(file)
          e.target.value = ""
        }}
      />

      {ck.seeding && (
        <p className="mt-3 flex items-center gap-1.5 rounded-lg border border-border bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          正在初始化行业标准系统库与示例产品，请稍候…
        </p>
      )}

      <div className="mt-3">
        {ck.productsLoading ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">产品库加载中…</p>
          </div>
        ) : libTab === "company" ? (
          <ProductTable
            rows={ck.companyProducts}
            readonly={false}
            onEdit={ck.openEditProduct}
            onDelete={(p) => void ck.deleteProduct(p.id)}
            onEditParams={ck.openParamEditor}
            selectMode={ck.paramSelectMode}
            selectedIds={ck.selectedProductIds}
            onToggleSelect={ck.toggleProductSelect}
            emptyTitle="暂无我公司产品"
            emptyHint="点右上角「新增产品」手动添加，或用「Excel 导入」批量录入（可先「下载模板」按格式填写）"
          />
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              行业库覆盖电子病历 / 互联互通 / 智慧服务 / 智慧管理四级评级涉及系统，只读浏览；「纳入我公司」可复制为可编辑行。
            </p>
            <ProductTable
              rows={ck.industryProducts}
              readonly
              onAdopt={(p) => void ck.adoptIndustryRow(p)}
              emptyTitle="暂无行业标准系统"
              emptyHint="行业库会在首次使用时自动初始化，请稍候；若长时间为空可点右上角「补充行业系统」手动添加"
            />
          </>
        )}
      </div>

      <Dialog open={ck.productDialogOpen} onOpenChange={(open) => !open && ck.closeProductDialog()}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground">
              {ck.productDraftId ? "编辑产品" : draft?.is_builtin ? "补充行业系统" : "新增我公司产品"}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              评级关联标签决定路径 A 自动勾选范围，按档位多选
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">产品类别</label>
                <Input value={draft.category} onChange={(e) => ck.setProductDraft({ ...draft, category: e.target.value })} placeholder="如：临床诊疗" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">产品线</label>
                <Input value={draft.product_line} onChange={(e) => ck.setProductDraft({ ...draft, product_line: e.target.value })} placeholder="如：HIS" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">产品名称 *</label>
                <Input value={draft.product_name} onChange={(e) => ck.setProductDraft({ ...draft, product_name: e.target.value })} placeholder="如：电子病历" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">模块名称</label>
                <Input value={draft.module_name} onChange={(e) => ck.setProductDraft({ ...draft, module_name: e.target.value })} placeholder="如：病历质控" />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-foreground">模块功能</label>
                <Input value={draft.module_func} onChange={(e) => ck.setProductDraft({ ...draft, module_func: e.target.value })} placeholder="一句话说明模块能力" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">计费方式</label>
                <Input value={draft.charge_mode} onChange={(e) => ck.setProductDraft({ ...draft, charge_mode: e.target.value })} placeholder="系统授权 / 模块授权 / 年服务费" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">单价（元）</label>
                <Input
                  type="number"
                  value={draft.unit_price}
                  onChange={(e) => ck.setProductDraft({ ...draft, unit_price: Number(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">状态</label>
                <Select value={draft.status} onValueChange={(v) => ck.setProductDraft({ ...draft, status: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRODUCT_STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-foreground">说明</label>
                <Textarea rows={2} value={draft.description} onChange={(e) => ck.setProductDraft({ ...draft, description: e.target.value })} placeholder="选填" />
              </div>
              <div className="sm:col-span-2">
                <DraftRatingEditor draft={draft} onChange={ck.setProductDraft} />
              </div>
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <Button onClick={() => void ck.saveProductDraft()} disabled={ck.productSaving} className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90">
              <Save className="mr-1 h-4 w-4" />
              {ck.productSaving ? "保存中…" : "保存"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <TechParamDialog ck={ck} />
    </section>
  )
}

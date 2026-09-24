import { useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { calcTotal, fmtMoney, type ChecklistRecord } from "@/pages/SolutionStudio/checklistTypes"

type ChecklistImportDialogProps = {
  open: boolean
  onClose: () => void
  checklists: ChecklistRecord[]
  loading: boolean
  onConfirm: (checklistId: string, opts: { zeroPrice: boolean }) => void
}

/**
 * 报价「从建设清单导入」：选一份 ChecklistRecord → 一键把所有已勾选行项带入报价。
 * 支持两种价格策略：置零等待录入（默认）/ 直接沿用清单单价。
 * 重复项由 mergeItemsIntoGroups 按 lineKey 去重，UI 不再关心。
 */
export function ChecklistImportDialog({ open, onClose, checklists, loading, onConfirm }: ChecklistImportDialogProps) {
  const [selectedId, setSelectedId] = useState("")
  const [zeroPrice, setZeroPrice] = useState(true)
  const rec = useMemo(() => checklists.find((c) => c.id === selectedId) ?? null, [checklists, selectedId])
  const keptLines = (rec?.items ?? []).filter((l) => l.checked !== false)
  const preview = keptLines.slice(0, 5)
  const total = keptLines.length

  const closeAll = () => {
    setSelectedId("")
    onClose()
  }
  const confirm = () => {
    if (!selectedId) return
    onConfirm(selectedId, { zeroPrice })
    setSelectedId("")
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && closeAll()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-foreground">从建设清单导入报价</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            选择一份清单，一键把所有已勾选行项带入报价（同 product 已存在时自动跳过）
          </DialogDescription>
        </DialogHeader>
        {loading && !checklists.length ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            加载清单…
          </p>
        ) : checklists.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            还没有建设清单。先到「方案工作台 → 建设清单」创建一份，或直接在报价里「从产品库追加」。
          </p>
        ) : (
          <>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="ck-import-select">
              选择清单
            </label>
            <select
              id="ck-import-select"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">— 请选择 —</option>
              {checklists.map((c) => {
                const n = (c.items ?? []).filter((l) => l.checked !== false).length
                return (
                  <option key={c.id} value={c.id}>
                    {c.checklist_name}
                    {c.hospital ? ` · ${c.hospital}` : ""}（{n} 条）
                  </option>
                )
              })}
            </select>
            {rec && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  共 {total} 条已勾选行项，清单合计 {fmtMoney(calcTotal(rec.items ?? []))}；导入时按类别自动分组。
                </p>
                {preview.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
                    该清单暂无已勾选行项
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-md border border-border">
                    <table className="w-full border-collapse text-xs">
                      <thead className="bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-medium">类别</th>
                          <th className="px-2 py-1.5 text-left font-medium">产品</th>
                          <th className="px-2 py-1.5 text-left font-medium">模块</th>
                          <th className="px-2 py-1.5 text-right font-medium">数量</th>
                          <th className="px-2 py-1.5 text-right font-medium">单价</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((l) => (
                          <tr key={l.line_id} className="border-t border-border/60">
                            <td className="px-2 py-1 text-muted-foreground">{l.category || "未分类"}</td>
                            <td className="px-2 py-1">{l.product_name}</td>
                            <td className="px-2 py-1 text-muted-foreground">{l.module_name || l.module_func || "—"}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{l.qty}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(l.unit_price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {total > preview.length && (
                  <p className="text-xs text-muted-foreground">（预览仅显示前 {preview.length} 条，导入全部 {total} 条）</p>
                )}
                <div className="mt-2 space-y-1">
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <input
                      type="radio"
                      name="ck-import-zeroPrice"
                      checked={zeroPrice}
                      onChange={() => setZeroPrice(true)}
                      className="h-3.5 w-3.5 accent-[color:var(--primary)]"
                    />
                    <span>价格置零，稍后在报价中录入（推荐 · 与产品库参考价独立）</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <input
                      type="radio"
                      name="ck-import-zeroPrice"
                      checked={!zeroPrice}
                      onChange={() => setZeroPrice(false)}
                      className="h-3.5 w-3.5 accent-[color:var(--primary)]"
                    />
                    <span>直接带入清单单价（沿用建设清单当前价格）</span>
                  </label>
                </div>
              </div>
            )}
          </>
        )}
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="mr-auto text-xs text-muted-foreground">
            {rec ? `将导入 ${total} 条行项` : "先选择一份清单"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={closeAll}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              取消
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!selectedId || !total}
              className="rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              导入报价
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

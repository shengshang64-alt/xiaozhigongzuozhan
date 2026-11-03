import { useEffect, useMemo, useState } from "react"
import { Loader2, Table2, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import {
  extractCustomerTable,
  gridWidth,
  guessHeaderRow,
  guessNameCols,
  headerLabels,
  readWorkbookGrids,
  findWizardTemplate,
  saveWizardTemplate,
  type SheetGrid,
} from "./uploadWizard"

// ---------------------------------------------------------------------------
// 上传向导（2026-10-28 重构）：任意业主 Excel → 选 sheet / 表头行 / 名称列 →
// 预览 → 确认开始对照。解析配置按「表头指纹」记忆，下次同结构文件自动预填。
// ---------------------------------------------------------------------------

export function UploadWizardDialog({
  file,
  onClose,
  onConfirm,
}: {
  file: File | null
  onClose: () => void
  onConfirm: (parsed: ReturnType<typeof extractCustomerTable>) => void
}) {
  const [grids, setGrids] = useState<SheetGrid[]>([])
  const [loading, setLoading] = useState(true)
  const [sheetName, setSheetName] = useState("")
  const [headerRow, setHeaderRow] = useState(1) // 展示用 1 起
  const [nameCols, setNameCols] = useState<number[]>([])
  const [templateHit, setTemplateHit] = useState(false)

  // 读文件 → 猜初始配置 → 命中模板则预填（延迟一拍启动：set-state-in-effect 口径，同 CompanyLibraryDialog 先例）
  useEffect(() => {
    if (!file) return
    let cancelled = false
    const t = setTimeout(() => {
      if (cancelled) return
      setLoading(true)
      setTemplateHit(false)
      setGrids([])
      void (async () => {
        try {
          const gs = await readWorkbookGrids(file)
          if (cancelled) return
          setGrids(gs)
          const first = gs[0]
          const hr = guessHeaderRow(first.rows)
          const w = gridWidth(first.rows)
          let cfg = { sheetName: first.name, headerRow: hr, nameCols: guessNameCols(first.rows, hr, w) }
          // 模板记忆：同一表头结构 → 上次确认的解析配置
          const tpl = findWizardTemplate(headerLabels(first.rows, hr, w))
          if (tpl && gs.some((g) => g.name === tpl.sheetName)) {
            cfg = { sheetName: tpl.sheetName, headerRow: tpl.headerRow, nameCols: tpl.nameCols }
            setTemplateHit(true)
          }
          setSheetName(cfg.sheetName)
          setHeaderRow(cfg.headerRow + 1)
          setNameCols(cfg.nameCols)
        } catch {
          if (!cancelled) {
            toast.error("Excel 解析失败，请检查文件内容")
            onClose()
          }
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  const grid = useMemo(() => grids.find((g) => g.name === sheetName) ?? grids[0], [grids, sheetName])
  const width = useMemo(() => (grid ? gridWidth(grid.rows) : 0), [grid])
  const labels = useMemo(() => (grid ? headerLabels(grid.rows, headerRow - 1, width) : []), [grid, headerRow, width])

  const parsed = useMemo(() => {
    if (!grid || !nameCols.length) return null
    return extractCustomerTable(grid, { sheetName: grid.name, headerRow: headerRow - 1, nameCols })
  }, [grid, headerRow, nameCols])

  const switchSheet = (name: string) => {
    setSheetName(name)
    const g = grids.find((x) => x.name === name)
    if (!g) return
    const hr = guessHeaderRow(g.rows)
    setHeaderRow(hr + 1)
    setNameCols(guessNameCols(g.rows, hr, gridWidth(g.rows)))
  }

  const changeHeaderRow = (v: number) => {
    if (!grid) return
    const hr = Math.max(1, Math.min(v, Math.min(grid.rows.length, 30)))
    setHeaderRow(hr)
    setNameCols(guessNameCols(grid.rows, hr - 1, width))
  }

  const toggleCol = (c: number) => {
    setNameCols((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c].sort((a, b) => a - b)))
  }

  const confirm = () => {
    if (!parsed || !parsed.items.length) {
      toast.error("当前配置没有解析到有效条目，请调整表头行 / 名称列")
      return
    }
    saveWizardTemplate({
      sheetName: parsed.sheetName,
      headerRow: parsed.headerRow,
      nameCols: parsed.nameCols,
      headers: parsed.columns,
      savedAt: new Date().toISOString(),
    })
    onConfirm(parsed)
  }

  const previewRows = useMemo(() => {
    if (!grid) return []
    const out: { r: number; cells: string[] }[] = []
    for (let r = headerRow - 1; r < Math.min(grid.rows.length, headerRow + 7); r++) {
      const cells: string[] = []
      for (let c = 0; c < width; c++) cells.push((grid.rows[r] ?? [])[c] ?? "")
      out.push({ r, cells })
    }
    return out
  }, [grid, headerRow, width])

  return (
    <Dialog open={Boolean(file)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[88vh] w-[94vw] max-w-5xl flex-col">
        <DialogHeader>
          <DialogTitle>上传清单 · 解析向导</DialogTitle>
          <DialogDescription>
            确认「工作表 / 表头行 / 名称列」三件事，其余列会原样保留进对照表。同结构的表格下次会自动套用本次配置。
          </DialogDescription>
        </DialogHeader>

        {loading || !grid ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />正在解析 {file?.name} …
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-56">
                <label className="mb-1 block text-xs font-medium text-foreground">工作表</label>
                <Select value={grid.name} onValueChange={switchSheet}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {grids.map((g) => (
                      <SelectItem key={g.name} value={g.name}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-32">
                <label className="mb-1 block text-xs font-medium text-foreground">表头行（第几行）</label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={headerRow}
                  onChange={(e) => changeHeaderRow(Number(e.target.value) || 1)}
                />
              </div>
              <div className="min-w-72 flex-1">
                <label className="mb-1 block text-xs font-medium text-foreground">
                  名称列（参与匹配的列，可多选拼接）
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {labels.map((lb, c) => {
                    const on = nameCols.includes(c)
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggleCol(c)}
                        className={`rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                          on
                            ? "border-primary bg-primary/10 font-medium text-primary"
                            : "border-border bg-card text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {lb}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {templateHit && (
              <p className="mt-2 flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-primary">
                <Wand2 className="h-3.5 w-3.5" />
                已套用上次同结构表格的解析配置（模板记忆），确认无误后直接开始对照即可。
              </p>
            )}

            <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-secondary/80 backdrop-blur">
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="w-14 px-2 py-1.5 font-medium">行号</th>
                    {labels.map((lb, c) => (
                      <th key={c} className={`whitespace-nowrap px-2 py-1.5 font-medium ${nameCols.includes(c) ? "text-primary" : ""}`}>
                        {lb}
                        {nameCols.includes(c) ? " ✓" : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map(({ r, cells }) => (
                    <tr key={r} className={`border-b border-border/60 last:border-0 ${r === headerRow - 1 ? "bg-secondary/50 font-medium" : ""}`}>
                      <td className="px-2 py-1.5 text-muted-foreground">{r + 1}{r === headerRow - 1 ? "（表头）" : ""}</td>
                      {cells.map((cell, c) => (
                        <td key={c} className={`min-w-20 whitespace-pre-wrap break-words px-2 py-1.5 ${nameCols.includes(c) ? "bg-primary/5 text-foreground" : "text-muted-foreground"}`}>
                          {cell || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Table2 className="h-3.5 w-3.5" />
                预计解析出 <b className="text-foreground">{parsed?.items.length ?? 0}</b> 条清单条目
                {parsed?.skippedEmpty ? `（${parsed.skippedEmpty} 行名称列为空已跳过）` : ""}
              </span>
              <DialogFooter className="sm:justify-end">
                <Button variant="outline" onClick={onClose}>取消</Button>
                <Button onClick={confirm} disabled={!parsed || !parsed.items.length}>开始一一对照</Button>
              </DialogFooter>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

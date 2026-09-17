import { Fragment, useMemo, useState } from "react"
import { ArrowLeft, FileSpreadsheet, FileText, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { exportChecklistXlsx } from "@/pages/SolutionStudio/checklistExports"
import { calcTotal, fmtMoney, targetLabel, type ChecklistLine } from "@/pages/SolutionStudio/checklistTypes"
import type { UseChecklist } from "@/pages/SolutionStudio/checklistLogic"
import { RatingHitsBadges, SourceBadge } from "./ChecklistBadges"

// ---------------------------------------------------------------------------
// 清单详情：分组表格行内编辑 + 合计 + 导出 Excel + 带入方案
// ---------------------------------------------------------------------------

export function ChecklistDetailPanel({
  ck,
  onStartSolution,
}: {
  ck: UseChecklist
  onStartSolution: (checklistId: string) => void
}) {
  const rec = ck.activeChecklist
  const [addProductId, setAddProductId] = useState("")

  const groups = useMemo(() => {
    const map = new Map<string, ChecklistLine[]>()
    for (const line of (rec?.items ?? []).filter((l) => l.checked !== false)) {
      const key = line.category || "未分类"
      map.set(key, [...(map.get(key) ?? []), line])
    }
    return Array.from(map.entries())
  }, [rec])

  if (!rec) return null

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={ck.closeChecklistDetail}
            className="mb-2 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md px-1 py-0.5"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回清单列表
          </button>
          <h3 className="text-xl font-bold text-foreground">{rec.checklist_name}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {rec.hospital || "未填医院"} · {rec.source_mode === "rating" ? "评级匹配生成" : "客户清单匹配生成"} · 更新于{" "}
            {(rec.updated ?? "").slice(0, 10)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {(rec.rating_targets ?? []).map((code) => (
              <span key={code} className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">
                {targetLabel(code)}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ck.checklistSaveState === "error" ? (
            <button
              type="button"
              onClick={ck.retryChecklistSave}
              title="点击重新保存"
              className="badge-danger cursor-pointer transition-colors hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
            >
              保存失败，点击重试
            </button>
          ) : ck.checklistSaveState === "saving" ? (
            <span className="badge-neutral">保存中…</span>
          ) : null}
          <Button variant="outline" onClick={() => exportChecklistXlsx(rec)} className="border-border text-muted-foreground hover:text-foreground">
            <FileSpreadsheet className="mr-1 h-4 w-4" />
            导出 Excel
          </Button>
          <Button onClick={() => onStartSolution(rec.id)} className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90">
            <FileText className="mr-1 h-4 w-4" />
            按此清单生成方案
          </Button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/60 text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">产品 / 系统</th>
              <th className="px-3 py-2 font-medium">模块功能</th>
              <th className="px-3 py-2 font-medium">来源</th>
              <th className="px-3 py-2 font-medium">数量</th>
              <th className="px-3 py-2 font-medium">单位</th>
              <th className="px-3 py-2 font-medium">单价</th>
              <th className="px-3 py-2 font-medium">小计</th>
              <th className="px-3 py-2 font-medium">评级关联</th>
              <th className="px-3 py-2 font-medium">备注</th>
              <th className="px-3 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([category, lines]) => (
              <Fragment key={category}>
                <tr className="border-b border-border/60 bg-secondary/40">
                  <td colSpan={10} className="px-3 py-1.5 text-xs font-semibold text-foreground">
                    【{category}】
                  </td>
                </tr>
                {lines.map((l) => (
                  <tr key={l.line_id} className="border-b border-border/60 last:border-0 hover:bg-secondary/30">
                    <td className="px-3 py-2 font-medium text-foreground">
                      {l.product_name}
                      {l.module_name ? <span className="text-xs text-muted-foreground"> · {l.module_name}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{l.module_func || "—"}</td>
                    <td className="px-3 py-2">
                      <SourceBadge source={l.source} />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        className="h-8 w-16"
                        value={l.qty}
                        onChange={(e) => ck.updateActiveLine(l.line_id, { qty: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        className="h-8 w-14"
                        value={l.unit}
                        onChange={(e) => ck.updateActiveLine(l.line_id, { unit: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        className="h-8 w-24"
                        value={l.unit_price}
                        onChange={(e) => ck.updateActiveLine(l.line_id, { unit_price: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td className="px-3 py-2 text-foreground">{fmtMoney(l.qty * l.unit_price)}</td>
                    <td className="px-3 py-2">
                      <RatingHitsBadges hits={l.rating_hits} />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        className="h-8 w-32"
                        value={l.remark}
                        placeholder="备注"
                        onChange={(e) => ck.updateActiveLine(l.line_id, { remark: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Button size="sm" variant="ghost" onClick={() => ck.removeActiveLine(l.line_id)} className="text-muted-foreground hover:text-destructive">
                        删除
                      </Button>
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
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
              ck.addActiveLineFromProduct(addProductId)
              setAddProductId("")
            }}
            className="border-border text-muted-foreground hover:text-foreground"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            追加行
          </Button>
          <Button size="sm" variant="outline" onClick={ck.addActiveExternalLine} className="border-border text-muted-foreground hover:text-foreground">
            <Plus className="mr-1 h-3.5 w-3.5" />
            外购行
          </Button>
        </div>
        <p className="text-sm font-semibold text-foreground">
          合计：<span className="text-primary">{fmtMoney(calcTotal(rec.items ?? []))}</span>
        </p>
      </div>
    </section>
  )
}

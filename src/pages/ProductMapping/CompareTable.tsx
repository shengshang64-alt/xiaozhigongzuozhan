import { useMemo, useState } from "react"
import { Plus, Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import type { CheckProduct, MatchRow } from "@/pages/SolutionStudio/checklistTypes"
import {
  fieldText,
  GRADE_LABEL,
  matchGrade,
  rowStatus,
  RULE_LABEL,
  STATUS_LABEL,
  type MatchGrade,
  type MappingCompareRow,
  type MappingRowStatus,
} from "./mappingCore"
import { ProductPickerDialog } from "./ProductPickerDialog"
import type { UseProductMapping } from "./useProductMapping"

// ---------------------------------------------------------------------------
// 对照表（2026-10-28 v3，对齐公司《匹配对照表》交付口径）：
//  左侧 = 上传原表列（原样保留、完整换行不截断）；
//  右侧 = 映射列组（匹配状态 / 匹配度五档 / 我司对应产品线 / 模块·标准名称 / 建议 / 匹配方式 / 备注 / 调整）。
//  一对多：公司列多值堆叠；匹配度自动判级（完全/基本/部分/第三方/待确认）。
// ---------------------------------------------------------------------------

/** 匹配状态色块（内部状态：自动/记忆/AI/手动/待确认/无匹配/外购/忽略） */
const STATUS_TONE: Record<MappingRowStatus, string> = {
  auto: "border-emerald-300 bg-emerald-50 text-emerald-700",
  memory: "border-sky-300 bg-sky-50 text-sky-700",
  ai: "border-cyan-300 bg-cyan-50 text-cyan-700",
  manual: "border-violet-300 bg-violet-50 text-violet-700",
  custom: "border-violet-300 bg-violet-50 text-violet-700",
  suggest: "border-amber-300 bg-amber-50 text-amber-700",
  none: "border-red-300 bg-red-50 text-red-700",
  external: "border-orange-300 bg-orange-50 text-orange-700",
  ignore: "border-border bg-muted text-muted-foreground",
}

/** 匹配度五档色块（对外交付口径，同导出配色） */
const GRADE_TONE: Record<MatchGrade, string> = {
  full: "border-emerald-400 bg-emerald-100 text-emerald-800",
  basic: "border-sky-400 bg-sky-100 text-sky-800",
  partial: "border-amber-400 bg-amber-100 text-amber-800",
  thirdparty: "border-orange-400 bg-orange-100 text-orange-800",
  pending: "border-red-400 bg-red-100 text-red-800",
}

const STATUS_FILTERS: { key: string; label: string; match: (s: MappingRowStatus) => boolean }[] = [
  { key: "all", label: "全部", match: () => true },
  { key: "hit", label: "已命中", match: (s) => s === "auto" || s === "memory" || s === "ai" || s === "manual" },
  { key: "suggest", label: "待确认", match: (s) => s === "suggest" },
  { key: "none", label: "无匹配", match: (s) => s === "none" },
  { key: "external", label: "外购", match: (s) => s === "external" },
  { key: "ignore", label: "忽略", match: (s) => s === "ignore" },
]

function StatusBadge({ row }: { row: MappingCompareRow }) {
  const s = rowStatus(row)
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_TONE[s]}`}>
      {STATUS_LABEL[s]}
    </span>
  )
}

/** 匹配度五档徽标（完全/基本/部分/第三方/待确认） */
function GradeBadge({ row }: { row: MappingCompareRow }) {
  const g = matchGrade(row)
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${GRADE_TONE[g]}`}>
      {GRADE_LABEL[g]}
    </span>
  )
}

/** 匹配方式 + 分数（解释「为什么命中」） */
function MatchWayCell({ row }: { row: MappingCompareRow }) {
  if (!row.product) return <span className="text-xs text-muted-foreground">—</span>
  const rule = row.rule ? (RULE_LABEL[row.rule] ?? row.rule) : ""
  return (
    <span className="whitespace-nowrap text-xs text-muted-foreground">
      {rule || "—"}
      {typeof row.score === "number" ? <span className="ml-1 tabular-nums">{Math.round(row.score * 100)}%</span> : null}
    </span>
  )
}

/**
 * 2026-10-29：模块名称单元格 = 公司库命中模块 + 自定义模块（人工填写的「公司能做但清单没有」条目）。
 * 自定义项带可删除的 ×，并提供「+ 自定义」入口就地录入。
 */
function ModuleNameCell({
  prods,
  customNames,
  onAddCustom,
  onRemoveCustom,
}: {
  prods: CheckProduct[]
  customNames: string[]
  onAddCustom: (name: string) => void
  onRemoveCustom: (name: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState("")
  const commit = () => {
    const v = draft.trim()
    if (v) onAddCustom(v)
    setDraft("")
    setAdding(false)
  }
  const empty = !prods.length && !customNames.length
  return (
    <div className="space-y-1">
      {empty && <span className="text-muted-foreground">—</span>}
      {prods.map((p) => (
        <div key={p.id} className="whitespace-pre-wrap break-words font-medium text-foreground">
          {fieldText(p, "module_name") || <span className="text-muted-foreground">—</span>}
        </div>
      ))}
      {customNames.map((n) => (
        <div key={`c-${n}`} className="flex items-start gap-1">
          <span className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
            {n}
            <button
              type="button"
              aria-label={`删除自定义模块 ${n}`}
              title="删除该自定义模块"
              onClick={() => onRemoveCustom(n)}
              className="text-violet-500 transition-colors hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      ))}
      {adding ? (
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                commit()
              } else if (e.key === "Escape") {
                setDraft("")
                setAdding(false)
              }
            }}
            placeholder="公司能做但清单没有的模块名"
            aria-label="自定义模块名"
            className="h-7 text-xs"
          />
          <button type="button" onClick={commit} className="shrink-0 text-xs font-medium text-primary hover:underline">
            确定
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          title="公司实际能做、但 ONE-LINK 产品清单里没有的模块，可在此自定义"
          className="inline-flex items-center gap-0.5 text-xs text-primary/80 transition-colors hover:text-primary hover:underline"
        >
          <Plus className="h-3 w-3" />
          自定义
        </button>
      )}
    </div>
  )
}

/**
 * 2026-10-29：产品对照列的多值堆叠单元格。
 * 对齐用户手工 Excel 的版式——一对多时同一客户条目下的多个模块，
 * 产品类别/产品名称/模块分类逐行对齐堆叠（等同 Excel 里的合并单元格效果）。
 */
function StackedCell({ rows, empty }: { rows: string[]; empty?: boolean }) {
  if (!rows.length) {
    return <span className="text-muted-foreground">{empty ? "（自定义）" : "—"}</span>
  }
  return (
    <div className="space-y-1">
      {rows.map((v, i) => (
        <div key={i} className="whitespace-nowrap text-foreground">
          {v || <span className="text-muted-foreground">—</span>}
        </div>
      ))}
    </div>
  )
}

/**
 * 2026-10-29：独立的自定义入口（用于未命中行的紧凑布局）。
 * 与 ModuleNameCell 里的入口共用同一回调语义：确认即追加一条自定义模块名。
 */
function CustomAdder({ onAdd }: { onAdd: (name: string) => void }) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState("")
  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        title="公司实际能做、但 ONE-LINK 产品清单里没有的模块，可在此自定义"
        className="inline-flex items-center gap-0.5 whitespace-nowrap text-xs text-primary/80 transition-colors hover:text-primary hover:underline"
      >
        <Plus className="h-3 w-3" />
        自定义
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            const v = draft.trim()
            if (v) onAdd(v)
            setDraft("")
            setAdding(false)
          } else if (e.key === "Escape") {
            setDraft("")
            setAdding(false)
          }
        }}
        placeholder="自定义模块名"
        aria-label="自定义模块名"
        className="h-7 w-44 text-xs"
      />
      <button
        type="button"
        onClick={() => {
          const v = draft.trim()
          if (v) onAdd(v)
          setDraft("")
          setAdding(false)
        }}
        className="shrink-0 text-xs font-medium text-primary hover:underline"
      >
        确定
      </button>
    </span>
  )
}

export function CompareTable({ p }: { p: UseProductMapping }) {
  const [statusFilter, setStatusFilter] = useState("all")
  const [kw, setKw] = useState("")
  const [pickerRow, setPickerRow] = useState<MappingCompareRow | null>(null)
  // 2026-10-28：上传表常带整列空列（合并表头/占位列），默认隐藏，避免把有用列挤出屏幕
  const [showAllCols, setShowAllCols] = useState(false)

  const srcCols = p.sourceColumns
  const hasSrc = srcCols.length > 0

  /** 某原表列是否「全空」（所有行该格都没有内容） */
  const isEmptyCol = useMemo(() => {
    return srcCols.map((_, i) => {
      for (const r of p.compareRows) {
        const v = r.cells?.[i]
        if (v && String(v).trim()) return false
      }
      return true
    })
  }, [srcCols, p.compareRows])

  const visibleIdx = useMemo(
    () => srcCols.map((_, i) => i).filter((i) => showAllCols || !isEmptyCol[i]),
    [srcCols, isEmptyCol, showAllCols],
  )
  const hiddenCount = visibleIdx.length === srcCols.length ? 0 : srcCols.length - visibleIdx.length

  const filtered = useMemo(() => {
    const f = STATUS_FILTERS.find((x) => x.key === statusFilter) ?? STATUS_FILTERS[0]
    const q = kw.trim().toLowerCase()
    return p.compareRows.filter((r) => {
      if (!f.match(rowStatus(r))) return false
      if (!q) return true
      const hay = [
        r.customer,
        r.raw,
        ...(r.cells ?? []),
        ...(r.products ?? []).flatMap((x) => [fieldText(x, "module_name"), fieldText(x, "product_name"), fieldText(x, "standard_name")]),
        ...(r.customNames ?? []),
      ]
      return hay.some((v) => String(v ?? "").toLowerCase().includes(q))
    })
  }, [p.compareRows, statusFilter, kw])

  // 产品对照区列数：产品类别/产品名称/模块分类/模块名称/匹配状态/匹配度/备注/调整
  const mappingCols = 8

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex w-fit flex-wrap items-center gap-1 rounded-full bg-muted p-0.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                statusFilter === f.key ? "bg-card font-medium text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative w-56">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-8 pl-8 text-xs" value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索条目 / 原表内容 / 模块…" />
        </div>
        <span className="text-xs text-muted-foreground">
          {filtered.length} / {p.compareRows.length} 行
        </span>
        {hasSrc && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>· 共 {srcCols.length} 个原表列</span>
            {hiddenCount > 0 && !showAllCols && (
              <button type="button" onClick={() => setShowAllCols(true)} className="text-primary hover:underline">
                已隐藏 {hiddenCount} 个空列，显示全部
              </button>
            )}
            {hiddenCount > 0 && showAllCols && (
              <button type="button" onClick={() => setShowAllCols(false)} className="text-primary hover:underline">
                隐藏 {hiddenCount} 个空列
              </button>
            )}
            <span className="text-muted-foreground/70">· 表格可左右滑动查看全部列</span>
          </span>
        )}
      </div>

      {/* 宽表容器：用负边距吃掉 main 的 px-4/lg:px-6，撑满可视宽度；
          overflow-x-clip 阻断页面级横溢（不能用 hidden，否则 sticky 失效）。
          注意：不要用 left-1/2 + translate-x，那样会让表格相对内容盒偏移，撑破整页。 */}
      <div className="-mx-4 overflow-x-clip lg:-mx-6">
        <div className="overflow-x-auto rounded-lg border border-border [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-secondary/60">
          <table className="w-full min-w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 bg-secondary/80 backdrop-blur">
              {/* 分组表头：左「客户建设清单」/ 右「产品对照」——对齐用户手工调整的 Excel 版式 */}
              <tr className="border-b border-border/60 text-[11px]">
                <th
                  colSpan={(hasSrc ? visibleIdx.length : 1)}
                  className="border-r-2 border-r-primary/40 px-3 py-1.5 text-left font-semibold text-foreground"
                >
                  客户建设清单
                </th>
                <th colSpan={mappingCols} className="px-3 py-1.5 text-left font-semibold text-primary">
                  产品对照
                </th>
              </tr>
              <tr className="border-b border-border text-xs text-muted-foreground">
                {hasSrc ? (
                  visibleIdx.map((i) => (
                    <th
                      key={`${srcCols[i]}-${i}`}
                      className={`whitespace-nowrap border-r border-border/60 px-3 py-2 font-medium last:border-r-0 ${
                        i === visibleIdx[0] ? "sticky left-0 z-20 w-[96px] min-w-[96px] max-w-[96px] bg-secondary/95" : ""
                      }`}
                    >
                      {srcCols[i]}
                    </th>
                  ))
                ) : (
                  <th className="sticky left-0 z-20 w-56 min-w-56 bg-secondary/95 border-r border-border/60 px-3 py-2 font-medium">客户条目</th>
                )}
                {/* 产品对照四列：与用户 Excel 的产品对照表列序一致 */}
                <th className="border-l-2 border-l-primary/40 px-3 py-2 font-medium text-primary">产品类别</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium text-primary">产品名称</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium text-primary">模块分类</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium text-primary">模块名称</th>
                {/* 对照辅助列 */}
                <th className="whitespace-nowrap px-3 py-2 font-medium">匹配状态</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">匹配度</th>
                <th className="px-3 py-2 font-medium">备注</th>
                <th className="px-3 py-2 font-medium">调整</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const status = rowStatus(r)
                const prods = r.products ?? []
                const customs = r.customNames ?? []
                const multi = prods.length > 1
                const hasAny = prods.length > 0 || customs.length > 0
                const addCustom = (name: string) => p.setCustomNames(r.row_id, [...customs, name])
                const removeCustom = (name: string) => p.setCustomNames(r.row_id, customs.filter((x) => x !== name))
                return (
                  <tr key={r.row_id} className={`border-b border-border/60 last:border-0 align-top ${status === "ignore" ? "opacity-50" : ""}`}>
                    {hasSrc ? (
                      visibleIdx.map((i) => (
                        <td
                          key={i}
                          className={`whitespace-pre-wrap break-words border-r border-border/40 px-3 py-2 text-foreground last:border-r-0 ${
                            i === visibleIdx[0] ? "sticky left-0 z-10 w-[96px] min-w-[96px] max-w-[96px] bg-card" : "min-w-20"
                          }`}
                        >
                          {r.cells?.[i] || <span className="text-muted-foreground">—</span>}
                        </td>
                      ))
                    ) : (
                      <td className="sticky left-0 z-10 w-56 min-w-56 whitespace-pre-wrap break-words bg-card border-r border-border/40 px-3 py-2 text-foreground">
                        {r.customer}
                      </td>
                    )}
                    {/* 产品对照四列：一对多时逐行堆叠，与用户 Excel 的合并单元格式一致。
                        列宽用 min-w + whitespace-nowrap 保护：这类名称都很短（智慧医疗/ONE-LINK-HIS/门诊管理），
                        一旦允许折行就会被压成竖排单字，根本没法读。 */}
                    <td className="min-w-[88px] whitespace-nowrap border-l-2 border-l-primary/40 px-3 py-2 align-top">
                      <StackedCell rows={prods.map((x) => fieldText(x, "category"))} empty={hasAny && !prods.length} />
                    </td>
                    <td className="min-w-[132px] whitespace-nowrap px-3 py-2 align-top">
                      <StackedCell rows={prods.map((x) => fieldText(x, "product_name"))} empty={hasAny && !prods.length} />
                    </td>
                    <td className="min-w-[110px] whitespace-nowrap px-3 py-2 align-top">
                      <StackedCell rows={prods.map((x) => fieldText(x, "module_category"))} empty={hasAny && !prods.length} />
                    </td>
                    <td className="min-w-40 px-3 py-2 align-top">
                      {hasAny ? (
                        <>
                          <ModuleNameCell prods={prods} customNames={customs} onAddCustom={addCustom} onRemoveCustom={removeCustom} />
                          {multi && <div className="pt-0.5 text-[10px] text-muted-foreground">一对多 · 共 {prods.length} 个模块</div>}
                        </>
                      ) : (
                        <div className="space-y-1">
                          <span className="text-muted-foreground">—</span>
                          {status !== "external" && status !== "ignore" && <CustomAdder onAdd={addCustom} />}
                          {status === "external" && <span className="block text-xs text-orange-600">标为外购</span>}
                          {status === "ignore" && <span className="block text-xs text-muted-foreground">已忽略</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="space-y-1">
                        <StatusBadge row={r} />
                        {status === "suggest" && r.suggestion && (
                          <button
                            type="button"
                            title={r.suggestion.reason}
                            onClick={() => p.setMatchProduct(r.row_id, r.suggestion!.product_id)}
                            className="block text-left text-[11px] text-primary hover:underline"
                          >
                            建议：{r.suggestion.label}（{Math.round(r.suggestion.score * 100)}%）
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="space-y-1">
                        <GradeBadge row={r} />
                        <MatchWayCell row={r} />
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Input
                        className="h-8 w-36"
                        value={p.rowNotes[r.row_id] ?? ""}
                        onChange={(e) => p.setRowNote(r.row_id, e.target.value)}
                        placeholder="匹配说明/差异"
                        aria-label="备注"
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Button size="sm" variant="outline" className="h-8 whitespace-nowrap" onClick={() => setPickerRow(r)}>
                        {prods.length ? `改映射（${prods.length}）` : "指定模块"}
                      </Button>
                    </td>
                  </tr>
                )
              })}
              {!filtered.length ? (
                <tr>
                  <td colSpan={(hasSrc ? visibleIdx.length : 1) + mappingCols} className="px-3 py-10 text-center text-muted-foreground">
                    当前筛选条件下没有对照行
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <ProductPickerDialog
        key={pickerRow?.row_id ?? "none"}
        open={Boolean(pickerRow)}
        onOpenChange={(o) => !o && setPickerRow(null)}
        customerLabel={pickerRow?.raw || pickerRow?.customer || ""}
        suggestion={pickerRow?.suggestion}
        products={p.companyProducts}
        currentIds={(pickerRow?.products ?? []).map((x) => x.id)}
        onApply={(ids) => {
          if (pickerRow) p.setMatchProducts(pickerRow.row_id, ids)
        }}
        onResolution={(res: MatchRow["resolution"]) => {
          if (pickerRow) p.setMatchResolution(pickerRow.row_id, res)
        }}
      />
    </div>
  )
}

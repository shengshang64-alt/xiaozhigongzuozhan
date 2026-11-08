import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { paginate, shouldReserveFabClearance, sortRows } from "./dataTableLogic"
import type { DataTableColumn, DataTableProps, DataTableSortState } from "./dataTableLogic"

// 纯逻辑（sortRows/paginate）与类型见 dataTableLogic.ts —— 拆文件以满足 react-refresh 约束。
export type { DataTableColumn, DataTableProps, DataTableSortState, SortDir } from "./dataTableLogic"

const ALIGN_CLASS: Record<"left" | "center" | "right", string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  onRowClick,
  initialSort = null,
  pageSize = 0,
  emptyState,
  selectedRowId = null,
  caption,
  className,
  rowProps,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<DataTableSortState | null>(initialSort)
  const [page, setPage] = useState(1)

  const activeColumn = useMemo(
    () => columns.find((c) => c.key === sort?.key) ?? null,
    [columns, sort],
  )

  const sorted = useMemo(
    () => sortRows(rows, activeColumn?.sortAccessor, sort?.dir ?? "asc"),
    [rows, activeColumn, sort],
  )

  // 分页判定与 FAB 避让共用同一真源（shouldReserveFabClearance）
  const usePaging = shouldReserveFabClearance(rows.length, pageSize)
  const pageCount = usePaging ? Math.ceil(sorted.length / pageSize) : 1
  const currentPage = Math.min(Math.max(1, page), pageCount)
  const visible = usePaging ? paginate(sorted, currentPage, pageSize) : sorted

  const toggleSort = (col: DataTableColumn<T>) => {
    if (!col.sortAccessor) return
    setSort((prev) => {
      if (!prev || prev.key !== col.key) return { key: col.key, dir: "asc" }
      if (prev.dir === "asc") return { key: col.key, dir: "desc" }
      return null
    })
    setPage(1)
  }

  const goPage = (next: number) => setPage(Math.min(Math.max(1, next), pageCount))

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card shadow-sm",
        // 触发分页时预留底部空间，避免固定右下角的浮窗助手 FAB 遮挡「下一页」（R250 实机缺陷）
        usePaging && "mb-16",
        className,
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {columns.map((col) => {
                const align = col.align ?? "left"
                const isActive = sort?.key === col.key
                const ariaSort = isActive
                  ? sort!.dir === "asc"
                    ? "ascending"
                    : "descending"
                  : col.sortAccessor
                    ? "none"
                    : undefined
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={ariaSort}
                    style={col.width ? { width: col.width } : undefined}
                    className={cn(
                      "px-4 py-2.5 font-medium text-muted-foreground",
                      ALIGN_CLASS[align],
                      col.headerClassName,
                    )}
                  >
                    {col.sortAccessor ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                          align === "right" && "flex-row-reverse",
                          isActive && "text-primary",
                        )}
                      >
                        <span>{col.header}</span>
                        {isActive ? (
                          sort!.dir === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">
                  {emptyState ?? "暂无数据"}
                </td>
              </tr>
            ) : (
              visible.map((row, i) => {
                const id = getRowId(row, i)
                const selected = selectedRowId != null && id === selectedRowId
                const extra = rowProps?.(row, id, i)
                return (
                  <tr
                    key={id}
                    {...extra}
                    onClick={onRowClick ? () => onRowClick(row) : extra?.onClick}
                    className={cn(
                      "border-b border-border/60 transition-colors last:border-b-0",
                      onRowClick && "cursor-pointer hover:bg-accent/60",
                      selected && "bg-primary/10 hover:bg-primary/10",
                      extra?.className,
                    )}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          "px-4 py-2.5 text-foreground",
                          ALIGN_CLASS[col.align ?? "left"],
                          col.className,
                        )}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {usePaging ? (
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span>
            共 {sorted.length} 条 · 第 {currentPage} / {pageCount} 页
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => goPage(currentPage - 1)}
              disabled={currentPage <= 1}
              aria-label="上一页"
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-border transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => goPage(currentPage + 1)}
              disabled={currentPage >= pageCount}
              aria-label="下一页"
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-border transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

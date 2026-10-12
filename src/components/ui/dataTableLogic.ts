import type { ReactNode } from "react"

export type SortDir = "asc" | "desc"

export interface DataTableSortState {
  key: string
  dir: SortDir
}

export interface DataTableColumn<T> {
  key: string
  header: ReactNode
  /** 单元格渲染 */
  render: (row: T) => ReactNode
  /** 排序取值；提供该列即可点击表头排序 */
  sortAccessor?: (row: T) => string | number | null | undefined
  align?: "left" | "center" | "right"
  width?: string
  className?: string
  headerClassName?: string
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: readonly T[]
  getRowId: (row: T, index: number) => string
  onRowClick?: (row: T) => void
  /** 初始排序；三态循环：升 → 降 → 取消 */
  initialSort?: DataTableSortState | null
  /** >0 且行数超过时启用分页 */
  pageSize?: number
  emptyState?: ReactNode
  selectedRowId?: string | null
  caption?: ReactNode
  className?: string
}

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === ""
}

/**
 * 纯函数：按单列排序，返回新数组（不修改入参）。
 * - 无 accessor：原顺序副本
 * - 数值按大小、其余按中文 locale 字符串比较
 * - 空值（null/undefined/""）恒排最后，与升降序无关
 * - 相等键以原始索引兜底，保证稳定
 */
export function sortRows<T>(
  rows: readonly T[],
  accessor: DataTableColumn<T>["sortAccessor"],
  dir: SortDir,
): T[] {
  if (!accessor) return rows.slice()
  const decorated = rows.map((row, index) => ({ row, index }))
  decorated.sort((a, b) => {
    const va = accessor(a.row)
    const vb = accessor(b.row)
    const ae = isEmptyValue(va)
    const be = isEmptyValue(vb)
    if (ae && be) return a.index - b.index
    if (ae) return 1
    if (be) return -1
    let r: number
    if (typeof va === "number" && typeof vb === "number") {
      r = va === vb ? 0 : va < vb ? -1 : 1
    } else {
      r = String(va).localeCompare(String(vb), "zh-Hans-CN")
    }
    if (r === 0) return a.index - b.index
    return dir === "asc" ? r : -r
  })
  return decorated.map((d) => d.row)
}

/**
 * 纯函数：是否需要在表格底部预留「浮窗助手 FAB」避让空间。
 * 全站浮窗助手按钮（FloatingAssistant）固定于视口右下角（fixed bottom-6 right-6 z-50），
 * 分页页脚右对齐的「下一页」在窄视口滚到底时会落进 FAB 命中带、点击被 FAB 截走（R250 实机发现）。
 * 触发分页（行数超过 pageSize）即需避让；与 DataTable 的 usePaging 同口径，抽成纯函数便于单测锁定。
 */
export function shouldReserveFabClearance(rowCount: number, pageSize: number): boolean {
  return pageSize > 0 && rowCount > pageSize
}

/**
 * 纯函数：分页切片，返回新数组（不修改入参）。
 * - pageSize<=0 返回全部
 * - 页码收敛到 [1, pageCount]
 */
export function paginate<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  if (pageSize <= 0) return rows.slice()
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pageCount)
  const start = (p - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

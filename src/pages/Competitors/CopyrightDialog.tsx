// 软件著作权明细查询弹窗：公司 / 关键词 / 软件分类 / 登记日期范围四维筛选 + 分页表格。
// 数据来自 public/data/competitor-copyrights.json（软著汇总 Excel 抽取），首次打开懒加载，纯本地检索零 AI 成本。
import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Loader2, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { loadCopyrights, useCopyrightQuery, type CopyrightRow } from "./copyrightCore"
import type { CopyrightQuery } from "./copyrightCore"

const PAGE_SIZE = 50

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 打开时默认选中的公司简称；"all" 为全部公司 */
  initialCompany?: string
}

export function CopyrightDialog({ open, onOpenChange, initialCompany = "all" }: Props) {
  const [rows, setRows] = useState<CopyrightRow[] | null>(null)
  const [meta, setMeta] = useState<{ generated: string; source: string } | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  // 首次打开懒加载；失败后 setState 清空错误态即可触发 effect 重试（effect 内只异步 setState）
  const retry = () => setLoadErr(null)
  useEffect(() => {
    if (!open || rows !== null || loadErr) return
    loadCopyrights()
      .then((d) => {
        setRows(d.rows)
        setMeta(d.meta)
      })
      .catch((err) => setLoadErr(`明细加载失败：${String(err && err.message ? err.message : err)}`))
  }, [open, rows, loadErr])

  const query = useCopyrightQuery(rows, initialCompany)
  const { filtered, page, setPage, filters, companies, classOptions, countByCompany } = query

  // 任一筛选变化回到第 1 页
  const patch = (key: keyof CopyrightQuery, v: string) => {
    const setter =
      key === "company" ? filters.setCompany : key === "q" ? filters.setQ : key === "swClass" ? filters.setSwClass : key === "dateFrom" ? filters.setDateFrom : filters.setDateTo
    setter(v)
    setPage(1)
  }
  const resetAll = () => {
    filters.setQ(""); filters.setSwClass("all"); filters.setDateFrom(""); filters.setDateTo(""); setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page])
  const showCompanyCol = filters.company === "all"
  const hitCompanies = countByCompany.size

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[94vw] max-w-5xl flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="text-base">软件著作权明细查询</DialogTitle>
          <DialogDescription>
            全国版权保护中心登记数据（{meta ? `来源 ${meta.source}，截至 ${meta.generated}` : "加载中…"}）；支持软件名称 / 登记号 / 著作权人关键词与分类、登记日期筛选。
          </DialogDescription>
        </DialogHeader>

        {loadErr ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16">
            <p className="text-sm text-destructive">{loadErr}</p>
            <Button variant="outline" size="sm" onClick={retry}>重试</Button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col px-5 pb-4">
            {/* 筛选栏 */}
            <div className="flex flex-wrap items-center gap-2 border-y border-border py-3">
              <Select value={filters.company} onValueChange={(v) => patch("company", v)}>
                <SelectTrigger className="h-8 w-[168px]"><SelectValue placeholder="全部公司" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部公司（{rows?.length.toLocaleString() ?? "—"}）</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c} value={c}>{c}（{countByCompany.get(c) ?? 0}）</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative w-[240px]">
                <Input
                  value={filters.q}
                  onChange={(e) => patch("q", e.target.value)}
                  placeholder="软件名称 / 登记号 / 著作权人，空格分词"
                  className="h-8 pl-2.5 text-[13px]"
                />
              </div>
              <Select value={filters.swClass} onValueChange={(v) => patch("swClass", v)}>
                <SelectTrigger className="h-8 w-[130px]"><SelectValue placeholder="全部分类" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部分类</SelectItem>
                  {classOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="date" value={filters.dateFrom} onChange={(e) => patch("dateFrom", e.target.value)} className="h-8 w-[140px] text-[12px]" />
              <span className="text-xs text-muted-foreground">至</span>
              <Input type="date" value={filters.dateTo} onChange={(e) => patch("dateTo", e.target.value)} className="h-8 w-[140px] text-[12px]" />
              <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={resetAll}>
                <RotateCcw className="h-3 w-3" />重置
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">
                {rows === null ? (
                  <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />加载明细…</span>
                ) : (
                  <>命中 <b className="tabular-nums text-foreground">{filtered.length.toLocaleString()}</b> 项{showCompanyCol && ` · ${hitCompanies} 家`}</>
                )}
              </span>
            </div>

            {/* 表格 */}
            <div className="min-h-0 flex-1 overflow-auto rounded-b-md">
              <table className="w-full border-collapse text-[12px]">
                <thead className="sticky top-0 z-10 bg-muted/80 text-left text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="w-10 px-2 py-1.5 font-medium">#</th>
                    {showCompanyCol && <th className="w-20 px-2 py-1.5 font-medium">公司</th>}
                    <th className="px-2 py-1.5 font-medium">软件名称</th>
                    <th className="w-16 px-2 py-1.5 font-medium">版本</th>
                    <th className="w-20 px-2 py-1.5 font-medium">分类</th>
                    <th className="w-[120px] px-2 py-1.5 font-medium">登记号</th>
                    <th className="w-[88px] px-2 py-1.5 font-medium">登记日期</th>
                    <th className="w-[88px] px-2 py-1.5 font-medium">首次发表</th>
                    {!showCompanyCol && <th className="w-[220px] px-2 py-1.5 font-medium">著作权人</th>}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r, i) => (
                    <tr key={`${i}-${r.regNo}`} className="border-b border-border/60 hover:bg-primary/[0.04]">
                      <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{(page - 1) * PAGE_SIZE + i + 1}</td>
                      {showCompanyCol && <td className="px-2 py-1.5 font-medium text-primary">{r.company}</td>}
                      <td className="px-2 py-1.5">
                        <span className="text-foreground">{r.name}</span>
                        {r.short && r.short !== "-" && <span className="ml-1 text-muted-foreground">（{r.short}）</span>}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">{r.version}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{r.swClass}</td>
                      <td className="px-2 py-1.5 tabular-nums">{r.regNo}</td>
                      <td className="px-2 py-1.5 tabular-nums">{r.regDate}</td>
                      <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{r.pubDate}</td>
                      {!showCompanyCol && <td className="truncate px-2 py-1.5 text-muted-foreground" title={r.owner}>{r.owner}</td>}
                    </tr>
                  ))}
                  {rows !== null && pageRows.length === 0 && (
                    <tr><td colSpan={9} className="px-2 py-10 text-center text-muted-foreground">没有匹配的软著记录，试试放宽关键词或筛选条件</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            <div className="flex items-center justify-between pt-2.5">
              <p className="text-[11px] text-muted-foreground">
                登记事实取自中国版权保护中心公开登记信息；「-」为源表未披露字段。
              </p>
              <div className="flex items-center gap-2 text-xs">
                <Button variant="outline" size="sm" className="h-7 px-2" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className={cn("tabular-nums text-muted-foreground")}>第 {page} / {totalPages} 页</span>
                <Button variant="outline" size="sm" className="h-7 px-2" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

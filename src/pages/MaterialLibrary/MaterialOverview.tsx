// 素材库 · 素材总览（UX-v2 1:1：docs/ux-v2-2026-11/prototype/material/list.html）
//
// 原型结构（自上而下）：
//   A. 页头：标题 + 素材数徽标 / desc / meta（存储占用·被引用·最近入库）/ 联网抓取 + 导入素材
//   B. 数据条：素材 / 分类 / 本月新增 / 回收站 + 未被引用建议
//   C. 蓝色说明条（第一价值是做 PPT 时被优先命中）+ 「去 PPT 编辑器看命中」
//   D. 左栏：分类树（全部/主分类/未分类/回收站）+ 来源树
//   E. 右区：使用排行 Top5（被 PPT 引用次数）+ 筛选条 + 素材网格 + 分页
//
// 数据口径（全部真值，无一演示数）：
//   · 素材 / 分类 / 本月新增 / 回收站 / 未被引用 —— /api/materials-stats 真聚合
//   · 使用排行 —— 同上 topUsed（usage 由 PPT 插入时 +1 累计）
//   · 存储占用 —— stats.bytes
//   · 最近入库 —— 已加载素材里最新的 created
// 原型的「主分类 6 个 + 子分类 6 个 = 12 个分类」现网是扁平分类表（无父子字段），
// 因此左栏按「全部分类 + 各分类计数」平铺，不假造二级层级。
//
// 空库要求：**保留骨架**（数据条、左分类树、排行卡、网格区域都在），
// 不像旧版那样只剩两张大空态卡——那样一进空库就看不出这个库是干什么的。
import { useMemo } from "react"
import { useNavigate } from "react-router-dom"
import {
  ArrowDownUp,
  ChevronDown,
  Download,
  FolderInput,
  Globe,
  ImagePlus,
  Images,
  Loader2,
  PackageOpen,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react"

import { PageHeader } from "@/components/shell/PageHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/common/DataStates"
import { formatBytes, statBytes, statText } from "./materialCore"
import { formatDateDisplay } from "@/lib/dateDisplay"
import { MATERIAL_CATEGORIES, MATERIAL_SOURCE_LABELS, type MaterialItem } from "./materialTypes"
import type { UseMaterialLibrary } from "./useMaterialLibrary"

const SORT_LABELS: Record<"created" | "usage" | "bytes", string> = {
  created: "按入库时间",
  usage: "按引用降序",
  bytes: "按占用空间",
}

function StatBarItem({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <span className={`flex items-center gap-1.5 border-r border-border px-3.5 text-[12px] last:border-r-0 ${muted ? "text-muted-foreground" : "text-muted-foreground"}`}>
      {label}
      <b className={`font-mono text-[15px] font-semibold ${muted ? "text-muted-foreground" : "text-foreground"}`}>{value}</b>
    </span>
  )
}

/** 左栏树的一行（分类 / 来源 / 未分类 / 回收站共用）；count 未加载时显示「—」 */
function TreeRow({
  label,
  count,
  active,
  onClick,
  icon,
}: {
  label: string
  count: number | undefined
  active: boolean
  onClick: () => void
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center gap-1.5 rounded px-2 py-[5px] text-left text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        active ? "bg-primary/10 font-medium text-primary" : "text-foreground hover:bg-secondary/60"
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={`shrink-0 font-mono text-[11px] ${active ? "text-primary" : "text-muted-foreground"}`}>
        {statText(count)}
      </span>
    </button>
  )
}

function MaterialCard({ it, onClick }: { it: MaterialItem; onClick: () => void }) {
  const usage = it.usage ?? 0
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card text-left shadow-sm transition-shadow hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex aspect-[16/10] items-center justify-center overflow-hidden bg-muted">
        {it.thumb_data ? (
          <img src={it.thumb_data} alt={it.name} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <PackageOpen className="h-6 w-6 text-muted-foreground" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <div className="truncate text-[12.5px] font-semibold text-foreground" title={it.name}>
          {it.name}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {it.width}×{it.height} · {formatBytes(it.bytes)} · {it.category}
        </div>
        <div className="mt-auto pt-1">
          {usage > 0 ? (
            <Badge variant="success" className="text-[10px]">
              被 PPT 引用 {usage} 次
            </Badge>
          ) : (
            <Badge variant="neutral" className="text-[10px]">
              被 PPT 引用 0 次
            </Badge>
          )}
        </div>
      </div>
    </button>
  )
}

export function MaterialOverview({ p }: { p: UseMaterialLibrary }) {
  const navigate = useNavigate()
  const stats = p.stats

  const categories = useMemo(() => {
    // 后端只返回「有素材的分类」；把有素材的排在前，再补上还没用到的标准分类（计数 0）
    const known = new Map((stats?.categories ?? []).map((c) => [c.name, c.count]))
    const used = (stats?.categories ?? []).map((c) => ({ name: c.name, count: c.count }))
    const unused = MATERIAL_CATEGORIES.filter((c) => !known.has(c)).map((c) => ({ name: c, count: 0 }))
    return [...used, ...unused]
  }, [stats])

  const top = stats?.topUsed ?? []
  const maxUsage = top[0]?.usage ?? 0
  const unseenCount = stats?.unused
  const total = stats?.total
  const trashed = stats?.trashed

  // 最近入库：已加载素材里最新的 created（stats 不带时间，这里用首页数据代替，避免另开接口）
  const latestCreated = useMemo(() => {
    let latest = ""
    for (const it of p.items) if (it.created && it.created > latest) latest = it.created
    return latest
  }, [p.items])

  const isFiltering = !!(p.q.trim() || p.category || p.source)

  return (
    <div>
      <PageHeader
        title="素材库"
        titleExtra={
          <Badge variant="success" className="text-[11px]">
            {statText(total)} 个素材
          </Badge>
        }
        desc={
          <>
            素材库的第一价值是<b className="font-semibold text-foreground">做 PPT 时被优先命中</b>，管理不是主线。
            所以本屏先给「被引用多少次」，再给分类与网格；导入和联网抓取是动作，已挪到右上角。
          </>
        }
        meta={
          <>
            <span>
              存储占用 <b className="font-mono font-semibold text-foreground">{statBytes(stats?.bytes)}</b>
            </span>
            <span>
              被 PPT 引用 <b className="font-mono font-semibold text-foreground">{statText(stats?.usageTotal)}</b> 次
            </span>
            <span>
              最近入库{" "}
              <b className="font-mono font-semibold text-foreground">
                {latestCreated ? formatDateDisplay(latestCreated) : "—"}
              </b>
            </span>
          </>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate("/materials?tab=web")}>
              <Globe className="h-3.5 w-3.5" /> 联网抓取
            </Button>
            <Button size="sm" onClick={() => navigate("/materials?tab=import")}>
              <ImagePlus className="h-3.5 w-3.5" /> 导入素材
            </Button>
          </>
        }
      />

      {/* B. 数据条：全部为后端真聚合；统计未到手时是「—」而不是 0 */}
      <div className="mb-3 flex flex-wrap items-center rounded-lg border border-border bg-card py-2 shadow-sm">
        <StatBarItem label="素材" value={statText(total)} />
        <StatBarItem label="分类" value={stats ? String(categories.filter((c) => c.count > 0).length) : "—"} />
        <StatBarItem label="本月新增" value={statText(stats?.newThisMonth)} />
        <StatBarItem label="回收站" value={statText(trashed)} muted />
        <div className="flex-1" />
        <span className="px-3.5 text-[11.5px] text-muted-foreground">
          {unseenCount === undefined
            ? "统计加载中…"
            : total === 0
              ? "库里还没有素材" // 0 个素材时说「都被引用过」是句错话
              : unseenCount > 0
                ? `未被引用 ${unseenCount} 个 · 建议清理或补标签`
                : "全部素材都至少被引用过一次"}
        </span>
      </div>

      {/* C. 说明条：这是生产向的第一价值说明，不是原型的设计评审 .note */}
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3.5 py-2.5">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-muted-foreground">
          <b className="font-semibold text-foreground">素材库的第一价值是在 PPT 生成时被优先命中，管理不是主线。</b>
          因此「被引用次数」是第一排序依据；为了好看而堆素材，反而会稀释命中率。
        </p>
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => navigate("/ppt-quote")}>
          去 PPT 编辑器看命中
        </Button>
      </div>

      <div className="grid gap-3.5 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* D. 左栏：分类 + 来源（空库也保留，这是骨架的一部分） */}
        <div className="flex min-w-0 flex-col gap-3.5">
          <section className="rounded-lg border border-border bg-card shadow-sm">
            <header className="flex items-center gap-2 border-b border-border px-3 py-2">
              <h3 className="text-[13px] font-semibold text-foreground">分类</h3>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[11px]"
                onClick={() => navigate("/materials?tab=settings")}
                title="在「库设置」里管理分类体系"
              >
                管理
              </Button>
            </header>
            <div className="space-y-0.5 px-2 py-2">
              <TreeRow label="全部素材" count={total} active={!p.category} onClick={() => p.setCategory("")} />
              <div className="px-2 pb-0.5 pt-2 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                分类 · {categories.filter((c) => c.count > 0).length} 个有素材
              </div>
              {categories.map((c) => (
                <TreeRow
                  key={c.name}
                  label={c.name}
                  count={c.count}
                  active={p.category === c.name}
                  onClick={() => p.setCategory(p.category === c.name ? "" : c.name)}
                />
              ))}
              <div className="px-2 pb-0.5 pt-2 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                其他
              </div>
              <TreeRow
                label="回收站"
                count={trashed}
                active={p.trashedView}
                icon={<Trash2 className="h-3 w-3 shrink-0" />}
                onClick={() => {
                  p.setTrashedView(!p.trashedView)
                  p.setCategory("")
                }}
              />
            </div>
            <p className="border-t border-border px-3 py-2 text-[10.5px] leading-relaxed text-muted-foreground">
              现网分类是扁平表（无父子级），分类体系在「库设置」里维护。
            </p>
          </section>

          <section className="rounded-lg border border-border bg-card shadow-sm">
            <header className="border-b border-border px-3 py-2">
              <h3 className="text-[13px] font-semibold text-foreground">来源</h3>
            </header>
            <div className="space-y-0.5 px-2 py-2">
              <TreeRow label="全部来源" count={total} active={!p.source} onClick={() => p.setSource("")} />
              {(stats?.sources ?? []).map((s) => (
                <TreeRow
                  key={s.name}
                  label={MATERIAL_SOURCE_LABELS[s.name as keyof typeof MATERIAL_SOURCE_LABELS] ?? s.name}
                  count={s.count}
                  active={p.source === s.name}
                  onClick={() => p.setSource(p.source === s.name ? "" : s.name)}
                />
              ))}
            </div>
          </section>
        </div>

        {/* E. 右区：排行 + 筛选 + 网格 */}
        <div className="flex min-w-0 flex-col gap-3.5">
          {/* 使用排行 Top5：无引用数据时给空态，不画假条 */}
          <section className="rounded-lg border border-border bg-card shadow-sm">
            <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
              <h3 className="text-[15px] font-semibold text-foreground">使用排行 Top{stats?.topLimit ?? 5}</h3>
              <span className="text-xs text-muted-foreground">被 PPT 引用次数</span>
              <div className="flex-1" />
              {top.length > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => p.setSort("usage")}
                  title="把下方网格也按引用降序排列"
                >
                  看全部排行
                </Button>
              ) : null}
            </header>
            <div className="px-4 py-3">
              {top.length === 0 ? (
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  还没有素材被 PPT 引用过。在 PPT 编辑器里插入素材后，这里会按引用次数排出 Top
                  {stats?.topLimit ?? 5}——这是「哪些素材真的有用」的唯一依据，不用手工标注。
                </p>
              ) : (
                <ol className="space-y-1.5">
                  {top.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 text-[12px]">
                      <span className="min-w-0 flex-1 truncate text-foreground" title={t.name}>
                        {t.name}
                      </span>
                      <span className="h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-muted sm:w-44">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${Math.round((t.usage / Math.max(maxUsage, 1)) * 100)}%` }}
                        />
                      </span>
                      <span className="w-12 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                        {t.usage} 次
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>

          {/* 筛选条：搜索 / 排序 / 回收站切换 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 pl-8 text-xs"
                value={p.q}
                onChange={(e) => p.setQ(e.target.value)}
                placeholder="搜索素材名 / 标签…"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs">
                  <ArrowDownUp className="h-3 w-3 opacity-60" />
                  {SORT_LABELS[p.sort]}
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">排序</div>
                {(["usage", "created", "bytes"] as const).map((k) => (
                  <DropdownMenuItem key={k} onSelect={() => p.setSort(k)} className="text-xs">
                    {SORT_LABELS[k]}
                    {p.sort === k ? <span className="ml-auto text-primary">✓</span> : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant={p.trashedView ? "default" : "outline"}
              className="h-8 px-2.5 text-xs"
              onClick={() => {
                p.setTrashedView(!p.trashedView)
                p.setCategory("")
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              回收站{trashed ? `（${trashed}）` : ""}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2.5 text-xs"
              onClick={() => void p.exportIndex()}
              title="导出素材索引 JSON"
            >
              <Download className="h-3.5 w-3.5" />
              导出索引
            </Button>
          </div>

          {/* 网格：加载 / 空 / 有数据三态分开，空态保留骨架 */}
          {!p.itemsLoaded && p.itemsLoading ? (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-border py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              素材加载中…
            </div>
          ) : p.items.length === 0 ? (
            p.trashedView ? (
              <EmptyState
                title="回收站为空"
                hint="删除的素材会先进入回收站，可随时恢复；彻底删除请到「库设置」清空。"
                action={
                  <Button size="sm" variant="outline" onClick={() => p.setTrashedView(false)}>
                    返回素材列表
                  </Button>
                }
              />
            ) : isFiltering ? (
              // 筛选后 0 条 ≠ 库是空的：这两种情况用户要做的下一步完全不同
              <EmptyState
                title="当前筛选条件下没有素材"
                hint={`已按${p.q.trim() ? `关键词「${p.q.trim()}」` : ""}${p.q.trim() && (p.category || p.source) ? " + " : ""}${p.category ? `分类「${p.category}」` : ""}${p.category && p.source ? " + " : ""}${p.source ? `来源「${MATERIAL_SOURCE_LABELS[p.source as keyof typeof MATERIAL_SOURCE_LABELS] ?? p.source}」` : ""}筛选，库里共 ${statText(total)} 个素材。`}
                icon={<Search className="h-8 w-8 text-muted-foreground" />}
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      p.setQ("")
                      p.setCategory("")
                      p.setSource("")
                    }}
                  >
                    清空筛选
                  </Button>
                }
              />
            ) : (
              // 真空库：保留骨架（左树与排行卡都还在），只把网格区换成双路径入口
              <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
                <Images className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">素材库还是空的</p>
                <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                  两条入库路径：本地导入架构图 / 系统截图 / 现场照，或联网抓取氛围图。入库后这里的分类树、使用排行会随之长出来。
                </p>
                <div className="mx-auto mt-4 grid max-w-md gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => navigate("/materials?tab=import")}
                    className="rounded-xl border-2 border-dashed border-border bg-background p-4 text-left transition-colors hover:border-primary/60 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <FolderInput className="mb-1.5 h-5 w-5 text-primary" />
                    <p className="text-sm font-semibold text-foreground">本地导入</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">架构图 / 系统截图 / 现场照批量入库</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/materials?tab=web")}
                    className="rounded-xl border-2 border-dashed border-border bg-background p-4 text-left transition-colors hover:border-primary/60 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Globe className="mb-1.5 h-5 w-5 text-primary" />
                    <p className="text-sm font-semibold text-foreground">联网抓取</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">按场景词抓取氛围图，自动留档</p>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/materials?tab=settings")}
                  className="mt-4 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  抓图前先到「库设置」配置图库 API Key →
                </button>
              </div>
            )
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {p.items.map((it) => (
                  <MaterialCard key={it.id} it={it} onClick={() => void p.openDetail(it)} />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
                <span>
                  已显示 {p.items.length} / {p.totalItems} 个 · {SORT_LABELS[p.sort]}
                </span>
                <div className="flex-1" />
                {p.hasMore ? (
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={p.itemsLoading} onClick={p.loadMore}>
                    {p.itemsLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                    加载更多
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

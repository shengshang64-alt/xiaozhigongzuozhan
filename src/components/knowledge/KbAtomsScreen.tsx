// 知识库 · ③ 知识原子屏（UX-v2：/knowledge?tab=atoms，对齐 prototype/kb/atoms.html）。
//
// ## 这一屏解决什么
//
// 原型的判断很锋利：「知识原子 = **可被方案 / 标书直接引用的最小事实单元**。
// 它和文档的区别：文档是原文，原子是可复用的那句结论」——引用原子不会带进整篇文档的
// 口径污染（别的项目的医院名、报价）。所以原子必须**升为一等公民**：
// 独立视图给出引用次数、适用场景、冲突提示与来源溯源。
//
// ## 真实数据
//
// - 统计（总数 / 状态分布 / 类型分布 / 冲突数 / 高频引用 / 按文档聚合的引用次数）：
//   GET /api/kb/atoms/stats
// - 列表（分页 + 类型过滤）：GET /api/kb/atoms/list
//
// ## 没有数据就不画
//
// 库里 12,172 条原子中 **usage_count 全为 0**（使用反哺链路未接线），
// **conflict_group 全为空**。因此：
//   · 「引用次数」列显示 0 而不是假的 47；
//   · 「冲突待裁决」在真的没有冲突时显示「当前没有待裁决的冲突」，
//     而不是硬凑三条示例冲突。
// 这两处的真实数字一旦被接线（见交付说明），界面会**自动**显示出来，无需改代码。

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, ChevronLeft, ChevronRight, Layers, Link2, Pencil, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/shell/PageHeader"
import { EmptyState, ErrorState, LoadingState } from "@/components/common/DataStates"
import {
  KbAlert,
  KbBarRow,
  KbCard,
  KbCardBody,
  KbCardFoot,
  KbCardHead,
  KbChip,
  KbStatBar,
  KbStatItem,
} from "@/components/knowledge/KbPrimitives"
import { fetchKbAtomList, type KbAtomListRow } from "@/components/knowledge/kbAtomsApi"
import { KbAtomCiteDialog, type CiteableAtom } from "@/components/knowledge/KbAtomCiteDialog"
import { useKbAtomStats } from "@/components/knowledge/useKbAtomStats"
import { ATOM_TYPE_LABEL, ATOM_STATUS_LABEL, type AtomStatus, type AtomType } from "@/pages/Knowledge/kbAtoms"
import type { KbTab } from "@/components/knowledge/kbTabs"

const PAGE_SIZE = 20

const TYPE_TONE: Record<string, "default" | "success" | "warning" | "danger" | "neutral" | "secondary"> = {
  policy: "secondary",
  metric: "warning",
  qualification: "secondary",
  product_capability: "success",
  case: "warning",
  play: "neutral",
  script: "neutral",
  fact: "default",
}

const STATUS_TONE: Record<string, "default" | "success" | "warning" | "danger" | "neutral" | "secondary"> = {
  approved: "success",
  pending: "warning",
  rejected: "danger",
  conflict: "danger",
  superseded: "neutral",
  expired: "neutral",
  draft: "neutral",
}

export function KbAtomsScreen({ onTab, userId }: { onTab: (tab: KbTab) => void; userId: string | null }) {
  const { stats, loading, error, reload } = useKbAtomStats()
  const [items, setItems] = useState<KbAtomListRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [typeFilter, setTypeFilter] = useState<string>("")
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [citing, setCiting] = useState<CiteableAtom | null>(null)

  const load = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    try {
      const r = await fetchKbAtomList({
        status: "approved",
        atomType: typeFilter || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      setItems(r.items)
      setTotal(r.total)
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e))
      setItems([])
      setTotal(0)
    } finally {
      setListLoading(false)
    }
  }, [page, typeFilter])

  useEffect(() => {
    // setTimeout(0)：让 setState 发生在微任务之后（react-hooks/set-state-in-effect 规则），
    // 与 useKbReview.ts 的队列加载同款写法。
    const t = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(t)
  }, [load])

  const byType = useMemo(() => {
    const entries = Object.entries(stats?.byType ?? {})
    const max = Math.max(1, ...entries.map(([, v]) => v))
    return entries
      .map(([k, v]) => ({ key: k, label: ATOM_TYPE_LABEL[k as AtomType] ?? k, count: v, pct: (v / max) * 100 }))
      .sort((a, b) => b.count - a.count)
  }, [stats])

  const topUsed = stats?.topUsed ?? []
  const maxTop = Math.max(1, ...topUsed.map((t) => t.usageCount))
  const pending = Number(stats?.byStatus?.pending ?? 0)
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 text-foreground duration-500">
      <PageHeader
        title="知识原子"
        titleExtra={
          <>
            <Badge variant="secondary">{(stats?.total ?? 0).toLocaleString("zh-CN")} 条</Badge>
            {(stats?.conflictCount ?? 0) > 0 ? (
              <Badge variant="danger">{stats?.conflictCount} 条冲突待裁决</Badge>
            ) : null}
          </>
        }
        desc={
          <>
            知识原子 = <b>可被方案 / 标书直接引用的最小事实单元</b>：一句话说清一个事实、一个指标、一条政策条款。
            <b>它和文档的区别：文档是原文，原子是可复用的那句结论</b>——引用原子不会带进整篇文档的口径污染。
          </>
        }
        meta={
          <>
            <span>
              原子总数 <b className="font-mono font-semibold text-foreground">{(stats?.total ?? 0).toLocaleString("zh-CN")}</b>
            </span>
            <span>
              待审核 <b className="font-mono font-semibold text-foreground">{pending.toLocaleString("zh-CN")}</b>
            </span>
            <span>
              有引用记录 <b className="font-mono font-semibold text-foreground">{(stats?.withUsage ?? 0).toLocaleString("zh-CN")}</b>
            </span>
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => onTab("review")}>
              审核 {pending > 0 ? <span className="rounded-full bg-muted px-1.5 text-[10px]">{pending}</span> : null}
            </Button>
            <Button className="gap-1.5" onClick={() => onTab("upload")}>
              <Sparkles className="h-4 w-4" />
              从文档抽原子
            </Button>
          </>
        }
      />

      {/* 数据条：一行指标，不是三张统计卡 */}
      <KbStatBar>
        <KbStatItem label="原子总数" value={(stats?.total ?? 0).toLocaleString("zh-CN")} />
        <KbStatItem label="待审核" value={pending.toLocaleString("zh-CN")} tone="warning" />
        <KbStatItem label="已通过" value={Number(stats?.byStatus?.approved ?? 0).toLocaleString("zh-CN")} tone="success" />
        <KbStatItem label="冲突待裁决" value={(stats?.conflictCount ?? 0).toLocaleString("zh-CN")} tone="danger" />
        <KbStatItem label="有引用记录" value={(stats?.withUsage ?? 0).toLocaleString("zh-CN")} />
        <div className="grow" />
        {topUsed.length > 0 ? (
          <KbStatItem
            label="引用次数 Top 3"
            value={
              <span className="font-sans text-xs font-normal text-muted-foreground">
                {topUsed
                  .slice(0, 3)
                  .map((t) => t.title.slice(0, 12))
                  .join(" / ")}
              </span>
            }
          />
        ) : null}
      </KbStatBar>

      <div className="mt-4 grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* 左：原子清单 */}
        <div className="col flex min-w-0 flex-col gap-4">
          <KbCard>
            <KbCardHead
              title="原子清单"
              icon={<Layers className="h-3.5 w-3.5" />}
              sub="一句话事实 + 适用场景 + 引用次数，冲突项标红"
              actions={
                <div className="flex flex-wrap items-center gap-1.5">
                  <KbChip active={typeFilter === ""} onClick={() => { setTypeFilter(""); setPage(0) }}>
                    全部
                  </KbChip>
                  {byType.slice(0, 4).map((t) => (
                    <KbChip
                      key={t.key}
                      count={t.count}
                      active={typeFilter === t.key}
                      onClick={() => {
                        setTypeFilter(typeFilter === t.key ? "" : t.key)
                        setPage(0)
                      }}
                    >
                      {t.label}
                    </KbChip>
                  ))}
                </div>
              }
            />
            <KbCardBody flush>
              {listLoading ? (
                <LoadingState tone="compact" text="正在加载原子清单…" />
              ) : listError ? (
                <div className="p-3">
                  <ErrorState tone="compact" title="原子清单加载失败" reason={listError} onRetry={load} />
                </div>
              ) : items.length === 0 ? (
                <EmptyState
                  title="当前筛选下没有已通过审核的原子"
                  hint="原子要经过「原子审核」逐条确认才会进入清单。换个类型，或去审核队列看看候选。"
                  action={
                    <Button size="sm" variant="outline" onClick={() => onTab("review")}>
                      去原子审核
                    </Button>
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <caption className="sr-only">知识原子清单</caption>
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left">
                        <th scope="col" className="px-3 py-2 text-xs font-medium text-muted-foreground">原子内容（一句话事实）</th>
                        <th scope="col" className="w-[86px] px-3 py-2 text-xs font-medium text-muted-foreground">类型</th>
                        <th scope="col" className="w-[110px] px-3 py-2 text-xs font-medium text-muted-foreground">适用场景</th>
                        <th scope="col" className="w-[64px] px-3 py-2 text-right text-xs font-medium text-muted-foreground">引用</th>
                        <th scope="col" className="w-[130px] px-3 py-2 text-xs font-medium text-muted-foreground">来源文档</th>
                        <th scope="col" className="w-[92px] px-3 py-2 text-xs font-medium text-muted-foreground">状态</th>
                        <th scope="col" className="w-[92px] px-3 py-2 text-right text-xs font-medium text-muted-foreground">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((a) => (
                        <tr key={a.id} className="border-b border-border/60 last:border-b-0 hover:bg-muted/30">
                          <td className="px-3 py-2.5">
                            <p className="text-[13px] font-semibold text-foreground">{a.title}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              编号 {a.id.slice(0, 8)}
                              {a.conflictGroup ? <span className="ml-1 text-destructive">· 冲突组 {a.conflictGroup}</span> : null}
                            </p>
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge variant={TYPE_TONE[a.atomType] ?? "neutral"}>
                              {ATOM_TYPE_LABEL[a.atomType as AtomType] ?? a.atomType}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground">
                            {a.usableFor.length > 0 ? a.usableFor.join(" · ") : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs text-foreground">
                            {a.usageCount > 0 ? <b>{a.usageCount}</b> : <span className="text-muted-foreground">0</span>}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground">
                            <span className="line-clamp-2">{a.docName || "—"}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge variant={STATUS_TONE[a.status] ?? "neutral"}>
                              {ATOM_STATUS_LABEL[a.status as AtomStatus] ?? a.status}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                title="引用到项目"
                                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                onClick={() =>
                                  setCiting({
                                    id: a.id,
                                    title: a.title,
                                    body: a.body,
                                    docName: a.docName,
                                    sourceAnchor: a.sourceAnchor,
                                    sourceDocId: a.sourceDocId,
                                  })
                                }
                              >
                                <Link2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                title="编辑"
                                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </KbCardBody>
            <KbCardFoot>
              <span>共 {total.toLocaleString("zh-CN")} 条</span>
              <div className="grow" />
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-7 p-0"
                  disabled={page <= 0}
                  onClick={() => setPage((v) => Math.max(0, v - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="px-1 text-[11px] text-muted-foreground">
                  {page + 1} / {pageCount}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-7 p-0"
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage((v) => v + 1)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </KbCardFoot>
          </KbCard>

          <KbAlert tone="info" icon={<AlertTriangle className="h-4 w-4" />}>
            <b>为什么原子比文档好用</b>：写方案时引用的是「一句话事实」，不是整篇文档——不会把别的项目的医院名、报价、口径一起带进来；
            标书检查的「数字口径一致性」也是拿原子表对正文，能抓到同一个指标在两个章节写两个数。
          </KbAlert>
        </div>

        {/* 右列 */}
        <div className="col flex flex-col gap-4">
          <KbCard>
            <KbCardHead title="高频引用原子 Top5" sub="近 90 天" />
            <KbCardBody tight>
              {loading ? (
                <LoadingState tone="compact" text="正在统计…" />
              ) : error ? (
                <ErrorState tone="compact" title="统计加载失败" reason={error} onRetry={reload} />
              ) : topUsed.length === 0 ? (
                <EmptyState
                  tone="compact"
                  title="还没有引用记录"
                  hint="引用次数在原子被方案 / 标书实际引用后累积。目前库里还没有产生过引用。"
                />
              ) : (
                <div className="flex flex-col gap-2">
                  {topUsed.slice(0, 5).map((t) => (
                    <KbBarRow key={t.id} label={t.title.slice(0, 14)} value={t.usageCount} pct={(t.usageCount / maxTop) * 100} />
                  ))}
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    引用次数高 = 被方案与标书反复验证过，优先复用它，别重写。
                  </p>
                </div>
              )}
            </KbCardBody>
          </KbCard>

          <KbCard>
            <KbCardHead title="冲突待裁决" actions={<Badge variant={stats?.conflictCount ? "danger" : "neutral"}>{stats?.conflictCount ?? 0}</Badge>} />
            <KbCardBody tight>
              {(stats?.conflictCount ?? 0) === 0 ? (
                <EmptyState
                  tone="compact"
                  title="当前没有待裁决的冲突"
                  hint="冲突 = 同一主题下两个结论不一致（数值差异 > 5%）。有冲突时这里会列出可裁决的组。"
                />
              ) : (
                <ul className="flex flex-col gap-2">
                  {items
                    .filter((a) => a.conflictGroup)
                    .slice(0, 5)
                    .map((a) => (
                      <li key={a.id} className="flex items-center gap-2">
                        <Badge variant="danger">冲突</Badge>
                        <span className="min-w-0 grow truncate text-xs text-foreground">{a.title}</span>
                      </li>
                    ))}
                </ul>
              )}
            </KbCardBody>
            <KbCardFoot>
              <span className="text-[11px]">裁决规则：数值差异 &gt; 5% 才算冲突</span>
              <div className="grow" />
              <Button size="sm" variant="link" className="h-7 px-1 text-xs" onClick={() => onTab("review")}>
                去审核 →
              </Button>
            </KbCardFoot>
          </KbCard>

          <KbCard>
            <KbCardHead title="按类型分布" />
            <KbCardBody tight>
              {loading ? (
                <LoadingState tone="compact" text="正在统计…" />
              ) : byType.length === 0 ? (
                <EmptyState tone="compact" title="还没有原子" hint="上传文档后即可抽取知识原子。" />
              ) : (
                <div className="flex flex-col gap-2">
                  {byType.map((t) => (
                    <KbBarRow key={t.key} label={t.label} value={t.count.toLocaleString("zh-CN")} pct={t.pct} />
                  ))}
                </div>
              )}
            </KbCardBody>
          </KbCard>
        </div>
      </div>

      <KbAtomCiteDialog
        open={citing !== null}
        atom={citing}
        userId={userId}
        onClose={() => setCiting(null)}
        onCited={() => {
          reload()
          void load()
        }}
      />
    </div>
  )
}

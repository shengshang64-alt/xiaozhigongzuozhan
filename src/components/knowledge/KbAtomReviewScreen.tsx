// 知识库 · ④ 原子审核屏（UX-v2：/knowledge?tab=review，对齐 prototype/kb/review.html）。
//
// ## 这一屏解决什么
//
// 原型的判词：「审核员不问『这条有用吗』，只问『以后能在哪儿用』——所以每条必须先勾适用场景才能通过」。
// 原型指出的老问题也很具体：抽取结果只能在审核页里逐条过，看不到原文，用户要么一边翻文档一边判断，
// 要么干脆无脑点通过。
//
// 改造后：左队列按「冲突优先 → 高价值 → 低置信最后」排序，中栏原文与抽出的事实并排对照，
// 右栏一键采纳并提示快捷键。
//
// ## 复用既有逻辑（零重复）
//
// 队列加载、乐观更新与回滚、用途门禁（canApprove）、驳回五选一、批量采纳、
// 撤销（10 秒）、冲突去重批量计划、键盘快捷键——全部来自 `useKbReview`（既有数据层，不改）。
// 本文件只负责**三栏版式**。

import { useMemo, useState } from "react"
import { AlertTriangle, ChevronLeft, ChevronRight, Layers, Loader2, RotateCcw, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  KbSeg,
} from "@/components/knowledge/KbPrimitives"
import { ATOM_TYPE_LABEL, USABLE_FOR, USABLE_FOR_LABEL, isLowConfidence, type AtomType } from "@/pages/Knowledge/kbAtoms"
import { FILTER_LABEL, REJECT_REASONS, type RejectReason, type ReviewFilter } from "@/pages/Knowledge/kbReview"
import { useKbReview } from "@/pages/Knowledge/useKbReview"
import { useKbAtomStats } from "@/components/knowledge/useKbAtomStats"
import type { KbTab } from "@/components/knowledge/kbTabs"

const FILTERS: ReviewFilter[] = ["all", "conflict", "highConfidence", "lowConfidence", "missingUsableFor"]

export function KbAtomReviewScreen({
  userId,
  onTab,
}: {
  userId: string | null
  onTab: (tab: KbTab) => void
}) {
  const r = useKbReview(userId)
  // 队列为空时，用原子统计做「真空」与「加载失败」的区分——
  // useKbReview 内部对加载失败只弹 toast，队列会留空；不加这一层的话，
  // 界面会把「加载失败」显示成「队列已清空」（正是契约禁止的「把失败说成空」）。
  const { stats: atomStats, error: statsError } = useKbAtomStats()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState<RejectReason>("不准")
  // 事实内容的草稿：按原子 id 存，切换原子时自动回落到原文标题（渲染期派生，不用 effect）
  const [draft, setDraft] = useState<{ id: string; title: string } | null>(null)

  const cur = r.current
  const draftTitle = cur ? (draft && draft.id === cur.id ? draft.title : cur.title) : ""

  const stats = useMemo(
    () => ({
      total: r.queue.length,
      conflict: r.queue.filter((a) => a.conflictGroup).length,
      high: r.queue.filter((a) => !isLowConfidence(a)).length,
      low: r.queue.filter((a) => isLowConfidence(a)).length,
    }),
    [r.queue],
  )

  const approveDisabled = !cur || r.selectedUsableFor.length === 0

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 text-foreground duration-500">
      <PageHeader
        title="原子审核"
        titleExtra={<Badge variant="warning">待审核 {stats.total}</Badge>}
        desc={
          <>
            这一屏只做一件事：<b>把抽取出来的候选原子逐条判「留 / 改 / 丢」</b>。
            审核员不问「这条有用吗」，只问「以后能在哪儿用」——所以每条必须先勾适用场景才能通过。
          </>
        }
        meta={
          <>
            <span>
              队列 <b className="font-mono font-semibold text-foreground">{stats.total}</b>
            </span>
            <span>
              高置信（≥0.55） <b className="font-mono font-semibold text-foreground">{stats.high}</b> 条
            </span>
            <span>
              冲突优先 <b className="font-mono font-semibold text-foreground">{stats.conflict}</b> 条
            </span>
          </>
        }
        actions={
          <Button variant="outline" onClick={() => onTab("atoms")}>
            查看已通过原子
          </Button>
        }
      />

      {/* 顶部工具条：筛选 + 刷新 + 批量计划 */}
      <KbCard>
        <KbCardBody>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">队列筛选</span>
            <KbSeg
              value={r.filter}
              onChange={(v) => r.setFilter(v)}
              options={FILTERS.map((f) => ({ value: f, label: FILTER_LABEL[f] }))}
            />
            <div className="grow" />
            {r.batchPlans.length > 0 ? (
              <span className="text-[11px] text-muted-foreground">
                检测到 {r.batchPlans.length} 项可批量处理（去重 / 冲突合并）
              </span>
            ) : null}
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => void r.load()} disabled={r.loading}>
              {r.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              刷新
            </Button>
          </div>
        </KbCardBody>
      </KbCard>

      {r.batchPlans.length > 0 ? (
        <KbCard className="mt-3">
          <KbCardHead title="批量操作" sub="每条仍走同一条服务端门禁，不绕过" />
          <KbCardBody tight>
            <ul className="flex flex-col gap-1.5">
              {r.batchPlans.map((p, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="grow text-[11px] text-muted-foreground">{p.reason}</span>
                  <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => void r.runBatch(p)}>
                    执行
                  </Button>
                </li>
              ))}
            </ul>
          </KbCardBody>
        </KbCard>
      ) : null}

      <div className="mt-4 grid min-w-0 grid-cols-1 items-start gap-3 xl:grid-cols-[272px_minmax(0,1fr)_288px]">
        {/* 左：待审核队列 */}
        <KbCard>
          <KbCardHead title="待审核队列" actions={<Badge variant="neutral">{stats.total}</Badge>} />
          <KbCardBody flush>
            {r.loading && r.queue.length === 0 ? (
              <LoadingState tone="compact" text="正在加载队列…" />
            ) : r.filtered.length === 0 ? (
              statsError ? (
                <div className="p-3">
                  <ErrorState
                    tone="compact"
                    title="待审队列加载失败"
                    reason={statsError}
                    hint="这不是「队列已清空」。点重试重新拉取。"
                    onRetry={() => void r.load()}
                  />
                </div>
              ) : Number(atomStats?.byStatus?.pending ?? 0) > 0 ? (
                <div className="p-3">
                  <ErrorState
                    tone="compact"
                    title="待审队列没有加载出来"
                    reason={`统计显示服务端还有 ${atomStats?.byStatus?.pending} 条待审原子，但队列列表是空的`}
                    hint="这不是「队列已清空」。点重试重新拉取。"
                    onRetry={() => void r.load()}
                  />
                </div>
              ) : (
                <EmptyState
                  tone="compact"
                  title={r.queue.length === 0 ? "队列已清空" : "当前筛选下没有待审原子"}
                  hint={
                    r.queue.length === 0
                      ? "所有原子都已审核完毕。可以去「知识原子」看已通过的清单，或从文档里再抽一批。"
                      : "换一个筛选条件看看。"
                  }
                  action={
                    <Button size="sm" variant="outline" onClick={() => onTab("atoms")}>
                      去知识原子
                    </Button>
                  }
                />
              )
            ) : (
              <ul>
                {r.filtered.map((a, i) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => r.setIndex(i)}
                      className={`w-full border-b border-border/60 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/40 ${
                        cur?.id === a.id ? "bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]" : ""
                      }`}
                    >
                      <p className="truncate text-xs font-semibold text-foreground">{a.title}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {a.conflictGroup ? "冲突优先 · " : ""}
                        {ATOM_TYPE_LABEL[a.atomType]} · 置信度 {a.confidence.toFixed(2)}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{a.sourceAnchor || a.sourceDocId}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </KbCardBody>
          <KbCardFoot>
            <span className="text-[11px]">排序：冲突 → 高潜在价值 → 近期 → 低置信置后</span>
          </KbCardFoot>
        </KbCard>

        {/* 中：原文对照 + 抽取出的事实 */}
        <div className="col flex min-w-0 flex-col gap-3">
          {!cur ? (
            <KbCard>
              <KbCardBody>
                <EmptyState
                  title={r.loading ? "正在加载队列…" : "没有待审核的原子"}
                  hint={r.loading ? undefined : "队列空了。可以从「文档库」里挑一篇抽为原子，或直接去「知识原子」看已通过清单。"}
                  icon={<Layers className="h-8 w-8 text-muted-foreground" />}
                />
              </KbCardBody>
            </KbCard>
          ) : (
            <>
              <KbCard>
                <KbCardHead
                  title="原文对照"
                  sub={cur.sourceAnchor || "来源文档片段"}
                  actions={
                    cur.conflictGroup ? (
                      <Badge variant="danger">冲突待裁决</Badge>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => r.setSourceOpen(!r.sourceOpen)}>
                        {r.sourceOpen ? "收起原文" : "展开原文"}
                      </Button>
                    )
                  }
                />
                {r.sourceOpen ? (
                  <KbCardBody>
                    <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5">
                      <p className="text-xs leading-relaxed text-muted-foreground">{cur.sourceQuote || "（原文片段为空）"}</p>
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      原文命中已用琥珀徽标标出，高亮即为抽取依据。
                    </p>
                  </KbCardBody>
                ) : null}
              </KbCard>

              <KbCard>
                <KbCardHead
                  title="抽取出的事实"
                  sub="可逐条编辑后采纳"
                  actions={<Badge variant="warning">置信度 {cur.confidence.toFixed(2)}</Badge>}
                />
                <KbCardBody>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="kb-atom-title" className="text-xs font-medium text-foreground">
                        原子 1 · 事实内容
                      </label>
                      <Input
                        id="kb-atom-title"
                        value={draftTitle}
                        onChange={(e) => setDraft({ id: cur.id, title: e.target.value })}
                        className="h-9 text-[13px]"
                      />
                      <span className="text-[11px] text-muted-foreground">
                        {cur.conflictGroup
                          ? `与同组其它版本冲突 —— 裁决时保留有原文可溯源的那条，另一条标为「已被替代」。`
                          : "置信度较高，无冲突"}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-foreground">类型（1-8 快速切换）</span>
                      <div className="flex flex-wrap gap-1.5">
                        {ATOM_TYPES_FOR_PICK.map((t) => (
                          <KbChip key={t} active={cur.atomType === t} onClick={() => void r.setAtomType(t)}>
                            {ATOM_TYPE_LABEL[t]}
                          </KbChip>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-foreground">
                        适用场景（必须至少勾 1 个才能通过）
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {USABLE_FOR.map((u) => {
                          const on = r.selectedUsableFor.includes(u)
                          return (
                            <label key={u} className="inline-flex items-center gap-1.5 text-xs text-foreground">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() =>
                                  r.setSelectedUsableFor(
                                    on ? r.selectedUsableFor.filter((x) => x !== u) : [...r.selectedUsableFor, u],
                                  )
                                }
                                className="h-3.5 w-3.5 rounded border-border"
                              />
                              {USABLE_FOR_LABEL[u]}
                            </label>
                          )
                        })}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
                      <Badge variant="success">来源可溯源</Badge>
                      <span className="text-[11px] text-muted-foreground">
                        来源：{cur.docName || cur.sourceDocId}
                        {cur.sourceAnchor ? ` · ${cur.sourceAnchor}` : ""}
                      </span>
                    </div>
                  </div>
                </KbCardBody>
              </KbCard>

              {cur.conflictGroup ? (
                <KbAlert tone="warning" icon={<AlertTriangle className="h-4 w-4" />}>
                  <b>这条与同组其它版本冲突</b>：同一条事实两个版本。裁决时不是「选一个删一个」，
                  而是保留有原文可溯源的那条，另一条标为「已被替代」，历史引用不受影响。
                </KbAlert>
              ) : null}
            </>
          )}
        </div>

        {/* 右：操作区 + 进度 + 驳回原因 */}
        <div className="col flex flex-col gap-3">
          <KbCard>
            <KbCardHead title="操作" sub={cur ? `当前第 ${r.index + 1} / ${r.filtered.length} 条` : "—"} />
            <KbCardBody tight>
              <div className="flex flex-col gap-1.5">
                <Button
                  className="w-full"
                  disabled={approveDisabled}
                  onClick={() => void r.approve()}
                  title={approveDisabled ? "请先勾选至少一个适用场景" : "通过并入库"}
                >
                  采纳（A）
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!cur}
                  onClick={() => setDraft({ id: cur.id, title: draftTitle })}
                  title="先在中间栏改写事实内容，再点「采纳」即可（改写后的内容会随采纳一起落库）"
                >
                  改写后采纳（E）
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!cur || r.batchPlans.length === 0}
                  onClick={() => {
                    const plan = r.batchPlans[0]
                    if (plan) void r.runBatch(plan)
                  }}
                  title={r.batchPlans.length === 0 ? "当前没有可合并的重复项" : `合并到已有原子：${r.batchPlans[0]?.reason ?? ""}`}
                >
                  合并到已有原子
                </Button>
                <Button
                  variant="outline"
                  className="w-full border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={!cur}
                  onClick={() => setRejectOpen(true)}
                >
                  丢弃（R）
                </Button>
                <div className="my-1 h-px bg-border" />
                <Button variant="ghost" className="w-full" disabled={!r.undoAvailable} onClick={() => void r.undo()}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  撤销上一步（U）
                </Button>
                <div className="flex gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={r.index <= 0}
                    onClick={() => r.setIndex(Math.max(0, r.index - 1))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    上一条 K
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={r.index + 1 >= r.filtered.length}
                    onClick={() => r.setIndex(Math.min(r.filtered.length - 1, r.index + 1))}
                  >
                    下一条 J
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </KbCardBody>
            <KbCardFoot className="flex-col items-start gap-1">
              <div className="flex w-full items-center gap-2 text-[11px]">
                <span className="font-mono">A</span>
                <span className="text-muted-foreground">通过（需先勾用途）</span>
              </div>
              <div className="flex w-full items-center gap-2 text-[11px]">
                <span className="font-mono">R</span>
                <span className="text-muted-foreground">驳回（5 选 1 原因）</span>
              </div>
              <div className="flex w-full items-center gap-2 text-[11px]">
                <span className="font-mono">1-8</span>
                <span className="text-muted-foreground">快速改类型</span>
              </div>
              <div className="flex w-full items-center gap-2 text-[11px]">
                <span className="font-mono">空格</span>
                <span className="text-muted-foreground">展开 / 收起原文</span>
              </div>
            </KbCardFoot>
          </KbCard>

          <KbCard>
            <KbCardHead title="审核进度" />
            <KbCardBody tight>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs">队列剩余</span>
                  <div className="grow" />
                  <span className="font-mono text-xs font-semibold">{stats.total} 条</span>
                </div>
                <KbBarRow
                  label="高置信可批量过"
                  value={stats.high}
                  pct={stats.total ? (stats.high / stats.total) * 100 : 0}
                  tone="success"
                />
                <KbBarRow
                  label="冲突组优先"
                  value={stats.conflict}
                  pct={stats.total ? (stats.conflict / stats.total) * 100 : 0}
                  tone="warning"
                />
                <KbBarRow
                  label="低置信需细看"
                  value={stats.low}
                  pct={stats.total ? (stats.low / stats.total) * 100 : 0}
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  按每天 20 条算，{stats.total} 条约需 {Math.ceil(stats.total / 20)} 个工作日。
                </p>
              </div>
            </KbCardBody>
          </KbCard>

          <KbCard>
            <KbCardHead title="驳回原因（5 选 1）" />
            <KbCardBody tight>
              <div className="flex flex-wrap gap-1.5">
                {REJECT_REASONS.map((reason) => (
                  <KbChip key={reason} active={rejectReason === reason} onClick={() => setRejectReason(reason)}>
                    {reason}
                  </KbChip>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                为什么必须选原因：月度复盘看「套话 / 不准」占比，才知道抽取提示词该往哪调。
              </p>
            </KbCardBody>
          </KbCard>
        </div>
      </div>

      {/* 丢弃二次确认（危险操作） */}
      {rejectOpen && cur ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setRejectOpen(false)}>
          <div
            role="alertdialog"
            aria-label="丢弃这条原子？"
            className="w-[min(480px,92vw)] rounded-lg border border-border bg-card p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">丢弃这条原子？</h3>
              <button
                type="button"
                onClick={() => setRejectOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="关闭"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{cur.title}</p>
            <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-foreground">
              <b>丢弃后这条不会进入原子库</b>，原文依旧保留在来源文档里。10 秒内可按 U 撤销。
            </div>
            <div className="mt-3">
              <div className="mb-1.5 text-xs font-medium text-foreground">驳回原因</div>
              <div className="flex flex-wrap gap-1.5">
                {REJECT_REASONS.map((reason) => (
                  <KbChip key={reason} active={rejectReason === reason} onClick={() => setRejectReason(reason)}>
                    {reason}
                  </KbChip>
                ))}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <span className="text-[11px] text-muted-foreground">影响 1 条原子 · 可 10 秒内撤销</span>
              <Button variant="outline" size="sm" onClick={() => setRejectOpen(false)}>
                取消
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setRejectOpen(false)
                  void r.reject(rejectReason)
                }}
              >
                确认丢弃
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** 类型快捷选择（顺序即键盘 1-8 的映射顺序，取自既有 kbAtoms.ATOM_TYPES） */
const ATOM_TYPES_FOR_PICK: AtomType[] = ["fact", "metric", "case", "policy", "product_capability", "qualification", "play", "script"]

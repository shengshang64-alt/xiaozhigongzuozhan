// ---------------------------------------------------------------------------
// 知识原子审核台（2026-10-30 知识库 P0-5）
//
// 依据《知识库改造需求文档 v1.0》§7：
//   「审核工作台是人机交互的核心，决定项目成败」
//   目标吞吐：单条 8 秒 → 450 条/小时；含批量 ≥300 条/小时/人
//
// 布局严格按 §7.1 的 ASCII 稿：
//   ┌─ 顶部：待审 N · 冲突 N · 高置信 N · 低置信 N ＋ 筛选 ─┐
//   ├─ 左：卡片流（一次一条大卡）                          │
//   └─ 右：原文对照（自动滚到 source_anchor）+ 同主题版本    ┘
//
// 设计取舍：
//   · 不做"AI 帮我判断有用没用"——文档 §2 明确说这条路走不通
//   · 只做"AI 干机械活、人做价值判断"：人只回答"以后能在哪儿用"
//   · 快捷键优先：鼠标只用来勾用途和点批量，其余全键盘
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Layers,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ATOM_TYPE_LABEL, USABLE_FOR, USABLE_FOR_LABEL, isLowConfidence, type AtomType } from "./kbAtoms"
import { FILTER_LABEL, REJECT_REASONS, SHORTCUT_HELP, type RejectReason, type ReviewFilter } from "./kbReview"
import { recommendUsableFor } from "./kbUsableRecommend"
import { planBulkAdopt, summarizeBulkAdopt } from "./kbBulkAdopt"
import { useKbReview } from "./useKbReview"

const FILTERS: ReviewFilter[] = ["all", "conflict", "highConfidence", "lowConfidence", "missingUsableFor"]

/** 批量采纳推荐条（2026-11-01）：展示推荐用途分布 + 一键采纳入口 */
function BulkAdoptBar({
  queue,
  onAdopt,
}: {
  queue: import("./kbReview").ReviewAtom[]
  onAdopt: (items: { id: string; usableFor: string[] }[]) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const plan = useMemo(() => planBulkAdopt(queue), [queue])
  if (!plan.items.length) return null
  return (
    <details
      className="mt-2 rounded-md border border-success/30 bg-success/5 px-3 py-2"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-xs font-medium text-success">
        可按推荐批量通过 {plan.items.length} 条（点开确认用途分布后再执行）
      </summary>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{summarizeBulkAdopt(plan)}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        说明：用途来自类型+内容的规则推荐（qualification→标书 / script→答疑 / metric→方案+PPT 等），
        会写进原子的 usable_for 字段。执行后仍可在列表里单条修改。
      </p>
      <Button
        type="button"
        size="sm"
        className="mt-2 h-7 gap-1.5 bg-success text-[11px] hover:bg-success/90"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onAdopt(plan.items.map((i) => ({ id: i.id, usableFor: i.usableFor })))
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? "处理中…" : `批量通过 ${plan.items.length} 条`}
      </Button>
    </details>
  )
}

export function KbReviewPage({ userId, onBack }: { userId: string | null; onBack: () => void }) {
  const r = useKbReview(userId)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const usableRef = useRef<HTMLDivElement | null>(null)

  // 快捷键派发的事件（hook 里 dispatch，这里响应聚焦类动作）
  useEffect(() => {
    const onReject = () => setRejectOpen(true)
    const onEdit = () => setEditing(true)
    const onUsable = () => usableRef.current?.focus()
    window.addEventListener("kb-review-focus-reject", onReject)
    window.addEventListener("kb-review-focus-edit", onEdit)
    window.addEventListener("kb-review-focus-usable", onUsable)
    return () => {
      window.removeEventListener("kb-review-focus-reject", onReject)
      window.removeEventListener("kb-review-focus-edit", onEdit)
      window.removeEventListener("kb-review-focus-usable", onUsable)
    }
  }, [])

  const cur = r.current
  const stats = useMemo(
    () => ({
      total: r.queue.length,
      conflict: r.queue.filter((a) => a.conflictGroup).length,
      high: r.queue.filter((a) => !isLowConfidence(a)).length,
      low: r.queue.filter((a) => isLowConfidence(a)).length,
    }),
    [r.queue],
  )

  return (
    <div className="flex h-[calc(100vh-11rem)] flex-col">
      {/* 顶部统计与筛选 */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border pb-2">
        <h1 className="text-lg font-semibold text-foreground">知识原子审核</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-primary/10 px-2 py-0.5 font-medium text-primary">待审 {stats.total}</span>
          <span className="rounded bg-warning/15 px-2 py-0.5 text-warning">冲突 {stats.conflict}</span>
          <span className="rounded bg-success/15 px-2 py-0.5 text-success">高置信 {stats.high}</span>
          <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">低置信 {stats.low}</span>
        </div>
        <select
          value={r.filter}
          onChange={(e) => r.setFilter(e.target.value as ReviewFilter)}
          className="ml-auto h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
          aria-label="筛选待审队列"
        >
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {FILTER_LABEL[f]}
            </option>
          ))}
        </select>
        <Button type="button" variant="ghost" size="sm" onClick={() => void r.load()} disabled={r.loading} className="h-8 gap-1 text-xs">
          {r.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          刷新
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onBack} className="h-8 text-xs">
          返回知识库
        </Button>
      </div>

      {/* 2026-11-01：批量采纳用途推荐——原子库已扩到数千条，逐条点不现实。
          这里给出"按推荐一键采纳并通过"，审核人看到用途分布后确认即可（仍是人工确认）。 */}
      <BulkAdoptBar queue={r.queue} onAdopt={r.bulkAdoptApprove} />

      {/* 批量操作条 */}
      {r.batchPlans.length > 0 && (
        <details className="mt-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-primary">
            <Layers className="mr-1 inline h-3.5 w-3.5" />
            批量操作可用（{r.batchPlans.length} 项，可一次处理 {r.batchPlans.reduce((n, p) => n + (p.kind === "dedupeGroup" ? p.supersedeIds.length + 1 : p.atomIds.length), 0)} 条）
          </summary>
          <ul className="mt-2 space-y-1">
            {r.batchPlans.map((p, i) => (
              <li key={i} className="flex items-center gap-2 text-[11px]">
                <span className="flex-1 text-muted-foreground">{p.reason}</span>
                <Button type="button" variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => void r.runBatch(p)}>
                  执行
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* 主体：左卡片 / 右原文 */}
      {!cur ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
            <p className="mt-2 text-sm font-medium text-foreground">
              {r.queue.length === 0 ? "队列已清空" : "当前筛选下没有待审原子"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {r.queue.length === 0 ? "所有原子都已审核完毕，可以去开启抽取下一批文档" : "换一个筛选条件看看"}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_1fr]">
          {/* 左：审核卡片 */}
          <div className="flex min-h-0 flex-col overflow-y-auto rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                {ATOM_TYPE_LABEL[cur.atomType]}
              </span>
              {cur.conflictGroup && (
                <span className="flex items-center gap-1 rounded bg-warning/20 px-2 py-0.5 text-[11px] text-warning">
                  <AlertTriangle className="h-3 w-3" />
                  冲突待裁决
                </span>
              )}
              {isLowConfidence(cur) && (
                <span className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  低置信 {(cur.confidence * 100).toFixed(0)}%
                </span>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground">
                {r.index + 1} / {r.filtered.length}
              </span>
            </div>

            <h2 className="mt-2 text-base font-semibold leading-snug text-foreground">{cur.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">{cur.body}</p>

            {/* 属性 */}
            <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {cur.kbTrack && <span>赛道：{cur.kbTrack}</span>}
              {cur.kbBucket && <span>分组：{cur.kbBucket}</span>}
              {cur.validUntil && <span>有效期至：{cur.validUntil.slice(0, 10)}</span>}
              <span className="font-mono text-[10px] opacity-70">{cur.subjectKey}</span>
            </div>

            {/* 用途勾选（核心：P3 只问"以后能在哪儿用"） */}
            <div ref={usableRef} tabIndex={-1} className="mt-3 rounded-md border border-border bg-muted/30 p-2.5 outline-none focus:ring-2 focus:ring-primary">
              <p className="text-[11px] font-medium text-foreground">
                这条以后能在哪儿用？<span className="text-destructive">（至少勾一项才能通过）</span>
              </p>
              {/* 2026-11-01：用途推荐（按原子类型 + 内容信号给出建议，一键采纳）
                  批量审核 989 条时逐条判断不现实，推荐让审核人只需确认或微调 */}
              {(() => {
                const rec = recommendUsableFor(r.current.atomType, r.current.title, r.current.body)
                if (!rec.usableFor.length) return null
                const already = rec.usableFor.every((u: string) => r.selectedUsableFor.includes(u))
                return (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded bg-primary/5 px-1.5 py-1 text-[10px] text-muted-foreground">
                    <span>建议用途：{rec.usableFor.map((u: string) => USABLE_FOR_LABEL[u as keyof typeof USABLE_FOR_LABEL] ?? u).join(" / ")}</span>
                    {!already && (
                      <button
                        type="button"
                        onClick={() => r.setSelectedUsableFor(rec.usableFor)}
                        className="rounded border border-primary/40 px-1.5 py-0.5 text-primary hover:bg-primary/10"
                      >
                        一键采纳
                      </button>
                    )}
                  </div>
                )
              })()}
              <div className="mt-1.5 flex flex-wrap gap-2">
                {USABLE_FOR.map((u) => {
                  const checked = r.selectedUsableFor.includes(u)
                  return (
                    <label
                      key={u}
                      className={
                        checked
                          ? "flex cursor-pointer items-center gap-1 rounded border border-primary bg-primary/10 px-2 py-1 text-[11px] text-primary"
                          : "flex cursor-pointer items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-primary/40"
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          r.setSelectedUsableFor((prev) => (e.target.checked ? [...prev, u] : prev.filter((x) => x !== u)))
                        }
                        className="h-3 w-3"
                      />
                      {USABLE_FOR_LABEL[u]}
                    </label>
                  )
                })}
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" onClick={() => void r.approve()} className="gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                通过 <kbd className="rounded bg-black/20 px-1 text-[9px]">A</kbd>
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setRejectOpen(true)} className="gap-1.5">
                <XCircle className="h-3.5 w-3.5" />
                驳回 <kbd className="rounded bg-muted px-1 text-[9px]">R</kbd>
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing((v) => !v)} className="gap-1.5">
                <Pencil className="h-3.5 w-3.5" />
                改类型 <kbd className="rounded bg-muted px-1 text-[9px]">1-8</kbd>
              </Button>
              <div className="ml-auto flex items-center gap-1">
                <Button type="button" size="sm" variant="outline" onClick={() => r.setIndex((i) => Math.max(0, i - 1))} disabled={r.index <= 0} className="h-7 w-7 p-0">
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => r.setIndex((i) => Math.min(i + 1, r.filtered.length - 1))}
                  disabled={r.index >= r.filtered.length - 1}
                  className="h-7 w-7 p-0"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowHelpSafe(r.setShowHelp)} className="h-7 w-7 p-0" aria-label="快捷键帮助">
                  <HelpCircle className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* 改类型（数字键 1-8 也可） */}
            {editing && (
              <div className="mt-2 flex flex-wrap gap-1 rounded-md border border-border bg-muted/30 p-2">
                {(Object.keys(ATOM_TYPE_LABEL) as AtomType[]).map((t, i) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      void r.setAtomType(t)
                      setEditing(false)
                    }}
                    className={
                      t === cur.atomType
                        ? "rounded bg-primary px-2 py-0.5 text-[11px] text-primary-foreground"
                        : "rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/40"
                    }
                  >
                    {i + 1}·{ATOM_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            )}

            {/* 撤销提示 */}
            {r.undoAvailable && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>刚完成操作，</span>
                <button type="button" onClick={() => void r.undo()} className="font-medium text-primary hover:underline">
                  撤销（U）
                </button>
                <span>（限 10 秒内）</span>
              </p>
            )}
          </div>

          {/* 右：原文对照 */}
          <div className="flex min-h-0 flex-col overflow-y-auto rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">原文对照</h3>
              <button
                type="button"
                onClick={() => r.setSourceOpen((v) => !v)}
                className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
              >
                {r.sourceOpen ? "收起（空格）" : "展开（空格）"}
              </button>
            </div>

            {r.sourceOpen && (
              <div className="mt-2 space-y-2">
                <div className="rounded-md border border-border bg-muted/20 p-2.5">
                  <p className="text-[11px] font-medium text-foreground">来源摘录</p>
                  <p className="mt-1 text-xs leading-relaxed text-foreground/80">{cur.sourceQuote || "（无摘录）"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="truncate">来源：{cur.docName || cur.sourceDocId || "未知"}</span>
                  {cur.sourceAnchor && <span className="font-mono">锚点 {cur.sourceAnchor}</span>}
                </div>
                <p className="rounded-md bg-primary/5 px-2.5 py-2 text-[10px] leading-relaxed text-primary">
                  审核要点：这条内容是否**逐字来自原文**？数值/客户名/政策条款有没有被模型改写夸大？
                  拿不准就驳回，宁可少一条也不让错数据进正式库。
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 驳回原因选择（5 选 1，不填字） */}
      {rejectOpen && cur && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setRejectOpen(false)}>
          <div className="w-80 rounded-lg bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-foreground">驳回原因（5 选 1）</p>
            <div className="mt-2 space-y-1">
              {REJECT_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => {
                    void r.reject(reason as RejectReason)
                    setRejectOpen(false)
                  }}
                  className="w-full rounded border border-border px-3 py-1.5 text-left text-xs text-foreground hover:border-destructive hover:bg-destructive/5"
                >
                  {reason}
                </button>
              ))}
            </div>
            <Button type="button" variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setRejectOpen(false)}>
              取消（Esc）
            </Button>
          </div>
        </div>
      )}

      {/* 快捷键帮助 */}
      {r.showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => r.setShowHelp(false)}>
          <div className="w-96 rounded-lg bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              键盘快捷键
            </p>
            <ul className="mt-2 space-y-1">
              {SHORTCUT_HELP.map((s) => (
                <li key={s.key} className="flex items-center gap-2 text-xs">
                  <kbd className="min-w-12 rounded bg-muted px-1.5 py-0.5 text-center font-mono text-[10px] text-foreground">{s.key}</kbd>
                  <span className="text-muted-foreground">{s.desc}</span>
                </li>
              ))}
            </ul>
            <Button type="button" variant="ghost" size="sm" className="mt-3 w-full" onClick={() => r.setShowHelp(false)}>
              关闭
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** setShowHelp 的函数式更新包装（避免把 setState 直接传到 onClick 造成类型歧义） */
function setShowHelpSafe(setter: (updater: (v: boolean) => boolean) => void) {
  setter((v) => !v)
}

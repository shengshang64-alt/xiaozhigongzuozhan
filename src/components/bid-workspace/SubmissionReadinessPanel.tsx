// UX-R3: S9 交卷清单阻断分区 2026-11-08
//
// 原实现把 20+ 条清单按「阻断 > 待办 > 完成」排序平铺，视觉上仍是一片同级列表——
// 用户反馈「阻断项一眼跳不出来」。现改为三组视觉分区：
//   阻断（红底，置顶）→ 待办（灰底，居中）→ 已完成（绿底，默认折叠）
// 数据/判定口径完全不变，只改分组与呈现。
import { useMemo } from "react"
import { ArrowRightCircle, CheckCircle2, CircleDashed, ShieldAlert, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"
import { buildSubmissionReadiness, type ReadinessItem } from "@/pages/BidWorkspace/submissionReadiness"

const LEVEL_LABEL: Record<ReadinessItem["level"], string> = {
  blocking: "阻断",
  must: "应交",
  nice: "建议",
}

const LEVEL_CLASS: Record<ReadinessItem["level"], string> = {
  blocking: "border-destructive/40 bg-destructive/10 text-destructive",
  must: "border-warning/40 bg-warning/10 text-warning",
  nice: "border-border bg-muted text-muted-foreground",
}

const RANK: Record<ReadinessItem["status"], number> = { blocked: 0, todo: 1, done: 2 }

export function SubmissionReadinessPanel({
  project,
  onGo,
  onSplitProse,
}: {
  project: BidProjectRecord | null | undefined
  onGo: (step: number) => void
  /** P0-3：一键拆段（纯本地、零 AI、字符零改动） */
  onSplitProse?: () => void
}) {
  const r = useMemo(() => buildSubmissionReadiness(project ?? null), [project])
  const blocked = useMemo(
    () => r.items.filter((it) => it.status === "blocked").sort((a, b) => RANK[a.status] - RANK[b.status]),
    [r.items],
  )
  const todo = useMemo(() => r.items.filter((it) => it.status === "todo"), [r.items])
  const done = useMemo(() => r.items.filter((it) => it.status === "done"), [r.items])

  // 单行渲染（三组共用；阻断组用更大的「去处理」按钮）
  const renderItem = (it: ReadinessItem, group: "blocked" | "todo" | "done") => (
    <li
      key={it.id}
      className={`rounded-md border px-3 py-2 ${
        group === "blocked"
          ? "border-destructive/40 bg-destructive/10"
          : group === "todo"
            ? "border-border bg-background"
            : "border-border/60 bg-primary/5"
      }`}
    >
      <div className="flex flex-wrap items-start gap-2">
        {it.status === "done" ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        ) : it.status === "blocked" ? (
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        ) : (
          <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={`text-sm font-medium ${group === "blocked" ? "text-destructive" : "text-foreground"}`}>
              {it.title}
            </span>
            <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${LEVEL_CLASS[it.level]}`}>
              {LEVEL_LABEL[it.level]}
            </span>
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{it.detail}</span>
        </span>
        {it.id === "prose" && it.status !== "done" && onSplitProse && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 border-primary/40 text-xs text-primary hover:bg-primary/10"
            onClick={onSplitProse}
          >
            一键拆段
          </Button>
        )}
        {it.status !== "done" && (
          <Button
            size="sm"
            variant="outline"
            // UX-R3 S9：阻断项「去处理」加粗加大，直达对应步骤
            className={
              group === "blocked"
                ? "h-8 shrink-0 border-destructive/60 bg-destructive/10 px-3 text-xs font-semibold text-destructive hover:bg-destructive/20"
                : "h-7 shrink-0 border-border text-xs text-muted-foreground hover:text-foreground"
            }
            onClick={() => onGo(it.step)}
          >
            <ArrowRightCircle className="mr-1 h-3.5 w-3.5" />
            {group === "blocked" ? "去处理（阻断）" : "去处理"}
          </Button>
        )}
      </div>
    </li>
  )

  return (
    <section className="rounded-lg border border-border bg-card shadow-md">
      <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldAlert className="h-4 w-4 text-primary" />
            交卷清单
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            跨步骤汇总：解析、大纲、正文、偏离表、废标、体检、查重、评标——每一项都能一键跳到对应步骤处理（零 AI 费用）。
          </p>
        </div>
        {/* UX-R3 S9：顶部状态改为大号徽章，颜色随状态（阻断红 / 待办橙 / 可交绿） */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <span
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              r.blocked > 0
                ? "bg-destructive/15 text-destructive"
                : !r.ready && r.todo > 0
                  ? "bg-warning/15 text-warning"
                  : "bg-primary/15 text-primary"
            }`}
          >
            {r.blocked > 0 ? `还有 ${r.blocked} 项阻断，不能交卷` : !r.ready && r.todo > 0 ? `还有 ${r.todo} 项待办` : "可以交卷"}
          </span>
          <Badge variant="outline" className="rounded-full border-border text-muted-foreground">
            完成 {r.done}/{r.items.length}
          </Badge>
        </div>
      </header>

      <div className="flex flex-col gap-3 px-4 py-3">
        {/* 组 1：阻断（红底置顶） */}
        {blocked.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-destructive">
              <TriangleAlert className="h-3.5 w-3.5" />
              阻断 {blocked.length} 项 —— 不处理就无法交卷
            </p>
            <ul className="flex flex-col gap-2">{blocked.map((it) => renderItem(it, "blocked"))}</ul>
          </div>
        )}

        {/* 组 2：待办（灰底居中） */}
        {todo.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />
              待办 {todo.length} 项
            </p>
            <ul className="flex flex-col gap-2">{todo.map((it) => renderItem(it, "todo"))}</ul>
          </div>
        )}

        {/* 组 3：已完成（绿底，默认折叠） */}
        {done.length > 0 && (
          <details className="rounded-md border border-border/60 bg-primary/5 px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-primary">
              已完成 {done.length} 项（点击展开）
            </summary>
            <ul className="mt-2 flex flex-col gap-2">{done.map((it) => renderItem(it, "done"))}</ul>
          </details>
        )}
      </div>
    </section>
  )
}

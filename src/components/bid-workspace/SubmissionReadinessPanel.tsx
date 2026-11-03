// 2026-10-23（P0-1 交卷清单）：跨步骤总清单面板
//
// 与「导出卡」的区别：导出卡回答"这一份能不能导"，本面板回答"整份标书能不能交"。
// 数据全部来自项目记录与本地判定（submissionReadiness），零 AI 费用。
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
  const sorted = useMemo(
    () => [...r.items].sort((a, b) => RANK[a.status] - RANK[b.status] || (a.level === "blocking" ? -1 : 0)),
    [r.items],
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
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant={r.ready ? "success" : "warning"}>{r.ready ? "可以交卷" : "还不能交"}</Badge>
          <Badge variant="outline" className="rounded-full border-border text-muted-foreground">
            完成 {r.done}/{r.items.length}
          </Badge>
          {r.blocked > 0 && (
            <Badge variant="outline" className="rounded-full border-destructive/40 bg-destructive/10 text-destructive">
              阻断 {r.blocked}
            </Badge>
          )}
          {r.todo > 0 && (
            <Badge variant="outline" className="rounded-full border-warning/40 bg-warning/10 text-warning">
              待办 {r.todo}
            </Badge>
          )}
        </div>
      </header>

      <ul className="flex flex-col gap-2 px-4 py-3">
        {sorted.map((it) => (
          <li
            key={it.id}
            className={`rounded-md border px-3 py-2 ${
              it.status === "blocked"
                ? "border-destructive/30 bg-destructive/5"
                : it.status === "todo"
                  ? "border-border bg-background"
                  : "border-border/60 bg-card"
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
                  <span className="text-sm font-medium text-foreground">{it.title}</span>
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
                  className="h-7 shrink-0 border-border text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => onGo(it.step)}
                >
                  <ArrowRightCircle className="mr-1 h-3.5 w-3.5" />
                  去处理
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

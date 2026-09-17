import { Check, Loader2 } from "lucide-react"
import type { UseSolutionStudio } from "@/pages/SolutionStudio/useSolutionStudio"
import { VERDICT_LABEL, type ChapterReviewVerdict, type SolutionRecord } from "@/pages/SolutionStudio/solutionTypes"

type ChapterNavTreeProps = Pick<UseSolutionStudio, "activeSolution" | "activeChapterId" | "selectChapter" | "doneChapterCount"> & {
  /** 可选：自动补足循环进行中（标书工作页传入，方案编制不传不受影响） */
  supplementState?: { nodeId: string; round: number } | null
  /** 可选：小节级生成进行中（标书工作页传入，徽标「小节 j/k」；方案编制不传不受影响） */
  sectionState?: { nodeId: string; current: number; total: number } | null
}

function statusDot(genStatus: SolutionRecord["chapters"][number]["gen_status"], isActive: boolean): string {
  if (genStatus === "done") return "bg-primary"
  if (genStatus === "generating") return "bg-primary animate-pulse"
  if (genStatus === "failed") return "bg-destructive"
  return isActive ? "bg-muted-foreground" : "bg-border"
}

/** 轮次 E-4：自检 verdict 色点（direct 主色 / review 关注 / blocked 风险） */
function verdictDot(verdict: ChapterReviewVerdict): string {
  if (verdict === "direct") return "bg-primary"
  if (verdict === "review") return "bg-warning"
  return "bg-destructive"
}

const STATUS_TEXT: Record<string, string> = {
  pending: "待生成",
  generating: "生成中",
  done: "已生成",
  failed: "失败可重试",
}

export function ChapterNavTree({ activeSolution, activeChapterId, selectChapter, doneChapterCount, supplementState, sectionState }: ChapterNavTreeProps) {
  if (!activeSolution) return null
  const total = activeSolution.chapters.length
  const pct = total ? Math.round((doneChapterCount / total) * 100) : 0
  return (
    <aside className="flex h-full flex-col rounded-lg border border-border bg-card shadow-md">
      <div className="flex min-h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <p className="text-sm font-semibold text-foreground">大纲目录</p>
        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
          {doneChapterCount}/{total} 章
        </span>
      </div>
      <div className="shrink-0 px-4 pt-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <nav className="mt-2 flex-1 overflow-y-auto p-2">
        {activeSolution.chapters.map((ch, idx) => {
          const isActive = ch.node_id === activeChapterId
          return (
            <div key={ch.node_id} className="mb-0.5">
              <button
                type="button"
                onClick={() => selectChapter(ch.node_id)}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  isActive
                    ? "border border-primary/40 bg-primary/10 font-medium text-primary"
                    : "border border-transparent text-card-foreground hover:bg-secondary"
                }`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(ch.gen_status, isActive)}`} />
                {ch.selfCheck && (
                  <span
                    title={`自检 ${ch.selfCheck.total} 分 · ${VERDICT_LABEL[ch.selfCheck.verdict]}`}
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${verdictDot(ch.selfCheck.verdict)}`}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">
                  第{idx + 1}章 {ch.title}
                </span>
                {sectionState?.nodeId === ch.node_id ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    小节 {sectionState.current}/{sectionState.total}
                  </span>
                ) : supplementState?.nodeId === ch.node_id ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    补足中 第 {supplementState.round} 轮
                  </span>
                ) : (
                  <>
                    {ch.gen_status === "generating" && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
                    {ch.gen_status === "done" && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </>
                )}
              </button>
              {isActive && ch.sections.length > 0 && (
                <ul className="ml-4 mt-0.5 border-l border-border pl-3">
                  {ch.sections.map((sec, j) => (
                    <li key={sec} className="py-1 text-xs text-muted-foreground">
                      {idx + 1}.{j + 1} {sec}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </nav>
      <div className="shrink-0 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
        {STATUS_TEXT.pending} / 生成中 / 已生成 状态实时同步，可离开后回来继续
      </div>
    </aside>
  )
}

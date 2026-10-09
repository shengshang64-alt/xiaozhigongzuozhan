import { useMemo, useState } from "react"
import { CheckCircle2, ChevronDown, ChevronUp, ListChecks } from "lucide-react"
import { groupIssuesByPage, lintSummaryText, type DeckLintIssue, type DeckLintLevel } from "@/pages/PptQuote/deckLint"

// ---------------------------------------------------------------------------
// R166 deck 自检常驻面板：把 R121 的「导出前结构自检」从一次性导出 toast 接入编辑期——
// 逐页编辑/预览时实时列出命中问题（同一套 lintDeck 规则、同一份清单，不另起口径），
// 点页码跳转到对应幻灯片。非阻断契约维持：只提示、不拦截导出与生成。
// issues 由调用方对 slides memo 计算后传入（deckLint 结果最多 6 条，天然有界）。
// ---------------------------------------------------------------------------

type DeckLintPanelProps = {
  issues: DeckLintIssue[]
  /** 当前编辑页（0 基），用于高亮对应页码标签 */
  currentIndex: number
  /** 跳转到指定页（传入 0 基下标；由调用方负责切回逐页编辑） */
  onJumpToPage: (index: number) => void
}

const LEVEL_BADGE: Record<DeckLintLevel, { label: string; tone: string }> = {
  warn: { label: "需注意", tone: "bg-destructive/10 text-destructive" },
  info: { label: "可优化", tone: "bg-muted text-muted-foreground" },
}

export function DeckLintPanel({ issues, currentIndex, onJumpToPage }: DeckLintPanelProps) {
  const byPage = useMemo(() => groupIssuesByPage(issues), [issues])
  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem("ppt_lint_panel_open") === "1"
    } catch {
      return false
    }
  })
  const toggle = () => {
    setOpen((prev) => {
      try {
        sessionStorage.setItem("ppt_lint_panel_open", prev ? "0" : "1")
      } catch {
        /* 隐私模式静默降级，仅当次会话不记忆 */
      }
      return !prev
    })
  }

  if (!issues.length) {
    return (
      <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary animate-in fade-in duration-300">
        <CheckCircle2 className="h-3.5 w-3.5" />
        导出前自检：{lintSummaryText(issues)}
      </div>
    )
  }

  const pageTone = (page: number) =>
    page - 1 === currentIndex
      ? "bg-primary text-primary-foreground"
      : "bg-secondary text-muted-foreground hover:bg-primary/10 hover:text-primary"

  return (
    <section className="mt-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-md animate-in fade-in duration-300">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
          <ListChecks className="h-4 w-4 text-primary" />
          导出前自检
        </h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {lintSummaryText(issues)}
        </span>
        <span className="text-xs text-muted-foreground">
          {byPage.has(0)
            ? "含整份级问题，见明细"
            : [...byPage.keys()].filter((x) => x > 0).sort((a, b) => a - b).map((x) => `第 ${x} 页`).join(" · ")}
        </span>
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {open ? "收起明细" : "展开明细"}
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
      {open && (
        <ul className="mt-2 flex max-h-[220px] flex-col gap-1 overflow-y-auto border-t border-border pt-2">
          {issues.map((it, idx) => (
            <li key={`${it.code}:${it.page}:${idx}`} className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${LEVEL_BADGE[it.level].tone}`}>
                {LEVEL_BADGE[it.level].label}
              </span>
              {it.page > 0 ? (
                <button
                  type="button"
                  onClick={() => onJumpToPage(it.page - 1)}
                  title="跳到该页修改"
                  className={`shrink-0 rounded-full px-2 py-0.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${pageTone(it.page)}`}
                >
                  第 {it.page} 页
                </button>
              ) : (
                <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 font-medium text-muted-foreground">整份</span>
              )}
              <span className="min-w-0 flex-1 leading-relaxed text-card-foreground">{it.msg}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

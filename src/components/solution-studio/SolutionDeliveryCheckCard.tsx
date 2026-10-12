import { useMemo, useState } from "react"
import { ChevronDown, ChevronUp, Copy, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { copyTextToClipboard } from "@/lib/clipboard"
import {
  SOL_CHECK_RULES,
  auditSolutionDelivery,
  buildDeliveryFixText,
  type SolCheckHit,
} from "@/pages/SolutionStudio/solDeliveryCheck"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

// ---------------------------------------------------------------------------
// R252 方案交付前体检卡：与「需求条目落位核验」互补——那张卡管「客户要的写没写」，
// 这张卡管「写出来的有没有硬伤」（占位没填、元话语/绝对化承诺、跨章指标打架、
// 超链接水印、装饰残留、跨章复制、失败章空章）。全部本地判定，零 AI 零费用，
// 随正文自动保存实时重算，不需要点「重新核验」。只报不拦：任何命中都不挡导出。
// ---------------------------------------------------------------------------

type SolutionDeliveryCheckCardProps = {
  chapters: Chapter[]
  onSelectChapter: (nodeId: string) => void
}

/** 头部规则徽标最多展示 3 组，其余折叠为「+N 类」 */
const MAX_HEADER_CHIPS = 3

const TONE: Record<"warn" | "info", string> = {
  warn: "bg-destructive/10 text-destructive",
  info: "bg-warning/10 text-warning",
}

export function SolutionDeliveryCheckCard({ chapters, onSelectChapter }: SolutionDeliveryCheckCardProps) {
  const [expanded, setExpanded] = useState(false)
  // 依赖直接取数组本体（不在渲染期用 ?? [] 造新数组，否则 useMemo 每轮失稳）
  const report = useMemo(() => auditSolutionDelivery(chapters), [chapters])
  if (!chapters.length) return null

  const clean = report.total === 0
  const chips = report.groups.slice(0, MAX_HEADER_CHIPS)
  const fixText = buildDeliveryFixText(report)

  return (
    <section className="mt-4 rounded-lg border border-border bg-card px-4 py-3 shadow-md">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
          <ShieldCheck className={`h-4 w-4 ${clean ? "text-primary" : "text-destructive"}`} />
          交付前本地体检
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${clean ? "bg-primary/10 text-primary" : TONE.warn}`}
        >
          {clean ? "未发现硬伤" : `${report.warnCount} 处待复核`}
        </span>
        {report.infoCount > 0 && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE.info}`}>
            {report.infoCount} 处提示
          </span>
        )}
        {chips.map((g) => (
          <span key={g.rule} className={`rounded-full px-2 py-0.5 text-xs ${TONE[g.level]}`}>
            {g.label.split("（")[0]} {g.count}
          </span>
        ))}
        {report.groups.length > MAX_HEADER_CHIPS && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            +{report.groups.length - MAX_HEADER_CHIPS} 类
          </span>
        )}
        {!clean && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void copyTextToClipboard(fixText, {
                successMessage: "已复制整改清单，可逐条对照修订",
                errorMessage: "复制失败，请手动选择文本复制",
              })
            }}
            className="shrink-0 border-primary/40 text-primary hover:bg-primary/10"
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            复制整改清单
          </Button>
        )}
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {expanded ? "收起明细" : "展开明细"}
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {report.bodyChapters === 0
          ? clean
            ? `共 ${report.scannedChapters} 章，正文尚未生成（0 章），体检项在成稿后自动生效。`
            : `共 ${report.scannedChapters} 章，正文尚未生成（0 章），但已有 ${report.total} 处要先处理（生成失败 / 标完成却空章 / 占位未填）；补齐正文后其余核验项自动生效。`
          : clean
            ? `${report.bodyChapters}/${report.scannedChapters} 章正文已过 ${SOL_CHECK_RULES.length} 项本地确定性核验（零 AI 零费用）；排版渲染、事实数据与 AI 评分仍需人工过目。`
            : `本地确定性核验（零 AI 零费用）在 ${report.bodyChapters}/${report.scannedChapters} 章中发现 ${report.total} 处；只报不拦，不影响导出，但这些是医院翻到就能看到 ${report.truncated ? "（命中较多，明细只列前 60 条）" : ""}。`}
      </p>

      {expanded && (
        <div className="mt-3 border-t border-border pt-3">
          {clean ? (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              {SOL_CHECK_RULES.length} 项本地核验全部通过；导出前仍建议人工通读一遍排版与事实数据
            </p>
          ) : (
            <div className="flex max-h-[420px] flex-col gap-3 overflow-y-auto">
              {report.groups.map((g) => (
                <div key={g.rule}>
                  <h3 className="flex items-center gap-2 text-xs font-medium text-card-foreground">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[g.level]}`}>
                      {g.count}
                    </span>
                    {g.label}
                  </h3>
                  <ul className="mt-1.5 flex flex-col gap-1.5">
                    {report.hits
                      .filter((h) => h.rule === g.rule)
                      .map((h, hi) => (
                        <HitRow key={`${g.rule}-${hi}`} hit={h} onSelectChapter={onSelectChapter} />
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function HitRow({ hit, onSelectChapter }: { hit: SolCheckHit; onSelectChapter: (nodeId: string) => void }) {
  return (
    <li className="rounded-md border border-border/60 bg-background px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {hit.nodeId ? (
          <button
            type="button"
            onClick={() => onSelectChapter(hit.nodeId)}
            title="跳到该章整改"
            className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {hit.chapter}
          </button>
        ) : (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{hit.chapter}</span>
        )}
        <span className="min-w-0 flex-1 leading-relaxed text-card-foreground">{hit.quote}</span>
      </div>
    </li>
  )
}

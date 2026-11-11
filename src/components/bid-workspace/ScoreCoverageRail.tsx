import { useMemo } from "react"
import { Check, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ScoreCheckup } from "@/pages/BidWorkspace/scoreCoverageCheckup"

// ---------------------------------------------------------------------------
// ③ 大纲编制 · 右栏「评分点覆盖」热力表（UX-v2：prototype/bid/outline.html 右栏）
//
// 原型右栏结构（card-h 标题 + 缺 N 徽标；card-b 里 已覆盖 18/22 · 82% + 进度条 +
// 按分档分组的评分点清单，每条右侧 ✓ 或「缺」）。
//
// 数据全部来自 scoreCheckup（buildScoreCheckup 的真实现算，零 AI 零费用）：
//   rows        —— 每个评分点：名称 / 分值 / 是否已覆盖 / 被哪些章覆盖
//   techLanded  —— 已落地分值；techTotal —— 技术分总分；techMissing —— 未落地分值
// 未覆盖的点按分值降序排在最前（丢分最多的先补），与原型「缺 4」的排序意图一致。
// 无评分办法时不渲染假清单，给如实空态。
// ---------------------------------------------------------------------------

type ScoreCoverageRailProps = {
  checkup: ScoreCheckup
  /** 点某条已覆盖评分点 → 跳到覆盖它的那一章 */
  onSelectChapter?: (nodeId: string) => void
  /** 大纲树里节点的标题 → node_id 映射（用于跳章；找不到就不跳） */
  chapterIdByTitle?: Record<string, string>
  /** 看缺的评分点 → 展开明细（由父级控制） */
  onJumpToMissing?: () => void
}

export function ScoreCoverageRail({ checkup, onSelectChapter, chapterIdByTitle, onJumpToMissing }: ScoreCoverageRailProps) {
  const { rows, techLanded, techTotal, techMissing, hasScoring } = checkup
  const pct = techTotal > 0 ? Math.round((techLanded / techTotal) * 100) : 0

  // 未覆盖在前（按分值降序），已覆盖在后（保持原序）
  const sorted = useMemo(() => {
    const missing = rows.filter((r) => !r.covered).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    const covered = rows.filter((r) => r.covered)
    return [...missing, ...covered]
  }, [rows])

  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <header className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
        <Target className="h-4 w-4 shrink-0 text-primary" />
        <h3 className="text-[13.5px] font-semibold text-card-foreground">评分点覆盖</h3>
        <div className="flex-1" />
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
            techMissing > 0 ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
          }`}
        >
          {techMissing > 0 ? `缺 ${techMissing} 分` : "全覆盖"}
        </span>
      </header>

      {!hasScoring ? (
        <div className="px-3.5 py-4 text-center text-xs leading-relaxed text-muted-foreground">
          招标文件里没有解析出评分办法，无法核算评分点覆盖。
          <br />
          回「② 解析确认」补齐评分办法后，这里会逐条列出覆盖情况。
        </div>
      ) : (
        <>
          <div className="px-3.5 pt-3">
            <div className="flex items-center gap-2">
              <span className="text-[11.5px] text-muted-foreground">已覆盖</span>
              <div className="flex-1" />
              <span className="font-mono text-[13px] font-semibold tabular-nums text-card-foreground">
                {techLanded} / {techTotal}
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground">· {pct}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${techMissing > 0 ? "bg-primary/70" : "bg-primary"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <div className="mt-3 max-h-[420px] overflow-y-auto px-3.5 pb-3">
            <ul className="flex flex-col gap-0.5">
              {sorted.map((r, i) => {
                const coverTitle = r.coveredBy?.[0]
                const nodeId = coverTitle ? chapterIdByTitle?.[coverTitle] : undefined
                const clickable = r.covered && nodeId && onSelectChapter
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={() => clickable && onSelectChapter!(nodeId!)}
                      title={
                        r.covered
                          ? `已覆盖：${(r.coveredBy ?? []).join("、") || "—"}${clickable ? "（点击跳章）" : ""}`
                          : `未覆盖 · 该点 ${r.score} 分`
                      }
                      className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] transition-colors ${
                        clickable ? "hover:bg-secondary" : "cursor-default"
                      }`}
                    >
                      <span
                        className={`min-w-0 flex-1 truncate ${
                          r.covered ? "text-card-foreground" : "font-medium text-destructive"
                        }`}
                      >
                        {r.name || `评分点 ${i + 1}`}
                      </span>
                      {r.subjective && (
                        <span className="shrink-0 rounded bg-warning/10 px-1 text-[10px] text-warning" title="主观分，需评委主观打分">
                          主观
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                        {r.score} 分
                      </span>
                      {r.covered ? (
                        <Check size={12} strokeWidth={3} className="shrink-0 text-primary" aria-label="已覆盖" />
                      ) : (
                        <span className="shrink-0 rounded bg-destructive/10 px-1 text-[10px] font-medium text-destructive">
                          缺
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>

          {techMissing > 0 && onJumpToMissing && (
            <div className="border-t border-border px-3.5 py-2">
              <Button
                size="sm"
                variant="outline"
                onClick={onJumpToMissing}
                className="h-7 w-full border-destructive/40 text-xs text-destructive hover:bg-destructive/10"
              >
                看缺的评分点（丢 {techMissing} 分）
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

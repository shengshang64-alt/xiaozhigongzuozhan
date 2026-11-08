// UX-R3: S12 主观分逐条确认面板 2026-11-08
//
// 主观分（方案质量/完整性/合理性一类分档评议项）由评标专家人工打分——AI 能写，
// 但「这一分拿几分、拿什么材料支撑」必须人逐条确认。本面板给出清单与逐条确认动作。
// 只改 bid_projects.subjective_confirmations（S12 新增 json 列），不动解析/章节数据。
import { useMemo, useState } from "react"
import { CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Gauge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"
import { buildSubjectiveScoreRows, countUnconfirmedSubjective } from "@/pages/BidWorkspace/subjectiveScores"
import { formatDateTimeDisplay } from "@/lib/dateDisplay"

type SubjectiveScorePanelProps = {
  project: BidProjectRecord | null | undefined
  /** 写单条确认（useBidWorkspace.setSubjectiveConfirmation） */
  onConfirm?: (id: string, patch: { confirmed?: boolean; strategy?: string }) => void
  /** 「定位到章节」——切回编制 Tab 并滚动到章 */
  onJumpToChapter?: (title: string) => void
  archived?: boolean
}

export function SubjectiveScorePanel({ project, onConfirm, onJumpToChapter, archived }: SubjectiveScorePanelProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [draftStrategy, setDraftStrategy] = useState<Record<string, string>>({})
  const rows = useMemo(() => buildSubjectiveScoreRows(project ?? null), [project])
  const { total, unconfirmed } = countUnconfirmedSubjective(project ?? null)

  const strategyOf = (id: string, saved: string) => draftStrategy[id] ?? saved

  return (
    <section className="mt-6 rounded-lg border border-border bg-card shadow-md">
      <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Gauge className="h-4 w-4 text-primary" />
            主观分逐条确认
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            这些分由评标专家按档人工打——AI 只负责写正文，拿几分、用什么材料支撑，请你逐条确认策略。
            未确认不阻断流程，但交卷清单会一直提醒。
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            主观分 {total} 条
          </span>
          {unconfirmed > 0 ? (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
              还有 {unconfirmed} 条未确认
            </span>
          ) : total > 0 ? (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">已全部确认</span>
          ) : null}
        </div>
      </header>

      {total === 0 ? (
        <div className="px-4 py-8 text-center">
          <ClipboardCheck className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium text-foreground">本项目解析结果里没有识别出主观分项</p>
          <p className="mt-1 text-xs text-muted-foreground">
            主观分是「得 N-M 分」「优秀/良/一般/差」「方案质量/完整性/合理性」一类分档评议项；
            若招标文件确有此类评分而这里为空，请回第 2 步核对「技术评分办法」解析项是否勾选并解析成功。
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2 px-4 py-3">
          {rows.map((r) => {
            const open = openId === r.id
            const strategy = strategyOf(r.id, r.confirmation.strategy)
            return (
              <li
                key={r.id}
                className={`rounded-md border px-3 py-2 ${
                  r.confirmation.confirmed ? "border-primary/30 bg-primary/5" : "border-warning/30 bg-warning/5"
                }`}
              >
                <div className="flex flex-wrap items-start gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : r.id)}
                    aria-expanded={open}
                    className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                    title={open ? "收起" : "展开评分标准与应对策略"}
                  >
                    {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{r.id}</span>
                      <span className="text-sm font-medium text-foreground">{r.item}</span>
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        {r.score} 分
                      </span>
                      <span className="rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
                        主观
                      </span>
                      {r.confirmation.confirmed ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary">
                          <CheckCircle2 className="h-3 w-3" /> 已确认
                        </span>
                      ) : (
                        <span className="text-[10px] text-warning">待确认</span>
                      )}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      落点：{r.landedTitles.length ? r.landedTitles.join("、") : "暂无章节承接（建议先在偏离与响应表里补落点）"}
                      {r.landedTitles.length > 0 && onJumpToChapter && (
                        <button
                          type="button"
                          onClick={() => onJumpToChapter(r.landedTitles[0])}
                          className="ml-2 text-primary underline-offset-2 hover:underline"
                        >
                          定位到章节
                        </button>
                      )}
                    </span>
                  </span>
                </div>

                {open && (
                  <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
                    <div>
                      <p className="text-xs font-semibold text-foreground">评分标准原文</p>
                      <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                        {r.criteria.trim() || "解析报告未给出该项评分细则——请对照招标文件评分表原文确认档位与要求。"}
                      </p>
                    </div>
                    <div className="rounded-md border border-border/60 bg-background px-2.5 py-2">
                      <p className="text-xs font-semibold text-foreground">这条评分专家会怎么看</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        主观分按档给分，评委横向比较各投标人的方案质量、完整性与可操作性。
                        要拿高分：{r.category === "tech" ? "技术方案" : "商务方案"}要点对点覆盖评分细则每一条，
                        给出量化指标与可核验材料；空泛承诺会被压到低档。
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">我们怎么拿这条的分</p>
                      <Textarea
                        value={strategy}
                        onChange={(e) => setDraftStrategy((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        readOnly={archived}
                        placeholder="例：写清三级等保与电子病历五级双达标方案，附已交付案例 2 个、测评报告页码索引"
                        className="mt-1 min-h-16 border-border bg-background text-xs"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={archived}
                        className="h-7 border-border text-xs"
                        onClick={() => {
                          onConfirm?.(r.id, { strategy })
                          setDraftStrategy((prev) => {
                            const next = { ...prev }
                            delete next[r.id]
                            return next
                          })
                        }}
                      >
                        保存策略
                      </Button>
                      <label className="inline-flex items-center gap-1.5 text-xs text-foreground">
                        <input
                          type="checkbox"
                          checked={r.confirmation.confirmed}
                          disabled={archived}
                          onChange={(e) => {
                            // 勾选确认时连同当前草稿策略一起落库（保证「确认了但没有策略」不出现）
                            onConfirm?.(r.id, { confirmed: e.target.checked, strategy })
                          }}
                          className="h-3.5 w-3.5 rounded border-border"
                        />
                        已确认应对策略
                      </label>
                      {r.confirmation.confirmed && r.confirmation.confirmed_at && (
                        <span className="text-[11px] text-muted-foreground">
                          确认于 {formatDateTimeDisplay(r.confirmation.confirmed_at)}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

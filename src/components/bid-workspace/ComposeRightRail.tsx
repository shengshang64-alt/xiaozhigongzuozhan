import { useMemo } from "react"
import { AlertTriangle, ListChecks, PenLine, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { lintProse, type LintKind } from "@/pages/BidWorkspace/bidProseLinter"
import { detectNumberConflicts, type NumberConflict } from "@/pages/BidWorkspace/composeGates"
import { effectiveVoidStatus, VOID_STATUS_LABEL, type VoidItem } from "@/pages/BidWorkspace/bidTypes"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

// ---------------------------------------------------------------------------
// 标书正文编写 · 右栏三卡（UX-v2：prototype/bid/draft.html 右栏 1:1 复刻）
//
// 原型右栏三块：① 废标风险（条款未应答/资质到期/金额不一致，逐条定位原文）
//              ② 一致性检查（数字不一致/厂商名混用/章节引用失效，可比对可统一）
//              ③ 写作体检（去 AI 味句式命中数 + 段落长度分布 + 术语一致）
//
// 现网数据源逐块核对（全部真算，无真数据给空态，绝不造假条目）：
//   ① void_check.items —— 废标条款逐条判定（合规/部分/不合规 + 支撑证据），
//      取「非 compliant」且 severity 高的排前面；「定位到原文」跳第 5 步废标项检查。
//   ② detectNumberConflicts(chapters) —— 同一指标在多章出现不同值（可用性/响应时间/
//      质保/保留期四类模式），真跨章比对；「比对」跳该章。
//      原型里的「厂商名混用 / 章节引用失效」现网**没有**对应检测器，
//      按铁律不渲染假条目，只在空态里说明「未接入」，不冒充已通过。
//   ③ lintProse(activeChapter.content) —— 单章文风体检（套话/长段/长句/术语），
//      计数取 stats.rawCounts（未截断真实量）；术语一致率现网无检测器，如实不显示。
// ---------------------------------------------------------------------------

const VOID_TONE: Record<string, string> = {
  non_compliant: "bg-destructive/10 text-destructive",
  partial: "bg-warning/10 text-warning",
  compliant: "bg-primary/10 text-primary",
}

/** ① 废标风险：只列「未合规」条款，按不合规优先 + 同级按严重度。真值来自 void_check */
export function VoidRiskRail({
  items,
  onGoVoidCheck,
}: {
  items: VoidItem[]
  onGoVoidCheck: () => void
}) {
  const risky = useMemo(() => {
    const order = { non_compliant: 0, partial: 1, compliant: 2 } as const
    return (items ?? [])
      .filter((it) => effectiveVoidStatus(it) !== "compliant")
      .sort((a, b) => order[effectiveVoidStatus(a)] - order[effectiveVoidStatus(b)])
  }, [items])

  return (
    <section className="rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
          <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
          废标风险
        </h3>
        <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${risky.length > 0 ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
          {risky.length > 0 ? `${risky.length} 条 · 修复后才能交卷` : "无未合规条款"}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="mt-2.5 rounded-md border border-dashed border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
          还没有废标项检查结果。到第 ⑤ 步「废标项检查」跑一遍，逐条判定会出现在这里。
        </p>
      ) : risky.length === 0 ? (
        <p className="mt-2.5 rounded-md border border-primary/25 bg-primary/5 px-3 py-3 text-xs leading-relaxed text-primary">
          {items.length} 条废标条款全部判为合规。
        </p>
      ) : (
        <ul className="mt-2.5 flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-0.5">
          {risky.map((it) => {
            const st = effectiveVoidStatus(it)
            return (
              <li key={it.id} className="rounded-md border border-border/60 bg-background px-2.5 py-2 text-xs">
                <div className="flex items-start gap-1.5">
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${VOID_TONE[st] ?? "bg-muted text-muted-foreground"}`}>
                    {VOID_STATUS_LABEL[st] ?? st}
                  </span>
                  <span className="min-w-0 flex-1 leading-relaxed text-card-foreground" title={it.clause}>
                    {it.clause}
                  </span>
                </div>
                {it.suggestion && (
                  <p className="mt-1 leading-relaxed text-muted-foreground">{it.suggestion}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={onGoVoidCheck}
        className="mt-2.5 w-full border-primary/40 text-xs text-primary hover:bg-primary/10"
      >
        去废标项检查
      </Button>
    </section>
  )
}

/** ② 一致性检查：真做跨章数字比对；厂商名/章节引用无检测器 → 空态说明不冒充通过 */
export function ConsistencyRail({
  chapters,
  onSelectChapter,
}: {
  chapters: Chapter[]
  onSelectChapter: (nodeId: string) => void
}) {
  const conflicts: NumberConflict[] = useMemo(() => detectNumberConflicts(chapters), [chapters])
  return (
    <section className="rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
          <ListChecks className="h-4 w-4 shrink-0 text-primary" />
          一致性检查
        </h3>
        <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${conflicts.length > 0 ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}`}>
          {conflicts.length > 0 ? `${conflicts.length} 类` : "—"}
        </span>
      </div>

      {conflicts.length === 0 ? (
        <p className="mt-2.5 rounded-md border border-dashed border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
          未检出跨章指标冲突（比对范围：可用性 / 响应时间 / 质保期 / 保留期）。
          厂商名混用与章节引用失效现网未接入检测器，仍需人工过目。
        </p>
      ) : (
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {conflicts.map((c) => (
            <li key={c.topic} className="rounded-md border border-warning/30 bg-warning/5 px-2.5 py-2 text-xs">
              <div className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-card-foreground">{c.topic}数值不一致</p>
                  <p className="mt-0.5 leading-relaxed text-muted-foreground">
                    {c.values.join(" / ")}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {c.chapters.slice(0, 3).map((title) => {
                      const ch = chapters.find((x) => x.title === title)
                      return ch ? (
                        <button
                          key={title}
                          type="button"
                          onClick={() => onSelectChapter(ch.node_id)}
                          title="跳到该章核对"
                          className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          {title}
                        </button>
                      ) : (
                        <span key={title} className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {title}
                        </span>
                      )
                    })}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** 文风体检按原型展示的几类（LintKind 真实枚举）；其余类归「其他」，总计仍为未截断真值 */
const PROSE_KEYS: { kind: LintKind; label: string }[] = [
  { kind: "ai_cliche", label: "AI 套话" },
  { kind: "sentence_shape", label: "句式模板腔" },
  { kind: "inline_link", label: "内联指引/链接" },
  { kind: "task_dispatch", label: "任务式派活语气" },
  { kind: "long_paragraph", label: "长段落" },
  { kind: "long_sentence", label: "长句" },
  { kind: "missing_table", label: "关键章缺表" },
]

/** ③ 写作体检：只对当前章做真文风扫描（lintProse），计数取未截断 rawCounts */
export function ProseCheckRail({
  chapter,
  onGoChapter,
}: {
  chapter: Chapter | null
  onGoChapter: () => void
}) {
  const report = useMemo(() => {
    const content = chapter?.content ?? ""
    if (!content.trim()) return null
    return lintProse(content, chapter?.title ?? "")
  }, [chapter])

  const rows = useMemo(() => {
    if (!report) return []
    const raw = report.stats.rawCounts
    const listed = PROSE_KEYS.map(({ kind, label }) => ({ label, count: raw[kind] ?? 0 })).filter((r) => r.count > 0)
    const covered = PROSE_KEYS.reduce((s, k) => s + (raw[k.kind] ?? 0), 0)
    const total = Object.values(raw).reduce((s, n) => s + n, 0)
    const other = total - covered
    if (other > 0) listed.push({ label: "其他", count: other })
    return listed
  }, [report])

  const total = rows.reduce((s, r) => s + r.count, 0)

  return (
    <section className="rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
          <PenLine className="h-4 w-4 shrink-0 text-primary" />
          写作体检
        </h3>
        <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">本章</span>
      </div>

      {!report ? (
        <p className="mt-2.5 rounded-md border border-dashed border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
          {chapter ? "本章还没有正文，成稿后这里会自动体检（零 AI、零费用）。" : "先在左侧选一章，这里给该章的文风体检。"}
        </p>
      ) : (
        <>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {total > 0 ? `本章检出 ${total} 处可优化写法（${report.stats.paragraphCount} 个自然段）。` : `本章 ${report.stats.paragraphCount} 个自然段，未检出文风问题。`}
          </p>
          {rows.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {rows.map((r) => (
                <li key={r.label} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 text-muted-foreground">{r.label}</span>
                  <b className="tabular-nums text-card-foreground">{r.count}</b>
                </li>
              ))}
            </ul>
          )}
          {report.severity === "structural" && (
            <p className="mt-2 rounded-md bg-destructive/5 px-2 py-1.5 text-[11px] leading-relaxed text-destructive">
              含标题层级硬伤（同级跳号），评审会扣格式分，建议先修。
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={onGoChapter}
            className="mt-2.5 w-full border-primary/40 text-xs text-primary hover:bg-primary/10"
          >
            去编辑器处理本章
          </Button>
        </>
      )}
    </section>
  )
}

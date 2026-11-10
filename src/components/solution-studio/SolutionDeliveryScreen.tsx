import { useMemo } from "react"
import { ClipboardCheck, FileText, ListTodo, Play, ShieldQuestion, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/shell/PageHeader"
import { RequirementCoverageCard } from "@/components/solution-studio/RequirementCoverageCard"
import { SolutionDeliveryCheckCard } from "@/components/solution-studio/SolutionDeliveryCheckCard"
import { SolutionSelfCheckOverviewCard } from "@/components/solution-studio/SolutionSelfCheckOverviewCard"
import { auditRequirementCoverage, type RequirementCoverageResult } from "@/pages/SolutionStudio/requirementCoverage"
import { auditSolutionDelivery } from "@/pages/SolutionStudio/solDeliveryCheck"
import { summarizeGenFailures } from "@/pages/SolutionStudio/genFailureSummary"
import type { UseSolutionStudio } from "@/pages/SolutionStudio/useSolutionStudio"

// ---------------------------------------------------------------------------
// 交付检查 · 独立屏（UX-v2：prototype/solution/delivery.html）。
// 编辑器屏不再叠体检卡：需求覆盖 / 事实接地 / 导出门禁三块在这里一屏看全，
// 每条缺口都能点回章节。三块口径全部来自本地确定性核验（零 AI 零费用），
// 随正文自动保存实时重算——所以屏上没有「重新检查」按钮，重算是自动的。
//
// 与原型 delivery.html 的两处诚实差异（不造假）：
//   · ② 事实接地：现网还没有「正文 ↔ 知识库 / 客户档案 / 资质台账」的比对引擎，
//     按铁律不造待核条目——保留卡与三类骨架，给接入说明；
//   · 原型的「仍然导出（会记录风险）」弹窗：现网导出无风险留痕能力，弹窗承诺的
//     「写进交付日志」不存在，做了就是假功能，故不搬；导出始终在编辑器屏。
// ---------------------------------------------------------------------------

type SolutionDeliveryScreenProps = Pick<
  UseSolutionStudio,
  "activeSolution" | "selectChapter" | "selfCheckOverview" | "bulkReviewBusy" | "reviewProgress" | "startBulkReview" | "cancelBulkReview"
> & {
  onGoEditor: () => void
  onGoList: () => void
}

type GateState = "pass" | "fail" | "na"

type Gate = { label: string; sub: string; state: GateState }

/** 覆盖率 / 成稿率的放行线（与原型 delivery.html 的门禁阈值一致） */
const GATE_LINE = 90

function gateTone(state: GateState): string {
  if (state === "pass") return "bg-primary/10 text-primary"
  if (state === "fail") return "bg-destructive/10 text-destructive"
  return "bg-muted text-muted-foreground"
}

function gateText(state: GateState): string {
  if (state === "pass") return "通过"
  if (state === "fail") return "未通过"
  return "不适用"
}

/** 导出门禁清单：只放现网真算得出的闸门；原型里的「金额与大写一致」没有核验引擎，不搬 */
function buildGates(args: {
  chapterCount: number
  emptyTitleCount: number
  bodyChapters: number
  coverage: RequirementCoverageResult | null
  hardFlawCount: number
  failedChapterCount: number
}): Gate[] {
  const { chapterCount, emptyTitleCount, bodyChapters, coverage, hardFlawCount, failedChapterCount } = args
  const gates: Gate[] = []
  if (chapterCount === 0) {
    gates.push({ label: "大纲完整、层级合规", sub: "还没有大纲章节", state: "na" })
  } else if (emptyTitleCount === 0) {
    gates.push({ label: "大纲完整、层级合规", sub: `${chapterCount} 章，无空章标题`, state: "pass" })
  } else {
    gates.push({ label: "大纲完整、层级合规", sub: `${emptyTitleCount} 章缺章标题`, state: "fail" })
  }

  if (chapterCount === 0) {
    gates.push({ label: `正文成稿 ≥ ${GATE_LINE}%`, sub: "正文尚未生成", state: "na" })
  } else {
    const pct = Math.round((bodyChapters / chapterCount) * 100)
    gates.push({
      label: `正文成稿 ≥ ${GATE_LINE}%`,
      sub: `当前 ${pct}%（${bodyChapters}/${chapterCount} 章有正文）`,
      state: pct >= GATE_LINE ? "pass" : "fail",
    })
  }

  if (!coverage) {
    gates.push({ label: `需求覆盖率 ≥ ${GATE_LINE}%`, sub: "未关联建设清单，没有需求条目可核对", state: "na" })
  } else {
    const pct = Math.round((coverage.counts.full / coverage.total) * 100)
    gates.push({
      label: `需求覆盖率 ≥ ${GATE_LINE}%`,
      sub: `当前 ${pct}%（${coverage.counts.full}/${coverage.total} 条已落实），差 ${coverage.pending} 条`,
      state: pct >= GATE_LINE ? "pass" : "fail",
    })
  }

  gates.push({
    label: "交付体检 0 处硬伤",
    sub: hardFlawCount === 0 ? "占位 / 绝对化承诺 / 指标打架等均未命中" : `当前 ${hardFlawCount} 处待复核（见下方明细）`,
    state: hardFlawCount === 0 ? "pass" : "fail",
  })

  gates.push({
    label: "生成失败章清零",
    sub: failedChapterCount === 0 ? "没有因生成失败留下的空章" : `${failedChapterCount} 章生成失败，需重试或手写`,
    state: failedChapterCount === 0 ? "pass" : "fail",
  })
  return gates
}

/** ② 事实接地 · 诚实骨架：引擎未接入（见文件头注释），卡与三类骨架保留 */
function FactGroundingColumn() {
  const planned = [
    { label: "数值", desc: "峰值 / 人数 / 时长等数字在知识库或客户附件是否有出处" },
    { label: "厂商名", desc: "现网系统与承建厂商说法是否与客户档案一致" },
    { label: "资质", desc: "引用的资质证书是否有效、是否临近有效期" },
  ]
  return (
    <section className="rounded-lg border border-border bg-card px-4 py-3 shadow-md">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
          <ShieldQuestion className="h-4 w-4 shrink-0 text-muted-foreground" />
          ② 事实接地
        </h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">未接入</span>
      </div>
      <p className="mt-2 rounded-md border border-dashed border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
        与知识库 / 客户档案 / 资质台账的自动比对暂未接入（独立后端包）。接入后这里逐条列出待核事实，并参与下方导出门禁。
      </p>
      <ul className="mt-2.5 flex flex-col gap-1.5">
        {planned.map((c) => (
          <li key={c.label} className="flex items-start gap-2 text-xs">
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{c.label}</span>
            <span className="min-w-0 flex-1 leading-relaxed text-muted-foreground">{c.desc}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground/70">—</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function SolutionDeliveryScreen(p: SolutionDeliveryScreenProps) {
  const sol = p.activeSolution
  const snapshot = sol?.hospital_info?.ref_checklist_snapshot
  const chapters = useMemo(() => sol?.chapters ?? [], [sol])
  const requirementLines = snapshot?.customer_requirements
  const coverage = useMemo(
    () => (requirementLines?.length ? auditRequirementCoverage(requirementLines, chapters) : null),
    [requirementLines, chapters],
  )
  const report = useMemo(() => auditSolutionDelivery(chapters), [chapters])
  const failures = useMemo(() => summarizeGenFailures(chapters), [chapters])
  const emptyTitleCount = useMemo(() => chapters.filter((c) => !(c.title ?? "").trim()).length, [chapters])

  const gates = useMemo(
    () =>
      buildGates({
        chapterCount: chapters.length,
        emptyTitleCount,
        bodyChapters: report.bodyChapters,
        coverage,
        hardFlawCount: report.total,
        failedChapterCount: failures.failedCount,
      }),
    [chapters.length, emptyTitleCount, report.bodyChapters, report.total, coverage, failures.failedCount],
  )
  const failCount = gates.filter((g) => g.state === "fail").length
  const passCount = gates.filter((g) => g.state === "pass").length
  const clean = failCount === 0 && chapters.length > 0

  if (!sol) {
    return (
      <main>
        <section className="mx-auto mt-10 max-w-md rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center shadow-md">
          <ClipboardCheck className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <h2 className="mt-3 text-sm font-semibold text-card-foreground">还没有可检查的方案</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            交付检查跟着当前打开的方案走。先在「方案列表」打开一个方案，再回到这一屏看需求覆盖与导出门禁。
          </p>
          <Button size="sm" className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90" onClick={p.onGoList}>
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            去方案列表
          </Button>
        </section>
      </main>
    )
  }

  const gaps: string[] = []
  if (coverage && coverage.pending > 0) gaps.push(`${coverage.pending} 条需求补写`)
  if (report.total > 0) gaps.push(`${report.total} 处硬伤复核`)
  if (failures.failedCount > 0) gaps.push(`${failures.failedCount} 章生成失败重试`)

  return (
    <main>
      <PageHeader
        title="交付检查"
        titleExtra={
          clean ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">门禁全部通过</span>
          ) : (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
              {failCount} 项门禁未通过
            </span>
          )
        }
        desc={
          <>
            交付前的最后一道闸门：<b>需求覆盖、事实接地、导出门禁</b>三块一屏看全，每条缺口都能点回章节。
            核验随正文保存实时重算，不需要手动「重新检查」。
          </>
        }
        meta={
          <>
            <span>方案 <b className="text-card-foreground">{sol.solution_name}</b></span>
            <span>正文成稿 <b className="tabular-nums text-card-foreground">{report.bodyChapters}/{report.scannedChapters}</b> 章</span>
            <span>核验口径 <b className="text-card-foreground">本地确定性 · 零 AI 零费用</b></span>
          </>
        }
        actions={
          <Button variant="outline" onClick={p.onGoEditor} className="border-border text-card-foreground shadow-sm hover:bg-secondary">
            <Play className="mr-1.5 h-4 w-4" />
            去编辑器补写
          </Button>
        }
      />

      {/* 数据条（真值）：与原型 delivery.html 同位的五格口径 */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-lg border border-border bg-card px-4 py-2.5 text-xs shadow-md">
        <span className="text-muted-foreground">
          需求覆盖{" "}
          <b className="tabular-nums text-card-foreground">
            {coverage ? `${coverage.counts.full}/${coverage.total}` : "未关联"}
          </b>
        </span>
        <span className="text-muted-foreground">
          交付体检待复核 <b className="tabular-nums text-warning">{report.total}</b>
        </span>
        <span className="text-muted-foreground">
          生成失败 <b className={`tabular-nums ${failures.failedCount ? "text-destructive" : "text-card-foreground"}`}>{failures.failedCount}</b> 章
        </span>
        <span className="text-muted-foreground">
          正文成稿 <b className="tabular-nums text-card-foreground">{report.bodyChapters}/{report.scannedChapters}</b> 章
        </span>
        <span className="ml-auto text-muted-foreground">
          通过 {passCount} 项 · 未通过 {failCount} 项 · 结论：
          <b className={clean ? "text-primary" : "text-warning"}>{chapters.length === 0 ? "先补大纲" : clean ? "建议交付" : "不建议现在交付"}</b>
        </span>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        {/* ① 需求覆盖率：与编辑器右栏同一套本地审计，这里给全明细（筛选 / 缺失要点 / 复制待补清单） */}
        {coverage ? (
          <RequirementCoverageCard
            snapshot={snapshot}
            chapters={chapters}
            onSelectChapter={p.selectChapter}
            className="rounded-lg border border-border bg-card px-4 py-3 shadow-md"
          />
        ) : (
          <section className="rounded-lg border border-border bg-card px-4 py-3 shadow-md">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
                <Target className="h-4 w-4 shrink-0 text-primary" />
                ① 需求覆盖率
              </h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">未关联</span>
            </div>
            <p className="mt-3 rounded-md border border-dashed border-border px-3 py-4 text-xs leading-relaxed text-muted-foreground">
              本方案未关联建设清单，没有客户需求条目可核对。下一步新建方案时选清单，或在建没清单屏把本方案与清单建立关联后，这里会逐条给出覆盖率与待补清单。
            </p>
          </section>
        )}

        {/* ② 事实接地：引擎未接入，诚实骨架（见文件头注释） */}
        <FactGroundingColumn />

        {/* ③ 导出门禁：只放现网真算得出的闸门；原型「金额与大写一致」无核验引擎，不搬 */}
        <section className="rounded-lg border border-border bg-card px-4 py-3 shadow-md">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
              <ListTodo className="h-4 w-4 shrink-0 text-primary" />
              ③ 导出门禁
            </h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {gates.length} 条 · 通过 {passCount}
            </span>
          </div>
          <ul className="mt-3 flex flex-col gap-1.5">
            {gates.map((g) => (
              <li key={g.label} className="rounded-md border border-border/60 bg-background px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${gateTone(g.state)}`}>{gateText(g.state)}</span>
                  <span className="min-w-0 flex-1 font-medium text-card-foreground">{g.label}</span>
                </div>
                <p className="mt-1 pl-0.5 leading-relaxed text-muted-foreground">{g.sub}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 border-t border-border pt-2.5 text-[11px] leading-relaxed text-muted-foreground">
            体检为「只报不拦」：门禁未通过仍可导出，导出按钮在编辑器屏顶栏；先把标红的缺口清掉再交付。
          </p>
        </section>
      </div>

      {/* 交付体检明细（本地硬伤，点击跳章）+ 整本 AI 自检总览（内容质量强弱项）——都从编辑器屏迁到这里 */}
      <SolutionDeliveryCheckCard chapters={chapters} onSelectChapter={p.selectChapter} />
      <SolutionSelfCheckOverviewCard
        overview={p.selfCheckOverview}
        busy={p.bulkReviewBusy}
        progress={p.reviewProgress}
        onStart={p.startBulkReview}
        onCancel={p.cancelBulkReview}
        onSelectChapter={(nodeId) => {
          p.selectChapter(nodeId)
          p.onGoEditor()
        }}
      />

      {/* 一句话结论（真值拼装，无演示数） */}
      {chapters.length > 0 && !clean && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-card-foreground animate-in fade-in duration-300">
          <span className="min-w-0 flex-1 text-xs leading-relaxed">
            <b>一句话结论</b>：还差 {gaps.length ? gaps.join(" + ") : "少量缺口复核"}才建议交付。
            {coverage && coverage.pending > 0 && coverage.generatedChapters === 0
              ? "正文尚未生成，覆盖率当前为大纲级预判。"
              : "按当前缺口从编辑器逐章补写，本屏会实时刷新。"}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-warning/50 text-foreground hover:bg-warning/20"
            onClick={p.onGoEditor}
          >
            去编辑器补写
          </Button>
        </div>
      )}
    </main>
  )
}

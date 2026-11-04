import { useMemo, useState, type ReactNode } from "react"
import { ClipboardList } from "lucide-react"
import { formatCount } from "@/lib/money"
import {
  extractImplicitConstraints,
  groupImplicitConstraints,
  parseLotsLineInfo,
  requiredParseFailures,
  summarizeParseWarnings,
  type LotsScope,
  type ParseReport,
  type StandardItem,
} from "@/pages/BidWorkspace/bidTypes"
import { COVERAGE_WARN, coveragePercent, parseCoverageRatio } from "@/pages/BidWorkspace/parseCoverage"
import { buildParseSummary, summarizeParseHealth } from "@/pages/BidWorkspace/parseSummary"
import type { ModelRef } from "@/lib/modelGateway"
import type { ModelRole } from "@/lib/modelRouting"
import {
  mergeRiskFindings,
  scanTenderComplianceRisk,
  sortRiskFindings,
  summarizeComplianceRisk,
} from "@/pages/BidWorkspace/tenderComplianceRisk"
import { applyChoices, extractParamCandidates, summarizeParams } from "@/pages/BidWorkspace/paramMatchTypes"
import type { TenderTableRecord } from "@/pages/BidWorkspace/tenderTables"
import { ParseHealthBar, type LotsChipModel } from "./parse-report/ParseHealthBar"
import { ParseGroupNav } from "./parse-report/ParseGroupNav"
import { ParseItemsPane } from "./parse-report/ParseItemsPane"
import { ParseClausesPane } from "./parse-report/ParseClausesPane"
import { ParseRiskPane } from "./parse-report/ParseRiskPane"
import { ParseListsPane } from "./parse-report/ParseListsPane"
import type { SectionReaderActions } from "./parse-report/ParseSectionReader"
import {
  buildParseNotices,
  countStarClauseLines,
  defaultParsePanelUi,
  parseHealthVerdict,
  reportUiStamp,
  type ParsePanelUi,
} from "./parse-report/parseReportLayout"

type ParseReportPanelProps = {
  report: ParseReport | null
  onChange: (patch: Partial<ParseReport>) => void
  /** 单项重解析（项目流水线与快捷工具都接入）；不传则隐藏按钮 */
  onReparse?: (key: string) => void
  reparseBusyKey?: string | null
  /** 单项重解析入口旁的「带入技能」选择器（bid-parse 功能点） */
  skillPickerSlot?: ReactNode
  /** 招标文件全文（本地抽取隐式硬约束 / 风险 / 参数；不传则这些分组为空） */
  tenderText?: string
  /** 分段解析失败提示（收进「解析提示」，不单独占一条横幅） */
  warnings?: string[]
  /** ★/▲ 重点条款「重新扫描」（本地扫描，不产生模型费用） */
  onRescanStar?: () => void
  /** 编制依据合并清单（解析提取 ∪ 规范库补选，已去重） */
  basisMerged?: StandardItem[]
  /** 「规范库补选」入口；不传则隐藏按钮 */
  onOpenStandardsPicker?: () => void
  /** AI 深度体检 / 参数兜底的费用确认 */
  runWithCostConfirm?: (fn: () => void, message: string) => void
  /** 归档只读时禁用 AI 体检与参数兜底 */
  archived?: boolean
  /** 按环节取模型；不传则维持平台内置口径 */
  modelRefForRole?: (role: ModelRole) => ModelRef | null
  /** 上传 docx 时本地还原的原始表格 */
  restoredTables?: TenderTableRecord[] | null
  /** 导出采购清单 Word */
  onExportPurchaseList?: () => void
  /** 必选项已通过时的主操作：进入下一步。快捷工具没有步骤条，可不传。 */
  onContinue?: () => void
  /** 额外分组页签（外部面板，如条款覆盖矩阵 / 评分项核对）。只影响呈现，不改报告数据。 */
  extraTabs?: { id: string; label: string; node: ReactNode }[]
}

/**
 * 解析报告。首屏一条健康概览回答「解析好了没、下一步做什么」，
 * 其余能力按四组收纳，默认只展开最需要处理的一组。
 * 解析数据、提示词和落库字段都没有改，只改了呈现。
 */
export function ParseReportPanel({
  report,
  onChange,
  onReparse,
  reparseBusyKey,
  skillPickerSlot,
  tenderText,
  warnings,
  onRescanStar,
  basisMerged,
  onOpenStandardsPicker,
  runWithCostConfirm,
  archived,
  modelRefForRole,
  restoredTables,
  onExportPurchaseList,
  onContinue,
  extraTabs,
}: ParseReportPanelProps) {
  const summaryColumns = useMemo(() => buildParseSummary(report), [report])
  const parseHealth = useMemo(() => summarizeParseHealth(report), [report])
  const implicitList = useMemo(() => extractImplicitConstraints(tenderText ?? ""), [tenderText])
  const implicitGrouped = useMemo(() => groupImplicitConstraints(implicitList), [implicitList])
  const ruleRiskFindings = useMemo(() => scanTenderComplianceRisk(tenderText ?? ""), [tenderText])
  const aiRiskFindings = useMemo(() => report?.risk_ai_findings ?? [], [report])
  const mergedRiskFindings = useMemo(
    () => sortRiskFindings(mergeRiskFindings(ruleRiskFindings, aiRiskFindings)),
    [ruleRiskFindings, aiRiskFindings],
  )
  const riskSummary = useMemo(() => summarizeComplianceRisk(mergedRiskFindings), [mergedRiskFindings])
  const paramRows = useMemo(
    () => applyChoices(extractParamCandidates(tenderText ?? ""), report?.param_match_choices),
    [tenderText, report],
  )
  const paramSummary = useMemo(() => summarizeParams(paramRows), [paramRows])
  const warningSummary = summarizeParseWarnings(warnings)
  const coverageRatio = useMemo(
    () => parseCoverageRatio(report?.sections ?? [], tenderText ?? ""),
    [report, tenderText],
  )
  const coveragePct = coveragePercent(coverageRatio)
  const coverageLow = coverageRatio != null && coveragePct != null && coveragePct < COVERAGE_WARN * 100
  const notices = useMemo(
    () =>
      buildParseNotices({
        warningHeadline: warningSummary?.headline ?? null,
        truncation: report?.scoringTruncation ?? null,
        quality: report?.parse_quality,
        coveragePct,
        coverageLow,
      }),
    [warningSummary, report?.scoringTruncation, report?.parse_quality, coveragePct, coverageLow],
  )
  const lotsChips = useMemo(() => {
    const lotsSec = report?.sections.find((s) => s.key === "lots" && s.content.trim())
    if (!lotsSec || !tenderText?.trim()) return null
    const infos = parseLotsLineInfo(tenderText.split(/\r?\n/))
    const nos = [...new Set(infos.map((l) => l.no))].sort((a, b) => a - b)
    if (nos.length < 2) return null
    const all = nos.map((n) => {
      const info = infos.find((l) => l.no === n)
      return { no: n, title: info?.title ?? "第" + n + "包", lines: info?.lines ?? -1 }
    })
    return { nos, all }
  }, [report, tenderText])

  const sections = report?.sections ?? []
  const requiredFailures = report ? requiredParseFailures(sections) : []
  const voidCount = implicitGrouped.void.length
  const starSection = sections.find((s) => s.key === "star_clauses") ?? null
  const starCount = countStarClauseLines(starSection?.content)
  const pendingCount = parseHealth.failed + parseHealth.missing
  const stamp = reportUiStamp(
    report?.scope,
    sections.map((s) => s.key),
    tenderText,
  )
  const defaults = defaultParsePanelUi({
    stamp,
    requiredFailureKey: requiredFailures[0]?.key ?? null,
    requiredFailureCount: requiredFailures.length,
    riskRed: riskSummary.red,
    implicitVoid: voidCount,
    paramNeedsAttention: paramSummary.overall === "reject" || paramSummary.overall === "caution",
  })
  const [ui, setUi] = useState<ParsePanelUi | null>(null)
  const active = ui && ui.stamp === stamp ? ui : defaults
  const patchUi = (patch: Partial<ParsePanelUi>) => setUi({ ...active, ...patch, stamp })

  const lotsSelected = report?.lots_scope?.selected ?? []
  const lotsLimited = lotsChips != null && lotsSelected.length > 0 && lotsSelected.length < lotsChips.nos.length
  const setLotsSelection = (sel: number[]) => {
    if (!lotsChips) return
    const next: LotsScope = { selected: sel, all: lotsChips.all }
    onChange({ lots_scope: next })
  }
  const lotsModel: LotsChipModel | null = lotsChips
    ? {
        nos: lotsChips.nos,
        selected: lotsSelected,
        limited: lotsLimited,
        onSelectAll: () => setLotsSelection([]),
        onToggle: (n) =>
          setLotsSelection(
            lotsSelected.includes(n) ? lotsSelected.filter((x) => x !== n) : [...lotsSelected, n].sort((a, b) => a - b),
          ),
      }
    : null

  const verdict = parseHealthVerdict({
    requiredTitles: requiredFailures.map((f) => f.title),
    pendingCount,
  })
  const actions: SectionReaderActions = {
    onChange,
    onReparse,
    reparseBusyKey,
    skillPickerSlot,
    onRescanStar,
    basisMerged,
    onOpenStandardsPicker,
    restoredTables,
    onExportPurchaseList,
  }

  if (!report || sections.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        {notices.length > 0 && (
          <div className="mb-3">
            <ParseHealthBar
              title="还没有解析报告"
              detail={notices[0]?.title ?? ""}
              requiredOk={false}
              requiredFailureCount={0}
              pendingCount={0}
              starCount={0}
              riskTotal={0}
              riskRed={0}
              primary={null}
              notices={notices}
              lots={null}
            />
          </div>
        )}
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center shadow-md">
          <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">还没有解析报告</p>
          <p className="mt-1 text-xs text-muted-foreground">请先在「招标文件」导入内容，配置解析范围后运行解析</p>
        </div>
      </div>
    )
  }

  const primary =
    requiredFailures.length > 0
      ? {
          label: requiredFailures.length === 1 ? "去处理失败项" : `去处理 ${formatCount(requiredFailures.length)} 项失败`,
          onClick: () =>
            patchUi({
              group: "items",
              view: "detail",
              selectedKey: requiredFailures[0]?.key ?? active.selectedKey,
            }),
        }
      : onContinue
        ? { label: "进入投标文件编制", onClick: onContinue }
        : null

  const purchase = sections.find((s) => s.key === "purchase_list") ?? null
  const basis = sections.find((s) => s.key === "compilation_basis") ?? null

  return (
    <div className="flex flex-col gap-4">
      <ParseHealthBar
        title={verdict.title}
        detail={verdict.detail}
        requiredOk={requiredFailures.length === 0}
        requiredFailureCount={requiredFailures.length}
        pendingCount={pendingCount}
        starCount={starCount}
        riskTotal={riskSummary.total}
        riskRed={riskSummary.red}
        primary={primary}
        notices={notices}
        lots={lotsModel}
      />
      <ParseGroupNav
        value={active.group}
        onChange={(group) => patchUi({ group })}
        tabs={[
          { id: "items", label: "解析项明细", badge: `${parseHealth.ok}/${parseHealth.total}`, alert: requiredFailures.length > 0 },
          {
            id: "clauses",
            label: "重点条款与硬约束",
            badge: voidCount > 0 ? `废标 ${voidCount}` : starCount > 0 ? `${starCount}` : undefined,
            alert: voidCount > 0,
          },
          {
            id: "risk",
            label: "风险与合规",
            badge: riskSummary.total > 0 ? `${riskSummary.total}` : undefined,
            alert: riskSummary.red > 0,
          },
          {
            id: "lists",
            label: "清单与参数",
            badge:
              paramSummary.overall === "reject" || paramSummary.overall === "caution"
                ? paramSummary.overall === "reject"
                  ? "建议放弃"
                  : "需谨慎"
                : undefined,
            alert: paramSummary.overall === "reject",
          },
          ...(extraTabs ?? []).map((t) => ({ id: t.id, label: t.label })),
        ]}
      />
      <div
        role="tabpanel"
        id="parse-panel-items"
        aria-labelledby="parse-tab-items"
        hidden={active.group !== "items"}
      >
        <ParseItemsPane
          report={report}
          columns={summaryColumns}
          requiredFailureKeys={new Set(requiredFailures.map((f) => f.key))}
          view={active.view}
          onView={(view) => patchUi({ view })}
          selectedKey={active.selectedKey}
          onSelect={(selectedKey) => patchUi({ selectedKey })}
          actions={actions}
        />
      </div>
      <div
        role="tabpanel"
        id="parse-panel-clauses"
        aria-labelledby="parse-tab-clauses"
        hidden={active.group !== "clauses"}
      >
        <ParseClausesPane starSection={starSection} sections={sections} implicitList={implicitList} actions={actions} />
      </div>
      <div role="tabpanel" id="parse-panel-risk" aria-labelledby="parse-tab-risk" hidden={active.group !== "risk"}>
        <ParseRiskPane
          tenderText={tenderText ?? ""}
          findings={mergedRiskFindings}
          summary={riskSummary}
          reportFindings={aiRiskFindings}
          onChange={onChange}
          runWithCostConfirm={runWithCostConfirm}
          archived={archived}
          modelRefForRole={modelRefForRole}
        />
      </div>
      <div role="tabpanel" id="parse-panel-lists" aria-labelledby="parse-tab-lists" hidden={active.group !== "lists"}>
        <ParseListsPane
          sections={sections}
          purchase={purchase}
          basis={basis}
          actions={actions}
          tenderText={tenderText ?? ""}
          paramRows={paramRows}
          paramSummary={paramSummary}
          choices={report.param_match_choices ?? {}}
          onChange={onChange}
          runWithCostConfirm={runWithCostConfirm}
          archived={archived}
          modelRefForRole={modelRefForRole}
        />
      </div>
      {(extraTabs ?? []).map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`parse-panel-${t.id}`}
          aria-labelledby={`parse-tab-${t.id}`}
          hidden={active.group !== t.id}
        >
          {t.node}
        </div>
      ))}
    </div>
  )
}

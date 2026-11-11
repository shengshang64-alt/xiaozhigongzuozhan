import { useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Download,
  FileText,
  FolderTree,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { buildCatalogIndex } from "@/pages/BidWorkspace/composeGates"
import {
  DEFAULT_FORMAT_SETTINGS,
  FORMAT_FONT_OPTIONS,
  LINE_SPACING_OPTIONS,
  PAPER_OPTIONS,
  type BidProjectRecord,
  type FormatSettings,
} from "@/pages/BidWorkspace/bidTypes"
import {
  buildExportComposeModel,
  buildExportFiles,
  formatSummary,
  PAGE_ESTIMATE_HINT,
  type ExportFileKey,
} from "@/pages/BidWorkspace/exportComposeModel"
import { pickExportChapters } from "@/pages/BidWorkspace/bidFiles"
import { normalizeBidScope } from "@/pages/BidWorkspace/bidTypes"
import type { TechParamCoverage } from "@/pages/BidWorkspace/techParamCoverage"

// ---------------------------------------------------------------------------
// ⑦ 组卷导出（UX-v2：prototype/bid/export.html 三栏 1:1）
//
// 原型三块：
//   左   组卷顺序（封面/目录/… + 每卷页数 + 必选标记 + 拖动手柄 + 底部「N 卷 · M 页」+ 合规徽标）
//   中   版式设置（页眉/页脚/页码位置/纸张/字体/行距/盖章位/目录自动更新 + 底部「改动后需重新导出」）
//   右   导出清单（逐文件 + 体量 + 合计 + 「仍需人工盖章签字」警示）
//
// 现网口径逐块对齐（不造假）：
//   · 组卷顺序 = 导出真正写入 docx 的章顺序（bidFiles.pickExportChapters），页数用
//     estimatePagesFromChars 折算——与编制页「正文实际 ≈N 页」同一口径，页头明写这是估算。
//     原型可拖动改序；现网改章序在大纲里（③）——这里不做「看起来能拖其实不改文档」的假交互，
//     改为给「去大纲调整顺序」的出口。
//   · 前置件（封面/目录/目录对照表）按 format_settings.toc 与大纲真实有无判定，
//     不会在没目录要求时假装有一张对照表。
//   · 版式设置直接读写 format_settings（导出真生效的字段）：纸张 / 正文字体 / 字号 / 行距 /
//     目录 / 页码 / 页眉页脚。原型的「页眉内容 / 页脚内容」现网不可配置（导出固定
//     `项目名 投标文件` 与「第 X 页」），因此**不渲染这两个输入框**，改注明固定文案。
//   · 导出清单七项全部有就绪判定与真实规模；**不显示文件体积**（未生成前无真值）。
// ---------------------------------------------------------------------------

type ExportComposeProps = Pick<
  {
    activeProject: BidProjectRecord
    coverage: TechParamCoverage
    deviationRows: number
    formatSettings: FormatSettings
    isArchivedLocked: boolean
    exportBusy: string
    allGatesConfirmed: boolean
    gatesUnconfirmed: number
    onSetFormatSettings: (patch: Partial<FormatSettings>) => void
    onExport: (key: ExportFileKey) => void
    onExportAll: () => void
    onRequestStep: (step: number) => void
  },
  | "activeProject"
  | "coverage"
  | "deviationRows"
  | "formatSettings"
  | "isArchivedLocked"
  | "exportBusy"
  | "allGatesConfirmed"
  | "gatesUnconfirmed"
  | "onSetFormatSettings"
  | "onExport"
  | "onExportAll"
  | "onRequestStep"
>

const SELECT_CLASS =
  "h-7 w-full rounded border border-border bg-background px-1.5 text-[11.5px] text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"

const FRONT_ICON = { front: FileText, tech: FolderTree, biz: FolderTree } as const

export function ExportComposeScreen({
  activeProject,
  coverage,
  deviationRows,
  formatSettings,
  isArchivedLocked,
  exportBusy,
  allGatesConfirmed,
  gatesUnconfirmed,
  onSetFormatSettings,
  onExport,
  onExportAll,
  onRequestStep,
}: ExportComposeProps) {
  const [expandOrder, setExpandOrder] = useState(false)
  const fmt = formatSettings

  const chapters = useMemo(
    () => pickExportChapters(activeProject.bid_chapters ?? [], normalizeBidScope(activeProject.gen_options)),
    [activeProject.bid_chapters, activeProject.gen_options],
  )
  const catalogRows = useMemo(
    () => buildCatalogIndex(activeProject.parse_report ?? null, activeProject.bid_outline ?? [], {
      scope: normalizeBidScope(activeProject.gen_options),
    }),
    [activeProject.parse_report, activeProject.bid_outline, activeProject.gen_options],
  )

  const model = useMemo(
    () =>
      buildExportComposeModel({
        project: activeProject,
        chapters,
        format: fmt,
        hasCatalogIndex: catalogRows.length > 0,
        techParamTotal: coverage.total,
        techParamCovered: coverage.covered,
        deviationRows,
      }),
    [activeProject, chapters, fmt, catalogRows.length, coverage.total, coverage.covered, deviationRows],
  )

  const files = useMemo(
    () =>
      buildExportFiles({
        project: activeProject,
        chapters,
        bodyPages: model.bodyPages,
        techParamTotal: coverage.total,
        techParamCovered: coverage.covered,
        deviationRows,
      }),
    [activeProject, chapters, model.bodyPages, coverage.total, coverage.covered, deviationRows],
  )

  // 章序多时折叠（原型 8 卷正好一屏；真实项目常 19 章，全铺会把版式设置挤到屏外）
  const ORDER_COLLAPSED = 10
  const shownVolumes = expandOrder ? model.volumes : model.volumes.slice(0, ORDER_COLLAPSED)
  const hiddenVolumes = model.volumes.length - shownVolumes.length

  const busy = exportBusy !== ""
  const canExportAll = allGatesConfirmed && !busy

  return (
    <section className="mx-auto mt-4 max-w-7xl px-4 pb-12">
      {/* 页头（原型 .ph）：描述与 meta 全为真值 */}
      <header className="flex flex-wrap items-start gap-4 border-b border-border pb-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
            ⑦ 组卷导出
            <span
              className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${
                allGatesConfirmed ? "bg-primary/10 text-primary" : "bg-warning/10 text-warning"
              }`}
            >
              {allGatesConfirmed ? "已过交卷闸门" : `闸门待确认 ${gatesUnconfirmed}`}
            </span>
          </h1>
          <p className="mt-1 max-w-[960px] text-[12.5px] leading-relaxed text-muted-foreground">
            {[activeProject.hospital, activeProject.tender_no ? `编号 ${activeProject.tender_no}` : ""]
              .filter(Boolean)
              .join(" · ") || "项目基本信息未填写"}
            {` · 交付物 ${model.readyFiles}/${model.totalFiles} 个已就绪`}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
            <span>
              章数 <b className="font-mono text-[12px] font-semibold text-card-foreground">{model.chapterCount}</b> 章
            </span>
            <span title={PAGE_ESTIMATE_HINT}>
              预计正文 <b className="font-mono text-[12px] font-semibold text-card-foreground">{model.bodyPages}</b> 页
            </span>
            <span>版式 {formatSummary(fmt)}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 pt-1">
          <Button
            variant="outline"
            onClick={() => onExport("bid")}
            disabled={!chapters.some((c) => (c.content ?? "").trim()) || busy || isArchivedLocked}
            title="只导出投标文件 Word（不含偏离表与各类报告）"
            className="border-border text-card-foreground hover:bg-secondary"
          >
            <Download className="mr-1.5 h-4 w-4" />
            仅导出标书
          </Button>
          <Button
            onClick={onExportAll}
            disabled={!canExportAll}
            title={
              allGatesConfirmed
                ? "按「投标文件 → 偏离表 → 解析 → 检查 → 评标」顺序导出全部已就绪文档"
                : `还有 ${gatesUnconfirmed} 个交卷闸门未确认——到 ⑥ 交卷自查逐项确认后才能导出全套`
            }
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {exportBusy === "all" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
            {exportBusy === "all" ? "导出中…" : "导出全套文档"}
          </Button>
        </div>
      </header>

      {/* 三栏（原型 .split--3） */}
      <div className="mt-3 grid grid-cols-1 items-start gap-3.5 lg:grid-cols-2 xl:grid-cols-3">
        {/* 左：组卷顺序 */}
        <section className="rounded-lg border border-border bg-card shadow-sm">
          <header className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
            <FolderTree className="h-4 w-4 shrink-0 text-primary" />
            <h3 className="text-[13.5px] font-semibold text-card-foreground">组卷顺序</h3>
            <div className="flex-1" />
            <span className="text-[11.5px] text-muted-foreground">导出实际写入顺序</span>
          </header>
          <div className="py-1.5">
            {model.volumes.length === 0 ? (
              <p className="px-3.5 py-10 text-center text-xs text-muted-foreground">
                还没有可组卷的章节——先在 ③ 大纲编制生成大纲并确认，再回来导出
              </p>
            ) : (
              shownVolumes.map((v, i) => {
                const Icon = FRONT_ICON[v.kind]
                return (
                  <div
                    key={v.id}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 text-[12.5px] transition-colors hover:bg-secondary/60"
                  >
                    <span className="w-4 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-muted-foreground/60">
                      {i + 1}
                    </span>
                    <Icon className={`h-3 w-3 shrink-0 ${v.kind === "front" ? "text-muted-foreground" : "text-primary"}`} />
                    <span className="min-w-0 truncate text-card-foreground" title={`${v.title} · ${v.note}`}>
                      {v.title}
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                      {v.pages != null ? `${v.pages} 页` : "—"}
                    </span>
                    <span
                      className={`w-9 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-medium ${
                        v.required ? "bg-muted text-muted-foreground" : "bg-warning/10 text-warning"
                      }`}
                    >
                      {v.required ? "必选" : "可选"}
                    </span>
                  </div>
                )
              })
            )}
            {hiddenVolumes > 0 && (
              <button
                type="button"
                onClick={() => setExpandOrder(true)}
                className="mx-3.5 my-1 rounded px-1.5 py-1 text-[11.5px] text-primary hover:bg-primary/10"
              >
                展开其余 {hiddenVolumes} 章
              </button>
            )}
          </div>
          <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-secondary/30 px-3.5 py-2 text-[11.5px] text-muted-foreground">
            <span>
              {model.volumes.length} 卷 · {model.bodyPages} 页（正文估算）
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => onRequestStep(3)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-primary hover:bg-primary/10"
            >
              去大纲调整顺序
              <ArrowRight className="h-3 w-3" />
            </button>
          </footer>
        </section>

        {/* 中：版式设置（直接写 format_settings，导出真生效） */}
        <section className="rounded-lg border border-border bg-card shadow-sm">
          <header className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
            <SlidersHorizontal className="h-4 w-4 shrink-0 text-primary" />
            <h3 className="text-[13.5px] font-semibold text-card-foreground">版式设置</h3>
            <div className="flex-1" />
            <span className="text-[11.5px] text-muted-foreground">导出即按此出件</span>
          </header>
          <div className="flex flex-col gap-3 px-3.5 py-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] font-medium text-muted-foreground">纸张</span>
                <select
                  value={fmt.paper}
                  disabled={isArchivedLocked}
                  onChange={(e) => onSetFormatSettings({ paper: e.target.value as FormatSettings["paper"] })}
                  className={SELECT_CLASS}
                >
                  {PAPER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] font-medium text-muted-foreground">正文字体</span>
                <select
                  value={fmt.body.font}
                  disabled={isArchivedLocked}
                  onChange={(e) =>
                    onSetFormatSettings({ body: { ...fmt.body, font: e.target.value as typeof fmt.body.font } })
                  }
                  className={SELECT_CLASS}
                >
                  {FORMAT_FONT_OPTIONS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] font-medium text-muted-foreground">正文字号</span>
                <select
                  value={fmt.body.size}
                  disabled={isArchivedLocked}
                  onChange={(e) =>
                    onSetFormatSettings({ body: { ...fmt.body, size: e.target.value as typeof fmt.body.size } })
                  }
                  className={SELECT_CLASS}
                >
                  {["初号", "小初", "一号", "小一", "二号", "小二", "三号", "小三", "四号", "小四", "五号", "小五"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] font-medium text-muted-foreground">行距</span>
                <select
                  value={fmt.body.lineSpacing}
                  disabled={isArchivedLocked}
                  onChange={(e) =>
                    onSetFormatSettings({
                      body: { ...fmt.body, lineSpacing: e.target.value as typeof fmt.body.lineSpacing },
                    })
                  }
                  className={SELECT_CLASS}
                >
                  {LINE_SPACING_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-col gap-2 border-t border-border pt-2.5">
              {(
                [
                  { key: "toc" as const, label: "生成目录", hint: "导出时写入目录域，Word 打开后更新" },
                  { key: "pageNumber" as const, label: "输出页码", hint: "页脚居中「第 X 页」；暗标为裸数字" },
                  { key: "headerFooter" as const, label: "输出页眉", hint: "页眉固定「项目名 投标文件」；暗标强制不输出" },
                ]
              ).map((row) => (
                <label key={row.key} className="flex cursor-pointer items-start gap-2 text-[12px]">
                  <input
                    type="checkbox"
                    checked={Boolean(fmt[row.key])}
                    disabled={isArchivedLocked}
                    onChange={(e) => onSetFormatSettings({ [row.key]: e.target.checked } as Partial<FormatSettings>)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[hsl(var(--primary))]"
                  />
                  <span className="min-w-0">
                    <span className="font-medium text-card-foreground">{row.label}</span>
                    <span className="ml-1.5 text-[11px] text-muted-foreground">{row.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            <p className="rounded border border-border bg-secondary/40 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
              页眉/页脚文案现网固定（页眉「{activeProject.project_name} 投标文件」、页脚「第 X 页」），暂不支持自定义；
              封面盖章位随纸质打印现场加盖。
            </p>
          </div>
          <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-secondary/30 px-3.5 py-2 text-[11.5px] text-muted-foreground">
            <span>改动即时保存，下次导出生效</span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() =>
                onSetFormatSettings({
                  paper: DEFAULT_FORMAT_SETTINGS.paper,
                  body: DEFAULT_FORMAT_SETTINGS.body,
                  toc: DEFAULT_FORMAT_SETTINGS.toc,
                  pageNumber: DEFAULT_FORMAT_SETTINGS.pageNumber,
                  headerFooter: DEFAULT_FORMAT_SETTINGS.headerFooter,
                })
              }
              disabled={isArchivedLocked}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" />
              恢复默认
            </button>
          </footer>
        </section>

        {/* 右：导出清单 */}
        <section className="rounded-lg border border-border bg-card shadow-sm">
          <header className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
            <Download className="h-4 w-4 shrink-0 text-primary" />
            <h3 className="text-[13.5px] font-semibold text-card-foreground">导出清单</h3>
            <div className="flex-1" />
            <span
              className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${
                allGatesConfirmed ? "bg-primary/10 text-primary" : "bg-warning/10 text-warning"
              }`}
            >
              {allGatesConfirmed ? "已过交卷闸门" : `闸门待确认 ${gatesUnconfirmed}`}
            </span>
          </header>
          <div className="divide-y divide-border/60">
            {files.map((f, i) => {
              const busyThis = exportBusy === f.key || (f.key === "bid" && exportBusy === "bid")
              return (
                <div key={f.key} className="flex items-start gap-2 px-3.5 py-2">
                  <span className="mt-0.5 w-5 shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground/70">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-card-foreground">
                      <span className="min-w-0 truncate">{f.name}</span>
                      {f.ready ? (
                        <Check size={11} strokeWidth={3} className="shrink-0 text-primary" />
                      ) : (
                        <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">未就绪</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{f.desc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onExport(f.key)}
                    disabled={!f.ready || busy || isArchivedLocked}
                    title={f.ready ? `导出${f.name}` : `还不能导出：${f.desc}`}
                    className="mt-0.5 inline-flex h-6 shrink-0 items-center gap-1 rounded border border-border px-1.5 text-[11px] text-card-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyThis ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                    导出
                  </button>
                </div>
              )
            })}
          </div>
          <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-secondary/30 px-3.5 py-2 text-[11.5px] text-muted-foreground">
            <span>
              共 {model.totalFiles} 个文件 · 已就绪 {model.readyFiles} 个
            </span>
            <div className="flex-1" />
            <span className="text-muted-foreground/70">体积在生成时才产生，此处不预填</span>
          </footer>
        </section>
      </div>

      {/* 原型 .alert--amber：导出后仍需人工 */}
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/[0.06] px-3.5 py-2.5 text-[12px] leading-relaxed text-card-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        <span>
          导出后<b>仍需人工</b>：逐页盖章、法人签字、U 盘刻录与密封。系统只能保证电子稿内容与格式合规，签章与递交环节无法代劳。
        </span>
      </div>
    </section>
  )
}

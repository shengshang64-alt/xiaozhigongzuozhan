// UX-R2: 格式刷新 已按 docs/ux-review-2026-11 修复 2026-11-07（长说明折叠/③④序号引导）
import { useMemo, useRef, useState } from "react"
// R118 口径：数字展示统一走 formatCount（锁定 zh-CN 分组），不用裸 toLocaleString()
import { formatCount } from "@/lib/money"
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  FileDown,
  FileSearch,
  FileText,
  MinusCircle,
  Plus,
  Save,
  ShieldCheck,
  Star,
  Trash2,
  Wand2,
  XCircle,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { PageHeader } from "@/components/shell/PageHeader"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { FormatDiffPreview } from "@/components/format-tool/FormatDiffPreview"
import { useSearchParams } from "react-router-dom"
import { FormatSubtabs } from "./FormatSubtabs"
import { parseFormatTab, type FormatTab } from "./formatTabs"
import {
  FORMAT_ALIGN_OPTIONS,
  FORMAT_FONT_OPTIONS,
  FORMAT_SIZE_OPTIONS,
  LINE_SPACING_OPTIONS,
  PAPER_OPTIONS,
  type FormatAlign,
  type FormatFont,
  type FormatPaper,
  type FormatFontSize,
} from "@/pages/BidWorkspace/bidTypes"
import { computeFormatDiff, SCOPE_OPTIONS, type FormatScope } from "./formatDiff"
import type { FormatApplyReport } from "./refreshDocx"
import type { FormatTemplateRecord, UseFormatTool } from "./useFormatTool"
import { stripInternalTemplateMarks } from "./useFormatTool"
import type { FormatSpec } from "./formatSpec"

const HEADING_LABEL = ["一级标题", "二级标题", "三级标题", "四级标题", "五级标题", "六级标题"]
// R-009：校验报告四槽位（Q-017：报告只列四个刷新范围，不逐条罗列样式差异）
const APPLY_SLOT_KEYS = ["bodyFont", "heading", "lineSpacing", "pageMargin"] as const
const APPLY_SLOT_LABEL: Record<(typeof APPLY_SLOT_KEYS)[number], string> = {
  bodyFont: "正文字体字号",
  heading: "各级标题",
  lineSpacing: "正文行距",
  pageMargin: "页面与页边距",
}
const MARGIN_FIELDS: { key: "top" | "bottom" | "left" | "right"; label: string }[] = [
  { key: "top", label: "上边距" },
  { key: "bottom", label: "下边距" },
  { key: "left", label: "左边距" },
  { key: "right", label: "右边距" },
]
const SELECT_CLASS =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium text-muted-foreground">{children}</span>
}

/** 行距下拉：兼容识别出的非标准档位（如 1.25倍 / 固定值20磅） */
function LineSpacingSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const opts = [...LINE_SPACING_OPTIONS]
  if (value && !opts.includes(value)) opts.unshift(value)
  return (
    <select className={SELECT_CLASS} value={value} onChange={(e) => onChange(e.target.value)}>
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

export function FormatToolPage(vm: UseFormatTool) {
  const fileRef = useRef<HTMLInputElement>(null)
  const recognizeRef = useRef<HTMLInputElement>(null)
  // 附三用户需求：导出时可选删除文档中未应用的样式定义
  const [removeUnused, setRemoveUnused] = useState(false)
  // R46：是否同步覆盖文字级/段落级直接格式（默认开——否则「格式写死在文字上」的文档刷了等于没刷）
  const [overrideDirect, setOverrideDirect] = useState(true)
  // fmt6 向导本地 UI 态：刷新范围勾选（参与第 3 步比对）+ 刚保存标记（第 4 步完成态）
  const [scopes, setScopes] = useState<FormatScope[]>(["font", "heading", "spacing", "page"])
  const [justSaved, setJustSaved] = useState(false)
  // R95-A (P2)：删除模板二次确认，避免误点 Trash2 直接 DELETE
  const [deleteTarget, setDeleteTarget] = useState<FormatTemplateRecord | null>(null)
  // R-009：存在 ✗ 未生效项时导出二次确认（Q-016：警告 + 可继续，不硬阻断）
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false)

  // 第 1 步：上传的是「要刷新的文档」——只设源文件，不再覆盖模板配置（附三解耦）
  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) void vm.handleUploadSource(f)
    e.target.value = ""
  }

  // 顶部：上传「格式方案」识别 → 建模板（保留原能力）
  const onPickRecognizeFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) void vm.handleRecognize(f)
    e.target.value = ""
  }

  const diffs = useMemo(() => computeFormatDiff(vm.spec, vm.settings, scopes), [vm.spec, vm.settings, scopes])
  // 原向导条角标的 anomalyCount 随步进条退役；差异清单由 FormatDiffPreview 逐条渲染
  // UX-v2：两屏 Tab（?tab=）——缺省按会话派生：已有文档/方案 → 预览套用，否则上传与模板。
  // 原四步向导条退役（第 1/2 步归①屏、第 3/4 步归②屏），「只改格式不改文字」逻辑不动。
  const [searchParams] = useSearchParams()
  const derivedTab: FormatTab = vm.sourceFile || vm.spec ? "preview" : "upload"
  const tab = parseFormatTab(searchParams.get("tab")) ?? derivedTab
  const settingsSummary = `${vm.settings.paper} · 正文${vm.settings.body.font}${vm.settings.body.size} · 标题${vm.settings.heading.length}级`

  // R-009：当前报告里 ✗ 未生效的槽位（导出前二次确认的依据）
  const failSlots = useMemo(() => {
    const r = vm.applyResult?.report
    if (!r) return []
    return APPLY_SLOT_KEYS.map((k) => ({ key: k, slot: r.slots[k] })).filter((x) => x.slot.status === "fail")
  }, [vm.applyResult])

  const onExportClick = () => {
    if (!vm.applyResult) return
    if (failSlots.length) setExportConfirmOpen(true)
    else vm.exportApplied()
  }

  const toggleScope = (key: FormatScope) =>
    setScopes((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]))

  const onSave = () => {
    void (async () => {
      await vm.saveTemplate()
      setJustSaved(true)
    })()
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8">
      <PageHeader
        title="格式刷新"
        desc="仅统一排版样式，不改动任何文档文字"
        actions={
          <>
            <input ref={fileRef} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={onPickFile} />
            <input ref={recognizeRef} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={onPickRecognizeFile} />
            <Button variant="outline" size="sm" onClick={() => recognizeRef.current?.click()} disabled={vm.uploading} title="上传一份标准格式样张，识别其格式保存为模板（不影响第 1 步已上传的待刷新文档）">
              <FileSearch className="mr-1.5 h-4 w-4" />
              {vm.uploading ? "识别中…" : "上传格式方案识别"}
            </Button>
            <Button variant="ghost" size="sm" onClick={vm.startBlank}>
              <Plus className="mr-1.5 h-4 w-4" />
              从零定义
            </Button>
          </>
        }
      />

      {/* UX-v2：两屏 SubTab（① 上传与模板 / ② 预览套用），原四步向导条退役 */}
      <div className="mb-5">
        <FormatSubtabs active={tab} />
      </div>

      {/* UX-v2：① 上传与模板 / ② 预览套用 两屏同位条件渲染（区段原位不动，只按 Tab 显隐） */}
      <div className={`grid items-start gap-5 ${tab === "upload" ? "lg:grid-cols-2" : ""}`}>
        {tab === "upload" ? (
        <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div>
            <p className="mb-2 text-sm font-semibold text-foreground">第 1 步 · 上传要刷新的文档</p>
            {vm.spec ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <FileText className="h-8 w-8 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground" title={vm.spec.sourceFileName}>{vm.spec.sourceFileName}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {vm.spec.paragraphStyleCount} 个段落样式 · {vm.spec.page.paperGuess} · <span className="text-primary">✓ 可解析</span>
                  </p>
                </div>
                <Button size="sm" variant="ghost" className="ml-auto h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-primary" onClick={() => fileRef.current?.click()}>
                  替换
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-border bg-background/60 px-3 py-6 text-center transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Wand2 className="h-6 w-6 text-muted-foreground/60" />
                <span className="text-xs font-medium text-foreground">点击上传要刷新的 .docx 文档</span>
                <span className="text-[11px] text-muted-foreground">第 2 步选模板后按模板刷新其格式；纯前端解析，不上传文档内容</span>
              </button>
            )}
            {vm.spec && <RecognizedSummary spec={vm.spec} notes={vm.notes} />}
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-foreground">第 2 步 · 公司标准模板</p>
            {vm.listLoading ? (
              <p className="py-4 text-center text-xs text-muted-foreground">模板加载中…</p>
            ) : (
              <div className="space-y-1.5">
                <TemplateRadio
                  checked={!vm.editingId}
                  title="自定义 / 当前编辑中的配置"
                  desc={settingsSummary}
                  onSelect={vm.startBlank}
                />
                {vm.templates.map((t) => (
                  <div key={t.id} className="flex items-center gap-1">
                    <div className="min-w-0 flex-1">
                      <TemplateRadio
                        checked={vm.editingId === t.id}
                        title={stripInternalTemplateMarks(t.name)}
                        desc={`${t.source_file_name ? `来源：${t.source_file_name}` : "手动定义"} · ${summaryOfTemplate(t.format_settings)}`}
                        isDefault={t.is_default}
                        onSelect={() => vm.editTemplate(t)}
                      />
                    </div>
                    {!t.is_default && (
                      <Button size="sm" variant="ghost" className="h-7 shrink-0 px-1.5 text-[11px] text-muted-foreground" title="设为默认套用模板" onClick={() => void vm.setDefault(t.id)}>
                        <Star className="mr-0.5 h-3 w-3" />默认
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 shrink-0 px-1.5 text-[11px] text-muted-foreground hover:text-destructive" title="删除模板" onClick={() => setDeleteTarget(t)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {vm.templates.length === 0 && (
                  <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                    模板库为空：上传一份标准格式方案识别后保存，或「从零定义」一套公司标准。
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-foreground">刷新范围</p>
            <div className="space-y-1">
              {SCOPE_OPTIONS.map((x) => (
                <label key={x.key} className="flex cursor-pointer select-none items-center gap-2 rounded-md px-1.5 py-1 text-xs text-foreground hover:bg-secondary/60">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" checked={scopes.includes(x.key)} onChange={() => toggleScope(x.key)} />
                  {x.label}
                </label>
              ))}
            </div>
          </div>

          <p className="flex items-start gap-2 rounded-lg bg-primary/5 px-3 py-2.5 text-xs leading-relaxed text-primary">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            安全承诺：仅修改样式，正文文字内容 0 改动；套用在标书 / 方案导出时生效。
          </p>
        </section>
        ) : null}

        {tab === "preview" ? (
        <section className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <FormatDiffPreview spec={vm.spec} settings={vm.settings} diffs={diffs} />
          </div>

          {/* 第 4 步：保存套用 */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">第 4 步 · 保存并供导出套用</p>
              {justSaved && (
                <span className="flex items-center gap-1 text-xs text-primary">
                  <Check className="h-3.5 w-3.5" />已保存到模板库
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Input
                placeholder="模板名称，如：公司标准方案格式"
                className="min-w-[200px] flex-1 border-border bg-background text-sm"
                value={vm.name}
                onChange={(e) => {
                  vm.setName(e.target.value)
                  setJustSaved(false)
                }}
              />
              <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" checked={vm.isDefault} onChange={(e) => vm.setIsDefault(e.target.checked)} />
                设为默认套用模板
              </label>
              <Button size="sm" onClick={onSave} disabled={vm.busy} className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90">
                <Save className="mr-1.5 h-4 w-4" />
                {vm.busy ? "保存中…" : vm.editingId ? "更新模板" : "保存为模板"}
              </Button>
              <label
                className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground"
                title="按范围同步改写段落/文字上的直接格式（字体字号写死在 run 上、行距写在段落上时，只改样式表不会生效）。表格内文字与封面/自定义样式段落会跳过并如实提示"
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                  checked={overrideDirect}
                  onChange={(e) => setOverrideDirect(e.target.checked)}
                />
                覆盖文字级直接格式
              </label>
              <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground" title="导出时删除文档中定义了但没有任何段落/文字引用的样式，精简样式表（默认样式与被引用样式保留）">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                  checked={removeUnused}
                  onChange={(e) => setRemoveUnused(e.target.checked)}
                />
                删除未应用的样式
              </label>
              {/* R-009 三段式：一键应用（改写+复检）→ 校验报告 → 导出（有 ✗ 二次确认） */}
              <Button
                size="sm"
                onClick={() => void vm.applyFormat(scopes, { removeUnusedStyles: removeUnused, overrideDirectFormat: overrideDirect })}
                disabled={!vm.sourceFile || vm.applying}
                title={vm.sourceFile ? "按当前模板配置改写样式并自动复检四项范围，生成校验报告" : "先在第 1 步上传要刷新的 .docx 文档"}
                className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
              >
                <Zap className="mr-1.5 h-4 w-4" />
                <span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary" aria-hidden="true">3</span>
                {vm.applying ? "应用中…" : "一键应用格式"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!vm.applyResult}
                title={vm.applyResult ? "下载已应用格式的文档（与校验报告同一份产物，不重复改写）" : "先点「一键应用格式」生成校验报告"}
                onClick={onExportClick}
                className="border-primary/50 text-primary hover:bg-primary/5"
              >
                <FileDown className="mr-1.5 h-4 w-4" />
                <span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary" aria-hidden="true">4</span>
                导出刷新后文档
              </Button>
            </div>
            {vm.applyResult && (
              <ApplyReportPanel report={vm.applyResult.report} notes={vm.applyResult.notes} />
            )}
            {/* UX-R2（docs/ux-review-2026-11 §十一）：长说明收进可展开块，版面让给预览。
                验收修复：原 <p> 包 <details>/<summary> 违反 HTML 内容模型（控制台 hydration 报错），改为 div 容器 */}
            <div className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              <details className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                  ⚠ 应用与导出规则（点开查看完整说明）
                </summary>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  流程：先「一键应用格式」按当前模板配置改写上传文档并自动复检（正文字体、各级标题、行距、页边距四项，报告见下方），确认结果后点「导出刷新后文档」下载——下载的就是应用时的同一份产物，不会重复改写。存在 ✗ 未生效项时导出会再次提醒，可自行判断是否继续；正文文字始终 0 改动。勾选「删除未应用的样式」在应用时一并移除文档中无引用的冗余样式定义；勾选「覆盖文字级直接格式」（默认开）会同步改写写在文字/段落上的字体字号与行距——很多成稿（含本项目导出的 docx）把格式写死在 run 与段落上，不开这项只改样式表会「看起来没变」。保存后在标书工作台「格式与暗标设置」或方案导出设置中也可选该模板套用。{vm.editingId ? "正在编辑已选模板，改完点「更新模板」保存。" : ""}
                </p>
              </details>
            </div>
          </div>

          {/* 高级微调（沿用原逐字段编辑器） */}
          <details className="group rounded-xl border border-border bg-card shadow-sm" open={!vm.spec}>
            <summary className="cursor-pointer select-none px-5 py-3.5 text-sm font-semibold text-foreground transition-colors hover:text-primary">
              微调格式配置（可选）
              <span className="ml-2 text-xs font-normal text-muted-foreground">{settingsSummary}</span>
            </summary>
            <div className="border-t border-border px-5 py-4">
              {/* 页面设置 */}
              <div className="mb-5 space-y-3">
                <div className="grid gap-3 sm:grid-cols-5">
                  <label className="grid gap-1 sm:col-span-2">
                    <FieldLabel>纸张</FieldLabel>
                    <select
                      className={SELECT_CLASS}
                      value={vm.settings.paper}
                      onChange={(e) => vm.patchSettings({ paper: e.target.value as FormatPaper })}
                    >
                      {PAPER_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {MARGIN_FIELDS.map((m) => (
                    <label key={m.key} className="grid gap-1">
                      <FieldLabel>{m.label}(cm)</FieldLabel>
                      <Input
                        type="number"
                        step="0.01"
                        min="0.5"
                        max="10"
                        className="border-border bg-background text-xs"
                        value={vm.settings.margins[m.key]}
                        onChange={(e) => vm.patchMargin(m.key, Number(e.target.value))}
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* 正文 */}
              <div className="mb-5">
                <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">正文样式</p>
                <div className="grid gap-3 sm:grid-cols-5">
                  <label className="grid gap-1">
                    <FieldLabel>字体</FieldLabel>
                    <select
                      className={SELECT_CLASS}
                      value={vm.settings.body.font}
                      onChange={(e) => vm.patchBody({ font: e.target.value as FormatFont })}
                    >
                      {FORMAT_FONT_OPTIONS.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <FieldLabel>字号</FieldLabel>
                    <select
                      className={SELECT_CLASS}
                      value={vm.settings.body.size}
                      onChange={(e) => vm.patchBody({ size: e.target.value as FormatFontSize })}
                    >
                      {FORMAT_SIZE_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <FieldLabel>对齐</FieldLabel>
                    <select
                      className={SELECT_CLASS}
                      value={vm.settings.body.align}
                      onChange={(e) => vm.patchBody({ align: e.target.value as FormatAlign })}
                    >
                      {FORMAT_ALIGN_OPTIONS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <FieldLabel>行距</FieldLabel>
                    <LineSpacingSelect value={vm.settings.body.lineSpacing} onChange={(v) => vm.patchBody({ lineSpacing: v })} />
                  </label>
                  <label className="grid gap-1">
                    <FieldLabel>首行缩进(字符)</FieldLabel>
                    <Input
                      type="number"
                      step="0.5"
                      min="0"
                      max="4"
                      className="border-border bg-background text-xs"
                      value={vm.settings.body.firstIndent}
                      onChange={(e) => vm.patchBody({ firstIndent: Number(e.target.value) })}
                    />
                  </label>
                </div>
              </div>

              {/* 六级标题 */}
              <div className="mb-2">
                <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">各级标题样式</p>
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">级别</th>
                        <th className="px-3 py-2 text-left font-medium">字体</th>
                        <th className="px-3 py-2 text-left font-medium">字号</th>
                        <th className="px-3 py-2 text-left font-medium">对齐</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vm.settings.heading.map((h, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="whitespace-nowrap px-3 py-2 font-medium text-foreground">{HEADING_LABEL[i]}</td>
                          <td className="px-2 py-1.5">
                            <select
                              className={SELECT_CLASS}
                              value={h.font}
                              onChange={(e) => vm.patchHeading(i, { font: e.target.value as FormatFont })}
                            >
                              {FORMAT_FONT_OPTIONS.map((f) => (
                                <option key={f} value={f}>
                                  {f}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <select
                              className={SELECT_CLASS}
                              value={h.size}
                              onChange={(e) => vm.patchHeading(i, { size: e.target.value as FormatFontSize })}
                            >
                              {FORMAT_SIZE_OPTIONS.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <select
                              className={SELECT_CLASS}
                              value={h.align}
                              onChange={(e) => vm.patchHeading(i, { align: e.target.value as FormatAlign })}
                            >
                              {FORMAT_ALIGN_OPTIONS.map((a) => (
                                <option key={a.value} value={a.value}>
                                  {a.label}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  目录 / 页码 / 页眉页脚 / 标题编号 / 暗标 等导出开关，在标书工作台的「格式与暗标设置」面板中按项目调整；此处定义的是各级字体与页面基准。
                </p>
              </div>
            </div>
          </details>
        </section>
        ) : null}
      </div>
      {/* R95-A：删除模板二次确认（避免误点 Trash2 直接 DELETE） */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="删除这个模板？"
        description={deleteTarget ? `「${deleteTarget.name}」将从模板库永久移除，已导出的 Word 文件不受影响。` : undefined}
        confirmText="删除"
        tone="danger"
        onConfirm={() => {
          if (deleteTarget) void vm.deleteTemplate(deleteTarget.id)
          setDeleteTarget(null)
        }}
      />
      {/* R-009 / Q-016：存在 ✗ 未生效项时导出二次确认——警告但可继续 */}
      <ConfirmDialog
        open={exportConfirmOpen}
        onOpenChange={setExportConfirmOpen}
        title={`有 ${failSlots.length} 项格式未生效，仍要导出？`}
        description={`以下范围复检未命中目标配置：${failSlots.map((x) => `${APPLY_SLOT_LABEL[x.key]}（${x.slot.reason ?? "未知原因"}）`).join("；")}。导出的文档其余已生效范围不受影响，你也可以回调整配置后重新「一键应用格式」。`}
        confirmText="仍然导出"
        onConfirm={() => {
          setExportConfirmOpen(false)
          vm.exportApplied()
        }}
      />
    </div>
  )
}

function TemplateRadio({
  checked,
  title,
  desc,
  isDefault,
  onSelect,
}: {
  checked: boolean
  title: string
  desc: string
  isDefault?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        checked ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/40"
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${checked ? "border-primary" : "border-border"}`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className={`truncate text-sm font-medium ${checked ? "text-primary" : "text-foreground"}`}>{title}</span>
          {isDefault && (
            <Badge variant="success" className="shrink-0 px-1.5 py-0 text-[10px]">
              <Star className="mr-0.5 h-2.5 w-2.5" />默认
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{desc}</span>
      </span>
    </button>
  )
}

function summaryOfTemplate(fs?: { paper?: string; body?: { font?: string; size?: string } }): string {
  if (!fs) return "未配置"
  const b = fs.body
  return `${fs.paper ?? "A4"}${b ? ` · 正文${b.font ?? ""}${b.size ?? ""}` : ""}`
}

/** R-009：格式应用校验报告——四槽位 ✓/✗/—、已生效 N/4、正文 0 改动对照、详情可展开 */
function ApplyReportPanel({ report, notes }: { report: FormatApplyReport; notes: string[] }) {
  const slots = APPLY_SLOT_KEYS.map((k) => ({ key: k, slot: report.slots[k] }))
  const textSame = report.textBefore === report.textAfter
  const allOk = report.okCount === report.totalCount
  return (
    <div className="mt-3 rounded-lg border border-border bg-background/60 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          格式应用校验报告
        </p>
        <Badge variant={allOk ? "success" : "warning"} className="px-1.5 py-0 text-[10px]">
          已生效 {report.okCount}/{report.totalCount}
        </Badge>
        {textSame ? (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
            正文文字 0 改动（{formatCount(report.textAfter)} 字符）
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[11px] text-warning">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            正文文字发生变化（{report.textBefore} → {report.textAfter} 字符），请先检查再导出
          </span>
        )}
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {slots.map(({ key, slot }) => (
          <div key={key} className="flex items-start gap-1.5 rounded-md border border-border/70 px-2.5 py-1.5 text-[11px] leading-relaxed">
            {slot.status === "ok" && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />}
            {slot.status === "fail" && <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />}
            {slot.status === "skip" && <MinusCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            <span className="min-w-0">
              <span className="font-medium text-foreground">{APPLY_SLOT_LABEL[key]}</span>
              <span className="ml-1.5 text-muted-foreground">
                {slot.status === "ok" ? "✓ 已生效" : slot.status === "fail" ? "✗ 未生效" : "— 未应用"}
                {slot.reason ? ` · ${slot.reason}` : ""}
              </span>
            </span>
          </div>
        ))}
      </div>
      {report.direct.bodyRuns + report.direct.headingRuns + report.direct.spacingParas + report.direct.indentParas > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">直接格式改写</span>
          <span>文字级 · 正文 {report.direct.bodyRuns} 处 / 标题 {report.direct.headingRuns} 处</span>
          <span>段落级 · 行距 {report.direct.spacingParas} 段 / 缩进 {report.direct.indentParas} 段</span>
          {report.direct.protectedParas > 0 && (
            <span className="text-warning">跳过 {report.direct.protectedParas} 段（表格内文字 / 封面与自定义样式）</span>
          )}
        </p>
      )}
      {notes.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer select-none text-[11px] text-muted-foreground transition-colors hover:text-primary">
            查看详情（{notes.length} 条提示）
          </summary>
          <ul className="mt-1 space-y-0.5 border-t border-border/60 pt-1.5">
            {notes.map((n, i) => (
              <li key={i} className="flex items-start gap-1 text-[11px] text-muted-foreground">· {n}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">报告基于应用产物复检得出；调整模板配置或刷新范围后，请重新点「一键应用格式」刷新报告。</p>
    </div>
  )
}

/** 识别到的原始精确值 + 映射近似说明 */
function RecognizedSummary({ spec, notes }: { spec: FormatSpec; notes: string[] }) {
  const ptOf = (n: number) => (n ? `${n}pt` : "—")
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-dashed border-border bg-background/60 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground">
        <FileText className="h-3 w-3" />
        「{spec.sourceFileName}」的当前格式（改前基线）
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-foreground">
        <span>页边距 上{spec.page.margin.top} 下{spec.page.margin.bottom}</span>
        <span>左{spec.page.margin.left} 右{spec.page.margin.right} cm</span>
        <span>正文 {spec.body.fontEastAsia || "—"} {ptOf(spec.body.sizePt)}</span>
        {spec.headings.map((h) => (
          <span key={h.level}>
            {HEADING_LABEL[h.level - 1]} {h.fontEastAsia || "—"} {ptOf(h.sizePt)}
            {h.bold ? " 粗" : ""}
          </span>
        ))}
      </div>
      {notes.length > 0 && (
        <ul className="mt-1 space-y-0.5 border-t border-border/60 pt-1.5">
          {notes.map((n, i) => (
            <li key={i} className="flex items-start gap-1 text-[11px] text-warning">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />· {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

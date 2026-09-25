import { useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  Check,
  FileDown,
  FileSearch,
  FileText,
  Plus,
  Save,
  ShieldCheck,
  Star,
  Trash2,
  Wand2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/shell/PageHeader"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { FormatDiffPreview } from "@/components/format-tool/FormatDiffPreview"
import { FormatWizardStepper } from "@/components/format-tool/FormatWizardStepper"
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
import type { UseFormatTool } from "./useFormatTool"
import type { FormatSpec } from "./formatSpec"

const HEADING_LABEL = ["一级标题", "二级标题", "三级标题", "四级标题", "五级标题", "六级标题"]
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
  // fmt6 向导本地 UI 态：刷新范围勾选（参与第 3 步比对）+ 刚保存标记（第 4 步完成态）
  const [scopes, setScopes] = useState<FormatScope[]>(["font", "heading", "spacing", "page"])
  const [justSaved, setJustSaved] = useState(false)

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) void vm.handleRecognize(f)
    e.target.value = ""
  }

  const diffs = useMemo(() => computeFormatDiff(vm.spec, vm.settings, scopes), [vm.spec, vm.settings, scopes])
  const anomalyCount = diffs.filter((d) => !d.same).length
  const activeStep = justSaved ? 4 : vm.spec ? 3 : vm.editingId ? 2 : 1
  const settingsSummary = `${vm.settings.paper} · 正文${vm.settings.body.font}${vm.settings.body.size} · 标题${vm.settings.heading.length}级`

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
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={vm.uploading}>
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

      <div className="mb-5">
        <FormatWizardStepper activeStep={activeStep} anomalyCount={anomalyCount} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[330px_minmax(0,1fr)]">
        {/* ---------------- 左：第 1/2 步配置 + 刷新范围 + 安全承诺 ---------------- */}
        <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div>
            <p className="mb-2 text-sm font-semibold text-foreground">第 1 步 · 上传文档</p>
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
                <span className="text-xs font-medium text-foreground">点击上传 .docx 格式方案</span>
                <span className="text-[11px] text-muted-foreground">纯前端解析样式定义，不上传文档内容</span>
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
                        title={t.name}
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
                    <Button size="sm" variant="ghost" className="h-7 shrink-0 px-1.5 text-[11px] text-muted-foreground hover:text-destructive" title="删除模板" onClick={() => void vm.deleteTemplate(t.id)}>
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

        {/* ---------------- 右：第 3 步对比 + 第 4 步保存 + 微调编辑器 ---------------- */}
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
              <Button
                size="sm"
                variant="outline"
                disabled={!vm.sourceFile || vm.exporting}
                title={vm.sourceFile ? "按当前模板配置改写原文档样式并下载" : "先在第 1 步上传要刷新的 .docx 文档"}
                onClick={() => void vm.exportRefreshed(scopes)}
                className="border-primary/50 text-primary hover:bg-primary/5"
              >
                <FileDown className="mr-1.5 h-4 w-4" />
                {vm.exporting ? "导出中…" : "导出刷新后文档"}
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              「导出刷新后文档」按当前选中的模板配置直接改写原文档样式（文字 0 改动、范围随上方勾选）；保存后在标书工作台「格式与暗标设置」或方案导出设置中也可选该模板套用。{vm.editingId ? "正在编辑已选模板，改完点「更新模板」保存。" : ""}
            </p>
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
      </div>
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

/** 识别到的原始精确值 + 映射近似说明 */
function RecognizedSummary({ spec, notes }: { spec: FormatSpec; notes: string[] }) {
  const ptOf = (n: number) => (n ? `${n}pt` : "—")
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-dashed border-border bg-background/60 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground">
        <FileText className="h-3 w-3" />
        从「{spec.sourceFileName}」识别到的原始格式
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

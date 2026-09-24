import { useEffect, useState } from "react"
import { Check, ChevronDown, Loader2, ShieldCheck, SlidersHorizontal, Wand2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import {
  FORMAT_ALIGN_OPTIONS,
  FORMAT_CHECK_KEYS,
  FORMAT_CHECK_LABEL,
  FORMAT_FONT_OPTIONS,
  FORMAT_SIZE_OPTIONS,
  LINE_SPACING_OPTIONS,
  PAPER_OPTIONS,
  TITLE_NUMBERING_OPTIONS,
  ZHIYE_STANDARD_FORMAT,
  fixedLineSpacingValue,
  parseFixedLineSpacing,
  splitContentFont,
  type FormatAlign,
  type FormatCheckKey,
  type FormatFont,
  type FormatFontSize,
  type FormatPaper,
  type FormatSettings,
  type TitleNumbering,
} from "@/pages/BidWorkspace/bidTypes"
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"

type FormatSettingsPanelProps = Pick<
  UseBidWorkspace,
  | "formatSettings"
  | "effectiveFormatSettings"
  | "formatCheckItems"
  | "setFormatSettingsPatch"
  | "setFormatMarginsPatch"
  | "setFormatHeadingLevel"
  | "setFormatBodyPatch"
  | "setFormatTablePatch"
  | "toggleFormatCheckItem"
  | "setAllFormatCheckItems"
  | "settingsSaved"
  | "identityWords"
  | "setIdentityWords"
>

const HEADING_LEVEL_LABEL = ["一级标题", "二级标题", "三级标题", "四级标题", "五级标题", "六级标题"]

const MARGIN_FIELDS: { key: "top" | "bottom" | "left" | "right"; label: string }[] = [
  { key: "top", label: "上边距" },
  { key: "bottom", label: "下边距" },
  { key: "left", label: "左边距" },
  { key: "right", label: "右边距" },
]

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"

function FieldLabel({ children }: { children: string }) {
  return <span className="text-xs font-medium text-muted-foreground">{children}</span>
}

/** 开关行（目录 / 页码 / 页眉页脚 / 暗标共用） */
function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background px-3 py-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
      />
      <span className="text-xs leading-snug">
        <span className="font-medium text-foreground">{label}</span>
        <span className="block text-muted-foreground">{desc}</span>
      </span>
    </label>
  )
}

type FormatTemplateLite = { id: string; name: string; is_default?: boolean; format_settings?: FormatSettings }

async function fetchFormatTemplates(): Promise<FormatTemplateLite[]> {
  const res = await fetch(`${getPocketBaseUrl()}/api/format_templates`, {
    headers: { "Content-Type": "application/json", ...vibexAuthHeaders() },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { items?: FormatTemplateLite[] }
  return data.items ?? []
}

/**
 * 第十七轮 17C：「格式与暗标设置」折叠面板——纸张 / 页边距 / 六级标题字体字号对齐 /
 * 正文字体字号首行缩进行距 / 表格边框与内容字体 / 目录页码页眉页脚开关 / 标题编号示例 /
 * 暗标开关与暗标页数 / 格式规则检查项勾选；全部走 applySetting 防抖持久化。
 * format_settings=null 时按系统缺省值展示（导出仍走内置默认样式），任一改动即生成专属配置落库。
 */
export function FormatSettingsPanel(p: FormatSettingsPanelProps) {
  const [open, setOpen] = useState(false)
  const fmt = p.effectiveFormatSettings
  // 数字输入草稿：onBlur 才提交（避免每敲一键发一次 PATCH）
  const [marginDrafts, setMarginDrafts] = useState({ top: "", bottom: "", left: "", right: "" })
  const [indentDraft, setIndentDraft] = useState("")
  const [fixedPtDraft, setFixedPtDraft] = useState("28")
  const [borderDraft, setBorderDraft] = useState("")
  const [sealedPagesDraft, setSealedPagesDraft] = useState("")
  // 循环 2 批 1-4：自家身份词草稿（onBlur 提交，applySetting 防抖落库）
  const [identityDraft, setIdentityDraft] = useState("")
  // 格式刷新工具：从模板库套用
  const [ftTemplates, setFtTemplates] = useState<FormatTemplateLite[]>([])
  const [ftSel, setFtSel] = useState("")
  const [ftLoading, setFtLoading] = useState(false)
  const [ftLoaded, setFtLoaded] = useState(false)

  useEffect(() => {
    if (!open || ftLoaded || ftLoading) return
    setFtLoading(true)
    fetchFormatTemplates()
      .then((items) => {
        setFtTemplates(items)
        const def = items.find((t) => t.is_default) ?? items[0]
        if (def) setFtSel(def.id)
        setFtLoaded(true)
      })
      .catch(() => setFtTemplates([]))
      .finally(() => setFtLoading(false))
  }, [open, ftLoaded, ftLoading])

  const applyFormatTemplate = () => {
    const t = ftTemplates.find((x) => x.id === ftSel)
    if (!t?.format_settings) {
      toast.error("该模板没有可套用的格式配置")
      return
    }
    p.setFormatSettingsPatch(t.format_settings)
    toast.success(`已套用模板「${t.name}」，导出前可再微调`)
  }

  useEffect(() => {
    setMarginDrafts({
      top: String(fmt.margins.top),
      bottom: String(fmt.margins.bottom),
      left: String(fmt.margins.left),
      right: String(fmt.margins.right),
    })
  }, [fmt.margins.top, fmt.margins.bottom, fmt.margins.left, fmt.margins.right])
  useEffect(() => setIndentDraft(String(fmt.body.firstIndent)), [fmt.body.firstIndent])
  useEffect(() => setFixedPtDraft(String(parseFixedLineSpacing(fmt.body.lineSpacing) ?? 28)), [fmt.body.lineSpacing])
  useEffect(() => setBorderDraft(fmt.table.border), [fmt.table.border])
  useEffect(() => setSealedPagesDraft(fmt.sealedPages === null ? "" : String(fmt.sealedPages)), [fmt.sealedPages])
  useEffect(() => setIdentityDraft(p.identityWords), [p.identityWords])

  const commitMargin = (key: "top" | "bottom" | "left" | "right", raw: string) => {
    const n = Number(raw)
    if (raw.trim() === "" || !Number.isFinite(n)) {
      setMarginDrafts((d) => ({ ...d, [key]: String(fmt.margins[key]) }))
      return
    }
    p.setFormatMarginsPatch({ [key]: Math.min(10, Math.max(0.5, Math.round(n * 100) / 100)) })
  }

  const commitIndent = () => {
    const n = Number(indentDraft)
    if (indentDraft.trim() === "" || !Number.isFinite(n)) {
      setIndentDraft(String(fmt.body.firstIndent))
      return
    }
    p.setFormatBodyPatch({ firstIndent: Math.min(4, Math.max(0, Math.round(n * 10) / 10)) })
  }

  const commitFixedPt = () => {
    const n = Number(fixedPtDraft)
    if (!Number.isFinite(n) || n <= 0) {
      setFixedPtDraft(String(parseFixedLineSpacing(fmt.body.lineSpacing) ?? 28))
      return
    }
    p.setFormatBodyPatch({ lineSpacing: fixedLineSpacingValue(n) })
  }

  const commitSealedPages = () => {
    const raw = sealedPagesDraft.trim()
    if (raw === "") {
      p.setFormatSettingsPatch({ sealedPages: null })
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 1) {
      setSealedPagesDraft(fmt.sealedPages === null ? "" : String(fmt.sealedPages))
      return
    }
    p.setFormatSettingsPatch({ sealedPages: Math.min(9999, Math.round(n)) })
  }

  const commitIdentityWords = () => {
    p.setIdentityWords(identityDraft.slice(0, 500))
  }

  const fixedPt = parseFixedLineSpacing(fmt.body.lineSpacing)
  const contentFont = splitContentFont(fmt.table.contentFont)
  const numbering = TITLE_NUMBERING_OPTIONS.find((o) => o.value === fmt.titleNumbering) ?? TITLE_NUMBERING_OPTIONS[0]
  const summary = `${fmt.paper} · 正文${fmt.body.font}${fmt.body.size} · ${fmt.sealed ? "暗标开" : "暗标关"} · 检查项 ${p.formatCheckItems.length}/${FORMAT_CHECK_KEYS.length}`

  return (
    <div className="rounded-lg border border-border bg-card shadow-md animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg p-4 text-left transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-primary" />
          格式与暗标设置
          <span className="hidden text-xs font-normal text-muted-foreground lg:inline">
            纸张 / 页边距 / 标题与正文字体 / 目录页码 / 暗标 · 自动保存到项目
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{summary}</span>
          <span
            className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              p.settingsSaved ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            {p.settingsSaved ? <Check className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
            {p.settingsSaved ? "已保存" : "保存中…"}
          </span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-5 border-t border-border p-4">
          {p.formatSettings === null && (
            <p className="rounded-md border border-dashed border-border bg-background px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              尚未单独配置格式：当前展示系统缺省值，导出 Word 仍按内置默认样式；修改任意一项后会为本项目生成专属格式配置并自动保存，导出即按配置生效。
            </p>
          )}

          <section className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Wand2 className="h-3.5 w-3.5 text-primary" />
              从格式模板套用
            </span>
            {ftLoading ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />加载模板…
              </span>
            ) : ftTemplates.length === 0 ? (
              <span className="text-xs text-muted-foreground">模板库为空，可去「格式刷新」工具上传格式方案识别生成。</span>
            ) : (
              <>
                <select
                  value={ftSel}
                  onChange={(e) => setFtSel(e.target.value)}
                  className="min-w-[160px] flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {ftTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.is_default ? "（默认）" : ""}
                    </option>
                  ))}
                </select>
                <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={applyFormatTemplate} disabled={!ftSel}>
                  套用到本项目
                </Button>
              </>
            )}
          </section>

          {/* 公司招投标培训（第一期）：《智业软件文档编辑使用规范 V2.1》排版参数一键套用 */}
          <section className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              智业投标文件排版规范（公司文档编辑规范 V2.1）
            </span>
            <span className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
              A4 · 边距左2.8/右2.6/上下2.5cm · 正文宋体小四 1.5倍行距首行缩进2字符 · 表内宋体五号 · 目录到三级；封面/页眉页脚仍以智业 Word 模板为准
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 px-2.5 text-xs"
              onClick={() => {
                p.setFormatSettingsPatch(ZHIYE_STANDARD_FORMAT)
                toast.success("已套用智业标准排版参数，导出前可再微调")
              }}
            >
              一键套用
            </Button>
          </section>

          <section className="grid gap-3 lg:grid-cols-5">
            <label className="grid gap-1">
              <FieldLabel>纸张</FieldLabel>
              <select
                value={fmt.paper}
                onChange={(e) => p.setFormatSettingsPatch({ paper: e.target.value as FormatPaper })}
                className={SELECT_CLASS}
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
                <FieldLabel>{`${m.label}（cm）`}</FieldLabel>
                <Input
                  type="number"
                  min={0.5}
                  max={10}
                  step={0.01}
                  value={marginDrafts[m.key]}
                  onChange={(e) => setMarginDrafts((d) => ({ ...d, [m.key]: e.target.value }))}
                  onBlur={() => commitMargin(m.key, marginDrafts[m.key])}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur()
                  }}
                  className="border-border bg-background focus-visible:shadow-[var(--focus-ring)]"
                />
              </label>
            ))}
          </section>

          <section>
            <h3 className="text-xs font-semibold text-foreground">标题样式（六级）</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {HEADING_LEVEL_LABEL.map((label, i) => {
                const h = fmt.heading[i]
                return (
                  <div key={label} className="rounded-md border border-border bg-background px-3 py-2">
                    <p className="text-xs font-medium text-foreground">{label}</p>
                    <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                      <select
                        value={h.font}
                        title={`${label}字体`}
                        onChange={(e) => p.setFormatHeadingLevel(i, { font: e.target.value as FormatFont })}
                        className={SELECT_CLASS}
                      >
                        {FORMAT_FONT_OPTIONS.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                      <select
                        value={h.size}
                        title={`${label}字号`}
                        onChange={(e) => p.setFormatHeadingLevel(i, { size: e.target.value as FormatFontSize })}
                        className={SELECT_CLASS}
                      >
                        {FORMAT_SIZE_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <select
                        value={h.align}
                        title={`${label}对齐`}
                        onChange={(e) => p.setFormatHeadingLevel(i, { align: e.target.value as FormatAlign })}
                        className={SELECT_CLASS}
                      >
                        {FORMAT_ALIGN_OPTIONS.map((a) => (
                          <option key={a.value} value={a.value}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="grid gap-1">
              <FieldLabel>正文字体</FieldLabel>
              <select
                value={fmt.body.font}
                onChange={(e) => p.setFormatBodyPatch({ font: e.target.value as FormatFont })}
                className={SELECT_CLASS}
              >
                {FORMAT_FONT_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <FieldLabel>正文字号</FieldLabel>
              <select
                value={fmt.body.size}
                onChange={(e) => p.setFormatBodyPatch({ size: e.target.value as FormatFontSize })}
                className={SELECT_CLASS}
              >
                {FORMAT_SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <FieldLabel>首行缩进（字符）</FieldLabel>
              <Input
                type="number"
                min={0}
                max={4}
                step={0.5}
                value={indentDraft}
                onChange={(e) => setIndentDraft(e.target.value)}
                onBlur={commitIndent}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur()
                }}
                className="border-border bg-background focus-visible:shadow-[var(--focus-ring)]"
              />
            </label>
            <label className="grid gap-1">
              <FieldLabel>正文对齐</FieldLabel>
              <select
                value={fmt.body.align}
                onChange={(e) => p.setFormatBodyPatch({ align: e.target.value as FormatAlign })}
                className={SELECT_CLASS}
              >
                {FORMAT_ALIGN_OPTIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-1">
              <FieldLabel>行距</FieldLabel>
              <div className="flex gap-1.5">
                <select
                  value={fixedPt !== null ? "固定值" : fmt.body.lineSpacing}
                  onChange={(e) => {
                    const v = e.target.value
                    p.setFormatBodyPatch({
                      lineSpacing: v === "固定值" ? fixedLineSpacingValue(Number(fixedPtDraft) || 28) : v,
                    })
                  }}
                  className={SELECT_CLASS}
                >
                  {LINE_SPACING_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                {fixedPt !== null && (
                  <Input
                    type="number"
                    min={9}
                    max={50}
                    value={fixedPtDraft}
                    title="固定值行距（磅）"
                    onChange={(e) => setFixedPtDraft(e.target.value)}
                    onBlur={commitFixedPt}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur()
                    }}
                    className="w-20 border-border bg-background focus-visible:shadow-[var(--focus-ring)]"
                  />
                )}
              </div>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-1">
              <FieldLabel>表格边框（如 0.5pt）</FieldLabel>
              <Input
                value={borderDraft}
                onChange={(e) => setBorderDraft(e.target.value)}
                onBlur={() => p.setFormatTablePatch({ border: borderDraft.trim().slice(0, 12) || fmt.table.border })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur()
                }}
                className="border-border bg-background focus-visible:shadow-[var(--focus-ring)]"
              />
            </label>
            <label className="grid gap-1">
              <FieldLabel>表格内容字体</FieldLabel>
              <select
                value={contentFont.font}
                onChange={(e) =>
                  p.setFormatTablePatch({ contentFont: `${e.target.value}${contentFont.size}` })
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
            <label className="grid gap-1">
              <FieldLabel>表格内容字号</FieldLabel>
              <select
                value={contentFont.size}
                onChange={(e) =>
                  p.setFormatTablePatch({ contentFont: `${contentFont.font}${e.target.value}` })
                }
                className={SELECT_CLASS}
              >
                {FORMAT_SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <FieldLabel>标题编号</FieldLabel>
              <select
                value={fmt.titleNumbering}
                onChange={(e) => p.setFormatSettingsPatch({ titleNumbering: e.target.value as TitleNumbering })}
                className={SELECT_CLASS}
              >
                {TITLE_NUMBERING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-2 lg:col-span-4">
              编号示例：{numbering.example}
            </p>
          </section>

          <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <ToggleRow
              label="生成目录"
              desc="导出 Word 时在正文前插入目录（打开文档时按提示更新目录域）"
              checked={fmt.toc}
              onChange={(v) => p.setFormatSettingsPatch({ toc: v })}
            />
            <ToggleRow
              label="输出页码"
              desc="页脚居中「第 X 页」；暗标开启时强制不输出页码"
              checked={fmt.pageNumber}
              onChange={(v) => p.setFormatSettingsPatch({ pageNumber: v })}
            />
            <ToggleRow
              label="页眉页脚"
              desc="页眉右侧显示项目名与「投标文件」字样"
              checked={fmt.headerFooter}
              onChange={(v) => p.setFormatSettingsPatch({ headerFooter: v })}
            />
          </section>

          <section className="rounded-md border border-border bg-background px-3 py-2.5">
            <div className="grid gap-2 sm:grid-cols-2">
              <ToggleRow
                label="暗标"
                desc="开启后导出加暗标声明占位页，且全文不输出页码"
                checked={fmt.sealed}
                onChange={(v) => p.setFormatSettingsPatch({ sealed: v, ...(v ? {} : { sealedPages: null }) })}
              />
              {fmt.sealed && (
                <label className="grid content-start gap-1">
                  <FieldLabel>暗标页数（技术暗标装订范围）</FieldLabel>
                  <Input
                    type="number"
                    min={1}
                    max={9999}
                    placeholder="留空=未填"
                    value={sealedPagesDraft}
                    onChange={(e) => setSealedPagesDraft(e.target.value)}
                    onBlur={commitSealedPages}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur()
                    }}
                    className="border-border bg-background focus-visible:shadow-[var(--focus-ring)]"
                  />
                </label>
              )}
            </div>
            {fmt.sealed && (
              <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                暗标部分不得出现投标人名称、印章等身份标识；交卷体检会核对暗标页数与目标页数并给出交叉警告
              </p>
            )}
            {/* 循环 2 批 1-4：自家身份词——暗标开启时注入正文生成脱敏规则，且「暗标身份脱敏」检查项据此逐词扫描 */}
            <label className="mt-2 grid gap-1">
              <FieldLabel>自家身份词（逗号分隔；暗标开启后正文生成自动脱敏，交卷体检逐词扫描）</FieldLabel>
              <Input
                type="text"
                placeholder="公司全称,简称,法人姓名"
                value={identityDraft}
                onChange={(e) => setIdentityDraft(e.target.value)}
                onBlur={commitIdentityWords}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur()
                }}
                className="border-border bg-background focus-visible:shadow-[var(--focus-ring)]"
              />
            </label>
          </section>

          <section>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-foreground">
                格式规则检查项
                <span className="ml-2 font-normal text-muted-foreground">
                  交卷体检时按勾选项本地扫描各章正文（零 AI 费用），命中进体检报告「格式规则检查」节
                </span>
              </h3>
              <span className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => p.setAllFormatCheckItems(true)}
                  className="h-7 border-primary/40 text-primary hover:bg-primary/10"
                >
                  全选
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => p.setAllFormatCheckItems(false)}
                  className="h-7 border-border text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
                >
                  全不选
                </Button>
              </span>
            </div>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {FORMAT_CHECK_KEYS.map((key: FormatCheckKey) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:border-primary/40"
                >
                  <input
                    type="checkbox"
                    checked={p.formatCheckItems.includes(key)}
                    onChange={() => p.toggleFormatCheckItem(key)}
                    className="h-4 w-4 shrink-0 accent-primary"
                  />
                  {FORMAT_CHECK_LABEL[key]}
                </label>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

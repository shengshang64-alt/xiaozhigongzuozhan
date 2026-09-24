import { FileCog, RotateCcw, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DEFAULT_FORMAT_SETTINGS,
  FORMAT_ALIGN_OPTIONS,
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
  type FormatFont,
  type FormatPaper,
  type FormatSettings,
  type FormatFontSize,
  type TitleNumbering,
} from "@/pages/BidWorkspace/bidTypes"

type SsFormatCardProps = {
  fmt: FormatSettings
  onPatch: (patch: Partial<FormatSettings>) => void
}

const MARGIN_FIELDS: { key: "top" | "bottom" | "left" | "right"; label: string }[] = [
  { key: "top", label: "上" },
  { key: "bottom", label: "下" },
  { key: "left", label: "左" },
  { key: "right", label: "右" },
]

const HEAD_LEVEL_LABEL = ["一级标题（章）", "二级标题（节）", "三级标题"]

const selectCls =
  "h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
const inputCls =
  "h-8 w-16 rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"

function FontSizeSelects({
  font,
  size,
  onChange,
}: {
  font: FormatFont
  size: FormatFontSize
  onChange: (v: { font?: FormatFont; size?: FormatFontSize }) => void
}) {
  return (
    <>
      <select value={font} onChange={(e) => onChange({ font: e.target.value as FormatFont })} className={selectCls}>
        {FORMAT_FONT_OPTIONS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <select value={size} onChange={(e) => onChange({ size: e.target.value as FormatFontSize })} className={selectCls}>
        {FORMAT_SIZE_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </>
  )
}

/**
 * 循环 9 C2 → 问题 3 升级：方案导出格式模板完整面板（正文/标题/表格/编号/页面，与投标文件格式导出同一套映射）；
 * 目录与页眉由「导出模板」卡控制，此处不重复设置。按方案存 localStorage，导出 Word 生效。
 */
export function SsFormatCard({ fmt, onPatch }: SsFormatCardProps) {
  const patchHeading = (level: number, v: Partial<{ font: FormatFont; size: FormatFontSize }>) =>
    onPatch({ heading: fmt.heading.map((h, i) => (i === level ? { ...h, ...v } : h)) })
  const tblFont = splitContentFont(fmt.table.contentFont)
  const fixedPt = parseFixedLineSpacing(fmt.body.lineSpacing)
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <FileCog className="h-4 w-4 text-primary" />
          导出格式模板
        </h3>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 border-primary/40 px-2.5 text-xs text-primary hover:bg-primary/10"
            title="一键套用公司《智业软件文档编辑使用规范 V2.1》排版参数"
            onClick={() => onPatch(ZHIYE_STANDARD_FORMAT)}
          >
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            套用智业标准排版
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onPatch(DEFAULT_FORMAT_SETTINGS)}
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            恢复默认
          </Button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        导出 Word 时全文生效：正文字体/字号/首行缩进/行距、各级标题、表格与页面设置；按方案保存，刷新不丢
      </p>

      <div className="mt-3 grid gap-x-6 gap-y-3 md:grid-cols-2">
        {/* 正文 */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="w-14 shrink-0 font-medium text-foreground">正文</span>
          <FontSizeSelects
            font={fmt.body.font}
            size={fmt.body.size}
            onChange={(v) => onPatch({ body: { ...fmt.body, ...v } })}
          />
          <select
            value={fmt.body.align}
            onChange={(e) => onPatch({ body: { ...fmt.body, align: e.target.value as FormatAlign } })}
            className={selectCls}
          >
            {FORMAT_ALIGN_OPTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <select
            value={fixedPt !== null ? "固定值" : fmt.body.lineSpacing}
            onChange={(e) =>
              onPatch({
                body: {
                  ...fmt.body,
                  lineSpacing: e.target.value === "固定值" ? fixedLineSpacingValue(18) : e.target.value,
                },
              })
            }
            className={selectCls}
          >
            {LINE_SPACING_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o === "固定值" ? "固定值(磅)" : o}
              </option>
            ))}
          </select>
          {fixedPt !== null && (
            <input
              type="number"
              min={9}
              max={50}
              value={fixedPt}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n)) onPatch({ body: { ...fmt.body, lineSpacing: fixedLineSpacingValue(n) } })
              }}
              className="h-8 w-14 rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          )}
          <label className="flex items-center gap-1">
            首行缩进
            <input
              type="number"
              min={0}
              max={4}
              value={fmt.body.firstIndent}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isFinite(n)) return
                onPatch({ body: { ...fmt.body, firstIndent: Math.min(4, Math.max(0, Math.round(n))) } })
              }}
              className="h-8 w-12 rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            字符
          </label>
        </div>

        {/* 表格 */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="w-14 shrink-0 font-medium text-foreground">表格内容</span>
          <FontSizeSelects
            font={tblFont.font}
            size={tblFont.size}
            onChange={(v) => {
              const next = { ...tblFont, ...v }
              onPatch({ table: { ...fmt.table, contentFont: `${next.font}${next.size}` } })
            }}
          />
          <label className="flex items-center gap-1">
            边框
            <input
              type="number"
              min={0.5}
              max={3}
              step={0.5}
              value={parseFloat(fmt.table.border) || 0.5}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n)) onPatch({ table: { ...fmt.table, border: `${Math.min(3, Math.max(0.5, n))}pt` } })
              }}
              className="h-8 w-14 rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            pt
          </label>
        </div>

        {/* 一~三级标题 */}
        {HEAD_LEVEL_LABEL.map((label, level) => (
          <div key={level} className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-24 shrink-0 font-medium text-foreground">{label}</span>
            <FontSizeSelects
              font={fmt.heading[level].font}
              size={fmt.heading[level].size}
              onChange={(v) => patchHeading(level, v)}
            />
          </div>
        ))}

        {/* 标题编号样式 */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="w-14 shrink-0 font-medium text-foreground">标题编号</span>
          <select
            value={fmt.titleNumbering}
            onChange={(e) => onPatch({ titleNumbering: e.target.value as TitleNumbering })}
            className={selectCls}
          >
            {TITLE_NUMBERING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground/80">{TITLE_NUMBERING_OPTIONS.find((o) => o.value === fmt.titleNumbering)?.example}</span>
        </div>

        {/* 页面 */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground md:col-span-2">
          <span className="w-14 shrink-0 font-medium text-foreground">页面</span>
          <select
            value={fmt.paper}
            onChange={(e) => onPatch({ paper: e.target.value as FormatPaper })}
            className={selectCls}
          >
            {PAPER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {MARGIN_FIELDS.map((m) => (
            <label key={m.key} className="flex items-center gap-1">
              边距{m.label}(cm)
              <input
                type="number"
                min={0.5}
                max={6}
                step={0.1}
                value={fmt.margins[m.key]}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (!Number.isFinite(n)) return
                  onPatch({ margins: { ...fmt.margins, [m.key]: Math.min(6, Math.max(0.5, n)) } })
                }}
                className={inputCls}
              />
            </label>
          ))}
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={fmt.pageNumber}
              onChange={(e) => onPatch({ pageNumber: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            页脚页码
          </label>
        </div>
      </div>
    </section>
  )
}

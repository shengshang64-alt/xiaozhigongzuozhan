import type { CSSProperties } from "react"
import { AlertTriangle, Check, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { DiffItem } from "@/pages/FormatTool/formatDiff"
import type { FormatSpec } from "@/pages/FormatTool/formatSpec"
import { SIZE_PT } from "@/pages/FormatTool/formatSpec"
import type { FormatSettings } from "@/pages/BidWorkspace/bidTypes"

// ---------------------------------------------------------------------------
// fmt6 第 3 步「刷新前后对比」：同一段样张文字，左栏按原稿识别样式渲染、
// 异常属性标红；右栏按套用模板后的样式渲染。样张文字两侧完全一致 → 文字 0 改动。
// ---------------------------------------------------------------------------

const SAMPLE_HEADING = "第五章　集成平台设计"
const SAMPLE_BODY_1 =
  "集成平台采用企业服务总线（ESB）与医疗信息标准（HL7 FHIR / IHE）相结合的架构，统一承载院内各业务系统之间的数据交换与业务协同。"
const SAMPLE_BODY_2 =
  "接入层通过标准化适配器对接 HIS、LIS、PACS、EMR 等核心系统，支持实时消息、定时批量与 API 调用三种集成模式。"

function lineHeightCss(s: string): string | undefined {
  if (!s) return undefined
  if (s === "单倍") return "1"
  if (s === "1.5倍") return "1.5"
  if (s === "2倍") return "2"
  const fixed = /^固定值(\d+(?:\.\d+)?)磅$/.exec(s)
  if (fixed) return `${fixed[1]}pt`
  const ratio = Number(s.replace(/倍$/, ""))
  return Number.isFinite(ratio) && ratio > 0 ? `${ratio}` : undefined
}

const ALIGN_CSS: Record<string, string> = { left: "left", center: "center", right: "right", justify: "justify" }

type RawLike = { fontEastAsia: string; sizePt: number; bold: boolean; align: string; lineSpacing?: string; firstLineChars?: number }

function sampleStyle(src: RawLike, settings: FormatSettings, before: boolean): CSSProperties {
  if (before) {
    return {
      fontFamily: src.fontEastAsia ? `"${src.fontEastAsia}", serif` : undefined,
      fontSize: src.sizePt ? `${src.sizePt}pt` : undefined,
      fontWeight: src.bold ? 700 : 400,
      textAlign: (src.align && (ALIGN_CSS[src.align] as CSSProperties["textAlign"])) || undefined,
      lineHeight: lineHeightCss(src.lineSpacing ?? ""),
      textIndent: src.firstLineChars ? `${src.firstLineChars}em` : undefined,
    }
  }
  const b = settings.body
  return {
    fontFamily: `"${b.font}", serif`,
    fontSize: `${SIZE_PT[b.size] ?? 12}pt`,
    fontWeight: 400,
    textAlign: ALIGN_CSS[b.align] as CSSProperties["textAlign"],
    lineHeight: lineHeightCss(b.lineSpacing),
    textIndent: b.firstIndent ? `${b.firstIndent}em` : undefined,
  }
}

function headStyleSrc(spec: FormatSpec | null, settings: FormatSettings, before: boolean): CSSProperties {
  const h1 = spec?.headings.find((x) => x.level === 1)
  if (before) {
    return sampleStyle(
      h1 ?? { fontEastAsia: "", sizePt: 0, bold: true, align: "" },
      settings,
      true,
    )
  }
  const cfg = settings.heading[0]
  return {
    fontFamily: `"${cfg.font}", serif`,
    fontSize: `${(SIZE_PT[cfg.size] ?? 16) + 2}pt`,
    fontWeight: 700,
    textAlign: ALIGN_CSS[cfg.align] as CSSProperties["textAlign"],
  }
}

function AnomalyChip({ items }: { items: DiffItem[] }) {
  if (!items.length) return null
  return (
    <span className="mb-1 inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive ring-1 ring-destructive/40">
      <AlertTriangle className="h-3 w-3" />
      {items.map((d) => d.label).join(" · ")}
    </span>
  )
}

export function FormatDiffPreview({
  spec,
  settings,
  diffs,
}: {
  spec: FormatSpec | null
  settings: FormatSettings
  diffs: DiffItem[]
}) {
  if (!spec) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background/60 px-4 py-14 text-center">
        <FileSearchish />
        <p className="text-sm font-medium text-foreground">上传文档后这里会显示刷新前后对比</p>
        <p className="max-w-72 text-xs leading-relaxed text-muted-foreground">
          左侧完成第 1 步上传识别、第 2 步选定模板后，即可预览每处格式异常的修正效果
        </p>
      </div>
    )
  }
  const anom = diffs.filter((d) => !d.same)
  const bodyAnom = anom.filter((d) => ["正文字体", "正文字号", "正文行距", "正文对齐", "首行缩进"].includes(d.label))
  const headAnom = anom.filter((d) => d.label.startsWith("一级标题"))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">第 3 步 · 刷新前后对比</p>
        <div className="flex items-center gap-1.5">
          <Badge variant="destructive" className="font-normal">{anom.length} 处格式异常</Badge>
          <Badge variant="success" className="bg-primary/10 text-primary hover:bg-primary/10 focus:ring-primary/40">
            <ShieldCheck className="mr-1 h-3 w-3" />
            文字 0 改动
          </Badge>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {/* 刷新前（原稿识别样式） */}
        <div className="rounded-lg border border-destructive/30 bg-background p-3">
          <p className="mb-2 inline-flex items-center gap-1 rounded bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
            <AlertTriangle className="h-3 w-3" /> 刷新前（原稿）
          </p>
          <AnomalyChip items={headAnom} />
          <p className="mb-2 break-all" style={headStyleSrc(spec, settings, true)}>{SAMPLE_HEADING}</p>
          <AnomalyChip items={bodyAnom} />
          <p className="break-all" style={sampleStyle(spec.body, settings, true)}>{SAMPLE_BODY_1}</p>
          <p className="mt-2 break-all" style={sampleStyle(spec.body, settings, true)}>{SAMPLE_BODY_2}</p>
          <p className="mt-3 border-t border-border/60 pt-2 text-[10px] leading-relaxed text-muted-foreground">
            {spec.sourceFileName} · 正文 {spec.body.fontEastAsia || "—"} {spec.body.sizePt || "—"}pt · 行距 {spec.body.lineSpacing || "未设置"}
          </p>
        </div>
        {/* 刷新后（套用模板样式） */}
        <div className="rounded-lg border border-primary/30 bg-background p-3">
          <p className="mb-2 inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            <Check className="h-3 w-3" /> 刷新后（{settings.paper} · {settings.body.font}
            {settings.body.size}）
          </p>
          <p className="mb-2" style={headStyleSrc(spec, settings, false)}>{SAMPLE_HEADING}</p>
          <p className="break-all" style={sampleStyle(spec.body, settings, false)}>{SAMPLE_BODY_1}</p>
          <p className="mt-2 break-all" style={sampleStyle(spec.body, settings, false)}>{SAMPLE_BODY_2}</p>
          <p className="mt-3 border-t border-border/60 pt-2 text-[10px] leading-relaxed text-primary">
            ✓ 样张文字与原稿完全一致，仅排版样式按模板重设（可逐字校对）
          </p>
        </div>
      </div>

      {/* 异常明细：raw → mapped 逐项列出 */}
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">格式项</th>
              <th className="px-3 py-2 text-left font-medium">原稿</th>
              <th className="px-3 py-2 text-left font-medium">刷新后</th>
              <th className="px-3 py-2 text-left font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {diffs.map((d) => (
              <tr key={d.label} className={"border-t border-border " + (!d.same ? "bg-destructive/5" : "")}>
                <td className="px-3 py-1.5 font-medium text-foreground">{d.label}</td>
                <td className={"px-3 py-1.5 " + (!d.same ? "text-destructive" : "text-muted-foreground")}>{d.raw}</td>
                <td className="px-3 py-1.5 text-foreground">{d.mapped}</td>
                <td className="px-3 py-1.5">
                  {d.same ? (
                    <span className="inline-flex items-center gap-1 text-primary"><Check className="h-3 w-3" />一致</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-destructive"><AlertTriangle className="h-3 w-3" />将修正</span>
                  )}
                </td>
              </tr>
            ))}
            {diffs.length === 0 && (
              <tr className="border-t border-border">
                <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">
                  未勾选刷新范围，请至少在左侧「刷新范围」勾选一类
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card p-3 text-center shadow-sm">
          <p className="text-xs text-muted-foreground">检出格式异常</p>
          <p className="mt-0.5 text-2xl font-bold text-destructive">{anom.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-center shadow-sm">
          <p className="text-xs text-muted-foreground">比对通过</p>
          <p className="mt-0.5 text-2xl font-bold text-primary">{diffs.length - anom.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-center shadow-sm">
          <p className="text-xs text-muted-foreground">文字改动</p>
          <p className="mt-0.5 text-2xl font-bold text-primary">0 处</p>
        </div>
      </div>
    </div>
  )
}

function FileSearchish() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-muted-foreground">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <circle cx="11.5" cy="14.5" r="2.5" />
      <path d="m16 19-2-2" />
    </svg>
  )
}

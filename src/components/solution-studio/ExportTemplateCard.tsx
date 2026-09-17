import { FileCog } from "lucide-react"
import type { SolutionExportTemplate } from "@/pages/SolutionStudio/exportTemplate"

// R007（B-4 阶段一）：方案导出模板设置卡（封面/目录/页眉），与导出页面格式卡并排。

function Toggle({
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
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
      />
      <span>
        <span className="font-medium text-foreground">{label}</span>
        <span className="block text-xs leading-relaxed text-muted-foreground">{desc}</span>
      </span>
    </label>
  )
}

export function ExportTemplateCard({
  tpl,
  onPatch,
}: {
  tpl: SolutionExportTemplate
  onPatch: (patch: Partial<SolutionExportTemplate>) => void
}) {
  return (
    <section className="rounded-xl border border-border bg-card px-6 py-5 shadow-md">
      <div className="flex flex-wrap items-center gap-2">
        <FileCog className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">导出模板</h3>
        <span className="text-xs text-muted-foreground">按方案保存，导出 Word 时生效</span>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Toggle
          label="封面页"
          desc="方案名、客户医院、编制日期独占首页；可填单位名称显示在方案名上方"
          checked={tpl.cover}
          onChange={(v) => onPatch({ cover: v })}
        />
        <Toggle
          label="自动目录"
          desc="按章/节标题生成目录域；首次在 Word 中打开时按提示更新域即得页码"
          checked={tpl.toc}
          onChange={(v) => onPatch({ toc: v })}
        />
        <label className="text-sm md:col-span-2">
          <span className="font-medium text-foreground">封面单位名称</span>
          <input
            value={tpl.company}
            placeholder="如：XX 信息科技有限公司（留空则封面不显示）"
            onChange={(e) => onPatch({ company: e.target.value })}
            className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-foreground placeholder:text-muted-foreground/60"
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className="font-medium text-foreground">页眉文字</span>
          <input
            value={tpl.headerText}
            placeholder="如：XX 公司 · 信息化建设方案（留空则不加页眉）"
            onChange={(e) => onPatch({ headerText: e.target.value })}
            className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-foreground placeholder:text-muted-foreground/60"
          />
        </label>
      </div>
    </section>
  )
}

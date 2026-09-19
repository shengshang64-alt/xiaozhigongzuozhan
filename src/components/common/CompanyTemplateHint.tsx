// R-203：公司标准化模版场景挂钩——在各工作台列表页头部展示「本场景配套模版」并可直接下载原件。
// 数据来自 /api/doc_templates（pocketbase/pb_hooks/doc_templates.pb.js，由
// scripts/import-company-templates.mjs 导入）。无数据/接口异常时整行不渲染，不打扰主流程。
import { useEffect, useState } from "react"
import { Download, Paperclip } from "lucide-react"
import { getPocketBaseUrl } from "@/lib/pb"

type TemplateRow = {
  id: string
  name: string
  scenario: string
  kind: string
  file_name: string
  stored_name: string
  usage_notes?: string
}

function downloadUrl(id: string): string {
  return `${getPocketBaseUrl()}/api/doc_templates/${id}/download`
}

/**
 * @param scenario 主场景（solution | bid | ppt | quote | office | email）
 * @param extraScenario 附加带出的场景（如文档类场景统一带出 spec 格式规范），可空
 */
export function CompanyTemplateHint({ scenario, extraScenario }: { scenario: string; extraScenario?: string }) {
  const [rows, setRows] = useState<TemplateRow[]>([])

  useEffect(() => {
    let cancelled = false
    const scenarios = extraScenario ? [scenario, extraScenario] : [scenario]
    void Promise.all(
      scenarios.map((s) =>
        fetch(`${getPocketBaseUrl()}/api/doc_templates?scenario=${s}&active=true&perPage=20&sort=sort`)
          .then((r) => (r.ok ? r.json() : { items: [] }))
          .catch(() => ({ items: [] })),
      ),
    ).then((resList) => {
      if (cancelled) return
      const merged: TemplateRow[] = []
      for (const res of resList) {
        for (const item of (res.items ?? []) as TemplateRow[]) {
          if (item.stored_name && !merged.some((m) => m.id === item.id)) merged.push(item)
        }
      }
      setRows(merged)
    })
    return () => {
      cancelled = true
    }
  }, [scenario, extraScenario])

  if (rows.length === 0) return null

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1 font-medium text-primary">
        <Paperclip className="h-3.5 w-3.5" />
        公司标准模版
      </span>
      {rows.map((r) => (
        <a
          key={r.id}
          href={downloadUrl(r.id)}
          title={`${r.file_name}（点击下载原件）${r.usage_notes ? `\n${r.usage_notes}` : ""}`}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          {r.name}
          <Download className="h-3 w-3" />
        </a>
      ))}
    </div>
  )
}

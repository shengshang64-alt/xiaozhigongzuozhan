// R-203：公司标准化模版场景挂钩——在各工作台列表页头部展示「本场景配套模版」并可直接下载原件。
// 数据来自 /api/doc_templates（pocketbase/pb_hooks/doc_templates.pb.js，由
// scripts/import-company-templates.mjs 导入）。无数据/接口异常时整行不渲染，不打扰主流程。
// UX-R2：数据与鉴权下载逻辑抽到 ./companyTemplates（供「新建方案」下拉菜单等非条状场景复用）。
import { Download, Paperclip } from "lucide-react"
import { useCompanyTemplates } from "./companyTemplates"

export function CompanyTemplateHint({ scenario, extraScenario }: { scenario: string; extraScenario?: string }) {
  const { rows, busyId, download } = useCompanyTemplates(scenario, extraScenario)

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
          href="#"
          onClick={(ev) => {
            ev.preventDefault()
            void download(r)
          }}
          title={`${r.file_name}（点击下载原件）${r.usage_notes ? `\n${r.usage_notes}` : ""}`}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          {r.name}
          {busyId === r.id ? (
            <span className="h-3 w-3 animate-spin rounded-full border border-primary border-t-transparent" aria-hidden="true" />
          ) : (
            <Download className="h-3 w-3" />
          )}
        </a>
      ))}
    </div>
  )
}

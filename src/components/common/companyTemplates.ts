// UX-R2（docs/ux-review-2026-11）：公司标准模版的数据与鉴权下载逻辑（从 CompanyTemplateHint 抽出），
// 供条状提示组件与「新建方案」下拉菜单等非条状场景共用；react-refresh 要求 hook 与组件分文件。
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import { triggerBlobDownload } from "@/lib/download"

export type TemplateRow = {
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
export function useCompanyTemplates(scenario: string, extraScenario?: string) {
  const [rows, setRows] = useState<TemplateRow[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const scenarios = extraScenario ? [scenario, extraScenario] : [scenario]
    void Promise.all(
      scenarios.map((s) =>
        fetch(`${getPocketBaseUrl()}/api/doc_templates?scenario=${s}&active=true&perPage=20&sort=sort`, {
          headers: vibexAuthHeaders(),
        })
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

  // 下载走带鉴权头的 fetch→blob：后端 /download 只认 X-Rh-User-Id，而 <a href> 直链发不了自定义头
  const download = async (r: TemplateRow) => {
    if (busyId) return
    setBusyId(r.id)
    try {
      const res = await fetch(downloadUrl(r.id), { headers: vibexAuthHeaders() })
      if (!res.ok) {
        toast.error(`下载失败：模版${res.status === 404 ? "不存在或未导入原件" : "暂不可用"}`)
        return
      }
      const blob = await res.blob()
      triggerBlobDownload(blob, r.file_name || r.name)
    } catch {
      toast.error("下载失败，请稍后重试")
    } finally {
      setBusyId(null)
    }
  }

  return { rows, busyId, download }
}

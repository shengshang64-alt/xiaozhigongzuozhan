// 客户数据体检（R216）：AI 批量补全（r213/r215）遗留的「待核实」数据缺少集中核对入口——
// 147 个 AI 补的官网、上百个待核实字段散在各档案里，用户无从下手。
// 本面板纯前端本地计算（customers 已全量在内存），零请求零写库：
//   ① 待核实官网清单（ai_generated_fields 含 website）：逐家「打开官网 / 定位档案」
//   ② 待核实字段分布与缺失排行
//   ③ 一键导出核对清单 CSV（线下人工核对用）
import { useMemo, useState } from "react"
import { ExternalLink, FileDown, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { exportToCsv } from "@/lib/exportCsv"
import { localDateStamp } from "@/lib/dateStamp"
import { normalizeRegion } from "@/pages/CustomerManagement/customerNormalize"

type CheckupCustomer = {
  id: string
  hospital_name: string
  region?: string
  website?: string
  ai_generated_fields?: string[] | null
}

const MISSING_FIELDS: { key: string; label: string }[] = [
  { key: "address", label: "地址" },
  { key: "president", label: "院长" },
  { key: "party_secretary", label: "党委书记" },
  { key: "it_lead", label: "信息化负责人" },
  { key: "beds_total", label: "开放床位" },
  { key: "beds_icu", label: "ICU 床位" },
  { key: "outpatient_daily", label: "日门诊量" },
  { key: "outpatient_yearly", label: "年门诊量" },
  { key: "annual_revenue", label: "年营业收入" },
  { key: "key_departments", label: "重点科室" },
  { key: "leadership", label: "领导班子" },
  { key: "contacts", label: "联系人" },
]

function filled(v: unknown): boolean {
  const s = String(v ?? "").trim()
  return Boolean(s) && !["null", "None", "0", "[]"].includes(s)
}

export function CustomerDataCheckupDialog({
  open,
  onOpenChange,
  customers,
  onLocateCustomer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customers: CheckupCustomer[]
  onLocateCustomer: (customerId: string) => void
}) {
  const [tab, setTab] = useState<"website" | "missing">("website")

  const checkup = useMemo(() => {
    const pendingWebsites = customers.filter((c) => (c.ai_generated_fields || []).includes("website") && filled(c.website))
    const noWebsite = customers.filter((c) => !filled(c.website))
    const pendingFieldCount: Record<string, number> = {}
    for (const c of customers) for (const f of c.ai_generated_fields || []) pendingFieldCount[f] = (pendingFieldCount[f] || 0) + 1
    const missingRank = MISSING_FIELDS.map((f) => ({
      ...f,
      count: customers.filter((c) => !filled((c as unknown as Record<string, unknown>)[f.key])).length,
    }))
      .filter((f) => f.count > 0)
      .sort((a, b) => b.count - a.count)
    const verifiedWebsites = customers.length - pendingWebsites.length - noWebsite.length
    return { pendingWebsites, noWebsite, pendingFieldCount, missingRank, verifiedWebsites }
  }, [customers])

  const exportChecklist = () => {
    exportToCsv(
      `官网核对清单_${localDateStamp()}.csv`,
      ["医院名称", "地区", "官网（待核实）"],
      checkup.pendingWebsites.map((c) => [c.hospital_name, normalizeRegion(c.region) || c.region || "", c.website || ""]),
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[92vw] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>客户数据体检</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-xs text-muted-foreground">
          集中核对 AI 批量补全遗留的「待核实」数据：官网地址最易抓错（政府门户/新闻页混入），建议优先过一遍；带标记的字段人工修改后标记自动清除。
        </p>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">官网待核实</div>
            <div className="mt-0.5 text-lg font-bold tabular-nums text-foreground">{checkup.pendingWebsites.length}</div>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">已核实官网</div>
            <div className="mt-0.5 text-lg font-bold tabular-nums text-foreground">{checkup.verifiedWebsites}</div>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">无官网</div>
            <div className="mt-0.5 text-lg font-bold tabular-nums text-foreground">{checkup.noWebsite.length}</div>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">待核实字段总数</div>
            <div className="mt-0.5 text-lg font-bold tabular-nums text-foreground">
              {Object.values(checkup.pendingFieldCount).reduce((a, b) => a + b, 0)}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 rounded-full bg-muted p-0.5 text-xs">
          {([["website", `官网待核实（${checkup.pendingWebsites.length}）`], ["missing", "待核实字段分布"]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-full px-3 py-1.5 font-medium transition-colors ${tab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
          <div className="ml-auto pr-1">
            {tab === "website" ? (
              <Button size="sm" variant="outline" disabled={!checkup.pendingWebsites.length} onClick={exportChecklist}>
                <FileDown className="mr-1 h-3.5 w-3.5" />导出核对清单
              </Button>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
          {tab === "website" ? (
            checkup.pendingWebsites.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">没有待核实的官网 —— 全部核对完成 🎉</div>
            ) : (
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-2.5 py-2 text-left font-medium">医院</th>
                    <th className="px-2.5 py-2 text-left font-medium">地区</th>
                    <th className="px-2.5 py-2 text-left font-medium">官网（AI 补，待核实）</th>
                    <th className="w-24 px-2.5 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {checkup.pendingWebsites.map((c) => (
                    <tr key={c.id} className="border-t border-border hover:bg-muted/40">
                      <td className="max-w-40 truncate px-2.5 py-1.5 font-medium text-foreground" title={c.hospital_name}>{c.hospital_name}</td>
                      <td className="px-2.5 py-1.5 text-muted-foreground">{normalizeRegion(c.region) || "—"}</td>
                      <td className="max-w-64 truncate px-2.5 py-1.5 text-muted-foreground">
                        <a
                          href={String(c.website || "").startsWith("http") ? String(c.website) : `https://${c.website}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                          title={String(c.website)}
                        >
                          {String(c.website).slice(0, 48)}
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </td>
                      <td className="px-2.5 py-1.5 text-right">
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onLocateCustomer(c.id)}>
                          <Pencil className="mr-1 h-3 w-3" />核对
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            <div className="space-y-1.5 p-3">
              {checkup.missingRank.map((f) => (
                <div key={f.key} className="flex items-center gap-2.5">
                  <span className="w-28 shrink-0 text-xs text-foreground">{f.label}</span>
                  <div className="h-4 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${Math.round((f.count / Math.max(customers.length, 1)) * 100)}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    缺 {f.count}/{customers.length}
                  </span>
                </div>
              ))}
              <p className="pt-2 text-[11px] leading-relaxed text-muted-foreground">
                「信息化负责人 / ICU 床位 / 联系人」在医院官网从不公开——公开渠道补不到属正常，建议由销售线下拜访后录入；
                其余字段可用「批量补全 / 全量补全」继续补（官网可正常打开的医院成功率最高）。
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

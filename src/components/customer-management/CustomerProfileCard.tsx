import { useState } from "react"
import { normalizeHospitalLevel, normalizeRegion } from "@/pages/CustomerManagement/customerNormalize"
import { ExternalLink, Loader2, MoreHorizontal, Pencil, Phone, Plus, Trash2, UserRound, Wand2 } from "lucide-react"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { AiBadge } from "@/components/customer-management/AiBadge"
import { formatMoney } from "@/lib/money"
import {
  computeMissingFields,
  fmtMetric,
  toItRatings,
  toLeadership,
  toSystemVendors,
  type CustomerRow,
} from "@/pages/CustomerManagement/customerTypes"

type CustomerProfileCardProps = {
  customer: CustomerRow
  onEdit: () => void
  /** T7：删除客户（本卡片内 ConfirmDialog 确认后调用） */
  onDelete: (customerId: string) => void
  /** 删除请求进行中（驱动删除按钮 loading） */
  deleting: boolean
  /** 该客户名下商机数（删除确认文案里如实提示归属变化） */
  opportunityCount: number
  onEnrichOne: (customerId: string) => void
  /** 正在补全的客户 id（驱动本卡片按钮 loading） */
  enrichingOneId: string | null
  contactName: string
  setContactName: (value: string) => void
  contactTitle: string
  setContactTitle: (value: string) => void
  contactPhone: string
  setContactPhone: (value: string) => void
  onAddContact: () => void
  onRemoveContact: (index: number) => void
  savingContact: boolean
}

const METRICS: { key: keyof CustomerRow; label: string }[] = [
  { key: "outpatient_daily", label: "日门诊量" },
  { key: "outpatient_yearly", label: "年门诊量" },
  { key: "beds_total", label: "住院床位" },
  { key: "beds_icu", label: "ICU 床位" },
  { key: "beds_or", label: "手术间" },
]

const LEADERS: { key: keyof CustomerRow; label: string }[] = [
  { key: "president", label: "院长" },
  { key: "party_secretary", label: "书记" },
  { key: "it_lead", label: "信息化负责人" },
]

export function CustomerProfileCard({
  customer,
  onEdit,
  onDelete,
  deleting,
  opportunityCount,
  onEnrichOne,
  enrichingOneId,
  contactName,
  setContactName,
  contactTitle,
  setContactTitle,
  contactPhone,
  setContactPhone,
  onAddContact,
  onRemoveContact,
  savingContact,
}: CustomerProfileCardProps) {
  const aiFields = customer.ai_generated_fields ?? []
  const contacts = customer.contacts ?? []
  const departments = customer.key_departments ?? []
  const leaders = toLeadership(customer.leadership)
  const missingCount = computeMissingFields(customer).length
  const enriching = enrichingOneId === customer.id
  // 有结构化领导班子时，扁平区只保留“信息化负责人”（院长/书记由领导团队块承担，避免重复）
  const flatLeaders = leaders.length > 0 ? LEADERS.filter((l) => l.key === "it_lead") : LEADERS
  // 删除联系人前走模态确认，存 index + 展示名
  const [pendingRemoveContact, setPendingRemoveContact] = useState<{ idx: number; label: string } | null>(null)
  // T7：删除整户确认弹窗（danger 态，与删除联系人/删除商机同一交互模式）
  const [pendingDeleteCustomer, setPendingDeleteCustomer] = useState(false)

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-md lg:p-5">
      <header className="flex min-h-14 items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-foreground">{customer.hospital_name}</h3>
            {customer.level && (
              <span className="badge-neutral">
                {normalizeHospitalLevel(customer.level)}
                {aiFields.includes("level") && (
                  <span className="cursor-help" title="医院等级由 AI 补全提供，请人工核实"> · AI</span>
                )}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {/* T1：地区展示走归一（脏值不显示），库内原始值不动 */}
            {[customer.hospital_type, normalizeRegion(customer.region)].filter(Boolean).join(" · ") || "类型与地区待补充"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {missingCount > 0 && (
            <button
              type="button"
              onClick={() => onEnrichOne(customer.id)}
              disabled={enriching}
              title={`当前缺 ${missingCount} 项：抓取官网/概况/领导班子等多来源，用 AI 只补空白字段（已填不覆盖，结果标记需核实）`}
              className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-background px-2.5 py-1.5 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {enriching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              {enriching ? "补全中…" : "智能补全缺失项"}
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Pencil className="h-3.5 w-3.5 text-primary" />
            编辑档案
          </button>
          {/* docs13-3.4：删除为破坏性低频操作，收进「更多操作」下拉，远离常用操作防误触 */}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="更多操作"
              title="更多操作"
              className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                disabled={deleting}
                onClick={() => setPendingDeleteCustomer(true)}
                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                {deleting ? "删除中…" : "删除客户"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {customer.address && (
        <p className="mt-3 text-xs text-muted-foreground">
          地址：{customer.address}
          {aiFields.includes("address") && <span className="ml-1 text-primary">（AI 提供需核实）</span>}
        </p>
      )}
      {customer.website && (
        <a
          href={customer.website.startsWith("http") ? customer.website : `https://${customer.website}`}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          医院官网
          {aiFields.includes("website") && <span className="text-muted-foreground">（AI 提供需核实）</span>}
        </a>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {METRICS.map((metric) => {
          const value = customer[metric.key] as number
          const missing = typeof value !== "number" || value <= 0
          return (
            <div
              key={String(metric.key)}
              className="rounded-md border border-border bg-background p-3 text-center shadow-sm"
            >
              <p className={missing ? "text-sm font-medium text-muted-foreground" : "text-xl font-bold text-foreground"}>
                {missing ? "待补充" : fmtMetric(value)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {metric.label}
                {aiFields.includes(String(metric.key)) && !missing && (
                  <span className="ml-0.5 cursor-help text-primary" title="该数值由 AI 补全提供，请人工核实">·AI</span>
                )}
              </p>
            </div>
          )
        })}
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold text-muted-foreground">重点科室</p>
        {departments.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {departments.map((dep) => (
              <span key={dep} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground">
                {dep}
              </span>
            ))}
            {aiFields.includes("key_departments") && <AiBadge />}
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">待补充，可在编辑档案里添加</p>
        )}
      </div>

      {(() => {
        const ratings = toItRatings(customer.it_ratings)
        const vendors = toSystemVendors(customer.system_vendors)
        if (ratings.length === 0 && vendors.length === 0) return null
        return (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {ratings.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground">信息化评级</p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {ratings.map((r, i) => (
                    <li key={`${r.dimension}-${i}`} className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground">{r.dimension}</span>
                      <span className="font-medium text-foreground">{r.grade || "—"}</span>
                      {r.status && <span className="text-muted-foreground">{`· ${r.status}`}</span>}
                      {r.publish_date && <span className="text-muted-foreground">{`· ${r.publish_date}过级`}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {vendors.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground">系统厂家</p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {vendors.map((v, i) => (
                    <li key={`${v.system}-${i}`} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{v.system}</span>
                      {`：${v.vendor}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      })()}

      {leaders.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-muted-foreground">
            领导班子
            {aiFields.includes("leadership") && <span className="ml-1 text-primary">·AI 提供需核实</span>}
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {leaders.map((m, i) => (
              <li key={`${m.name}-${i}`} className="text-xs">
                <span className="font-medium text-foreground">{m.name}</span>
                {m.title && <span className="ml-1 text-muted-foreground">{m.title}</span>}
                {m.role && <span className="ml-1 text-muted-foreground">（{m.role}）</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(customer.annual_revenue > 0 || flatLeaders.some((l) => String(customer[l.key] ?? "").trim())) && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border border-border bg-background px-3 py-2.5 text-xs">
          {customer.annual_revenue > 0 && (
            <span className="text-muted-foreground">
              年营业收入：
              <span className="font-medium text-foreground">{formatMoney(customer.annual_revenue)} 万元</span>
              {aiFields.includes("annual_revenue") && <span className="ml-0.5 cursor-help text-primary" title="该数值由 AI 补全提供，请人工核实">·AI</span>}
            </span>
          )}
          {flatLeaders.map((l) => {
            const val = String(customer[l.key] ?? "").trim()
            if (!val) return null
            return (
              <span key={String(l.key)} className="text-muted-foreground">
                {l.label}：
                <span className="font-medium text-foreground">{val}</span>
                {aiFields.includes(String(l.key)) && <span className="ml-0.5 cursor-help text-primary" title="该信息由 AI 补全提供，请人工核实">·AI</span>}
              </span>
            )
          })}
        </div>
      )}

      {customer.notes && (
        <div className="mt-4 rounded-md border border-dashed border-border bg-background p-3">
          <p className="text-xs font-semibold text-muted-foreground">备注</p>
          <p className="mt-1 text-sm leading-relaxed text-foreground">{customer.notes}</p>
        </div>
      )}

      <div className="mt-5 border-t border-border pt-4">
        <div className="flex items-center gap-2">
          <UserRound className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold text-foreground">关键联系人</h4>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{contacts.length}</span>
        </div>
        {contacts.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1.5">
            {contacts.map((contact, index) => (
              <li
                key={`${contact.name}-${index}`}
                className="group flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 shadow-sm"
              >
                <span className="text-sm font-medium text-foreground">{contact.name}</span>
                {contact.title && <span className="text-xs text-muted-foreground">{contact.title}</span>}
                {contact.phone && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Phone className="h-3 w-3" />
                    {contact.phone}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setPendingRemoveContact({ idx: index, label: contact.name })}
                  aria-label={`删除联系人 ${contact.name}`}
                  className="ml-auto rounded-full p-1 text-muted-foreground opacity-60 transition-opacity hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            aria-label="联系人姓名"
            placeholder="姓名"
            className="h-9 w-24 rounded-md border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <input
            value={contactTitle}
            onChange={(e) => setContactTitle(e.target.value)}
            aria-label="联系人职务"
            placeholder="职务（如信息科主任）"
            className="h-9 w-40 rounded-md border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <input
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            aria-label="联系人电话"
            type="tel"
            inputMode="tel"
            placeholder="电话"
            className="h-9 w-32 rounded-md border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <button
            type="button"
            onClick={onAddContact}
            disabled={savingContact}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-primary/40 px-3 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            添加
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(pendingRemoveContact)}
        onOpenChange={(o) => {
          if (!o) setPendingRemoveContact(null)
        }}
        title="删除联系人"
        description={pendingRemoveContact ? `确定删除联系人「${pendingRemoveContact.label}」吗？删除后不可恢复。` : ""}
        confirmText="删除"
        tone="danger"
        onConfirm={() => {
          if (pendingRemoveContact) onRemoveContact(pendingRemoveContact.idx)
          setPendingRemoveContact(null)
        }}
      />
      <ConfirmDialog
        open={pendingDeleteCustomer}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteCustomer(false)
        }}
        title="删除客户"
        description={
          `确定删除客户「${customer.hospital_name}」吗？删除后不可恢复。` +
          (opportunityCount > 0
            ? `该客户名下有 ${opportunityCount} 条商机与跟进记录不会被一并删除，但将失去客户归属展示。`
            : "该客户名下暂无商机。")
        }
        confirmText={deleting ? "删除中…" : "确认删除"}
        tone="danger"
        onConfirm={() => {
          setPendingDeleteCustomer(false)
          onDelete(customer.id)
        }}
      />
    </div>
  )
}

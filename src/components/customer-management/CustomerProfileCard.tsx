import { useState } from "react"
import { ExternalLink, Pencil, Phone, Plus, Trash2, UserRound } from "lucide-react"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { AiBadge } from "@/components/customer-management/AiBadge"
import { fmtMetric, type CustomerRow } from "@/pages/CustomerManagement/customerTypes"

type CustomerProfileCardProps = {
  customer: CustomerRow
  onEdit: () => void
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

export function CustomerProfileCard({
  customer,
  onEdit,
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
  // 删除联系人前走模态确认，存 index + 展示名
  const [pendingRemoveContact, setPendingRemoveContact] = useState<{ idx: number; label: string } | null>(null)

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-md lg:p-5">
      <header className="flex min-h-14 items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-foreground">{customer.hospital_name}</h3>
            {customer.level && (
              <span className="badge-neutral">
                {customer.level}
                {aiFields.includes("level") ? " · AI" : ""}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {[customer.hospital_type, customer.region].filter(Boolean).join(" · ") || "类型与地区待补充"}
          </p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Pencil className="h-3.5 w-3.5 text-primary" />
          编辑档案
        </button>
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
                  <span className="ml-0.5 text-primary">·AI</span>
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
            placeholder="姓名"
            className="h-9 w-24 rounded-md border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <input
            value={contactTitle}
            onChange={(e) => setContactTitle(e.target.value)}
            placeholder="职务（如信息科主任）"
            className="h-9 w-40 rounded-md border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <input
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
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
    </div>
  )
}

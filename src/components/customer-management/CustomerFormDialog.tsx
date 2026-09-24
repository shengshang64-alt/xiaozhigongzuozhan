import { useState } from "react"
import { Sparkles, FileText, Loader2, Globe, Link2, Plus, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AiBadge } from "@/components/customer-management/AiBadge"
import { SkillPickerFor } from "@/components/common/SkillPicker"
import type { UseScopeSkills } from "@/hooks/useScopeSkills"
import { HOSPITAL_TYPES, type CustomerDraft, type LeadershipMember } from "@/pages/CustomerManagement/customerTypes"

type CustomerFormDialogProps = {
  open: boolean
  onClose: () => void
  isEdit: boolean
  draft: CustomerDraft
  setDraftField: <K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) => void
  aiFields: string[]
  aiMatching: boolean
  onAiMatch: () => void
  extractText: string
  setExtractText: (value: string) => void
  extracting: boolean
  onExtract: () => void
  fetchingSite: boolean
  onFetchSite: () => void
  articleUrl: string
  setArticleUrl: (value: string) => void
  onFetchUrl: () => void
  onSave: () => void
  saving: boolean
  // 轮次 F：customer-profile 技能选择器源
  profileSkills: UseScopeSkills
}

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"

function FieldLabel({ label, marked }: { label: string; marked: boolean }) {
  return (
    <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      {marked && <AiBadge />}
    </span>
  )
}

// A2-8：数字字段行内校验（允许空串草稿，非法输入即时提示）
function NumberField({
  label,
  marked,
  value,
  onValue,
}: {
  label: string
  marked: boolean
  value: string
  onValue: (v: string) => void
}) {
  const [error, setError] = useState("")
  return (
    <div>
      <FieldLabel label={label} marked={marked} />
      <input
        value={value}
        onChange={(e) => {
          onValue(e.target.value)
          const raw = e.target.value.trim()
          if (raw === "" || /^\d+$/.test(raw)) setError("")
          else setError("请输入 0 以上的整数")
        }}
        inputMode="numeric"
        aria-invalid={Boolean(error)}
        className={`${inputClass} ${error ? "border-destructive focus-visible:ring-destructive" : ""}`}
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}

export function CustomerFormDialog({
  open,
  onClose,
  isEdit,
  draft,
  setDraftField,
  aiFields,
  aiMatching,
  onAiMatch,
  extractText,
  setExtractText,
  extracting,
  onExtract,
  fetchingSite,
  onFetchSite,
  articleUrl,
  setArticleUrl,
  onFetchUrl,
  onSave,
  saving,
  profileSkills,
}: CustomerFormDialogProps) {
  const busy = aiMatching || extracting || fetchingSite
  // 领导团队成员增删改（复用 setDraftField，会同步清掉 leadership 的 AI 待核标记）
  const updateLeader = (idx: number, member: LeadershipMember) =>
    setDraftField("leadership", draft.leadership.map((m, i) => (i === idx ? member : m)))
  const removeLeader = (idx: number) =>
    setDraftField("leadership", draft.leadership.filter((_, i) => i !== idx))
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="max-h-[88vh] max-w-2xl overflow-y-auto"
        onKeyDown={(e) => {
          // 循环7 C4：单行输入 Enter 触发保存；textarea 保留换行；按钮/Radix 浮层内交给原生行为避免双触发
          // 循环8 C3：原生 select（医院类型等）键盘选完选项的 Enter 也豁免，不提前提交
          if (e.key !== "Enter" || e.shiftKey) return
          const target = e.target as HTMLElement
          if (
            target.tagName === "TEXTAREA" ||
            target.tagName === "BUTTON" ||
            target.tagName === "SELECT" ||
            target.isContentEditable ||
            target.closest("[data-radix-popper-content-wrapper]")
          )
            return
          e.preventDefault()
          if (!saving && !busy) onSave()
        }}
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑客户档案" : "新建客户"}</DialogTitle>
          <DialogDescription>
            输入医院名称后可用 AI 自动匹配档案初稿，或点「抓取医院官网补全」让系统抓取官网/概况页正文再提取字段，也可粘贴一段医院介绍文字提取；带「AI 提供需核实」标记的字段请逐项核对，人工修改后标记自动清除。
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 grid gap-3">
          <div>
            <FieldLabel label="医院名称" marked={false} />
            <div className="flex gap-2">
              <input
                value={draft.hospital_name}
                onChange={(e) => setDraftField("hospital_name", e.target.value)}
                placeholder="如：苏州大学附属第一医院"
                className={inputClass}
              />
              <button
                type="button"
                onClick={onAiMatch}
                disabled={busy || !draft.hospital_name.trim()}
                title={draft.hospital_name.trim() ? undefined : "请先填写医院名称"}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-primary/40 px-3 text-sm font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {aiMatching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {aiMatching ? "匹配中…" : "AI 自动匹配档案"}
              </button>
            </div>
          </div>

          <div className="rounded-md border border-dashed border-border bg-secondary/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <FileText className="h-3.5 w-3.5 text-primary" />
                粘贴文本提取：把医院官网介绍或公开资料粘进来，AI 提取各字段填入表单
              </div>
              <SkillPickerFor scope="customer-profile" source={profileSkills} />
            </div>
            <textarea
              value={extractText}
              onChange={(e) => setExtractText(e.target.value)}
              rows={3}
              placeholder="粘贴医院介绍 / 官网文字…"
              className="mt-2 w-full rounded-md border border-border bg-background p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            <div className="mt-2 flex gap-2">
              <div className="relative flex-1">
                <Link2 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={articleUrl}
                  onChange={(e) => setArticleUrl(e.target.value)}
                  placeholder="或粘贴公众号 / 文章直链，抓取正文后提取…"
                  className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </div>
              <button
                type="button"
                onClick={onFetchUrl}
                disabled={busy || !articleUrl.trim()}
                title={articleUrl.trim() ? "抓取该文章链接正文并提取字段（微信文章若有防盗链/需登录可能抓不到）" : "请先粘贴文章链接"}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {fetchingSite ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                抓取链接
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onExtract}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-card px-3 py-1.5 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {extracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {extracting ? "提取中…" : "AI 提取字段"}
              </button>
              <button
                type="button"
                onClick={onFetchSite}
                disabled={busy || !draft.hospital_name.trim()}
                title={draft.hospital_name.trim() ? "自动发现并抓取医院官网/概况页正文，再提取字段（部分老站编码或需JS渲染的站点可能抓不到，可改用粘贴文本）" : "请先填写医院名称"}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {fetchingSite ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
                {fetchingSite ? "抓取官网中…" : "抓取医院官网补全"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel label="医院类型" marked={aiFields.includes("hospital_type")} />
              <select
                value={draft.hospital_type}
                onChange={(e) => setDraftField("hospital_type", e.target.value)}
                className={inputClass}
              >
                <option value="">未选择</option>
                {HOSPITAL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel label="医院等级" marked={aiFields.includes("level")} />
              <input
                value={draft.level}
                onChange={(e) => setDraftField("level", e.target.value)}
                placeholder="如：三级甲等"
                className={inputClass}
              />
            </div>
            <div>
              <FieldLabel label="所在地区" marked={aiFields.includes("region")} />
              <input
                value={draft.region}
                onChange={(e) => setDraftField("region", e.target.value)}
                placeholder="如：江苏省苏州市"
                className={inputClass}
              />
            </div>
            <div>
              <FieldLabel label="官网地址" marked={aiFields.includes("website")} />
              <input
                value={draft.website}
                onChange={(e) => setDraftField("website", e.target.value)}
                placeholder="https://…"
                className={inputClass}
              />
            </div>
            <div className="col-span-2">
              <FieldLabel label="详细地址" marked={aiFields.includes("address")} />
              <input
                value={draft.address}
                onChange={(e) => setDraftField("address", e.target.value)}
                className={inputClass}
              />
            </div>
            <NumberField
              label="日门诊量（人次）"
              marked={aiFields.includes("outpatient_daily")}
              value={draft.outpatient_daily}
              onValue={(v) => setDraftField("outpatient_daily", v)}
            />
            <NumberField
              label="年门诊量（人次）"
              marked={aiFields.includes("outpatient_yearly")}
              value={draft.outpatient_yearly}
              onValue={(v) => setDraftField("outpatient_yearly", v)}
            />
            <NumberField
              label="开放床位数"
              marked={aiFields.includes("beds_total")}
              value={draft.beds_total}
              onValue={(v) => setDraftField("beds_total", v)}
            />
            <NumberField
              label="ICU 床位数"
              marked={aiFields.includes("beds_icu")}
              value={draft.beds_icu}
              onValue={(v) => setDraftField("beds_icu", v)}
            />
            <NumberField
              label="手术间数"
              marked={aiFields.includes("beds_or")}
              value={draft.beds_or}
              onValue={(v) => setDraftField("beds_or", v)}
            />
            <NumberField
              label="年营业收入（万元）"
              marked={aiFields.includes("annual_revenue")}
              value={draft.annual_revenue}
              onValue={(v) => setDraftField("annual_revenue", v)}
            />
            <div>
              <FieldLabel label="重点科室（顿号分隔）" marked={aiFields.includes("key_departments")} />
              <input
                value={draft.key_departments_text}
                onChange={(e) => setDraftField("key_departments_text", e.target.value)}
                placeholder="如：心血管内科、骨科"
                className={inputClass}
              />
            </div>
            <div>
              <FieldLabel label="院长" marked={aiFields.includes("president")} />
              <input
                value={draft.president}
                onChange={(e) => setDraftField("president", e.target.value)}
                placeholder="如：张三"
                className={inputClass}
              />
            </div>
            <div>
              <FieldLabel label="党委书记" marked={aiFields.includes("party_secretary")} />
              <input
                value={draft.party_secretary}
                onChange={(e) => setDraftField("party_secretary", e.target.value)}
                placeholder="如：李四"
                className={inputClass}
              />
            </div>
            <div>
              <FieldLabel label="信息化负责人 / CIO" marked={aiFields.includes("it_lead")} />
              <input
                value={draft.it_lead}
                onChange={(e) => setDraftField("it_lead", e.target.value)}
                placeholder="如：王五（信息中心主任）"
                className={inputClass}
              />
            </div>
            <div className="col-span-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <FieldLabel label="领导班子（选填，姓名 + 职务）" marked={aiFields.includes("leadership")} />
                <button
                  type="button"
                  onClick={() => setDraftField("leadership", [...draft.leadership, { name: "", title: "", role: "" }])}
                  className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-background px-2 py-1 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Plus className="h-3 w-3" />
                  添加成员
                </button>
              </div>
              {draft.leadership.length === 0 ? (
                <p className="text-xs text-muted-foreground">尚未添加领导班子；可用上方「抓取医院官网补全」自动填入，或手动添加。</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {draft.leadership.map((m, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input
                        value={m.name}
                        onChange={(e) => updateLeader(i, { ...m, name: e.target.value })}
                        placeholder="姓名"
                        className={`${inputClass} w-24 shrink-0`}
                      />
                      <input
                        value={m.title}
                        onChange={(e) => updateLeader(i, { ...m, title: e.target.value })}
                        placeholder="职务，如 院长/副院长"
                        className={inputClass}
                      />
                      <input
                        value={m.role ?? ""}
                        onChange={(e) => updateLeader(i, { ...m, role: e.target.value })}
                        placeholder="分工/兼任（可选）"
                        className={`${inputClass} hidden sm:block`}
                      />
                      <button
                        type="button"
                        onClick={() => removeLeader(i)}
                        aria-label="删除该成员"
                        className="shrink-0 rounded-md border border-border p-2 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="col-span-2">
              <FieldLabel label="备注" marked={false} />
              <textarea
                value={draft.notes}
                onChange={(e) => setDraftField("notes", e.target.value)}
                rows={2}
                className="w-full rounded-md border border-border bg-background p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-transform hover:scale-105 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "保存修改" : "创建客户"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
